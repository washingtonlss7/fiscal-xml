-- Integração com o Sistema Acessórias: as guias em PDF vão pelo e-Contínuo (POST /econtinuo),
-- que lê CNPJ, competência, vencimento e valor do próprio PDF e baixa a entrega da obrigação.

-- Token de API (por usuário da Acessórias), cifrado com a MASTER_KEY; a API do Appura nunca devolve o valor.
create table if not exists public.integracoes (
  servico text primary key check (servico in ('acessorias')),
  token_cifrado text not null,
  final_token text,
  envio_automatico boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por text not null
);
alter table public.integracoes enable row level security;

-- Cada tentativa de envio de guia (quem, quando, resposta da Acessórias).
create table if not exists public.guias_envios (
  id bigint generated always as identity primary key,
  guia_id bigint not null references public.guias(id) on delete cascade,
  destino text not null default 'acessorias',
  status text not null check (status in ('enviado', 'erro')),
  mensagem text,
  caminho_destino text,
  status_http integer,
  enviado_em timestamptz not null default now(),
  enviado_por text not null
);
create index if not exists guias_envios_guia on public.guias_envios (guia_id, enviado_em desc);
alter table public.guias_envios enable row level security;
