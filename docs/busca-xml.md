# Busca de XML (dois níveis)

O mesmo componente (`public/busca-xml.js`) aparece em dois lugares:

- **Escritório: menu Notas Fiscais (`#/notas`).** Tem o seletor "Todas as empresas" ou um cliente; `#/notas?empresa=<id>` já abre com o cliente escolhido. Com "Todas as empresas", a tabela ganha a coluna Empresa e o ZIP tem uma pasta por empresa.
- **Empresa: aba Notas Fiscais.** A busca fica presa àquela empresa e mostra o resumo de impostos.

## Filtros

| Filtro | Como funciona |
|---|---|
| Período | De/até, padrão = competência do topo. |
| UF do emitente | Os 2 primeiros dígitos da chave. |
| Direção, documento (NF-e, NFC-e, CT-e) e situação (autorizada, cancelada, só resumo) | Seleção simples. |
| Buscar por: número | Números ou faixas, como `10001, 10002` ou `10001-10050`. |
| Buscar por: chave | Uma ou várias chaves coladas (uma por linha). |
| Buscar por: CNPJ/CPF | CNPJ ou CPF do emitente ou do destinatário. |
| Buscar por: nome | Parte do nome do emitente ou do destinatário. |

A consulta é a função `busca_xml(p jsonb)` (migração 0033). Ela devolve o total, o resumo (valores e impostos) e uma página de 200 notas.

## Downloads

- As notas marcadas valem entre páginas. Sem nenhuma marcada, os botões pegam tudo o que a busca achou.
- O ZIP (`POST /api/xml/zip`) vem no mesmo layout de pastas do ZIP do mês. As notas que só têm resumo vão listadas em `SEM-XML-COMPLETO.txt`.
- A planilha sai por `POST /api/xml/excel`.
- O perfil Consulta também baixa.

## Cuidados

- O período tem no máximo 12 meses, conferido na tela e no servidor.
- O ZIP tem no máximo 5.000 XMLs, e o ZIP do mês da Empresa 360° segue o mesmo limite. A planilha tem no máximo 20.000 linhas.
- Todo download (XML avulso, ZIP e planilha) fica em `downloads_xml`, com e-mail, tipo, empresa, filtros, quantidade e data.
