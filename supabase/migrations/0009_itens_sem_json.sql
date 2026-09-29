-- Banco mais enxuto: o grupo <imposto> completo deixa de ser guardado por item.
-- Os campos usados pela auditoria e pela apuração continuam em colunas; o XML original segue guardado.
alter table public.documento_itens drop column if exists imposto;
