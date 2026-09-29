-- Agendador contínuo: o coletor pede ao banco as empresas cuja próxima consulta já venceu,
-- em vez de varrer todas as empresas em rodadas fixas.

create index if not exists sync_state_proxima on public.sync_state (proxima_consulta_em);

-- Empresas prontas para consultar a SEFAZ agora (mais atrasadas primeiro).
-- Só entram empresas ativas, com certificado ativo e dentro da validade.
create or replace function public.empresas_para_sincronizar(p_limite int, p_excluir uuid[] default '{}')
returns table (empresa_id uuid, vencida_desde timestamptz)
language sql stable security invoker
set search_path = public
as $$
  select s.empresa_id, min(s.proxima_consulta_em) as vencida_desde
  from sync_state s
  join empresas e on e.id = s.empresa_id and e.ativo
  join certificados c on c.empresa_id = e.id and c.ativo and c.valido_ate > now()
  where s.proxima_consulta_em <= now()
    and ((s.modelo = 'nfe' and e.captar_nfe) or (s.modelo = 'cte' and e.captar_cte))
    and not (s.empresa_id = any(coalesce(p_excluir, '{}')))
  group by s.empresa_id
  order by min(s.proxima_consulta_em)
  limit greatest(p_limite, 0);
$$;

-- Quantas empresas estão com a consulta vencida (para o resumo periódico no log).
create or replace function public.fila_sincronizacao()
returns table (vencidas bigint, mais_antiga timestamptz)
language sql stable security invoker
set search_path = public
as $$
  select count(*), min(vencida_desde) from public.empresas_para_sincronizar(100000);
$$;

-- Histórico de chamadas à SEFAZ: mantém só os últimos N dias.
create or replace function public.limpar_logs_sefaz(p_dias int default 60)
returns bigint
language sql volatile security invoker
set search_path = public
as $$
  with apagados as (
    delete from logs_sefaz where criado_em < now() - make_interval(days => p_dias) returning 1
  )
  select count(*) from apagados;
$$;

revoke execute on function public.empresas_para_sincronizar(int, uuid[]) from public, anon, authenticated;
revoke execute on function public.fila_sincronizacao() from public, anon, authenticated;
revoke execute on function public.limpar_logs_sefaz(int) from public, anon, authenticated;
