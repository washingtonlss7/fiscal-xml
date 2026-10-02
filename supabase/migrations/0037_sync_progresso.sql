-- Barra de status do botão "Sincronizar": o coletor grava o andamento no pedido.
alter table public.sync_requests add column if not exists iniciado_em timestamptz;
alter table public.sync_requests add column if not exists progresso jsonb;
