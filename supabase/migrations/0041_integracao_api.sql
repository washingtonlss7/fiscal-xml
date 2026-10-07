-- API de integração (ex.: OnnePharma): outro sistema lê os XMLs de NF-e e NFC-e (entrada e saída) dos CNPJs liberados,
-- por busca incremental (cursor) e por webhook (o Appura avisa a cada nota nova ou alterada).
-- Tabelas novas + uma coluna e um gatilho em documentos (integ_seq: número que cresce a cada mudança relevante da nota,
-- usado como cursor e para enfileirar o webhook). Nada existente muda de comportamento.
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

-- Cursor de mudanças: cresce a cada nota nova ou alterada (situação, XML completo)
create sequence if not exists public.documentos_integ_seq;
alter table public.documentos add column if not exists integ_seq bigint;

create table if not exists public.integracao_webhook_fila (
  id bigint generated always as identity primary key,
  integracao_id uuid not null references public.integracoes_api(id) on delete cascade,
  documento_id uuid not null,
  integ_seq bigint not null,
  evento text not null check (evento in ('documento.novo', 'documento.atualizado', 'teste')),
  status text not null default 'pendente' check (status in ('pendente', 'entregue', 'falhou')),
  tentativas integer not null default 0,
  proxima_em timestamptz not null default now(),
  ultimo_http integer,
  ultimo_erro text,
  criado_em timestamptz not null default now(),
  entregue_em timestamptz,
  unique (integracao_id, documento_id, integ_seq)
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

-- Gatilho: novo número de mudança quando a nota entra ou muda de situação / ganha o XML completo
create or replace function public.documentos_integ_seq_gatilho()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.situacao is distinct from old.situacao or new.completo is distinct from old.completo
     or new.xml_path is distinct from old.xml_path then
    new.integ_seq := nextval('public.documentos_integ_seq');
  end if;
  return new;
end $$;

drop trigger if exists documentos_integ_seq on public.documentos;
create trigger documentos_integ_seq before insert or update on public.documentos
  for each row execute function public.documentos_integ_seq_gatilho();

-- Gatilho: enfileira o webhook para cada integração ativa que cobre a empresa, o modelo e a direção
create or replace function public.documentos_webhook_gatilho()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.modelo not in ('55', '65') then return null; end if;
  if tg_op = 'UPDATE' and new.integ_seq is not distinct from old.integ_seq then return null; end if;
  insert into integracao_webhook_fila (integracao_id, documento_id, integ_seq, evento)
  select i.id, new.id, new.integ_seq, case when tg_op = 'INSERT' then 'documento.novo' else 'documento.atualizado' end
  from integracoes_api i join integracao_api_empresas ie on ie.integracao_id = i.id and ie.empresa_id = new.empresa_id
  where i.ativo and i.revogado_em is null and i.webhook_url is not null
    and new.modelo = any (i.modelos) and new.direcao = any (i.direcoes)
  on conflict do nothing;
  return null;
end $$;

drop trigger if exists documentos_webhook on public.documentos;
create trigger documentos_webhook after insert or update on public.documentos
  for each row execute function public.documentos_webhook_gatilho();

-- Notas que já existem recebem o número na ordem em que chegaram (a primeira carga pela API segue essa ordem)
update public.documentos d set integ_seq = s.n
from (select id, row_number() over (order by capturado_em, id) as n from public.documentos) s
where d.id = s.id and d.integ_seq is null;
select setval('public.documentos_integ_seq', greatest((select coalesce(max(integ_seq), 0) from public.documentos), 1));
create index if not exists documentos_integ on public.documentos (empresa_id, integ_seq);

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
revoke all on function public.documentos_integ_seq_gatilho() from public, anon, authenticated;
revoke all on function public.documentos_webhook_gatilho() from public, anon, authenticated;
