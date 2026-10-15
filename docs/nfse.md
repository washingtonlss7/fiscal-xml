# NFS-e Nacional (ADN)

O Appura capta as NFS-e do padrão nacional no Ambiente de Dados Nacional (ADN). Usa o certificado de cada empresa, o mesmo da NF-e. Vêm as notas em que a empresa é prestadora (emitidas), tomadora (recebidas) ou intermediária, e os eventos (cancelamento, substituição, manifestações).

## Como funciona

- **Endereço:** `GET https://adn.nfse.gov.br/contribuintes/DFe/{NSU}?lote=true`, com autenticação mútua (mTLS) pelo certificado da empresa. Em homologação: `adn.producaorestrita.nfse.gov.br`.
  - O Swagger oficial mostra `contribuinte` no singular; o caminho que funciona é o plural.
- **NSU:** cada documento tem um número sequencial por CNPJ.
  - O último NSU lido fica em `nfse_captacao.ult_nsu`, e a próxima consulta pede a partir dele.
  - NSU repetido é ignorado.
- **Ritmo:**
  - lote cheio (50 documentos): continua em 1 segundo, até o limite de chamadas da rodada;
  - lote parcial ou vazio: volta no intervalo do coletor (`INTERVALO_HORAS`, nunca menos de 1 hora), dentro da janela de horário;
  - HTTP 429: espera 65 minutos;
  - outros erros: espera 15 min, 30, 60… até 6 h.
- **Agendador:** próprio no coletor (`src/worker.ts`), com metade das vagas da NF-e. O botão "Sincronizar agora" também consulta a NFS-e, se ela estiver ligada para a empresa e a última consulta tiver mais de 10 minutos.
- **Gravação:**
  - XML no armazenamento cifrado, em `CNPJ/AAAA/MM/nfse/{chave}.xml`.
  - Dados em `nfse_documentos`, uma linha por empresa e chave. A mesma nota pode estar no prestador e no tomador.
  - Eventos em `nfse_eventos`. O cancelamento (101101, 101103, 105104) e a substituição (105102) mudam a situação de todas as cópias da nota.
- **Leitura do XML:** leiaute 1.00 (`src/nfse/leitor.ts`). Campos lidos:
  - número, série e número do DPS, competência, emissão;
  - prestador, tomador e intermediário;
  - municípios de incidência e de prestação;
  - código de tributação nacional, NBS, descrição;
  - valor do serviço, base, alíquota, ISS, ISS retido, retenções, valor líquido.

## Painel

Menu Captação → **NFS-e Nacional** (`#/nfse/notas` e `#/nfse/captacao`).

- **Notas:** filtros por empresa, emitidas ou recebidas, situação e busca. Mostra os totais do mês e baixa o XML de cada nota, o ZIP (até 5.000 notas, com uma pasta por empresa quando são várias) e a planilha.
- **Captação por empresa:** liga e desliga por empresa (marcadas, ou todas com certificado válido) e mostra a situação, a última consulta, a próxima, o NSU e o total captado.
- **Permissões:**
  - consultar e baixar: `captacao.ver`;
  - ligar e desligar: `administracao.empresas`.
  - Tudo respeita o escopo de empresas de quem consulta.

## Contábil

As NFS-e entram no processamento fiscal do Contábil, uma por nota, pelo valor do serviço. Como a nota de serviço não tem CFOP, a regra é escolhida pelo CFOP de serviço tributado pelo ISS:

| Nota | Mesmo estado | Outro estado |
|---|---|---|
| Emitida (prestador) | 5933 | 6933 |
| Recebida (tomador) | 1933 | 2933 |

- O estado vem dos dois primeiros dígitos do código IBGE dos municípios do prestador e do tomador.
- Nota cancelada ou substituída não gera lançamento. Se já tinha gerado e o lançamento não foi exportado em definitivo, ele é retirado.
- Nota só como intermediário não gera lançamento.
- No histórico, `{modelo}` vira "NFS-e".

## Banco

- Migração: `supabase/migrations/0045_nfse_nacional.sql`, só com tabelas novas: `nfse_captacao`, `nfse_documentos`, `nfse_eventos` e `nfse_logs`.
- Reversão: `supabase/rollback/0045_nfse_nacional_down.sql`.

## Código e testes

- Código: `src/nfse/adn.ts` (cliente), `src/nfse/leitor.ts` (XML), `src/nfse/sync.ts` (captação), `src/painel/nfse.ts` (painel) e `public/nfse.js` (tela).
- Testes: `test/nfse.test.ts`. Cobrem a resposta do ADN (gzip e base64, PascalCase e camelCase, 404, 429, 5xx, recusa do certificado), o XML da nota e do evento, a captação por NSU com transporte simulado, o painel, o Contábil, as permissões e as rotas.
