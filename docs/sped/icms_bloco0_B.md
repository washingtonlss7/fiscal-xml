# EFD-ICMS/IPI — Bloco 0 e Bloco B (notas de desenvolvimento)

Fonte: Guia Prático EFD-ICMS/IPI v3.2.2 (atualização 11/02/2026), págs. 28–61 (linhas 1660–3728 do txt).
Público-alvo do sistema: empresas **comerciais** do **Espírito Santo** (UF=ES, cUF=32), geração a partir de XML NF-e (55), NFC-e (65), CT-e (57) + cadastro da empresa/contador.

## Legenda de ORIGEM do campo

| Código | Significado |
|---|---|
| `FIXO` | Constante (ex.: nome do registro) |
| `XML` | Tag do XML (caminho indicado) |
| `EMP` | Cadastro da empresa/estabelecimento no nosso sistema |
| `CONT` | Cadastro do contador/escritório |
| `PROD` | Cadastro de produtos próprio da empresa (de-para com código do fornecedor) |
| `CALC` | Calculado pelo gerador |
| `MANUAL` | Informado pelo usuário na tela (ou parâmetro do período) |
| `TAB` | Tabela oficial (IBGE, países, NCM, CEST, ANP, 4.x.x) usada para validação/lookup |

Legenda obrigatoriedade: `O` obrigatório; `OC` obrigatório condicional (preencher se houver/quando a regra exigir); `N` não informar. Tamanho com `*` = tamanho fixo exato.

## Regras gerais de formato (lembretes para o gerador)

- Linha: `|REG|campo2|...|campoN|` + CRLF; campos vazios = `||`. Decimais com vírgula, sem separador de milhar. Datas `ddmmaaaa` sem separadores.
- Campo `N` com `*` tem tamanho fixo (CNPJ 14, CPF 11, CEP 8, COD_MUN 7, datas 8) — preservar zeros à esquerda.
- **A EFD-ICMS/IPI é por ESTABELECIMENTO (IE)**, não por empresa — um arquivo por CNPJ completo/IE. (Diferente da EFD-Contribuições, que é centralizada na matriz com 0140 por estabelecimento.)
- Todos os cadastros do Bloco 0 (0150, 0190, 0200, 0400, 0450, 0460, 0500, 0600) só podem conter códigos **efetivamente referenciados** nos demais blocos → o gerador deve montar os blocos C/D/E/G/H/K primeiro (ou em memória) e depois emitir o Bloco 0 apenas com os códigos usados. Exceções previstas para 0200: item com 0220, 0205 ou 0221.

## Hierarquia do Bloco 0

```
0000 (nível 0, 1 por arquivo)
0001 (1)                         IND_MOV
  0002 (2)  [só se IND_ATIV=0]
  0005 (2)  obrigatório, 1
  0015 (2)  0..N  (substituto tributário em outras UFs / DIFAL EC 87)
  0100 (2)  1
  0150 (2)  0..N
    0175 (3) 0..N
  0190 (2)  0..N
  0200 (2)  0..N
    0205 (3) 0..N
    0206 (3) 0..1  (combustíveis)
    0210 (3) 0..N  (Bloco K – válido até 31/12/2021 no guia; ignorar p/ comércio)
    0220 (3) 0..N
    0221 (3) 0..N
  0300 (2)  0..N  (CIAP)
    0305 (3) 0..1
  0400 (2)  0..N
  0450 (2)  0..N
  0460 (2)  0..N
  0500 (2)  0..N
  0600 (2)  0..N
0990 (1)
```

---

## 0000 — Abertura do arquivo digital e identificação da entidade

- **Nível 0 · Ocorrência: 1 por arquivo · Obrigatório** (primeira linha).
- Caso especial (Conv. 113/04 telecom e distribuidoras de energia em outra UF): UF/IE/COD_MUN do tomador — não se aplica ao nosso público.

| Nº | Campo | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|
| 01 | REG = "0000" | C | 004 | - | O | FIXO |
| 02 | COD_VER | N | 003* | - | O | CALC (tabela de versões por DT_FIN) |
| 03 | COD_FIN (0 original; 1 substituto) | N | 001 | - | O | MANUAL (padrão 0) |
| 04 | DT_INI | N | 008* | - | O | MANUAL/CALC (1º dia do mês) |
| 05 | DT_FIN | N | 008* | - | O | CALC (último dia do mês) |
| 06 | NOME (razão social) | C | 100 | - | O | EMP (conferir com `emit/xNome` das NF-e próprias) |
| 07 | CNPJ | N | 014* | - | OC | EMP (`emit/CNPJ`) |
| 08 | CPF | N | 011* | - | OC | EMP (produtor rural PF) |
| 09 | UF | C | 002* | - | O | EMP (`enderEmit/UF`) — "ES" |
| 10 | IE | C | 014 | - | O | EMP (`emit/IE`) |
| 11 | COD_MUN (IBGE 7) | N | 007* | - | O | EMP (`enderEmit/cMun`) |
| 12 | IM | C | - | - | OC | EMP (`emit/IM`) |
| 13 | SUFRAMA | C | 009* | - | OC | EMP |
| 14 | IND_PERFIL (A/B/C) | C | 001 | - | O | EMP (definido pela SEFAZ-ES para o contribuinte) |
| 15 | IND_ATIV (0 industrial/equiparado; 1 outros) | N | 001 | - | O | EMP (comércio = 1) |

Validações / orientações:
- COD_VER: deve ser a versão válida na data de DT_FIN (Tabela 3.1.1 da NT – Ato COTEPE 44/2018). Manter tabela `versao_leiaute(vigencia_ini, vigencia_fim, cod)` no sistema. (Conferir: 2025 = 019, 2026 = 020 — validar na tabela oficial antes de fixar.)
- COD_FIN: [0,1]. Substituição livre dentro do prazo. Retificação após prazo (Ajuste SINIEF 11/2012): até o último dia do 3º mês subsequente ao período sem autorização; depois só com autorização (salvo dispensa da SEFAZ – Ajuste SINIEF 27/20). Usar sempre leiaute vigente no período e PVA atualizado. Algumas SEFAZ pedem o hash (32 caracteres, "ID do Arquivo Assinado") do arquivo retificador.
- DT_INI: 1º dia do mês, exceto início de atividade/evento. DT_FIN: último dia do mesmo mês/ano de DT_INI (exceto encerramento). Validar mesmo mês/ano.
- CNPJ × CPF: mutuamente excludentes, exatamente um preenchido; DV validado.
- UF: sigla do informante. IE: DV validado conforme UF (implementar algoritmo IE-ES: 9 dígitos, módulo 11).
- COD_MUN: deve existir na tabela IBGE, 7 dígitos. Estabelecimento sem endereço físico na UF → código da capital.
- SUFRAMA: DV validado se informado.
- IND_PERFIL: [A,B,C]; **o arquivo é rejeitado se o perfil diferir do definido pelo Fisco** → campo obrigatório no cadastro da empresa, sem default silencioso. Na prática Perfil A é o mais detalhado; B é sintético. Confirmar regra de enquadramento da SEFAZ-ES por cliente.
- IND_ATIV: [0,1]. Simples Nacional contribuinte de IPI → "1". Indústria cujas operações não estão no campo do IPI → "1". Se CPF preenchido → IND_ATIV = 1. **Se IND_ATIV = 1, não pode existir E500** (apuração IPI). Se IND_ATIV = 0 → 0002 obrigatório.

**Diferença vs EFD-Contribuições (0000):** Contribuições tem TIPO_ESCRIT, IND_SIT_ESP, NUM_REC_ANTERIOR, IND_NAT_PJ e IND_ATIV com valores 0–9 (industrial, serviços, comércio, financeira, imobiliária...), não tem IE, IM, CPF, IND_PERFIL nem COD_FIN; é por CNPJ-matriz. Na ICMS/IPI: COD_FIN (original/substituto), IE obrigatória, **IND_PERFIL (A/B/C)** e IND_ATIV binário (0 industrial / 1 outros). Não reaproveitar o mapeamento de IND_ATIV entre os dois.

---

## 0001 — Abertura do Bloco 0

- **Nível 1 · 1 por arquivo · Obrigatório.**

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0001" | C | 004 | O | FIXO |
| 02 | IND_MOV (0 com dados; 1 sem dados) | N | 001 | O | FIXO "0" |

- Valor válido na prática: **somente [0]** (bloco 0 sempre tem 0005/0100 etc.).

---

## 0002 — Classificação do estabelecimento industrial ou equiparado

- **Nível 2 · 1 por arquivo · Obrigatório se 0000.IND_ATIV = 0.** Para comércio (IND_ATIV=1) **não gerar**.
- Mais de uma modalidade → informar a mais relevante.

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0002" | C | 004 | O | FIXO |
| 02 | CLAS_ESTAB_IND | N | 002 | O | EMP (Tabela 4.5.5 – Classificação de Contribuintes do IPI) |

---

## 0005 — Dados complementares da entidade

- **Nível 2 · 1 por arquivo · Obrigatório.** (Não existe na EFD-Contribuições.)

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0005" | C | 004 | O | FIXO |
| 02 | FANTASIA | C | 060 | O | EMP (`emit/xFant`); se vazio, parte da razão social |
| 03 | CEP | N | 008* | O | EMP (`enderEmit/CEP`) |
| 04 | END | C | 060 | O | EMP (`enderEmit/xLgr`) |
| 05 | NUM | C | 010 | OC | EMP (`enderEmit/nro`) |
| 06 | COMPL | C | 060 | OC | EMP (`enderEmit/xCpl`) |
| 07 | BAIRRO | C | 060 | O | EMP (`enderEmit/xBairro`) |
| 08 | FONE (DDD+nº) | C | 11 | OC | EMP (`enderEmit/fone`, só dígitos) |
| 09 | FAX | C | 11 | OC | EMP |
| 10 | EMAIL | C | - | OC | EMP |

- FANTASIA sem nome fantasia → preencher com parte da razão social pela qual é conhecida (fallback automático: truncar NOME a 60).
- Truncar END/COMPL/BAIRRO em 60.

---

## 0015 — Dados do contribuinte substituto ou responsável pelo ICMS destino

- **Nível 2 · 0..N por arquivo.**
- **Obrigatório para todo contribuinte substituto tributário** com inscrição em outras UFs (IE de substituto na UF do substituído) e para o responsável pelo ICMS DIFAL da EC 87/15 inscrito na UF do consumidor final. Um registro por IE/UF, **mesmo sem movimento no período** → obriga E200/E300 e filhos para aquela UF.

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0015" | C | 004 | O | FIXO |
| 02 | UF_ST | C | 002* | O | EMP (tabela de IEs de substituto por UF) |
| 03 | IE_ST | C | 014 | O | EMP (conferir com `emit/IEST` das NF-e próprias) |

- UF_ST: sigla existente. IE_ST: validada pelo algoritmo da UF_ST.
- Dica: se aparecerem NF-e próprias com `emit/IEST` preenchido e não houver 0015 cadastrado para `dest/enderDest/UF` → alertar.

---

## 0100 — Dados do contabilista

- **Nível 2 · 1 por arquivo · Obrigatório** (mesmo se contador for funcionário).

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0100" | C | 004 | O | FIXO |
| 02 | NOME | C | 100 | O | CONT |
| 03 | CPF | N | 011* | O | CONT |
| 04 | CRC | C | 015 | O | CONT (CRC na UF do estabelecimento) |
| 05 | CNPJ (escritório) | N | 014* | OC | CONT |
| 06 | CEP | N | 008* | OC | CONT |
| 07 | END | C | 060 | OC | CONT |
| 08 | NUM | C | 010 | OC | CONT |
| 09 | COMPL | C | 060 | OC | CONT |
| 10 | BAIRRO | C | 060 | OC | CONT |
| 11 | FONE | C | 11 | OC | CONT |
| 12 | FAX | C | 11 | OC | CONT |
| 13 | EMAIL | C | - | **O** | CONT |
| 14 | COD_MUN | N | 007* | **O** | CONT |

- CPF e CNPJ com DV validados, sem máscara. EMAIL obrigatório (pode receber correspondência do Fisco). COD_MUN deve existir no IBGE.
- Contador é o mesmo para os 600+ clientes do escritório → cadastro único do escritório, com vínculo por empresa (permitir sobrescrever por empresa se outro contabilista assinar).
- **Diferença vs Contribuições:** leiaute do 0100 é idêntico; na ICMS/IPI o CRC é "na UF do estabelecimento".

---

## 0150 — Tabela de cadastro do participante

- **Nível 2 · 0..N.** Pessoas físicas/jurídicas com transações **no período**; sem movimento → não informar.
- **NÃO informar** como participante CPF/CNPJ apenas citados em C350, C460 e em **C100 de NFC-e (modelo 65)** → consumidor da NFC-e nunca gera 0150.
- COD_PART de livre atribuição, único no arquivo; recomendável estável entre períodos (ex.: `CNPJ`/`CPF` + sufixo). Proibido 2 registros com mesmo COD_PART.
- PF com mais de um endereço: pode haver vários 0150 com mesmo NOME/CPF, cada um com COD_PART diferente.
- DIFAL EC 87/15 (§30 art. 19 Conv. SN/70): se UF do domicílio do destinatário ≠ UF da entrada física → 0150 específico com mesmos dados, trocando só COD_MUN para o local da entrada física; esse COD_PART é usado no C100/D100 da operação. Não dois 0150 para o mesmo documento.
- Dados = situação no **último evento fiscal** do período (usar o XML mais recente do participante).
- Pode conter o próprio informante (NF emitida contra si mesmo, ex.: retorno de venda ambulante).

| Nº | Campo | Tipo | Tam | Obrig | Origem (entrada NF-e: `emit`; saída NF-e: `dest`; CT-e: `emit`/`toma`/`rem`/`dest` conforme o caso) |
|---|---|---|---|---|---|
| 01 | REG = "0150" | C | 004 | O | FIXO |
| 02 | COD_PART | C | 060 | O | CALC (ex.: "F"+CNPJ / "C"+CPF, ou chave interna) |
| 03 | NOME | C | 100 | O | XML `xNome` |
| 04 | COD_PAIS | N | 005 | O | XML `ender*/cPais` (default 01058/1058 se ausente e UF≠EX) |
| 05 | CNPJ | N | 014* | OC | XML `CNPJ` |
| 06 | CPF | N | 011* | OC | XML `CPF` |
| 07 | IE | C | 014 | OC | XML `IE` (ignorar "ISENTO") |
| 08 | COD_MUN | N | 007* | OC | XML `ender*/cMun` |
| 09 | SUFRAMA | C | 009* | OC | XML `dest/ISUF` |
| 10 | END | C | 060 | O | XML `ender*/xLgr` |
| 11 | NUM | C | 010 | OC | XML `ender*/nro` |
| 12 | COMPL | C | 060 | OC | XML `ender*/xCpl` |
| 13 | BAIRRO | C | 060 | OC | XML `ender*/xBairro` |

Validações:
- COD_PART deve existir em pelo menos um registro de outro bloco (regra 2.4.2.1 da NT).
- COD_PAIS: tabela de países (item 3.2.1); aceita 5 ou 4 dígitos; **obrigatório também para Brasil (01058/1058)**.
- CNPJ/CPF: mutuamente excludentes; **um deles obrigatório se país = Brasil**; vazios se exterior; DV validado.
- IE: validada conforme UF derivada dos 2 primeiros dígitos do COD_MUN.
- COD_MUN: obrigatório se Brasil (IBGE, 7 dígitos); exterior → vazio ou 9999999 (XML exterior traz cMun=9999999).
- SUFRAMA: DV se informado.
- END: exterior → incluir cidade e país (concatenar `xMun` + `xPais`).
- Truncamentos: NOME 100, END/COMPL/BAIRRO 60, NUM 10.

---

## 0175 — Alteração da tabela de cadastro de participante

- **Nível 3 (filho do 0150) · 1:N.** Obrigatório quando, **dentro do período**, mudar NOME, COD_PAIS, CNPJ, CPF, COD_MUN, SUFRAMA, END, NUM, COMPL ou BAIRRO.
- Mudança de **IE** → criar **novo participante** (novo 0150), sem 0175. Mudança de endereço que implique nova IE → idem.
- Mudança de endereço: só informar 0175 se houve, no mesmo mês, **2+ NF para endereços diferentes do mesmo participante**.
- Dados do 0175 valem até 24h do dia anterior a DT_ALT. Um mesmo COD_PART não pode representar participante diferente.

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0175" | C | 004 | O | FIXO |
| 02 | DT_ALT | N | 008* | O | CALC (data do 1º XML com o dado novo — `ide/dhEmi`) |
| 03 | NR_CAMPO | C | 002 | O | CALC (nº do campo do 0150 que mudou) |
| 04 | CONT_ANT | C | 100 | O | CALC (valor anterior, do XML mais antigo) |

- DT_ALT entre DT_INI e DT_FIN. NR_CAMPO ∈ [03,04,05,06,08,09,10,11,12,13] (07-IE não permitido).
- CONT_ANT: se CNPJ/CPF → validar DV; se NR_CAMPO=08 → existir no IBGE.
- Implementação: ordenar XMLs do participante por data; o 0150 leva os dados do último; para cada campo que variou gerar 0175 com o valor anterior e a data da troca. Um 0175 por campo alterado.

---

## 0190 — Identificação das unidades de medida

- **Nível 2 · 0..N.** Sem duplicidade de UNID. Somente unidades usadas em algum registro (C170.UNID, 0200.UNID_INV, 0220.UNID_CONV, H010.UNID, K...).

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0190" | C | 004 | O | FIXO |
| 02 | UNID | C | 006 | O | XML `det/prod/uCom` (e `uTrib` se usada) / PROD (UNID_INV) |
| 03 | DESCR | C | - | O | PROD/tabela interna de unidades (ex.: UN=Unidade, KG=Quilograma); fallback = próprio código |

- Normalizar códigos de unidade (upper-case, trim, max 6). Unidades diferentes com mesmo significado (UN/UND/UNID) → decisão MANUAL ou tabela de sinônimos, pois afeta 0220.

---

## 0200 — Tabela de identificação do item (produtos e serviços)

- **Nível 2 · 0..N.** Itens (mercadorias, serviços, insumos) das transações e movimentos de estoque.
- Só itens referenciados nos demais blocos, **exceto** se houver 0220 (desde 07/2012), 0205 (desde 01/2021) ou 0221 (desde 01/2023).
- **Código próprio do informante em TODOS os documentos** (entrada, saída, inventário): o mesmo produto deve ter o mesmo código em entradas e saídas. ⇒ Na entrada, o `cProd` do XML é o código **do fornecedor**; é obrigatório um **de-para (fornecedor+cProd → COD_ITEM próprio)**, com auxílio de GTIN/NCM para sugestão automática.
- Código não pode ser duplicado/atribuído a itens diferentes nem **reutilizado**; mudança de característica básica → novo código; mudança de código → 0205 com código anterior e datas.
- Inventário (H010) usa o código vigente no mês inventariado.
- Descrição precisa; proibidas descrições genéricas ("diversas entradas", "mercadorias para revenda"), exceto uso/consumo sem crédito, ativo por gênero e consolidados de energia/água/gás/telecom.

| Nº | Campo | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|
| 01 | REG = "0200" | C | 004 | - | O | FIXO |
| 02 | COD_ITEM | C | 060 | - | O | PROD (próprio; saídas: `det/prod/cProd` da NF-e própria; entradas: de-para) |
| 03 | DESCR_ITEM | C | - | - | O | PROD (saídas: `xProd`; última descrição do período) |
| 04 | COD_BARRA | C | - | - | OC | XML `cEAN` (vazio se "SEM GTIN") / PROD |
| 05 | COD_ANT_ITEM | C | 060 | - | **N** | não preencher (vai no 0205) |
| 06 | UNID_INV | C | 006 | - | O | PROD (unidade de estoque) |
| 07 | TIPO_ITEM | N | 2 | - | O | PROD / CALC por CFOP (ver abaixo) |
| 08 | COD_NCM | C | 008* | - | OC | XML `NCM` / PROD |
| 09 | EX_IPI | C | 003 | - | OC | XML `EXTIPI` |
| 10 | COD_GEN | N | 002* | - | OC | CALC (2 primeiros dígitos do NCM; "00" serviço) |
| 11 | COD_LST | C | 005 | - | OC | XML `ISSQN/cListServ` (formato NN.NN) |
| 12 | ALIQ_ICMS | N | 006 | 02 | OC | PROD/tabela de alíquota interna ES (+FCP se houver) |
| 13 | CEST | N | 007* | - | OC | XML `CEST` / PROD |

Observações do guia e regras:
1. COD_ITEM com as informações da **última ocorrência** do período.
2. COD_NCM obrigatório: (2.1) industrial/equiparado, itens da atividade-fim ou com crédito/débito de IPI; (2.2) **contribuinte substituto tributário** (itens sujeitos a ST com retenção); (2.3) operações de importação/exportação. Não existe NCM para serviços. Validação PVA: obrigatório se IND_ATIV=0, dispensado se TIPO_ITEM ∈ {07,08,09,10,99}. **Recomendação: sempre informar NCM quando o XML tiver** (custo zero, evita inconsistência).
3. COD_GEN: obrigatório para todos **na aquisição de produtos primários**; tabela 4.2.1 = capítulos da NCM + "00 Serviço".
4. CEST válido a partir de 01/01/2017; deve existir na tabela CEST; **não informar** se o item puder ter mais de um CEST conforme destinação do adquirente.
5. COD_BARRA: GTIN-8/12/13/14; vazio se não houver.
6. UNID_INV deve existir no 0190.
7. TIPO_ITEM valores [00,01,02,03,04,05,06,07,08,09,10,99]; destinação **inicial** e de maior relevância na movimentação física; considera a atividade do estabelecimento (não da empresa). Não muda a cada movimentação. Para comércio: 00 revenda; 07 uso e consumo; 08 ativo imobilizado; 09 serviços; 99 outras. Heurística por CFOP de entrada: 1102/2102/1403/2403 → 00; 1556/2556/1407/2407 → 07; 1551/2551/1406/2406 → 08; serviços/CT-e não geram 0200 de mercadoria. Deixar editável (MANUAL).
8. COD_LST: formato "NN.NN" (como na NF-e) desde 01/2015.
9. ALIQ_ICMS: alíquota **interna** prevista em regulamento da UF, **incluindo FCP** se aplicável. **Obrigatório para itens com C180, C185, C330, C380, C430, C480, C810, C870** (registros de ressarcimento/complemento de ST — relevante para ES se o cliente usar essas rotinas). ES: alíquota interna geral 17% (há alíquotas específicas por produto — manter no cadastro de produto).
10. COD_ITEM deve existir em outro bloco ou no 0220.

**Diferenças vs EFD-Contribuições (0200):** o 0200 da Contribuições tem 12 campos (até ALIQ_ICMS); a ICMS/IPI tem **13 campos, com CEST (campo 13)**. Na ICMS/IPI COD_BARRA segue regras de GTIN validadas contra 0220, ALIQ_ICMS é **obrigatório** para itens de C180/C185/C330/C380/C430/C480/C810/C870, e o conceito de TIPO_ITEM é amarrado ao Bloco K. Na Contribuições os filhos são 0205/0206/0208; na ICMS/IPI são 0205/0206/0210/**0220**/**0221** (0220 e 0221 não existem na Contribuições). Reaproveitar o mesmo cadastro PROD para ambos, mas gerar o 0200 com o layout correto por obrigação.

---

## 0205 — Alteração do item

- **Nível 3 · 1:N.** Alteração de descrição (sem descaracterizar) ou de código do item. Se não houve movimento no período da alteração, informar no 1º período com movimento ou no inventário.
- Sem sobreposição de períodos para o mesmo campo alterado (02 ou 05).
- Campos 02 e 05 **mutuamente excludentes, um obrigatório**; alterou descrição e código → dois registros.

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0205" | C | 004 | O | FIXO |
| 02 | DESCR_ANT_ITEM | C | - | OC | PROD (histórico de descrições) / CALC comparando `xProd` entre XMLs |
| 03 | DT_INI | N | 008* | O | PROD/CALC (início de uso da descrição/código anterior) |
| 04 | DT_FIM | N | 008* | O | PROD/CALC (fim de uso) |
| 05 | COD_ANT_ITEM | C | 060 | OC | PROD (histórico de códigos) |

- DT_INI/DT_FIM datas válidas; **DT_FIM < DT_FIN do 0000**.
- Implementação: manter tabela `produto_historico(cod_item, campo, valor_ant, dt_ini, dt_fim, informado_em_periodo)` para não repetir.

---

## 0206 — Código de produto conforme tabela ANP

- **Nível 3 · 1:1.** Apenas produtores, importadores, distribuidores e **postos de combustíveis**; obrigatório quando o item constar da tabela ANP.

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0206" | C | 004 | O | FIXO |
| 02 | COD_COMB | C | - | O | XML `det/prod/comb/cProdANP` / PROD |

- Deve existir na Tabela 12 SIMP/ANP (item 3.2.1). Gerar só se EMP.segmento = combustíveis.

---

## 0210 — Consumo específico padronizado (válido até 31/12/2021)

- **Nível 3 · 1:N.** Bloco K (produção). Só para TIPO_ITEM 03 ou 04. Desde 2018 a critério da UF; guia marca validade até 31/12/2021. **Não gerar para comércio.**

| Nº | Campo | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|
| 01 | REG = "0210" | C | 4 | - | O | FIXO |
| 02 | COD_ITEM_COMP | C | 60 | - | O | MANUAL (ficha técnica) |
| 03 | QTD_COMP | N | - | 6 | O | MANUAL (>0, quantidade bruta com perda normal) |
| 04 | PERDA | N | - | 4 | O | MANUAL (% perda normal média) |

- Validações: componente existe no 0200, ≠ do item pai, TIPO_ITEM do componente ∈ {00,01,02,03,04,05,10}; sem duplicidade (COD_ITEM pai + COD_ITEM_COMP); unidade = UNID_INV.

---

## 0220 — Fatores de conversão de unidades

- **Nível 3 · 1:N** (filho do 0200).
- Obrigatório quando:
  1. em documento eletrônico **de emissão própria** a unidade comercial ≠ UNID_INV do 0200;
  2. unidade do inventário (Bloco H) ou do Bloco K ≠ unidade comercial;
  3. K220 com unidade de destino ≠ origem;
  4. **UNID_INV do item mudou em relação à EFD do mês anterior** (UNID_CONV = unidade antiga).
- Na prática também se usa para entradas (C170 com unidade do fornecedor ≠ UNID_INV).
- Sem duplicidade de UNID_CONV dentro do mesmo item.

| Nº | Campo | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|
| 01 | REG = "0220" | C | 004 | - | O | FIXO |
| 02 | UNID_CONV | C | 006 | - | O | XML `uCom` (ou UNID_INV anterior) |
| 03 | FAT_CONV | N | - | 6 | O | PROD (tabela de conversão) / CALC sugerido |
| 04 | COD_BARRA | C | - | - | OC | XML `cEANTrib`/`cEAN` da embalagem / PROD |

Regras:
- UNID_CONV deve existir no 0190.
- FAT_CONV > 0; **multiplicador**: qtd_em_UNID_CONV × FAT_CONV = qtd_em_UNID_INV. Ex.: UNID_INV="CX" (10 un), UNID_CONV="UN" → FAT_CONV=0,10.
- **Fator imutável entre arquivos para o mesmo par (item, unidade)**. Se o volume mudar, é outra unidade comercial (novo código, ex.: "PAC2"), cadastrada no 0190. Idem para troca de UNID_INV entre competências. ⇒ O sistema deve **persistir histórico de fatores por item/unidade** e bloquear alteração de fator já declarado (validação cruzada entre períodos).
- COD_BARRA (GTIN da unidade comercial): (a) se informado, o 0200 também deve ter COD_BARRA; (b) se GTIN-14, deve corresponder ao GTIN-8/12/13 do 0200; (c) se GTIN-8/12/13, deve ser **diferente** do COD_BARRA do 0200.
- Sugestão automática de fator: quando `qTrib`/`uTrib` do XML estiver na unidade de estoque, FAT = qTrib/qCom — apenas sugestão, confirmar MANUAL.

**Diferença vs Contribuições:** 0220 não existe na EFD-Contribuições.

---

## 0221 — Correlação entre códigos de itens comercializados

- **Nível 3 · 1:N.** Só se o 0200 pai tiver **TIPO_ITEM = 00 (revenda)**.
- Obrigatoriedade (a partir de 2024) e forma definidas **pela UF** do declarante. Obrigados que não informaram em 2023 devem, em jan/2024, informar todos os códigos inativados/alterados em 2023. → Parâmetro por UF/empresa `exige_0221` (confirmar posição da SEFAZ-ES).
- Correlação com o item **"atômico"** (menor unidade de comercialização). Kits/cestas com código próprio no estoque → um 0221 por componente.
  - Ex. 1: cesta com 10 produtos → 10 registros 0221.
  - Ex. 2: lata 350 ml (atômico) → um 0221 com COD_ITEM_ATOMICO = próprio COD_ITEM e QTD=1.
  - Ex. 3: caixa com 12 latas → um 0221 apontando para a lata, QTD=12.
- Sem duplicidade de COD_ITEM_ATOMICO sob o mesmo pai.

| Nº | Campo | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|
| 01 | REG = "0221" | C | 004 | - | O | FIXO |
| 02 | COD_ITEM_ATOMICO | C | 060 | - | O | PROD (estrutura de kit/embalagem) |
| 03 | QTD_CONTIDA | N | - | 6 | O | PROD |

- COD_ITEM_ATOMICO deve existir como COD_ITEM de um 0200 com TIPO_ITEM=00 que tenha um único 0221 apontando para si mesmo (o atômico se autorreferencia).
- QTD_CONTIDA ≥ 1; = 1 quando COD_ITEM_ATOMICO = COD_ITEM do pai.
- ⇒ Ao gerar 0221 para um item "caixa", também gerar o 0200 do atômico com seu 0221 autorreferente (mesmo sem movimento — permitido pela exceção do 0200).

**Diferença vs Contribuições:** não existe na Contribuições.

---

## 0300 — Cadastro de bens ou componentes do ativo imobilizado (CIAP)

- **Nível 2 · 0..N.** Identifica bens/componentes do G125 (Bloco G – CIAP) e bens em construção (a partir do período do 1º componente).
- Código individualizado do controle patrimonial; sem reutilização/duplicidade; descrição precisa (modelo/marca). IDENT_MERC, DESCR_ITEM, COD_PRNC e COD_CTA com características **atuais**.
- Só gerar se a empresa escritura CIAP (crédito de ICMS de ativo).

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0300" | C | 004* | O | FIXO |
| 02 | COD_IND_BEM | C | 060 | O | MANUAL (cadastro patrimonial) |
| 03 | IDENT_MERC (1 bem; 2 componente) | C | 001* | O | MANUAL |
| 04 | DESCR_ITEM | C | - | O | MANUAL / XML `xProd` da NF de entrada (CFOP 1551/2551) |
| 05 | COD_PRNC | C | 060 | OC | MANUAL |
| 06 | COD_CTA | C | 060 | O | MANUAL/plano de contas (0500) |
| 07 | NR_PARC | N | 003 | OC | EMP/MANUAL (padrão 48 – LC 87/96) |

- IDENT_MERC=1 (bem): não pode ter G125 tipo "IA". IDENT_MERC=2 (componente de bem em construção): não pode ter G125 "IM" nem "CI".
- COD_PRNC: obrigatório se IDENT_MERC=2 (código do bem resultante); deve existir em outro 0300 com IDENT_MERC ≠ 2. Também para bem vinculado a bem principal.
- COD_CTA: deve existir no 0500 com COD_NAT_CC = "01" (ativo).
- NR_PARC: obrigatório quando G125 campos 09 e 10 preenchidos (bem gera crédito).
- Oportunidade: pré-cadastrar a partir de XMLs de entrada com CFOP de ativo.

---

## 0305 — Informação sobre a utilização do bem

- **Nível 3 · 1:1.** Obrigatório quando 0300.IDENT_MERC = 1.

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0305" | C | 004* | O | FIXO |
| 02 | COD_CCUS | C | 060 | O | MANUAL (deve existir no 0600) |
| 03 | FUNC | C | - | O | MANUAL |
| 04 | VIDA_UTIL (meses) | N | 003 | OC | MANUAL |

- Sem centro de custos: comércio/serviços → "1" área operacional / "2" administrativa; indústria → "3" produtiva / "4" apoio à produção / "5" administrativa. (Default para nossos clientes comerciais: gerar 0600 com códigos 1 e 2.)

---

## 0400 — Tabela de natureza da operação/prestação

- **Nível 2 · 0..N.** Codificação própria das naturezas (não é CFOP). Sem duplicidade de COD_NAT; código deve ser referenciado (ex.: C170.COD_NAT).

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0400" | C | 004 | O | FIXO |
| 02 | COD_NAT | C | 010 | O | CALC (hash/sequencial de `ide/natOp`) |
| 03 | DESCR_NAT | C | - | O | XML `ide/natOp` |

- Opcional na prática: só gerar se optarmos por preencher COD_NAT no C170. Recomendação: não preencher COD_NAT (OC) e não gerar 0400, salvo exigência.

---

## 0450 — Tabela de informação complementar do documento fiscal

- **Nível 2 · 0..N.** Codifica informações complementares de interesse do fisco dos "Dados Adicionais" (referenciado em C110/D... ). Sem duplicidade de COD_INF; deve ser referenciado. Ex.: em entradas de devolução, informar o documento referenciado.

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0450" | C | 004 | O | FIXO |
| 02 | COD_INF | C | 006 | O | CALC (sequencial/hash do texto) |
| 03 | TXT | C | - | O | XML `infAdic/infCpl` e/ou `infAdFisco` (texto de interesse fiscal) |

- Remover `|`, CR/LF do texto. Deduplicar textos idênticos para reusar o mesmo COD_INF.

---

## 0460 — Tabela de observações do lançamento fiscal

- **Nível 2 · 0..N.** Observações exigidas pela legislação nos lançamentos (ajustes por diferimento parcial, antecipação, DIFAL etc.) — referenciado em C195/C197, D195/D197, B020 etc. Sem duplicidade de COD_OBS; deve ser referenciado.

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0460" | C | 004 | O | FIXO |
| 02 | COD_OBS | C | 006 | O | CALC/MANUAL |
| 03 | TXT | C | - | O | MANUAL / regras de ajuste (texto da coluna "Observação" dos livros) |

---

## 0500 — Plano de contas contábeis

- **Nível 2 · 0..N.** Contas referenciadas no 0300 (CIAP). Sem duplicidade (DT_ALT + COD_CTA). Só gerar se houver 0300.

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0500" | C | 004* | O | FIXO |
| 02 | DT_ALT | N | 008* | O | CONT/MANUAL (≤ DT_FIN) |
| 03 | COD_NAT_CC | C | 002* | O | CONT [01 ativo, 02 passivo, 03 PL, 04 resultado, 05 compensação, 09 outras] |
| 04 | IND_CTA | C | 001* | O | CONT [S sintética, A analítica] |
| 05 | NIVEL | N | 005 | O | CONT |
| 06 | COD_CTA | C | 60 | O | CONT |
| 07 | NOME_CTA | C | 60 | O | CONT |

- **Diferença vs Contribuições:** o 0500 da Contribuições tem ainda COD_CTA_REF e CNPJ_EST e é referenciado por C170/F100 etc.; na ICMS/IPI ele existe basicamente para o CIAP (0300.COD_CTA).

---

## 0600 — Centro de custos

- **Nível 2 · 0..N.** Centros referenciados no 0305. Sem duplicidade (DT_ALT + COD_CCUS).

| Nº | Campo | Tipo | Tam | Obrig | Origem |
|---|---|---|---|---|---|
| 01 | REG = "0600" | C | 004* | O | FIXO |
| 02 | DT_ALT | N | 008* | O | MANUAL (≤ DT_FIN) |
| 03 | COD_CCUS | C | 060 | O | MANUAL (ou defaults 1/2 comércio, 3/4/5 indústria) |
| 04 | CCUS | C | 060 | O | MANUAL |

---

## 0990 — Encerramento do Bloco 0

- **Nível 1 · 1 por arquivo · Obrigatório.**

| Nº | Campo | Tipo | Obrig | Origem |
|---|---|---|---|---|
| 01 | REG = "0990" | C | O | FIXO |
| 02 | QTD_LIN_0 | N | O | CALC |

- QTD_LIN_0 = todas as linhas do bloco 0 **incluindo 0000, 0001 e o próprio 0990**. PVA confere.

---

# BLOCO B — Escrituração e apuração do ISS (somente Distrito Federal)

**Para contribuintes do ES (todos os nossos clientes): gerar apenas**
```
|B001|1|
|B990|2|
```
(estabelecimentos não domiciliados no DF informam só abertura sem dados + encerramento). Validador: se B001.IND_DAD=1, nenhum outro registro B pode existir; se 0, precisa haver ao menos um registro além de B001/B990.

Resumo dos registros (para referência / validação se um dia atender DF):

| Registro | Nível | Ocorr. | Finalidade | Campos-chave / regras |
|---|---|---|---|---|
| B001 | 1 | 1 | Abertura | IND_DAD (C,1*) [0,1] — note: **tipo C**, diferente do IND_MOV do 0001 |
| B020 | 2 | N | NF modelos 01, 03, 3B, 04, 08, 55, 65, 66 com serviços sujeitos a ISS (aquisições e prestações). Não informar denegados/inutilizados. Chave: IND_OPER+COD_PART+COD_MOD+SER+NUM_DOC+DT_DOC | 21 campos: IND_OPER(0 aquisição/1 prestação), IND_EMIT (1 → IND_OPER=0), COD_PART (vazio p/ 65; obrigatório p/ 66 em aquisição ou com retenção), COD_MOD, COD_SIT [00,02,06,08] (66 não aceita 06), SER (3 posições p/ 55/66/65 próprio; "000" se sem série), NUM_DOC>0, CHV_NFE (obrigatória 55/65/66; DV, CNPJ base = 0000 se emissão própria, série/número/UF consistentes), DT_DOC (aquisição ≤ DT_FIN; prestação dentro do período), COD_MUN_SERV (IBGE), VL_CONT, VL_MAT_TERC, VL_SUB, VL_ISNT_ISS, VL_DED_BC, VL_BC_ISS, VL_BC_ISS_RT, VL_ISS_RT (=0 se mod. 65), VL_ISS, COD_INF_OBS (0460). VL_CONT/VL_ISNT_ISS/VL_BC_ISS/VL_ISS = Σ B025 filhos |
| B025 | 3 | 1:N | Detalhe do B020 por alíquota + item LC 116 | VL_CONT_P, VL_BC_ISS_P, ALIQ_ISS (≤5), VL_ISS_P (=BC×alíq), VL_ISNT_ISS_P, COD_SERV (C,4*, Tab. 4.6.3). Único por ALIQ_ISS+COD_SERV |
| B030 | 2 | N | NF de Serviços simplificada (mod. 3A) — só saídas; agrupa numeração contínua mesma série/data. Chave COD_MOD+SER+NUM_DOC_INI+NUM_DOC_FIN+DT_DOC | COD_MOD=3A, SER, NUM_DOC_INI>0, NUM_DOC_FIN≥INI, DT_DOC no período, QTD_CANC, VL_CONT/VL_ISNT_ISS/VL_BC_ISS/VL_ISS = Σ B035, COD_INF_OBS |
| B035 | 3 | 1:N | Detalhe do B030 por alíquota + item LC 116 | igual ao B025 |
| B350 | 2 | N | Serviços de instituições financeiras (COSIF 7.1.7.00.00-9), exceto os com NF de serviço (retenção → B020). Chave COD_CTD+CTA_COSIF+COD_SERV+ALIQ_ISS | COD_CTD, CTA_ISS, CTA_COSIF (N,8*, Tab. 4.6.2), QTD_OCOR≥1, COD_SERV, VL_CONT, VL_BC_ISS, ALIQ_ISS≤5, VL_ISS=BC×alíq, COD_INF_OBS |
| B420 | 2 | N | Totalização das prestações por alíquota + item LC 116 (único por par) | VL_CONT, VL_BC_ISS, ALIQ_ISS, VL_ISNT_ISS, VL_ISS, COD_SERV = Σ B025 (IND_OPER=1) + B035 + B350 (VL_ISNT_ISS de B350 = VL_CONT−VL_BC_ISS) |
| B440 | 2 | N | Totalização de valores retidos por IND_OPER + COD_PART; obrigatório mesmo sem retenção (zerado); exclui mod. 65 e 3A | IND_OPER, COD_PART (0150), VL_CONT_RT, VL_BC_ISS_RT, VL_ISS_RT = Σ B020 do par |
| B460 | 2 | N | Deduções do ISS | IND_DED [0 compensação a maior,1 incentivo cultura,2 decisão adm/judicial,9 outros], VL_DED, NUM_PROC, IND_PROC [0 Sefin,1 JF,2 JE,9], PROC, COD_INF_OBS (O, 0460), IND_OBR [0 próprio,1 substituto,2 uniprofissional] |
| B470 | 2 | 1 | Apuração do ISS | 15 campos A–N: VL_CONT=ΣB420; VL_MAT_TERC; VL_MAT_PROP; VL_SUB; VL_ISNT=ΣB420; VL_DED_BC=B+C+D+E; VL_BC_ISS=ΣB420; VL_BC_ISS_RT=ΣB440(op=1); VL_ISS=ΣB420; VL_ISS_RT=ΣB440(op=1); VL_DED=ΣB460(IND_OBR=0); VL_ISS_REC=max(0,I−J−K); VL_ISS_ST=max(0,ΣB440.VL_ISS_RT(op=0)−ΣB460(IND_OBR=1)); VL_ISS_REC_UNI=max(0,B500.VL_OR−ΣB460(IND_OBR=2)) |
| B500 | 2 | 1 | ISS Sociedade Uniprofissional | VL_REC, QTD_PROF (= nº B510 com IND_PROF=0), VL_OR (= QTD_PROF × valor mensal por profissional, Tab. 4.6.1) |
| B510 | 3 | N | Profissionais da uniprofissional | IND_PROF [0 habilitado,1 não], IND_ESC [0 superior,1 médio], IND_SOC [0 sócio,1 não; sócio ⇒ habilitado], CPF (DV, único), NOME. ≥1 sócio; não habilitados ≤ 2×sócios |
| B990 | 1 | 1 | Encerramento | QTD_LIN_B (inclui B001 e B990) |

(Diferença vs Contribuições: não há Bloco B na EFD-Contribuições; ISS lá aparece só como informação em A/F.)

---

# Resumo — diferenças-chave EFD-ICMS/IPI × EFD-Contribuições no Bloco 0

| Aspecto | EFD-ICMS/IPI | EFD-Contribuições |
|---|---|---|
| Escopo | Por estabelecimento (IE) | Por CNPJ matriz, estabelecimentos no 0140 |
| 0000 | COD_FIN, CPF, IE, IM, **IND_PERFIL A/B/C**, IND_ATIV 0/1 | TIPO_ESCRIT, IND_SIT_ESP, NUM_REC_ANTERIOR, IND_NAT_PJ, IND_ATIV 0–9 |
| 0002 | Classificação industrial IPI (se IND_ATIV=0) | não existe |
| 0005 | Dados complementares (obrigatório) | não existe |
| 0015 | IE de substituto em outras UFs | não existe |
| 0110/0111/0120/0140/0145 | não existem | regime de apuração, rateio, estabelecimentos etc. |
| 0200 | 13 campos, **inclui CEST**; ALIQ_ICMS obrigatória p/ itens em C180/C185/C330/C380/C430/C480/C810/C870 | 12 campos (sem CEST) |
| 0220 | Fatores de conversão (fator imutável entre períodos, GTIN da unidade) | não existe |
| 0221 | Correlação item atômico (TIPO_ITEM=00, obrigatoriedade por UF) | não existe |
| 0208 | não existe | Bebidas frias |
| 0300/0305 | CIAP (Bloco G) | não existem |
| 0500 | 7 campos, ligado ao CIAP | com COD_CTA_REF e CNPJ_EST, usado em vários registros |
| NFC-e | consumidor não vai ao 0150 | idem (NFC-e consolidada) |

# Pontos de atenção para o gerador/validador (ES, comércio)

1. Cadastro EMP obrigatório: IE, IND_PERFIL, IND_ATIV, COD_MUN, contador (0100 completo com EMAIL e COD_MUN).
2. De-para de produtos do fornecedor → código próprio é **pré-requisito** para C170 de entradas e 0200 (maior esforço manual do sistema).
3. Guardar histórico entre períodos: COD_PART, COD_ITEM (não reutilizar), descrições/códigos (0205), UNID_INV e fatores 0220 (imutáveis), 0221.
4. Emitir cadastros só com códigos referenciados (gerar blocos C/D/E/H primeiro).
5. Bloco B fixo: `|B001|1|` + `|B990|2|`.
6. Validadores DV: CNPJ, CPF, IE (por UF), SUFRAMA, GTIN, chave de acesso; tabelas IBGE, países, NCM, CEST, ANP, 4.2.1, 4.5.5.
7. Itens a confirmar externamente: tabela COD_VER 2026; regra de perfil e exigência do 0221 pela SEFAZ-ES; alíquotas internas/FCP do ES por produto.
