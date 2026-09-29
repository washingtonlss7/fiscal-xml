-- Usuários com acesso ao painel (além dos e-mails fixos em PAINEL_EMAILS).
create table if not exists public.painel_usuarios (
  email      text primary key check (email = lower(email)),
  nome       text,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);
alter table public.painel_usuarios enable row level security;
