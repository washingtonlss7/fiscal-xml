-- Notas (NF-e/NFC-e) que a SEFAZ rejeitou, vindas na importação de XML do sistema de venda.
-- Não são documentos fiscais; ficam guardadas para o escritório saber quais vendas ficaram sem nota autorizada.
create table if not exists public.notas_rejeitadas (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave char(44) not null,
  modelo char(2) not null,
  serie text,
  numero text,
  tp_emis text,
  emitida_em timestamptz,
  valor numeric(15,2),
  cstat text not null,
  motivo text,
  importado_em timestamptz not null default now(),
  primary key (empresa_id, chave)
);
create index if not exists notas_rejeitadas_emissao on public.notas_rejeitadas (empresa_id, emitida_em);
alter table public.notas_rejeitadas enable row level security;
