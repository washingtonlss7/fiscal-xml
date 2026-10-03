-- Rollback da migração 0039 (Appura Coletor). DESTRUTIVO: apaga instalações, máquinas (os tokens deixam de valer) e o registro dos envios.
-- Os XMLs já recebidos ficam (estão em documentos). Rodar só com confirmação explícita.
drop table if exists public.coletor_envios;
drop table if exists public.coletor_maquinas;
drop table if exists public.coletor_instalacao_empresas;
drop table if exists public.coletor_instalacoes;
