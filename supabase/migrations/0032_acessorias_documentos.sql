-- Acessórias, parte 2: documentos do mês (além do DAS) enviados pelo e-Contínuo e leitura de empresas e entregas.

-- Documentos de entrega do mês: recibos e guias em PDF que vão para a Acessórias.
-- origem 'upload' (enviado pelo escritório) ou 'pgdas' (recibo/declaração/MAED devolvidos na transmissão do PGDAS-D).
create table if not exists public.documentos_entrega (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null,
  tipo text not null check (tipo in ('recibo_sped_fiscal', 'recibo_sped_contribuicoes', 'darf', 'dctfweb', 'reinf', 'icms', 'pgdas_recibo', 'pgdas_declaracao', 'maed', 'outro')),
  descricao text,
  nome text not null,
  caminho text not null,
  tamanho integer not null,
  hash text not null,
  origem text not null default 'upload' check (origem in ('upload', 'pgdas')),
  apuracao_id bigint references public.apuracoes_simples(id) on delete set null,
  criado_em timestamptz not null default now(),
  criado_por text not null,
  unique (empresa_id, hash)
);
create index if not exists documentos_entrega_comp on public.documentos_entrega (competencia, empresa_id);
alter table public.documentos_entrega enable row level security;

create table if not exists public.documentos_entrega_envios (
  id bigint generated always as identity primary key,
  documento_id bigint not null references public.documentos_entrega(id) on delete cascade,
  status text not null check (status in ('enviado', 'erro')),
  mensagem text,
  caminho_destino text,
  status_http integer,
  enviado_em timestamptz not null default now(),
  enviado_por text not null
);
create index if not exists documentos_entrega_envios_doc on public.documentos_entrega_envios (documento_id, enviado_em desc);
alter table public.documentos_entrega_envios enable row level security;

-- Cadastro das empresas na Acessórias (cópia da última sincronização), com o resumo das obrigações.
create table if not exists public.acessorias_empresas (
  cnpj text primary key,
  id_acessorias text,
  razao text,
  fantasia text,
  ativa boolean not null default true,
  obrigacoes jsonb not null default '[]'::jsonb,
  sincronizado_em timestamptz not null default now()
);
alter table public.acessorias_empresas enable row level security;

-- Entregas (obrigações) de uma empresa na competência, como a Acessórias devolveu na última consulta.
create table if not exists public.acessorias_entregas (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null,
  entregas jsonb not null default '[]'::jsonb,
  erro text,
  consultado_em timestamptz not null default now(),
  consultado_por text not null,
  primary key (empresa_id, competencia)
);
alter table public.acessorias_entregas enable row level security;
