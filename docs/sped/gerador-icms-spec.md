# Gerador EFD ICMS/IPI (SPED Fiscal): especificação campo a campo

Escopo: farmácia varejista, Lucro Real, **UF = ES**, **IND_ATIV = 1** (outros), **IND_PERFIL = A ou B**
(copiado do SPED anterior, campo 14 do 0000). Fonte principal: Guia Prático EFD-ICMS/IPI **v3.2.2 (11/02/2026)**,
conferido no texto integral (`scratchpad/sped/guia_icms_ipi.txt`) e nas notas `icms_*.md` desta pasta.
Tudo o que não vem do Guia ou não está confirmado está marcado **CONFERIR**.

Registros cobertos (e só eles): 0000, 0001, 0005, 0100, 0150, 0190, 0200, 0990, B001, B990, C001, C100, C170,
C190, C990, D001, D100, D190, D990, E001, E100, E110, E116, E990, G001, G990, H001, H990, K001, K010, K990,
1001, 1010, 1990, 9001, 9900, 9990, 9999.

Convenções das tabelas:
- **Nº** é o número do campo no leiaute (01 = REG). **idx** é o índice em `f` depois de
  `l.slice(1, -1).split('|')`, igual ao que `src/sped/efd.ts` usa: **idx = Nº − 1** (`f[0]` = REG).
- **Tipo**: `N` numérico, `C` alfanumérico. **Tam**: `*` = tamanho exato; `-` = sem limite (C até 255).
- **Dec**: número máximo de casas decimais.
- **Obrig**: `O` sempre preenchido; `OC` preencher se houver a informação (senão `||`); `N` não informar.
  Nos registros com colunas Entrada/Saída, a coluna aparece como `E/S`.

---

## 1. Formato do arquivo

| Regra | Valor | Fonte |
|---|---|---|
| Codificação | **ISO-8859-1 (Latin-1)**. O Guia (Cap. II, Seção 3) só diz "caracteres da Tabela ASCII, exceto `\|` (124) e 0–31". Latin-1 vem do Ato COTEPE (item 2.1 do leiaute: "arquivo no formato texto, codificado em ASCII – ISO 8859-1 (Latin-1)") e é como o PVA grava. `efd.ts` já assume Latin-1 na leitura. Converter todo caractere fora do Latin-1 (`–`, `“`, `”`, `…`, emoji, etc.) para um equivalente ASCII antes de gravar. | Ato COTEPE 44/2018 item 2.1 (**CONFERIR** no texto do Ato 44/2018; a redação idêntica está no Ato COTEPE 47/2015, DeSTDA) |
| Fim de linha | **CRLF** (`\r\n`, 13+10) após o último `\|` de cada linha, **inclusive** na linha 9999 | Ato COTEPE (item 2.1: "CR e LF, caracteres 13 e 10") — **CONFERIR** se a última linha exige CRLF (o PVA aceita das duas formas; gerar com CRLF) |
| Linha | `\|REG\|campo02\|...\|campoN\|`: começa e termina com `\|`. Todos os campos do leiaute, na ordem, mesmo vazios. Número de campos exato (nem mais, nem menos) | Guia Cap. II Seção 1 |
| Campo vazio | `\|\|` (nada entre os pipes) | Guia Cap. II Seção 3 |
| Conteúdo `C` | Sem `\|` e sem caracteres 0–31 (remover CR, LF e TAB), sem espaço no início ou no fim (trim), truncar no tamanho do campo (ou em 255) | Guia Cap. II Seção 3 |
| Conteúdo `N` | Só dígitos e vírgula decimal. **Sem separador de milhar, sem sinal, sem `%`**. Valor negativo é erro: o gerador deve abortar | Guia Cap. II Seção 3 |
| Decimais | **Vírgula**. Casas à direita podem ser omitidas (`10000` = `10000,00`), mas nunca exceder o máximo do campo. Regra do gerador: **sempre formatar com o número fixo de casas do campo** (`fmt(v, dec) = v.toFixed(dec).replace('.', ',')`). Exemplo: ALIQ 17 → `17,00`, QTD (5 casas) 2 → `2,00000` | Guia Cap. II Seção 3 (exemplos `\|10000\|` ou `\|10000,00\|`) |
| Tamanho exato (`*`) | Preencher com zeros à esquerda: CNPJ 14, CPF 11, CEP 8, COD_MUN 7, CHV 44, CFOP 4, CST 3, datas 8, COD_VER 3, MES_REF 6 | Guia Cap. II Seção 3 |
| Datas | `ddmmaaaa`, sem separadores. As datas do XML (`dhEmi`, `dhSaiEnt`) vêm com fuso: usar a data da própria string (`AAAA-MM-DD`), **não** converter para UTC | Guia; notas C |
| Mês de referência | `mmaaaa` (E116.MES_REF) | Guia E116 |
| Ordem dos blocos | 0, B, C, D, E, G, H, K, 1, 9. Todos obrigatórios, mesmo vazios | Guia Cap. II Seção 1 |
| Ordem dos registros | Hierárquica: filhos logo depois do pai (C100 → seus C170 → seus C190 → próximo C100) | Guia Cap. II Seção 1 |
| Bloco vazio | `X001` com IND_MOV=1 + `X990` com QTD=2 | Guia |
| Maiúsc./minúsc. | Equivalentes (o gerador grava em maiúsculas os códigos: UF, UNID, COD_PART…) | Guia Cap. II Seção 3 |

### 1.1 Contadores

- **X990.QTD_LIN_X** = número de linhas do bloco, **incluindo X001 e X990**.
  - **Exceção 0990:** conta também a linha **0000** (Guia: "o registro 0000, mesmo não pertencendo ao bloco 0, deve ser somado").
- **9900**: um registro para **cada tipo de registro presente no arquivo**, inclusive **0000, 9001, 9900, 9990 e 9999**.
  QTD_REG_BLC = número de linhas daquele tipo. A linha `|9900|9900|n|` conta a si própria (n = total de linhas 9900).
- **9990.QTD_LIN_9** = linhas do bloco 9 (9001 + todos os 9900 + 9990) **+ 1 (a linha 9999)**.
- **9999.QTD_LIN** = total de linhas do arquivo, **incluindo a própria 9999**.

Algoritmo determinístico (depois de gerar 0000…1990):
```
linhas = [0000 … 1990]                       // sem bloco 9
cont = contagem por REG em linhas (na ordem da 1ª ocorrência)
cont['9001'] = 1; cont['9990'] = 1; cont['9999'] = 1
n9900 = (nº de chaves em cont) + 1           // +1 = a própria entrada '9900'
cont['9900'] = n9900
emitir |9001|0|
para cada REG em cont (ordem de 1ª ocorrência; 9001, 9900, 9990, 9999 ao final): emitir |9900|REG|cont[REG]|
QTD_LIN_9 = 1 + n9900 + 1 + 1
emitir |9990|QTD_LIN_9|
emitir |9999|linhas.length + QTD_LIN_9|
```
A ordem das linhas 9900 não é regulada pelo Guia (**CONFERIR**, mas o PVA não valida a ordem). `validarEstrutura()` de `efd.ts` confere
exatamente essas regras e pode ser usada como teste do gerador.

---

## 2. COD_VER (0000 campo 02)

O Guia não traz o número. Ele remete à "Tabela Versão do Leiaute (item 3.1.1 da Nota Técnica, Ato COTEPE/ICMS 44/2018)",
e o PVA valida o código **pela data DT_FIN**. Retificação usa o código do período retificado.

| Período (DT_FIN) | COD_VER | Fonte |
|---|---|---|
| 01/01/2026 em diante | **020** | Portal SPED: "Nota Técnica 2025.001 v1.0 (leiaute versão 020), com vigência a partir de janeiro/2026" (notícia da nova versão do Guia, repercutida em casadocontabilista.org.br, 08/07/2025; PDF: sped.rfb.gov.br/estatico/A7/5FB7…/NT-2025.001 v1.0.pdf) |
| 01/01/2025 a 31/12/2025 | **019** | Portal SPED: "NT 2024.001 v1.0 (leiaute versão 019)" (sped.rfb.gov.br/arquivo/show/7545); TOTVS TDN: "SPED Fiscal – Leiaute 019 – Obrigatório a partir de Janeiro de 2025" |
| 2024 | 018 | **CONFERIR** (sequência anual; não confirmado nesta pesquisa) |
| 2023 | 017 | **CONFERIR** |

Mudanças do leiaute 020 (NT 2025.001), segundo o resumo público: criação do **campo 11 no 1310** (CAP_TANQUE),
**valor "2" (DUIMP) no C120 campo 02**, ajustes de regras de validação e orientação sobre documentos da Reforma Tributária.
**Nenhuma mudança nos registros desta especificação.** O 1010 continua com 14 campos.

Implementação: tabela `versao_leiaute(cod_ver, vig_ini, vig_fim)`; escolher pela DT_FIN; recusar gerar período sem versão cadastrada.

---

## 3. Bloco 0

### 0000 — Abertura do arquivo e identificação da entidade (nível 0, 1 por arquivo, O)

| Nº | idx | Campo | Tipo | Tam | Dec | Obrig | Valores / preenchimento |
|---|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | - | O | `0000` |
| 02 | 1 | COD_VER | N | 003* | - | O | `020` (2026), `019` (2025): ver §2 |
| 03 | 2 | COD_FIN | N | 001 | - | O | `0` original, `1` substituto |
| 04 | 3 | DT_INI | N | 008* | - | O | 1º dia do mês (exceto início de atividade) |
| 05 | 4 | DT_FIN | N | 008* | - | O | último dia do mesmo mês/ano (exceto encerramento) |
| 06 | 5 | NOME | C | 100 | - | O | razão social |
| 07 | 6 | CNPJ | N | 014* | - | OC | CNPJ do **estabelecimento** (14 dígitos, DV). Mutuamente excludente com CPF |
| 08 | 7 | CPF | N | 011* | - | OC | vazio (PJ) |
| 09 | 8 | UF | C | 002* | - | O | `ES` |
| 10 | 9 | IE | C | 014 | - | O | IE do estabelecimento, só dígitos (**CONFERIR** a remoção de pontuação; DV conferido pela UF) |
| 11 | 10 | COD_MUN | N | 007* | - | O | IBGE, 7 dígitos (começa com 32 no ES) |
| 12 | 11 | IM | C | - | - | OC | inscrição municipal ou vazio |
| 13 | 12 | SUFRAMA | C | 009* | - | OC | vazio |
| 14 | 13 | IND_PERFIL | C | 001 | - | O | `A` ou `B`, **copiado do SPED anterior** (`efd.cabecalho.perfil`). O arquivo é rejeitado se o perfil divergir do definido pela SEFAZ |
| 15 | 14 | IND_ATIV | N | 001 | - | O | `1` (outros). Com 1, **não pode existir E500**, e o 0002 não é gerado |

Exemplo: `|0000|020|0|01012026|31012026|FARMACIA X LTDA|12345678000195||ES|081234567|3205309|||A|1|`

### 0001 — Abertura do Bloco 0 (nível 1, O)

| Nº | idx | Campo | Tipo | Tam | Obrig | Valor |
|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | O | `0001` |
| 02 | 1 | IND_MOV | N | 001 | O | **sempre `0`** (valor válido único) |

### 0005 — Dados complementares da entidade (nível 2, 1, O)

| Nº | idx | Campo | Tipo | Tam | Obrig | Preenchimento |
|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | O | `0005` |
| 02 | 1 | FANTASIA | C | 060 | O | nome fantasia; se não houver, parte da razão social (truncar em 60) |
| 03 | 2 | CEP | N | 008* | O | só dígitos |
| 04 | 3 | END | C | 060 | O | logradouro |
| 05 | 4 | NUM | C | 010 | OC | número |
| 06 | 5 | COMPL | C | 060 | OC | complemento |
| 07 | 6 | BAIRRO | C | 060 | O | bairro |
| 08 | 7 | FONE | C | 011 | OC | DDD + número, só dígitos |
| 09 | 8 | FAX | C | 011 | OC | vazio |
| 10 | 9 | EMAIL | C | - | OC | e-mail |

### 0100 — Dados do contabilista (nível 2, 1, O para perfis A e B)

| Nº | idx | Campo | Tipo | Tam | Obrig | Preenchimento |
|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | O | `0100` |
| 02 | 1 | NOME | C | 100 | O | nome do contabilista |
| 03 | 2 | CPF | N | 011* | O | CPF (DV) |
| 04 | 3 | CRC | C | 015 | O | CRC na UF do estabelecimento |
| 05 | 4 | CNPJ | N | 014* | OC | CNPJ do escritório |
| 06 | 5 | CEP | N | 008* | OC | |
| 07 | 6 | END | C | 060 | OC | |
| 08 | 7 | NUM | C | 010 | OC | |
| 09 | 8 | COMPL | C | 060 | OC | |
| 10 | 9 | BAIRRO | C | 060 | OC | |
| 11 | 10 | FONE | C | 011 | OC | |
| 12 | 11 | FAX | C | 011 | OC | |
| 13 | 12 | EMAIL | C | - | **O** | |
| 14 | 13 | COD_MUN | N | 007* | **O** | IBGE |

### 0150 — Cadastro de participante (nível 2, V, OC)

Gerar **somente** os participantes referenciados no arquivo: C100.COD_PART (NF-e 55, entrada e saída) e D100.COD_PART.
**Não** gerar para o consumidor de NFC-e (65). Nenhum COD_PART repetido. Os dados são os do **último documento** do período
(o 0175 não está no escopo: se o nome ou o endereço mudarem no mês, usar os mais recentes; **CONFERIR** se o 0175 será necessário).

| Nº | idx | Campo | Tipo | Tam | Obrig | Preenchimento |
|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | O | `0150` |
| 02 | 1 | COD_PART | C | 060 | O | código estável entre períodos (ex.: CNPJ/CPF do participante) |
| 03 | 2 | NOME | C | 100 | O | `xNome` |
| 04 | 3 | COD_PAIS | N | 005 | O | `cPais` do endereço; Brasil = `01058` (aceita `1058`). **Obrigatório também para Brasil** |
| 05 | 4 | CNPJ | N | 014* | OC | CNPJ (mutuamente excludente com CPF; um dos dois obrigatório se país = Brasil) |
| 06 | 5 | CPF | N | 011* | OC | CPF |
| 07 | 6 | IE | C | 014 | OC | IE; vazio se `ISENTO` ou ausente. DV validado pela UF do COD_MUN |
| 08 | 7 | COD_MUN | N | 007* | OC | `cMun` (obrigatório se Brasil). Exterior: vazio ou `9999999` |
| 09 | 8 | SUFRAMA | C | 009* | OC | `ISUF` (dest) ou vazio |
| 10 | 9 | END | C | 060 | O | `xLgr` (exterior: incluir cidade e país) |
| 11 | 10 | NUM | C | 010 | OC | `nro` |
| 12 | 11 | COMPL | C | 060 | OC | `xCpl` |
| 13 | 12 | BAIRRO | C | 060 | OC | `xBairro` |

Origem no XML: entrada NF-e → `emit`/`enderEmit`; saída NF-e → `dest`/`enderDest`; CT-e → `emit`/`enderEmit` (a transportadora).

### 0190 — Unidades de medida (nível 2, V, OC)

| Nº | idx | Campo | Tipo | Tam | Obrig | Preenchimento |
|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | O | `0190` |
| 02 | 1 | UNID | C | 006 | O | código normalizado (maiúsculas, trim, até 6) |
| 03 | 2 | DESCR | C | - | O | descrição (tabela interna; fallback = o próprio código) |

Só unidades **referenciadas** em outro registro (neste escopo: C170.UNID e 0200.UNID_INV). Sem duplicidade.

### 0200 — Identificação do item (nível 2, V, OC)

Só itens **referenciados** (neste escopo: C170.COD_ITEM das entradas). Saídas por NF-e própria e NFC-e não têm C170, então não "puxam"
itens para o 0200. O código é **sempre o código próprio** (de-para fornecedor+cProd → COD_ITEM).

| Nº | idx | Campo | Tipo | Tam | Dec | Obrig | Preenchimento |
|---|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | - | O | `0200` |
| 02 | 1 | COD_ITEM | C | 060 | - | O | código próprio |
| 03 | 2 | DESCR_ITEM | C | - | - | O | descrição própria (a última do período; sem descrições genéricas) |
| 04 | 3 | COD_BARRA | C | - | - | OC | GTIN (`cEAN`); vazio se "SEM GTIN" |
| 05 | 4 | COD_ANT_ITEM | C | 060 | - | **N** | **sempre vazio** (vai no 0205) |
| 06 | 5 | UNID_INV | C | 006 | - | O | unidade de estoque (tem de existir no 0190) |
| 07 | 6 | TIPO_ITEM | N | 2 | - | O | `00` revenda, `07` uso e consumo, `08` ativo imobilizado, `09` serviços, `99` outras (valores válidos: 00–10, 99) |
| 08 | 7 | COD_NCM | C | 008* | - | OC | NCM (dispensado para TIPO_ITEM 07, 08, 09, 10, 99). Recomendado sempre que houver |
| 09 | 8 | EX_IPI | C | 003 | - | OC | `EXTIPI` ou vazio |
| 10 | 9 | COD_GEN | N | 002* | - | OC | 2 primeiros dígitos do NCM (obrigatório só na aquisição de produtos primários) ou vazio |
| 11 | 10 | COD_LST | C | 005 | - | OC | vazio (serviço LC 116, formato `NN.NN`) |
| 12 | 11 | ALIQ_ICMS | N | 006 | 02 | OC | alíquota interna ES (com FCP). Obrigatória só se o item estiver em C180/C185/C330/C380/C430/C480/C810/C870 (fora do escopo) → pode ficar vazio |
| 13 | 12 | CEST | N | 007* | - | OC | `CEST` do XML ou vazio |

**Lacuna:** se C170.UNID ≠ 0200.UNID_INV, o **0220** (fator de conversão, filho do 0200) é obrigatório, exceto para TIPO_ITEM=07.
O 0220 **não está no escopo**. O gerador tem de, ou gerar o 0220, ou bloquear a geração quando a unidade de compra diferir da
unidade de estoque (**CONFERIR**: em farmácia é comum comprar em CX e vender em UN).

### 0990 — Encerramento do Bloco 0 (nível 1, O)

| Nº | idx | Campo | Tipo | Obrig | Valor |
|---|---|---|---|---|---|
| 01 | 0 | REG | C | O | `0990` |
| 02 | 1 | QTD_LIN_0 | N | O | linhas do bloco 0 **+ a linha 0000** (inclui 0001 e 0990) |

---

## 4. Bloco B (ISS, só DF)

Contribuinte do ES: sempre `|B001|1|` + `|B990|2|`.

| Reg | Nº | idx | Campo | Tipo | Tam | Obrig | Valor |
|---|---|---|---|---|---|---|---|
| B001 | 01 | 0 | REG | C | 004* | O | `B001` |
| B001 | 02 | 1 | IND_DAD | C | 001* | O | `1` (sem dados). O nome do campo é IND_DAD, não IND_MOV |
| B990 | 01 | 0 | REG | C | 004 | O | `B990` |
| B990 | 02 | 1 | QTD_LIN_B | N | - | O | `2` |

---

## 5. Bloco C

### C001 — Abertura (nível 1, O)

| Nº | idx | Campo | Tipo | Tam | Obrig | Valor |
|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | O | `C001` |
| 02 | 1 | IND_MOV | C | 001 | O | `0` se houver pelo menos um C100; senão `1` (e só C001+C990) |

### C100 — NF-e (55) e NFC-e (65) (nível 2, V)

Um C100 por documento. **NFC-e nunca entra como entrada.** Documentos que tratem **só** de IBS/CBS/IS não são escriturados.
Chave de duplicidade: terceiros = IND_OPER+IND_EMIT+COD_PART+COD_MOD+COD_SIT+SER+NUM_DOC+CHV_NFE;
própria = IND_OPER+IND_EMIT+COD_MOD+COD_SIT+SER+NUM_DOC+CHV_NFE. Deduplicar por chave de acesso antes de gerar.

| Nº | idx | Campo | Tipo | Tam | Dec | E/S | Valores / regra |
|---|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | - | O/O | `C100` |
| 02 | 1 | IND_OPER | C | 001* | - | O/O | `0` entrada, `1` saída |
| 03 | 2 | IND_EMIT | C | 001* | - | O/O | `0` própria (emit/CNPJ = 0000.CNPJ, 14 dígitos; outro estabelecimento da mesma empresa é **terceiro**), `1` terceiros. **IND_EMIT=1 ⇒ IND_OPER=0** |
| 04 | 3 | COD_PART | C | 060 | - | O/O | entrada: emitente/remetente; saída: destinatário. Existe no 0150. **Vazio no mod. 65** |
| 05 | 4 | COD_MOD | C | 002* | - | O/O | `55` ou `65` (válidos: 01, 1B, 04, 55, 65) |
| 06 | 5 | COD_SIT | N | 002* | - | O/O | `00` regular, `01` regular extemporâneo, `02` cancelado, `03` cancelado extemporâneo, `06` complementar, `07` complementar extemporâneo, `08` regime especial/norma específica. **`04`/`05` só até 31/12/2022**: não gerar em 2023+ |
| 07 | 6 | SER | C | 003 | - | OC/OC | **3 posições** para 55 (própria ou terceiros) e 65 própria: `ide/serie` com zeros à esquerda (`1` → `001`); sem série → `000` |
| 08 | 7 | NUM_DOC | N | 009 | - | O/O | `ide/nNF` (> 0) |
| 09 | 8 | CHV_NFE | N | 044* | - | OC/OC | chave (44). **Obrigatória para 55/65 em todas as situações, exceto COD_SIT 05.** DV, CNPJ base (se própria), série, número e cUF conferidos |
| 10 | 9 | DT_DOC | N | 008* | - | O/O | data de `ide/dhEmi`; ≤ 0000.DT_FIN |
| 11 | 10 | DT_E_S | N | 008* | - | O/OC | entrada: **data da entrada efetiva** (sempre obrigatória; não vem do XML), ≥ DT_DOC e ≤ DT_FIN. Saída: só se houver o dado (`dhSaiEnt`); se a UF apura pela data de emissão e a saída for > DT_FIN, **não preencher** (**CONFERIR** a regra do ES) |
| 12 | 11 | VL_DOC | N | - | 02 | O/O | `ICMSTot/vNF`. **Em 2026, sem CBS/IBS/IS** (o vNF de 2026 não soma esses tributos: **CONFERIR** no XML real); a partir de 2027, inclui |
| 13 | 12 | IND_PGTO | C | 001* | - | O/O | `0` à vista, `1` a prazo, `2` outros, `9` sem pagamento. Mapeamento: ver §5.4 |
| 14 | 13 | VL_DESC | N | - | 02 | OC/OC | `ICMSTot/vDesc` (desconto incondicional) |
| 15 | 14 | VL_ABAT_NT | N | - | 02 | OC/OC | = Σ C170.VL_ABAT_NT (quando houver C170). Normalmente `0` na farmácia |
| 16 | 15 | VL_MERC | N | - | 02 | O/OC | entrada: = Σ C170.VL_ITEM (vProd + ST + FCP-ST + IPI quando **sem** crédito). Saída: `ICMSTot/vProd` |
| 17 | 16 | IND_FRT | C | 001* | - | O/O | Desde 01/01/2018: `0` CIF (remetente), `1` FOB (destinatário), `2` terceiros, `3` próprio do remetente, `4` próprio do destinatário, `9` sem transporte. **= `transp/modFrete` (mesmos códigos 0,1,2,3,4,9)**. Venda balcão/remessa simbólica → 9 |
| 18 | 17 | VL_FRT | N | - | 02 | OC/OC | `ICMSTot/vFrete` |
| 19 | 18 | VL_SEG | N | - | 02 | OC/OC | `ICMSTot/vSeg` |
| 20 | 19 | VL_OUT_DA | N | - | 02 | OC/OC | `ICMSTot/vOutro` |
| 21 | 20 | VL_BC_ICMS | N | - | 02 | OC/OC | **= Σ C190.VL_BC_ICMS** |
| 22 | 21 | VL_ICMS | N | - | 02 | OC/OC | **= Σ C190.VL_ICMS** (inclui FCP) |
| 23 | 22 | VL_BC_ICMS_ST | N | - | 02 | OC/OC | **= Σ C190.VL_BC_ICMS_ST**. Vazio no mod. 65 |
| 24 | 23 | VL_ICMS_ST | N | - | 02 | OC/OC | **= Σ C190.VL_ICMS_ST**. Vazio no mod. 65 |
| 25 | 24 | VL_IPI | N | - | 02 | OC/OC | **= Σ C190.VL_IPI**. Vazio no mod. 65 |
| 26 | 25 | VL_PIS | N | - | 02 | OC/OC | **vazio** (Lucro Real entrega EFD-Contribuições) |
| 27 | 26 | VL_COFINS | N | - | 02 | OC/OC | **vazio** |
| 28 | 27 | VL_PIS_ST | N | - | 02 | OC/OC | **vazio** |
| 29 | 28 | VL_COFINS_ST | N | - | 02 | OC/OC | **vazio** |

Leitura em `efd.ts`: vlDoc = f[11], vlIcms = f[21], vlIcmsSt = f[23], vlIpi = f[24] (coerente com a tabela acima).

#### 5.1 Matriz de preenchimento do C100 por cenário

Legenda: **X** = preencher; **∅** = vazio `||`; **Σ** = soma dos C190 (numérico, `0,00` se zero); **0** = gravar `0,00`
(OC numérico sem valor: pode ser `0,00` ou vazio; o gerador usa `0,00`, exceto onde a tabela manda ∅).

| Campo | (a) Entrada terceiros NF-e 55 (IND_OPER=0, IND_EMIT=1, COD_SIT 00/01/08) | (b) Saída própria NF-e 55 (IND_OPER=1, IND_EMIT=0, COD_SIT 00/01/08) | (c) Entrada própria NF-e 55 (IND_OPER=0, IND_EMIT=0: devolução de consumidor) | (d) NFC-e 65 (IND_OPER=1, IND_EMIT=0, COD_SIT 00) | (e) Cancelada 02/03 (55 ou 65 própria) | (f) Denegada 04 / Inutilizada 05 (só períodos ≤ 12/2022) | (g) Complementar 06/07 |
|---|---|---|---|---|---|---|---|
| 02 IND_OPER | 0 | 1 | 0 | 1 | X | X | X |
| 03 IND_EMIT | 1 | 0 | 0 | 0 | X | X | X |
| 04 COD_PART | X (emit) | X (dest) | X (remetente = dest do XML) | **∅** | **∅** | **∅** | X (O) |
| 05 COD_MOD | 55 | 55 | 55 | 65 | X | X | X |
| 06 COD_SIT | X | X | X | 00 | 02/03 | 04/05 | 06/07 |
| 07 SER | X | X | X | X | X | X | X (OC) |
| 08 NUM_DOC | X | X | X | X | X | X | X |
| 09 CHV_NFE | X | X | X | X | **X** | 04: X; **05: ∅** | X |
| 10 DT_DOC | X | X | X | X | ∅ | ∅ | X |
| 11 DT_E_S | **X (O)** | X se houver/permitido | **X (O)** | ∅ (OC: **CONFERIR**) | ∅ | ∅ | X se a UF apura pela saída |
| 12 VL_DOC | X | X | X | X | ∅ | ∅ | facultativo (se preenchido, validado) |
| 13 IND_PGTO | X | X | X | X | ∅ | ∅ | facultativo |
| 14 VL_DESC | X/0 | X/0 | X/0 | X/0 | ∅ | ∅ | facultativo |
| 15 VL_ABAT_NT | Σ C170 | 0 | 0 | 0 | ∅ | ∅ | facultativo |
| 16 VL_MERC | Σ C170.VL_ITEM | vProd | vProd | vProd | ∅ | ∅ | facultativo |
| 17 IND_FRT | X | X | X | X (em regra 9) | ∅ | ∅ | facultativo |
| 18–20 VL_FRT/SEG/OUT_DA | X/0 | X/0 | X/0 | X/0 | ∅ | ∅ | facultativo |
| 21 VL_BC_ICMS | Σ | Σ | Σ | Σ | ∅ | ∅ | Σ |
| 22 VL_ICMS | Σ | Σ | Σ | Σ | ∅ | ∅ | Σ |
| 23 VL_BC_ICMS_ST | Σ | Σ | Σ | **∅** | ∅ | ∅ | Σ |
| 24 VL_ICMS_ST | Σ | Σ | Σ | **∅** | ∅ | ∅ | Σ |
| 25 VL_IPI | Σ | Σ | Σ | **∅** | ∅ | ∅ | Σ |
| 26–29 PIS/COFINS | ∅ | ∅ | ∅ | **∅** | ∅ | ∅ | ∅ |
| Filhos | **C170 obrigatório** + C190 | **só C190** (sem C170) | **só C190** (sem C170) | **só C190** (sem C170) | **nenhum** | **nenhum** | C190 obrigatório; C170 opcional (NUM_ITEM obrigatório se houver) |

Regras dos cenários (Guia, exceções do C100):
- **Exc. 1 (02, 03, 04):** preencher só REG, IND_OPER, IND_EMIT, COD_MOD, COD_SIT, SER, NUM_DOC, CHV_NFE; demais `||`; **sem filhos**.
  **05:** os mesmos campos **sem** CHV_NFE. Desde 12/2021 denegadas e inutilizadas não precisam ser escrituradas;
  **desde 01/2023, 04 e 05 foram descontinuados → não gerar** (pular XMLs de denegação e inutilização).
- **Cancelada de terceiros:** não escriturar (prática; **CONFERIR**). Se já escriturada em período fechado → retificar aquele período.
- **02 × 03:** 02 quando a emissão e o cancelamento são do período; 03 quando o documento já foi escriturado como regular em período
  anterior e foi cancelado depois.
- **Exc. 3 (06/07):** obrigatórios REG, IND_EMIT, COD_PART, COD_MOD, COD_SIT, NUM_DOC, CHV_NFE, DT_DOC (e a data de saída se a UF
  apura pela saída); os demais são facultativos, mas **se preenchidos (inclusive com zero) são validados**. C190 sempre.
- **Exc. 4 (08):** obrigatórios REG, IND_OPER, IND_EMIT, COD_PART, COD_MOD, COD_SIT, NUM_DOC, DT_DOC e CHV_NFE (55); C100 + C190.
  NF-e avulsa (série 890–899) recebida = terceiros com COD_SIT 08 (o PVA dá advertência). Documento **não eletrônico** com 08 exige C110 (fora do escopo).
- **Exc. 2 (NF-e própria, entrada ou saída):** só C100 + C190 (+ C195/C197 se houver ajuste). **C170 só é admitido** se houver C176, C180,
  C181 ou C177 (todos fora do escopo) → **o gerador nunca emite C170 para IND_EMIT=0**.
- **Exc. 9 (NFC-e):** só C100 + C190. No C100 **não informar** COD_PART, VL_BC_ICMS_ST, VL_ICMS_ST, VL_IPI, VL_PIS, VL_COFINS, VL_PIS_ST,
  VL_COFINS_ST. NFC-e cancelada = cenário (e), com a chave.
- **Extemporâneo (01/07):** DT_DOC e DT_E_S **fora** do período do 0000 (datas originais). Saída 01/07 → vai para DEB_ESP (E110), não para
  VL_TOT_DEBITOS; entrada 01/07 → crédito no primeiro E100.
- **Entrada sem crédito** (padrão para item com ST): ST, FCP-ST e IPI destacados somam em VL_ITEM (C170) e VL_MERC (C100), e os campos
  VL_ICMS_ST/VL_IPI de C100, C170 e C190 "não devem ser informados" (Resposta 3 do Guia) → C190 `0,00`, C100 = Σ C190 = `0,00`, C170 vazio.

#### 5.2 Relações de valor do C100

- VL_BC_ICMS, VL_ICMS, VL_BC_ICMS_ST, VL_ICMS_ST e VL_IPI = Σ dos respectivos campos dos C190 filhos (erro no PVA se divergir).
- VL_MERC = Σ C170.VL_ITEM quando houver C170 (a regra literal do PVA vale para COD_MOD ≠ 55; o validador do C170 exige para todos).
- VL_ABAT_NT = Σ C170.VL_ABAT_NT.
- Conferência (só advertência interna): Σ C190.VL_OPR = VL_DOC. Em 2026 ambos excluem CBS/IBS/IS; a partir de 2027 a diferença esperada é
  vIBS + vCBS + vIS.
- VL_DOC do XML: `vNF = vProd − vDesc − vICMSDeson(se indDeduzDeson=1) + vST + vFCPST + vFrete + vSeg + vOutro + vII + vIPI + vIPIDevol`.

#### 5.3 DT_E_S e período

- Um documento entra no arquivo cuja competência contenha DT_E_S (ou DT_DOC, se DT_E_S vazia). COD_SIT 00 com DT_E_S fora do período
  **não** pode ir neste arquivo.
- Entrada: DT_E_S informada pelo usuário (data de recebimento). Default sugerido: DT_DOC, se estiver no período (**CONFERIR** com o escritório).

#### 5.4 IND_PGTO a partir do XML (CONFERIR)

NF-e 4.00: `pag/detPag/indPag` (0 à vista, 1 a prazo; opcional) e `pag/detPag/tPag`.
1. Todos os `detPag` com `tPag = 90` (sem pagamento) → `9`.
2. Algum `indPag = 1`, ou `cobr/dup` com vencimento posterior a dhEmi → `1`.
3. `indPag = 0` (ou NFC-e com pagamento) → `0`.
4. Demais casos (sem informação) → `2`.

### C170 — Itens do documento (nível 3, 1:N)

**Quando gerar:**
- **Entradas de terceiros (IND_EMIT=1) em perfil A e B: obrigatório**, um C170 por `det` do XML ("inclusive em operações de entrada …
  acompanhadas de NF-e de emissão de terceiros").
- **NF-e própria (IND_EMIT=0), entrada ou saída: não gerar** (só é admitido com C176/C180/C181/C177, que estão fora do escopo).
- **NFC-e (65): nunca** (o título do C170 só cobre 01, 1B, 04 e 55).
- Canceladas, denegadas e inutilizadas: nunca.
- NUM_ITEM único por documento.

**38 campos, nesta ordem:**

| Nº | idx | Campo | Tipo | Tam | Dec | E/S | Preenchimento na ENTRADA de terceiros |
|---|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | - | O/O | `C170` |
| 02 | 1 | NUM_ITEM | N | 003 | - | O/O | `det/@nItem` (o mesmo número do documento) |
| 03 | 2 | COD_ITEM | C | 060 | - | O/O | **código próprio** do 0200 (de-para fornecedor+`cProd` → código próprio; sugestão por GTIN) |
| 04 | 3 | DESCR_COMPL | C | - | - | OC/OC | descrição complementar como no documento (`xProd`) ou vazio |
| 05 | 4 | QTD | N | - | 05 | O/O | `prod/qCom`, na unidade de UNID. > 0 (≥ 0 só em COD_SIT 06/07) |
| 06 | 5 | UNID | C | 006 | - | O/O | unidade **de comercialização do documento** (`prod/uCom` normalizada). Tem de existir no 0190. Se ≠ 0200.UNID_INV → 0220 obrigatório (exceto TIPO_ITEM 07): ver lacuna no 0200 |
| 07 | 6 | VL_ITEM | N | - | 02 | O/O | `prod/vProd`; **sem crédito: + vICMSST + vFCPST + vIPI** (+ vIPIDevol). **Σ VL_ITEM = C100.VL_MERC**. Frete, seguro e outras despesas **não** entram aqui |
| 08 | 7 | VL_DESC | N | - | 02 | OC/OC | `prod/vDesc` (desconto incondicional) ou `0,00` |
| 09 | 8 | IND_MOV | C | 001* | - | O/O | `0` há movimentação física; `1` não há (complementar, simples faturamento, remessa simbólica…) |
| 10 | 9 | CST_ICMS | N | 003* | - | O/O | **CST próprio (enfoque do declarante)**: origem (`orig`) + tributação convertida. Ex.: revenda com ST retida → `x60`; uso e consumo tributado → `x90`; fornecedor do Simples → CST do Conv. S/N/70 (nunca CSOSN). Tabela de conversão em `icms_blocoC_1.md` §11.3 (**CONFERIR** com o contador) |
| 11 | 10 | CFOP | N | 004* | - | O/O | **CFOP próprio de entrada**, pela destinação do item: 1º dígito 1 (mesma UF), 2 (outra UF), 3 (exterior), **igual em todos os itens**. Ex.: 5102/6102 → 1102/2102; 5403/5405/6403/6404 → 1403/2403; uso e consumo 1556/2556 (1407/2407 com ST); ativo 1551/2551 (1406/2406); bonificação 1910/2910 (`icms_blocoC_1.md` §11.4). Títulos (x000, x100, x150…) proibidos |
| 12 | 11 | COD_NAT | C | 010 | - | OC/OC | **vazio** (o 0400 não está no escopo) |
| 13 | 12 | VL_BC_ICMS | N | - | 02 | OC/OC | com crédito: `vBC`; sem crédito: vazio |
| 14 | 13 | ALIQ_ICMS | N | 006 | 02 | OC/OC | com crédito: `pICMS`; sem crédito: vazio. **O C190 agrupa por este valor**: usar a mesma representação no C170 e no C190 (vazio ≡ 0; ver §5.5) |
| 15 | 14 | VL_ICMS | N | - | 02 | OC/OC | com crédito: `vICMS` + `vFCP` (o C190.VL_ICMS "inclui FCP"; **CONFERIR** se o ES exige FCP próprio aqui); sem crédito: vazio |
| 16 | 15 | VL_BC_ICMS_ST | N | - | 02 | OC/OC | só com crédito de ST (raro): `vBCST`; senão vazio |
| 17 | 16 | ALIQ_ST | N | - | 02 | OC/OC | só com crédito de ST: `pICMSST`; senão vazio |
| 18 | 17 | VL_ICMS_ST | N | - | 02 | OC/OC | só com crédito de ST: `vICMSST` + `vFCPST`; senão vazio |
| 19 | 18 | IND_APUR | C | 001* | - | OC/OC | **vazio** (não contribuinte do IPI). Valores: `0` mensal, `1` decendial |
| 20 | 19 | CST_IPI | C | 002* | - | OC/OC | **vazio** ("somente se o declarante for contribuinte do IPI") |
| 21 | 20 | COD_ENQ | C | 003* | - | OC/OC | **vazio sempre** (Guia: "Não preencher") |
| 22 | 21 | VL_BC_IPI | N | - | 02 | OC/OC | **vazio** |
| 23 | 22 | ALIQ_IPI | N | 006 | 02 | OC/OC | **vazio** |
| 24 | 23 | VL_IPI | N | - | 02 | OC/OC | **vazio** (o IPI sem crédito já está em VL_ITEM) |
| 25 | 24 | CST_PIS | N | 002* | - | OC/OC | **vazio** (campos 25–36 dispensados para quem entrega EFD-Contribuições) |
| 26 | 25 | VL_BC_PIS | N | - | 02 | OC/OC | vazio |
| 27 | 26 | ALIQ_PIS (%) | N | 008 | 04 | OC/OC | vazio |
| 28 | 27 | QUANT_BC_PIS | N | - | 03 | OC/OC | vazio |
| 29 | 28 | ALIQ_PIS (R$) | N | - | 04 | OC/OC | vazio |
| 30 | 29 | VL_PIS | N | - | 02 | OC/OC | vazio |
| 31 | 30 | CST_COFINS | N | 002* | - | OC/OC | vazio |
| 32 | 31 | VL_BC_COFINS | N | - | 02 | OC/OC | vazio |
| 33 | 32 | ALIQ_COFINS (%) | N | 008 | 04 | OC/OC | vazio |
| 34 | 33 | QUANT_BC_COFINS | N | - | 03 | OC/OC | vazio |
| 35 | 34 | ALIQ_COFINS (R$) | N | - | 04 | OC/OC | vazio |
| 36 | 35 | VL_COFINS | N | - | 02 | OC/OC | vazio |
| 37 | 36 | COD_CTA | C | - | - | OC/OC | conta contábil analítica (a sintética é aceita) ou vazio |
| 38 | 37 | VL_ABAT_NT | N | - | 02 | OC/OC | abatimento não tributado e não comercial (em regra `0,00`); Σ = C100.VL_ABAT_NT |

Validações do C170 (Guia):
- COD_ITEM existe no 0200; UNID existe no 0190 (e no 0220, se ≠ UNID_INV e TIPO_ITEM ≠ 07).
- IND_OPER=0 ⇒ CFOP começa com 1/2/3; IND_OPER=1 ⇒ 5/6/7; mesmo 1º dígito em todos os itens.
- Regras de CST **só nas saídas** (ICMS zerado para x30/x40/x41/x50/x60; > 0 nos demais, ≥ 0 para x20/x51/x90; ST ≥ 0 só em x10/x30/x70,
  zero nos demais; ALIQ_ICMS > 0 para x00/x10/x20/x70). Nas entradas não se aplicam.
- Σ VL_ITEM = C100.VL_MERC.

### C190 — Registro analítico (nível 3, 1:N; O para todo C100 que não seja 02/03/04/05)

**Chave de agrupamento: CST_ICMS + CFOP + ALIQ_ICMS** (não pode repetir no documento). Quando houver C170, a combinação tem de existir
nos C170 e as somas têm de bater com os C170 do grupo. Sem C170 (NF-e própria, NFC-e), agrupar direto dos `det` do XML.

| Nº | idx | Campo | Tipo | Tam | Dec | E/S | Preenchimento |
|---|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | - | O/O | `C190` |
| 02 | 1 | CST_ICMS | N | 003* | - | O/O | entrada: CST convertido (igual ao C170); saída: `orig` + `CST` do XML (Lucro Real usa CST, não CSOSN) |
| 03 | 2 | CFOP | N | 004* | - | O/O | entrada: CFOP convertido; saída: `prod/CFOP`. **NFC-e: só CFOP começando com 5** |
| 04 | 3 | ALIQ_ICMS | N | 006 | 02 | OC/OC | `pICMS` do grupo; `0,00` quando não houver tributação/crédito (ver §5.5) |
| 05 | 4 | VL_OPR | N | - | 02 | O/O | fórmula §5.6 |
| 06 | 5 | VL_BC_ICMS | N | - | 02 | O/O | Σ VL_BC_ICMS (C170) ou Σ `vBC` (XML) do grupo; `0,00` se não houver |
| 07 | 6 | VL_ICMS | N | - | 02 | O/O | Σ ICMS **incluindo FCP** (`vICMS + vFCP`) |
| 08 | 7 | VL_BC_ICMS_ST | N | - | 02 | O/O | Σ `vBCST` (só se houver ST creditada/debitada; senão `0,00`) |
| 09 | 8 | VL_ICMS_ST | N | - | 02 | O/O | Σ `vICMSST + vFCPST` (só se creditado/debitado; senão `0,00`) |
| 10 | 9 | VL_RED_BC | N | - | 02 | O/O | valor não tributado por redução de BC; **> 0 obrigatório se CST termina em 20 ou 70 e COD_SIT 00/01** (vale para entrada e saída); `0,00` nos demais |
| 11 | 10 | VL_IPI | N | - | 02 | O/O | Σ IPI **creditado/debitado** do grupo; para esta empresa, `0,00` (o IPI destacado de fornecedor entra no VL_OPR, não aqui) |
| 12 | 11 | COD_OBS | C | 006 | - | OC/OC | vazio (só se a UF mandar; exigiria 0460) |

Todos os campos numéricos 05–11 são **O**: gravar `0,00`, nunca vazio.

#### 5.5 Representação de ALIQ_ICMS sem imposto

O Guia não diz se a chave compara `||` e `0` como iguais. Para não haver dúvida, usar **a mesma representação no C170 e no C190**.
Recomendação: no C190 gravar `0,00`; no C170 de entrada sem crédito deixar ALIQ_ICMS **vazio** (Resposta 3: "não devem ser informados")
e tratar vazio ≡ 0 no agrupamento. **CONFERIR** no PVA com um arquivo de teste (alternativa segura: `0,00` nos dois).

#### 5.6 VL_OPR — composição (Guia, C190 campo 05)

> "o valor das mercadorias somadas aos valores de fretes, seguros e outras despesas acessórias e os valores de ICMS_ST, FCP_ST e IPI
> (somente quando o IPI está destacado na NF), subtraídos o desconto incondicional e o abatimento não tributado e não comercial.
> Não devem ser incluídos neste campo os valores relativos a CBS, IBS e IS."

Por item do XML, somado no grupo (use os valores do XML para não somar ST/IPI duas vezes, porque VL_ITEM já os contém quando não há crédito):
```
VL_OPR(item) = vProd + vFrete + vSeg + vOutro            // frete/seguro/outros já vêm rateados por det/prod
             + vICMSST + vFCPST                          // ST e FCP-ST DESTACADOS
             + vIPI (+ vIPIDevol)                        // só IPI destacado
             − vDesc − abatimento_nt                     // abatimento: ex. vICMSDeson com indDeduzDeson=1 (CONFERIR)
             // NUNCA: vIBS, vCBS, vIS; NUNCA: vBCSTRet, vICMSSTRet, vICMSSubstituto, vFCPSTRet (CST 60 / CSOSN 500)
```
- A entrada **sem** crédito continua com ST e IPI no VL_OPR; o que fica zero é VL_ICMS_ST e VL_IPI.
- Arredondar por item em 2 casas e somar (trabalhar em centavos inteiros).

#### 5.7 VL_RED_BC (CONFERIR)

O Guia não dá fórmula. Prática: `VL_RED_BC = Σ (base_cheia − vBC)` dos itens CST x20/x70, com
`base_cheia = vProd + vFrete + vSeg + vOutro − vDesc` (+ vIPI quando o IPI compõe a BC). Alternativa pelo `pRedBC`:
`base_cheia × pRedBC / 100`.

#### 5.8 Registros fora do escopo que podem ser exigidos (o gerador deve bloquear ou avisar)

- **E200/E210** são obrigatórios se algum C190 tiver VL_ICMS_ST > 0 (ex.: entrada com crédito de ST; devolução de compra 5411/6411 com
  vICMSST destacado). Sem E200 no escopo, o gerador deve **recusar** o arquivo nesses casos.
- **C101** (NF-e própria interestadual para não contribuinte, grupo `ICMSUFDest`) + E300/E310.
- **C191** (FCP; obrigatoriedade da UF, **CONFERIR** no ES), **C195/C197** (ajustes da Tabela 5.3 do ES), **C113/C112**, **C185/C186/C180/C181**
  (ST, conforme a UF).
- **0220** (unidade ≠ UNID_INV).

### C990 — Encerramento (nível 1, O)

| Nº | idx | Campo | Tipo | Obrig | Valor |
|---|---|---|---|---|---|
| 01 | 0 | REG | C | O | `C990` |
| 02 | 1 | QTD_LIN_C | N | O | linhas do bloco C (inclui C001 e C990) |

---

## 6. Bloco D (CT-e como tomador)

Escriturar o CT-e **só se o estabelecimento for o tomador** (tomador = quem contratou e pagou; "só ele terá direito ao crédito").
Comparar o CNPJ do tomador (`ide/toma3/toma`: 0 remetente, 1 expedidor, 2 recebedor, 3 destinatário; ou `ide/toma4/CNPJ`) com o 0000.CNPJ.

### D001 — Abertura (nível 1, O)

| Nº | idx | Campo | Tipo | Tam | Obrig | Valor |
|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | O | `D001` |
| 02 | 1 | IND_MOV | C | 001 | O | `0` se houver D100; senão `1` (e só D001+D990) |

### D100 — CT-e (57), CT-e OS (67) e outros (nível 2, V)

Chave: terceiros = IND_EMIT+NUM_DOC+COD_MOD+SER+SUB+COD_PART (+ CHV_CTE desde 2014). Todo D100 tem ≥ 1 D190, salvo as exceções abaixo.

| Nº | idx | Campo | Tipo | Tam | Dec | E/S | Preenchimento (CT-e de entrada, IND_OPER=0, IND_EMIT=1) |
|---|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | - | O/O | `D100` |
| 02 | 1 | IND_OPER | C | 001* | - | O/O | `0` aquisição (`1` prestação) |
| 03 | 2 | IND_EMIT | C | 001* | - | O/O | `1` terceiros. IND_EMIT=1 ⇒ IND_OPER=0 |
| 04 | 3 | COD_PART | C | 060 | - | O/O | prestador (transportadora, `emit`) no 0150 |
| 05 | 4 | COD_MOD | C | 002* | - | O/O | `57` (CT-e) ou `67` (CT-e OS). Válidos: 07, 08, 8B, 09, 10, 11, 26, 27, 57, 63, 67 |
| 06 | 5 | COD_SIT | N | 002* | - | O/O | `00` normal; `02`/`03` cancelado; `06` complementar (`tpCTe`=1, **CONFERIR**); `08` regime especial. 04/05 descontinuados desde 2023 |
| 07 | 6 | SER | C | 004 | - | OC/OC | **3 posições** para 57/67 (`ide/serie` com zeros à esquerda); sem série → `000` |
| 08 | 7 | SUB | C | 003 | - | OC/OC | vazio |
| 09 | 8 | NUM_DOC | N | 009 | - | O/O | `ide/nCT` (> 0) |
| 10 | 9 | CHV_CTE | N | 044* | - | OC/OC | `infCte/@Id` sem o prefixo `CTe`. Obrigatória para 57/63/67 (exceto COD_SIT 05); DV, série, número e UF conferidos |
| 11 | 10 | DT_DOC | N | 008* | - | O/O | data de `ide/dhEmi`; ≤ 0000.DT_FIN |
| 12 | 11 | DT_A_P | N | 008* | - | O/OC | aquisição: data de entrada/escrituração (usuário), ≥ DT_DOC e ≤ DT_FIN |
| 13 | 12 | TP_CT-e | N | 001* | - | OC/OC | `ide/tpCTe` (0 normal, 1 complemento, 2 anulação, 3 substituto; 5/6 simplificado). Obrigatório para 57/63/67 |
| 14 | 13 | CHV_CTE_REF | N | 044* | - | OC/OC | **só quando TP_CT-e = 3 ou 6**: chave do CT-e substituído (`infCteSub/chCte`, **CONFERIR** a tag); senão vazio |
| 15 | 14 | VL_DOC | N | - | 02 | O/O | `vPrest/vTPrest` |
| 16 | 15 | VL_DESC | N | - | 02 | OC/OC | `0,00` (ou `vTPrest − vRec` se houver diferença: **CONFERIR**) |
| 17 | 16 | IND_FRT | C | 001* | - | O/OC | desde 07/2012: `0` por conta do emitente, `1` por conta do destinatário/remetente, `2` por conta de terceiros, `9` sem cobrança. Valores válidos [0,1,2,9] (**não** há 3/4 no D100). Mapeamento: ver §6.1 |
| 18 | 17 | VL_SERV | N | - | 02 | O/O | `vPrest/vTPrest` (inclui pedágio e demais despesas) |
| 19 | 18 | VL_BC_ICMS | N | - | 02 | OC/OC | só com crédito: `imp/ICMS/ICMSxx/vBC`; senão `0,00`/vazio |
| 20 | 19 | VL_ICMS | N | - | 02 | OC/OC | só com crédito: `vICMS`; senão `0,00`/vazio. **= Σ D190.VL_ICMS** |
| 21 | 20 | VL_NT | N | - | 02 | OC/OC | valor não tributado (prática: VL_SERV − VL_BC_ICMS quando isento/NT; **CONFERIR**) ou vazio |
| 22 | 21 | COD_INF | C | 006 | - | OC/OC | vazio (exigiria 0450) |
| 23 | 22 | COD_CTA | C | - | - | OC/OC | conta contábil ou vazio |
| 24 | 23 | COD_MUN_ORIG | N | 007* | - | OC/O | `ide/cMunIni`. **Obrigatório na entrada para 57/63/67.** 9999999 = exterior |
| 25 | 24 | COD_MUN_DEST | N | 007* | - | OC/O | `ide/cMunFim`. **Obrigatório na entrada para 57/63/67.** 9999999 = exterior; nunca 9999998 |

Leitura em `efd.ts`: numero = f[8], chave = f[9], dtDoc = f[10], dtAP = f[11], vlDoc = f[14], vlIcms = f[19] (coerente).

Exceções do D100 (Guia):
- **02/03/04:** só REG, IND_OPER, IND_EMIT, COD_MOD, COD_SIT, SER, SUB, NUM_DOC, CHV_CTE; demais `||`; sem filhos. **05:** idem **sem** CHV_CTE.
  CT-e de terceiros cancelado: não escriturar (prática, **CONFERIR**).
- **06/07:** obrigatórios REG, IND_OPER, IND_EMIT, COD_PART, COD_MOD, COD_SIT, SER, SUB, NUM_DOC, CHV_CTE, DT_DOC; D190 obrigatório.
- **08:** D100 + D190; CHV_CTE obrigatória para 57.

#### 6.1 IND_FRT do D100 a partir do CT-e (CONFERIR)

O Guia define os códigos pela posição do tomador em relação ao **documento que originou o CT-e** (a NF-e transportada) e manda usar
`2` quando o tomador é diferente do emitente e do destinatário. Mapeamento proposto:
- `toma = 0` (remetente) → `0` (por conta do emitente da NF);
- `toma = 3` (destinatário) → `1` (por conta do destinatário);
- `toma = 1` (expedidor), `2` (recebedor) ou `toma4` (outros) → `2` (terceiros).

### D190 — Registro analítico (nível 3, 1:N; O se existir D100 que não seja 02/03/04/05)

| Nº | idx | Campo | Tipo | Tam | Dec | E/S | Preenchimento |
|---|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | - | O/O | `D190` |
| 02 | 1 | CST_ICMS | N | 003* | - | O/O | **1º caractere sempre `0`**; enfoque do declarante: `0` + CST do grupo ICMS do CT-e (`ICMS00`→`000`, `ICMS20`→`020`, `ICMS45`→`040`/`041`/`051`, `ICMS60`→`060`, `ICMS90`/`ICMSOutraUF`→`090`). Sem direito a crédito (transportador do Simples, frete de mercadoria com ST/isenta) → `090` (**CONFERIR**) |
| 03 | 2 | CFOP | N | 004* | - | O/O | CFOP de entrada do declarante: comércio → `1353`/`2353` (1º dígito: 5→1, 6→2, 7→3 do CFOP do CT-e). Não pode ser título (final 00 ou 50). IND_OPER=0 ⇒ 1/2/3 |
| 04 | 3 | ALIQ_ICMS | N | 006 | 02 | OC/OC | `pICMS` se houver crédito; senão `0,00` |
| 05 | 4 | VL_OPR | N | - | 02 | O/O | `vTPrest` (uma linha por CT-e, em regra) |
| 06 | 5 | VL_BC_ICMS | N | - | 02 | O/O | = D100.VL_BC_ICMS (Σ dos D190) |
| 07 | 6 | VL_ICMS | N | - | 02 | O/O | = D100.VL_ICMS (Σ dos D190) |
| 08 | 7 | VL_RED_BC | N | - | 02 | O/O | **só pode ser preenchido (> 0) se CST termina em 20 ou 70**: `vTPrest − vBC`; senão `0,00` |
| 09 | 8 | COD_OBS | C | 006 | - | OC/OC | vazio |

### D990 — Encerramento (nível 1, O)

| Nº | idx | Campo | Tipo | Obrig | Valor |
|---|---|---|---|---|---|
| 01 | 0 | REG | C | O | `D990` |
| 02 | 1 | QTD_LIN_D | N | O | linhas do bloco D (inclui D001 e D990) |

---

## 7. Bloco E

### E001 — Abertura (nível 1, O)

| Nº | idx | Campo | Tipo | Tam | Obrig | Valor |
|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | O | `E001` |
| 02 | 1 | IND_MOV | C | 001 | O | **sempre `0`** (E100 e E110 sempre existem) |

### E100 — Período de apuração do ICMS (nível 2, 1:N, O)

| Nº | idx | Campo | Tipo | Tam | Obrig | Valor |
|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | O | `E100` |
| 02 | 1 | DT_INI | N | 008* | O | = 0000.DT_INI |
| 03 | 2 | DT_FIN | N | 008* | O | = 0000.DT_FIN |

Um único E100 cobrindo o período do 0000 (sem lacuna nem sobreposição).

### E110 — Apuração do ICMS – operações próprias (nível 3, 1 por E100, O mesmo sem movimento)

Todos os campos são **N, 2 decimais, O** (gravar `0,00` quando zero).

| Nº | idx | Campo | Fórmula (Guia) | Neste escopo |
|---|---|---|---|---|
| 01 | 0 | REG | `E110` | |
| 02 | 1 | VL_TOT_DEBITOS | Σ VL_ICMS dos analíticos (C190, C320, C390, C490, C590, C690, C790, C850, C890, D190, D300, D390, D410, D590, D690, D696, D730, D760) dos **documentos de saída** com data (DT_E_S de C100; DT_A_P de D100; vazia → DT_DOC) dentro do E100. **Excluir** COD_SIT 01 e 07 e CFOP **5605**; **incluir** CFOP **1605** | Σ C190.VL_ICMS com CFOP iniciado em 5/6/7 (exceto 5605) + CFOP 1605, de C100 com COD_SIT ∈ {00, 06, 08} e data no período (NF-e e NFC-e) |
| 03 | 2 | VL_AJ_DEBITOS | Σ VL_ICMS de C197/C597/C857/C897/D197/D737 com COD_AJ[3] ∈ {3,4,5} e COD_AJ[4] ∈ {0,3,4,5,6,7,8}, no período, excluindo COD_SIT 01/07 | `0,00` (C197/D197 fora do escopo) |
| 04 | 3 | VL_TOT_AJ_DEBITOS | Σ E111.VL_AJ_APUR com COD_AJ_APUR[3]='0' e [4]='0' | `0,00` (E111 fora do escopo) |
| 05 | 4 | VL_ESTORNOS_CRED | Σ E111 com [3]='0' e [4]='1' | `0,00` |
| 06 | 5 | VL_TOT_CREDITOS | Σ VL_ICMS de C190, C590, D190, D590, D730 dos **documentos de entrada** no período (DT_E_S / DT_A_P; vazia → DT_DOC). **Excluir** CFOP 1605; **incluir** CFOP 5605. COD_SIT 01/07: **somar no primeiro E100** | Σ C190.VL_ICMS (CFOP 1/2/3, exceto 1605) + CFOP 5605 + Σ D190.VL_ICMS dos CT-e de entrada. Docs 01/07 entram sempre (há um só E100) |
| 07 | 6 | VL_AJ_CREDITOS | Σ VL_ICMS de C197/…/D737 com [3] ∈ {0,1,2} e [4] ∈ {0,3,4,5,6,7,8}; COD_SIT 01/07 no primeiro E100 | `0,00` |
| 08 | 7 | VL_TOT_AJ_CREDITOS | Σ E111 com [3]='0' e [4]='2' | `0,00` (atenção: crédito CIAP e crédito de Simples lançados por ajuste iriam aqui) |
| 09 | 8 | VL_ESTORNOS_DEB | Σ E111 com [3]='0' e [4]='3' | `0,00` |
| 10 | 9 | VL_SLD_CREDOR_ANT | saldo credor do período anterior | **= E110 campo 14 (VL_SLD_CREDOR_TRANSPORTAR) do SPED do mês anterior** (`efd.e110.VL_SLD_CREDOR_TRANSPORTAR`) |
| 11 | 10 | VL_SLD_APURADO | X = (02+03+04+05) − (06+07+08+09+10). X ≥ 0 → X; X < 0 → 0 | `max(X, 0)` |
| 12 | 11 | VL_TOT_DED | Σ C197/…/D737 com [3]='6' e [4]='0' + Σ E111 com [3]='0' e [4]='4'. Informar mesmo que 11 = 0 | `0,00` |
| 13 | 12 | VL_ICMS_RECOLHER | Y = 11 − 12. Y ≥ 0 → Y; Y < 0 → 0 (e o |Y| vai para o 14) | `max(11 − 12, 0)` |
| 14 | 13 | VL_SLD_CREDOR_TRANSPORTAR | Z = (02+03+04+05) − (06+07+08+09+10+12). Z > 0 → 0; Z < 0 → |Z|. Quando X < 0: |X| + VL_TOT_DED | `max(12 − X, 0)` (equivale às duas regras do Guia) |
| 15 | 14 | DEB_ESP | (a) ICMS dos documentos **de saída** COD_SIT 01/07 + (b) C197/…/D737 com [3]='7' e [4]='0' + (c) E111 com [3]='0' e [4]='5' | (a): Σ C190.VL_ICMS dos C100 de saída com COD_SIT 01 ou 07 |

Regras cruzadas:
- **VL_ICMS_RECOLHER + DEB_ESP = Σ E116.VL_OR.** Se os dois forem zero, não gerar E116.
- Débitos: filtrar por CFOP (5/6/7 = saída) é equivalente a filtrar por IND_OPER=1, porque o PVA exige CFOP coerente com IND_OPER.
- CST x60 (ST) tem VL_ICMS = 0, então não gera débito nem crédito. **VL_ICMS_ST das entradas nunca entra no E110** (só no E210).
- Canceladas (02/03) não têm C190, então não entram.
- Leiaute: `efd.ts` lê o E110 com os mesmos nomes na mesma ordem (f[1]..f[14]); `apuracaoCalculada()` reproduz 02 e 06 (usa
  DT_E_S/DT_A_P ou DT_DOC; não trata 01/07 → **CONFERIR** ao reaproveitar).
- Cálculo em centavos inteiros; não recalcular BC × alíquota no agregado.

### E116 — Obrigações do ICMS recolhido ou a recolher (nível 4, 1:N, OC)

| Nº | idx | Campo | Tipo | Tam | Dec | Obrig | Preenchimento |
|---|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | - | O | `E116` |
| 02 | 1 | COD_OR | C | 003* | - | O | Tabela 5.4. Válidos no E116: **000, 003, 004, 005, 006, 090**. ICMS normal do mês = `000` |
| 03 | 2 | VL_OR | N | - | 02 | O | valor da obrigação, **sem** multa e juros |
| 04 | 3 | DT_VCTO | N | 008* | - | O | vencimento (data válida). **Parâmetro por UF/atividade: CONFERIR** o prazo do ICMS do comércio no RICMS-ES |
| 05 | 4 | COD_REC | C | - | - | O | código de receita do DUA do ES. **Parâmetro: CONFERIR** com a SEFAZ-ES/escritório (o Guia não traz) |
| 06 | 5 | NUM_PROC | C | 060 | - | OC | vazio (se preenchido, IND_PROC e PROC também são obrigatórios) |
| 07 | 6 | IND_PROC | C | 001* | - | OC | vazio. Válidos: `0` SEFAZ, `1` Justiça Federal, `2` Justiça Estadual, `9` outros |
| 08 | 7 | PROC | C | - | - | OC | vazio |
| 09 | 8 | TXT_COMPL | C | - | - | OC | vazio (até 12/2010 levava o mês do débito extemporâneo) |
| 10 | 9 | MES_REF | N | 006* | - | O | `mmaaaa` do débito; **não pode ser posterior à competência de 0000.DT_INI** |

Geração:
- Se VL_ICMS_RECOLHER > 0: `|E116|000|<VL_ICMS_RECOLHER>|<venc>|<cod_rec>|||||<mmaaaa do período>|`.
- Se DEB_ESP > 0: um E116 por mês de origem dos extemporâneos, com MES_REF = mês original, COD_OR `000` (ou `090`: **CONFERIR**).
- Σ VL_OR = VL_ICMS_RECOLHER + DEB_ESP (exato, em centavos).

### E990 — Encerramento (nível 1, O)

| Nº | idx | Campo | Tipo | Obrig | Valor |
|---|---|---|---|---|---|
| 01 | 0 | REG | C | O | `E990` |
| 02 | 1 | QTD_LIN_E | N | O | linhas do bloco E (inclui E001 e E990) |

---

## 8. Blocos G, H e K

| Reg | Nº | idx | Campo | Tipo | Tam | Obrig | Valor |
|---|---|---|---|---|---|---|---|
| G001 | 01 | 0 | REG | C | 004* | O | `G001` |
| G001 | 02 | 1 | IND_MOV | C | 001* | O | `1` (sem CIAP). Com `0` seria obrigatório o G110 e filhos (fora do escopo) |
| G990 | 01 | 0 | REG | C | 004* | O | `G990` |
| G990 | 02 | 1 | QTD_LIN_G | N | - | O | `2` |
| H001 | 01 | 0 | REG | C | 004 | O | `H001` |
| H001 | 02 | 1 | IND_MOV | C | 001* | O | `1` nos meses sem inventário. **Fevereiro: obrigatoriamente `0`**, com H005 (DT_INV = 31/12 do ano anterior, MOT_INV = 01) e H010, **fora do escopo** → o gerador deve bloquear ou avisar em fevereiro (o PVA dá advertência sem o H005) |
| H990 | 01 | 0 | REG | C | 004 | O | `H990` |
| H990 | 02 | 1 | QTD_LIN_H | N | - | O | `2` (sem inventário) |
| K001 | 01 | 0 | REG | C | 004 | O | `K001` |
| K001 | 02 | 1 | IND_MOV | C | 001* | O | `1`: o varejo (CNAE 47xx) não é obrigado ao Bloco K. Com `0` seriam obrigatórios o K010 e pelo menos um K100 |
| K010 | 01 | 0 | REG | C | 004 | O | `K010` |
| K010 | 02 | 1 | IND_TP_LEIAUTE | C | 001* | O | `0` simplificado, `1` completo, `2` restrito aos saldos de estoque. **Só se K001.IND_MOV = 0 → não gerar para esta empresa** |
| K990 | 01 | 0 | REG | C | 004 | O | `K990` |
| K990 | 02 | 1 | QTD_LIN_K | N | - | O | `2` |

---

## 9. Bloco 1

### 1001 — Abertura (nível 1, O)

| Nº | idx | Campo | Tipo | Tam | Obrig | Valor |
|---|---|---|---|---|---|---|
| 01 | 0 | REG | C | 004 | O | `1001` |
| 02 | 1 | IND_MOV | N | 001* | O | **`0` sempre** (o 1010 é obrigatório) |

### 1010 — Obrigatoriedade de registros do Bloco 1 (nível 2, 1, O)

Leiaute atual (Guia 3.2.2; o leiaute 020 não mudou este registro): **14 campos**, todos `C 001*` com `S`/`N`, todos O.
"S" = obrigado a apresentar o registro; UF que dispensa → "N".

| Nº | idx | Campo | Registro | Pergunta | Valor para esta empresa |
|---|---|---|---|---|---|
| 01 | 0 | REG | – | `1010` | `1010` |
| 02 | 1 | IND_EXP | 1100 | Averbação de exportação no período? | `N` |
| 03 | 2 | IND_CCRF | 1200 | Créditos de ICMS a controlar, definidos pela SEFAZ? | `N` (**CONFERIR** no ES) |
| 04 | 3 | IND_COMB | 1300 | Varejista de combustíveis com movimento/estoque? | `N` |
| 05 | 4 | IND_USINA | 1390 | Usina de açúcar/álcool? | `N` |
| 06 | 5 | IND_VA | 1400 | Registro obrigatório na UF e há informação (valor adicionado)? | `N` (**CONFERIR** se o ES exige o 1400) |
| 07 | 6 | IND_EE | 1500 | Distribuidora de energia com fornecimento a outra UF? | `N` |
| 08 | 7 | IND_CART | 1601 | Vendas com instrumentos eletrônicos de pagamento? (até 2021 referia-se ao 1600) | **CONFERIR**: `S` obriga o 1601, que está fora do escopo. Gerar `N` só se o ES dispensar o 1601 |
| 09 | 8 | IND_FORM | 1700 | Documentos em papel com controle de utilização? | `N` |
| 10 | 9 | IND_AER | 1800 | Transporte aéreo? | `N` |
| 11 | 10 | IND_GIAF1 | 1960 | GIAF1 (só PE) | `N` |
| 12 | 11 | IND_GIAF3 | 1970 | GIAF3 (só PE) | `N` |
| 13 | 12 | IND_GIAF4 | 1980 | GIAF4 (só PE) | `N` |
| 14 | 13 | IND_REST_RESSARC_COMPL_ICMS | 1250 | Saldos consolidados de restituição/ressarcimento/complementação do ICMS? | `N` (**CONFERIR** se o ES adota C18x/1250) |

Linha padrão: `|1010|N|N|N|N|N|N|N|N|N|N|N|N|N|`. Não há indicador para o 1900. Nenhum campo novo em 2025/2026 (leiautes 019 e 020).

### 1990 — Encerramento (nível 1, O)

| Nº | idx | Campo | Tipo | Obrig | Valor |
|---|---|---|---|---|---|
| 01 | 0 | REG | C | O | `1990` |
| 02 | 1 | QTD_LIN_1 | N | O | linhas do bloco 1 (inclui 1001 e 1990) → `3` com só 1001+1010+1990 |

---

## 10. Bloco 9

| Reg | Nº | idx | Campo | Tipo | Tam | Obrig | Valor |
|---|---|---|---|---|---|---|---|
| 9001 | 01 | 0 | REG | C | 004 | O | `9001` |
| 9001 | 02 | 1 | IND_MOV | N | 001* | O | **`0` sempre** |
| 9900 | 01 | 0 | REG | C | 004 | O | `9900` |
| 9900 | 02 | 1 | REG_BLC | C | 004 | O | código do registro totalizado |
| 9900 | 03 | 2 | QTD_REG_BLC | N | - | O | nº de linhas daquele registro no arquivo |
| 9990 | 01 | 0 | REG | C | 004 | O | `9990` |
| 9990 | 02 | 1 | QTD_LIN_9 | N | - | O | linhas do bloco 9 **+ 1 (9999)** |
| 9999 | 01 | 0 | REG | C | 004 | O | `9999` |
| 9999 | 02 | 1 | QTD_LIN | N | - | O | total de linhas do arquivo, **incluindo o 9999** |

Algoritmo em §1.1.

---

## 11. Exemplo de arquivo mínimo (sem movimento, perfil A, janeiro/2026)

```
|0000|020|0|01012026|31012026|FARMACIA X LTDA|12345678000195||ES|081234567|3205309|||A|1|
|0001|0|
|0005|FARMACIA X|29100000|RUA A|10||CENTRO|2733330000||contato@x.com|
|0100|FULANO CONTADOR|12345678909|ES012345O1|||||||||contador@esc.com|3205309|
|0990|5|
|B001|1|
|B990|2|
|C001|1|
|C990|2|
|D001|1|
|D990|2|
|E001|0|
|E100|01012026|31012026|
|E110|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|
|E990|4|
|G001|1|
|G990|2|
|H001|1|
|H990|2|
|K001|1|
|K990|2|
|1001|0|
|1010|N|N|N|N|N|N|N|N|N|N|N|N|N|
|1990|3|
|9001|0|
|9900|0000|1|
|9900|0001|1|
|9900|0005|1|
|9900|0100|1|
|9900|0990|1|
|9900|B001|1|
|9900|B990|1|
|9900|C001|1|
|9900|C990|1|
|9900|D001|1|
|9900|D990|1|
|9900|E001|1|
|9900|E100|1|
|9900|E110|1|
|9900|E990|1|
|9900|G001|1|
|9900|G990|1|
|9900|H001|1|
|9900|H990|1|
|9900|K001|1|
|9900|K990|1|
|9900|1001|1|
|9900|1010|1|
|9900|1990|1|
|9900|9001|1|
|9900|9900|28|
|9900|9990|1|
|9900|9999|1|
|9990|31|
|9999|55|
```
Contagem: 24 linhas até o 1990 (24 tipos de registro); bloco 9 = 9001 (1) + 28 linhas 9900 (24 tipos + 9001, 9900, 9990, 9999) + 9990 (1) + 9999 (1) = 31; total 24 + 31 = 55.
(Com saldo credor anterior, o campo 10 do E110 e o 14 teriam o valor transportado.)

Exemplos de documento:
```
|C100|0|1|F12345678000100|55|00|001|123456|32260112345678000100550010001234561000000010|05012026|07012026|1150,00|1|0,00|0,00|1150,00|1|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|||||
|C170|1|MED001|DIPIRONA 500MG CX10|10,00000|CX|1150,00|0,00|0|060|1403|||||||||||||||||||||||||||0,00|
|C190|060|1403|0,00|1150,00|0,00|0,00|0,00|0,00|0,00|0,00||
|C100|1|0||65|00|001|4567|32260112345678000195650010000045671000000011|10012026||25,90|0|0,00|0,00|25,90|9|0,00|0,00|0,00|0,00|0,00||||||||
|C190|060|5405|0,00|25,90|0,00|0,00|0,00|0,00|0,00|0,00||
|C100|1|0||65|02|001|4568|32260112345678000195650010000045681000000012|||||||||||||||||||||
```
(Chaves ilustrativas, sem DV válido. Conferir a contagem de campos: C100 = 29, C170 = 38, C190 = 12.)

---

## 12. Pontos CONFERIR (resumo)

1. COD_VER 018 (2024) e 017 (2023): não confirmados (020 = 2026 e 019 = 2025 confirmados no Portal SPED/TDN).
2. Latin-1 + CRLF: vêm do Ato COTEPE (confirmado na redação equivalente do Ato 47/2015); conferir no texto do Ato 44/2018.
3. ALIQ_ICMS vazio × `0,00` na chave C170 ↔ C190 (§5.5).
4. DT_E_S nas saídas e nas NFC-e: regra do ES (apuração pela data de emissão ou de saída).
5. VL_DOC 2026: confirmar no XML real que `vNF` não inclui IBS/CBS (NT 2025.002).
6. IND_PGTO: mapeamento a partir do `pag`/`cobr` (§5.4).
7. Conversão CST/CFOP de entrada e crédito de fornecedor do Simples (CSOSN 101): validar com o contador.
8. VL_ICMS (C170/C190) com FCP e a ALIQ correspondente; exigência do C191 no ES.
9. VL_RED_BC: fórmula (§5.7).
10. D100: COD_SIT para `tpCTe` 1/2, VL_DESC, VL_NT, IND_FRT (§6.1), CST `090` para CT-e sem crédito.
11. E116: COD_REC e DT_VCTO do ES; COD_OR do DEB_ESP (000 × 090).
12. 1010: IND_CART (1601 no ES), IND_VA (1400), IND_CCRF, IND_REST_RESSARC_COMPL_ICMS.
13. Lacunas de escopo que podem tornar o arquivo inválido: 0220 (unidade de compra ≠ unidade de estoque), E200/E210 (qualquer C190 com
    VL_ICMS_ST > 0), C101/E300 (DIFAL EC 87), H005/H010 em fevereiro, 1601 se IND_CART = S, 0175 (alteração de participante no mês).
