/**
 * ICMS-ST devido pelo destinatário do ES nas compras de outros estados sem ST retido na nota.
 *
 *   Base ST     = (mercadoria + frete + seguro + IPI + outras despesas − desconto) × (1 + MVA)
 *                 ou, se a tabela tiver PMPF para o produto, PMPF × quantidade
 *   ICMS próprio = (mercadoria + frete + seguro + outras despesas − desconto) × alíquota interestadual
 *   ICMS-ST      = Base ST × alíquota interna do ES − ICMS próprio
 */

export const UF_DESTINO = 'ES';

/** Regra da tabela de ST do ES (cadastrada pelo escritório). */
export interface RegraST {
  id?: number;
  cest: string | null;
  /** NCM completo ou só o início (2 a 8 dígitos). */
  ncm: string | null;
  descricao: string | null;
  /** MVA em % (ex.: 40 = 40%). */
  mva: number | null;
  /** Preço médio ponderado a consumidor final, por unidade. Quando existe, é a Base ST. */
  pmpf: number | null;
  aliquota_interna: number;
}

export interface ItemST {
  chave: string;
  n_item: number;
  x_prod: string | null;
  ncm: string | null;
  cest: string | null;
  cfop: string | null;
  orig: number | null;
  q_com: number | null;
  u_com: string | null;
  v_prod: number;
  v_desc: number | null;
  v_frete: number | null;
  v_seg: number | null;
  v_outro: number | null;
  v_ipi: number | null;
  v_icms: number | null;
  p_icms: number | null;
  v_icms_st: number | null;
}

export interface NotaST {
  chave: string;
  numero: string | null;
  serie: string | null;
  emitida_em: string | null;
  emit_cnpj: string | null;
  emit_nome: string | null;
  uf_emit: string | null;
}

export interface LinhaST {
  nota: NotaST;
  item: ItemST;
  regra: RegraST;
  baseOperacao: number;
  baseComIpi: number;
  aliqInterestadual: number;
  mvaUsada: number | null;
  usouPmpf: boolean;
  baseST: number;
  aliqInterna: number;
  icmsProprio: number;
  icmsST: number;
  /** ICMS destacado na nota diferente do calculado com a alíquota interestadual correta. */
  divergenciaIcms: boolean;
}

export interface ResultadoST {
  linhas: LinhaST[];
  /** Itens com CEST (indício de ST) que não têm regra na tabela do ES. */
  semRegra: { nota: NotaST; item: ItemST }[];
  /** Itens que já vieram com ST retido pelo fornecedor. */
  jaRetidos: number;
  total: number;
}

const n = (v: number | null | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Estados do Sul e Sudeste (menos o ES): vendendo para o ES a alíquota é 7%. */
const SUL_SUDESTE = new Set(['SP', 'RJ', 'MG', 'PR', 'SC', 'RS']);
/** Origem importada (Resolução do Senado 13/2012): 4%. */
const ORIGEM_IMPORTADA = new Set([1, 2, 3, 8]);

export function aliquotaInterestadual(ufOrigem: string, orig: number | null): number {
  if (orig !== null && ORIGEM_IMPORTADA.has(orig)) return 4;
  return SUL_SUDESTE.has(ufOrigem) ? 7 : 12;
}

/** CFOPs do fornecedor que representam compra/transferência/bonificação (ficam de fora devoluções e remessas). */
export function cfopSujeito(cfop: string | null): boolean {
  if (!cfop) return false;
  return /^6(1|4)\d\d$/.test(cfop) || cfop === '6910';
}

/** Escolhe a regra mais específica: CEST igual vale mais; entre NCMs, o prefixo mais longo. */
export function acharRegra(item: Pick<ItemST, 'cest' | 'ncm'>, regras: RegraST[]): RegraST | undefined {
  let melhor: RegraST | undefined;
  let pontos = -1;
  for (const r of regras) {
    if (r.cest && r.cest !== item.cest) continue;
    if (r.ncm && !(item.ncm ?? '').startsWith(r.ncm)) continue;
    if (!r.cest && !r.ncm) continue;
    const p = (r.cest ? 100 : 0) + (r.ncm?.length ?? 0);
    if (p > pontos) {
      melhor = r;
      pontos = p;
    }
  }
  return melhor;
}

/** MVA ajustada (Convênio ICMS 142/2018): [(1 + MVA) × (1 − ALQ inter) / (1 − ALQ intra)] − 1. */
export function mvaAjustada(mva: number, aliqInter: number, aliqInterna: number): number {
  return ((1 + mva / 100) * (1 - aliqInter / 100) / (1 - aliqInterna / 100) - 1) * 100;
}

export function calcularItem(nota: NotaST, item: ItemST, regra: RegraST, ajustarMva: boolean): LinhaST {
  const baseOperacao = r2(n(item.v_prod) + n(item.v_frete) + n(item.v_seg) + n(item.v_outro) - n(item.v_desc));
  const baseComIpi = r2(baseOperacao + n(item.v_ipi));
  const aliqInterestadual = aliquotaInterestadual(nota.uf_emit ?? '', item.orig);
  const aliqInterna = Number(regra.aliquota_interna ?? 17);

  const usouPmpf = regra.pmpf !== null && regra.pmpf > 0;
  let mvaUsada: number | null = null;
  let baseST: number;
  if (usouPmpf) {
    baseST = r2(n(regra.pmpf) * n(item.q_com));
  } else {
    const mva = n(regra.mva);
    mvaUsada = ajustarMva ? mvaAjustada(mva, aliqInterestadual, aliqInterna) : mva;
    baseST = r2(baseComIpi * (1 + mvaUsada / 100));
  }
  const icmsProprio = r2(baseOperacao * (aliqInterestadual / 100));
  const icmsST = Math.max(0, r2(baseST * (aliqInterna / 100) - icmsProprio));
  const destacado = n(item.v_icms);
  const divergenciaIcms = destacado > 0 && Math.abs(destacado - icmsProprio) > 0.05;

  return {
    nota, item, regra, baseOperacao, baseComIpi, aliqInterestadual,
    mvaUsada: mvaUsada === null ? null : Math.round(mvaUsada * 100) / 100,
    usouPmpf, baseST, aliqInterna, icmsProprio, icmsST, divergenciaIcms,
  };
}

/** Calcula o ST de todas as notas de entrada de outros estados. */
export function calcularST(notas: NotaST[], itens: ItemST[], regras: RegraST[], ajustarMva = false): ResultadoST {
  const porChave = new Map(notas.map((x) => [x.chave, x]));
  const linhas: LinhaST[] = [];
  const semRegra: ResultadoST['semRegra'] = [];
  let jaRetidos = 0;

  for (const item of itens) {
    const nota = porChave.get(item.chave);
    if (!nota || !nota.uf_emit || nota.uf_emit === UF_DESTINO) continue;
    if (!cfopSujeito(item.cfop)) continue;
    if (n(item.v_icms_st) > 0) {
      jaRetidos++;
      continue;
    }
    const regra = acharRegra(item, regras);
    if (regra) linhas.push(calcularItem(nota, item, regra, ajustarMva));
    else if (item.cest) semRegra.push({ nota, item });
  }
  const ordem = (a: { nota: NotaST; item: ItemST }, b: { nota: NotaST; item: ItemST }) =>
    (a.nota.emitida_em ?? '').localeCompare(b.nota.emitida_em ?? '') || a.nota.chave.localeCompare(b.nota.chave) || a.item.n_item - b.item.n_item;
  linhas.sort(ordem);
  semRegra.sort(ordem);
  return { linhas, semRegra, jaRetidos, total: r2(linhas.reduce((t, l) => t + l.icmsST, 0)) };
}

/* ---------- tabela de regras (CSV) ---------- */

export const CABECALHO_TABELA = ['cest', 'ncm', 'descricao', 'mva', 'pmpf', 'aliquota_interna'];

const numeroBR = (v: string): number | null => {
  const t = v.trim().replace(/%$/, '').trim();
  if (!t) return null;
  // Aceita 1.234,56 / 1234,56 / 1234.56
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  const x = Number(normal);
  if (!Number.isFinite(x)) throw new Error(`número inválido "${v}"`);
  return x;
};

function dividirLinha(linha: string, sep: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (c === '"') {
      if (aspas && linha[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas;
    } else if (c === sep && !aspas) {
      campos.push(atual);
      atual = '';
    } else atual += c;
  }
  campos.push(atual);
  return campos.map((x) => x.trim());
}

/** Lê a tabela de ST (CSV do Excel, separado por ";" ou ","). Devolve as regras e os erros por linha. */
export function lerTabelaCsv(texto: string): { regras: RegraST[]; erros: string[] } {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return { regras: [], erros: ['Arquivo vazio.'] };
  const sep = (linhas[0].match(/;/g)?.length ?? 0) >= (linhas[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const cab = dividirLinha(linhas[0], sep).map((c) => c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '_'));
  const col = (nome: string) => cab.indexOf(nome);
  if (col('cest') < 0 && col('ncm') < 0) return { regras: [], erros: ['A primeira linha precisa ter as colunas: ' + CABECALHO_TABELA.join(';')] };

  const regras: RegraST[] = [];
  const erros: string[] = [];
  linhas.slice(1).forEach((l, i) => {
    const c = dividirLinha(l, sep);
    const pega = (nome: string) => (col(nome) >= 0 ? c[col(nome)] ?? '' : '');
    const nLinha = i + 2;
    try {
      const cest = pega('cest').replace(/\D/g, '') || null;
      const ncm = pega('ncm').replace(/\D/g, '') || null;
      if (!cest && !ncm) throw new Error('informe o CEST ou o NCM');
      if (cest && cest.length !== 7) throw new Error(`CEST "${cest}" deve ter 7 dígitos`);
      if (ncm && (ncm.length < 2 || ncm.length > 8)) throw new Error(`NCM "${ncm}" deve ter de 2 a 8 dígitos`);
      const mva = numeroBR(pega('mva'));
      const pmpf = numeroBR(pega('pmpf'));
      if (mva === null && pmpf === null) throw new Error('informe a MVA ou o PMPF');
      if (mva !== null && (mva < 0 || mva > 1000)) throw new Error('MVA fora do intervalo (use 40 para 40%)');
      const aliq = numeroBR(pega('aliquota_interna')) ?? 17;
      if (aliq <= 0 || aliq >= 100) throw new Error('alíquota interna inválida');
      regras.push({ cest, ncm, descricao: pega('descricao') || null, mva, pmpf, aliquota_interna: aliq });
    } catch (e) {
      erros.push(`Linha ${nLinha}: ${(e as Error).message}.`);
    }
  });
  return { regras, erros };
}

export function tabelaParaCsv(regras: RegraST[]): string {
  const fmt = (v: number | null) => (v === null || v === undefined ? '' : String(v).replace('.', ','));
  const esc = (s: string | null) => (s && /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s ?? '');
  const linhas = regras.map((r) => [r.cest ?? '', r.ncm ?? '', esc(r.descricao), fmt(r.mva), fmt(r.pmpf), fmt(r.aliquota_interna)].join(';'));
  return '﻿' + [CABECALHO_TABELA.join(';'), ...linhas].join('\r\n') + '\r\n';
}
