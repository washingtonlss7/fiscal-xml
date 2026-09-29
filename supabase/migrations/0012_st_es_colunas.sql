-- MVA por tipo de fornecedor (Portaria SEFAZ-ES 16-R/2019: indústria/importador x distribuidor)
-- e regra por origem da mercadoria (ex.: azeite nacional x importado).
alter table public.st_es_regras
  add column if not exists mva_distribuidor numeric(9,4),
  add column if not exists origem text check (origem in ('nacional', 'importado'));

create or replace function public.substituir_regras_st(p_regras jsonb, p_por text)
returns integer
language plpgsql volatile security invoker
set search_path = public
as $$
declare n integer;
begin
  delete from st_es_regras where true;
  insert into st_es_regras (cest, ncm, descricao, mva, mva_distribuidor, pmpf, aliquota_interna, origem, atualizado_por)
  select nullif(r->>'cest',''), nullif(r->>'ncm',''), nullif(r->>'descricao',''),
         (r->>'mva')::numeric, (r->>'mva_distribuidor')::numeric, (r->>'pmpf')::numeric,
         coalesce((r->>'aliquota_interna')::numeric, 17), nullif(r->>'origem',''), p_por
  from jsonb_array_elements(p_regras) r;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.substituir_regras_st(jsonb, text) from public, anon, authenticated;
