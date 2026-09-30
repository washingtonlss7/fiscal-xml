/** Tratamento de apontamentos da auditoria (mesma regra para o painel e o MCP). */
import { Db, ok } from '../db';

export class ErroApontamento extends Error {
  constructor(public readonly status: number, msg: string) {
    super(msg);
  }
}

const CFOP_ENTRADA_VALIDO = /^[123]\d{3}$/;
const CST_PIS_VALIDO = /^\d{2}$/;

/** Marca um apontamento como ajustado/ignorado/aberto e, quando é o caso, grava o ajuste no item. */
export async function resolverApontamento(db: Db, a: any, acao: string, observacao: string | null, valor: string | null, email: string) {
  const agora = new Date().toISOString();
  if (acao === 'reabrir') {
    ok(await db.from('apontamentos').update({ status: 'aberto', resolvido_por: null, resolvido_em: null, atualizado_em: agora }).eq('id', a.id), 'reabrir');
    return;
  }
  if (acao !== 'resolver' && acao !== 'ignorar') throw new ErroApontamento(400, 'Ação inválida.');

  if (acao === 'resolver' && a.chave && a.n_item) {
    const campo: string | undefined = a.regra === 'CFOP_ENTRADA_INDEFINIDO' ? 'cfop_escrit' : a.sugestao?.campo;
    const v = valor ?? a.sugestao?.valor ?? null;
    if (campo && v) {
      let alteracao: Record<string, unknown>;
      if (campo === 'cfop_escrit') {
        if (!CFOP_ENTRADA_VALIDO.test(v)) throw new ErroApontamento(422, 'Informe um CFOP de entrada válido (1xxx, 2xxx ou 3xxx).');
        alteracao = { cfop_escrit: v };
      } else if (campo === 'cst_pis_cofins_escrit') {
        if (!CST_PIS_VALIDO.test(v)) throw new ErroApontamento(422, 'CST de PIS/COFINS inválido.');
        alteracao = { cst_pis_escrit: v, cst_cofins_escrit: v };
      } else {
        throw new ErroApontamento(400, 'Ajuste não suportado para este apontamento.');
      }
      ok(
        await db.from('documento_itens').update({ ...alteracao, ajustado_por: email, ajustado_em: agora })
          .eq('empresa_id', a.empresa_id).eq('chave', a.chave).eq('n_item', a.n_item),
        'ajustar item',
      );
    } else if (a.regra === 'CFOP_ENTRADA_INDEFINIDO') {
      throw new ErroApontamento(422, 'Informe o CFOP de entrada.');
    }
  }
  ok(
    await db.from('apontamentos').update({
      status: acao === 'resolver' ? 'ajustado' : 'ignorado',
      observacao: observacao ?? a.observacao ?? null,
      resolvido_por: email,
      resolvido_em: agora,
      atualizado_em: agora,
    }).eq('id', a.id),
    'resolver apontamento',
  );
}
