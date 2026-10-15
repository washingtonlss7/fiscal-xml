-- Desfaz 0045_nfse_nacional.sql (apaga as NFS-e captadas: os XML continuam no armazenamento).
drop table if exists public.nfse_logs;
drop table if exists public.nfse_eventos;
drop table if exists public.nfse_documentos;
drop table if exists public.nfse_captacao;
