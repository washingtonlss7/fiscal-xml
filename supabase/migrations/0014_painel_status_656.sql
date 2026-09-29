-- Situação da empresa no painel:
-- * o motivo mostrado é o do modelo com problema (antes vinha o da consulta mais recente, que podia ser um sucesso);
-- * 656 "Deve ser utilizado o ultNSU" (outro sistema consultou o mesmo CNPJ) vira "conflito_nsu", não "erro":
--   o coletor já corrige o NSU sozinho e recupera as notas na próxima janela.
create or replace view public.vw_painel_empresas as
 SELECT e.id,
    e.cnpj,
    e.razao_social,
    e.uf,
    e.regime,
    e.codigo_erp,
    e.ativo,
    e.criado_em,
    c.titular,
    c.valido_ate AS certificado_valido_ate,
    c.valido_ate::date - CURRENT_DATE AS dias_para_vencer,
    s.ultima_sync_ok_em,
    s.proxima_consulta_em,
    COALESCE(s.erros, 0) AS erros_consecutivos,
    s.ultimo_cstat,
    s.ultimo_motivo,
    ( SELECT count(*) AS count
           FROM documentos d
          WHERE d.empresa_id = e.id AND d.emitida_em >= (now() - '30 days'::interval)) AS documentos_30d,
    (EXISTS ( SELECT 1
           FROM sync_requests r
          WHERE r.empresa_id = e.id AND (r.status = ANY (ARRAY['pendente'::text, 'processando'::text])))) AS sincronizacao_pedida,
        CASE
            WHEN NOT e.ativo THEN 'pausada'::text
            WHEN c.id IS NULL THEN 'sem_certificado'::text
            WHEN c.valido_ate < now() THEN 'certificado_vencido'::text
            WHEN COALESCE(s.erros, 0) > 0 AND s.ultimo_cstat = '656' AND s.ultimo_motivo ILIKE '%ultNSU%' THEN 'conflito_nsu'::text
            WHEN COALESCE(s.erros, 0) > 0 THEN 'erro'::text
            WHEN s.ultima_sync_ok_em IS NULL THEN 'aguardando'::text
            WHEN s.ultima_sync_ok_em < (now() - '36:00:00'::interval) THEN 'atrasada'::text
            WHEN c.valido_ate < (now() + '30 days'::interval) THEN 'certificado_vencendo'::text
            ELSE 'ok'::text
        END AS status,
    e.escritorio,
    e.manifestar_ciencia,
    ( SELECT count(*) AS count
           FROM apontamentos a
          WHERE a.empresa_id = e.id AND a.status = 'aberto'::text AND (a.severidade = ANY (ARRAY['erro'::text, 'alerta'::text]))) AS pendencias_auditoria
   FROM empresas e
     LEFT JOIN certificados c ON c.empresa_id = e.id AND c.ativo
     LEFT JOIN LATERAL ( SELECT min(ss.ultima_sync_ok_em) AS ultima_sync_ok_em,
            max(ss.proxima_consulta_em) AS proxima_consulta_em,
            max(ss.erros_consecutivos) AS erros,
            (array_agg(ss.ultimo_cstat ORDER BY ss.erros_consecutivos DESC, ss.ultima_consulta_em DESC NULLS LAST))[1] AS ultimo_cstat,
            (array_agg(ss.ultimo_motivo ORDER BY ss.erros_consecutivos DESC, ss.ultima_consulta_em DESC NULLS LAST))[1] AS ultimo_motivo
           FROM sync_state ss
          WHERE ss.empresa_id = e.id) s ON true;
