/**
 * Motor contábil (ETL): dado padronizado (movimento) + regra do Departamento Contábil → lançamento.
 *
 * Regra de ouro (especificação Contabilfarma): o programa NÃO decide conta. Conta e histórico vêm das tabelas de
 * regras (ctb_regras_fiscais por CFOP, ctb_regras_folha por rubrica). Sem regra → pendência, nunca suposição.
 * Este arquivo é puro (sem banco): normalização, escolha da regra, histórico, validações e chave de idempotência.
 */
import crypto from 'crypto';

/* ---------- erros classificados (relatório de pendências) ---------- */

export const ERROS = {
  EMPRESA_NAO_ENCONTRADA: 'Empresa não encontrada na tabela mestre do Contábil',
  CFOP_SEM_REGRA: 'CFOP sem regra',
  RUBRICA_SEM_REGRA: 'Rubrica sem regra',
  VALOR_INVALIDO: 'Valor inválido',
  DATA_INVALIDA: 'Data inválida',
  DOCUMENTO_DUPLICADO: 'Documento duplicado',
  CNPJ_INVALIDO: 'CNPJ inválido',
  REGRA_INCOMPLETA: 'Regra incompleta',
  VALOR_NAO_DEFINIDO: 'Campo de valor contábil ainda não definido pelo Fiscal',
  NOTA_SEM_ITENS: 'Nota sem itens (só o resumo chegou): não dá para separar por CFOP',
  VALOR_NAO_FECHA: 'Soma dos itens não fecha com o total da nota',
  CONTA_INEXISTENTE: 'Conta da regra não existe no plano de contas',
  CONTA_SINTETICA: 'Conta da regra é sintética (só conta analítica recebe lançamento)',
  COMPETENCIA_INVALIDA: 'Competência inválida',
} as const;
export type CodigoErro = keyof typeof ERROS;

export type Regime = 'simples' | 'mei' | 'presumido' | 'real';
export type ValorFiscal = 'total_nota' | 'produtos' | 'produtos_menos_desconto';

export interface RegraFiscal {
  id: number; ctb_empresa_id: string | null; regime: Regime | null; cfop: string; tipo_movimento: string;
  conta_debito: string; conta_credito: string; historico: string; historico_codigo: string | null; regra_inversao: boolean; ativo: boolean;
}
export interface RegraFolha {
  id: number; ctb_empresa_id: string | null; rubrica: string; descricao: string | null;
  conta_debito: string; conta_credito: string; historico: string; historico_codigo: string | null; tipo_regra: string; ativo: boolean;
}
export interface EmpresaCtb { id: string; codigo_dominio: string; cnpj: string; razao_social: string; regime: Regime | null; plano_id: string | null; ativo: boolean }
export interface Conta { codigo: string; tipo: 'S' | 'A'; ativa: boolean }

/** Movimento padronizado (camada STAGING). */
export interface Movimento {
  chave_unica: string;
  origem: 'fiscal' | 'folha';
  ctb_empresa_id: string | null;
  cnpj: string | null;
  competencia: string; // AAAA-MM-01
  data: string; // AAAA-MM-DD (sem hora)
  documento: string | null;
  chave_nfe?: string | null;
  modelo?: string | null;
  cfop?: string | null;
  rubrica?: string | null;
  descricao?: string | null;
  participante_nome?: string | null;
  participante_doc?: string | null;
  direcao?: 'entrada' | 'saida' | null;
  valor: number | null;
  dados?: Record<string, unknown>;
  erro?: { codigo: CodigoErro; detalhe?: string } | null;
}

export interface Lancamento {
  ctb_empresa_id: string; competencia: string; data: string; conta_debito: string; conta_credito: string;
  valor: number; historico: string; historico_codigo: string | null; origem: 'fiscal' | 'folha'; documento: string | null; regra: string;
}

/* ---------- utilitários ---------- */

const so = (v: unknown) => String(v ?? '').replace(/\D+/g, '');
export const r2 = (n: number) => Math.round(n * 100) / 100;

export function cnpjValido(c: string): boolean {
  const d = so(c);
  if (d.length === 11) return !/^(\d)\1{10}$/.test(d);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (b: string, pesos: number[]) => { const s = pesos.reduce((t, p, i) => t + Number(b[i]) * p, 0) % 11; return s < 2 ? 0 : 11 - s; };
  const d1 = calc(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}

/** Chave de idempotência: o mesmo dado processado duas vezes gera a mesma chave (e não duplica). */
export function chaveUnica(...partes: (string | number | null | undefined)[]): string {
  return crypto.createHash('sha256').update(partes.map((p) => String(p ?? '')).join('|')).digest('hex');
}

/** Data no fuso de São Paulo, sem hora: "2026-10-05T17:37:22Z" → "2026-10-05". */
export function dataSemHora(v: string | Date): string | null {
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

export const competenciaDe = (data: string) => `${data.slice(0, 7)}-01`;
export function ultimoDia(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number);
  const d = new Date(Date.UTC(a, m, 0));
  return d.toISOString().slice(0, 10);
}
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const compBr = (comp: string) => `${comp.slice(5, 7)}/${comp.slice(0, 4)}`;

/* ---------- histórico ---------- */

export const VARIAVEIS_HISTORICO = {
  fiscal: ['{numero}', '{serie}', '{participante}', '{cfop}', '{data}', '{competencia}', '{chave}', '{modelo}'],
  folha: ['{rubrica}', '{descricao}', '{competencia}'],
};

/** Monta o histórico pela regra. Participante vazio = "Consumidor Final" (especificação, item 16). */
export function montarHistorico(modelo: string, m: Movimento): string {
  const participante = String(m.participante_nome ?? '').trim() || 'Consumidor Final';
  const valores: Record<string, string> = {
    '{numero}': m.documento ?? '', '{serie}': String((m.dados as any)?.serie ?? ''), '{participante}': participante,
    '{cfop}': m.cfop ?? '', '{data}': dataBr(m.data), '{competencia}': compBr(m.competencia), '{chave}': m.chave_nfe ?? '',
    '{modelo}': m.modelo === '65' ? 'NFC-e' : m.modelo === '55' ? 'NF-e' : m.modelo ?? '',
    '{rubrica}': m.rubrica ?? '', '{descricao}': m.descricao ?? '',
  };
  return modelo.replace(/\{[a-z]+\}/g, (v) => (v in valores ? valores[v] : v)).replace(/\s+/g, ' ').trim();
}

/* ---------- regras ---------- */

/** Regra do CFOP: a da empresa vence a do regime, que vence a geral. Só regras ativas. */
export function regraFiscal(regras: RegraFiscal[], empresa: EmpresaCtb, cfop: string): RegraFiscal | null {
  const c = regras.filter((r) => r.ativo && r.cfop === cfop);
  return c.find((r) => r.ctb_empresa_id === empresa.id)
    ?? c.find((r) => !r.ctb_empresa_id && r.regime && r.regime === empresa.regime)
    ?? c.find((r) => !r.ctb_empresa_id && !r.regime)
    ?? null;
}

export function regraFolha(regras: RegraFolha[], empresa: EmpresaCtb, rubrica: string): RegraFolha | null {
  const c = regras.filter((r) => r.ativo && r.rubrica === rubrica);
  return c.find((r) => r.ctb_empresa_id === empresa.id) ?? c.find((r) => !r.ctb_empresa_id) ?? null;
}

export type Resultado = { ok: true; lancamento: Lancamento } | { ok: false; codigo: CodigoErro; detalhe?: string };

/**
 * Aplica a regra ao movimento e valida o lançamento. As contas são usadas exatamente como estão na regra
 * (débito/crédito); a marcação "regra de inversão" é informativa (a regra já traz as contas na ordem certa).
 */
export function aplicar(m: Movimento, empresa: EmpresaCtb | null, regras: { fiscais: RegraFiscal[]; folha: RegraFolha[] }, plano?: Map<string, Conta>): Resultado {
  if (m.erro) return { ok: false, codigo: m.erro.codigo, detalhe: m.erro.detalhe };
  if (!empresa || !empresa.ativo) return { ok: false, codigo: 'EMPRESA_NAO_ENCONTRADA', detalhe: m.cnpj ?? undefined };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m.data)) return { ok: false, codigo: 'DATA_INVALIDA', detalhe: m.data };
  if (m.valor == null || !Number.isFinite(m.valor) || r2(m.valor) <= 0) return { ok: false, codigo: 'VALOR_INVALIDO', detalhe: String(m.valor) };
  let regra: { conta_debito: string; conta_credito: string; historico: string; historico_codigo: string | null; id: number } | null;
  let nome: string;
  if (m.origem === 'fiscal') {
    const r = m.cfop ? regraFiscal(regras.fiscais, empresa, m.cfop) : null;
    if (!r) return { ok: false, codigo: 'CFOP_SEM_REGRA', detalhe: m.cfop ?? '(sem CFOP)' };
    regra = r; nome = `CFOP ${r.cfop}${r.ctb_empresa_id ? ' (empresa)' : r.regime ? ` (${r.regime})` : ''}`;
  } else {
    const r = m.rubrica ? regraFolha(regras.folha, empresa, m.rubrica) : null;
    if (!r) return { ok: false, codigo: 'RUBRICA_SEM_REGRA', detalhe: `${m.rubrica ?? ''} ${m.descricao ?? ''}`.trim() };
    regra = r; nome = `Rubrica ${r.rubrica}${r.ctb_empresa_id ? ' (empresa)' : ''}`;
  }
  if (!/^\d{1,7}$/.test(regra.conta_debito) || !/^\d{1,7}$/.test(regra.conta_credito) || !regra.historico.trim() || regra.conta_debito === regra.conta_credito) {
    return { ok: false, codigo: 'REGRA_INCOMPLETA', detalhe: nome };
  }
  if (plano && plano.size) {
    for (const c of [regra.conta_debito, regra.conta_credito]) {
      const k = String(Number(c));
      const conta = plano.get(k);
      if (!conta || !conta.ativa) return { ok: false, codigo: 'CONTA_INEXISTENTE', detalhe: `${c} (${nome})` };
      if (conta.tipo !== 'A') return { ok: false, codigo: 'CONTA_SINTETICA', detalhe: `${c} (${nome})` };
    }
  }
  return {
    ok: true,
    lancamento: {
      ctb_empresa_id: empresa.id, competencia: m.competencia, data: m.data, conta_debito: regra.conta_debito, conta_credito: regra.conta_credito,
      valor: r2(m.valor), historico: montarHistorico(regra.historico, m), historico_codigo: regra.historico_codigo, origem: m.origem, documento: m.documento, regra: nome,
    },
  };
}

/* ---------- fonte fiscal: nota (XML do Appura) → movimentos por CFOP ---------- */

export interface NotaFonte {
  chave: string; empresa_cnpj: string; modelo: string; direcao: 'entrada' | 'saida'; numero: string | null; serie: string | null;
  emitida_em: string; situacao: string; valor: number | null; cfop: string | null; completo: boolean; itens_extraidos: boolean;
  emit_cnpj: string | null; emit_nome: string | null; dest_doc: string | null; dest_nome: string | null;
  v_prod?: number | null; v_desc?: number | null;
}
export interface ItemFonte { cfop: string | null; v_prod: number | null; v_desc: number | null; v_frete: number | null; v_seg: number | null; v_outro: number | null; v_icms_st: number | null; v_fcp_st: number | null; v_ipi: number | null }

const n = (v: unknown) => Number(v ?? 0) || 0;

function valorItem(i: ItemFonte, como: ValorFiscal): number {
  if (como === 'produtos') return n(i.v_prod);
  if (como === 'produtos_menos_desconto') return n(i.v_prod) - n(i.v_desc);
  return n(i.v_prod) - n(i.v_desc) + n(i.v_frete) + n(i.v_seg) + n(i.v_outro) + n(i.v_icms_st) + n(i.v_fcp_st) + n(i.v_ipi);
}

/**
 * Uma nota vira um movimento por CFOP. Canceladas e denegadas não geram nada (retorna lista vazia).
 * O valor segue o campo que o Fiscal escolheu (ctb_config.valor_fiscal); sem escolha → pendência.
 */
export function movimentosDaNota(nota: NotaFonte, itens: ItemFonte[], como: ValorFiscal | null): Movimento[] {
  if (nota.situacao !== 'autorizada') return [];
  const data = dataSemHora(nota.emitida_em);
  const saida = nota.direcao === 'saida';
  const base = {
    origem: 'fiscal' as const, ctb_empresa_id: null, cnpj: so(nota.empresa_cnpj), documento: nota.numero, chave_nfe: nota.chave, modelo: nota.modelo,
    direcao: nota.direcao, participante_nome: saida ? nota.dest_nome : nota.emit_nome, participante_doc: saida ? nota.dest_doc : nota.emit_cnpj,
    dados: { serie: nota.serie, chave: nota.chave },
  };
  if (!data) return [{ ...base, chave_unica: chaveUnica('fiscal', nota.chave, 'data'), competencia: '1900-01-01', data: '', valor: null, erro: { codigo: 'DATA_INVALIDA', detalhe: nota.emitida_em } }];
  const comp = competenciaDe(data);
  const mov = (cfop: string | null, valor: number | null, erro?: Movimento['erro']): Movimento => ({
    ...base, chave_unica: chaveUnica('fiscal', so(nota.empresa_cnpj), nota.chave, cfop ?? '-'), competencia: comp, data, cfop, valor: valor == null ? null : r2(valor), erro: erro ?? null,
  });
  const cfopsNota = String(nota.cfop ?? '').split(/[,\s]+/).filter((c) => /^\d{4}$/.test(c));
  if (!como) return [mov(cfopsNota.length === 1 ? cfopsNota[0] : null, null, { codigo: 'VALOR_NAO_DEFINIDO' })];

  const porCfop = new Map<string, number>();
  for (const i of itens) {
    const c = String(i.cfop ?? '').trim();
    if (!/^\d{4}$/.test(c)) continue;
    porCfop.set(c, (porCfop.get(c) ?? 0) + valorItem(i, como));
  }
  if (!porCfop.size) {
    // Sem itens: só dá quando a nota tem um único CFOP e o valor é o total da nota
    if (cfopsNota.length === 1 && como === 'total_nota' && nota.valor != null) return [mov(cfopsNota[0], n(nota.valor))];
    return [mov(cfopsNota.length === 1 ? cfopsNota[0] : null, null, { codigo: 'NOTA_SEM_ITENS', detalhe: nota.chave })];
  }
  // Total da nota: confere com o vNF (diferença de centavos vai para o maior CFOP; acima disso vira pendência)
  if (como === 'total_nota' && nota.valor != null) {
    const soma = [...porCfop.values()].reduce((t, v) => t + v, 0);
    const dif = r2(n(nota.valor) - soma);
    if (Math.abs(dif) > 0.05) {
      return [...porCfop.keys()].map((c) => mov(c, null, { codigo: 'VALOR_NAO_FECHA', detalhe: `itens ${r2(soma).toFixed(2)} × nota ${n(nota.valor).toFixed(2)}` }));
    }
    if (dif) { const maior = [...porCfop.entries()].sort((a, b) => b[1] - a[1])[0][0]; porCfop.set(maior, porCfop.get(maior)! + dif); }
  }
  return [...porCfop.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([c, v]) => mov(c, v));
}

/** NFC-e agrupadas por empresa + dia + CFOP (opcional, ctb_config.agrupar_nfce_por_dia). */
export function agruparNfcePorDia(movs: Movimento[]): Movimento[] {
  const fora: Movimento[] = []; const grupos = new Map<string, Movimento & { qtd: number }>();
  for (const m of movs) {
    if (m.modelo !== '65' || m.erro) { fora.push(m); continue; }
    const k = `${m.cnpj}|${m.data}|${m.cfop}`;
    const g = grupos.get(k);
    if (g) { g.valor = r2((g.valor ?? 0) + (m.valor ?? 0)); g.qtd++; (g.dados as any).chaves.push(m.chave_nfe); }
    else grupos.set(k, { ...m, qtd: 1, chave_nfe: null, participante_nome: null, participante_doc: null, dados: { chaves: [m.chave_nfe] } });
  }
  for (const g of grupos.values()) {
    const { qtd, ...m } = g;
    fora.push({ ...m, documento: `NFC-e ${dataBr(m.data)} (${qtd} nota${qtd === 1 ? '' : 's'})`, chave_unica: chaveUnica('fiscal-nfce-dia', m.cnpj, m.data, m.cfop, (m.dados as any).chaves.sort().join(',')) });
  }
  return fora;
}

/* ---------- fonte folha: planilha (empresa, competência, rubrica, valor) ---------- */

export interface LinhaFolha { linha: number; dados: Record<string, string> }

const CAB: Record<string, string[]> = {
  empresa: ['codigo_empresa', 'empresa', 'cod_empresa', 'codigo empresa', 'código empresa', 'codigo_dominio', 'código domínio', 'codigo dominio'],
  cnpj: ['cnpj', 'cnpj_empresa'],
  competencia: ['competencia', 'competência', 'comp', 'mes', 'mês'],
  rubrica: ['rubrica', 'codigo_rubrica', 'código rubrica', 'cod_rubrica', 'evento', 'codigo_evento'],
  descricao: ['descricao', 'descrição', 'nome_rubrica', 'nome rubrica', 'nome_evento'],
  valor: ['valor', 'valor_rubrica', 'vlr'],
  tipo: ['tipo', 'tipo_verba', 'tipo verba'],
};
const normCab = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');

/** Lê CSV (; ou ,) com cabeçalho. Aceita aspas. */
export function lerCsv(texto: string): { cabecalho: string[]; linhas: LinhaFolha[] } {
  const t = texto.replace(/^﻿/, '');
  const primeira = t.split(/\r?\n/, 1)[0] ?? '';
  const sep = (primeira.match(/;/g)?.length ?? 0) >= (primeira.match(/,/g)?.length ?? 0) ? ';' : ',';
  const regs: string[][] = []; let campo = ''; let reg: string[] = []; let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (aspas) { if (ch === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += ch; continue; }
    if (ch === '"') aspas = true;
    else if (ch === sep) { reg.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; reg.push(campo); regs.push(reg); reg = []; campo = ''; }
    else campo += ch;
  }
  if (campo || reg.length) { reg.push(campo); regs.push(reg); }
  const [cab = [], ...resto] = regs.filter((r) => r.some((c) => c.trim()));
  const cabecalho = cab.map((c) => c.trim());
  return { cabecalho, linhas: resto.map((r, i) => ({ linha: i + 2, dados: Object.fromEntries(cabecalho.map((c, j) => [c, (r[j] ?? '').trim()])) })) };
}

export function valorBr(v: string): number | null {
  const s = String(v ?? '').trim().replace(/^R\$\s*/i, '');
  if (!s) return null;
  const t = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** "09/2025", "2025-09", "092025", "01/09/2025" → "2025-09-01". */
export function lerCompetencia(v: string): string | null {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{1,2})[/-](\d{4})$/); if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${m[2]}-${m[1].padStart(2, '0')}-01` : null;
  m = s.match(/^(\d{4})-(\d{2})(-\d{2})?$/); if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2]}-01` : null;
  m = s.match(/^(\d{2})(\d{4})$/); if (m) return Number(m[1]) >= 1 && Number(m[1]) <= 12 ? `${m[2]}-${m[1]}-01` : null;
  m = s.match(/^\d{2}\/(\d{2})\/(\d{4})$/); if (m) return `${m[2]}-${m[1]}-01`;
  return null;
}

/** Linha da planilha da folha → movimento (data = último dia da competência). */
export function movimentoDaFolha(l: LinhaFolha, empresas: { porCodigo: Map<string, EmpresaCtb>; porCnpj: Map<string, EmpresaCtb> }): Movimento {
  const pega = (campo: keyof typeof CAB) => {
    const nomes = CAB[campo];
    const k = Object.keys(l.dados).find((c) => nomes.includes(normCab(c)));
    return k ? l.dados[k] : '';
  };
  const codigo = so(pega('empresa')).replace(/^0+(?=\d)/, '');
  const cnpj = so(pega('cnpj'));
  const comp = lerCompetencia(pega('competencia'));
  const rubrica = pega('rubrica').trim().replace(/^0+(?=\d)/, '');
  const descricao = pega('descricao');
  const valor = valorBr(pega('valor'));
  const emp = (codigo && empresas.porCodigo.get(codigo)) || (cnpj && empresas.porCnpj.get(cnpj)) || null;
  const data = comp ? ultimoDia(comp) : '';
  const m: Movimento = {
    chave_unica: chaveUnica('folha', emp?.id ?? `${codigo}/${cnpj}`, comp, rubrica, valor, JSON.stringify(l.dados)),
    origem: 'folha', ctb_empresa_id: emp?.id ?? null, cnpj: emp?.cnpj ?? (cnpj || null), competencia: comp ?? '1900-01-01', data,
    documento: rubrica ? `RUBRICA ${rubrica}` : null, rubrica: rubrica || null, descricao: descricao || null, valor,
    dados: { linha: l.linha, codigo_empresa: codigo || null, tipo: pega('tipo') || null },
  };
  if (cnpj && !cnpjValido(cnpj) && !emp) m.erro = { codigo: 'CNPJ_INVALIDO', detalhe: cnpj };
  else if (!emp) m.erro = { codigo: 'EMPRESA_NAO_ENCONTRADA', detalhe: codigo ? `código ${codigo}` : cnpj || 'sem código nem CNPJ' };
  else if (!comp) m.erro = { codigo: 'COMPETENCIA_INVALIDA', detalhe: pega('competencia') };
  else if (!rubrica) m.erro = { codigo: 'RUBRICA_SEM_REGRA', detalhe: 'linha sem rubrica' };
  else if (valor == null || valor <= 0) m.erro = { codigo: 'VALOR_INVALIDO', detalhe: pega('valor') };
  return m;
}

/* ---------- validação do lote ---------- */

export function totais(lancs: Pick<Lancamento, 'valor'>[]) {
  const debito = r2(lancs.reduce((t, l) => t + l.valor, 0));
  // Partida simples: cada lançamento debita e credita o mesmo valor; a conferência fica explícita (item 35)
  const credito = r2(lancs.reduce((t, l) => t + l.valor, 0));
  return { debito, credito, confere: debito === credito, quantidade: lancs.length };
}
