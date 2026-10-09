/** Utilitários dos módulos do escritório (Folha, Societário, Financeiro, Atendimento, Relatórios). */
import { Db, ok } from '../db';

export class ErroModulo extends Error {
  constructor(public readonly status: number, msg: string) { super(msg); }
}

export type Escopo = Set<string> | null;
export const DATA = /^\d{4}-\d{2}-\d{2}$/;
export const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
export const so = (v: unknown) => String(v ?? '').replace(/\D+/g, '');
export const txt = (v: unknown, max = 500) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
export const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
export const somarDias = (iso: string, dias: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);
export const r2 = (n: number) => Math.round(n * 100) / 100;
export function exigirMes(mes: unknown): string {
  const m = String(mes ?? '');
  if (!MES.test(m)) throw new ErroModulo(400, 'Informe o mês no formato AAAA-MM.');
  return m;
}
export function dataOpcional(v: unknown, campo: string): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!DATA.test(s)) throw new ErroModulo(400, `${campo}: data inválida.`);
  return s;
}
export function numeroOpcional(v: unknown, campo: string): number | null {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(n)) throw new ErroModulo(400, `${campo}: número inválido.`);
  return n;
}

export interface EmpresaResumo { id: string; cnpj: string; razao_social: string; uf: string; regime: string | null; ativo: boolean }

/** Empresas (clientes) do escritório no escopo do usuário. */
export async function empresasDoEscopo(db: Db, escopo: Escopo, soAtivas = false): Promise<EmpresaResumo[]> {
  let q = db.from('empresas').select('id,cnpj,razao_social,uf,regime,ativo').eq('escritorio', false).order('razao_social').limit(10000);
  if (soAtivas) q = q.eq('ativo', true);
  const l = ok(await q, 'empresas') as EmpresaResumo[];
  return escopo ? l.filter((e) => escopo.has(e.id)) : l;
}

export function exigirEmpresaNoEscopo(escopo: Escopo, id: string | null | undefined) {
  if (escopo && (!id || !escopo.has(id))) throw new ErroModulo(403, 'Esta empresa não está no seu acesso. Fale com um administrador.');
}
