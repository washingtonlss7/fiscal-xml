-- Schema inicial do coletor fiscal (NF-e / CT-e via DistribuicaoDFe)
-- Aplicar num projeto Supabase novo (SQL Editor ou `supabase db push`).

create extension if not exists pgcrypto;

-- Empresas (clientes do escritório)
create table public.empresas (
  id            uuid primary key default gen_random_uuid(),
  cnpj          char(14) not null unique check (cnpj ~ '^[0-9]{14}$'),
  razao_social  text not null,
  uf            char(2) not null,
  c_uf          smallint not null,               -- código IBGE da UF (ES = 32)
  regime        text check (regime in ('mei','simples','presumido','real')),
  codigo_erp    text,                            -- código da empresa no sistema contábil
  captar_nfe    boolean not null default true,
  captar_cte    boolean not null default true,
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

-- Certificados A1 (PFX e senha cifrados com AES-256-GCM; a chave fica fora do banco)
create table public.certificados (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references public.empresas(id) on delete cascade,
  cnpj_certificado  char(14),
  titular           text not null,
  valido_de         timestamptz not null,
  valido_ate        timestamptz not null,
  pfx_cifrado       text not null,
  senha_cifrada     text not null,
  ativo             boolean not null default true,
  criado_em         timestamptz not null default now()
);
create unique index certificados_um_ativo on public.certificados(empresa_id) where ativo;

-- Controle de NSU por empresa e modelo
create table public.sync_state (
  empresa_id           uuid not null references public.empresas(id) on delete cascade,
  modelo               text not null check (modelo in ('nfe','cte')),
  ult_nsu              varchar(15) not null default '000000000000000',
  max_nsu              varchar(15),
  proxima_consulta_em  timestamptz not null default now(),
  ultima_consulta_em   timestamptz,
  ultima_sync_ok_em    timestamptz,
  ultimo_cstat         text,
  ultimo_motivo        text,
  erros_consecutivos   integer not null default 0,
  primary key (empresa_id, modelo)
);

-- Documentos fiscais (um registro por chave e empresa)
create table public.documentos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  modelo           char(2) not null,             -- 55 NF-e, 57 CT-e, 65 NFC-e
  chave            char(44) not null,
  direcao          text not null check (direcao in ('entrada','saida')),
  completo         boolean not null default false, -- false = só resumo (resNFe)
  numero           text,
  serie            text,
  emitida_em       timestamptz,
  emit_cnpj        varchar(14),
  emit_nome        text,
  dest_doc         varchar(14),
  dest_nome        text,
  valor            numeric(15,2),
  situacao         text not null default 'autorizada' check (situacao in ('autorizada','cancelada','denegada')),
  protocolo        text,
  nsu              varchar(15),
  xml_path         text,
  xml_resumo_path  text,
  manifestacao     text,
  capturado_em     timestamptz not null default now(),
  atualizado_em    timestamptz not null default now(),
  unique (empresa_id, chave)
);
create index documentos_empresa_data on public.documentos(empresa_id, emitida_em desc);
create index documentos_pendentes on public.documentos(empresa_id) where not completo;
create index documentos_chave on public.documentos(chave);

-- Eventos (cancelamento, CC-e, manifestações...)
create table public.eventos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  chave         char(44) not null,
  tp_evento     varchar(6) not null,
  n_seq         smallint not null default 1,
  descricao     text,
  ocorrido_em   timestamptz,
  protocolo     text,
  nsu           varchar(15),
  xml_path      text,
  capturado_em  timestamptz not null default now(),
  unique (empresa_id, chave, tp_evento, n_seq)
);
create index eventos_chave on public.eventos(chave);

-- Todo NSU recebido (auditoria e detecção de lacunas)
create table public.dfe_recebidos (
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  modelo       text not null,
  nsu          varchar(15) not null,
  schema       text not null,
  chave        char(44),
  recebido_em  timestamptz not null default now(),
  primary key (empresa_id, modelo, nsu)
);

-- Pedidos de sincronização manual (botão "Sincronizar agora" do painel)
create table public.sync_requests (
  id             bigserial primary key,
  empresa_id     uuid not null references public.empresas(id) on delete cascade,
  solicitado_em  timestamptz not null default now(),
  status         text not null default 'pendente' check (status in ('pendente','processando','concluido','erro')),
  processado_em  timestamptz,
  mensagem       text
);
create index sync_requests_pendentes on public.sync_requests(solicitado_em) where status = 'pendente';

-- Log de cada chamada à SEFAZ
create table public.logs_sefaz (
  id                  bigserial primary key,
  empresa_id          uuid references public.empresas(id) on delete set null,
  modelo              text,
  cstat               text,
  motivo              text,
  ult_nsu_enviado     varchar(15),
  ult_nsu_retornado   varchar(15),
  max_nsu             varchar(15),
  qtd_docs            integer,
  duracao_ms          integer,
  erro                text,
  criado_em           timestamptz not null default now()
);
create index logs_sefaz_empresa on public.logs_sefaz(empresa_id, criado_em desc);

-- RLS ligado em tudo. O coletor usa a service_role (ignora RLS);
-- as políticas do painel entram junto com a autenticação.
alter table public.empresas       enable row level security;
alter table public.certificados   enable row level security;
alter table public.sync_state     enable row level security;
alter table public.documentos     enable row level security;
alter table public.eventos        enable row level security;
alter table public.dfe_recebidos  enable row level security;
alter table public.sync_requests  enable row level security;
alter table public.logs_sefaz     enable row level security;

-- Saúde de cada empresa, para o painel e para alertas
create view public.vw_saude_empresas with (security_invoker = true) as
select
  e.id,
  e.cnpj,
  e.razao_social,
  c.valido_ate as certificado_valido_ate,
  (c.valido_ate::date - current_date) as dias_para_vencer,
  min(s.ultima_sync_ok_em) as ultima_sync_ok_em,
  max(s.erros_consecutivos) as erros_consecutivos,
  case
    when c.id is null then 'sem_certificado'
    when c.valido_ate < now() then 'certificado_vencido'
    when min(s.ultima_sync_ok_em) is null
      or min(s.ultima_sync_ok_em) < now() - interval '36 hours' then 'sincronizacao_atrasada'
    when c.valido_ate < now() + interval '30 days' then 'certificado_vencendo'
    else 'ok'
  end as status
from public.empresas e
left join public.certificados c on c.empresa_id = e.id and c.ativo
left join public.sync_state s on s.empresa_id = e.id
where e.ativo
group by e.id, c.id;

-- Bucket privado para os XMLs (gzip)
insert into storage.buckets (id, name, public)
values ('xmls', 'xmls', false)
on conflict (id) do nothing;
