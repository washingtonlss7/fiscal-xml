-- Módulos que estavam "Em breve": Folha (controle e conferência), Societário, Financeiro do escritório e Atendimento.
-- Todos usam o cadastro de empresas do Appura (empresas). Só tabelas novas; os perfis prontos ganham o módulo
-- Atendimento. Rollback: supabase/rollback/0044_modulos_escritorio_down.sql

/* ---------- Folha: etapas do mês por empresa ---------- */
create table if not exists public.folha_etapas (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,40}$'),
  nome text not null,
  descricao text,
  ordem integer not null default 100,
  ativa boolean not null default true
);
alter table public.folha_etapas enable row level security;
insert into public.folha_etapas (id, nome, descricao, ordem) values
 ('folha_fechada', 'Folha calculada e fechada', 'Folha do mês calculada e conferida no sistema de folha.', 10),
 ('esocial', 'eSocial transmitido', 'Eventos periódicos do mês enviados e fechados.', 20),
 ('dctfweb', 'DCTFWeb transmitida', 'Declaração transmitida e guia (DARF) emitida.', 30),
 ('fgts', 'FGTS Digital', 'Guia do FGTS Digital emitida.', 40),
 ('guias_cliente', 'Guias e holerites enviados ao cliente', 'Documentos do mês entregues ao cliente.', 50),
 ('contabilizada', 'Folha contabilizada', 'Lançamentos da folha gerados no Contábil (preenchida sozinha quando há lançamentos da folha).', 60)
on conflict (id) do nothing;

create table if not exists public.folha_empresas (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  tem_folha boolean not null default true,
  funcionarios integer check (funcionarios is null or funcionarios >= 0),
  observacao text,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
alter table public.folha_empresas enable row level security;

create table if not exists public.folha_controle (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null,
  etapa_id text not null references public.folha_etapas(id) on delete cascade,
  status text not null check (status in ('pendente', 'feito', 'nao_se_aplica')),
  observacao text,
  feito_em timestamptz,
  feito_por text,
  primary key (empresa_id, competencia, etapa_id)
);
create index if not exists folha_controle_comp on public.folha_controle (competencia);
alter table public.folha_controle enable row level security;

/* ---------- Societário ---------- */
create table if not exists public.soc_cadastro (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  natureza_juridica text,
  capital_social numeric(15,2),
  data_abertura date,
  nire text,
  cnae_principal text,
  cnaes_secundarios text[] not null default '{}',
  objeto_social text,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
alter table public.soc_cadastro enable row level security;

create table if not exists public.soc_socios (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  nome text not null,
  documento text check (documento is null or documento ~ '^(\d{11}|\d{14})$'),
  qualificacao text not null default 'socio' check (qualificacao in ('socio', 'socio_administrador', 'administrador', 'titular', 'procurador')),
  participacao numeric(7,4) check (participacao is null or (participacao >= 0 and participacao <= 100)),
  entrada date,
  saida date,
  criado_em timestamptz not null default now(),
  criado_por text
);
create index if not exists soc_socios_emp on public.soc_socios (empresa_id);
alter table public.soc_socios enable row level security;

create table if not exists public.soc_documentos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  tipo text not null,
  descricao text,
  numero text,
  emissao date,
  validade date,
  arquivo_caminho text,
  arquivo_nome text,
  criado_em timestamptz not null default now(),
  criado_por text
);
create index if not exists soc_documentos_validade on public.soc_documentos (validade);
create index if not exists soc_documentos_emp on public.soc_documentos (empresa_id);
alter table public.soc_documentos enable row level security;

create table if not exists public.soc_processos (
  id bigint generated always as identity primary key,
  empresa_id uuid references public.empresas(id) on delete set null,
  cliente_nome text,
  tipo text not null check (tipo in ('abertura', 'alteracao', 'baixa', 'transformacao', 'outro')),
  titulo text not null,
  status text not null default 'aberto' check (status in ('aberto', 'em_andamento', 'aguardando_cliente', 'aguardando_orgao', 'concluido', 'cancelado')),
  responsavel text,
  prazo date,
  etapas jsonb not null default '[]',
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por text,
  atualizado_em timestamptz not null default now(),
  concluido_em timestamptz
);
create index if not exists soc_processos_status on public.soc_processos (status, prazo);
alter table public.soc_processos enable row level security;

/* ---------- Financeiro do escritório: honorários ---------- */
create table if not exists public.fin_contratos (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  descricao text not null default 'Honorários mensais',
  valor_mensal numeric(15,2) not null check (valor_mensal > 0),
  dia_vencimento integer not null check (dia_vencimento between 1 and 28),
  inicio date not null,
  fim date,
  indice_reajuste text,
  mes_reajuste integer check (mes_reajuste is null or mes_reajuste between 1 and 12),
  ativo boolean not null default true,
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por text,
  atualizado_em timestamptz not null default now()
);
create index if not exists fin_contratos_emp on public.fin_contratos (empresa_id);
alter table public.fin_contratos enable row level security;

create table if not exists public.fin_titulos (
  id bigint generated always as identity primary key,
  contrato_id bigint references public.fin_contratos(id) on delete set null,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null,
  descricao text not null,
  valor numeric(15,2) not null check (valor > 0),
  vencimento date not null,
  status text not null default 'aberto' check (status in ('aberto', 'pago', 'cancelado')),
  pago_em date,
  valor_pago numeric(15,2),
  forma text,
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por text
);
create unique index if not exists fin_titulos_contrato_comp on public.fin_titulos (contrato_id, competencia) where contrato_id is not null;
create index if not exists fin_titulos_venc on public.fin_titulos (status, vencimento);
alter table public.fin_titulos enable row level security;

/* ---------- Atendimento: chamados dos clientes ---------- */
create table if not exists public.atd_chamados (
  id bigint generated always as identity primary key,
  empresa_id uuid references public.empresas(id) on delete set null,
  assunto text not null,
  departamento text not null default 'outro' check (departamento in ('fiscal', 'contabil', 'folha', 'societario', 'financeiro', 'captacao', 'outro')),
  prioridade text not null default 'normal' check (prioridade in ('baixa', 'normal', 'alta', 'urgente')),
  status text not null default 'aberto' check (status in ('aberto', 'em_andamento', 'aguardando_cliente', 'resolvido', 'fechado')),
  canal text not null default 'outro' check (canal in ('telefone', 'whatsapp', 'email', 'presencial', 'outro')),
  solicitante text,
  responsavel text,
  prazo date,
  criado_em timestamptz not null default now(),
  criado_por text not null,
  atualizado_em timestamptz not null default now(),
  resolvido_em timestamptz
);
create index if not exists atd_chamados_status on public.atd_chamados (status, prazo);
create index if not exists atd_chamados_emp on public.atd_chamados (empresa_id);
alter table public.atd_chamados enable row level security;

create table if not exists public.atd_mensagens (
  id bigint generated always as identity primary key,
  chamado_id bigint not null references public.atd_chamados(id) on delete cascade,
  autor text not null,
  texto text not null,
  criado_em timestamptz not null default now()
);
create index if not exists atd_mensagens_chamado on public.atd_mensagens (chamado_id, criado_em);
alter table public.atd_mensagens enable row level security;

/* ---------- Módulo Atendimento nos perfis prontos ---------- */
insert into public.escritorio_modulos (modulo) values ('atendimento') on conflict (modulo) do nothing;
insert into public.acesso_perfis (id, nome, descricao, permissoes, sistema, ordem) values
 ('administrador', 'Administrador', 'Tudo: todos os módulos, usuários, perfis, configurações, empresas e certificados.',
   array['captacao.ver','captacao.operar','fiscal.ver','fiscal.operar','fiscal.transmitir','fiscal.configurar',
         'contabil.ver','contabil.operar','contabil.fechar','contabil.transmitir','contabil.configurar',
         'folha.ver','folha.operar','folha.fechar','folha.transmitir','folha.configurar',
         'societario.ver','societario.operar','societario.configurar','financeiro.ver','financeiro.operar','financeiro.configurar',
         'atendimento.ver','atendimento.operar','atendimento.configurar',
         'administracao.usuarios','administracao.empresas','administracao.configuracoes'], true, 10),
 ('gestor', 'Gestor', 'Todo o trabalho de todos os módulos (inclusive transmitir e fechar), sem a administração do sistema.',
   array['captacao.ver','captacao.operar','fiscal.ver','fiscal.operar','fiscal.transmitir','fiscal.configurar',
         'contabil.ver','contabil.operar','contabil.fechar','contabil.transmitir','contabil.configurar',
         'folha.ver','folha.operar','folha.fechar','folha.transmitir','folha.configurar',
         'societario.ver','societario.operar','societario.configurar','financeiro.ver','financeiro.operar','financeiro.configurar',
         'atendimento.ver','atendimento.operar','atendimento.configurar'], true, 20),
 ('supervisor_fiscal', 'Supervisor fiscal', 'Captação e todo o fiscal, inclusive transmitir o PGDAS-D, mais cadastrar empresas e certificados.',
   array['captacao.ver','captacao.operar','fiscal.ver','fiscal.operar','fiscal.transmitir','atendimento.ver','atendimento.operar','administracao.empresas'], true, 30),
 ('analista_fiscal', 'Analista fiscal', 'Dia a dia do fiscal: sincronizar, importar, auditar, conferir e calcular. Não transmite.',
   array['captacao.ver','captacao.operar','fiscal.ver','fiscal.operar','atendimento.ver','atendimento.operar'], true, 40),
 ('analista_contabil', 'Analista contábil', 'Contábil (lançar e fechar), com consulta às notas e ao fiscal.',
   array['captacao.ver','fiscal.ver','contabil.ver','contabil.operar','contabil.fechar','atendimento.ver','atendimento.operar'], true, 50),
 ('analista_folha', 'Analista de folha', 'Folha de pagamento (lançar e fechar). Não vê o fiscal.',
   array['folha.ver','folha.operar','folha.fechar','atendimento.ver','atendimento.operar'], true, 60),
 ('consulta', 'Consulta', 'Só vê e baixa notas e relatórios da captação e do fiscal. Não altera nada.',
   array['captacao.ver','fiscal.ver'], true, 70)
on conflict (id) do update set permissoes = excluded.permissoes, descricao = excluded.descricao;
