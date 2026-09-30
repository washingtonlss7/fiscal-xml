-- Fase Fiscal 1: SINTEGRA guardado (sped_arquivos tipo 'sintegra') e justificativa de divergências.

-- Divergências (XML × SPED, Fiscal × Contribuições, XML × SINTEGRA) que o escritório justificou.
-- Valem para a empresa + competência + tipo de arquivo: um arquivo retificador mantém as justificativas.
create table if not exists public.divergencias_justificadas (
  id bigint generated always as identity primary key,
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  competencia date not null,
  tipo_arquivo text not null,
  tipo_divergencia text not null,
  chave text not null,
  observacao text not null,
  justificado_por text not null,
  justificado_em timestamptz not null default now(),
  unique (empresa_id, competencia, tipo_arquivo, tipo_divergencia, chave)
);
alter table public.divergencias_justificadas enable row level security;

create or replace function public.painel_visao_geral(p_competencia date)
returns jsonb
language sql
stable
set search_path = public
as $$
  with lim as (
    select (date_trunc('month', p_competencia)::timestamp at time zone 'America/Sao_Paulo') as ini,
           ((date_trunc('month', p_competencia) + interval '1 month')::timestamp at time zone 'America/Sao_Paulo') as fim,
           date_trunc('month', p_competencia)::date as comp
  ),
  docs as (
    select d.empresa_id,
           count(*) as notas,
           count(*) filter (where d.completo and not d.auditado) as nao_auditadas,
           max(d.capturado_em) as ultima_nota_em,
           min((d.capturado_em at time zone 'America/Sao_Paulo')::date) as primeira_captura
      from documentos d, lim
     where d.emitida_em >= lim.ini and d.emitida_em < lim.fim
     group by d.empresa_id
  ),
  apont as (
    select a.empresa_id,
           count(*) filter (where a.status = 'aberto' and a.severidade in ('erro', 'alerta')) as abertos,
           count(*) as total
      from apontamentos a, lim
     where a.competencia = lim.comp
     group by a.empresa_id
  ),
  tratados as (
    select a.empresa_id, (a.resolvido_em at time zone 'America/Sao_Paulo')::date as dia, count(*) as n
      from apontamentos a, lim
     where a.competencia = lim.comp and a.status <> 'aberto' and a.resolvido_em is not null
     group by 1, 2
  ),
  sped as (
    select distinct on (s.empresa_id) s.empresa_id, s.erros, s.alertas, s.divergencias, s.enviado_em
      from sped_arquivos s, lim
     where s.competencia = lim.comp and s.empresa_id is not null and s.tipo = 'efd_icms_ipi'
     order by s.empresa_id, s.enviado_em desc, s.id desc
  ),
  contrib as (
    select distinct on (s.empresa_id) s.empresa_id, s.erros, s.alertas, s.divergencias, s.enviado_em
      from sped_arquivos s, lim
     where s.competencia = lim.comp and s.empresa_id is not null and s.tipo = 'efd_contribuicoes'
     order by s.empresa_id, s.enviado_em desc, s.id desc
  ),
  sintegra as (
    select distinct on (s.empresa_id) s.empresa_id, s.erros, s.alertas, s.divergencias, s.enviado_em
      from sped_arquivos s, lim
     where s.competencia = lim.comp and s.empresa_id is not null and s.tipo = 'sintegra'
     order by s.empresa_id, s.enviado_em desc, s.id desc
  )
  select jsonb_build_object(
    'competencia', (select comp from lim),
    'geradoEm', now(),
    'empresas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id, 'cnpj', v.cnpj, 'razao_social', v.razao_social, 'uf', v.uf, 'regime', v.regime,
        'ativo', v.ativo, 'escritorio', v.escritorio, 'criado_em', v.criado_em, 'status', v.status,
        'certificado_valido_ate', v.certificado_valido_ate, 'dias_para_vencer', v.dias_para_vencer,
        'ultima_sync_ok_em', v.ultima_sync_ok_em,
        'notas_mes', coalesce(d.notas, 0), 'nao_auditadas', coalesce(d.nao_auditadas, 0),
        'ultima_nota_em', d.ultima_nota_em,
        'apont_abertos', coalesce(a.abertos, 0), 'apont_total', coalesce(a.total, 0),
        'sped', case when sp.empresa_id is null then null else jsonb_build_object(
          'erros', sp.erros, 'alertas', sp.alertas, 'divergencias', sp.divergencias, 'enviado_em', sp.enviado_em) end,
        'contrib', case when ct.empresa_id is null then null else jsonb_build_object(
          'erros', ct.erros, 'alertas', ct.alertas, 'divergencias', ct.divergencias, 'enviado_em', ct.enviado_em) end,
        'sintegra', case when si.empresa_id is null then null else jsonb_build_object(
          'erros', si.erros, 'alertas', si.alertas, 'divergencias', si.divergencias, 'enviado_em', si.enviado_em) end
      ) order by v.razao_social)
        from vw_painel_empresas v
        left join docs d on d.empresa_id = v.id
        left join apont a on a.empresa_id = v.id
        left join sped sp on sp.empresa_id = v.id
        left join contrib ct on ct.empresa_id = v.id
        left join sintegra si on si.empresa_id = v.id
    ), '[]'::jsonb),
    'captacao', coalesce((
      select jsonb_agg(jsonb_build_object('empresa_id', empresa_id, 'dia', primeira_captura)) from docs
    ), '[]'::jsonb),
    'auditoria', coalesce((
      select jsonb_agg(jsonb_build_object('empresa_id', empresa_id, 'dia', dia, 'n', n)) from tratados
    ), '[]'::jsonb),
    'cadastrosPendentes', (select count(*) from cadastro_sugestoes where status = 'pendente')
  );
$$;

revoke all on function public.painel_visao_geral(date) from public, anon, authenticated;

-- Empresa 360°: + SPED Contribuições vigente e tipo do arquivo no histórico
create or replace function public.painel_empresa_360(p_empresa uuid, p_competencia date)
returns jsonb
language sql
stable
set search_path = public
as $$
  with lim as (
    select (date_trunc('month', p_competencia)::timestamp at time zone 'America/Sao_Paulo') as ini,
           ((date_trunc('month', p_competencia) + interval '1 month')::timestamp at time zone 'America/Sao_Paulo') as fim,
           date_trunc('month', p_competencia)::date as comp
  ),
  hist as (
    (select 'sefaz' as tipo, l.criado_em as em, null::text as por,
            jsonb_build_object('modelo', l.modelo, 'cstat', l.cstat, 'motivo', l.motivo, 'qtd', l.qtd_docs, 'erro', l.erro) as dados
       from logs_sefaz l
      where l.empresa_id = p_empresa and (coalesce(l.qtd_docs, 0) > 0 or l.erro is not null or coalesce(l.cstat, '') not in ('137', '138'))
      order by l.criado_em desc limit 40)
    union all
    (select 'pedido', r.solicitado_em, null, jsonb_build_object('status', r.status, 'mensagem', r.mensagem, 'processado_em', r.processado_em)
       from sync_requests r where r.empresa_id = p_empresa order by r.solicitado_em desc limit 20)
    union all
    (select 'auditoria', date_trunc('minute', a.resolvido_em), a.resolvido_por,
            jsonb_build_object('status', a.status, 'n', count(*), 'competencia', min(a.competencia))
       from apontamentos a where a.empresa_id = p_empresa and a.resolvido_em is not null
      group by date_trunc('minute', a.resolvido_em), a.resolvido_por, a.status
      order by 2 desc limit 40)
    union all
    (select 'importacao', date_trunc('minute', d.capturado_em), null, jsonb_build_object('n', count(*))
       from documentos d where d.empresa_id = p_empresa and d.recebido_via = 'importacao'
      group by date_trunc('minute', d.capturado_em) order by 2 desc limit 20)
    union all
    (select 'certificado', c.criado_em, null, jsonb_build_object('titular', c.titular, 'valido_ate', c.valido_ate, 'ativo', c.ativo)
       from certificados c where c.empresa_id = p_empresa order by c.criado_em desc limit 10)
    union all
    (select 'sped', s.enviado_em, s.enviado_por,
            jsonb_build_object('nome', s.nome, 'tipo', s.tipo, 'competencia', s.competencia, 'erros', s.erros, 'alertas', s.alertas, 'divergencias', s.divergencias)
       from sped_arquivos s where s.empresa_id = p_empresa order by s.enviado_em desc limit 20)
    union all
    (select 'cadastro', g.decidido_em, g.decidido_por,
            jsonb_build_object('status', g.status, 'campos', g.campos_aprovados, 'competencia', g.competencia)
       from cadastro_sugestoes g where g.empresa_id = p_empresa and g.status in ('aprovado', 'rejeitado') order by g.decidido_em desc limit 10)
    union all
    (select 'justificativa', date_trunc('minute', j.justificado_em), j.justificado_por,
            jsonb_build_object('n', count(*), 'tipo_arquivo', min(j.tipo_arquivo), 'competencia', min(j.competencia), 'observacao', min(j.observacao))
       from divergencias_justificadas j where j.empresa_id = p_empresa
      group by date_trunc('minute', j.justificado_em), j.justificado_por order by 2 desc limit 20)
  )
  select case when not exists (select 1 from empresas where id = p_empresa) then null else jsonb_build_object(
    'competencia', (select comp from lim),
    'geradoEm', now(),
    'empresa', (select to_jsonb(v) from vw_painel_empresas v where v.id = p_empresa),
    'cadastro', (select jsonb_build_object(
        'ie', e.ie, 'nome_fantasia', e.nome_fantasia, 'cod_municipio', e.cod_municipio, 'municipio', e.municipio,
        'logradouro', e.logradouro, 'numero', e.numero, 'complemento', e.complemento, 'bairro', e.bairro, 'cep', e.cep,
        'fone', e.fone, 'email', e.email, 'perfil_sped', e.perfil_sped,
        'contador_nome', e.contador_nome, 'contador_crc', e.contador_crc, 'contador_cnpj', e.contador_cnpj,
        'contador_email', e.contador_email, 'contador_fone', e.contador_fone,
        'cadastro_atualizado_em', e.cadastro_atualizado_em, 'cadastro_atualizado_por', e.cadastro_atualizado_por)
      from empresas e where e.id = p_empresa),
    'certificado', (select jsonb_build_object('titular', c.titular, 'valido_de', c.valido_de, 'valido_ate', c.valido_ate, 'criado_em', c.criado_em)
                      from certificados c where c.empresa_id = p_empresa and c.ativo order by c.criado_em desc limit 1),
    'captacao', coalesce((select jsonb_agg(jsonb_build_object(
        'modelo', s.modelo, 'ultima_consulta_em', s.ultima_consulta_em, 'ultima_sync_ok_em', s.ultima_sync_ok_em,
        'proxima_consulta_em', s.proxima_consulta_em, 'ultimo_cstat', s.ultimo_cstat, 'ultimo_motivo', s.ultimo_motivo,
        'erros_consecutivos', s.erros_consecutivos) order by s.modelo)
      from sync_state s where s.empresa_id = p_empresa), '[]'::jsonb),
    'documentos', coalesce((select jsonb_agg(x) from (
        select d.modelo, d.direcao, count(*) as n,
               count(*) filter (where d.situacao = 'cancelada') as canceladas,
               count(*) filter (where not d.completo) as so_resumo,
               count(*) filter (where d.completo and not d.auditado) as nao_auditadas
          from documentos d, lim
         where d.empresa_id = p_empresa and d.emitida_em >= lim.ini and d.emitida_em < lim.fim
         group by d.modelo, d.direcao) x), '[]'::jsonb),
    'auditoria', coalesce((select jsonb_agg(x) from (
        select a.status, a.severidade, count(*) as n
          from apontamentos a, lim
         where a.empresa_id = p_empresa and a.competencia = lim.comp
         group by a.status, a.severidade) x), '[]'::jsonb),
    'sped', (select jsonb_build_object('id', s.id, 'nome', s.nome, 'tamanho', s.tamanho, 'enviado_em', s.enviado_em, 'enviado_por', s.enviado_por,
               'processado_em', s.processado_em, 'erros', s.erros, 'alertas', s.alertas, 'divergencias', s.divergencias,
               'divergencias_info', s.divergencias_info, 'finalidade', s.finalidade)
               from sped_arquivos s, lim
              where s.empresa_id = p_empresa and s.competencia = lim.comp and s.tipo = 'efd_icms_ipi'
              order by s.enviado_em desc, s.id desc limit 1),
    'contrib', (select jsonb_build_object('id', s.id, 'nome', s.nome, 'enviado_em', s.enviado_em, 'enviado_por', s.enviado_por,
               'erros', s.erros, 'alertas', s.alertas, 'divergencias', s.divergencias, 'finalidade', s.finalidade)
               from sped_arquivos s, lim
              where s.empresa_id = p_empresa and s.competencia = lim.comp and s.tipo = 'efd_contribuicoes'
              order by s.enviado_em desc, s.id desc limit 1),
    'sintegra', (select jsonb_build_object('id', s.id, 'nome', s.nome, 'enviado_em', s.enviado_em, 'enviado_por', s.enviado_por,
               'erros', s.erros, 'alertas', s.alertas, 'divergencias', s.divergencias, 'finalidade', s.finalidade)
               from sped_arquivos s, lim
              where s.empresa_id = p_empresa and s.competencia = lim.comp and s.tipo = 'sintegra'
              order by s.enviado_em desc, s.id desc limit 1),
    'spedArquivos', coalesce((select jsonb_agg(x order by x.enviado_em desc) from (
        select s.id, s.nome, s.tipo, s.competencia, s.tamanho, s.enviado_em, s.enviado_por, s.erros, s.divergencias
          from sped_arquivos s where s.empresa_id = p_empresa order by s.enviado_em desc limit 60) x), '[]'::jsonb),
    'sugestao', (select jsonb_build_object('id', g.id, 'competencia', g.competencia, 'criado_em', g.criado_em, 'criado_por', g.criado_por, 'dados', g.dados)
                   from cadastro_sugestoes g where g.empresa_id = p_empresa and g.status = 'pendente' limit 1),
    'historico', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'em', em, 'por', por, 'dados', dados) order by em desc)
                             from (select * from hist where em is not null order by em desc limit 80) h), '[]'::jsonb)
  ) end;
$$;

revoke all on function public.painel_empresa_360(uuid, date) from public, anon, authenticated;
