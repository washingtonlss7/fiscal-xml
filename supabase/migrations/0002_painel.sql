-- View usada pelo painel web: uma linha por empresa com status, certificado e sincronização.

create view public.vw_painel_empresas with (security_invoker = true) as
select
  e.id,
  e.cnpj,
  e.razao_social,
  e.uf,
  e.regime,
  e.codigo_erp,
  e.ativo,
  e.criado_em,
  c.titular,
  c.valido_ate as certificado_valido_ate,
  (c.valido_ate::date - current_date) as dias_para_vencer,
  s.ultima_sync_ok_em,
  s.proxima_consulta_em,
  coalesce(s.erros, 0) as erros_consecutivos,
  s.ultimo_cstat,
  s.ultimo_motivo,
  (select count(*) from public.documentos d
    where d.empresa_id = e.id and d.emitida_em >= now() - interval '30 days') as documentos_30d,
  exists (select 1 from public.sync_requests r
    where r.empresa_id = e.id and r.status in ('pendente', 'processando')) as sincronizacao_pedida,
  case
    when not e.ativo then 'pausada'
    when c.id is null then 'sem_certificado'
    when c.valido_ate < now() then 'certificado_vencido'
    when coalesce(s.erros, 0) > 0 then 'erro'
    when s.ultima_sync_ok_em is null then 'aguardando'
    when s.ultima_sync_ok_em < now() - interval '36 hours' then 'atrasada'
    when c.valido_ate < now() + interval '30 days' then 'certificado_vencendo'
    else 'ok'
  end as status
from public.empresas e
left join public.certificados c on c.empresa_id = e.id and c.ativo
left join lateral (
  select
    min(ss.ultima_sync_ok_em) as ultima_sync_ok_em,
    max(ss.proxima_consulta_em) as proxima_consulta_em,
    max(ss.erros_consecutivos) as erros,
    (array_agg(ss.ultimo_cstat order by ss.ultima_consulta_em desc nulls last))[1] as ultimo_cstat,
    (array_agg(ss.ultimo_motivo order by ss.ultima_consulta_em desc nulls last))[1] as ultimo_motivo
  from public.sync_state ss
  where ss.empresa_id = e.id
) s on true;
