-- Quatro perfis do escritório: administrador, supervisor, analista (antigo "operador") e consulta.
alter table public.painel_usuarios drop constraint if exists painel_usuarios_perfil_check;
update public.painel_usuarios set perfil = 'analista' where perfil = 'operador';
alter table public.painel_usuarios alter column perfil set default 'analista';
alter table public.painel_usuarios add constraint painel_usuarios_perfil_check check (perfil in ('admin', 'supervisor', 'analista', 'consulta'));
