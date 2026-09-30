-- Situação dos serviços (coletor, migração para o R2), para diagnóstico sem depender dos logs do servidor.
create table if not exists public.sistema_status (
  chave          text primary key,
  valor          jsonb not null,
  atualizado_em  timestamptz not null default now()
);
alter table public.sistema_status enable row level security;
