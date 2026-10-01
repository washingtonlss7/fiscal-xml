-- Busca de XML em dois níveis (escritório inteiro ou uma empresa): filtros por período, UF do emitente (2 primeiros
-- dígitos da chave), direção, modelo, situação, números/faixas, lista de chaves, CNPJ/CPF ou nome.
-- Uma chamada devolve o total, o resumo (valores e impostos) e a página pedida.

create index if not exists documentos_emitida on public.documentos (emitida_em desc);

create or replace function public.busca_xml(p jsonb) returns jsonb
language sql stable
set search_path = public
as $$
with f as (
  select d.*
  from documentos d
  where (p->>'empresa' is null or d.empresa_id = (p->>'empresa')::uuid)
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
revoke all on function public.busca_xml(jsonb) from public, anon, authenticated;

-- Registro de downloads de XML (quem baixou, o quê, quando).
create table if not exists public.downloads_xml (
  id bigint generated always as identity primary key,
  email text not null,
  tipo text not null check (tipo in ('xml', 'zip', 'excel')),
  empresa_id uuid references public.empresas(id) on delete set null,
  filtros jsonb,
  quantidade integer not null,
  em timestamptz not null default now()
);
create index if not exists downloads_xml_em on public.downloads_xml (em desc);
alter table public.downloads_xml enable row level security;
