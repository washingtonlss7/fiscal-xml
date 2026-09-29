-- Funções de apoio à auditoria.

-- Empresas/competências com notas ainda não auditadas (e já detalhadas, quando completas).
create or replace function public.meses_para_auditar(p_limite int)
returns table (empresa_id uuid, competencia date)
language sql stable security invoker
set search_path = public
as $$
  select d.empresa_id, date_trunc('month', d.emitida_em at time zone 'America/Sao_Paulo')::date as competencia
  from public.documentos d
  where not d.auditado and d.emitida_em is not null
  group by 1, 2
  having bool_and(not d.completo or d.itens_extraidos or d.extracao_erro is not null)
  order by 2 desc
  limit p_limite;
$$;

-- Grava CFOP/CST de escrituração e a marca de monofásico sugeridos pela auditoria,
-- sem tocar nos itens que o contador ajustou manualmente.
create or replace function public.aplicar_sugestoes_itens(p_empresa uuid, p_itens jsonb)
returns integer
language sql volatile security invoker
set search_path = public
as $$
  with dados as (
    select * from jsonb_to_recordset(p_itens)
      as x(chave text, n_item int, cfop_escrit text, cst_pis_escrit text, cst_cofins_escrit text, monofasico boolean)
  ), alterados as (
    update public.documento_itens i
       set cfop_escrit = d.cfop_escrit,
           cst_pis_escrit = d.cst_pis_escrit,
           cst_cofins_escrit = d.cst_cofins_escrit,
           monofasico = d.monofasico
      from dados d
     where i.empresa_id = p_empresa and i.chave = d.chave and i.n_item = d.n_item
       and i.ajustado_em is null
    returning 1
  )
  select count(*)::int from alterados;
$$;

revoke execute on function public.meses_para_auditar(int) from public, anon, authenticated;
revoke execute on function public.aplicar_sugestoes_itens(uuid, jsonb) from public, anon, authenticated;
