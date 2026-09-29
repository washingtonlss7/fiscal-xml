-- Documentos importados pelo painel (XML/ZIP enviado pelo escritório).
alter table public.documentos drop constraint if exists documentos_recebido_via_check;
alter table public.documentos add constraint documentos_recebido_via_check
  check (recebido_via in ('proprio', 'autxml', 'importacao'));
