-- Rollback da 0044 (Folha, Societário, Financeiro, Atendimento). Apaga os dados desses módulos. Só com confirmação.
drop table if exists public.atd_mensagens;
drop table if exists public.atd_chamados;
drop table if exists public.fin_titulos;
drop table if exists public.fin_contratos;
drop table if exists public.soc_processos;
drop table if exists public.soc_documentos;
drop table if exists public.soc_socios;
drop table if exists public.soc_cadastro;
drop table if exists public.folha_controle;
drop table if exists public.folha_empresas;
drop table if exists public.folha_etapas;
delete from public.escritorio_modulos where modulo = 'atendimento';
update public.acesso_perfis set permissoes = array(select p from unnest(permissoes) p where p not like 'atendimento.%') where sistema;
