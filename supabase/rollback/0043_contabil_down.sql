-- Rollback da 0043 (Contábil). Apaga regras, movimentos, lançamentos e logs do Contábil. Só com confirmação explícita.
drop table if exists public.ctb_lancamentos;
drop table if exists public.ctb_arquivos;
drop table if exists public.ctb_movimentos;
drop table if exists public.ctb_raw_folha;
drop table if exists public.ctb_processamentos;
drop table if exists public.ctb_config;
drop table if exists public.ctb_regras_folha;
drop table if exists public.ctb_regras_fiscais;
drop table if exists public.ctb_empresa_periodos;
drop table if exists public.ctb_empresas;
drop table if exists public.ctb_contas;
drop table if exists public.ctb_planos;
