-- Visão Geral do painel: uma chamada só, com tudo agregado no banco (sem uma consulta por empresa).
-- Devolve, para a competência (1º dia do mês):
--   empresas:  situação atual de cada empresa + notas da competência + auditoria da competência
--   captacao:  1º dia em que cada empresa recebeu nota da competência (para a curva de evolução)
--   auditoria: apontamentos da competência tratados por dia (para a curva de evolução)
create or replace function public.painel_visao_geral(p_competencia date)
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
  docs as (
    select d.empresa_id,
           count(*) as notas,
           count(*) filter (where d.completo and not d.auditado) as nao_auditadas,
           max(d.capturado_em) as ultima_nota_em,
           min((d.capturado_em at time zone 'America/Sao_Paulo')::date) as primeira_captura
      from documentos d, lim
     where d.emitida_em >= lim.ini and d.emitida_em < lim.fim
     group by d.empresa_id
  ),
  apont as (
    select a.empresa_id,
           count(*) filter (where a.status = 'aberto' and a.severidade in ('erro', 'alerta')) as abertos,
           count(*) as total
      from apontamentos a, lim
     where a.competencia = lim.comp
     group by a.empresa_id
  ),
  tratados as (
    select a.empresa_id, (a.resolvido_em at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
      from apontamentos a, lim
     where a.competencia = lim.comp and a.status <> 'aberto' and a.resolvido_em is not null
     group by 1, 2
  )
  select jsonb_build_object(
    'competencia', (select comp from lim),
    'geradoEm', now(),
    'empresas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'cnpj', v.cnpj, 'razao_social', v.razao_social, 'uf', v.uf, 'regime', v.regime,
        'ativo', v.ativo, 'escritorio', v.escritorio, 'criado_em', v.criado_em, 'status', v.status,
        'certificado_valido_ate', v.certificado_valido_ate, 'dias_para_vencer', v.dias_para_vencer,
        'ultima_sync_ok_em', v.ultima_sync_ok_em,
        'notas_mes', coalesce(d.notas, 0), 'nao_auditadas', coalesce(d.nao_auditadas, 0),
        'ultima_nota_em', d.ultima_nota_em,
        'apont_abertos', coalesce(a.abertos, 0), 'apont_total', coalesce(a.total, 0)
      ) order by v.razao_social)
        from vw_painel_empresas v
        left join docs d on d.empresa_id = v.id
        left join apont a on a.empresa_id = v.id
    ), '[]'::jsonb),
    'captacao', coalesce((
      select jsonb_agg(jsonb_build_object('empresa_id', empresa_id, 'dia', primeira_captura)) from docs
    ), '[]'::jsonb),
    'auditoria', coalesce((
      select jsonb_agg(jsonb_build_object('empresa_id', empresa_id, 'dia', dia, 'n', n)) from tratados
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.painel_visao_geral(date) from public, anon, authenticated;
