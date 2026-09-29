-- Fase 1 (conclusão) e 2: manifestação, notas do escritório via autXML e extração de itens/tributos.

-- Empresas: certificado do escritório e opção de manifestação automática
alter table public.empresas
  add column escritorio boolean not null default false,
  add column manifestar_ciencia boolean not null default true;

-- Documentos: manifestação e dados extraídos do XML completo
alter table public.documentos
  add column manifestacao_em timestamptz,
  add column manifestacao_status text,
  add column manifestacao_motivo text,
  add column recebido_via text not null default 'proprio' check (recebido_via in ('proprio', 'autxml')),
  add column tp_nf smallint,
  add column nat_op text,
  add column fin_nfe smallint,
  add column ind_final smallint,
  add column crt_emit smallint,
  add column uf_emit char(2),
  add column uf_dest char(2),
  add column cfop text,
  add column toma_doc varchar(14),
  add column uf_ini char(2),
  add column uf_fim char(2),
  add column v_prod numeric(15,2),
  add column v_desc numeric(15,2),
  add column v_frete numeric(15,2),
  add column v_seg numeric(15,2),
  add column v_outro numeric(15,2),
  add column v_bc_icms numeric(15,2),
  add column v_icms numeric(15,2),
  add column v_icms_deson numeric(15,2),
  add column v_fcp numeric(15,2),
  add column v_bc_st numeric(15,2),
  add column v_st numeric(15,2),
  add column v_fcp_st numeric(15,2),
  add column v_ipi numeric(15,2),
  add column v_pis numeric(15,2),
  add column v_cofins numeric(15,2),
  add column v_bc_ibscbs numeric(15,2),
  add column v_ibs numeric(15,2),
  add column v_cbs numeric(15,2),
  add column itens_extraidos boolean not null default false,
  add column extracao_erro text;

create index documentos_manifestar on public.documentos (empresa_id)
  where not completo and modelo = '55' and manifestacao_status is null;
create index documentos_extrair on public.documentos (capturado_em)
  where completo and not itens_extraidos;

-- Itens das notas (base da auditoria e da apuração)
create table public.documento_itens (
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  chave          char(44) not null,
  n_item         smallint not null,
  c_prod         text,
  ean            text,
  x_prod         text,
  ncm            varchar(8),
  cest           varchar(7),
  cfop           varchar(4),
  u_com          text,
  q_com          numeric(18,4),
  v_un_com       numeric(22,10),
  v_prod         numeric(15,2),
  v_desc         numeric(15,2),
  v_frete        numeric(15,2),
  v_seg          numeric(15,2),
  v_outro        numeric(15,2),
  orig           smallint,
  cst_icms       varchar(3),   -- CST (regime normal) ou CSOSN (Simples)
  csosn          boolean not null default false,
  mod_bc         smallint,
  p_red_bc       numeric(8,4),
  v_bc_icms      numeric(15,2),
  p_icms         numeric(8,4),
  v_icms         numeric(15,2),
  v_icms_deson   numeric(15,2),
  v_bc_fcp       numeric(15,2),
  p_fcp          numeric(8,4),
  v_fcp          numeric(15,2),
  v_bc_st        numeric(15,2),
  p_mva_st       numeric(8,4),
  p_icms_st      numeric(8,4),
  v_icms_st      numeric(15,2),
  v_fcp_st       numeric(15,2),
  cst_ipi        varchar(2),
  v_bc_ipi       numeric(15,2),
  p_ipi          numeric(8,4),
  v_ipi          numeric(15,2),
  cst_pis        varchar(2),
  v_bc_pis       numeric(15,2),
  p_pis          numeric(8,4),
  v_pis          numeric(15,2),
  cst_cofins     varchar(2),
  v_bc_cofins    numeric(15,2),
  p_cofins       numeric(8,4),
  v_cofins       numeric(15,2),
  cst_ibscbs     varchar(3),
  c_class_trib   varchar(6),
  v_bc_ibscbs    numeric(15,2),
  p_ibs_uf       numeric(8,4),
  v_ibs_uf       numeric(15,2),
  p_ibs_mun      numeric(8,4),
  v_ibs_mun      numeric(15,2),
  v_ibs          numeric(15,2),
  p_cbs          numeric(8,4),
  v_cbs          numeric(15,2),
  imposto        jsonb,        -- grupo <imposto> completo, para regras futuras
  primary key (empresa_id, chave, n_item)
);
create index documento_itens_ncm on public.documento_itens (empresa_id, ncm);
create index documento_itens_cfop on public.documento_itens (empresa_id, cfop);

-- Duplicatas (contas a pagar/receber)
create table public.documento_duplicatas (
  empresa_id  uuid not null references public.empresas(id) on delete cascade,
  chave       char(44) not null,
  n_dup       text not null,
  vencimento  date,
  valor       numeric(15,2),
  primary key (empresa_id, chave, n_dup)
);
create index documento_duplicatas_venc on public.documento_duplicatas (empresa_id, vencimento);

alter table public.documento_itens      enable row level security;
alter table public.documento_duplicatas enable row level security;

-- Painel: marca o escritório na lista
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
  e.manifestar_ciencia
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
