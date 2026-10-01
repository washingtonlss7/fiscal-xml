-- Registro de cada envio de importação de XML (lote ou arquivo): o que entrou, o que foi recusado e por quê.
create table if not exists public.importacoes_xml (
  id bigint generated always as identity primary key,
  empresa_id uuid references public.empresas(id) on delete cascade,
  email text not null,
  arquivo text,
  arquivos integer not null default 0,
  importadas integer not null default 0,
  completou_resumo integer not null default 0,
  ja_existiam integer not null default 0,
  rejeitadas integer not null default 0,
  motivos jsonb,
  erro text,
  duracao_ms integer,
  em timestamptz not null default now()
);
create index if not exists importacoes_xml_empresa on public.importacoes_xml (empresa_id, em desc);
alter table public.importacoes_xml enable row level security;
