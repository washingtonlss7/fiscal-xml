-- Permissões por módulo, ação e empresa (um login só; o perfil decide o que cada pessoa vê e faz).
--   permissão = "<módulo>.<ação>", ex.: fiscal.ver, fiscal.transmitir, folha.operar, administracao.usuarios
--   perfil    = modelo editável com uma lista de permissões (os de sistema vêm prontos)
--   usuário   = um perfil + exceções (dar/tirar permissões) + escopo de empresas (todas, carteira ou lista)
-- Só tabelas e uma função novas; nada existente é alterado. A coluna antiga painel_usuarios.perfil continua
-- sendo gravada (compatibilidade e rollback). Rollback: supabase/rollback/0042_acesso_modulos_down.sql

create table if not exists public.acesso_perfis (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,40}$'),
  nome text not null check (length(nome) between 2 and 60),
  descricao text,
  permissoes text[] not null default '{}',
  sistema boolean not null default false,
  ordem integer not null default 100,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
alter table public.acesso_perfis enable row level security;

-- Acesso de cada usuário de painel_usuarios (os administradores fixos de PAINEL_EMAILS não precisam de linha)
create table if not exists public.acesso_usuarios (
  email text primary key references public.painel_usuarios(email) on delete cascade on update cascade,
  perfil_id text not null references public.acesso_perfis(id),
  escopo text not null default 'todas' check (escopo in ('todas', 'carteira', 'lista')),
  permissoes_extra text[] not null default '{}',
  permissoes_removidas text[] not null default '{}',
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
alter table public.acesso_usuarios enable row level security;

-- Empresas escolhidas uma a uma (escopo "lista")
create table if not exists public.acesso_usuario_empresas (
  email text not null references public.acesso_usuarios(email) on delete cascade on update cascade,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  primary key (email, empresa_id)
);
create index if not exists acesso_usuario_empresas_empresa on public.acesso_usuario_empresas (empresa_id);
alter table public.acesso_usuario_empresas enable row level security;

-- Responsável por empresa e módulo (escopo "carteira"); a mesma empresa pode ter um responsável por módulo
create table if not exists public.empresa_responsaveis (
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  modulo text not null check (modulo ~ '^[a-z]{2,20}$'),
  email text not null check (email = lower(email)),
  origem text not null default 'manual' check (origem in ('manual', 'acessorias')),
  criado_em timestamptz not null default now(),
  criado_por text,
  primary key (empresa_id, modulo, email)
);
create index if not exists empresa_responsaveis_email on public.empresa_responsaveis (email);
alter table public.empresa_responsaveis enable row level security;

-- Módulos contratados pelo escritório (desligado = some para todos)
create table if not exists public.escritorio_modulos (
  modulo text primary key check (modulo ~ '^[a-z]{2,20}$'),
  ativo boolean not null default true,
  atualizado_em timestamptz not null default now(),
  atualizado_por text
);
alter table public.escritorio_modulos enable row level security;

-- Registro das mudanças de acesso (perfis, permissões, escopo, responsáveis, módulos)
create table if not exists public.acesso_log (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  por text not null,
  acao text not null,
  alvo text not null,
  detalhes jsonb
);
create index if not exists acesso_log_em on public.acesso_log (em desc);
alter table public.acesso_log enable row level security;

-- Perfis prontos
insert into public.acesso_perfis (id, nome, descricao, permissoes, sistema, ordem) values
 ('administrador', 'Administrador', 'Tudo: todos os módulos, usuários, perfis, configurações, empresas e certificados.',
   array['captacao.ver','captacao.operar','fiscal.ver','fiscal.operar','fiscal.transmitir','fiscal.configurar',
         'contabil.ver','contabil.operar','contabil.fechar','contabil.transmitir','contabil.configurar',
         'folha.ver','folha.operar','folha.fechar','folha.transmitir','folha.configurar',
         'societario.ver','societario.operar','societario.configurar','financeiro.ver','financeiro.operar','financeiro.configurar',
         'administracao.usuarios','administracao.empresas','administracao.configuracoes'], true, 10),
 ('gestor', 'Gestor', 'Todo o trabalho de todos os módulos (inclusive transmitir e fechar), sem a administração do sistema.',
   array['captacao.ver','captacao.operar','fiscal.ver','fiscal.operar','fiscal.transmitir','fiscal.configurar',
         'contabil.ver','contabil.operar','contabil.fechar','contabil.transmitir','contabil.configurar',
         'folha.ver','folha.operar','folha.fechar','folha.transmitir','folha.configurar',
         'societario.ver','societario.operar','societario.configurar','financeiro.ver','financeiro.operar','financeiro.configurar'], true, 20),
 ('supervisor_fiscal', 'Supervisor fiscal', 'Captação e todo o fiscal, inclusive transmitir o PGDAS-D, mais cadastrar empresas e certificados.',
   array['captacao.ver','captacao.operar','fiscal.ver','fiscal.operar','fiscal.transmitir','administracao.empresas'], true, 30),
 ('analista_fiscal', 'Analista fiscal', 'Dia a dia do fiscal: sincronizar, importar, auditar, conferir e calcular. Não transmite.',
   array['captacao.ver','captacao.operar','fiscal.ver','fiscal.operar'], true, 40),
 ('analista_contabil', 'Analista contábil', 'Contábil (lançar e fechar), com consulta às notas e ao fiscal.',
   array['captacao.ver','fiscal.ver','contabil.ver','contabil.operar','contabil.fechar'], true, 50),
 ('analista_folha', 'Analista de folha', 'Folha de pagamento (lançar e fechar). Não vê o fiscal.',
   array['folha.ver','folha.operar','folha.fechar'], true, 60),
 ('consulta', 'Consulta', 'Só vê e baixa notas e relatórios da captação e do fiscal. Não altera nada.',
   array['captacao.ver','fiscal.ver'], true, 70)
on conflict (id) do nothing;

insert into public.escritorio_modulos (modulo) values
 ('captacao'), ('fiscal'), ('contabil'), ('folha'), ('societario'), ('financeiro'), ('administracao')
on conflict (modulo) do nothing;

-- Conversão dos perfis antigos (mesmo acesso de antes; escopo "todas")
insert into public.acesso_usuarios (email, perfil_id, atualizado_por)
select email, case perfil when 'admin' then 'administrador' when 'supervisor' then 'supervisor_fiscal'
                          when 'consulta' then 'consulta' else 'analista_fiscal' end, 'conversão 0042'
from public.painel_usuarios
on conflict (email) do nothing;

-- Busca de XML com escopo de empresas (p.empresas = lista de ids; ausente = todas). Mesma lógica de busca_xml.
create or replace function public.busca_xml_escopo(p jsonb) returns jsonb
language sql stable
set search_path = public
as $$
with f as (
  select d.*
  from documentos d
  where (p->>'empresa' is null or d.empresa_id = (p->>'empresa')::uuid)
    and (p->'empresas' is null or d.empresa_id = any (select (jsonb_array_elements_text(p->'empresas'))::uuid))
    and d.emitida_em >= (p->>'de')::timestamptz and d.emitida_em < (p->>'ate')::timestamptz
    and (p->>'modelo' is null or d.modelo = p->>'modelo')
    and (p->>'direcao' is null or d.direcao = p->>'direcao')
    and (p->>'situacao' is null
      or (p->>'situacao' = 'resumo' and not d.completo)
      or (p->>'situacao' in ('autorizada', 'cancelada') and d.situacao = p->>'situacao'))
    and (p->>'uf' is null or left(d.chave, 2) = p->>'uf')
    and (p->'chaves' is null or d.chave = any (select jsonb_array_elements_text(p->'chaves')))
    and (p->'numeros' is null or exists (
      select 1 from jsonb_array_elements(p->'numeros') r
      where nullif(regexp_replace(coalesce(d.numero, ''), '\D', '', 'g'), '')::numeric between (r->>0)::numeric and (r->>1)::numeric))
    and (p->>'doc' is null or d.emit_cnpj = p->>'doc' or d.dest_doc = p->>'doc')
    and (p->>'nome' is null or d.emit_nome ilike '%' || (p->>'nome') || '%' or d.dest_nome ilike '%' || (p->>'nome') || '%')
)
select jsonb_build_object(
  'total', (select count(*) from f),
  'resumo', (select jsonb_build_object(
      'quantidade', count(*),
      'canceladas', count(*) filter (where situacao = 'cancelada'),
      'soResumo', count(*) filter (where not completo),
      'comXml', count(*) filter (where xml_path is not null),
      'empresas', count(distinct empresa_id),
      'entradas', coalesce(sum(valor) filter (where situacao = 'autorizada' and direcao = 'entrada'), 0),
      'saidas', coalesce(sum(valor) filter (where situacao = 'autorizada' and direcao = 'saida'), 0),
      'icms', coalesce(sum(v_icms) filter (where situacao = 'autorizada'), 0),
      'st', coalesce(sum(v_st) filter (where situacao = 'autorizada'), 0),
      'ipi', coalesce(sum(v_ipi) filter (where situacao = 'autorizada'), 0),
      'pis', coalesce(sum(v_pis) filter (where situacao = 'autorizada'), 0),
      'cofins', coalesce(sum(v_cofins) filter (where situacao = 'autorizada'), 0),
      'ibs', coalesce(sum(v_ibs) filter (where situacao = 'autorizada'), 0),
      'cbs', coalesce(sum(v_cbs) filter (where situacao = 'autorizada'), 0)) from f),
  'notas', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.emitida_em desc, x.chave)
    from (
      select f.chave, f.modelo, f.numero, f.serie, f.emitida_em, f.direcao, f.completo, f.emit_cnpj, f.emit_nome, f.dest_doc, f.dest_nome,
             f.valor, f.situacao, f.cfop, f.v_icms, f.v_st, f.recebido_via, f.empresa_id, e.razao_social as empresa_nome, e.cnpj as empresa_cnpj,
             (f.xml_path is not null) as tem_xml, case when p->>'caminhos' = 'sim' then f.xml_path end as xml_path
      from f join empresas e on e.id = f.empresa_id
      order by f.emitida_em desc, f.chave
      limit coalesce((p->>'limite')::int, 200) offset coalesce((p->>'offset')::int, 0)
    ) x), '[]'::jsonb)
);
$$;
revoke all on function public.busca_xml_escopo(jsonb) from public, anon, authenticated;

-- Capturas por dia só das empresas do escopo (aplicada como 0042b)
create or replace function public.captacao_por_dia_escopo(p_desde timestamptz, p_empresas uuid[])
returns table (dia date, recebido_via text, modelo text, qtd bigint)
language sql stable set search_path = public as $$
  select (capturado_em at time zone 'America/Sao_Paulo')::date, recebido_via, modelo::text, count(*)
  from documentos where capturado_em >= p_desde and empresa_id = any (p_empresas)
  group by 1, 2, 3;
$$;
revoke all on function public.captacao_por_dia_escopo(timestamptz, uuid[]) from public, anon, authenticated;
