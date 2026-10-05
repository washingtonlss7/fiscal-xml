-- Rollback da 0040 (telas da Captação): só funções de leitura e um índice. Não apaga dados.
drop function if exists public.captacao_ultimas();
drop function if exists public.captacao_por_dia(timestamptz);
drop function if exists public.captacao_numeracao(timestamptz, timestamptz);
drop function if exists public.captacao_lacunas_nsu();
drop index if exists public.documentos_capturado;
