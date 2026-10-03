-- Appura NFC-e Worker (Fase 1): configuração por empresa, checkpoint por data, histórico de execuções e lock.
-- Só tabelas e funções novas; nada existente é alterado. Tudo começa desligado (nfce_config.ativo = false).
-- Rollback: supabase/rollback/0038_nfce_worker_down.sql (só com confirmação).

create table if not exists public.nfce_config (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  ativo boolean not null default false,
  horario text not null default '02:00' check (horario ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  janela_dias integer not null default 3 check (janela_dias between 1 and 31),
  max_tentativas integer not null default 3 check (max_tentativas between 1 and 10),
  backoff_base_seg integer not null default 60 check (backoff_base_seg between 5 and 3600),
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
alter table public.nfce_config enable row level security;

-- Checkpoint persistente: só avança quando o dia termina "concluída" (nunca porque a execução começou).
create table if not exists public.nfce_checkpoint (
  empresa_id uuid primary key references public.empresas(id) on delete cascade,
  uf char(2) not null,
  ultima_data_ok date,
  ultima_chave char(44),
  ultimo_numero text,
  ultima_serie text,
  ultima_emissao_em timestamptz,
  ultima_tentativa_em timestamptz,
  ultimo_sucesso_em timestamptz,
  -- Retry limitado com backoff: falha temporária agenda a próxima tentativa; passa do limite e espera o horário do dia seguinte
  tentativas_seguidas integer not null default 0,
  proxima_tentativa_em timestamptz,
  status text not null default 'nunca' check (status in ('nunca', 'ok', 'parcial', 'falhou', 'executando')),
  erro_codigo text,
  erro_mensagem text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.nfce_checkpoint enable row level security;

create table if not exists public.nfce_execucoes (
  id bigint generated always as identity primary key,
  run_id uuid not null default gen_random_uuid() unique,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  data_referencia date not null,
  origem text not null default 'agendada' check (origem in ('agendada', 'manual', 'recuperacao')),
  status text not null default 'pendente' check (status in ('pendente', 'executando', 'concluida', 'parcial', 'falhou', 'repetindo')),
  tentativa integer not null default 1,
  encontrados integer not null default 0,
  existentes integer not null default 0,
  novos integer not null default 0,
  baixados_ok integer not null default 0,
  baixados_falha integer not null default 0,
  erro_codigo text,
  erro_mensagem text,
  versao_worker text,
  iniciado_em timestamptz,
  terminado_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists nfce_execucoes_empresa on public.nfce_execucoes (empresa_id, data_referencia desc, id desc);
-- Nunca duas execuções rodando para a mesma empresa e data (além do lock)
create unique index if not exists nfce_execucoes_uma_rodando on public.nfce_execucoes (empresa_id, data_referencia) where status = 'executando';
alter table public.nfce_execucoes enable row level security;

-- Lock por arrendamento (funciona com o pool de conexões da API do Supabase, ao contrário do advisory lock de sessão).
create table if not exists public.nfce_locks (
  chave text primary key,
  dono text not null,
  expira_em timestamptz not null
);
alter table public.nfce_locks enable row level security;

-- Pega o lock se estiver livre ou vencido (uma instrução só: atômica). Devolve true se o lock é deste dono.
create or replace function public.nfce_lock_adquirir(p_chave text, p_dono text, p_segundos integer)
returns boolean language plpgsql volatile set search_path = public as $$
declare v_dono text;
begin
  insert into nfce_locks as l (chave, dono, expira_em) values (p_chave, p_dono, now() + make_interval(secs => p_segundos))
  on conflict (chave) do update set dono = excluded.dono, expira_em = excluded.expira_em
    where l.expira_em < now() or l.dono = excluded.dono
  returning dono into v_dono;
  return coalesce(v_dono = p_dono, false);
end $$;

-- Renova só se ainda for o dono (se expirou e outro pegou, devolve false: o dono antigo deve parar).
create or replace function public.nfce_lock_renovar(p_chave text, p_dono text, p_segundos integer)
returns boolean language sql volatile set search_path = public as $$
  with r as (update nfce_locks set expira_em = now() + make_interval(secs => p_segundos)
             where chave = p_chave and dono = p_dono returning 1)
  select exists (select 1 from r);
$$;

create or replace function public.nfce_lock_liberar(p_chave text, p_dono text)
returns boolean language sql volatile set search_path = public as $$
  with r as (delete from nfce_locks where chave = p_chave and dono = p_dono returning 1)
  select exists (select 1 from r);
$$;

revoke all on function public.nfce_lock_adquirir(text, text, integer) from public, anon, authenticated;
revoke all on function public.nfce_lock_renovar(text, text, integer) from public, anon, authenticated;
revoke all on function public.nfce_lock_liberar(text, text) from public, anon, authenticated;
