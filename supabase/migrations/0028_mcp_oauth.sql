-- MCP do Appura: servidor de autorização OAuth 2.1 próprio (PKCE S256, resource indicator) e tokens pessoais.
-- Só guardamos o hash SHA-256 de códigos e tokens: o valor aberto nunca fica no banco.

-- Clientes OAuth: registro dinâmico (RFC 7591) ou documento de metadados (Client ID Metadata Document, em cache).
create table if not exists public.mcp_clientes (
  client_id text primary key,
  nome text not null,
  redirect_uris text[] not null,
  origem text not null check (origem in ('dcr', 'cimd')),
  criado_em timestamptz not null default now(),
  ultimo_uso_em timestamptz
);
alter table public.mcp_clientes enable row level security;

-- Códigos de autorização (uso único, 5 minutos).
create table if not exists public.mcp_codigos (
  codigo_hash text primary key,
  client_id text not null,
  email text not null,
  redirect_uri text not null,
  code_challenge text not null,
  resource text not null,
  scope text,
  expira_em timestamptz not null,
  usado_em timestamptz
);
alter table public.mcp_codigos enable row level security;

-- Tokens: acesso (1 h), refresh (30 dias, rotativo) e pessoal (criado no painel, com nome e validade).
create table if not exists public.mcp_tokens (
  token_hash text primary key,
  tipo text not null check (tipo in ('acesso', 'refresh', 'pessoal')),
  email text not null,
  client_id text,
  nome text,
  resource text not null,
  scope text,
  familia text,
  final_token text,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null,
  ultimo_uso_em timestamptz,
  revogado_em timestamptz
);
create index if not exists mcp_tokens_email on public.mcp_tokens (email, tipo);
create index if not exists mcp_tokens_familia on public.mcp_tokens (familia);
alter table public.mcp_tokens enable row level security;

-- Cada chamada de ferramenta pela IA (quem, qual ferramenta, quando, resultado).
create table if not exists public.mcp_chamadas (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  email text not null,
  client_id text,
  ferramenta text not null,
  argumentos jsonb,
  sucesso boolean not null,
  duracao_ms integer
);
create index if not exists mcp_chamadas_em on public.mcp_chamadas (em desc);
alter table public.mcp_chamadas enable row level security;
