-- Chaves do Integra Contador (SERPRO) cadastradas pelo painel (Administração › Escritório).
-- Consumer Key e Secret ficam cifradas com a MASTER_KEY do servidor (AES-256-GCM), como os certificados:
-- o banco nunca guarda o valor aberto e a API nunca devolve as chaves, só os 4 últimos caracteres da Key.
create table if not exists public.integra_config (
  id smallint primary key default 1 check (id = 1),
  ambiente text not null default 'producao' check (ambiente in ('producao', 'trial')),
  consumer_key_cifrada text,
  consumer_secret_cifrada text,
  final_chave text,
  atualizado_em timestamptz not null default now(),
  atualizado_por text not null
);
alter table public.integra_config enable row level security;
