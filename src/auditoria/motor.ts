import { buscarTodos, Db, ok } from '../db';
import { log } from '../log';
import { emParalelo } from '../util';
import { auditar, EmpresaAuditoria, ItemAuditoria, NotaAuditoria, ResultadoAuditoria } from './regras';

const COLUNAS_NOTA =
  'chave,modelo,numero,serie,emitida_em,direcao,completo,situacao,emit_cnpj,emit_nome,dest_doc,crt_emit,uf_emit,uf_dest,' +
  'v_prod,toma_doc,manifestacao_status,manifestacao_motivo,itens_extraidos';
const COLUNAS_ITEM = 'chave,n_item,x_prod,ncm,cfop,cst_icms,csosn,v_prod,v_bc_icms,p_icms,v_icms,cst_pis,cst_cofins,cst_ibscbs';

const numero = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function intervaloMes(competencia: string) {
  const [a, m] = competencia.slice(0, 7).split('-').map(Number);
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  return { de: `${competencia.slice(0, 7)}-01T00:00:00-03:00`, ate: `${prox}-01T00:00:00-03:00`, inicio: `${competencia.slice(0, 7)}-01` };
}

/** Audita uma empresa em uma competência (mês) e grava apontamentos e sugestões. */
export async function auditarMes(db: Db, empresaId: string, competencia: string): Promise<ResultadoAuditoria> {
  const { de, ate, inicio } = intervaloMes(competencia);
  const empresa = ok(
    await db.from('empresas').select('cnpj,uf,regime').eq('id', empresaId).single(),
    'ler empresa',
  ) as EmpresaAuditoria;

  const notas = (await buscarTodos<any>(
    (a, b) => db.from('documentos').select(COLUNAS_NOTA).eq('empresa_id', empresaId).gte('emitida_em', de).lt('emitida_em', ate).range(a, b),
    'ler notas',
  )).map((n) => ({ ...n, v_prod: numero(n.v_prod) })) as NotaAuditoria[];

  const chaves = notas.filter((n) => n.completo && n.itens_extraidos && n.modelo !== '57').map((n) => n.chave);
  const itens: ItemAuditoria[] = [];
  for (let i = 0; i < chaves.length; i += 150) {
    const lote = chaves.slice(i, i + 150);
    const r = await buscarTodos<any>(
      (a, b) => db.from('documento_itens').select(COLUNAS_ITEM).eq('empresa_id', empresaId).in('chave', lote).range(a, b),
      'ler itens',
    );
    for (const it of r) {
      itens.push({ ...it, v_prod: numero(it.v_prod), v_bc_icms: numero(it.v_bc_icms), p_icms: numero(it.p_icms), v_icms: numero(it.v_icms) });
    }
  }

  const resultado = auditar(empresa, notas, itens);

  // Sugestões de escrituração (não altera itens ajustados manualmente)
  for (let i = 0; i < resultado.sugestoes.length; i += 1000) {
    ok(
      await db.rpc('aplicar_sugestoes_itens', { p_empresa: empresaId, p_itens: resultado.sugestoes.slice(i, i + 1000) }),
      'gravar sugestões',
    );
  }

  // Apontamentos: insere novos e atualiza os existentes sem mexer na decisão (status/observação)
  const agora = new Date().toISOString();
  const linhas = resultado.apontamentos.map((a) => ({ empresa_id: empresaId, competencia: inicio, ...a, atualizado_em: agora }));
  for (let i = 0; i < linhas.length; i += 500) {
    ok(
      await db.from('apontamentos').upsert(linhas.slice(i, i + 500), { onConflict: 'empresa_id,competencia,regra,referencia' }),
      'gravar apontamentos',
    );
  }
  // Apontamentos abertos que deixaram de existir (a nota foi corrigida/completada) são removidos
  const atuais = new Set(resultado.apontamentos.map((a) => `${a.regra}|${a.referencia}`));
  const abertos = ok(
    await db.from('apontamentos').select('id,regra,referencia').eq('empresa_id', empresaId).eq('competencia', inicio).eq('status', 'aberto'),
    'ler apontamentos abertos',
  ) as { id: number; regra: string; referencia: string }[];
  const obsoletos = abertos.filter((a) => !atuais.has(`${a.regra}|${a.referencia}`)).map((a) => a.id);
  for (let i = 0; i < obsoletos.length; i += 500) {
    ok(await db.from('apontamentos').delete().in('id', obsoletos.slice(i, i + 500)), 'remover apontamentos resolvidos');
  }

  // Marca as notas do mês como auditadas
  ok(
    await db.from('documentos').update({ auditado: true }).eq('empresa_id', empresaId).gte('emitida_em', de).lt('emitida_em', ate).eq('auditado', false),
    'marcar auditadas',
  );
  return resultado;
}

/** Processa os meses com notas novas ou alteradas. Chamado pelo coletor em segundo plano. */
export async function auditarPendentes(db: Db, limite = 5, paralelo = 1): Promise<number> {
  const meses = ok(await db.rpc('meses_para_auditar', { p_limite: limite }), 'listar meses para auditar') as {
    empresa_id: string;
    competencia: string;
  }[];
  await emParalelo(meses ?? [], paralelo, async (m) => {
    try {
      const r = await auditarMes(db, m.empresa_id, m.competencia);
      log.info('auditoria', { empresa: m.empresa_id, competencia: m.competencia, apontamentos: r.apontamentos.length, itens: r.resumo.itens });
    } catch (e) {
      log.error('falha na auditoria', { empresa: m.empresa_id, competencia: m.competencia, erro: (e as Error).message });
    }
  });
  return meses?.length ?? 0;
}

/** Reabre a auditoria do mês atual e do anterior (regras que dependem do tempo, como "só resumo há 3 dias"). */
export async function reauditarRecentes(db: Db): Promise<void> {
  const d = new Date(Date.now() - 3 * 3600_000);
  const anterior = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
  const de = `${anterior.toISOString().slice(0, 7)}-01T00:00:00-03:00`;
  ok(await db.from('documentos').update({ auditado: false }).gte('emitida_em', de).eq('auditado', true), 'reabrir auditoria recente');
}
