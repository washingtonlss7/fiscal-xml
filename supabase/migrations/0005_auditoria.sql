-- Fase 3: auditoria das notas e ajustes para escrituração.

-- Valores "para escrituração" de cada item (sugeridos pela auditoria ou ajustados pelo contador).
alter table public.documento_itens
  add column cfop_escrit varchar(4),
  add column cst_pis_escrit varchar(2),
  add column cst_cofins_escrit varchar(2),
  add column monofasico boolean,
  add column ajustado_por text,
  add column ajustado_em timestamptz;

-- Notas que precisam (re)passar pela auditoria.
alter table public.documentos add column auditado boolean not null default false;
create index documentos_auditar on public.documentos (empresa_id, emitida_em) where not auditado;

-- Apontamentos da auditoria. "referencia" identifica o apontamento de forma estável
-- (chave + item, série + número, ou a competência, nos apontamentos agregados).
create table public.apontamentos (
  id            bigserial primary key,
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  competencia   date not null,              -- primeiro dia do mês
  regra         text not null,
  severidade    text not null check (severidade in ('erro', 'alerta', 'info')),
  referencia    text not null,
  chave         char(44),
  n_item        smallint,
  mensagem      text not null,
  sugestao      jsonb,                      -- ex.: {"campo": "cfop_escrit", "valor": "1403"}
  quantidade    integer not null default 1, -- apontamentos agregados (ex.: CT-e sem tomador)
  status        text not null default 'aberto' check (status in ('aberto', 'ajustado', 'ignorado')),
  observacao    text,
  resolvido_por text,
  resolvido_em  timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, regra, referencia)
);
create index apontamentos_empresa_mes on public.apontamentos (empresa_id, competencia, status);
alter table public.apontamentos enable row level security;

-- Lista de empresas do painel: pendências da auditoria
create or replace view public.vw_painel_empresas with (security_invoker = true) as
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
  end as status,
  e.escritorio,
  e.manifestar_ciencia,
  (select count(*) from public.apontamentos a
    where a.empresa_id = e.id and a.status = 'aberto' and a.severidade in ('erro', 'alerta')) as pendencias_auditoria
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
