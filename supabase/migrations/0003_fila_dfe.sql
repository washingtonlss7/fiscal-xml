-- Fila de documentos recebidos: o lote bruto é gravado antes de ser processado,
-- para que o ultNSU possa ser salvo imediatamente (a SEFAZ exige usar sempre o último NSU devolvido).

alter table public.dfe_recebidos
  add column xml text,
  add column processado boolean not null default true;

-- Linhas novas entram como pendentes de processamento.
alter table public.dfe_recebidos alter column processado set default false;

create index dfe_recebidos_pendentes on public.dfe_recebidos (empresa_id, modelo, nsu) where not processado;

-- Controle da recuperação de lacunas (consNSU tem limite de 20 consultas por hora).
alter table public.sync_state
  add column lacunas_verificadas_em timestamptz;

-- NSUs que faltam na sequência recebida de uma empresa/modelo, até p_ate.
create or replace function public.lacunas_nsu(p_empresa uuid, p_modelo text, p_ate varchar, p_limite int)
returns table (nsu varchar)
language sql stable security invoker
set search_path = public
as $$
  with limites as (
    select greatest(min(d.nsu::bigint), p_ate::bigint - 20000) as de
    from public.dfe_recebidos d
    where d.empresa_id = p_empresa and d.modelo = p_modelo
  )
  select lpad(g::text, 15, '0')::varchar
  from limites, generate_series(limites.de, p_ate::bigint) g
  where limites.de is not null
    and not exists (
      select 1 from public.dfe_recebidos d
      where d.empresa_id = p_empresa and d.modelo = p_modelo and d.nsu = lpad(g::text, 15, '0')
    )
  order by g
  limit p_limite;
$$;

revoke execute on function public.lacunas_nsu(uuid, text, varchar, int) from public, anon, authenticated;
