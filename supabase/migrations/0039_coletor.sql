-- Appura Coletor (Windows): instalações (cliente/grupo com um ou mais CNPJs), máquinas com token próprio e registro dos envios.
-- Só tabelas novas; nada existente é alterado. O token nunca é guardado: só o hash SHA-256 e um prefixo para identificação.
-- Rollback: supabase/rollback/0039_coletor_down.sql (só com confirmação).

create table if not exists public.coletor_instalacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(nome) between 2 and 120),
  observacao text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por text,
  atualizado_em timestamptz not null default now()
);
alter table public.coletor_instalacoes enable row level security;

-- CNPJs que a instalação atende (um grupo pode ter vários; um CNPJ pode estar em mais de uma instalação, ex.: matriz e filial em lojas separadas)
create table if not exists public.coletor_instalacao_empresas (
  instalacao_id uuid not null references public.coletor_instalacoes(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  primary key (instalacao_id, empresa_id)
);
create index if not exists coletor_instalacao_empresas_empresa on public.coletor_instalacao_empresas (empresa_id);
alter table public.coletor_instalacao_empresas enable row level security;

create table if not exists public.coletor_maquinas (
  id uuid primary key default gen_random_uuid(),
  instalacao_id uuid not null references public.coletor_instalacoes(id) on delete cascade,
  nome text not null check (length(nome) between 1 and 80),
  token_hash text not null unique,
  token_prefixo text not null,
  criado_em timestamptz not null default now(),
  criado_por text,
  revogado_em timestamptz,
  revogado_por text,
  -- Preenchido pelo próprio coletor
  pareado_em timestamptz,
  ultimo_contato_em timestamptz,
  ultimo_envio_em timestamptz,
  versao text,
  hostname text,
  sistema text,
  pastas jsonb,
  pendentes integer,
  enviados_total bigint not null default 0,
  ultimo_erro text
);
create index if not exists coletor_maquinas_instalacao on public.coletor_maquinas (instalacao_id);
alter table public.coletor_maquinas enable row level security;

create table if not exists public.coletor_envios (
  id bigint generated always as identity primary key,
  maquina_id uuid not null references public.coletor_maquinas(id) on delete cascade,
  recebido_em timestamptz not null default now(),
  arquivos integer not null default 0,
  importadas integer not null default 0,
  completou_resumo integer not null default 0,
  ja_existiam integer not null default 0,
  rejeitadas integer not null default 0,
  rejeitadas_sefaz integer not null default 0,
  fora_da_instalacao integer not null default 0,
  bytes integer not null default 0,
  duracao_ms integer,
  motivos jsonb,
  erro text
);
create index if not exists coletor_envios_maquina on public.coletor_envios (maquina_id, recebido_em desc);
alter table public.coletor_envios enable row level security;
