/**
 * Leitor e validador do SINTEGRA (Convênio ICMS 57/95, leiaute do Convênio 76/03): arquivo texto de
 * registros com 126 posições. Usado pelas empresas do Simples Nacional (e em estados que ainda exigem).
 *
 * Monta um resumo do mês (documentos, NFC-e, ECF, inventário) e aponta problemas de estrutura
 * (totalizadores do 90, tamanho de linha, datas), de consistência (valor × base/isentas/outras, itens × nota,
 * produtos sem 75) e de declaração (88 "sem movimento" com documentos, numeração de NFC-e com buraco).
 */
import { cnpjValido, Nivel, Ocorrencia, ultimoDia } from '../sped/efd';
import municipios from '../sped/municipios.json';

export interface Doc50 {
  linha: number;
  cnpj: string;
  ie: string;
  data: string; // AAAA-MM-DD
  uf: string;
  modelo: string;
  serie: string;
  numero: string;
  cfop: string;
  emitente: 'P' | 'T' | string;
  valor: number;
  bc: number;
  icms: number;
  isenta: number;
  outras: number;
  aliquota: number;
  situacao: string; // N normal, S cancelado, E/X extemporâneo, 2 denegada, 4 inutilizada
}

export interface Reg61 {
  linha: number;
  data: string;
  modelo: string;
  serie: string;
  subserie: string;
  inicial: number;
  final: number;
  valor: number;
  bc: number;
  icms: number;
  isenta: number;
  outras: number;
  aliquota: number;
}

export interface Sintegra {
  cabecalho: {
    cnpj: string; ie: string; nome: string; municipio: string; uf: string; fax: string; dtIni: string; dtFin: string;
    convenio: string; natureza: string; finalidade: string;
  } | null;
  complemento: { logradouro: string; numero: string; complemento: string; bairro: string; cep: string; contato: string; fone: string } | null;
  r50: Doc50[];
  r53: { linha: number; cnpj: string; data: string; modelo: string; serie: string; numero: string; cfop: string; bcSt: number; icmsRetido: number; situacao: string }[];
  r54: { linha: number; cnpj: string; modelo: string; serie: string; numero: string; cfop: string; item: number; produto: string; valor: number; desconto: number }[];
  r60m: { linha: number; data: string; serieEcf: string; vendaBruta: number }[];
  r61: Reg61[];
  r61r: { linha: number; produto: string; valor: number }[];
  r70: { linha: number; data: string; cfop: string; valor: number; situacao: string }[];
  r74: { linha: number; data: string; produto: string; valor: number }[];
  r75: Map<string, { linha: number; ncm: string; descricao: string }>;
  r88: { linha: number; subtipo: string; texto: string }[];
  r90: { linha: number; totais: Map<string, number>; qtd90: number }[];
  contagem: Map<string, number>;
  totalLinhas: number;
  tamanhoErrado: number[];
}

export interface ResumoSintegra {
  tipo: 'sintegra';
  periodo: string;
  linhas: number;
  empresa: { nome: string; cnpj: string; ie: string; uf: string; municipio: string; codMun: string | null } | null;
  finalidade: { codigo: string; texto: string };
  convenio: string;
  natureza: string;
  documentos: { chave: string; rotulo: string; qtd: number; canceladas: number; valor: number }[];
  nfce: { registros: number; notas: number; valor: number; series: string[] };
  ecf: { reducoes: number; vendaBruta: number };
  st: { notas: number; icmsRetido: number };
  inventario: { itens: number; valor: number } | null;
  produtos: number;
  declaracoes: { subtipo: string; texto: string }[];
}

export interface ResultadoSintegra {
  sintegra: Sintegra;
  ocorrencias: Ocorrencia[];
  resumo: ResumoSintegra;
}

const r2 = (n: number) => Math.round(Number((n * 100).toFixed(6))) / 100;
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const n2 = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) / 100 : 0);
const inteiro = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : 0);
const dataAmd = (s: string) => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : '');
/** Fatia 1-indexada, como no manual (posição inicial e final inclusivas). */
const p = (l: string, ini: number, fim: number) => l.slice(ini - 1, fim);
const t = (l: string, ini: number, fim: number) => p(l, ini, fim).trim();

export const CANCELADO_SINTEGRA = new Set(['S', 'X', '2', '4']);
const FINALIDADE: Record<string, string> = {
  '1': 'Normal', '2': 'Retificação total', '3': 'Retificação aditiva', '5': 'Desfazimento',
};

/** O arquivo é SINTEGRA? (primeiro registro 10 com 126 posições.) */
export function ehSintegra(buf: Buffer | string): boolean {
  const texto = typeof buf === 'string' ? buf : buf.subarray(0, 2000).toString('latin1');
  const primeira = texto.split(/\r?\n/)[0] ?? '';
  return /^10\d{14}/.test(primeira) && primeira.replace(/\r$/, '').length >= 120 && primeira.replace(/\r$/, '').length <= 128;
}

export function lerSintegra(texto: string): Sintegra {
  const s: Sintegra = {
    cabecalho: null, complemento: null, r50: [], r53: [], r54: [], r60m: [], r61: [], r61r: [], r70: [], r74: [],
    r75: new Map(), r88: [], r90: [], contagem: new Map(), totalLinhas: 0, tamanhoErrado: [],
  };
  const linhas = texto.split(/\r?\n/);
  while (linhas.length && linhas[linhas.length - 1].trim() === '') linhas.pop();
  s.totalLinhas = linhas.length;
  linhas.forEach((l, i) => {
    const n = i + 1;
    if (l.length !== 126) s.tamanhoErrado.push(n);
    const tipo = l.slice(0, 2);
    const chaveContagem = tipo;
    s.contagem.set(chaveContagem, (s.contagem.get(chaveContagem) ?? 0) + 1);
    switch (tipo) {
      case '10':
        s.cabecalho = {
          cnpj: p(l, 3, 16), ie: t(l, 17, 30), nome: t(l, 31, 65), municipio: t(l, 66, 95), uf: t(l, 96, 97), fax: t(l, 98, 107),
          dtIni: dataAmd(p(l, 108, 115)), dtFin: dataAmd(p(l, 116, 123)), convenio: p(l, 124, 124), natureza: p(l, 125, 125), finalidade: p(l, 126, 126),
        };
        break;
      case '11':
        s.complemento = {
          logradouro: t(l, 3, 36), numero: t(l, 37, 41), complemento: t(l, 42, 63), bairro: t(l, 64, 78), cep: t(l, 79, 86),
          contato: t(l, 87, 114), fone: t(l, 115, 126),
        };
        break;
      case '50':
        s.r50.push({
          linha: n, cnpj: p(l, 3, 16), ie: t(l, 17, 30), data: dataAmd(p(l, 31, 38)), uf: t(l, 39, 40), modelo: p(l, 41, 42), serie: t(l, 43, 45),
          numero: String(inteiro(p(l, 46, 51))), cfop: p(l, 52, 55), emitente: p(l, 56, 56), valor: n2(p(l, 57, 69)), bc: n2(p(l, 70, 82)),
          icms: n2(p(l, 83, 95)), isenta: n2(p(l, 96, 108)), outras: n2(p(l, 109, 121)), aliquota: n2(p(l, 122, 125)), situacao: p(l, 126, 126),
        });
        break;
      case '53':
        s.r53.push({
          linha: n, cnpj: p(l, 3, 16), data: dataAmd(p(l, 31, 38)), modelo: p(l, 41, 42), serie: t(l, 43, 45), numero: String(inteiro(p(l, 46, 51))),
          cfop: p(l, 52, 55), bcSt: n2(p(l, 57, 69)), icmsRetido: n2(p(l, 70, 82)), situacao: p(l, 96, 96),
        });
        break;
      case '54':
        s.r54.push({
          linha: n, cnpj: p(l, 3, 16), modelo: p(l, 17, 18), serie: t(l, 19, 21), numero: String(inteiro(p(l, 22, 27))), cfop: p(l, 28, 31),
          item: inteiro(p(l, 35, 37)), produto: t(l, 38, 51), valor: n2(p(l, 63, 74)), desconto: n2(p(l, 75, 86)),
        });
        break;
      case '60':
        if (l[2] === 'M') s.r60m.push({ linha: n, data: dataAmd(p(l, 4, 11)), serieEcf: t(l, 12, 31), vendaBruta: n2(p(l, 58, 73)) });
        break;
      case '61':
        if (l[2] === 'R') {
          s.r61r.push({ linha: n, produto: t(l, 10, 23), valor: n2(p(l, 37, 52)) });
        } else {
          s.r61.push({
            linha: n, data: dataAmd(p(l, 31, 38)), modelo: p(l, 39, 40), serie: t(l, 41, 43), subserie: t(l, 44, 45),
            inicial: inteiro(p(l, 46, 51)), final: inteiro(p(l, 52, 57)), valor: n2(p(l, 58, 70)), bc: n2(p(l, 71, 83)), icms: n2(p(l, 84, 95)),
            isenta: n2(p(l, 96, 108)), outras: n2(p(l, 109, 121)), aliquota: n2(p(l, 122, 125)),
          });
        }
        break;
      case '70':
        s.r70.push({ linha: n, data: dataAmd(p(l, 31, 38)), cfop: p(l, 52, 55), valor: n2(p(l, 56, 68)), situacao: p(l, 126, 126) });
        break;
      case '74':
        s.r74.push({ linha: n, data: dataAmd(p(l, 3, 10)), produto: t(l, 11, 24), valor: n2(p(l, 38, 50)) });
        break;
      case '75':
        s.r75.set(t(l, 19, 32), { linha: n, ncm: t(l, 33, 40), descricao: t(l, 41, 93) });
        break;
      case '88':
        // 88 de MG (SME/SMS…): subtipo, CNPJ do informante e texto
        s.r88.push({ linha: n, subtipo: t(l, 3, 5), texto: t(l, 6, 126).replace(/^\d{14}/, '').trim() });
        break;
      case '90': {
        const totais = new Map<string, number>();
        for (let c = 31; c + 9 <= 125; c += 10) {
          const tp = p(l, c, c + 1);
          if (!/^\d{2}$/.test(tp)) continue;
          totais.set(tp, inteiro(p(l, c + 2, c + 9)));
        }
        s.r90.push({ linha: n, totais, qtd90: inteiro(p(l, 126, 126)) });
        break;
      }
      default:
        break;
    }
  });
  return s;
}

/** Números que faltam na sequência das NFC-e/NF modelo 2 (por modelo e série). */
export function lacunas61(r61: Reg61[]): { modelo: string; serie: string; numeros: number[] }[] {
  const grupos = new Map<string, Reg61[]>();
  for (const r of r61) {
    const k = `${r.modelo}|${r.serie}`;
    grupos.set(k, [...(grupos.get(k) ?? []), r]);
  }
  const out: { modelo: string; serie: string; numeros: number[] }[] = [];
  for (const [k, lista] of grupos) {
    const ord = [...lista].sort((a, b) => a.inicial - b.inicial);
    const faltam: number[] = [];
    for (let i = 1; i < ord.length; i++) {
      for (let x = ord[i - 1].final + 1; x < ord[i].inicial && faltam.length < 500; x++) faltam.push(x);
    }
    if (faltam.length) { const [modelo, serie] = k.split('|'); out.push({ modelo, serie, numeros: faltam }); }
  }
  return out;
}

/** Código IBGE pelo nome do município e UF (o SINTEGRA traz só o nome). */
const UF_CODIGO: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29',
  MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
};
const semAcento = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
let indiceMunicipios: Map<string, string> | null = null;
export function codigoMunicipio(nome: string, uf: string): string | null {
  if (!indiceMunicipios) {
    indiceMunicipios = new Map();
    for (const [cod, nm] of Object.entries(municipios as Record<string, string>)) indiceMunicipios.set(`${cod.slice(0, 2)}|${semAcento(nm)}`, cod);
  }
  const ufc = UF_CODIGO[uf.toUpperCase()];
  return ufc ? indiceMunicipios.get(`${ufc}|${semAcento(nome)}`) ?? null : null;
}

export function analisarSintegra(buf: Buffer): ResultadoSintegra {
  const oc: Ocorrencia[] = [];
  const add = (nivel: Nivel, codigo: string, mensagem: string, linhas: number[] = [], quantidade?: number) =>
    oc.push({ nivel, codigo, mensagem, ...(linhas.length ? { linhas: linhas.slice(0, 10) } : {}), ...(quantidade !== undefined ? { quantidade } : {}) });
  // O SINTEGRA é gravado em ASCII/ISO-8859-1
  const utf = buf.toString('utf8');
  const texto = utf.includes('�') ? buf.toString('latin1') : utf;
  const s = lerSintegra(texto);
  const cab = s.cabecalho;
  if (!cab || !ehSintegra(texto)) {
    add('erro', '10', 'O arquivo não parece ser um SINTEGRA (registro 10 com 126 posições não encontrado).');
    s.cabecalho = null;
    return { sintegra: s, ocorrencias: oc, resumo: montarResumo(s) };
  }

  // Estrutura
  if (s.tamanhoErrado.length) add('erro', 'TAMANHO', 'Linhas com tamanho diferente de 126 posições.', s.tamanhoErrado, s.tamanhoErrado.length);
  if ((s.contagem.get('10') ?? 0) !== 1) add('erro', '10_QTD', 'O arquivo deve ter exatamente um registro 10.');
  if (!s.complemento) add('erro', '11', 'Registro 11 (dados complementares do informante) não encontrado.');
  const tiposValidos = new Set(['10', '11', '50', '51', '53', '54', '55', '56', '57', '60', '61', '70', '71', '74', '75', '76', '77', '85', '86', '88', '90']);
  const invalidos = [...s.contagem.keys()].filter((k) => !tiposValidos.has(k));
  if (invalidos.length) add('erro', 'TIPO', `Tipos de registro desconhecidos: ${invalidos.join(', ')}.`);
  if (!s.r90.length) add('erro', '90', 'Registro 90 (totalização) não encontrado.');
  else {
    const declarado = new Map<string, number>();
    for (const r of s.r90) for (const [k, v] of r.totais) declarado.set(k, (declarado.get(k) ?? 0) + v);
    const dif: string[] = [];
    for (const [k, v] of declarado) {
      if (k === '99') { if (v !== s.totalLinhas) dif.push(`total geral: 90 diz ${v}, arquivo tem ${s.totalLinhas}`); continue; }
      const real = s.contagem.get(k) ?? 0;
      if (real !== v) dif.push(`${k}: 90 diz ${v}, arquivo tem ${real}`);
    }
    for (const [k, real] of s.contagem) {
      if (['10', '11', '90'].includes(k)) continue;
      if (!declarado.has(k)) dif.push(`${k}: ${real} no arquivo e sem total no 90`);
    }
    if (!declarado.has('99')) dif.push('total geral (99) ausente no 90');
    const qtd90 = s.r90[s.r90.length - 1].qtd90;
    if (qtd90 !== s.r90.length) dif.push(`quantidade de registros 90: informa ${qtd90}, há ${s.r90.length}`);
    if (dif.length) add('erro', '90_TOTAIS', `Totalizadores do registro 90 não batem: ${dif.slice(0, 8).join('; ')}.`, [], dif.length);
  }

  // Cabeçalho (10)
  if (!cnpjValido(cab.cnpj)) add('erro', '10_CNPJ', `CNPJ do registro 10 (${cab.cnpj}) com dígito verificador inválido.`);
  if (!cab.dtIni || !cab.dtFin || cab.dtIni.slice(0, 7) !== cab.dtFin.slice(0, 7)) add('erro', '10_PERIODO', 'Data inicial e final do registro 10 precisam estar no mesmo mês.');
  else if (!cab.dtIni.endsWith('-01') || Number(cab.dtFin.slice(8)) !== ultimoDia(cab.dtFin)) add('alerta', '10_PERIODO_PARCIAL', 'O período não é o mês inteiro.');
  if (cab.convenio !== '3') add('alerta', '10_CONVENIO', `Código de leiaute "${cab.convenio}": o atual é 3 (Convênio 76/03).`);
  if (!FINALIDADE[cab.finalidade]) add('erro', '10_FINALIDADE', `Finalidade "${cab.finalidade}" inválida (1 normal, 2 retificação total, 3 aditiva, 5 desfazimento).`);
  else if (cab.finalidade !== '1') add('info', '10_RETIFICACAO', `Arquivo de ${FINALIDADE[cab.finalidade].toLowerCase()}.`);

  // Datas dentro do período
  const noPeriodo = (d: string) => !d || (d >= cab.dtIni && d <= cab.dtFin);
  const foraData = [...s.r50, ...s.r61, ...s.r53, ...s.r70].filter((r) => !noPeriodo(r.data)).map((r) => r.linha);
  if (foraData.length) add('erro', 'DATA', 'Documento com data fora do período do arquivo.', foraData, foraData.length);

  // Registro 50: participantes e composição do valor
  const cnpjRuim = s.r50.filter((d) => /^\d{14}$/.test(d.cnpj) && !d.cnpj.startsWith('000') && d.cnpj !== '00000000000000' && !cnpjValido(d.cnpj));
  if (cnpjRuim.length) add('alerta', '50_CNPJ', 'Registro 50 com CNPJ de participante inválido.', cnpjRuim.map((d) => d.linha), cnpjRuim.length);
  const comp50 = s.r50.filter((d) => !CANCELADO_SINTEGRA.has(d.situacao) && Math.abs(d.valor - (d.bc + d.isenta + d.outras)) > 0.05);
  if (comp50.length) add('alerta', '50_COMPOSICAO', 'Registro 50 com valor total diferente de base de cálculo + isentas/não tributadas + outras.', comp50.map((d) => d.linha), comp50.length);
  const aliqSemIcms = s.r50.filter((d) => d.bc > 0 && d.aliquota > 0 && Math.abs(r2((d.bc * d.aliquota) / 100) - d.icms) > 0.05);
  if (aliqSemIcms.length) add('alerta', '50_ICMS', 'Registro 50: base × alíquota diferente do ICMS informado.', aliqSemIcms.map((d) => d.linha), aliqSemIcms.length);

  // Itens (54) × notas (50) e produtos (75)
  const chave50 = (x: { cnpj: string; modelo: string; serie: string; numero: string }) => `${x.cnpj}|${x.modelo}|${x.serie}|${x.numero}`;
  const notas50 = new Map<string, number>();
  for (const d of s.r50) notas50.set(chave50(d), r2((notas50.get(chave50(d)) ?? 0) + d.valor));
  const itensSemNota = s.r54.filter((i) => i.item < 991 && !notas50.has(chave50(i)));
  if (itensSemNota.length) add('erro', '54_SEM_50', 'Itens (54) de nota que não está no registro 50.', itensSemNota.map((i) => i.linha), itensSemNota.length);
  const codigos = new Set(s.r75.keys());
  const semProduto = [...s.r54.filter((i) => i.item < 991 && i.produto), ...s.r61r, ...s.r74].filter((x) => !codigos.has(x.produto));
  if (semProduto.length) add('erro', '75_AUSENTE', 'Produto usado nos registros 54, 61R ou 74 sem cadastro no registro 75.', semProduto.map((x) => x.linha), semProduto.length);

  // Registro 61 (NFC-e / NF modelo 2): composição, sequência
  const comp61 = s.r61.filter((r) => Math.abs(r.valor - (r.bc + r.isenta + r.outras)) > 0.05);
  if (comp61.length) {
    const soma = r2(comp61.reduce((x, r) => x + r.valor - (r.bc + r.isenta + r.outras), 0));
    add('alerta', '61_COMPOSICAO', `Registro 61 com valor total não distribuído entre base de cálculo, isentas/não tributadas e outras (${brl(soma)} sem classificação). Confira como o sistema da loja preenche esses campos.`, comp61.map((r) => r.linha), comp61.length);
  }
  const invertidos = s.r61.filter((r) => r.final < r.inicial);
  if (invertidos.length) add('erro', '61_NUMERACAO', 'Registro 61 com número final menor que o inicial.', invertidos.map((r) => r.linha), invertidos.length);
  for (const lac of lacunas61(s.r61)) {
    add('alerta', '61_LACUNA', `Numeração de ${lac.modelo === '65' ? 'NFC-e' : `modelo ${lac.modelo}`} série ${lac.serie} com ${lac.numeros.length} número(s) fora dos registros: ${lac.numeros.slice(0, 15).join(', ')}${lac.numeros.length > 15 ? '…' : ''}. Se foram canceladas ou inutilizadas, confira a justificativa.`, [], lac.numeros.length);
  }

  // Declarações do registro 88 (MG e outros estados)
  const entradas50 = s.r50.filter((d) => /^[123]/.test(d.cfop) && !CANCELADO_SINTEGRA.has(d.situacao));
  const saidas50 = s.r50.filter((d) => /^[567]/.test(d.cfop) && !CANCELADO_SINTEGRA.has(d.situacao));
  const sme = s.r88.find((r) => r.subtipo === 'SME');
  const sms = s.r88.find((r) => r.subtipo === 'SMS');
  if (sme && entradas50.length) add('erro', '88_SME', `Declarado "sem movimento de entradas" (88SME), mas há ${entradas50.length} registro(s) 50 de entrada.`, [sme.linha]);
  if (sms && saidas50.length) add('erro', '88_SMS', `Declarado "sem movimento de saídas" (88SMS), mas há ${saidas50.length} registro(s) 50 de saída.`, [sms.linha]);
  if (sms && !saidas50.length && (s.r61.length || s.r60m.length)) {
    add('info', '88_SMS_NFCE', `Declarado "sem movimento de saídas" (88SMS) com vendas em NFC-e/ECF (registros 61/60) no arquivo. Em MG o 88SMS indica ausência de notas modelo 1/1A/55 de saída; confirme se é o caso.`, [sms.linha]);
  }
  if (sme && !entradas50.length) add('info', '88_SME_INFO', 'Mês declarado sem compras (88SME). O Appura confere com as NF-e de entrada captadas quando a empresa tiver certificado.', [sme.linha]);

  return { sintegra: s, ocorrencias: oc, resumo: montarResumo(s) };
}

function montarResumo(s: Sintegra): ResumoSintegra {
  const cab = s.cabecalho;
  const MOD: Record<string, string> = { '55': 'NF-e', '01': 'NF modelo 1', '1A': 'NF modelo 1A', '04': 'NF de produtor', '06': 'Conta de energia', '21': 'Comunicação', '22': 'Telecomunicação' };
  // Uma nota tem um 50 por CFOP/alíquota: agrupa por nota
  const notas = new Map<string, { chave: string; rotulo: string; cancelada: boolean; valor: number }>();
  for (const d of s.r50) {
    const k = `${d.cnpj}|${d.modelo}|${d.serie}|${d.numero}|${d.emitente}|${d.cfop[0]}`;
    const oper = /^[123]/.test(d.cfop) ? 'entrada' : 'saída';
    const g = notas.get(k) ?? { chave: `${d.modelo}-${oper}`, rotulo: `${MOD[d.modelo] ?? `Modelo ${d.modelo}`} de ${oper}`, cancelada: CANCELADO_SINTEGRA.has(d.situacao), valor: 0 };
    g.valor = r2(g.valor + d.valor);
    notas.set(k, g);
  }
  const grupos = new Map<string, { chave: string; rotulo: string; qtd: number; canceladas: number; valor: number }>();
  for (const n of notas.values()) {
    const g = grupos.get(n.chave) ?? { chave: n.chave, rotulo: n.rotulo, qtd: 0, canceladas: 0, valor: 0 };
    g.qtd++;
    if (n.cancelada) g.canceladas++; else g.valor = r2(g.valor + n.valor);
    grupos.set(n.chave, g);
  }
  if (s.r70.length) {
    grupos.set('70', { chave: '70', rotulo: 'Conhecimentos de transporte', qtd: s.r70.length, canceladas: s.r70.filter((x) => CANCELADO_SINTEGRA.has(x.situacao)).length, valor: r2(s.r70.filter((x) => !CANCELADO_SINTEGRA.has(x.situacao)).reduce((t2, x) => t2 + x.valor, 0)) });
  }
  const codMun = cab ? codigoMunicipio(cab.municipio, cab.uf) : null;
  return {
    tipo: 'sintegra',
    periodo: cab?.dtIni.slice(0, 7) ?? '',
    linhas: s.totalLinhas,
    empresa: cab ? { nome: cab.nome, cnpj: cab.cnpj, ie: cab.ie, uf: cab.uf, municipio: cab.municipio, codMun } : null,
    finalidade: { codigo: cab?.finalidade ?? '', texto: FINALIDADE[cab?.finalidade ?? ''] ?? '—' },
    convenio: cab?.convenio ?? '',
    natureza: cab?.natureza ?? '',
    documentos: [...grupos.values()].sort((a, b) => a.chave.localeCompare(b.chave)),
    nfce: {
      registros: s.r61.length,
      notas: s.r61.reduce((t2, r) => t2 + Math.max(0, r.final - r.inicial + 1), 0),
      valor: r2(s.r61.reduce((t2, r) => t2 + r.valor, 0)),
      series: [...new Set(s.r61.map((r) => `${r.modelo === '65' ? 'NFC-e' : `Mod. ${r.modelo}`} série ${r.serie}`))],
    },
    ecf: { reducoes: s.r60m.length, vendaBruta: r2(s.r60m.reduce((t2, r) => t2 + r.vendaBruta, 0)) },
    st: { notas: s.r53.length, icmsRetido: r2(s.r53.reduce((t2, r) => t2 + r.icmsRetido, 0)) },
    inventario: s.r74.length ? { itens: s.r74.length, valor: r2(s.r74.reduce((t2, r) => t2 + r.valor, 0)) } : null,
    produtos: s.r75.size,
    declaracoes: s.r88.map((r) => ({ subtipo: r.subtipo, texto: r.texto })),
  };
}
