# API de integração do Appura (ex.: OnnePharma)

Outro sistema lê os XMLs de **NF-e e NFC-e** (entrada e saída) dos CNPJs liberados no Appura. CT-e nunca.
Duas formas, que se completam:

- **API com cursor**: o sistema pergunta "o que mudou desde a última vez?". Serve para a primeira carga e para
  recuperar qualquer aviso perdido.
- **Webhook**: o Appura avisa na hora a cada nota nova, cancelamento ou XML completo que chegar, já com o XML.

No painel: **Administração → Integrações (API)** (só administração). Cada integração tem um token próprio, a lista de
CNPJs liberados, o que pode ler (NF-e/NFC-e, entrada/saída) e, opcionalmente, o endereço do webhook. O token e o
segredo do webhook aparecem uma vez só. Toda chamada fica registrada; revogar corta o acesso na hora.

## Autenticação

    Authorization: Bearer apk_…        (43 caracteres depois de apk_)

Limite: 120 chamadas por minuto por integração (429 quando passar). Endereço: `https://fiscal.contabilfarmatech.com.br`.

## Rotas

### `GET /api/integracao/v1/empresas`
CNPJs liberados e o que o token pode ler.

### `GET /api/integracao/v1/documentos`
Notas novas ou alteradas **depois do cursor**, na ordem em que aconteceram.

| Parâmetro | |
|---|---|
| `cursor` | o `proximoCursor` da chamada anterior; vazio = desde o início (primeira carga) |
| `limite` | 1 a 500 (padrão 100) |
| `cnpj` | só um dos CNPJs liberados |
| `modelo` | `nfe` ou `nfce` |
| `direcao` | `entrada` ou `saida` |

Resposta:

```json
{
  "documentos": [{
    "chave": "3226…", "cnpj": "55885998000140", "empresa": "FARMA DIGITAL STORE LTDA",
    "modelo": "nfce", "direcao": "saida", "numero": "100123", "serie": "1",
    "emitidaEm": "2026-10-06T14:02:11-03:00", "valor": 48.99, "situacao": "autorizada",
    "completo": true, "protocolo": "132…", "emitente": {"cnpj": "…", "nome": "…"},
    "destinatario": {"documento": null, "nome": null}, "capturadoEm": "…",
    "mudanca": "gravada"
  }],
  "proximoCursor": "bTIzMTU1",
  "temMais": false
}
```

- `mudanca`: `existente` (já estava no Appura quando a API foi criada), `gravada` (nota nova ou XML completo chegou)
  ou `cancelada`.
- `situacao`: `autorizada`, `cancelada` ou `denegada`. `completo: false` = só o resumo da SEFAZ (sem produtos);
  a nota volta na lista quando o XML completo chegar.
- Guarde o `proximoCursor` **depois** de gravar as notas. Se `temMais` for `true`, chame de novo em seguida.
- A mesma nota pode aparecer de novo (cancelamento, XML completo): trate sempre pela **chave** (upsert).

### `GET /api/integracao/v1/documentos/{chave}/xml`
O XML autorizado (com protocolo). Enquanto só houver o resumo, devolve o resumo e o cabeçalho
`X-Appura-Completo: false`.

### `POST /api/integracao/v1/xml/zip`
Corpo `{"chaves": ["…", "…"]}` (até 500). Devolve um ZIP com `<chave>.xml` (ou `<chave>-resumo.xml`).
Chaves que não são dos CNPJs liberados ficam de fora.

## Webhook

O Appura faz `POST` no endereço cadastrado (só `https`, nunca rede interna), com:

    Content-Type: application/json
    X-Appura-Evento: documento.novo | documento.atualizado | teste
    X-Appura-Entrega: <id da entrega>
    X-Appura-Assinatura: t=<unix>,v1=<hex>

```json
{ "id": "123", "evento": "documento.novo", "versao": 1, "criadoEm": "…",
  "documento": { …mesmo formato da lista… }, "xml": "<?xml …>" }
```

- `documento.novo`: nota nova ou XML completo que chegou. `documento.atualizado`: cancelamento.
- `xml` vem junto quando tem até 1 MB; senão `null` (baixe pela rota do XML).
- Responda **2xx em até 15 s**. Qualquer outra resposta, ou falta de resposta, faz o Appura tentar de novo em
  1 min, 5 min, 15 min, 30 min, 1 h, 2 h, 4 h, 8 h, 12 h e 24 h; depois desiste (o painel mostra a falha e tem
  "Reenviar falhas"). Grave e responda rápido; processe depois.
- O mesmo aviso pode chegar mais de uma vez: use `X-Appura-Entrega` ou a chave para não duplicar.
- O webhook avisa só o que acontecer **depois** de configurado. O histórico se lê pela API com cursor vazio.

### Conferir a assinatura (Node.js)

```js
import crypto from 'node:crypto';

// corpo = texto cru recebido (antes de JSON.parse); segredo = whsec_… mostrado no Appura
export function assinaturaValida(corpo, cabecalho, segredo, toleranciaSeg = 300) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(cabecalho || '');
  if (!m || Math.abs(Date.now() / 1000 - Number(m[1])) > toleranciaSeg) return false;
  const esperado = crypto.createHmac('sha256', segredo).update(`${m[1]}.${corpo}`).digest();
  const recebido = Buffer.from(m[2], 'hex');
  return recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado);
}
```

Recuse (401) quando a assinatura não conferir.

## Sugestão de uso no OnnePharma

1. Na primeira vez, percorra `GET /documentos` sem cursor até `temMais` = `false`, baixando os XMLs em ZIP de até 500.
2. Ligue o webhook para receber as notas novas na hora.
3. De hora em hora (ou uma vez por dia), chame `GET /documentos?cursor=<último>` para pegar qualquer aviso que tenha
   se perdido. Como tudo é tratado pela chave, nada duplica.

## Como funciona por dentro

- Toda gravação de nota (SEFAZ, importação manual e Appura Coletor passam por `sync.ts/processarDoc`) registra uma
  linha em `integracao_mudancas` (o cursor). Cancelamentos registram uma linha para cada empresa que tem a nota.
- A cada 15 s o painel transforma as mudanças novas em entregas (`integracao_webhook_fila`) para cada integração com
  webhook e entrega as pendentes (até 40 por vez, 4 em paralelo, reserva com `for update skip locked`).
- Tabelas: `integracoes_api` (token só em hash, segredo do webhook cifrado com a MASTER_KEY), `integracao_api_empresas`,
  `integracao_mudancas`, `integracao_webhook_fila`, `integracao_api_chamadas`. Migração 0041; rollback em
  `supabase/rollback/0041_integracao_api_down.sql`.
