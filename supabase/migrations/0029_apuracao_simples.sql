-- Apuração do Simples Nacional (etapa B: prévia da segregação).
-- Ajustes manuais de receita (o que não está nas notas: serviço com NFS-e, venda sem nota emitida depois…).
-- Cada ajuste é de um estabelecimento (empresa) e competência, com justificativa obrigatória.
create table if not exists public.apuracao_ajustes (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null,
  valor numeric(15,2) not null check (valor <> 0),
  atividade smallint not null check (atividade in (1, 2, 3)),
  st boolean not null default false,
  monofasico boolean not null default false,
  justificativa text not null check (length(trim(justificativa)) >= 5),
  criado_por text not null,
  criado_em timestamptz not null default now(),
  constraint apuracao_ajustes_qualificacao check (atividade = 2 or (not st and not monofasico)),
  constraint apuracao_ajustes_atividade2 check (atividade <> 2 or st or monofasico)
);
create index if not exists apuracao_ajustes_empresa on public.apuracao_ajustes (empresa_id, competencia);
alter table public.apuracao_ajustes enable row level security;
