/**
 * Leitor e validador do SPED Fiscal (EFD ICMS/IPI), leiaute do Guia Prático 3.2.x.
 *
 * Lê o arquivo texto (|REG|campo|...|), monta um resumo (cadastro, documentos, apuração)
 * e aponta problemas estruturais e de consistência que o PVA também apontaria ou que
 * costumam dar diferença na apuração. Não altera o arquivo.
 */

export type Nivel = 'erro' | 'alerta' | 'info';

export interface Ocorrencia {
  nivel: Nivel;
  codigo: string;
  mensagem: string;
  /** Linhas do arquivo (1 = primeira), no máximo algumas de exemplo. */
  linhas?: number[];
  quantidade?: number;
}

export interface DocC100 {
  linha: number;
  indOper: '0' | '1';
  indEmit: '0' | '1';
  codPart: string;
  codMod: string;
  codSit: string;
  serie: string;
  numero: string;
  chave: string;
  dtDoc: string; // AAAA-MM-DD
  dtES: string;
  vlDoc: number;
  vlIcms: number;
  vlIcmsSt: number;
  vlIpi: number;
  c170: number;
  c190: { cst: string; cfop: string; aliq: number; vlOpr: number; vlIcms: number; vlIcmsSt: number; vlIpi: number }[];
}

export interface DocD100 {
  linha: number;
  indOper: string;
  indEmit: string;
  codPart: string;
  codMod: string;
  codSit: string;
  serie: string;
  numero: string;
  chave: string;
  dtDoc: string;
  dtAP: string;
  vlDoc: number;
  vlIcms: number;
  d190: { cst: string; cfop: string; vlOpr: number; vlIcms: number }[];
}

export interface Participante {
  codigo: string;
  nome: string;
  cnpj: string;
  cpf: string;
  ie: string;
  codMun: string;
}

export interface Efd {
  cabecalho: {
    codVer: string; codFin: string; dtIni: string; dtFin: string; nome: string; cnpj: string; cpf: string;
    uf: string; ie: string; codMun: string; im: string; perfil: string; indAtiv: string;
  } | null;
  complemento: { fantasia: string; cep: string; endereco: string; numero: string; complemento: string; bairro: string; fone: string; email: string } | null;
  contador: { nome: string; cpf: string; crc: string; cnpj: string; fone: string; email: string; codMun: string } | null;
  participantes: Map<string, Participante>;
  qtdItens: number;
  c100: DocC100[];
  d100: DocD100[];
  e110: Record<string, number> | null;
  contagem: Map<string, number>;
  totalLinhas: number;
  temInventario: boolean;
}

export interface ResultadoEfd {
  efd: Efd;
  ocorrencias: Ocorrencia[];
  resumo: ResumoEfd;
}

export interface ResumoEfd {
  periodo: string; // AAAA-MM
  empresa: { nome: string; cnpj: string; ie: string; uf: string; codMun: string; perfil: string; fantasia: string; email: string; fone: string; cep: string; endereco: string; bairro: string } | null;
  contador: { nome: string; crc: string; email: string } | null;
  codVer: string;
  finalidade: 'original' | 'substituto';
  linhas: number;
  participantes: number;
  itens: number;
  documentos: { chave: string; rotulo: string; qtd: number; canceladas: number; valor: number }[];
  apuracao: { debitos: number; creditos: number; saldoCredorAnterior: number; recolher: number; saldoCredorTransportar: number } | null;
  apuracaoCalculada: { debitos: number; creditos: number };
  inventario: boolean;
}

const num = (v: string | undefined) => {
  if (!v) return 0;
  const n = Number(v.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const data = (v: string | undefined) => (v && /^\d{8}$/.test(v) ? `${v.slice(4, 8)}-${v.slice(2, 4)}-${v.slice(0, 2)}` : '');
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Decodifica o arquivo. O PVA gera ISO-8859-1; aceita UTF-8 e desfaz a conversão dupla (Ê → Ã‡). */
export function decodificarSped(buf: Buffer): { texto: string; codificacao: 'latin1' | 'utf8'; acentosCorrigidos: number } {
  let texto = buf.toString('utf8');
  let codificacao: 'latin1' | 'utf8' = 'utf8';
  if (texto.includes('�')) {
    texto = buf.toString('latin1');
    codificacao = 'latin1';
  }
  // UTF-8 lido como Latin-1 e salvo de novo em UTF-8: "Ã" seguido de caractere 0x80–0xBF
  let acentosCorrigidos = 0;
  texto = texto.replace(/[ÂÃ][\u0080-¿]/g, (par) => {
    const b = Buffer.from(par, 'latin1').toString('utf8');
    if (b.length === 1 && !b.includes('�')) { acentosCorrigidos++; return b; }
    return par;
  });
  return { texto, codificacao, acentosCorrigidos };
}

export function cnpjValido(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (base: string) => {
    let soma = 0; let peso = base.length - 7;
    for (const d of base) { soma += Number(d) * peso; peso = peso === 2 ? 9 : peso - 1; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
}

/** DV da chave de acesso (módulo 11, pesos 2..9). */
export function chaveValida(ch: string): boolean {
  if (!/^\d{44}$/.test(ch)) return false;
  let soma = 0; let peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(ch[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return (r < 2 ? 0 : 11 - r) === Number(ch[43]);
}

const CANCELADOS = new Set(['02', '03', '04', '05']);

/** Lê o texto do SPED Fiscal. */
export function lerEfd(texto: string): { efd: Efd; malformadas: number[] } {
  const efd: Efd = {
    cabecalho: null, complemento: null, contador: null, participantes: new Map(), qtdItens: 0,
    c100: [], d100: [], e110: null, contagem: new Map(), totalLinhas: 0, temInventario: false,
  };
  const malformadas: number[] = [];
  const linhas = texto.split(/\r?\n/);
  if (linhas.length && linhas[linhas.length - 1] === '') linhas.pop();
  efd.totalLinhas = linhas.length;
  let docC: DocC100 | null = null;
  let docD: DocD100 | null = null;

  linhas.forEach((bruta, i) => {
    const n = i + 1;
    const l = bruta.trimEnd();
    if (!l.startsWith('|') || !l.endsWith('|') || l.length < 6) { malformadas.push(n); return; }
    const f = l.slice(1, -1).split('|');
    const reg = f[0];
    efd.contagem.set(reg, (efd.contagem.get(reg) ?? 0) + 1);
    switch (reg) {
      case '0000':
        efd.cabecalho = {
          codVer: f[1], codFin: f[2], dtIni: data(f[3]), dtFin: data(f[4]), nome: f[5], cnpj: f[6], cpf: f[7],
          uf: f[8], ie: f[9], codMun: f[10], im: f[11], perfil: f[13], indAtiv: f[14],
        };
        break;
      case '0005':
        efd.complemento = { fantasia: f[1], cep: f[2], endereco: f[3], numero: f[4], complemento: f[5], bairro: f[6], fone: f[7], email: f[9] ?? '' };
        break;
      case '0100':
        efd.contador = { nome: f[1], cpf: f[2], crc: f[3], cnpj: f[4], fone: f[10] ?? '', email: f[12] ?? '', codMun: f[13] ?? '' };
        break;
      case '0150':
        efd.participantes.set(f[1], { codigo: f[1], nome: f[2], cnpj: f[4] ?? '', cpf: f[5] ?? '', ie: f[6] ?? '', codMun: f[7] ?? '' });
        break;
      case '0200':
        efd.qtdItens++;
        break;
      case 'C100':
        docC = {
          linha: n, indOper: f[1] as '0' | '1', indEmit: f[2] as '0' | '1', codPart: f[3], codMod: f[4], codSit: f[5], serie: f[6], numero: f[7],
          chave: f[8] ?? '', dtDoc: data(f[9]), dtES: data(f[10]), vlDoc: num(f[11]), vlIcms: num(f[21]), vlIcmsSt: num(f[23]), vlIpi: num(f[24]),
          c170: 0, c190: [],
        };
        efd.c100.push(docC);
        break;
      case 'C170':
        if (docC) docC.c170++;
        break;
      case 'C190':
        if (docC) docC.c190.push({ cst: f[1], cfop: f[2], aliq: num(f[3]), vlOpr: num(f[4]), vlIcms: num(f[6]), vlIcmsSt: num(f[8]), vlIpi: num(f[10]) });
        break;
      case 'D100':
        docC = null;
        docD = {
          linha: n, indOper: f[1], indEmit: f[2], codPart: f[3], codMod: f[4], codSit: f[5], serie: f[6], numero: f[8], chave: f[9] ?? '',
          dtDoc: data(f[10]), dtAP: data(f[11]), vlDoc: num(f[14]), vlIcms: num(f[19]), d190: [],
        };
        efd.d100.push(docD);
        break;
      case 'D190':
        if (docD) docD.d190.push({ cst: f[1], cfop: f[2], vlOpr: num(f[4]), vlIcms: num(f[6]) });
        break;
      case 'E110': {
        const nomes = ['VL_TOT_DEBITOS', 'VL_AJ_DEBITOS', 'VL_TOT_AJ_DEBITOS', 'VL_ESTORNOS_CRED', 'VL_TOT_CREDITOS', 'VL_AJ_CREDITOS',
          'VL_TOT_AJ_CREDITOS', 'VL_ESTORNOS_DEB', 'VL_SLD_CREDOR_ANT', 'VL_SLD_APURADO', 'VL_TOT_DED', 'VL_ICMS_RECOLHER',
          'VL_SLD_CREDOR_TRANSPORTAR', 'DEB_ESP'];
        efd.e110 = Object.fromEntries(nomes.map((k, j) => [k, num(f[j + 1])]));
        break;
      }
      case 'H005':
        efd.temInventario = true;
        break;
      default:
        if (reg.endsWith('990') || reg.endsWith('001')) { docC = null; docD = null; }
    }
  });
  return { efd, malformadas };
}

function ultimoDia(iso: string) {
  const [a, m] = iso.split('-').map(Number);
  return new Date(a, m, 0).getDate();
}

/** Lê, valida e resume. */
export function analisarEfd(buf: Buffer): ResultadoEfd {
  const oc: Ocorrencia[] = [];
  const add = (nivel: Nivel, codigo: string, mensagem: string, linhas: number[] = [], quantidade?: number) =>
    oc.push({ nivel, codigo, mensagem, ...(linhas.length ? { linhas: linhas.slice(0, 10) } : {}), ...(quantidade !== undefined ? { quantidade } : {}) });

  const dec = decodificarSped(buf);
  if (dec.acentosCorrigidos) {
    add('alerta', 'ACENTOS', `O arquivo foi convertido de codificação duas vezes: ${dec.acentosCorrigidos} caractere(s) acentuado(s) estavam corrompidos (ex.: "INDEPENDÃNCIA"). O PVA grava em ISO-8859-1; gere o arquivo de novo sem converter para UTF-8.`, [], dec.acentosCorrigidos);
  }
  if (dec.codificacao === 'utf8' && /[^\x00-\x7F]/.test(dec.texto)) {
    add('info', 'CODIFICACAO', 'Arquivo gravado em UTF-8 com acentos. O PVA costuma ler ISO-8859-1: confira se nomes e endereços aparecem com acento correto depois de importar.');
  }
  const { efd, malformadas } = lerEfd(dec.texto);
  if (malformadas.length) add('erro', 'LINHA', 'Linhas fora do formato |REG|...| (devem começar e terminar com "|").', malformadas, malformadas.length);

  // EFD-Contribuições (PIS/COFINS) tem 0000 com outro leiaute e blocos A, F, M e P: não é lido aqui
  if (['0110', 'A001', 'F001', 'M001', 'P001'].some((r) => efd.contagem.has(r))) {
    add('erro', 'CONTRIBUICOES', 'Este arquivo é o SPED Contribuições (EFD PIS/COFINS), não o SPED Fiscal (EFD ICMS/IPI). A leitura do SPED Contribuições ainda não está disponível.');
    efd.cabecalho = null;
    return { efd, ocorrencias: oc, resumo: montarResumo(efd) };
  }
  const cab = efd.cabecalho;
  if (!cab) {
    add('erro', '0000', 'Registro 0000 não encontrado: o arquivo não parece ser um SPED Fiscal (EFD ICMS/IPI).');
    return { efd, ocorrencias: oc, resumo: montarResumo(efd) };
  }
  // 0000
  if (!cab.dtIni || !cab.dtFin || cab.dtIni.slice(0, 7) !== cab.dtFin.slice(0, 7)) add('erro', '0000_PERIODO', 'DT_INI e DT_FIN do 0000 precisam estar no mesmo mês.');
  else {
    if (!cab.dtIni.endsWith('-01')) add('alerta', '0000_INICIO', 'DT_INI não é o dia 1: só é aceito em início de atividade.');
    if (Number(cab.dtFin.slice(8)) !== ultimoDia(cab.dtFin)) add('alerta', '0000_FIM', 'DT_FIN não é o último dia do mês: só é aceito em encerramento de atividade.');
  }
  if (cab.cnpj && !cnpjValido(cab.cnpj)) add('erro', '0000_CNPJ', `CNPJ do 0000 (${cab.cnpj}) com dígito verificador inválido.`);
  if (!['A', 'B', 'C'].includes(cab.perfil)) add('erro', '0000_PERFIL', `Perfil "${cab.perfil}" inválido (A, B ou C).`);
  if (cab.codFin === '1') add('info', '0000_SUBSTITUTO', 'Arquivo substituto (COD_FIN 1). Depois do prazo, a retificação exige autorização da SEFAZ.');

  // Totais do bloco 9
  const qtd9999 = Number(dec.texto.match(/^\|9999\|(\d+)\|/m)?.[1] ?? NaN);
  if (!Number.isFinite(qtd9999)) add('erro', '9999', 'Registro 9999 (encerramento do arquivo) não encontrado.');
  else if (qtd9999 !== efd.totalLinhas) add('erro', '9999', `O 9999 informa ${qtd9999} linhas, mas o arquivo tem ${efd.totalLinhas}.`);
  const informado9900 = new Map<string, number>();
  for (const m of dec.texto.matchAll(/^\|9900\|([^|]+)\|(\d+)\|/gm)) informado9900.set(m[1], Number(m[2]));
  const div9900: string[] = [];
  for (const [reg, q] of efd.contagem) {
    const inf = informado9900.get(reg);
    if (inf === undefined) div9900.push(`${reg}: ${q} no arquivo, sem 9900`);
    else if (inf !== q) div9900.push(`${reg}: 9900 diz ${inf}, arquivo tem ${q}`);
  }
  for (const [reg, q] of informado9900) if (!efd.contagem.has(reg)) div9900.push(`${reg}: 9900 diz ${q}, arquivo não tem`);
  if (div9900.length) add('erro', '9900', `Totalizadores 9900 não batem: ${div9900.slice(0, 8).join('; ')}${div9900.length > 8 ? '…' : ''}`, [], div9900.length);
  // Encerramento de blocos (x990 = linhas do bloco, incluindo abertura e encerramento)
  const linhasBloco = new Map<string, number>();
  for (const [reg, q] of efd.contagem) linhasBloco.set(reg[0], (linhasBloco.get(reg[0]) ?? 0) + q);
  for (const m of dec.texto.matchAll(/^\|([0-9A-Z])990\|(\d+)\|/gm)) {
    const b = m[1]; const inf = Number(m[2]);
    const real = linhasBloco.get(b) ?? 0;
    if (inf !== real) add('erro', `${b}990`, `O ${b}990 informa ${inf} linhas no bloco ${b}, mas o bloco tem ${real}.`);
  }

  // Participantes
  const cnpjRuim = [...efd.participantes.values()].filter((p) => p.cnpj && !cnpjValido(p.cnpj));
  if (cnpjRuim.length) add('erro', '0150_CNPJ', `${cnpjRuim.length} participante(s) com CNPJ inválido (ex.: ${cnpjRuim.slice(0, 3).map((p) => `${p.codigo} ${p.cnpj}`).join(', ')}).`, [], cnpjRuim.length);

  // Documentos (C100)
  const semChave: number[] = []; const chaveRuim: number[] = []; const chaveIncoerente: number[] = [];
  const foraPeriodo: number[] = []; const semC190: number[] = []; const somaDif: number[] = []; const semPart: number[] = [];
  const vistas = new Map<string, number>(); const duplicadas: number[] = [];
  for (const d of efd.c100) {
    const cancelado = CANCELADOS.has(d.codSit);
    const eletronico = d.codMod === '55' || d.codMod === '65';
    if (eletronico && d.codSit !== '05') {
      if (!d.chave) semChave.push(d.linha);
      else if (!chaveValida(d.chave)) chaveRuim.push(d.linha);
      else {
        const modChave = d.chave.slice(20, 22); const serChave = String(Number(d.chave.slice(22, 25))); const numChave = String(Number(d.chave.slice(25, 34)));
        const cnpjChave = d.chave.slice(6, 20);
        if (modChave !== d.codMod || numChave !== String(Number(d.numero)) || (d.serie && serChave !== String(Number(d.serie))) || (d.indEmit === '0' && cnpjChave !== cab.cnpj)) chaveIncoerente.push(d.linha);
        if (vistas.has(d.chave)) duplicadas.push(d.linha); else vistas.set(d.chave, d.linha);
      }
    }
    if (cancelado) continue;
    if (d.dtDoc && cab.dtFin && d.dtDoc > cab.dtFin) foraPeriodo.push(d.linha);
    if (d.dtES && cab.dtFin && (d.dtES > cab.dtFin || (d.dtDoc && d.dtES < d.dtDoc))) foraPeriodo.push(d.linha);
    if (!d.c190.length) semC190.push(d.linha);
    else {
      const soma = r2(d.c190.reduce((t, x) => t + x.vlOpr, 0));
      if (Math.abs(soma - d.vlDoc) > 0.05) somaDif.push(d.linha);
    }
    if (d.codMod !== '65' && d.codPart && !efd.participantes.has(d.codPart)) semPart.push(d.linha);
  }
  if (semChave.length) add('erro', 'C100_CHAVE', 'NF-e/NFC-e sem chave de acesso (obrigatória desde 04/2012, exceto inutilizadas).', semChave, semChave.length);
  if (chaveRuim.length) add('erro', 'C100_CHAVE_DV', 'Chave de acesso com dígito verificador inválido.', chaveRuim, chaveRuim.length);
  if (chaveIncoerente.length) add('erro', 'C100_CHAVE_DADOS', 'Modelo, série, número ou CNPJ do emitente não batem com a chave de acesso.', chaveIncoerente, chaveIncoerente.length);
  if (duplicadas.length) add('erro', 'C100_DUPLICADO', 'A mesma chave de acesso aparece em mais de um C100.', duplicadas, duplicadas.length);
  if (foraPeriodo.length) add('erro', 'C100_DATA', 'Data do documento ou de entrada/saída fora do período do arquivo (ou entrada antes da emissão).', foraPeriodo, foraPeriodo.length);
  if (semC190.length) add('erro', 'C100_SEM_C190', 'Documento regular sem C190 (registro analítico obrigatório).', semC190, semC190.length);
  if (somaDif.length) add('alerta', 'C190_VL_OPR', 'Soma do VL_OPR dos C190 diferente do VL_DOC do C100 (mais de R$ 0,05).', somaDif, somaDif.length);
  if (semPart.length) add('erro', 'C100_PARTICIPANTE', 'COD_PART do documento não está no cadastro 0150.', semPart, semPart.length);
  const entradasSemItens = efd.c100.filter((d) => d.indOper === '0' && d.indEmit === '1' && d.codMod === '55' && !CANCELADOS.has(d.codSit) && d.c170 === 0);
  if (entradasSemItens.length) add('alerta', 'C170_ENTRADA', 'NF-e de entrada de terceiros sem itens (C170 é obrigatório nas entradas).', entradasSemItens.map((d) => d.linha), entradasSemItens.length);

  // Apuração (E110) × documentos
  const calc = apuracaoCalculada(efd);
  if (efd.e110) {
    const e = efd.e110;
    if (Math.abs(r2(e.VL_TOT_DEBITOS - calc.debitos)) > 0.05) {
      add('alerta', 'E110_DEBITOS', `VL_TOT_DEBITOS do E110 (${e.VL_TOT_DEBITOS.toFixed(2)}) difere da soma do ICMS das saídas nos C190/D190 (${calc.debitos.toFixed(2)}).`);
    }
    if (Math.abs(r2(e.VL_TOT_CREDITOS - calc.creditos)) > 0.05) {
      add('alerta', 'E110_CREDITOS', `VL_TOT_CREDITOS do E110 (${e.VL_TOT_CREDITOS.toFixed(2)}) difere da soma do ICMS das entradas nos C190/D190 (${calc.creditos.toFixed(2)}).`);
    }
  } else if (cab) {
    add('erro', 'E110', 'Registro E110 (apuração do ICMS) não encontrado.');
  }
  if (!efd.d100.length && !(efd.contagem.get('D001'))) add('erro', 'D001', 'Bloco D ausente.');

  return { efd, ocorrencias: oc, resumo: montarResumo(efd) };
}

/** Débitos e créditos pelo ICMS dos registros analíticos (C190 e D190) com data no período. */
export function apuracaoCalculada(efd: Efd) {
  let debitos = 0; let creditos = 0;
  const ini = efd.cabecalho?.dtIni ?? ''; const fim = efd.cabecalho?.dtFin ?? '';
  const noPeriodo = (dt: string) => !dt || (dt >= ini && dt <= fim);
  for (const d of efd.c100) {
    if (CANCELADOS.has(d.codSit) || !noPeriodo(d.dtES || d.dtDoc)) continue;
    for (const x of d.c190) {
      if (/^[567]/.test(x.cfop)) debitos += x.vlIcms;
      else if (/^[123]/.test(x.cfop)) creditos += x.vlIcms;
    }
  }
  for (const d of efd.d100) {
    if (CANCELADOS.has(d.codSit) || !noPeriodo(d.dtAP || d.dtDoc)) continue;
    for (const x of d.d190) {
      if (/^[567]/.test(x.cfop)) debitos += x.vlIcms;
      else if (/^[123]/.test(x.cfop)) creditos += x.vlIcms;
    }
  }
  return { debitos: r2(debitos), creditos: r2(creditos) };
}

function montarResumo(efd: Efd): ResumoEfd {
  const cab = efd.cabecalho;
  const grupos = new Map<string, { chave: string; rotulo: string; qtd: number; canceladas: number; valor: number }>();
  const MOD: Record<string, string> = { '55': 'NF-e', '65': 'NFC-e', '57': 'CT-e', '67': 'CT-e OS', '01': 'NF modelo 1' };
  const somar = (chave: string, rotulo: string, cancelada: boolean, valor: number) => {
    const g = grupos.get(chave) ?? { chave, rotulo, qtd: 0, canceladas: 0, valor: 0 };
    g.qtd++; if (cancelada) g.canceladas++; else g.valor = r2(g.valor + valor);
    grupos.set(chave, g);
  };
  for (const d of efd.c100) {
    const tipo = MOD[d.codMod] ?? `Modelo ${d.codMod}`;
    const oper = d.indOper === '0' ? 'entrada' : 'saída';
    somar(`${d.codMod}-${d.indOper}-${d.indEmit}`, `${tipo} de ${oper}${d.indEmit === '0' && d.indOper === '0' ? ' (emissão própria)' : d.indEmit === '1' && d.indOper === '1' ? ' (terceiros)' : ''}`, CANCELADOS.has(d.codSit), d.vlDoc);
  }
  for (const d of efd.d100) somar(`D${d.codMod}-${d.indOper}`, `${MOD[d.codMod] ?? d.codMod} ${d.indOper === '0' ? 'tomado' : 'prestado'}`, CANCELADOS.has(d.codSit), d.vlDoc);
  const e = efd.e110;
  const comp = efd.complemento;
  return {
    periodo: cab?.dtIni.slice(0, 7) ?? '',
    empresa: cab ? {
      nome: cab.nome, cnpj: cab.cnpj, ie: cab.ie, uf: cab.uf, codMun: cab.codMun, perfil: cab.perfil,
      fantasia: comp?.fantasia ?? '', email: comp?.email ?? '', fone: comp?.fone ?? '', cep: comp?.cep ?? '',
      endereco: comp ? [comp.endereco, comp.numero, comp.complemento].filter(Boolean).join(', ') : '', bairro: comp?.bairro ?? '',
    } : null,
    contador: efd.contador ? { nome: efd.contador.nome, crc: efd.contador.crc, email: efd.contador.email } : null,
    codVer: cab?.codVer ?? '',
    finalidade: cab?.codFin === '1' ? 'substituto' : 'original',
    linhas: efd.totalLinhas,
    participantes: efd.participantes.size,
    itens: efd.qtdItens,
    documentos: [...grupos.values()].sort((a, b) => a.chave.localeCompare(b.chave)),
    apuracao: e ? {
      debitos: e.VL_TOT_DEBITOS, creditos: e.VL_TOT_CREDITOS, saldoCredorAnterior: e.VL_SLD_CREDOR_ANT,
      recolher: e.VL_ICMS_RECOLHER, saldoCredorTransportar: e.VL_SLD_CREDOR_TRANSPORTAR,
    } : null,
    apuracaoCalculada: apuracaoCalculada(efd),
    inventario: efd.temInventario,
  };
}
