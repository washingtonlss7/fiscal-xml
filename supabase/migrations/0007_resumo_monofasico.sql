-- Resumo de produtos monofásicos no mês (compras e vendas), para a tela de auditoria.
create or replace function public.resumo_monofasico(p_empresa uuid, p_de timestamptz, p_ate timestamptz)
returns table (direcao text, total numeric, monofasico numeric)
language sql stable security invoker
set search_path = public
as $$
  select d.direcao,
         coalesce(sum(i.v_prod), 0) as total,
         coalesce(sum(i.v_prod) filter (where i.monofasico), 0) as monofasico
  from public.documentos d
  join public.documento_itens i on i.empresa_id = d.empresa_id and i.chave = d.chave
  where d.empresa_id = p_empresa and d.emitida_em >= p_de and d.emitida_em < p_ate
    and d.situacao = 'autorizada' and d.modelo in ('55', '65')
  group by d.direcao;
$$;

revoke execute on function public.resumo_monofasico(uuid, timestamptz, timestamptz) from public, anon, authenticated;
