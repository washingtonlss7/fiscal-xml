-- Rollback da 0041 (API de integração). Remove os gatilhos de documentos, a coluna integ_seq e as tabelas da integração
-- (tokens, fila do webhook, registro de chamadas). As notas não são apagadas. Rodar só com confirmação explícita.
drop trigger if exists documentos_webhook on public.documentos;
drop trigger if exists documentos_integ_seq on public.documentos;
drop function if exists public.documentos_webhook_gatilho();
drop function if exists public.documentos_integ_seq_gatilho();
drop function if exists public.integracao_webhook_reservar(integer, integer);
drop index if exists public.documentos_integ;
alter table public.documentos drop column if exists integ_seq;
drop sequence if exists public.documentos_integ_seq;
drop table if exists public.integracao_api_chamadas;
drop table if exists public.integracao_webhook_fila;
drop table if exists public.integracao_api_empresas;
drop table if exists public.integracoes_api;
