-- Tabelas acompanhadas em tempo real pelo servidor do painel (Supabase Realtime).
-- Só o servidor (service role) assina; o navegador recebe um aviso pelo próprio painel.
do $$
declare t text;
begin
  foreach t in array array['sync_state','sync_requests','empresas','certificados','apontamentos'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
