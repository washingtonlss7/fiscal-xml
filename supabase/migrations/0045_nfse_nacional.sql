-- NFS-e Nacional: captação pelo Ambiente de Dados Nacional (ADN) com o certificado de cada empresa.
-- Tabelas próprias (a chave da NFS-e nacional tem 50 dígitos e a tabela "documentos" é das notas de 44).
-- Só tabelas novas. Rollback: supabase/rollback/0045_nfse_nacional_down.sql

/* Liga/desliga por empresa e o controle do NSU (um por empresa, como o sync_state da NF-e) */
create table if not exists public.nfse_captacao (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativo boolean not null default false,
  ult_nsu bigint not null default 0,
  proxima_consulta_em timestamptz not null default now(),
  ultima_consulta_em timestamptz,
  ultima_sync_ok_em timestamptz,
  ultimo_status text,
  ultimo_motivo text,
  erros_consecutivos integer not null default 0,
  documentos_total integer not null default 0,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
create index if not exists nfse_captacao_fila on public.nfse_captacao (proxima_consulta_em) where ativo;
alter table public.nfse_captacao enable row level security;

/* Notas de serviço (uma linha por empresa e chave: a mesma nota pode estar em duas empresas do escritório) */
create table if not exists public.nfse_documentos (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave varchar(50) not null,
  papel text not null check (papel in ('prestador', 'tomador', 'intermediario')),
  numero text,
  serie_dps text,
  numero_dps text,
  competencia date,
  emitida_em timestamptz,
  prestador_doc varchar(14),
  prestador_nome text,
  prestador_mun varchar(7),
  tomador_doc varchar(14),
  tomador_nome text,
  tomador_mun varchar(7),
  intermediario_doc varchar(14),
  mun_incidencia varchar(7),
  mun_prestacao varchar(7),
  cod_trib_nac varchar(6),
  cod_nbs varchar(9),
  descricao text,
  valor_servico numeric(15,2),
  base_calculo numeric(15,2),
  aliquota numeric(7,4),
  valor_iss numeric(15,2),
  iss_retido boolean,
  valor_retencoes numeric(15,2),
  valor_liquido numeric(15,2),
  situacao text not null default 'autorizada' check (situacao in ('autorizada', 'cancelada', 'substituida')),
  nsu bigint,
  xml_path text,
  capturado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (empresa_id, chave)
);
create index if not exists nfse_documentos_empresa_data on public.nfse_documentos (empresa_id, emitida_em);
create index if not exists nfse_documentos_chave on public.nfse_documentos (chave);
alter table public.nfse_documentos enable row level security;

/* Eventos (cancelamento, substituição, manifestações) */
create table if not exists public.nfse_eventos (
  id bigserial primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave varchar(50) not null,
  tp_evento varchar(6) not null,
  n_seq integer not null default 1,
  descricao text,
  ocorrido_em timestamptz,
  nsu bigint,
  xml_path text,
  capturado_em timestamptz not null default now(),
  unique (empresa_id, chave, tp_evento, n_seq)
);
create index if not exists nfse_eventos_chave on public.nfse_eventos (chave);
alter table public.nfse_eventos enable row level security;

/* Registro de cada consulta ao ADN (diagnóstico) */
create table if not exists public.nfse_logs (
  id bigserial primary key,
  empresa_id uuid references public.empresas(id) on delete cascade,
  nsu_enviado bigint,
  http_status integer,
  status text,
  qtd_docs integer,
  ult_nsu_retornado bigint,
  erro text,
  duracao_ms integer,
  criado_em timestamptz not null default now()
);
create index if not exists nfse_logs_empresa on public.nfse_logs (empresa_id, criado_em desc);
alter table public.nfse_logs enable row level security;
