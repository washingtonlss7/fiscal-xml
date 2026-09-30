-- Gestão de usuários pelo painel: perfil (administrador ou operador) e registro das ações.
alter table public.painel_usuarios
  add column if not exists perfil text not null default 'operador' check (perfil in ('admin', 'operador')),
  add column if not exists atualizado_em timestamptz not null default now(),
  add column if not exists criado_por text;

-- Os usuários cadastrados até aqui são administradores (pedido do escritório).
update public.painel_usuarios set perfil = 'admin'
 where email in ('supervisorfiscal@contabilfarma.com.br', 'fiscal03@contabilfarma.com.br', 'administrativo03@contabilfarma.com.br');

create table if not exists public.painel_usuarios_log (
  id        bigint generated always as identity primary key,
  em        timestamptz not null default now(),
  por       text not null,
  acao      text not null check (acao in ('criar', 'editar', 'desativar', 'reativar', 'redefinir_senha', 'excluir')),
  alvo      text not null,
  detalhes  jsonb
);
create index if not exists painel_usuarios_log_em on public.painel_usuarios_log (em desc);
alter table public.painel_usuarios_log enable row level security;
