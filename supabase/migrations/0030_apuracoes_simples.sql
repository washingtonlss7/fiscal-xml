-- Apuração do Simples Nacional, etapa C: cada simulação e transmissão do PGDAS-D.
-- A linha nasce "simulada" (a Receita calculou, nada transmitido). Só o supervisor/admin transmite,
-- e só se a declaração de agora for idêntica à simulada (hash). Transmitida fica travada; mudança vira retificadora.
create table if not exists public.apuracoes_simples (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,   -- matriz (declarante)
  competencia date not null,
  tipo smallint not null default 1 check (tipo in (1, 2)),                      -- 1 original, 2 retificadora
  status text not null check (status in ('simulada', 'transmitida', 'retificada', 'descartada')),
  receita numeric(15,2) not null,
  declaracao jsonb not null,                -- corpo "declaracao" enviado ao TRANSDECLARACAO11
  hash text not null,                       -- sha256 da declaração (confere simulação x transmissão)
  grupos jsonb not null,                    -- receita por grupo (para a tela e o histórico)
  valores_devidos jsonb not null,           -- [{codigoTributo, valor}] calculados pela Receita
  total_devido numeric(15,2) not null,
  simulado_por text not null,
  simulado_em timestamptz not null default now(),
  transmitido_por text,
  transmitido_em timestamptz,
  id_declaracao text,
  recibo_caminho text,
  declaracao_caminho text,
  maed jsonb,                               -- multa por atraso: {numeroDocumento, vencimento, total, notificacao, darf}
  das jsonb,                                -- resultado da geração do DAS logo após a transmissão
  mensagem text
);
create index if not exists apuracoes_simples_empresa on public.apuracoes_simples (empresa_id, competencia, simulado_em desc);
alter table public.apuracoes_simples enable row level security;
