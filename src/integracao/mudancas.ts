/**
 * Registro de mudanças das notas para a API de integração (cursor e webhook). É chamado no ponto em que toda nota é
 * gravada (sync.ts/processarDoc: SEFAZ, importação manual e Appura Coletor). Nunca atrapalha a captação: se falhar,
 * só registra no log.
 */
import { Db } from '../db';
import { log } from '../log';

export type TipoMudanca = 'gravado' | 'cancelado';

export async function registrarMudancas(db: Db, itens: { empresa_id: string; chave: string; tipo: TipoMudanca }[]): Promise<void> {
  if (!itens.length) return;
  try {
    const { error } = await db.from('integracao_mudancas').insert(itens);
    if (error) log.warn('integração: mudança não registrada', { erro: error.message, chaves: itens.length });
  } catch (e) {
    log.warn('integração: mudança não registrada', { erro: (e as Error).message });
  }
}
