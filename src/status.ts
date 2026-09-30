import { Db } from './db';
import { log } from './log';

/** Grava a situação de um componente (ex.: "coletor", "migracao_r2") na tabela sistema_status. */
export async function registrarStatus(db: Db, chave: string, valor: Record<string, unknown>): Promise<void> {
  const r = await db.from('sistema_status').upsert({ chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' });
  if (r.error) log.warn('falha ao gravar sistema_status', { chave, erro: r.error.message });
}
