/** Banco em memória com o pedaço da API do supabase-js que os serviços usam (para testes). */
/* ---------- banco em memória com o pedaço da API do supabase-js que o serviço usa ---------- */
export type Linha = Record<string, any>;
export class Consulta {
  private filtros: ((l: Linha) => boolean)[] = [];
  private ordem: [string, boolean][] = [];
  private lim = Infinity;
  private de = 0;
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private conflito: string[] = [];
  private dados: any;
  private unico: 'single' | 'maybe' | null = null;
  constructor(private tabela: Linha[], private seq: () => number) {}
  select() { return this; }
  insert(d: any) { this.op = 'insert'; this.dados = d; return this; }
  update(d: any) { this.op = 'update'; this.dados = d; return this; }
  upsert(d: any, o: { onConflict?: string } = {}) { this.op = 'upsert'; this.dados = d; this.conflito = (o.onConflict ?? '').split(','); return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c: string, v: any) { this.filtros.push((l) => l[c] === v); return this; }
  in(c: string, v: any[]) { this.filtros.push((l) => v.includes(l[c])); return this; }
  is(c: string, v: any) { this.filtros.push((l) => (l[c] ?? null) === v); return this; }
  gte(c: string, v: any) { this.filtros.push((l) => l[c] >= v); return this; }
  lte(c: string, v: any) { this.filtros.push((l) => l[c] <= v); return this; }
  order(c: string, o: { ascending?: boolean } = {}) { this.ordem.push([c, o.ascending !== false]); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(de: number, ate: number) { this.de = de; this.lim = ate - de + 1; return this; }
  single() { this.unico = 'single'; return this; }
  maybeSingle() { this.unico = 'maybe'; return this; }
  private executar(): { data: any; error: null } {
    let linhas: Linha[];
    if (this.op === 'upsert') {
      const afetadas: Linha[] = [];
      for (const d of [].concat(this.dados)) {
        const ex = this.tabela.find((l) => this.conflito.every((c) => l[c] === (d as any)[c]));
        if (ex) { Object.assign(ex, d); afetadas.push(ex); } else { const l = { id: this.seq(), ...(d as any) }; this.tabela.push(l); afetadas.push(l); }
      }
      if (this.unico) return { data: afetadas[0] ? { ...afetadas[0] } : null, error: null };
      return { data: afetadas.map((l) => ({ ...l })), error: null };
    }
    if (this.op === 'delete') {
      const fica = this.tabela.filter((l) => !this.filtros.every((f) => f(l)));
      this.tabela.splice(0, this.tabela.length, ...fica);
      return { data: null, error: null };
    }
    if (this.op === 'insert') {
      const l = { id: this.seq(), status: 'pendente', criado_em: new Date(Date.now() + this.seq()).toISOString(), ...JSON.parse(JSON.stringify(this.dados)) };
      this.tabela.push(l);
      linhas = [l];
    } else {
      linhas = this.tabela.filter((l) => this.filtros.every((f) => f(l)));
      if (this.op === 'update') for (const l of linhas) Object.assign(l, JSON.parse(JSON.stringify(this.dados)));
      for (const [c, asc] of [...this.ordem].reverse()) linhas.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      linhas = linhas.slice(this.de, this.de + this.lim);
    }
    const copia = linhas.map((l) => ({ ...l, razao_social: l.razao_social ?? l.dados?.razao_social }));
    if (this.unico) return { data: copia[0] ?? null, error: null };
    return { data: copia, error: null };
  }
  then(ok: (r: any) => any, erro?: (e: any) => any) { try { return Promise.resolve(this.executar()).then(ok, erro); } catch (e) { return Promise.reject(e).then(ok, erro); } }
}
export function bancoFalso(tabelas: string[] = ['empresas', 'documentos', 'sped_arquivos', 'cadastro_sugestoes', 'divergencias_justificadas', 'documento_itens']) {
  const t: Record<string, Linha[]> = Object.fromEntries(tabelas.map((n) => [n, []]));
  let n = 0;
  let relogio = Date.parse('2026-09-30T10:00:00Z');
  const seq = () => ++n;
  const db = { from: (nome: string) => new Consulta(t[nome], seq) } as any;
  const avancar = () => { relogio += 60_000; return new Date(relogio).toISOString(); };
  return { db, t, avancar };
}
