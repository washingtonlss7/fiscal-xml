-- Contábil: processador de lançamentos (ETL contábil) conforme a especificação da Contabilfarma (ata).
--   fonte (notas do Appura, folha por planilha/SQL do Domínio) → movimentos padronizados (staging)
--   → regras DE/PARA do Departamento Contábil → lançamentos → validação → arquivo para o Domínio novo.
-- Nenhuma conta contábil é cadastrada pelo sistema: as regras começam vazias e são do Contábil.
-- Objetivo final: o Appura ser a contabilidade (plano de contas e livro de lançamentos aqui); o Domínio é destino
-- opcional (arquivo de importação) enquanto for usado.
-- Só tabelas novas. Rollback: supabase/rollback/0043_contabil_down.sql

-- Planos de contas (normalmente um plano padrão do escritório, o mesmo do Domínio novo)
create table if not exists public.ctb_planos (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  padrao boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_por text
);
alter table public.ctb_planos enable row level security;

create table if not exists public.ctb_contas (
  plano_id uuid not null references public.ctb_planos(id) on delete cascade,
  codigo text not null check (codigo ~ '^\d{1,7}$'),
  classificacao text not null,
  descricao text not null,
  tipo text not null check (tipo in ('S', 'A')),
  natureza text check (natureza in ('D', 'C')),
  ativa boolean not null default true,
  primary key (plano_id, codigo)
);
create index if not exists ctb_contas_class on public.ctb_contas (plano_id, classificacao);
alter table public.ctb_contas enable row level security;

-- Tabela mestre de empresas do Contábil (inclui clientes que não estão na captação do Appura)
create table if not exists public.ctb_empresas (
  id uuid primary key default gen_random_uuid(),
  codigo_dominio text not null check (codigo_dominio ~ '^\d{1,7}$'),
  cnpj text not null check (cnpj ~ '^(\d{11}|\d{14})$'),
  razao_social text not null,
  regime text check (regime in ('simples', 'mei', 'presumido', 'real')),
  ambiente text not null default 'dominio_novo' check (ambiente in ('dominio_novo', 'dominio_antigo')),
  ativo boolean not null default true,
  empresa_id uuid references public.empresas(id) on delete set null,
  plano_id uuid references public.ctb_planos(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por text,
  unique (codigo_dominio),
  unique (cnpj)
);
alter table public.ctb_empresas enable row level security;

-- Períodos a escriturar (levantamento do Contábil)
create table if not exists public.ctb_empresa_periodos (
  id bigint generated always as identity primary key,
  ctb_empresa_id uuid not null references public.ctb_empresas(id) on delete cascade,
  inicio date not null,
  fim date not null check (fim >= inicio),
  fonte text,
  criado_em timestamptz not null default now()
);
create index if not exists ctb_empresa_periodos_emp on public.ctb_empresa_periodos (ctb_empresa_id);
alter table public.ctb_empresa_periodos enable row level security;

-- Regras fiscais (DE/PARA por CFOP). ctb_empresa_id nulo = vale para todas; com empresa = só para ela (tem prioridade).
create table if not exists public.ctb_regras_fiscais (
  id bigint generated always as identity primary key,
  ctb_empresa_id uuid references public.ctb_empresas(id) on delete cascade,
  regime text check (regime in ('simples', 'mei', 'presumido', 'real')),
  cfop text not null check (cfop ~ '^\d{4}$'),
  tipo_movimento text not null,
  conta_debito text not null check (conta_debito ~ '^\d{1,7}$'),
  conta_credito text not null check (conta_credito ~ '^\d{1,7}$'),
  historico text not null,
  historico_codigo text check (historico_codigo is null or historico_codigo ~ '^\d{1,7}$'),
  regra_inversao boolean not null default false,
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
create unique index if not exists ctb_regras_fiscais_chave on public.ctb_regras_fiscais (coalesce(ctb_empresa_id::text, '*'), coalesce(regime, '*'), cfop);
alter table public.ctb_regras_fiscais enable row level security;

-- Regras da folha (DE/PARA por rubrica)
create table if not exists public.ctb_regras_folha (
  id bigint generated always as identity primary key,
  ctb_empresa_id uuid references public.ctb_empresas(id) on delete cascade,
  rubrica text not null,
  descricao text,
  conta_debito text not null check (conta_debito ~ '^\d{1,7}$'),
  conta_credito text not null check (conta_credito ~ '^\d{1,7}$'),
  historico text not null,
  historico_codigo text check (historico_codigo is null or historico_codigo ~ '^\d{1,7}$'),
  tipo_regra text not null default 'FOLHA',
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
create unique index if not exists ctb_regras_folha_chave on public.ctb_regras_folha (coalesce(ctb_empresa_id::text, '*'), rubrica);
alter table public.ctb_regras_folha enable row level security;

-- Configuração do processamento (uma linha). valor_fiscal nulo = o Fiscal ainda não confirmou qual campo contabilizar.
create table if not exists public.ctb_config (
  id int primary key default 1 check (id = 1),
  valor_fiscal text check (valor_fiscal in ('total_nota', 'produtos', 'produtos_menos_desconto')),
  agrupar_nfce_por_dia boolean not null default false,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
insert into public.ctb_config (id) values (1) on conflict do nothing;
alter table public.ctb_config enable row level security;

-- Log de cada processamento (obrigatório)
create table if not exists public.ctb_processamentos (
  id bigint generated always as identity primary key,
  origem text not null check (origem in ('fiscal', 'folha')),
  fonte text not null,
  usuario text not null,
  periodo_inicio date,
  periodo_fim date,
  empresas integer not null default 0,
  recebidos integer not null default 0,
  processados integer not null default 0,
  rejeitados integer not null default 0,
  sem_regra integer not null default 0,
  duplicados integer not null default 0,
  lancamentos integer not null default 0,
  status text not null default 'processando' check (status in ('processando', 'concluido', 'erro')),
  erro text,
  resumo jsonb,
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz
);
create index if not exists ctb_processamentos_em on public.ctb_processamentos (iniciado_em desc);
alter table public.ctb_processamentos enable row level security;

-- RAW da folha: as linhas exatamente como vieram do arquivo (auditoria)
create table if not exists public.ctb_raw_folha (
  id bigint generated always as identity primary key,
  processamento_id bigint not null references public.ctb_processamentos(id) on delete cascade,
  arquivo text not null,
  linha integer not null,
  dados jsonb not null,
  criado_em timestamptz not null default now()
);
create index if not exists ctb_raw_folha_proc on public.ctb_raw_folha (processamento_id);
alter table public.ctb_raw_folha enable row level security;

-- STAGING: movimentos padronizados (um por nota+CFOP ou por empresa+competência+rubrica). chave_unica = idempotência.
create table if not exists public.ctb_movimentos (
  id bigint generated always as identity primary key,
  chave_unica text not null unique,
  origem text not null check (origem in ('fiscal', 'folha')),
  ctb_empresa_id uuid references public.ctb_empresas(id) on delete cascade,
  cnpj text,
  competencia date not null,
  data date not null,
  documento text,
  chave_nfe text,
  modelo text,
  cfop text,
  rubrica text,
  descricao text,
  participante_nome text,
  participante_doc text,
  valor numeric(15,2),
  dados jsonb,
  status text not null default 'pendente' check (status in ('ok', 'pendente', 'erro')),
  erro_codigo text,
  erro_detalhe text,
  processamento_id bigint references public.ctb_processamentos(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists ctb_movimentos_emp on public.ctb_movimentos (ctb_empresa_id, competencia);
create index if not exists ctb_movimentos_pend on public.ctb_movimentos (status, erro_codigo) where status <> 'ok';
alter table public.ctb_movimentos enable row level security;

-- Arquivos gerados (planilha de conferência e TXT do Domínio)
create table if not exists public.ctb_arquivos (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('dominio_txt', 'conferencia_xlsx')),
  ctb_empresa_id uuid references public.ctb_empresas(id) on delete set null,
  competencia_inicio date,
  competencia_fim date,
  nome text not null,
  caminho text,
  lancamentos integer not null,
  total numeric(15,2) not null,
  sha256 text,
  definitivo boolean not null default false,
  criado_por text not null,
  criado_em timestamptz not null default now()
);
alter table public.ctb_arquivos enable row level security;

-- OUTPUT / LIVRO: lançamentos (gerados por regra a partir de um movimento, ou manuais). Exportado em arquivo
-- definitivo = travado.
create table if not exists public.ctb_lancamentos (
  id bigint generated always as identity primary key,
  movimento_id bigint unique references public.ctb_movimentos(id) on delete cascade,
  ctb_empresa_id uuid not null references public.ctb_empresas(id) on delete cascade,
  competencia date not null,
  data date not null,
  conta_debito text not null,
  conta_credito text not null,
  valor numeric(15,2) not null check (valor > 0),
  historico text not null,
  historico_codigo text,
  origem text not null check (origem in ('fiscal', 'folha', 'manual')),
  documento text,
  regra text,
  criado_por text,
  processamento_id bigint references public.ctb_processamentos(id) on delete set null,
  arquivo_id bigint references public.ctb_arquivos(id) on delete set null,
  criado_em timestamptz not null default now()
);
create index if not exists ctb_lancamentos_emp on public.ctb_lancamentos (ctb_empresa_id, competencia);
alter table public.ctb_lancamentos enable row level security;
