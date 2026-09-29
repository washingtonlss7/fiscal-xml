-- Apontamentos agregados (referência "mes") precisam ser únicos por competência.
alter table public.apontamentos drop constraint apontamentos_empresa_id_regra_referencia_key;
alter table public.apontamentos add constraint apontamentos_unico unique (empresa_id, competencia, regra, referencia);
