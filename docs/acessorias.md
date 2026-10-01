# Integração com o Sistema Acessórias

API: https://api.acessorias.com/documentation. O token é cadastrado em Administração › Escritório, fica cifrado com a `MASTER_KEY` e nunca volta para a tela. O limite da Acessórias é de 100 requisições por minuto, e o Appura espera 700 ms entre chamadas (envio e leitura juntos).

## Envio (e-Contínuo, só PDF)

A Acessórias lê do próprio PDF o CNPJ, a competência e o tipo do documento, e dá baixa na entrega da obrigação. Se a obrigação da competência não existir para a empresa lá, ela responde "Entrega [...] inexistente", e o Appura grava esse erro.

| O que vai | De onde vem |
|---|---|
| DAS e DAS-MEI | Gerados pelo Integra Contador (aba Guias). Tabela `guias_envios`. |
| Recibo do SPED Fiscal e do Contribuições, DARF, DCTFWeb, recibo da Reinf, guia de ICMS (DUA), outro | PDF enviado pelo escritório na aba **Documentos** da empresa. |
| Recibo, declaração e MAED do PGDAS-D | Entram sozinhos na transmissão (`ServicoApuracao.transmitir`). |

Os documentos ficam em `documentos_entrega`, com o PDF cifrado no R2, e cada tentativa de envio fica em `documentos_entrega_envios`.

- O mesmo arquivo (hash) não entra duas vezes na mesma empresa.
- Com o envio automático ligado, o documento vai à Acessórias assim que entra.
- Sem o envio automático, o envio é manual: por documento, pelo "Enviar pendentes" da empresa, ou em lote pela rota `POST /api/acessorias/documentos/enviar`.
- O que já foi aceito só é enviado de novo pelo "Reenviar".
- Remover um documento tira o arquivo só do Appura; na Acessórias nada muda. O comprovante do PGDAS-D não pode ser removido.

## Leitura (nada é alterado na Acessórias)

- **Cadastro**: `GET /companies/ListAll?Pagina=N&obligations=1`, 20 empresas por página, guardado em `acessorias_empresas`. O resultado mostra:
  - as empresas do Appura sem cadastro na Acessórias;
  - as obrigações atrasadas de cada empresa no cadastro.
- **Entregas da competência**: `GET /deliveries/{cnpj}?DtInitial=<1º dia da competência>&DtFinal=<+3 meses>&config=1`. Ficam só as entregas daquela competência, guardadas em `acessorias_entregas`. A situação (entregue, atrasada, pendente ou dispensada) é recalculada com a data de hoje.
- **Em lote**: o botão "Consultar entregas do mês" faz uma consulta por empresa cadastrada, em segundo plano (cerca de 100 por minuto), e a tela mostra o progresso. O progresso fica em memória: se o servidor reiniciar, a consulta é interrompida.

## Telas

- **Empresa › Documentos**: documentos do mês (adicionar PDF, baixar, enviar ou reenviar, remover) e as obrigações da empresa na Acessórias ("Consultar agora").
- **Administração › Escritório**: cartão "Acessórias: cadastro e entregas", com sincronizar empresas, empresas sem cadastro, obrigações atrasadas e entregas do mês em lote.

## MCP

- `appura_acessorias` (consulta): com empresa, mostra as entregas, as obrigações atrasadas e os documentos do mês; com `atualizar=true`, consulta na hora. Sem empresa, mostra o panorama do escritório.
- `appura_enviar_guias_acessorias` (ação, com prévia e confirmação): envia as guias DAS e os documentos do mês pendentes. `o_que` aceita `tudo`, `guias` ou `documentos`.

## Ainda não validado

O código foi testado com respostas simuladas a partir da documentação. Falta conferir com a Acessórias de verdade:

- o formato das datas e da competência nas entregas;
- o valor do flag `obligations`/`config`;
- se o e-Contínuo reconhece cada tipo de PDF: recibo do SPED, DCTFWeb, Reinf, DUA do ES e PGDAS-D.
