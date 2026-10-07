-- Rollback da 0041 (API de integração): remove só as tabelas da integração (tokens, fila do webhook, registro de
-- chamadas e de mudanças). As notas não são tocadas. Rodar só com confirmação explícita.
drop function if exists public.integracao_webhook_reservar(integer, integer);
drop table if exists public.integracao_api_chamadas;
drop table if exists public.integracao_webhook_fila;
drop table if exists public.integracao_mudancas;
drop table if exists public.integracao_api_empresas;
drop table if exists public.integracoes_api;
