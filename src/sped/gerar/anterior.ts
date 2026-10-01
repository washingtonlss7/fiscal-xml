/**
 * Dados aproveitados do SPED do mês anterior (o que não está nos XMLs): cadastro, contabilista, perfil,
 * códigos próprios dos itens (0200, de-para pelo GTIN), unidades e fatores (0190/0220), saldo credor (E110),
 * código de receita e vencimento do ICMS (E116), indicadores do 1010, contas contábeis (0500 e uso por CST/CFOP)
 * e saldos de créditos de PIS/COFINS (1100/1500).
 */
import { num } from '../efd';

export type Registros = Map<string, string[][]>;

/** Lê o arquivo em registros: f[0] = REG (mesma indexação de efd.ts). Guarda o pai C100 para os filhos. */
export function lerRegistros(texto: string): { regs: Registros; filhos: { c170: { pai: string[]; f: string[] }[]; c175: { pai: string[]; f: string[] }[] } } {
  const regs: Registros = new Map();
  const c170: { pai: string[]; f: string[] }[] = []; const c175: { pai: string[]; f: string[] }[] = [];
  let pai: string[] | null = null;
  for (const bruta of texto.split(/\r?\n/)) {
    const l = bruta.trim();
    if (!l.startsWith('|') || !l.endsWith('|')) continue;
    const f = l.slice(1, -1).split('|');
    const reg = f[0];
    (regs.get(reg) ?? regs.set(reg, []).get(reg)!).push(f);
    if (reg === 'C100') pai = f;
    else if (reg === 'C170' && pai) c170.push({ pai, f });
    else if (reg === 'C175' && pai) c175.push({ pai, f });
  }
  return { regs, filhos: { c170, c175 } };
}

const um = (r: Registros, reg: string) => (r.get(reg) ?? [])[0] ?? null;
const vazio = (s: string | undefined) => (s && s.trim() ? s.trim() : null);

export interface ItemAnterior { cod: string; descr: string; ean: string | null; unidInv: string; tipo: string; ncm: string | null; cest: string | null; conversoes: { unid: string; fator: number }[] }

export interface AnteriorIcms {
  dtFin: string | null;
  ie: string | null; codMun: string | null; im: string | null; perfil: string | null; nome: string | null;
  r0005: string[] | null; r0100: string[] | null;
  partPorDoc: Map<string, string>;               // CNPJ/CPF → COD_PART usado antes
  itens: Map<string, ItemAnterior>;              // COD_ITEM → item
  itemPorEan: Map<string, string>;               // GTIN → COD_ITEM
  unidades: Map<string, string>;                 // UNID → descrição
  /** Como o escritório escriturou o item na última entrada: CST e CFOP próprios. */
  escrituracaoItem: Map<string, { cst: string; cfop: string }>;
  sldCredorTransportar: number;
  e116: { codOr: string; dtVcto: string; codRec: string } | null;
  r1010: string[] | null;
  creditoFrete: boolean;                          // D190 com ICMS creditado no mês anterior
}

export function anteriorIcms(texto: string): AnteriorIcms {
  const { regs, filhos } = lerRegistros(texto);
  const r0 = um(regs, '0000');
  const partPorDoc = new Map<string, string>();
  for (const f of regs.get('0150') ?? []) { const doc = vazio(f[4]) ?? vazio(f[5]); if (doc) partPorDoc.set(doc, f[1]); }
  const itens = new Map<string, ItemAnterior>(); const itemPorEan = new Map<string, string>();
  let atual: ItemAnterior | null = null;
  // 0220 vem logo depois do seu 0200: percorre na ordem do arquivo
  for (const bruta of texto.split(/\r?\n/)) {
    if (bruta.startsWith('|0200|')) {
      const f = bruta.trim().slice(1, -1).split('|');
      atual = { cod: f[1], descr: f[2], ean: vazio(f[3]), unidInv: f[5], tipo: f[6] || '00', ncm: vazio(f[7]), cest: vazio(f[12]), conversoes: [] };
      itens.set(atual.cod, atual);
      if (atual.ean && /^\d{8,14}$/.test(atual.ean)) itemPorEan.set(atual.ean, atual.cod);
    } else if (bruta.startsWith('|0220|') && atual) {
      const f = bruta.trim().slice(1, -1).split('|');
      atual.conversoes.push({ unid: f[1], fator: num(f[2]) });
      if (f[3] && /^\d{8,14}$/.test(f[3])) itemPorEan.set(f[3], atual.cod);
    } else if (!bruta.startsWith('|02')) {
      if (/^\|0[3-9]|^\|[A-Z1-9]/.test(bruta)) atual = null;
    }
  }
  const unidades = new Map<string, string>();
  for (const f of regs.get('0190') ?? []) unidades.set(f[1], f[2]);
  const escrituracaoItem = new Map<string, { cst: string; cfop: string }>();
  for (const { pai, f } of filhos.c170) if (pai[1] === '0' && pai[2] === '1') escrituracaoItem.set(f[2], { cst: f[9], cfop: f[10] });
  const e110 = um(regs, 'E110');
  const e116 = (regs.get('E116') ?? []).find((f) => f[1] === '000') ?? (regs.get('E116') ?? [])[0];
  return {
    dtFin: r0 ? vazio(r0[4]) : null,
    ie: r0 ? vazio(r0[9]) : null, codMun: r0 ? vazio(r0[10]) : null, im: r0 ? vazio(r0[11]) : null, perfil: r0 ? vazio(r0[13]) : null, nome: r0 ? vazio(r0[5]) : null,
    r0005: um(regs, '0005'), r0100: um(regs, '0100'),
    partPorDoc, itens, itemPorEan, unidades, escrituracaoItem,
    sldCredorTransportar: e110 ? num(e110[13]) : 0,
    e116: e116 ? { codOr: e116[1], dtVcto: e116[3], codRec: e116[4] } : null,
    r1010: um(regs, '1010'),
    creditoFrete: (regs.get('D190') ?? []).some((f) => num(f[6]) > 0),
  };
}

export interface Conta { dtAlt: string; natCc: string; indCta: string; nivel: string; cod: string; nome: string; codRef: string; cnpjEst: string }
export interface SaldoCredito { per: string; codCred: string; f: string[] }
export interface AnteriorContrib {
  dtFin: string | null;
  r0100: string[] | null;
  contas: Map<string, Conta>;
  /** Conta usada antes por (operação|CST|CFOP), (operação|CST) e (operação). Operação: E entrada, S saída, F frete, M400/M800 por CST. */
  contaPor: Map<string, string>;
  partPorDoc: Map<string, string>;
  itens: Map<string, ItemAnterior>;
  itemPorEan: Map<string, string>;
  saldos1100: SaldoCredito[];
  saldos1500: SaldoCredito[];
}

export function anteriorContrib(texto: string): AnteriorContrib {
  const { regs, filhos } = lerRegistros(texto);
  const r0 = um(regs, '0000');
  const contas = new Map<string, Conta>();
  for (const f of regs.get('0500') ?? []) contas.set(f[5], { dtAlt: f[1], natCc: f[2], indCta: f[3], nivel: f[4], cod: f[5], nome: f[6], codRef: f[7] ?? '', cnpjEst: f[8] ?? '' });
  const contaPor = new Map<string, string>();
  const marcar = (chaves: string[], cta: string | undefined) => { if (!cta) return; for (const k of chaves) if (!contaPor.has(k)) contaPor.set(k, cta); };
  for (const { pai, f } of filhos.c170) {
    const op = pai[1] === '1' ? 'S' : 'E';
    marcar([`${op}|${f[24]}|${f[10]}`, `${op}|${f[24]}`, op], f[36]);
  }
  for (const { f } of filhos.c175) marcar([`S|${f[4]}|${f[1]}`, `S|${f[4]}`, 'S'], f[16]);
  for (const f of regs.get('D101') ?? []) marcar([`F|${f[3]}`, 'F'], f[8]);
  for (const f of regs.get('M400') ?? []) marcar([`M400|${f[1]}`], f[3]);
  for (const f of regs.get('M410') ?? []) marcar([`M410|${f[1]}`], f[3]);
  for (const f of regs.get('M800') ?? []) marcar([`M800|${f[1]}`], f[3]);
  for (const f of regs.get('M810') ?? []) marcar([`M810|${f[1]}`], f[3]);
  const partPorDoc = new Map<string, string>();
  for (const f of regs.get('0150') ?? []) { const doc = vazio(f[4]) ?? vazio(f[5]); if (doc) partPorDoc.set(doc, f[1]); }
  const itens = new Map<string, ItemAnterior>(); const itemPorEan = new Map<string, string>();
  for (const f of regs.get('0200') ?? []) {
    const it = { cod: f[1], descr: f[2], ean: vazio(f[3]), unidInv: f[5], tipo: f[6] || '00', ncm: vazio(f[7]), cest: null, conversoes: [] };
    itens.set(it.cod, it); if (it.ean && /^\d{8,14}$/.test(it.ean)) itemPorEan.set(it.ean, it.cod);
  }
  const saldo = (reg: string) => (regs.get(reg) ?? []).filter((f) => num(f[17]) > 0.004).map((f) => ({ per: f[1], codCred: f[4], f }));
  return { dtFin: r0 ? vazio(r0[6]) : null, r0100: um(regs, '0100'), contas, contaPor, partPorDoc, itens, itemPorEan, saldos1100: saldo('1100'), saldos1500: saldo('1500') };
}
