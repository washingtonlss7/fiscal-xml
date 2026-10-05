-- Telas da Captação (Monitor, Lacunas/NSU, Importações, Histórico): funções só de leitura que resumem no banco
-- o que seria pesado buscar linha a linha. Nada é alterado; só um índice novo para contar capturas por dia.
-- Rollback: supabase/rollback/0040_captacao_down.sql

create index if not exists documentos_capturado on public.documentos (capturado_em desc);

-- Lacunas de NSU por empresa e modelo, na mesma janela que o coletor usa para recuperar (últimos 20.000 NSUs, a partir
-- do menor NSU guardado). Faltando = tamanho da janela − NSUs recebidos dentro dela (sem gerar a série inteira).
create or replace function public.captacao_lacunas_nsu()
returns table (empresa_id uuid, modelo text, ult_nsu bigint, max_nsu bigint, de bigint, recebidos bigint, lacunas bigint)
language sql stable set search_path = public as $$
  with s as (
    select st.empresa_id, st.modelo,
           case when st.ult_nsu ~ '^\d+$' then st.ult_nsu::bigint else 0 end as ate,
           case when st.max_nsu ~ '^\d+$' then st.max_nsu::bigint else 0 end as maximo,
           (select min(d.nsu) from dfe_recebidos d where d.empresa_id = st.empresa_id and d.modelo = st.modelo) as menor
    from sync_state st
  ), lim as (
    select s.empresa_id, s.modelo, s.ate, s.maximo,
           case when s.menor is null or s.menor !~ '^\d+$' then null else greatest(s.menor::bigint, s.ate - 20000, 1) end as de
    from s
  ), c as (
    select l.*, case when l.de is null or l.ate < l.de then 0 else
      (select count(distinct d.nsu) from dfe_recebidos d
        where d.empresa_id = l.empresa_id and d.modelo = l.modelo
          and d.nsu between lpad(l.de::text, 15, '0') and lpad(l.ate::text, 15, '0')) end as recebidos
    from lim l
  )
  select c.empresa_id, c.modelo, c.ate, c.maximo, c.de, c.recebidos,
         case when c.de is null or c.ate < c.de then 0 else (c.ate - c.de + 1) - c.recebidos end
  from c;
$$;

-- Numeração das notas de saída (NF-e e NFC-e) no período: menor e maior número por série, quantas autorizadas
-- ou canceladas existem e quantas faltam no intervalo; quantas das que faltam foram rejeitadas pela SEFAZ.
create or replace function public.captacao_numeracao(p_inicio timestamptz, p_fim timestamptz)
returns table (empresa_id uuid, modelo text, serie text, menor bigint, maior bigint, emitidas bigint, faltam bigint, rejeitadas bigint)
language sql stable set search_path = public as $$
  with d as (
    select empresa_id, modelo::text as modelo, coalesce(serie, '') as serie, numero::bigint as numero
    from documentos
    where direcao = 'saida' and modelo in ('55', '65') and numero ~ '^\d{1,9}$'
      and emitida_em >= p_inicio and emitida_em < p_fim
  ), g as (
    select empresa_id, modelo, serie, min(numero) menor, max(numero) maior, count(distinct numero) emitidas
    from d group by 1, 2, 3
  )
  select g.empresa_id, g.modelo, g.serie, g.menor, g.maior, g.emitidas, (g.maior - g.menor + 1) - g.emitidas as faltam,
    (select count(distinct r.numero) from notas_rejeitadas r
      where r.empresa_id = g.empresa_id and r.modelo = g.modelo and coalesce(r.serie, '') = g.serie
        and r.numero ~ '^\d{1,9}$' and r.numero::bigint between g.menor and g.maior
        and not exists (select 1 from d where d.empresa_id = g.empresa_id and d.modelo = g.modelo and d.serie = g.serie and d.numero = r.numero::bigint)) as rejeitadas
  from g;
$$;

-- Documentos capturados por dia (fuso de São Paulo), origem e modelo.
create or replace function public.captacao_por_dia(p_desde timestamptz)
returns table (dia date, recebido_via text, modelo text, qtd bigint)
language sql stable set search_path = public as $$
  select (capturado_em at time zone 'America/Sao_Paulo')::date, recebido_via, modelo::text, count(*)
  from documentos where capturado_em >= p_desde
  group by 1, 2, 3;
$$;

-- Última captura e capturas das últimas 24 h por empresa.
create or replace function public.captacao_ultimas()
returns table (empresa_id uuid, ultima_captura timestamptz, ultimas_24h bigint)
language sql stable set search_path = public as $$
  select empresa_id, max(capturado_em), count(*) filter (where capturado_em >= now() - interval '24 hours')
  from documentos group by 1;
$$;

revoke all on function public.captacao_lacunas_nsu() from public, anon, authenticated;
revoke all on function public.captacao_numeracao(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.captacao_por_dia(timestamptz) from public, anon, authenticated;
revoke all on function public.captacao_ultimas() from public, anon, authenticated;
