import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type Db = SupabaseClient;

export function criarDb(url: string, serviceKey: string): Db {
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Lança erro se a operação do Supabase falhou. */
export function ok<T>(r: { data: T; error: { message: string } | null }, contexto: string): T {
  if (r.error) throw new Error(`${contexto}: ${r.error.message}`);
  return r.data;
}

/** Busca todas as linhas, paginando (o PostgREST devolve no máximo 1000 por vez). */
export async function buscarTodos<T>(
  consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  contexto: string,
): Promise<T[]> {
  const tamanho = 1000;
  const todos: T[] = [];
  for (let de = 0; ; de += tamanho) {
    const pagina = ok(await consulta(de, de + tamanho - 1), contexto) ?? [];
    todos.push(...pagina);
    if (pagina.length < tamanho) return todos;
  }
}
