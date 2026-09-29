# fiscal-xml

Coletor de **NF-e** e **CT-e** direto da SEFAZ (Ambiente Nacional, serviço *DistribuicaoDFe*) usando o certificado A1 de cada cliente do escritório. Guarda os XMLs no Supabase Storage e os dados das notas no Postgres.

Esta é a **Fase 1** (captação). Manifestação do destinatário, exportação para o ERP, painel web e auditoria vêm nas próximas fases.

## Como funciona

- Para cada empresa ativa, o coletor consulta o `distNSU` a partir do último NSU salvo, em lotes de até 50 documentos, até alcançar o `maxNSU`.
- Segue as regras da NT 2014.002: depois de chegar ao fim ou receber **137** (nenhum documento), só consulta de novo após **1 hora**. Se receber **656** (consumo indevido), o CNPJ fica bloqueado por 1 hora e o coletor espera.
- Rodadas agendadas às **2h e 14h** (horário de Brasília), configuráveis em `CRON_RODADAS`.
- Pedidos manuais entram pela tabela `sync_requests` (o botão "Sincronizar agora" do painel vai gravar ali).
- Os certificados ficam no banco **cifrados com AES-256-GCM**. A chave (`MASTER_KEY`) fica só no servidor.

| Documento recebido | O que é | Onde vai |
|---|---|---|
| `resNFe` | Resumo de NF-e recebida (antes da ciência) | `documentos` com `completo = false` |
| `procNFe` | XML completo da NF-e | `documentos` com `completo = true` |
| `procCTe` | XML completo do CT-e | `documentos` (modelo 57) |
| `resEvento` / `procEventoNFe` / `procEventoCTe` | Cancelamento, CC-e, manifestações | `eventos` (cancelamento marca a nota como cancelada) |

**Limites do serviço:** a SEFAZ só distribui documentos dos **últimos 90 dias**, e o emitente **não recebe as próprias notas de saída** por aqui. NF-e de saída exige o CNPJ do escritório na tag `autXML` ou integração com o emissor. NFC-e não é distribuída pelo Ambiente Nacional.

## 1. Primeiro teste com um certificado real (sem banco)

Antes de subir tudo, confirme que o certificado conversa com a SEFAZ. Dá para rodar no seu PC (Node 22) ou na VPS.

```bash
git clone https://github.com/washingtonlss7/fiscal-xml.git
cd fiscal-xml
npm install
mkdir certificados              # esta pasta está no .gitignore
# copie o .pfx do cliente para certificados/cliente.pfx

CERT_PATH=certificados/cliente.pfx UF=ES npm run teste-sefaz
```

No Windows (PowerShell), defina as variáveis antes:

```powershell
$env:CERT_PATH="certificados\cliente.pfx"; $env:UF="ES"; npm run teste-sefaz
```

A senha é pedida no terminal e não aparece na tela. O resultado fica em `saida/<CNPJ>/nfe/`, um arquivo por documento. Para CT-e, use `MODELO=cte`.

O script salva o último NSU em `saida/<CNPJ>/<modelo>/estado.json` e **se recusa a consultar de novo antes de 1 hora** quando a SEFAZ indica que não há mais documentos. Isso evita o bloqueio por consumo indevido.

**O que esperar na primeira consulta:**
- `138 - Documento localizado`: funcionou. Os XMLs estão na pasta `saida`.
- `137 - Nenhum documento localizado`: a conexão funcionou, só não há documentos nos últimos 90 dias.
- Erro de certificado da cadeia (`unable to get local issuer certificate`): rode `sh scripts/baixar-cadeia-icp.sh ./certs/icp-brasil.pem` e repita com `SEFAZ_CA_FILE=./certs/icp-brasil.pem`.

## 2. Banco de dados (Supabase)

1. Crie um projeto no Supabase (região São Paulo).
2. Abra o **SQL Editor**, cole o conteúdo de `supabase/migrations/0001_init.sql` e execute. Isso cria as tabelas, a view `vw_saude_empresas` e o bucket privado `xmls`.
3. Em **Project Settings → API**, copie a URL e a chave `service_role`.

## 3. Deploy na VPS com Easypanel

1. No Easypanel, crie um projeto e adicione um serviço do tipo **App**.
2. Em **Source**, escolha GitHub e o repositório `washingtonlss7/fiscal-xml`, branch `main`. O build usa o `Dockerfile` da raiz.
3. Em **Environment**, preencha as variáveis do `.env.example`. As secretas (`SUPABASE_SERVICE_ROLE_KEY` e `MASTER_KEY`) você cola direto no painel.
4. O coletor **não precisa de domínio nem de porta**: ele só faz chamadas de saída.
5. Clique em **Deploy**. Nos logs deve aparecer `coletor iniciado`.

Gere a `MASTER_KEY` uma única vez e **guarde uma cópia segura**. Se ela for perdida, os certificados gravados precisam ser cadastrados de novo.

```bash
npm run gerar-chave
```

## 4. Cadastrar clientes

O jeito normal é pelo **painel web** (serviço `painel` no Easypanel): entre com um e-mail autorizado, clique em **Adicionar empresa**, envie o `.pfx` e a senha. O servidor lê o CNPJ e a validade do certificado, cifra o arquivo e a senha e grava no banco. A lista mostra a situação de cada empresa, e o botão **Sincronizar** pede uma consulta imediata (respeitando a espera de 1 hora da SEFAZ).

### Painel web

- Mesmo repositório e mesma imagem do coletor, com o comando `node dist/painel/server.js` (porta 3000).
- Variáveis: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MASTER_KEY` (a mesma do coletor) e `PAINEL_EMAILS` (e-mails autorizados, separados por vírgula).
- No primeiro uso, cada e-mail autorizado cria a própria senha na aba **Primeiro acesso**.
- O navegador nunca fala direto com o banco: todas as operações passam pelo servidor, que valida a sessão e o e-mail.

### Pela linha de comando

Com o `.env` preenchido (mesma `MASTER_KEY` do servidor):

```bash
CERT_PATH=certificados/cliente.pfx UF=ES REGIME=simples npm run cadastrar-empresa
```

O script lê o CNPJ e a validade do próprio certificado, cifra o PFX e a senha e grava no banco. A empresa entra na próxima rodada. Para testar sem esperar o horário, reinicie o serviço com `RODAR_AO_INICIAR=true`.

Se você já rodou o teste da etapa 1 com o mesmo CNPJ, espere 1 hora antes da primeira rodada do coletor para não repetir a consulta.

## Manifestação, notas do escritório e detalhamento

- **Ciência da Operação automática:** NF-e de entrada que chegam só como resumo recebem o evento 210210 (assinado com o certificado do cliente, lotes de 20, Ambiente Nacional). O XML completo chega na consulta seguinte. Pode ser desligado por empresa (`empresas.manifestar_ciencia`).
- **NF-e de saída pelo escritório:** cadastre o certificado do escritório marcando "Este é o certificado do escritório". As notas em que o CNPJ do escritório aparece na tag `autXML` são distribuídas para o cliente emitente (saída) ou destinatário (entrada). Os emissores dos clientes precisam incluir o CNPJ do escritório no `autXML`.
- **Itens e tributos:** cada nota completa é detalhada em `documento_itens` (NCM, CFOP, CST/CSOSN, ICMS, ST, FCP, IPI, PIS, COFINS, IBS/CBS e o grupo `imposto` completo em JSON) e `documento_duplicatas`. Os totais vão para colunas de `documentos`. Notas antigas são detalhadas em segundo plano pelo coletor.
- **Painel → Notas:** lista por mês, filtros por documento e direção, totais de tributos, download do XML e ZIP do mês (pastas `NFe|CTe/entrada|saida[/canceladas]`).

## Acompanhamento

- `vw_saude_empresas`: status de cada empresa (`ok`, `sincronizacao_atrasada`, `certificado_vencendo`, `certificado_vencido`, `sem_certificado`).
- `logs_sefaz`: cada chamada à SEFAZ, com cStat, NSUs e duração.
- `sync_state`: último NSU e próxima consulta liberada de cada empresa.

## Desenvolvimento

```bash
npm install
npm test          # testes locais: PFX, cifra, mTLS com servidor falso e leitura dos XMLs
npm run typecheck
npm run build
```

## Estrutura

```
src/
  cert.ts            leitura do PFX (inclui A1 antigos com 3DES/RC2) e agente mTLS
  cripto.ts          AES-256-GCM dos certificados
  sefaz/distDFe.ts   envelope SOAP, chamada e leitura do retDistDFeInt
  sefaz/documentos.ts  interpretação de resNFe, procNFe, procCTe e eventos
  sync.ts            loop de NSU de uma empresa, regras 137/656 e gravação
  rodada.ts          rodada de todas as empresas com concorrência limitada
  worker.ts          agendador (cron) e pedidos manuais
  cli/               teste-sefaz e cadastrar-empresa
supabase/migrations/ schema do banco
```
