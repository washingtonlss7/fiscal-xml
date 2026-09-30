-- Empresa 360°: uma chamada só com cadastro, certificado, captação, números da competência e histórico real.
create or replace function public.painel_empresa_360(p_empresa uuid, p_competencia date)
returns jsonb
language sql
stable
set search_path = public
as $$
  with lim as (
    select (date_trunc('month', p_competencia)::timestamp at time zone 'America/Sao_Paulo') as ini,
           ((date_trunc('month', p_competencia) + interval '1 month')::timestamp at time zone 'America/Sao_Paulo') as fim,
           date_trunc('month', p_competencia)::date as comp
  ),
  hist as (
    (select 'sefaz' as tipo, l.criado_em as em, null::text as por,
            jsonb_build_object('modelo', l.modelo, 'cstat', l.cstat, 'motivo', l.motivo, 'qtd', l.qtd_docs, 'erro', l.erro) as dados
       from logs_sefaz l
      where l.empresa_id = p_empresa and (coalesce(l.qtd_docs, 0) > 0 or l.erro is not null or coalesce(l.cstat, '') not in ('137', '138'))
      order by l.criado_em desc limit 40)
    union all
    (select 'pedido', r.solicitado_em, null, jsonb_build_object('status', r.status, 'mensagem', r.mensagem, 'processado_em', r.processado_em)
       from sync_requests r where r.empresa_id = p_empresa order by r.solicitado_em desc limit 20)
    union all
    (select 'auditoria', date_trunc('minute', a.resolvido_em), a.resolvido_por,
            jsonb_build_object('status', a.status, 'n', count(*), 'competencia', min(a.competencia))
       from apontamentos a where a.empresa_id = p_empresa and a.resolvido_em is not null
      group by date_trunc('minute', a.resolvido_em), a.resolvido_por, a.status
      order by 2 desc limit 40)
    union all
    (select 'importacao', date_trunc('minute', d.capturado_em), null, jsonb_build_object('n', count(*))
       from documentos d where d.empresa_id = p_empresa and d.recebido_via = 'importacao'
      group by date_trunc('minute', d.capturado_em) order by 2 desc limit 20)
    union all
    (select 'certificado', c.criado_em, null, jsonb_build_object('titular', c.titular, 'valido_ate', c.valido_ate, 'ativo', c.ativo)
       from certificados c where c.empresa_id = p_empresa order by c.criado_em desc limit 10)
  )
  select case when not exists (select 1 from empresas where id = p_empresa) then null else jsonb_build_object(
    'competencia', (select comp from lim),
    'geradoEm', now(),
    'empresa', (select to_jsonb(v) from vw_painel_empresas v where v.id = p_empresa),
    'certificado', (select jsonb_build_object('titular', c.titular, 'valido_de', c.valido_de, 'valido_ate', c.valido_ate, 'criado_em', c.criado_em)
                      from certificados c where c.empresa_id = p_empresa and c.ativo order by c.criado_em desc limit 1),
    'captacao', coalesce((select jsonb_agg(jsonb_build_object(
        'modelo', s.modelo, 'ultima_consulta_em', s.ultima_consulta_em, 'ultima_sync_ok_em', s.ultima_sync_ok_em,
        'proxima_consulta_em', s.proxima_consulta_em, 'ultimo_cstat', s.ultimo_cstat, 'ultimo_motivo', s.ultimo_motivo,
        'erros_consecutivos', s.erros_consecutivos) order by s.modelo)
      from sync_state s where s.empresa_id = p_empresa), '[]'::jsonb),
    'documentos', coalesce((select jsonb_agg(x) from (
        select d.modelo, d.direcao, count(*) as n,
               count(*) filter (where d.situacao = 'cancelada') as canceladas,
               count(*) filter (where not d.completo) as so_resumo,
               count(*) filter (where d.completo and not d.auditado) as nao_auditadas
          from documentos d, lim
         where d.empresa_id = p_empresa and d.emitida_em >= lim.ini and d.emitida_em < lim.fim
         group by d.modelo, d.direcao) x), '[]'::jsonb),
    'auditoria', coalesce((select jsonb_agg(x) from (
        select a.status, a.severidade, count(*) as n
          from apontamentos a, lim
         where a.empresa_id = p_empresa and a.competencia = lim.comp
         group by a.status, a.severidade) x), '[]'::jsonb),
    'historico', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'em', em, 'por', por, 'dados', dados) order by em desc)
                             from (select * from hist where em is not null order by em desc limit 80) h), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.painel_empresa_360(uuid, date) from public, anon, authenticated;
