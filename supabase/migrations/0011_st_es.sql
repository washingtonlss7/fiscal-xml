-- Tabela de ST do ES mantida pelo escritório (MVA ou PMPF por CEST/NCM).
-- Usada para calcular o ICMS-ST devido nas compras de outros estados sem ST retido.
create table if not exists public.st_es_regras (
  id                bigserial primary key,
  cest              varchar(7),
  ncm               varchar(8),
  descricao         text,
  mva               numeric(9,4),          -- em %, ex.: 40 = 40%
  pmpf              numeric(15,4),         -- por unidade; quando existe, é a Base ST
  aliquota_interna  numeric(6,2) not null default 17,
  atualizado_em     timestamptz not null default now(),
  atualizado_por    text,
  constraint st_es_regras_chave check (cest is not null or ncm is not null),
  constraint st_es_regras_valor check (mva is not null or pmpf is not null)
);
create index if not exists st_es_regras_cest on public.st_es_regras (cest);
alter table public.st_es_regras enable row level security;

-- Troca a tabela inteira numa única transação (importação do CSV pelo painel).
create or replace function public.substituir_regras_st(p_regras jsonb, p_por text)
returns integer
language plpgsql volatile security invoker
set search_path = public
as $$
declare n integer;
begin
  delete from st_es_regras where true;
  insert into st_es_regras (cest, ncm, descricao, mva, pmpf, aliquota_interna, atualizado_por)
  select nullif(r->>'cest',''), nullif(r->>'ncm',''), nullif(r->>'descricao',''),
         (r->>'mva')::numeric, (r->>'pmpf')::numeric, coalesce((r->>'aliquota_interna')::numeric, 17), p_por
  from jsonb_array_elements(p_regras) r;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.substituir_regras_st(jsonb, text) from public, anon, authenticated;
