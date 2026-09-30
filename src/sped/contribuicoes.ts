/**
 * Leitor e validador do SPED Contribuições (EFD PIS/COFINS), leiaute do Guia Prático (0000 com COD_VER 006).
 *
 * Monta um resumo (regime, receitas por CST/CFOP, apuração M200/M600) e aponta problemas de estrutura
 * e de classificação que costumam zerar ou distorcer o PIS/COFINS (ex.: venda com CST 49).
 * Também cruza, nota a nota, as saídas com o SPED Fiscal do mesmo mês.
 */
import { CANCELADOS, chaveValida, cnpjValido, data, decodificarSped, Efd, Nivel, num, Ocorrencia, ultimoDia, validarEstrutura } from './efd';

export interface DocContrib {
  linha: number;
  indOper: string;
  indEmit: string;
  codMod: string;
  codSit: string;
  numero: string;
  chave: string;
  dtDoc: string;
  vlDoc: number;
  vlPis: number;
  vlCofins: number;
  itens: number; // C170 + C175
  vlItens: number; // soma da receita dos C170/C175 (valor menos desconto)
}

/** Uma linha de receita (ou operação de saída) com a classificação de PIS/COFINS. */
export interface LinhaReceita {
  reg: string;
  linha: number;
  cfop: string;
  cstPis: string;
  cstCofins: string;
  valor: number;
  vlPis: number;
  vlCofins: number;
}

export interface EfdContrib {
  cabecalho: {
    codVer: string; tipoEscrit: string; numRecAnterior: string; dtIni: string; dtFin: string; nome: string; cnpj: string;
    uf: string; codMun: string; indNatPj: string; indAtiv: string;
  } | null;
  regime: { codIncTrib: string; indAproCred: string; codTipoCont: string; indRegCum: string } | null;
  contador: { nome: string; cpf: string; crc: string; cnpj: string; fone: string; email: string; codMun: string } | null;
  estabelecimentos: { cnpj: string; nome: string; uf: string; ie: string; codMun: string }[];
  c100: DocContrib[];
  receitas: LinhaReceita[];
  m200: number[] | null;
  m600: number[] | null;
  m400: Map<string, number>;
  m800: Map<string, number>;
  contagem: Map<string, number>;
  totalLinhas: number;
}

export interface ResumoContrib {
  tipo: 'efd_contribuicoes';
  periodo: string;
  codVer: string;
  finalidade: 'original' | 'retificadora';
  linhas: number;
  empresa: { nome: string; cnpj: string; ie: string; uf: string; codMun: string } | null;
  contador: { nome: string; crc: string; email: string } | null;
  regime: { codigo: string; texto: string; criterio: string | null } | null;
  estabelecimentos: number;
  documentos: { chave: string; rotulo: string; qtd: number; canceladas: number; valor: number }[];
  receitaBruta: number;
  receitas: { cst: string; descricao: string; valor: number; pis: number; cofins: number }[];
  porCfop: { cfop: string; cst: string; valor: number }[];
  apuracao: {
    pis: { contribuicao: number; creditos: number; recolher: number } | null;
    cofins: { contribuicao: number; creditos: number; recolher: number } | null;
  };
  calculada: { pis: number; cofins: number };
  naoAnalisados: string[];
}

export interface ResultadoContrib {
  efd: EfdContrib;
  ocorrencias: Ocorrencia[];
  resumo: ResumoContrib;
}

export const CST_PIS: Record<string, string> = {
  '01': 'Tributada (alíquota básica)', '02': 'Tributada (alíquota diferenciada)', '03': 'Tributada (por unidade)',
  '04': 'Monofásica (revenda a alíquota zero)', '05': 'Substituição tributária', '06': 'Alíquota zero', '07': 'Isenta',
  '08': 'Sem incidência', '09': 'Suspensão', '49': 'Outras operações de saída', '99': 'Outras operações',
};
const TRIBUTADAS = new Set(['01', '02', '03', '05']);
/** Receitas que vão para o M400/M800 (isentas, alíquota zero, monofásicas, sem incidência, suspensão). */
const M400_CST = new Set(['04', '06', '07', '08', '09']);
/** CFOP de venda de mercadoria ou produção (5/6/7.1xx e as vendas com ST 5/6.401, 402, 403 e 405). Devoluções e remessas ficam de fora. */
export const cfopVenda = (cfop: string) => /^[567]1\d\d$/.test(cfop) || /^[56]40[1235]$/.test(cfop);
const r2 = (n: number) => Math.round(n * 100) / 100;
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** O arquivo é SPED Contribuições? (0110 e blocos A, F, M só existem nele.) */
export function ehContribuicoes(buf: Buffer | string): boolean {
  const t = typeof buf === 'string' ? buf : buf.subarray(0, 4_000_000).toString('latin1');
  return /^\|(0110|A001|F001|M001)\|/m.test(t);
}

/** Registros de receita que este leitor ainda não detalha (entram só na estrutura). */
const OUTROS_RECEITA = ['C381', 'C385', 'C481', 'C485', 'C491', 'C495', 'C601', 'C605', 'D201', 'D205', 'D300', 'D350', 'D601', 'D605', 'F200', 'F510', 'F560'];

export function lerContribuicoes(texto: string): { efd: EfdContrib; malformadas: number[] } {
  const efd: EfdContrib = {
    cabecalho: null, regime: null, contador: null, estabelecimentos: [], c100: [], receitas: [], m200: null, m600: null,
    m400: new Map(), m800: new Map(), contagem: new Map(), totalLinhas: 0,
  };
  const malformadas: number[] = [];
  const linhas = texto.split(/\r?\n/);
  if (linhas.length && linhas[linhas.length - 1] === '') linhas.pop();
  efd.totalLinhas = linhas.length;
  let doc: DocContrib | null = null;
  let a100Saida = false;
  let pisC181: LinhaReceita[] = [];

  linhas.forEach((bruta, i) => {
    const n = i + 1;
    const l = bruta.trimEnd();
    if (!l.startsWith('|') || !l.endsWith('|') || l.length < 6) { malformadas.push(n); return; }
    const f = l.slice(1, -1).split('|');
    const reg = f[0];
    efd.contagem.set(reg, (efd.contagem.get(reg) ?? 0) + 1);
    const receita = (x: Omit<LinhaReceita, 'reg' | 'linha'>) => efd.receitas.push({ reg, linha: n, ...x });
    const saidaValida = () => doc && doc.indOper === '1' && !CANCELADOS.has(doc.codSit);
    switch (reg) {
      case '0000':
        efd.cabecalho = {
          codVer: f[1], tipoEscrit: f[2], numRecAnterior: f[4] ?? '', dtIni: data(f[5]), dtFin: data(f[6]), nome: f[7], cnpj: f[8],
          uf: f[9], codMun: f[10], indNatPj: f[12] ?? '', indAtiv: f[13] ?? '',
        };
        break;
      case '0100':
        efd.contador = { nome: f[1], cpf: f[2], crc: f[3], cnpj: f[4] ?? '', fone: f[10] ?? '', email: f[12] ?? '', codMun: f[13] ?? '' };
        break;
      case '0110':
        efd.regime = { codIncTrib: f[1] ?? '', indAproCred: f[2] ?? '', codTipoCont: f[3] ?? '', indRegCum: f[4] ?? '' };
        break;
      case '0140':
        efd.estabelecimentos.push({ nome: f[2], cnpj: f[3], uf: f[4], ie: f[5] ?? '', codMun: f[6] ?? '' });
        break;
      case 'C100':
        doc = {
          linha: n, indOper: f[1], indEmit: f[2], codMod: f[4], codSit: f[5], numero: f[7], chave: f[8] ?? '', dtDoc: data(f[9]),
          vlDoc: num(f[11]), vlPis: num(f[25]), vlCofins: num(f[26]), itens: 0, vlItens: 0,
        };
        efd.c100.push(doc);
        break;
      case 'C170':
        if (doc) {
          doc.itens++;
          const v = r2(num(f[6]) - num(f[7]));
          doc.vlItens = r2(doc.vlItens + v);
          if (saidaValida()) receita({ cfop: f[10], cstPis: f[24], cstCofins: f[30], valor: v, vlPis: num(f[29]), vlCofins: num(f[35]) });
        }
        break;
      case 'C175':
        if (doc) {
          doc.itens++;
          const v = r2(num(f[2]) - num(f[3]));
          doc.vlItens = r2(doc.vlItens + v);
          if (saidaValida()) receita({ cfop: f[1], cstPis: f[4], cstCofins: f[10], valor: v, vlPis: num(f[9]), vlCofins: num(f[15]) });
        }
        break;
      case 'C180':
        doc = null;
        pisC181 = [];
        break;
      case 'C181': { // NFC-e consolidada por item: lado do PIS
        const x: LinhaReceita = { reg, linha: n, cfop: f[2], cstPis: f[1], cstCofins: '', valor: r2(num(f[3]) - num(f[4])), vlPis: num(f[9]), vlCofins: 0 };
        pisC181.push(x);
        efd.receitas.push(x);
        break;
      }
      case 'C185': { // lado da COFINS: completa a linha do C181 correspondente (mesmo CFOP e valor)
        const par = pisC181.find((x) => !x.cstCofins && x.cfop === f[2] && Math.abs(x.valor - r2(num(f[3]) - num(f[4]))) < 0.01);
        if (par) { par.cstCofins = f[1]; par.vlCofins = num(f[9]); } else {
          efd.receitas.push({ reg, linha: n, cfop: f[2], cstPis: '', cstCofins: f[1], valor: 0, vlPis: 0, vlCofins: num(f[9]) });
        }
        break;
      }
      case 'A100':
        doc = null;
        a100Saida = f[1] === '1' && !CANCELADOS.has(f[4] ?? '');
        break;
      case 'A170':
        if (a100Saida) receita({ cfop: '', cstPis: f[8], cstCofins: f[12], valor: r2(num(f[4]) - num(f[5])), vlPis: num(f[11]), vlCofins: num(f[15]) });
        break;
      case 'F100':
        if (f[1] === '1' || f[1] === '2') receita({ cfop: '', cstPis: f[6], cstCofins: f[10], valor: num(f[5]), vlPis: num(f[9]), vlCofins: num(f[13]) });
        break;
      case 'F500':
      case 'F550':
        receita({ cfop: f[13] ?? '', cstPis: f[2], cstCofins: f[7], valor: r2(num(f[1]) - num(f[3])), vlPis: num(f[6]), vlCofins: num(f[11]) });
        break;
      case 'M200':
        efd.m200 = f.slice(1).map(num);
        break;
      case 'M600':
        efd.m600 = f.slice(1).map(num);
        break;
      case 'M400':
        efd.m400.set(f[1], r2((efd.m400.get(f[1]) ?? 0) + num(f[2])));
        break;
      case 'M800':
        efd.m800.set(f[1], r2((efd.m800.get(f[1]) ?? 0) + num(f[2])));
        break;
      default:
        if (reg.endsWith('990') || reg.endsWith('001') || reg.endsWith('010')) { doc = null; a100Saida = false; }
    }
  });
  return { efd, malformadas };
}

/** PIS e COFINS das receitas tributadas (CST 01, 02, 03 e 05). */
function calcular(efd: EfdContrib) {
  let pis = 0; let cofins = 0;
  for (const x of efd.receitas) {
    if (TRIBUTADAS.has(x.cstPis)) pis += x.vlPis;
    if (TRIBUTADAS.has(x.cstCofins)) cofins += x.vlCofins;
  }
  return { pis: r2(pis), cofins: r2(cofins) };
}

/** Contribuição do período no M200/M600: não cumulativa (campo 1) + cumulativa (campo 8). */
const contribuicaoPeriodo = (m: number[] | null) => (m ? r2((m[0] ?? 0) + (m[7] ?? 0)) : null);

export function analisarContribuicoes(buf: Buffer): ResultadoContrib {
  const oc: Ocorrencia[] = [];
  const add = (nivel: Nivel, codigo: string, mensagem: string, linhas: number[] = [], quantidade?: number) =>
    oc.push({ nivel, codigo, mensagem, ...(linhas.length ? { linhas: linhas.slice(0, 10) } : {}), ...(quantidade !== undefined ? { quantidade } : {}) });

  const dec = decodificarSped(buf);
  if (dec.acentosCorrigidos) add('alerta', 'ACENTOS', `O arquivo foi convertido de codificação duas vezes: ${dec.acentosCorrigidos} caractere(s) acentuado(s) estavam corrompidos. O PVA grava em ISO-8859-1; gere o arquivo de novo sem converter para UTF-8.`, [], dec.acentosCorrigidos);
  if (dec.codificacao === 'utf8' && /[^\x00-\x7F]/.test(dec.texto)) add('info', 'CODIFICACAO', 'Arquivo gravado em UTF-8 com acentos. O PVA costuma ler ISO-8859-1: confira se nomes e endereços aparecem com acento correto depois de importar.');
  const { efd, malformadas } = lerContribuicoes(dec.texto);
  if (malformadas.length) add('erro', 'LINHA', 'Linhas fora do formato |REG|...| (devem começar e terminar com "|").', malformadas, malformadas.length);
  const cab = efd.cabecalho;
  if (!cab || !ehContribuicoes(dec.texto)) {
    add('erro', '0000', 'O arquivo não parece ser um SPED Contribuições (EFD PIS/COFINS).');
    efd.cabecalho = null;
    return { efd, ocorrencias: oc, resumo: montarResumo(efd) };
  }

  // 0000 e 0110
  if (!cab.dtIni || !cab.dtFin || cab.dtIni.slice(0, 7) !== cab.dtFin.slice(0, 7)) add('erro', '0000_PERIODO', 'DT_INI e DT_FIN do 0000 precisam estar no mesmo mês.');
  else if (!cab.dtIni.endsWith('-01') || Number(cab.dtFin.slice(8)) !== ultimoDia(cab.dtFin)) add('alerta', '0000_PERIODO_PARCIAL', 'O período não é o mês inteiro: só é aceito em início ou encerramento de atividade.');
  if (!cnpjValido(cab.cnpj)) add('erro', '0000_CNPJ', `CNPJ do 0000 (${cab.cnpj}) com dígito verificador inválido.`);
  if (cab.tipoEscrit === '1' && !cab.numRecAnterior) add('erro', '0000_RECIBO', 'Escrituração retificadora (TIPO_ESCRIT 1) sem o número do recibo da escrituração anterior.');
  if (cab.tipoEscrit === '1') add('info', '0000_RETIFICADORA', 'Escrituração retificadora: substitui a original do mesmo período.');
  const reg = efd.regime;
  if (!reg) add('erro', '0110', 'Registro 0110 (regime de apuração) não encontrado.');
  else {
    if (!['1', '2', '3'].includes(reg.codIncTrib)) add('erro', '0110_REGIME', `COD_INC_TRIB "${reg.codIncTrib}" inválido (1 não cumulativo, 2 cumulativo, 3 ambos).`);
    if (reg.codIncTrib === '2' && !reg.indRegCum) add('alerta', '0110_IND_REG_CUM', 'Regime cumulativo sem o critério de escrituração (IND_REG_CUM do 0110: 1 caixa, 2 competência consolidada, 9 competência detalhada). O campo é exigido quando COD_INC_TRIB = 2.');
    if ((reg.codIncTrib === '1' || reg.codIncTrib === '3') && !reg.indAproCred) add('alerta', '0110_IND_APRO_CRED', 'Regime não cumulativo sem o método de apropriação de créditos comuns (IND_APRO_CRED do 0110).');
  }
  if (!efd.estabelecimentos.length) add('erro', '0140', 'Nenhum estabelecimento (0140) informado.');

  validarEstrutura(dec.texto, efd.contagem, efd.totalLinhas, add);

  // Documentos (C100)
  const chaveRuim: number[] = []; const duplicadas: number[] = []; const foraPeriodo: number[] = [];
  const vistas = new Set<string>();
  for (const d of efd.c100) {
    if ((d.codMod === '55' || d.codMod === '65') && d.chave && d.codSit !== '05') {
      if (!chaveValida(d.chave)) chaveRuim.push(d.linha);
      else if (vistas.has(d.chave)) duplicadas.push(d.linha);
      else vistas.add(d.chave);
    }
    if (!CANCELADOS.has(d.codSit) && d.dtDoc && d.dtDoc > cab.dtFin) foraPeriodo.push(d.linha);
  }
  if (chaveRuim.length) add('erro', 'C100_CHAVE_DV', 'Chave de acesso com dígito verificador inválido.', chaveRuim, chaveRuim.length);
  if (duplicadas.length) add('erro', 'C100_DUPLICADO', 'A mesma chave de acesso aparece em mais de um C100.', duplicadas, duplicadas.length);
  if (foraPeriodo.length) add('erro', 'C100_DATA', 'Documento com data depois do fim do período.', foraPeriodo, foraPeriodo.length);

  // Classificação das receitas
  const vendasSemReceita = efd.receitas.filter((x) => cfopVenda(x.cfop) && ['49', '99'].includes(x.cstPis));
  if (vendasSemReceita.length) {
    const v = r2(vendasSemReceita.reduce((t, x) => t + x.valor, 0));
    const cfops = [...new Set(vendasSemReceita.map((x) => x.cfop))].sort().join(', ');
    add('erro', 'CST_49_VENDA', `Vendas (CFOP ${cfops}) com CST ${[...new Set(vendasSemReceita.map((x) => x.cstPis))].join('/')} ("outras operações"): ${brl(v)} ficaram fora da receita e do PIS/COFINS. Venda é receita: use CST 01 (tributada), 04 (monofásica), 05 (ST), 06 (alíquota zero) etc., conforme o produto.`, vendasSemReceita.map((x) => x.linha), vendasSemReceita.length);
  }
  const saidaComCstEntrada = efd.receitas.filter((x) => /^[5-9]\d$/.test(x.cstPis) && !['49', '99'].includes(x.cstPis));
  if (saidaComCstEntrada.length) add('erro', 'CST_ENTRADA_NA_SAIDA', 'Receita com CST de entrada (50 a 98).', saidaComCstEntrada.map((x) => x.linha), saidaComCstEntrada.length);
  const cstDiferente = efd.receitas.filter((x) => x.cstPis && x.cstCofins && x.cstPis !== x.cstCofins);
  if (cstDiferente.length) add('alerta', 'CST_PIS_COFINS', 'CST do PIS diferente do CST da COFINS na mesma operação.', cstDiferente.map((x) => x.linha), cstDiferente.length);
  const tribSemValor = efd.receitas.filter((x) => ['01', '02'].includes(x.cstPis) && x.valor > 0 && x.vlPis === 0);
  if (tribSemValor.length) add('alerta', 'CST_01_SEM_PIS', 'Receita com CST tributado (01/02) e PIS zerado.', tribSemValor.map((x) => x.linha), tribSemValor.length);

  // Apuração (M200/M600) × documentos
  const calc = calcular(efd);
  const pisM = contribuicaoPeriodo(efd.m200); const cofM = contribuicaoPeriodo(efd.m600);
  if (pisM === null) add('erro', 'M200', 'Registro M200 (apuração do PIS) não encontrado.');
  else if (Math.abs(pisM - calc.pis) > 1) add('alerta', 'M200_TOTAL', `PIS apurado no M200 (${brl(pisM)}) difere do PIS das receitas tributadas nos documentos (${brl(calc.pis)}). Confira ajustes (M220) e as bases.`);
  if (cofM === null) add('erro', 'M600', 'Registro M600 (apuração da COFINS) não encontrado.');
  else if (Math.abs(cofM - calc.cofins) > 1) add('alerta', 'M600_TOTAL', `COFINS apurada no M600 (${brl(cofM)}) difere da COFINS das receitas tributadas nos documentos (${brl(calc.cofins)}).`);
  // Receitas não tributadas (04, 06, 07, 08, 09) precisam estar no M400/M800
  const porCst = new Map<string, number>();
  for (const x of efd.receitas) if (M400_CST.has(x.cstPis)) porCst.set(x.cstPis, r2((porCst.get(x.cstPis) ?? 0) + x.valor));
  for (const [cst, v] of porCst) {
    const m4 = efd.m400.get(cst) ?? 0;
    if (Math.abs(m4 - v) > 1) add('alerta', 'M400', `Receita com CST ${cst} (${CST_PIS[cst]}) de ${brl(v)} nos documentos, mas ${brl(m4)} no M400 (receitas não tributadas do PIS).`);
    const m8 = efd.m800.get(cst) ?? 0;
    if (Math.abs(m8 - v) > 1) add('alerta', 'M800', `Receita com CST ${cst} de ${brl(v)} nos documentos, mas ${brl(m8)} no M800 (receitas não tributadas da COFINS).`);
  }
  // Documento × itens (NFC-e/NF-e de saída: valor do documento × soma dos itens)
  const difItens = efd.c100.filter((d) => d.indOper === '1' && !CANCELADOS.has(d.codSit) && d.itens > 0 && Math.abs(d.vlDoc - d.vlItens) > 0.05);
  if (difItens.length) {
    const t = r2(difItens.reduce((s, d) => s + d.vlDoc - d.vlItens, 0));
    add('info', 'C100_ITENS', `${difItens.length} documento(s) de saída com valor diferente da soma dos itens (líquido de desconto): diferença total de ${brl(t)}. Pode ser frete, seguro ou outras despesas; confira se entram na receita.`, difItens.map((d) => d.linha), difItens.length);
  }
  const outros = OUTROS_RECEITA.filter((r) => efd.contagem.has(r));
  if (outros.length) add('info', 'NAO_ANALISADO', `Registros ${outros.join(', ')} entram na estrutura, mas a classificação das receitas deles ainda não é conferida.`);

  return { efd, ocorrencias: oc, resumo: montarResumo(efd) };
}

function montarResumo(efd: EfdContrib): ResumoContrib {
  const cab = efd.cabecalho;
  const MOD: Record<string, string> = { '55': 'NF-e', '65': 'NFC-e', '01': 'NF modelo 1' };
  const grupos = new Map<string, { chave: string; rotulo: string; qtd: number; canceladas: number; valor: number }>();
  for (const d of efd.c100) {
    const chave = `${d.codMod}-${d.indOper}-${d.indEmit}`;
    const g = grupos.get(chave) ?? { chave, rotulo: `${MOD[d.codMod] ?? `Modelo ${d.codMod}`} de ${d.indOper === '0' ? 'entrada' : 'saída'}${d.indOper === '0' && d.indEmit === '0' ? ' (emissão própria)' : ''}`, qtd: 0, canceladas: 0, valor: 0 };
    g.qtd++;
    if (CANCELADOS.has(d.codSit)) g.canceladas++; else g.valor = r2(g.valor + d.vlDoc);
    grupos.set(chave, g);
  }
  const porCst = new Map<string, { cst: string; descricao: string; valor: number; pis: number; cofins: number }>();
  const porCfop = new Map<string, { cfop: string; cst: string; valor: number }>();
  for (const x of efd.receitas) {
    if (!x.cstPis) continue;
    const c = porCst.get(x.cstPis) ?? { cst: x.cstPis, descricao: CST_PIS[x.cstPis] ?? 'Outro', valor: 0, pis: 0, cofins: 0 };
    c.valor = r2(c.valor + x.valor); c.pis = r2(c.pis + x.vlPis); c.cofins = r2(c.cofins + x.vlCofins);
    porCst.set(x.cstPis, c);
    const k = `${x.cfop || x.reg}|${x.cstPis}`;
    const p = porCfop.get(k) ?? { cfop: x.cfop || (x.reg === 'A170' ? 'Serviços' : 'Demais receitas'), cst: x.cstPis, valor: 0 };
    p.valor = r2(p.valor + x.valor);
    porCfop.set(k, p);
  }
  const receitas = [...porCst.values()].sort((a, b) => a.cst.localeCompare(b.cst));
  const regimeTexto: Record<string, string> = { '1': 'Não cumulativo', '2': 'Cumulativo', '3': 'Não cumulativo e cumulativo' };
  const criterio: Record<string, string> = { '1': 'Regime de caixa', '2': 'Competência consolidada', '9': 'Competência detalhada' };
  const m = (x: number[] | null) => (x ? { contribuicao: r2((x[0] ?? 0) + (x[7] ?? 0)), creditos: r2(x[1] ?? 0), recolher: r2(x[11] ?? 0) } : null);
  const est = efd.estabelecimentos.find((e) => e.cnpj === cab?.cnpj) ?? efd.estabelecimentos[0];
  return {
    tipo: 'efd_contribuicoes',
    periodo: cab?.dtIni.slice(0, 7) ?? '',
    codVer: cab?.codVer ?? '',
    finalidade: cab?.tipoEscrit === '1' ? 'retificadora' : 'original',
    linhas: efd.totalLinhas,
    empresa: cab ? { nome: cab.nome, cnpj: cab.cnpj, ie: est?.ie ?? '', uf: cab.uf, codMun: cab.codMun } : null,
    contador: efd.contador ? { nome: efd.contador.nome, crc: efd.contador.crc, email: efd.contador.email } : null,
    regime: efd.regime ? {
      codigo: efd.regime.codIncTrib, texto: regimeTexto[efd.regime.codIncTrib] ?? efd.regime.codIncTrib,
      criterio: criterio[efd.regime.indRegCum] ?? null,
    } : null,
    estabelecimentos: efd.estabelecimentos.length,
    documentos: [...grupos.values()].sort((a, b) => a.chave.localeCompare(b.chave)),
    receitaBruta: r2(receitas.reduce((t, c) => t + c.valor, 0)),
    receitas,
    porCfop: [...porCfop.values()].sort((a, b) => b.valor - a.valor).slice(0, 30),
    apuracao: { pis: m(efd.m200), cofins: m(efd.m600) },
    calculada: calcular(efd),
    naoAnalisados: OUTROS_RECEITA.filter((r) => efd.contagem.has(r)),
  };
}

/* ---------- cruzamento com o SPED Fiscal do mesmo mês ---------- */

export type TipoCruzamento = 'fiscal_sem_contribuicoes' | 'contribuicoes_sem_fiscal' | 'valor' | 'situacao';

export interface DivergenciaCruzamento {
  tipo: TipoCruzamento;
  nivel: Nivel;
  chave: string;
  modelo: string;
  numero: string;
  data: string;
  valorFiscal: number | null;
  valorContrib: number | null;
  detalhe: string;
}

export interface Cruzamento {
  periodo: string;
  totais: { vendasFiscal: number; valorFiscal: number; saidasContrib: number; valorContrib: number; conferidas: number; ignoradasFiscal: number };
  contagem: Record<TipoCruzamento, number>;
  divergencias: DivergenciaCruzamento[];
  observacoes: string[];
}

/**
 * Saídas de venda do SPED Fiscal (C190 com CFOP de venda, não canceladas) × saídas do Contribuições, por chave.
 * Notas sem CFOP de venda (ex.: 5929 sobre cupom já emitido, 5927 baixa de estoque) não precisam estar no Contribuições.
 */
export function cruzarFiscalContribuicoes(fiscal: Efd, contrib: EfdContrib): Cruzamento {
  const div: DivergenciaCruzamento[] = [];
  const saidasContrib = new Map(contrib.c100.filter((d) => d.indOper === '1' && d.chave).map((d) => [d.chave, d]));
  const fiscalSaidas = fiscal.c100.filter((d) => d.indOper === '1' && (d.codMod === '55' || d.codMod === '65') && d.chave);
  const porChaveFiscal = new Map(fiscalSaidas.map((d) => [d.chave, d]));
  let vendas = 0; let valorFiscal = 0; let conferidas = 0; let ignoradas = 0;
  const num9 = (c: string) => String(Number(c.slice(25, 34)));
  for (const d of fiscalSaidas) {
    const cancelada = CANCELADOS.has(d.codSit);
    const venda = d.c190.some((x) => cfopVenda(x.cfop));
    const c = saidasContrib.get(d.chave);
    if (cancelada) {
      if (c && !CANCELADOS.has(c.codSit)) {
        div.push({ tipo: 'situacao', nivel: 'erro', chave: d.chave, modelo: d.codMod, numero: d.numero, data: d.dtDoc, valorFiscal: d.vlDoc, valorContrib: c.vlDoc,
          detalhe: `Cancelada no SPED Fiscal (COD_SIT ${d.codSit}) e regular no Contribuições: a receita está a mais.` });
      }
      continue;
    }
    if (!venda) { ignoradas++; continue; }
    vendas++; valorFiscal += d.vlDoc;
    if (!c) {
      div.push({ tipo: 'fiscal_sem_contribuicoes', nivel: 'erro', chave: d.chave, modelo: d.codMod, numero: d.numero, data: d.dtDoc, valorFiscal: d.vlDoc, valorContrib: null,
        detalhe: `Venda (CFOP ${[...new Set(d.c190.map((x) => x.cfop))].join(', ')}) escriturada no SPED Fiscal e ausente do Contribuições: receita a menos.` });
      continue;
    }
    if (CANCELADOS.has(c.codSit)) {
      div.push({ tipo: 'situacao', nivel: 'erro', chave: d.chave, modelo: d.codMod, numero: d.numero, data: d.dtDoc, valorFiscal: d.vlDoc, valorContrib: c.vlDoc,
        detalhe: `Regular no SPED Fiscal e cancelada no Contribuições (COD_SIT ${c.codSit}).` });
      continue;
    }
    conferidas++;
    if (Math.abs(d.vlDoc - c.vlDoc) > 0.05) {
      div.push({ tipo: 'valor', nivel: 'alerta', chave: d.chave, modelo: d.codMod, numero: d.numero, data: d.dtDoc, valorFiscal: d.vlDoc, valorContrib: c.vlDoc,
        detalhe: `Valor do documento diferente em ${brl(Math.abs(r2(d.vlDoc - c.vlDoc)))}.` });
    }
  }
  let valorContrib = 0; let qtdContrib = 0;
  for (const c of saidasContrib.values()) {
    if (CANCELADOS.has(c.codSit)) continue;
    qtdContrib++; valorContrib += c.vlDoc;
    if (!porChaveFiscal.has(c.chave)) {
      div.push({ tipo: 'contribuicoes_sem_fiscal', nivel: 'alerta', chave: c.chave, modelo: c.codMod, numero: c.numero || num9(c.chave), data: c.dtDoc, valorFiscal: null, valorContrib: c.vlDoc,
        detalhe: 'Saída no Contribuições que não está no SPED Fiscal do mês.' });
    }
  }
  const obs: string[] = [];
  if (ignoradas) obs.push(`${ignoradas} saída(s) do SPED Fiscal sem CFOP de venda (ex.: 5929 sobre cupom, 5927 baixa de estoque, remessas) não precisam estar no Contribuições.`);
  const canceladasFiscal = fiscalSaidas.filter((d) => CANCELADOS.has(d.codSit)).length;
  if (canceladasFiscal) obs.push(`${canceladasFiscal} documento(s) cancelado(s) no SPED Fiscal: não entram na receita.`);
  const contagem = { fiscal_sem_contribuicoes: 0, contribuicoes_sem_fiscal: 0, valor: 0, situacao: 0 } as Record<TipoCruzamento, number>;
  for (const d of div) contagem[d.tipo]++;
  const ordem: Record<Nivel, number> = { erro: 0, alerta: 1, info: 2 };
  div.sort((a, b) => ordem[a.nivel] - ordem[b.nivel] || a.data.localeCompare(b.data));
  return {
    periodo: contrib.cabecalho?.dtIni.slice(0, 7) ?? '',
    totais: { vendasFiscal: vendas, valorFiscal: r2(valorFiscal), saidasContrib: qtdContrib, valorContrib: r2(valorContrib), conferidas, ignoradasFiscal: ignoradas },
    contagem,
    divergencias: div,
    observacoes: obs,
  };
}
