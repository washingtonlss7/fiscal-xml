-- Rollback da migração 0038 (Appura NFC-e Worker, Fase 1). DESTRUTIVO: apaga configurações, checkpoints e histórico do NFC-e.
-- Rodar só com confirmação explícita, depois de parar o serviço nfce-worker. Não toca em nenhuma tabela do coletor ou do painel.
drop function if exists public.nfce_lock_liberar(text, text);
drop function if exists public.nfce_lock_renovar(text, text, integer);
drop function if exists public.nfce_lock_adquirir(text, text, integer);
drop table if exists public.nfce_locks;
drop table if exists public.nfce_execucoes;
drop table if exists public.nfce_checkpoint;
drop table if exists public.nfce_config;
