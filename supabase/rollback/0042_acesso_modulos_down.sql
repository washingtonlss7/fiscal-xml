-- Rollback da 0042 (permissões por módulo/empresa). O painel antigo volta a usar painel_usuarios.perfil, que
-- continuou sendo gravado. Rodar só com confirmação explícita.
drop function if exists public.busca_xml_escopo(jsonb);
drop function if exists public.captacao_por_dia_escopo(timestamptz, uuid[]);
drop table if exists public.acesso_log;
drop table if exists public.escritorio_modulos;
drop table if exists public.empresa_responsaveis;
drop table if exists public.acesso_usuario_empresas;
drop table if exists public.acesso_usuarios;
drop table if exists public.acesso_perfis;
