/**
 * Vendas sem nota autorizada: números de NF-e/NFC-e cujos XMLs importados vieram rejeitados pela SEFAZ e que não têm,
 * no Appura, nenhuma nota autorizada (ou cancelada) com a mesma série e número. O escritório cobra do cliente a
 * regularização (reemitir corrigida ou inutilizar a numeração).
 */
import { buscarTodos, Db } from '../db';

export interface VendaSemNota {
  modelo: string; serie: string | null; numero: string | null; emitida_em: string | null; valor: number | null;
  cstat: string; motivo: string | null; tentativas: number; chaves: string[];
}

/** Agrupa as rejeitadas por modelo/série/número e tira as que têm nota autorizada ou cancelada no mesmo número. */
export function vendasSemNota(rejeitadas: { chave: string; modelo: string; serie: string | null; numero: string | null; emitida_em: string | null; valor: number | null; cstat: string; motivo: string | null }[],
  existentes: { modelo: string; serie: string | null; numero: string | null }[]): VendaSemNota[] {
  const k = (x: { modelo: string; serie: string | null; numero: string | null }) => `${x.modelo}|${Number(x.serie ?? 0)}|${Number(x.numero ?? 0)}`;
  const tem = new Set(existentes.map(k));
  const g = new Map<string, VendaSemNota>();
  for (const r of rejeitadas) {
    const chave = k(r);
    if (tem.has(chave)) continue;
    const v = g.get(chave);
    if (v) { v.tentativas++; v.chaves.push(r.chave); if (!v.emitida_em || (r.emitida_em && r.emitida_em < v.emitida_em)) v.emitida_em = r.emitida_em; continue; }
    g.set(chave, { modelo: r.modelo, serie: r.serie, numero: r.numero, emitida_em: r.emitida_em, valor: r.valor != null ? Number(r.valor) : null, cstat: r.cstat, motivo: r.motivo, tentativas: 1, chaves: [r.chave] });
  }
  return [...g.values()].sort((a, b) => String(a.emitida_em ?? '').localeCompare(String(b.emitida_em ?? '')) || Number(a.numero ?? 0) - Number(b.numero ?? 0));
}

export async function listarVendasSemNota(db: Db, empresaId: string, de: string, ate: string) {
  const rej = await buscarTodos<any>((a, b) => db.from('notas_rejeitadas').select('chave,modelo,serie,numero,emitida_em,valor,cstat,motivo')
    .eq('empresa_id', empresaId).gte('emitida_em', de).lt('emitida_em', ate).order('emitida_em').range(a, b), 'notas rejeitadas');
  if (!rej.length) return { total: 0, valor: 0, porMotivo: [], vendas: [] };
  const modelos = [...new Set(rej.map((r) => r.modelo))];
  const exist = await buscarTodos<any>((a, b) => db.from('documentos').select('modelo,serie,numero').eq('empresa_id', empresaId).eq('direcao', 'saida')
    .in('modelo', modelos).gte('emitida_em', de).lt('emitida_em', ate).range(a, b), 'notas do período');
  const vendas = vendasSemNota(rej, exist);
  const porMotivo = new Map<string, number>();
  for (const v of vendas) { const m = `${v.cstat} · ${(v.motivo ?? '').replace(/\s*\[nItem:\d+\]/, '')}`; porMotivo.set(m, (porMotivo.get(m) ?? 0) + 1); }
  return {
    total: vendas.length, valor: Math.round(vendas.reduce((t, v) => t + (v.valor ?? 0), 0) * 100) / 100,
    porMotivo: [...porMotivo.entries()].map(([motivo, quantidade]) => ({ motivo, quantidade })).sort((a, b) => b.quantidade - a.quantidade),
    vendas: vendas.slice(0, 5000),
  };
}
