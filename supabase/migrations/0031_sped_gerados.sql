-- SPED gerado pelo Appura (EFD ICMS/IPI por estabelecimento; EFD-Contribuições pela matriz).
-- Cada geração é uma versão: arquivo cifrado no R2, resumo, pendências da geração e a validação do leitor.
-- "Auditar" envia a versão pelo mesmo caminho de um SPED recebido (sped_arquivos), com todas as comparações.
create table if not exists public.sped_gerados (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null,
  tipo text not null check (tipo in ('efd_icms_ipi', 'efd_contribuicoes')),
  versao integer not null,
  nome text not null,
  caminho text not null,
  tamanho integer not null,
  sha256 text not null,
  resumo jsonb not null,
  pendencias jsonb not null default '[]'::jsonb,
  validacao jsonb not null default '[]'::jsonb,
  erros integer not null default 0,
  alertas integer not null default 0,
  gerado_por text not null,
  gerado_em timestamptz not null default now(),
  auditado_arquivo_id bigint references public.sped_arquivos(id) on delete set null,
  unique (empresa_id, competencia, tipo, versao)
);
create index if not exists sped_gerados_empresa on public.sped_gerados (empresa_id, competencia, tipo, versao desc);
alter table public.sped_gerados enable row level security;
