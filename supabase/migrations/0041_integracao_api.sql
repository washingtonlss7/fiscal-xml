-- API de integração (ex.: OnnePharma): outro sistema lê os XMLs de NF-e e NFC-e (entrada e saída) dos CNPJs liberados,
-- por busca incremental (cursor) e por webhook (o Appura avisa a cada nota nova ou alterada).
-- Só tabelas novas; nada existente é alterado. (Aplicada em partes: 0041a_integracao_api_tabelas e 0041c_integracao_mudancas.)
-- Rollback: supabase/rollback/0041_integracao_api_down.sql

create table if not exists public.integracoes_api (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(nome) between 2 and 80),
  token_hash text not null unique,
  token_prefixo text not null,
  modelos text[] not null default array['55', '65'],
  direcoes text[] not null default array['entrada', 'saida'],
  webhook_url text check (webhook_url is null or webhook_url ~ '^https://'),
  webhook_segredo_cifrado text,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  criado_por text,
  revogado_em timestamptz,
  revogado_por text,
  ultimo_uso_em timestamptz,
  atualizado_em timestamptz not null default now()
);
alter table public.integracoes_api enable row level security;

create table if not exists public.integracao_api_empresas (
  integracao_id uuid not null references public.integracoes_api(id) on delete cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  primary key (integracao_id, empresa_id)
);
create index if not exists integracao_api_empresas_empresa on public.integracao_api_empresas (empresa_id);
alter table public.integracao_api_empresas enable row level security;

create table if not exists public.integracao_webhook_fila (
  id bigint generated always as identity primary key,
  integracao_id uuid not null references public.integracoes_api(id) on delete cascade,
  documento_id uuid not null,
  mudanca_id bigint not null,
  evento text not null check (evento in ('documento.novo', 'documento.atualizado', 'teste')),
  status text not null default 'pendente' check (status in ('pendente', 'entregue', 'falhou')),
  tentativas integer not null default 0,
  proxima_em timestamptz not null default now(),
  ultimo_http integer,
  ultimo_erro text,
  criado_em timestamptz not null default now(),
  entregue_em timestamptz,
  unique (integracao_id, documento_id, mudanca_id)
);
create index if not exists integracao_webhook_fila_pendentes on public.integracao_webhook_fila (proxima_em) where status = 'pendente';
create index if not exists integracao_webhook_fila_integracao on public.integracao_webhook_fila (integracao_id, criado_em desc);
alter table public.integracao_webhook_fila enable row level security;

-- Registro das chamadas à API (auditoria)
create table if not exists public.integracao_api_chamadas (
  id bigint generated always as identity primary key,
  integracao_id uuid not null references public.integracoes_api(id) on delete cascade,
  rota text not null,
  status integer not null,
  itens integer,
  ip text,
  em timestamptz not null default now()
);
create index if not exists integracao_api_chamadas_integracao on public.integracao_api_chamadas (integracao_id, em desc);
alter table public.integracao_api_chamadas enable row level security;

-- Registro de mudanças das notas, escrito pelo código no ponto em que toda nota é gravada (sync.ts/processarDoc):
-- é o cursor da API e a fonte do webhook. A tabela documentos não é alterada.
create table if not exists public.integracao_mudancas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  chave char(44) not null,
  tipo text not null check (tipo in ('gravado', 'cancelado', 'carga_inicial')),
  em timestamptz not null default now()
);
create index if not exists integracao_mudancas_empresa on public.integracao_mudancas (empresa_id, id);
alter table public.integracao_mudancas enable row level security;

-- Carga inicial: as notas que já existem, na ordem em que chegaram (a primeira leitura pela API segue essa ordem)
insert into public.integracao_mudancas (empresa_id, chave, tipo, em)
select empresa_id, chave, 'carga_inicial', capturado_em
from public.documentos where modelo in ('55', '65')
order by capturado_em, id;

alter table public.integracoes_api add column if not exists webhook_cursor bigint not null default 0;

-- Reserva entregas pendentes para um despachante (vários processos não pegam a mesma)
create or replace function public.integracao_webhook_reservar(p_limite integer, p_segundos integer)
returns setof public.integracao_webhook_fila language sql volatile set search_path = public as $$
  with r as (
    select id from integracao_webhook_fila
    where status = 'pendente' and proxima_em <= now()
    order by proxima_em, id
    limit p_limite
    for update skip locked
  )
  update integracao_webhook_fila f set proxima_em = now() + make_interval(secs => p_segundos)
  from r where f.id = r.id
  returning f.*;
$$;

revoke all on function public.integracao_webhook_reservar(integer, integer) from public, anon, authenticated;
