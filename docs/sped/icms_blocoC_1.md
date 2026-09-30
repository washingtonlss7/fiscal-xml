# EFD-ICMS/IPI – Bloco C (parte 1): C001 a C197

Fonte: Guia Prático EFD-ICMS/IPI v3.2.2 (atualização de 11/02/2026), linhas 3729–7100 do arquivo `guia_icms_ipi.txt` (páginas 62–115). O trecho vai do C001 até o C330, que é o início do C350.

Contexto do produto: gerar e validar a EFD a partir de XML de NF-e (55) e NFC-e (65) de farmácias e varejo no ES. É um cenário com muito ICMS-ST (CST 60), fornecedores do Simples (CSOSN), compras interestaduais e antecipação.

Legenda das marcas usadas no texto:
- **[Guia]** é regra literal ou quase literal do Guia.
- **[XML]** é o mapeamento para as tags do leiaute NF-e 4.00. Não vem do Guia, é convenção de implementação.
- **[Prática]** é uma escolha usual de mercado que não está no trecho lido. Validar com o contador ou com a SEFAZ-ES antes de adotar.
- **[Fora do trecho]** é informação de outra seção do Guia ou de tabela externa.

Na coluna Obrig., O = obrigatório, OC = obrigatório condicional (pode vir vazio `||`) e N/A = "Não apresentar". Tipo N = numérico com vírgula decimal. Tam com `*` = tamanho fixo.

---

## 0. Convenções gerais de geração

- Os valores numéricos usam vírgula como separador decimal e não têm separador de milhar. Em campo OC sem conteúdo, gerar `||`. Nos campos "O" de valor (por exemplo, os do C190), gerar `0` ou `0,00` e nunca vazio.
- As datas vão no formato `ddmmaaaa`. No XML, `dhEmi` e `dhSaiEnt` vêm em ISO com fuso. É preciso converter para a data local (usar a data da string, não converter para UTC).
- **Enfoque do declarante [Guia]**: nas entradas, BC, alíquota e imposto (ICMS, ICMS-ST e IPI) só são informados se o adquirente tiver direito ao crédito. Quando não há crédito, o ICMS-ST e o IPI destacados são somados ao VL_ITEM (C170) e ao VL_MERC (C100), porque compõem o custo. Nesse caso os campos VL_ICMS_ST e VL_IPI de C100, C170 e C190 não são informados (Resposta 3 do C100).
- **Reforma Tributária [Guia]**:
  - Documentos que tratem **apenas** de IBS, CBS ou IS não são escriturados.
  - Documentos do Ajuste SINIEF 49/25 que tenham ICMS ou IPI são escriturados em relação a esses tributos.
  - Os valores de CBS, IBS e IS **nunca** entram no VL_OPR do C190.
  - Em 2026 eles também não entram no VL_DOC (usar `vNF`, que em 2026 não soma IBS/CBS).
  - A partir de 2027, VL_DOC pode diferir de Σ VL_OPR.

---

## 1. REGISTRO C001 – Abertura do Bloco C

- Nível 1. Ocorrência: um por arquivo.

| Nº | Campo | Tipo | Tam | Obrig | Regra |
|---|---|---|---|---|---|
| 01 | REG | C | 004 | O | "C001" |
| 02 | IND_MOV | C | 001* | O | 0 = bloco com dados; 1 = sem dados |

Validação [Guia]:
- Com IND_MOV=1, só podem existir C001 e C990.
- Com IND_MOV=0, deve existir pelo menos um registro além de C001 e C990.

Implementação: calcular IND_MOV depois de gerar os filhos. Farmácia com movimento sempre terá 0.

---

## 2. REGISTRO C100 – NF (01), NF Avulsa (1B), NF Produtor (04), NF-e (55) e NFC-e (65)

- Nível 2. Ocorrência: vários por arquivo.
- Um C100 por documento, tanto de entrada quanto de saída.
- **NFC-e (65) não é escriturada nas entradas [Guia].** Se a farmácia receber um DANFE NFC-e como entrada, ele não entra no C100 de entrada.

### 2.1 Regras de filhos obrigatórios (exceções) [Guia]

**Regra geral:** todo C100 tem pelo menos um C170 e um C190, salvo as exceções abaixo.

| Exc. | Situação | O que gerar |
|---|---|---|
| 1 | COD_SIT 02 (cancelado), 03 (cancelado extemporâneo), 04 (denegado) | Preencher só REG, IND_OPER, IND_EMIT, COD_MOD, COD_SIT, SER, NUM_DOC, CHV_NFE. Os demais campos ficam `||`. **Sem filhos.** Desde 01/2011, a NF-e própria cancelada deve trazer a chave. |
| 1 | COD_SIT 05 (inutilizado) | Os mesmos campos, **sem** CHV_NFE. Sem filhos. |
| 2 | NF-e de **emissão própria** (55) | Em regra, só C100 + C190. Adicionar C195/C197 se houver ajuste da Tabela 5.3. **C170 só é admitido se houver C176, C180, C181 ou C177** (C177 = informação complementar do item, Tabela 5.6, desde 01/01/2019). C110/C120 a critério da UF (desde 07/2012). C101 obrigatório em operação interestadual para consumidor final não contribuinte (EC 87/15). C185 (desde 01/2020) e C186 (desde 01/2021) a critério da UF. |
| 3 | COD_SIT 06 ou 07 (complementar e complementar extemporânea) | Obrigatórios: REG, IND_EMIT, COD_PART, COD_MOD, COD_SIT, NUM_DOC, CHV_NFE, DT_DOC (e a data de saída, se a UF apura por saída). Os demais campos são facultativos, mas se preenchidos (mesmo com zero) são validados. **C190 sempre obrigatório.** Se houver C170, NUM_ITEM é obrigatório. |
| 4 | COD_SIT 08 (regime especial ou norma específica) | C100 e C190 são obrigatórios. Os demais filhos entram se a legislação exigir. Campos obrigatórios: REG, IND_OPER, IND_EMIT, COD_PART, COD_MOD, COD_SIT, NUM_DOC, DT_DOC, mais CHV_NFE para mod. 55. Exemplos: NF 5.929/6.929 emitida em substituição a cupom; NF sem destinatário (usar os dados do emitente). Documento **não eletrônico** com 08 exige C110 com a norma legal. |
| 5 | COD_SIT 08 | Permite DT_DOC > DT_E_S. O PVA emite advertência. |
| 6 | Venda para outra UF de produto que teve ST na operação anterior (ressarcimento) | C170 **somente** para os itens com direito a ressarcimento, cada um com C176. A obrigatoriedade é da UF. |
| 7 | Documento emitido por terceiros escriturado pelo informante (consórcio, NF-e avulsa série 890–899) | Tratar como terceiros com **COD_SIT=08**. O PVA emite advertência. Filiais com IE única ou escrituração centralizada: emissão própria com COD_SIT 00. |
| 8 | NF-e própria com UF de consumo diferente da UF do destinatário | Gerar C105. |
| 9 | **NFC-e (65)** | Em regra, só **C100 + C190**, mais C195/C197 se houver ajuste da Tabela 5.3 e C185 (desde 01/2020, a critério da UF). No C100 **não informar**: COD_PART, VL_BC_ICMS_ST, VL_ICMS_ST, VL_IPI, VL_PIS, VL_COFINS, VL_PIS_ST, VL_COFINS_ST. O C191 também é aceito para 65 (o título do C191 cita 55 e 65). |
| 10 | Existe C177 (Tabela 5.6) | C170 obrigatório, inclusive em NF-e própria. A UF define. |
| 11 | Ajuste SINIEF 13/24 (retorno simbólico e nota que corrige a saída) | Escriturar no período da saída original. Se as notas forem de períodos diferentes, usar COD_SIT=08 com DT_E_S = data da saída original. |

**Resumo dos filhos permitidos por tipo de documento (para o gerador):**

| Tipo | C101 | C105 | C110-C116 | C120 | C170 | C176 | C180/C181 | C185/C186 | C190 | C191 | C195/C197 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| NF-e 55 entrada de terceiros | – | – | sim, se houver no infCpl | importação | **obrigatório** | – | C180 (entrada), C181 (devolução de venda) conforme UF | – | obrigatório | UF | se houver ajuste |
| NF-e 55 saída própria | EC87 | UF consumo | UF | – | só com C176/C180/C181/C177 | Exc. 6 | – | C185 (saída), C186 (devolução de compra) conforme UF | obrigatório | UF | se houver ajuste |
| NF-e 55 entrada própria (emitida pelo informante, ex.: devolução de consumidor, importação) | EC87 (devolução) | – | UF | sim, na importação | só com C181/C180/C177 | – | UF | – | obrigatório | UF | se houver ajuste |
| NFC-e 65 saída | – | – | – | – | **não** | – | – | C185 conforme UF | obrigatório | UF | se houver ajuste |
| Cancelada/denegada/inutilizada | nenhum filho | | | | | | | | | | |

### 2.2 Chave do registro e duplicidade [Guia]

- **Terceiros** (IND_EMIT=1): IND_OPER + IND_EMIT + COD_PART + COD_MOD + COD_SIT + SER + NUM_DOC + CHV_NFE.
- **Emissão própria** (IND_EMIT=0): IND_OPER + IND_EMIT + COD_MOD + COD_SIT + SER + NUM_DOC + CHV_NFE.
- **Advertência**: dois ou mais C100 com o mesmo IND_EMIT + COD_SIT + COD_PART + SER + NUM_DOC, **exceto** para COD_MOD 55/65.
- Para o validador: deduplicar pela chave de acesso antes de gerar, porque um XML importado duas vezes vira erro.

### 2.3 Campos

| Nº | Campo | Tipo | Tam | Dec | Entr | Saída | Descrição e mapeamento XML |
|---|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | – | O | O | "C100" |
| 02 | IND_OPER | C | 001* | – | O | O | 0 = entrada; 1 = saída. [XML] própria: `ide/tpNF`; terceiros: sempre 0 |
| 03 | IND_EMIT | C | 001* | – | O | O | 0 = própria; 1 = terceiros. [XML] `emit/CNPJ` == CNPJ do 0000 → 0 |
| 04 | COD_PART | C | 060 | – | O | O | Código do 0150: nas entradas, o emitente ou remetente; nas saídas, o adquirente. **Vazio para mod. 65.** [XML] entrada: `emit`; saída: `dest` |
| 05 | COD_MOD | C | 002* | – | O | O | [01, 1B, 04, 55, 65]. [XML] `ide/mod` |
| 06 | COD_SIT | N | 002* | – | O | O | Tabela 4.1.2 (ver §2.5) |
| 07 | SER | C | 003 | – | OC | OC | [XML] `ide/serie`. Obrigatório "com três posições" para 55 (própria ou de terceiros) e 65 próprio; sem série, informar `000` |
| 08 | NUM_DOC | N | 009 | – | O | O | [XML] `ide/nNF`. Deve ser > 0 |
| 09 | CHV_NFE | N | 044* | – | OC | OC | [XML] `protNFe/infProt/chNFe` ou `infNFe/@Id` sem o prefixo "NFe". Obrigatória para 55 e 65 desde 04/2012, exceto COD_SIT 05 |
| 10 | DT_DOC | N | 008* | – | O | O | [XML] `ide/dhEmi`. Deve ser ≤ DT_FIN do 0000 |
| 11 | DT_E_S | N | 008* | – | O | OC | Entrada: **data de entrada efetiva**. Não vem do XML: é informada pelo usuário ou pela data de recebimento/manifestação. Saída: `ide/dhSaiEnt`, se existir. Regras: ≥ DT_DOC e ≤ DT_FIN |
| 12 | VL_DOC | N | – | 02 | O | O | [XML] `total/ICMSTot/vNF` (em 2026 sem IBS/CBS/IS) |
| 13 | IND_PGTO | C | 001* | – | O | O | 0 = à vista; 1 = a prazo; 2 = outros; 9 = sem pagamento (valores válidos [0,1,2,9]). [XML/Prática] `pag/detPag/indPag` (0/1). Se houver `cobr/dup` com vencimento futuro → 1. `tPag=90` (sem pagamento) → 9. Demais casos → 2 |
| 14 | VL_DESC | N | – | 02 | OC | OC | Desconto incondicional. [XML] `ICMSTot/vDesc` |
| 15 | VL_ABAT_NT | N | – | 02 | OC | OC | Abatimento não tributado e não comercial (ex.: desconto de ICMS para a ZFM). **Igual à Σ C170.VL_ABAT_NT.** [XML/Prática] `vICMSDeson` quando é repassado como abatimento; na farmácia costuma ser 0 |
| 16 | VL_MERC | N | – | 02 | O | OC | [XML] `ICMSTot/vProd`. Na entrada sem crédito, somar ST e IPI (Resposta 3) |
| 17 | IND_FRT | C | 001* | – | O | O | Desde 01/2018: 0 = CIF (remetente); 1 = FOB (destinatário); 2 = terceiros; 3 = próprio do remetente; 4 = próprio do destinatário; 9 = sem transporte. [XML] `transp/modFrete` (mesmos códigos). Venda balcão e remessa simbólica → 9. Com mais de um responsável, usar o do primeiro percurso |
| 18 | VL_FRT | N | – | 02 | OC | OC | [XML] `vFrete` |
| 19 | VL_SEG | N | – | 02 | OC | OC | [XML] `vSeg` |
| 20 | VL_OUT_DA | N | – | 02 | OC | OC | [XML] `vOutro` |
| 21 | VL_BC_ICMS | N | – | 02 | OC | OC | **= Σ C190.VL_BC_ICMS** |
| 22 | VL_ICMS | N | – | 02 | OC | OC | ICMS creditado na entrada ou debitado na saída. **= Σ C190.VL_ICMS.** Como o C190 inclui FCP, na prática é `vICMS + vFCP` |
| 23 | VL_BC_ICMS_ST | N | – | 02 | OC | OC | **= Σ C190.VL_BC_ICMS_ST**. Vazio no mod. 65 |
| 24 | VL_ICMS_ST | N | – | 02 | OC | OC | ST creditado ou debitado conforme a legislação. **= Σ C190.VL_ICMS_ST** (inclui FCP-ST, ou seja, `vST + vFCPST`). Vazio no mod. 65 |
| 25 | VL_IPI | N | – | 02 | OC | OC | **= Σ C190.VL_IPI**. Vazio no mod. 65 |
| 26 | VL_PIS | N | – | 02 | OC | OC | `||` se entrega EFD-Contribuições. Vazio no 65 |
| 27 | VL_COFINS | N | – | 02 | OC | OC | Idem |
| 28 | VL_PIS_ST | N | – | 02 | OC | OC | Idem |
| 29 | VL_COFINS_ST | N | – | 02 | OC | OC | Idem |

### 2.4 Validações de campo [Guia]

- **IND_EMIT**: só são "própria" os documentos do CNPJ do 0000. Outro estabelecimento da mesma empresa é terceiro.
- **IND_EMIT=1 ⇒ IND_OPER=0.**
- Nota avulsa de saída que o informante deva escriturar tem IND_EMIT=0.
- **COD_PART** tem que existir no 0150 e fica vazio no mod. 65.
- **COD_SIT 04 e 05** só valem para NF-e e NFC-e, e só até 31/12/2022 (ver §2.5).
- **COD_SIT=08** em documento diferente de NF-e própria exige C110 com o dispositivo legal.
- **CHV_NFE**:
  - Confere o DV (módulo 11) da chave própria.
  - Na emissão própria, confere o CNPJ base da chave (posições 7–14 da chave; CNPJ nas posições 7–20) contra o CNPJ base do 0000.
  - Confere NUM_DOC e SER contra a chave: série nas posições 23–25 e nNF nas posições 26–34.
  - Confere a UF da chave (`cUF`, posições 1–2) contra a UF do 0000.
  - Para o ES, `cUF = 32`.
- **DT_E_S**:
  - Na entrada é sempre obrigatória.
  - Na saída, só é informada se o sistema tiver o dado.
  - Se a UF apura pela **data de emissão** e a data de saída for maior que DT_FIN, a DT_E_S **não pode** ser preenchida.
  - Se a UF apura pela data de saída, o documento é lançado no período da data de saída.
  - O Bloco E usa DT_E_S e, quando ela está vazia, DT_DOC.
- **VL_DOC**: é o total da NF.
- **VL_MERC** (texto literal): "se COD_MOD ≠ 55, IND_EMIT ≠ 0 e COD_SIT = 00/01, então VL_MERC = Σ C170.VL_ITEM". No C170, campo 07: "a soma de VL_ITEM dos C170 deve ser igual a VL_MERC". **Para o validador: quando houver C170, exigir Σ VL_ITEM = VL_MERC.**
- **VL_BC_ICMS, VL_ICMS, VL_BC_ICMS_ST, VL_ICMS_ST e VL_IPI** têm que ser iguais às somas dos C190 filhos.

Perguntas e respostas do Guia sobre o C100:
1. Quando a legislação manda "zerar" valores, seguir a regra estadual de escrituração e lançar só o ICMS ou ICMS-ST efetivamente debitado ou creditado.
2. VL_ABAT_NT: situações específicas de cada UF (exemplos de MG: redução condicionada a repasse; isenção com repasse a órgão público).
3. Entrada sem direito a crédito: somar ST e IPI em VL_MERC e VL_ITEM; não informar VL_ICMS_ST e VL_IPI em C100, C170 e C190.

### 2.5 COD_SIT (Tabela 4.1.2) – regras para o gerador

A tabela completa está na Subseção 1.3 [Fora do trecho]. Os códigos são [00, 01, 02, 03, 04, 05, 06, 07, 08].

| COD_SIT | Significado | Quando usar (a partir do XML ou evento) | Campos e filhos |
|---|---|---|---|
| 00 | Documento regular | NF-e/NFC-e autorizada (`cStat` 100, ou 150 fora do prazo) escriturada no período | Completo |
| 01 | Regular extemporâneo | Documento regular de período anterior escriturado agora (ex.: entrada esquecida). DT_DOC e DT_E_S ficam no período original. | Completo. No E110 vai para DEB_ESP ou para o primeiro período, conforme o caso (ver Bloco E) |
| 02 | Cancelado | NF-e própria com evento de cancelamento (110111) ou `cStat` 101/151/135 | Exc. 1: só as chaves, sem filhos. **Com CHV_NFE** |
| 03 | Cancelado extemporâneo | Documento de período anterior escriturado como regular e cancelado depois (cancelamento extemporâneo) | Exc. 1, com CHV_NFE |
| 04 | NF-e/CT-e denegado | `cStat` 110/301/302/303 | **Descontinuado a partir de 01/2023; desde 01/12/2021 a informação não é obrigatória.** O gerador não deve emitir |
| 05 | Numeração inutilizada | Inutilização (`cStat` 102) | **Descontinuado a partir de 01/2023.** Não emitir. Historicamente era gerado sem CHV_NFE |
| 06 | Complementar | NF-e com `ide/finNFe=2` | Exc. 3; C190 obrigatório. QTD do C170 pode ser 0 |
| 07 | Complementar extemporâneo | Complementar de período anterior | Exc. 3 |
| 08 | Regime especial ou norma específica | NF-e avulsa (série 890–899) recebida; consórcio; NF 5.929/6.929; Ajuste SINIEF 13/24 entre períodos | Exc. 4/7; C110 se não eletrônico |

Notas para o gerador:
- **Cancelamento de terceiros** [Prática]: não escriturar a NF-e de fornecedor cancelada (consultar o evento antes). Se ela já tinha sido escriturada em período fechado, retificar o arquivo daquele período.
- **NFC-e cancelada**: vai como C100 COD_MOD=65, COD_SIT=02, com a chave (Exc. 1 aplica "NF-e de emissão própria"; na prática vale o mesmo para a 65).
- **NFC-e em contingência offline** (`tpEmis=9`) que depois foi autorizada: COD_SIT 00.

---

## 3. REGISTRO C101 – Informação complementar EC 87/15 (código 55)

- Uso: operação interestadual para consumidor final **não contribuinte** (DIFAL da EC 87/15). Alimenta E300 e filhos das UFs de origem e de destino.
- Nível 3. Ocorrência 1:1.

| Nº | Campo | Tipo | Tam | Dec | Entr | Saída | XML |
|---|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | – | O | O | "C101" |
| 02 | VL_FCP_UF_DEST | N | – | 02 | O | O | `ICMSTot/vFCPUFDest` |
| 03 | VL_ICMS_UF_DEST | N | – | 02 | O | O | `ICMSTot/vICMSUFDest` |
| 04 | VL_ICMS_UF_REM | N | – | 02 | O | O | `ICMSTot/vICMSUFRemet` (zerado desde 2019) |

**Devolução [Guia]**: quando o vendedor emite a NF-e de entrada de devolução, os valores de origem e destino **se invertem**.
- Venda A→B: VL_ICMS_UF_DEST=40 (B) e VL_ICMS_UF_REM=60 (A).
- Devolução: VL_ICMS_UF_DEST=60 e VL_ICMS_UF_REM=40.
- O FCP (10) é repetido para anular a operação anterior, se a UF de destino permitir.

Farmácia no ES: é raro (venda por e-commerce para CPF de outra UF). Nesse caso o XML traz o grupo `ICMSUFDest` e o C101 é obrigatório.

---

## 4. REGISTRO C105 – ICMS-ST recolhido para UF diversa do destinatário (código 55)

- Uso: NF-e própria em que a UF de destino do ICMS-ST difere da UF do destinatário. Exemplos: leasing, faturamento direto, combustíveis e a **recusa de recebimento** descrita abaixo.
- Nível 3. Ocorrência 1:1.

| Nº | Campo | Tipo | Tam | Obrig | Regra |
|---|---|---|---|---|---|
| 01 | REG | C | 004 | O | "C105" |
| 02 | OPER | N | 001* | O | 0 = combustíveis e lubrificantes; 1 = leasing ou faturamento direto; 2 = recusa de recebimento |
| 03 | UF | C | 002* | O | UF de destino do ICMS-ST |

Condições do OPER=2 (recusa):
- A nota de retorno é própria (IND_EMIT=0) e tem os dados do emitente no destinatário.
- A UF de quem recusou está no local de retirada.
- `finNFe=4` (devolução).
- Os CFOP são de devolução (validação do E210 VL_DEVOL_ST).
- A NF-e referenciada é a remessa recusada.

[XML] O gatilho é `ide/indFinal`/UF de consumo. Na NT de combustíveis, é o grupo `comb/UFCons` diferente de `dest/enderDest/UF`. Não se aplica a farmácia.

---

## 5. REGISTRO C110 – Informação complementar da NF (códigos 01, 1B, 04 e 55)

- Uso: dados do campo "Informações Complementares" que interessam ao fisco. Os detalhamentos vão nos filhos C111 a C116.
- Nível 3. Ocorrência 1:N. Não pode haver dois C110 com o mesmo COD_INF no mesmo documento.

| Nº | Campo | Tipo | Tam | Obrig | Regra |
|---|---|---|---|---|---|
| 01 | REG | C | 004 | O | "C110" |
| 02 | COD_INF | C | 006 | O | Tem que existir no **0450** |
| 03 | TXT_COMPL | C | – | OC | Texto complementar |

[XML] Origem: `infAdic/infCpl` e `infAdic/infAdFisco`.
- NF-e própria: C110 só se a UF exigir.
- COD_SIT=08 com documento não eletrônico: obrigatório.
- NFC-e: o título não inclui o 65, então não gerar.

### 5.1 C111 – Processo referenciado
- Nível 4. Ocorrência 1:N. É obrigatório quando o infCpl citar processo. NUM_PROC é único por C110.

| Nº | Campo | Tipo | Tam | Obrig | Regra |
|---|---|---|---|---|---|
| 01 | REG | C | 004 | O | "C111" |
| 02 | NUM_PROC | C | 060 | O | Processo ou ato concessório |
| 03 | IND_PROC | C | 001* | O | 0 = SEFAZ; 1 = Justiça Federal; 2 = Justiça Estadual; 3 = SECEX/SRF; 9 = outros |

[XML] `infAdic/procRef/nProc` e `indProc` (no XML: 0 SEFAZ, 1 JF, 2 JE, 3 SECEX/RFB, 9 outros).

### 5.2 C112 – Documento de arrecadação referenciado
- Nível 4. Ocorrência 1:N. É obrigatório quando o infCpl identificar um documento de arrecadação.
- **Relevante para a antecipação e a ST paga via DUA/GNRE.**

| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | – | O | "C112" |
| 02 | COD_DA | C | 001* | – | O | 0 = documento estadual (no ES, o **DUA**); 1 = GNRE |
| 03 | UF | C | 002* | – | O | UF beneficiária |
| 04 | NUM_DA | C | – | – | OC | Número do DA |
| 05 | COD_AUT | C | – | – | OC | Autenticação bancária. **Obrigatório se NUM_DA vazio** |
| 06 | VL_DA | N | – | 02 | O | Total do DA (principal, atualização, juros e multa). > 0. Se o DA cobre várias NF, repetir o C112 idêntico, com o valor total, em cada C100 |
| 07 | DT_VCTO | N | 008* | – | O | Vencimento |
| 08 | DT_PGTO | N | 008* | – | O | Pagamento. **Se não foi pago (ex.: ICMS antecipado a recolher), informar o vencimento** |

[XML/Prática]
- A GNRE da ST interestadual paga pelo remetente pode estar citada no infCpl do fornecedor.
- No caso do ES, quando a farmácia recolhe a antecipação por DUA, vincular o DUA ao C100 da entrada, se exigido.

### 5.3 C113 – Documento fiscal referenciado
- Uso: documentos citados no infCpl, **exceto cupons** (esses vão no C114/C116). Exemplos: remessa de venda para entrega futura, **devolução de compra**.
- Nível 4. Ocorrência 1:N.
- Chave para terceiros: IND_EMIT + COD_PART + COD_MOD + SER + NUM_DOC. Chave para própria: IND_EMIT + COD_MOD + SER + NUM_DOC.

| Nº | Campo | Tipo | Tam | Obrig | Regra |
|---|---|---|---|---|---|
| 01 | REG | C | 004 | O | "C113" |
| 02 | IND_OPER | C | 001* | O | 0 = entrada/aquisição; 1 = saída/prestação (do documento referenciado) |
| 03 | IND_EMIT | C | 001* | O | 0 = própria; 1 = terceiros. **IND_EMIT=1 ⇒ IND_OPER=0** |
| 04 | COD_PART | C | 060 | O | Emitente do documento referenciado (0150). Vazio se o referenciado for 65 |
| 05 | COD_MOD | C | 002* | O | Tabela 4.1.1; **≠ 2D, 02, 2E** |
| 06 | SER | C | 004 | OC | |
| 07 | SUB | N | 003 | OC | |
| 08 | NUM_DOC | N | 009 | O | > 0 |
| 09 | DT_DOC | N | 008* | O | ≤ C100.DT_DOC |
| 10 | CHV_DOCe | N | 044* | OC | Chave da NF-e (55), do CT-e (57, desde 2017) ou do CT-e OS (desde 04/2017). O DV é conferido, assim como NUM_DOC e SER |

[XML] `ide/NFref/refNFe`. A chave dá o CNPJ (→ COD_PART), o modelo, a série, o número e o AAMM, mas não o dia: DT_DOC exige buscar o XML referenciado ou o banco local.

### 5.4 C114 – Cupom fiscal referenciado (ECF)
- Uso: nas saídas, cupons ECF citados no infCpl. Nas entradas, só se o emitente do cupom for o próprio informante.
- Nível 4. Ocorrência 1:N. Chave: ECF_FAB + NUM_DOC + DT_DOC.

| Nº | Campo | Tipo | Tam | Obrig | Regra |
|---|---|---|---|---|---|
| 01 | REG | C | 004 | O | "C114" |
| 02 | COD_MOD | C | 002* | O | [02, 2D, 2E] |
| 03 | ECF_FAB | C | 021 | O | Série de fabricação do ECF |
| 04 | ECF_CX | N | 003 | O | > 0 |
| 05 | NUM_DOC | N | 009 | O | COO, > 0 |
| 06 | DT_DOC | N | 008* | O | ≤ C100.DT_DOC |

[XML] `NFref/refECF` (mod, nECF, nCOO). O ES já não usa ECF, então é legado.

### 5.5 C115 – Local de coleta e entrega (códigos 01, 1B e 04)
- **Não se aplica a NF-e.** Só existe em saídas.
- Nível 4. Ocorrência 1:N.
- Campos:
  - REG.
  - IND_CARGA [0,1,2,3,4,5,9]: rodoviário, ferroviário, rodoferroviário, aquaviário, dutoviário, aéreo, outros.
  - CNPJ_COL (N 014*, OC), IE_COL (C 014), CPF_COL (N 011*) e COD_MUN_COL (N 007*, **sempre preenchido**).
  - CNPJ_ENTG, IE_ENTG, CPF_ENTG e COD_MUN_ENTG (sempre preenchido).
- Validações:
  - Só um entre CPF e CNPJ.
  - DV conferido.
  - IE validada pela UF do município.
  - Município na tabela do IBGE, com 7 dígitos.

### 5.6 C116 – CF-e SAT referenciado
- Uso: CF-e (59) citado no infCpl. Nas saídas; nas entradas, só se o emitente for o informante. Relaciona-se com C800/C860.
- Nível 4. Ocorrência 1:N. Chave: NR_SAT + NUM_CFE + DT_DOC.

| Nº | Campo | Tipo | Tam | Obrig |
|---|---|---|---|---|
| 01 | REG | C | 004 | O |
| 02 | COD_MOD | C | 002 | O ([59]) |
| 03 | NR_SAT | N | 009 | O |
| 04 | CHV_CFE | N | 044 | O (DV, CNPJ = 0000, NUM_CFE, AAMM e UF conferidos) |
| 05 | NUM_CFE | N | 006 | O |
| 06 | DT_DOC | N | 008 | O |

[XML] `NFref/refECF` com mod 59, ou chave no infCpl. O ES não usa SAT, então não se aplica.

---

## 6. REGISTRO C120 – Complemento de importação (códigos 01 e 55)

- Uso: só nas entradas (IND_OPER=0). **Não apresentar nas saídas.**
- Nível 3. Ocorrência 1:N. A combinação NUM_DOC_IMP + NUM_ACDRAW é única.

| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra e XML |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | – | O | "C120" |
| 02 | COD_DOC_IMP | C | 001* | – | O | 0 = DI; 1 = DSI; 2 = **DUIMP** [0,1,2] |
| 03 | NUM_DOC_IMP | C | 015 | – | O | `det/prod/DI/nDI` |
| 04 | PIS_IMP | N | – | 02 | OC | `||` se entrega EFD-Contribuições |
| 05 | COFINS_IMP | N | – | 02 | OC | Idem |
| 06 | NUM_ACDRAW | C | 020 | – | OC | `DI/adi/nDraw` |

---

## 7. REGISTRO C130 – ISSQN, IRRF e Previdência (NF conjugada)

- Uso: só nas saídas. Nível 3. Ocorrência 1:1.
- Campos: REG; VL_SERV_NT (O); VL_BC_ISSQN (O); VL_ISSQN (OC); VL_BC_IRRF; VL_IRRF; VL_BC_PREV; VL_PREV (todos N, 2 decimais).
- [XML] `total/ISSQNtot/vServ`, `vBC`, `vISS` e `retTrib/vBCIRRF`, `vIRRF`, `vBCRetPrev`, `vRetPrev`. Irrelevante para farmácia.

## 8. REGISTRO C140 / C141 – Fatura e vencimentos (código 01)

- **Só para NF modelo 1/1A**, não para NF-e.
- **C140** (nível 3, 1:1):
  - REG; IND_EMIT [0,1]; IND_TIT [00 duplicata, 01 cheque, 02 promissória, 03 recibo, 99 outros, com descrição em DESC_TIT].
  - DESC_TIT (OC); NUM_TIT (O); QTD_PARC (N 002, O) = quantidade de C141; VL_TIT = valor original, sem rateio entre NF.
- **C141** (nível 4, 1:N):
  - REG; NUM_PARC (N 002, único); DT_VCTO (≥ C100.DT_DOC); VL_PARC.

## 9. REGISTRO C160 – Volumes transportados (códigos 01 e 04, exceto combustíveis)

- Só nas saídas. Nível 3. Ocorrência 1:1.
- Campos:
  - REG.
  - COD_PART do transportador (OC; vazio se o transportador for o próprio emitente).
  - VEIC_ID (C 007, OC; placa do veículo tracionado; se houver vários, vão no C110).
  - QTD_VOL (O); PESO_BRT (O, 2 decimais); PESO_LIQ (O); UF_ID (OC).
- Não se aplica a NF-e.

## 10. REGISTRO C165 – Combustíveis (código 01)

- Só nas saídas, para distribuidoras, refinarias e revendedoras. **Postos não apresentam.**
- Nível 3. Ocorrência 1:N. Chave: COD_PART + VEIC_ID.
- Campos: REG, COD_PART (OC), VEIC_ID (O), COD_AUT, NR_PASSE, HORA (N 006*, hhmmss, O), TEMPER (1 decimal), QTD_VOL, PESO_BRT, PESO_LIQ, NOM_MOT, CPF (DV conferido), UF_ID.
- Não se aplica.

---

## 11. REGISTRO C170 – Itens do documento (códigos 01, 1B, 04 e 55)

- **Obrigatório** para discriminar os itens, **inclusive nas entradas com NF-e de terceiros.**
- **NFC-e (65) não tem C170.**
- **NF-e de saída própria:** não gerar C170, salvo se houver C176, C180, C181 ou C177 (Exc. 2/6/10).
- "Item" inclui NF complementar, de ressarcimento, de transferência de crédito etc.
- Nível 3. Ocorrência 1:N. NUM_ITEM é único no documento.
- **Entradas:** BC, alíquota e imposto só se houver direito a crédito.

### 11.1 Campos

| Nº | Campo | Tipo | Tam | Dec | Entr | Saída | Regra e XML (`det[@nItem]`) |
|---|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | – | O | O | "C170" |
| 02 | NUM_ITEM | N | 003 | – | O | O | Mesmo número do item no documento: `det/@nItem` |
| 03 | COD_ITEM | C | 060 | – | O | O | Código do **0200 do informante**, não o código do fornecedor (`prod/cProd`). **É preciso uma tabela de-para** (fornecedor + cProd → cod. interno; fallback por GTIN `cEAN`) |
| 04 | DESCR_COMPL | C | – | – | OC | OC | Descrição complementar. [XML] `prod/xProd` ou `infAdProd` |
| 05 | QTD | N | – | 05 | O | O | `prod/qCom`. > 0, exceto COD_SIT 06/07 (≥ 0) |
| 06 | UNID | C | 006 | – | O | O | Unidade **de comercialização do documento** (`prod/uCom`). Tem que existir no 0190. Se for diferente da unidade de estoque do 0200, **0220 obrigatório** para o item (exceto TIPO_ITEM=07, uso e consumo) |
| 07 | VL_ITEM | N | – | 02 | O | O | `prod/vProd` (qtd × preço). **Entrada sem crédito: + vST + vFCPST + vIPI** (Resposta 3). Σ VL_ITEM = C100.VL_MERC |
| 08 | VL_DESC | N | – | 02 | OC | OC | `prod/vDesc` (desconto incondicional) |
| 09 | IND_MOV | C | 001* | – | O | O | 0 = há movimentação física; 1 = não há (complementar, simples faturamento, remessa simbólica). [Prática] CFOP 1.922/5.922, complementar, etc. → 1 |
| 10 | CST_ICMS | N | 003* | – | O | O | Origem (Tabela A) + tributação (Tabela B), **no enfoque do declarante**. Ver §11.3 |
| 11 | CFOP | N | 004* | – | O | O | Na entrada: CFOP da **destinação** do item (converter o do emitente). Ver §11.4 |
| 12 | COD_NAT | C | 010 | – | OC | OC | Código do 0400. [XML] `ide/natOp` → código interno |
| 13 | VL_BC_ICMS | N | – | 02 | OC | OC | `imposto/ICMS/*/vBC` (só se houver crédito na entrada) |
| 14 | ALIQ_ICMS | N | 006 | 02 | OC | OC | `pICMS` |
| 15 | VL_ICMS | N | – | 02 | OC | OC | `vICMS`. [Prática] Somar `vFCP` para fechar com C190.VL_ICMS, que "inclui FCP" |
| 16 | VL_BC_ICMS_ST | N | – | 02 | OC | OC | `vBCST` (só se houver crédito ou débito de ST) |
| 17 | ALIQ_ST | N | – | 02 | OC | OC | `pICMSST` (alíquota interna do destino) |
| 18 | VL_ICMS_ST | N | – | 02 | OC | OC | `vICMSST` (+ `vFCPST`, para bater com o C190) |
| 19 | IND_APUR | C | 001* | – | OC | OC | IPI: 0 = mensal; 1 = decendial |
| 20 | CST_IPI | C | 002* | – | OC | OC | **Só se o declarante for contribuinte do IPI.** A farmácia varejista não é, então fica vazio |
| 21 | COD_ENQ | C | 003* | – | OC | OC | **Não preencher** [Guia] |
| 22 | VL_BC_IPI | N | – | 02 | OC | OC | Inclui frete e despesas rateados |
| 23 | ALIQ_IPI | N | 006 | 02 | OC | OC | Alíquota da TIPI. Vazio se o IPI for por unidade (ver C178) |
| 24 | VL_IPI | N | – | 02 | OC | OC | Totalizado no C190 por CST + CFOP + ALIQ e comparado com o C100 |
| 25 | CST_PIS | N | 002* | – | OC | OC | `||` se entrega EFD-Contribuições (campos 25–36) |
| 26 | VL_BC_PIS | N | – | 02 | OC | OC | idem |
| 27 | ALIQ_PIS (%) | N | 008 | 04 | OC | OC | idem |
| 28 | QUANT_BC_PIS | N | – | 03 | OC | OC | idem |
| 29 | ALIQ_PIS (R$) | N | – | 04 | OC | OC | idem |
| 30 | VL_PIS | N | – | 02 | OC | OC | idem |
| 31 | CST_COFINS | N | 002* | – | OC | OC | idem |
| 32 | VL_BC_COFINS | N | – | 02 | OC | OC | idem |
| 33 | ALIQ_COFINS (%) | N | 008 | 04 | OC | OC | idem |
| 34 | QUANT_BC_COFINS | N | – | 03 | OC | OC | idem |
| 35 | ALIQ_COFINS (R$) | N | – | 04 | OC | OC | idem |
| 36 | VL_COFINS | N | – | 02 | OC | OC | idem |
| 37 | COD_CTA | C | – | – | OC | OC | Conta contábil analítica (a sintética é aceita) |
| 38 | VL_ABAT_NT | N | – | 02 | OC | OC | Σ = C100.VL_ABAT_NT |

As tabelas de CST PIS/COFINS da IN RFB 1009/2010 estão no Guia: 01–09 e 49 para saídas; 50–56, 60–67, 70–75, 98 e 99 para entradas. São irrelevantes quando a empresa entrega a EFD-Contribuições.

A tabela CST IPI (IN RFB 932/2009 e 1009/2010) tem os códigos 00–05 e 49 para entradas e 50–55 e 99 para saídas.

### 11.2 Validações do C170 [Guia]

- COD_ITEM tem que existir no 0200. UNID tem que existir no 0190 e, se precisar, no 0220.
- **CFOP versus IND_OPER:**
  - IND_OPER=0 ⇒ o CFOP começa com 1, 2 ou 3.
  - IND_OPER=1 ⇒ o CFOP começa com 5, 6 ou 7.
  - **O primeiro dígito é o mesmo em todos os itens do documento.**
- COD_NAT tem que existir no 0400.
- **Regras de CST aplicadas só às SAÍDAS:**
  - ICMS normal: se os dois últimos dígitos do CST forem 30, 40, 41, 50 ou 60 ⇒ VL_BC_ICMS, ALIQ_ICMS e VL_ICMS = 0.
  - ICMS normal: nos demais CST ⇒ esses campos > 0, **exceto** 20, 51 e 90, que aceitam ≥ 0.
  - ICMS-ST: CST 10, 30 ou 70 ⇒ VL_BC_ST, ALIQ_ST e VL_ICMS_ST ≥ 0.
  - ICMS-ST: nos demais CST ⇒ os campos de ST = 0.
  - ALIQ_ICMS: na saída com CST 00, 10, 20 ou 70 ⇒ > 0.
- Como a saída própria de NF-e normalmente não gera C170, essas regras também devem ser aplicadas, pelo validador interno, à agregação do C190 das saídas.

### 11.3 CST_ICMS na entrada – conversão (enfoque do adquirente)

[Guia]:
- Exemplo 1: aquisição tributada para uso e consumo → **x90**.
- Exemplo 2: aquisição para comercialização com ICMS retido por ST → **x60**.
- Fornecedor do **Simples Nacional**: informar o **CST do Convênio S/N/70**, nunca o CSOSN.
- Informante do Simples: nas saídas usa CSOSN (Tabela B do CSOSN); nas entradas, o CST no enfoque do declarante.

O 1º dígito é a origem (`ICMS*/orig`) e se mantém.

Sugestão de de-para para o varejo farmacêutico no ES [Prática]. Deve ser configurável por produto, NCM e CFOP.

| XML do fornecedor (`CST` ou `CSOSN`) | Destinação | CST na EFD (2 últimos dígitos) | Crédito? |
|---|---|---|---|
| CST 00/20 (tributado) | revenda de item tributado | 00 / 20 (mantém) | sim: BC, alíquota e ICMS do XML |
| CST 10/30/70 (substituto reteve ST) | revenda de item ST | **60** | não: ST e IPI vão para VL_ITEM; campos de ICMS vazios ou 0 |
| CST 60 (ST cobrada anteriormente) | revenda | **60** | não |
| CST 40/41/50 | revenda | 40 / 41 / 50 | não |
| CST 51 | revenda | 51 (ou 90, conforme orientação) | conforme o destaque |
| CST 90 | revenda | 90 | conforme o destaque |
| CSOSN 101 (com permissão de crédito, `pCredSN`/`vCredICMSSN`) | revenda de item tributado | 90 (ou 00, conforme orientação do contador) | sim, com o valor de `vCredICMSSN` e alíquota `pCredSN` |
| CSOSN 102/103/300/400 | revenda de item tributado | 90 (ou 41/40) | não |
| CSOSN 201/202/203 (Simples substituto) | revenda de item ST | **60** | não |
| CSOSN 500 (ST cobrada anteriormente) | revenda | **60** | não |
| CSOSN 900 | revenda | 90 | conforme o destaque |
| qualquer | uso e consumo / ativo | **90** | não (ativo: CIAP, fora deste trecho) |
| qualquer (produto ST no ES, compra interestadual **sem retenção**, sujeita a antecipação pelo adquirente) | revenda | **60** na entrada (a ST é recolhida pela farmácia via DUA ou apuração) | ver §16.2 |

### 11.4 CFOP na entrada – conversão [Prática]

A regra do Guia é usar o CFOP da destinação do item. Mapeamento típico:
- 5.102/6.102 → 1.102/2.102 (compra para comercialização).
- 5.405, 5.403, 5.401, 6.403, 6.404 e 6.401 → **1.403/2.403** (compra para comercialização com ST).
- 5.102 ou 6.102 de item ST sem retenção → 1.403/2.403, se o item for ST no ES.
- Item de uso e consumo → 1.556/2.556, ou 1.407/2.407 se o item tiver ST.
- Ativo → 1.551/2.551, ou 1.406/2.406 se o item tiver ST.
- 5.910/6.910 (bonificação) → 1.910/2.910.
- 5.202/6.202 ou 5.411/6.411 (devolução de compra, vista do lado do fornecedor que recebeu) → não se aplica.
- Devolução de venda pelo cliente contribuinte: o CFOP dele é 5.202/5.411, e na farmácia entra como 1.202/**1.411** (devolução de venda de mercadoria com ST).
- 5.949/6.949 → 1.949/2.949.
- 5.152/5.409 (transferência) → 1.152/**1.409**.

Regra de ouro:
- Emitente na mesma UF (`emit/enderEmit/UF` = UF do 0000) → prefixo 1.
- Emitente em outra UF → prefixo 2.
- Exterior → prefixo 3.

O primeiro dígito deve ser único por documento.

### 11.5 Entrada com ST – efeito no valor

- **Com crédito** (raro no varejo; ex.: substituído com direito a crédito da ST em devolução, ou CST 10 em que o informante é o substituto): informar VL_BC_ICMS_ST, ALIQ_ST e VL_ICMS_ST.
- **Sem crédito** (padrão da farmácia): VL_ITEM = vProd + vST + vFCPST + vIPI.
  - Descontos: o C170 tem VL_DESC separado. No C190 o VL_OPR subtrai o desconto.
  - Os campos de ST ficam vazios ou 0.
  - O C190 da entrada terá VL_ICMS_ST = 0, mas o **VL_OPR inclui a ST** (ver §17).

---

## 12. C171 – Armazenamento de combustíveis (01, 55)

- Uso: só nas entradas do comércio varejista de combustíveis (LMC).
- Nível 4. Ocorrência 1:N. NUM_TANQUE é único.
- Campos: REG, NUM_TANQUE (C 003), QTDE (N, 3 decimais, > 0).
- Não se aplica.

## 13. C172 – Operações com ISSQN (código 01)

- Só nas saídas. Nível 4. Ocorrência 1:1.
- Campos: REG, VL_BC_ISSQN, ALIQ_ISSQN (006, 2 decimais), VL_ISSQN (todos O).
- Não se aplica a NF-e.

## 14. C173 – Operações com medicamentos (01 e 55) – importante para o contexto

- Uso: empresas do segmento farmacêutico (distribuidoras, indústrias, revendedoras e importadoras), **EXCETO COMÉRCIO VAREJISTA** [Guia].
- Base legal: Conv. S/N/70, art. 19 §26 (NCM 3002, 3003, 3004 e 3006.60, exceto veterinário, homeopático e amostra grátis; PMC tabelado ou sugerido na NF).
- **NF-e emitida por terceiros:** obrigatório, **desde que não seja destinada a comércio varejista.**
- **Conclusão para farmácia varejista:** não gerar C173 nem na entrada nem na saída. Gerar apenas se o cliente for distribuidora ou atacado farmacêutico.
- Nível 4 (filho do C170). Ocorrência 1:N. Chave por C170: LOTE_MED + QTD_ITEM.

| Nº | Campo | Tipo | Tam | Dec | Obrig | XML |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | – | O | "C173" |
| 02 | LOTE_MED | C | – | – | O | `prod/rastro/nLote` |
| 03 | QTD_ITEM | N | – | 003 | O | `rastro/qLote` |
| 04 | DT_FAB | N | 008* | – | O | `rastro/dFab` |
| 05 | DT_VAL | N | 008* | – | O | `rastro/dVal` |
| 06 | IND_MED | C | 001* | – | O | 0 = preço tabelado ou máximo sugerido; 1 = MVA; 2 = lista negativa; 3 = lista positiva; 4 = lista neutra |
| 07 | TP_PROD | C | 1* | – | O | 0 = similar; 1 = genérico; 2 = ético/de marca (medicamento de referência) |
| 08 | VL_TAB_MAX | N | – | 02 | O | `prod/med/vPMC` (> 0) |

## 15. C174 (armas de fogo, 01, só saída), C175 (veículos novos, 01 e 55) – não se aplicam

- **C174**: REG; IND_ARM [0 permitido, 1 restrito]; NUM_ARM (único); DESCR_COMPL.
- **C175**:
  - Campos: REG; IND_VEIC_OPER [0 venda para concessionária, 1 faturamento direto (Conv. 51/2000), 2 venda direta, 3 venda da concessionária, 9 outros]; CNPJ (obrigatório se IND=1, DV conferido); UF; CHASSI_VEIC (C 017, único).
  - Informado nas entradas e saídas, exceto por emissores de NF-e e na exportação.

---

## 16. REGISTRO C176 – Ressarcimento de ICMS e FCP em operações com ST (01, 55)

- Uso: quando o documento escriturado **desfaz a ST** de operações anteriores. Os casos típicos são a **saída para outra UF** de mercadoria recebida com ST, a saída isenta, a perda, o furto, a exportação e a venda interna para o Simples.
- O documento informado no C176 é o da **última aquisição** (e da retenção), que é **diferente** do documento pai. Se a legislação mandar usar outra aquisição, usar a indicada.
- Obrigatoriedade e campos opcionais (CHAVE_NFE_RET, COD_PART_NFE_RET, SER_NFE_RET, NUM_NFE_RET, ITEM_NFE_RET, COD_MOT_RES e VL_UNIT_RES_FCP_ST) são **definidos pela UF**.
- Não se aplica a quem usa SCANC.
- Só nas saídas. Nível 4 (filho do C170). Ocorrência 1:N.
- Os campos 10–26 valem desde 01/01/2017 e o campo 27 desde 01/01/2019.
- Na NF-e própria, gerar C170 **só** para os itens com C176 (Exc. 6).

| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | – | O | "C176" |
| 02 | COD_MOD_ULT_E | C | 002* | – | O | [01, 55] |
| 03 | NUM_DOC_ULT_E | N | 009 | – | O | > 0 |
| 04 | SER_ULT_E | C | 003 | – | OC | |
| 05 | DT_ULT_E | N | 008* | – | O | ≤ C100.DT_DOC |
| 06 | COD_PART_ULT_E | C | 060 | – | O | Emitente da última entrada, que tem que estar no 0150 |
| 07 | QUANT_ULT_E | N | – | 03 | O | > 0 |
| 08 | VL_UNIT_ULT_E | N | – | 03 | O | Unitário da última entrada, **incluindo despesas acessórias**. > 0 |
| 09 | VL_UNIT_BC_ST | N | – | 03 | O | BC-ST unitária. > 0. [XML da entrada] `vBCST/qCom` ou `vBCSTRet/qCom` |
| 10 | CHAVE_NFE_ULT_E | N | 044* | – | OC | Obrigatório se o mod. for 55. DV conferido; CNPJ base contra o 0150 do participante; número, série e UF conferidos |
| 11 | NUM_ITEM_ULT_E | N | 003 | – | OC | > 0 |
| 12 | VL_UNIT_BC_ICMS_ULT_E | N | – | 02 | O | Se o emitente é o substituto: BC unitária destacada; se ele é do Simples, a BC "como se fosse regime normal". Se o emitente é o substituído: a BC da operação própria que ele teria no regime normal |
| 13 | ALIQ_ICMS_ULT_E | N | – | 02 | O | Alíquota da operação própria da entrada |
| 14 | VL_UNIT_LIMITE_BC_ICMS_ULT_E | N | – | 02 | O | **= min(VL_UNIT_BC_ST, VL_UNIT_BC_ICMS_ULT_E)** (validado quando COD_RESP_RET=2) |
| 15 | VL_UNIT_ICMS_ULT_E | N | – | 03 | O | **= ALIQ_ICMS_ULT_E × VL_UNIT_LIMITE_BC_ICMS_ULT_E**. É o crédito da operação própria do remetente, limitado ao valor da retenção |
| 16 | ALIQ_ST_ULT_E | N | – | 02 | OC | Alíquota interna da ST. > 0 |
| 17 | VL_UNIT_RES | N | – | 03 | OC | **= VL_UNIT_BC_ST × ALIQ_ST_ULT_E − VL_UNIT_ICMS_ULT_E** (≥ 0) |
| 18 | COD_RESP_RET | N | 001* | – | OC | 1 = remetente direto (regime comum); 2 = remetente indireto; 3 = próprio declarante; 4 = remetente direto do Simples. Validação literal: [1,2,3] |
| 19 | COD_MOT_RES | N | 001* | – | OC | 1 = saída para outra UF; 2 = isenção ou não incidência; 3 = perda ou deterioração; 4 = furto ou roubo; 5 = exportação; 6 = venda interna para o Simples; 9 = outros |
| 20 | CHAVE_NFE_RET | N | 044* | – | OC | NF-e do substituto em que houve a retenção, **se for diferente da última entrada**. Só com COD_RESP_RET=2. DV conferido |
| 21 | COD_PART_NFE_RET | C | 060 | – | OC | Só se não houver chave. Não informar junto com CHAVE_NFE_RET. Só com COD_RESP_RET=2 |
| 22 | SER_NFE_RET | C | 003 | – | OC | Não informar se houver chave; obrigatório se houver COD_PART_NFE_RET |
| 23 | NUM_NFE_RET | N | 009 | – | OC | Idem |
| 24 | ITEM_NFE_RET | N | 003 | – | OC | Obrigatório se houver CHAVE_NFE_RET ou COD_PART_NFE_RET |
| 25 | COD_DA | C | 001* | – | OC | 0 = estadual; 1 = GNRE |
| 26 | NUM_DA | C | – | – | OC | |
| 27 | VL_UNIT_RES_FCP_ST | N | – | 03 | OC | FCP-ST unitário a ressarcir |

Implementação: exige o **histórico de entradas por item** (último XML de compra antes da saída, com FIFO e quantidade) e a leitura de `vBCST`/`vICMSST` ou `vBCSTRet`/`vICMSSTRet`/`vICMSSubstituto`.
- Fornecedor com CST 60 ou CSOSN 500: o substituto é indireto (COD_RESP_RET=2) e os dados da retenção vêm de `vBCSTRet`, `pST`, `vICMSSubstituto` e `vICMSSTRet`.
- **ES** [Fora do trecho]: confirmar na SEFAZ-ES se o estado exige o C176 ou o modelo novo (C180/C185/C181/C186, Tabela 5.7). A regra é por UF.

### 16.1 C177 – dois leiautes

- **Até 31/12/2018** (selo de controle do IPI): só nas saídas de fabricante ou importador. Campos: REG, COD_SELO_IPI (C 006*, Tabela 4.5.2), QT_SELO_IPI (N 012). Nível 4, 1:1.
- **A partir de 01/01/2019** (complemento de item, outras informações): obrigatório só por legislação da UF. Campos: REG, COD_INF_ITEM (C 008*, Tabela 5.6 da UF). Nível 4, 1:1. Entradas e saídas. Obriga a gerar C170 mesmo na NF-e própria (Exc. 10).

### 16.2 C178 e C179

- **C178** (IPI por unidade ou quantidade): só nas saídas. Nível 4, 1:1. Campos: REG, CL_ENQ (C 005, Tabela 4.5.1), VL_UNID (2 decimais), QUANT_PAD (3 decimais). Não se aplica.
- **C179** (informações complementares de ST, código 01): só nas saídas. Nível 4, 1:1. Campos:
  - REG.
  - BC_ST_ORIG_DEST (O): BC-ST na origem ou destino em operação interestadual.
  - ICMS_ST_REP (O): ST a repassar ou deduzir.
  - ICMS_ST_COMPL (OC): ST a complementar à UF de destino.
  - BC_RET (OC) e ICMS_RET (OC): remessa por substituído intermediário.
  - **Só NF modelo 1**; na NF-e esses dados não têm registro aqui.

---

## 17. REGISTRO C180 – Informações complementares das ENTRADAS de mercadorias sujeitas a ST (01, 1B, 04 e 55)

- Faz parte do leiaute "novo" de ressarcimento, restituição e complemento de ST. Obrigatoriedade e forma são **da UF**.
- O pai tem IND_OPER=0. **Não pode coexistir com C181** no mesmo item.
- Só nas entradas. Nível 4 (filho do C170). Ocorrência 1:1.
- Como exige C170, na NF-e de terceiros ele já existe.

| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | – | O | "C180" |
| 02 | COD_RESP_RET | N | 001* | – | O | 1 = remetente direto; 2 = remetente indireto; 3 = próprio declarante [1,2,3] |
| 03 | QUANT_CONV | N | – | 06 | O | Quantidade convertida para a unidade de estoque (0200) ou de comercialização, a critério da UF. > 0 |
| 04 | UNID | C | 006 | – | O | Unidade do controle de ressarcimento (pode diferir do C170.UNID). Tem que estar no 0190; se for diferente da unidade do 0200 → 0220 |
| 05 | VL_UNIT_CONV | N | – | 06 | O | Unitário **líquido** (descontos e acréscimos incondicionais), **sem** a ST quando o fornecedor é substituto ou o informante é responsável |
| 06 | VL_UNIT_ICMS_OP_CONV | N | – | 06 | O | ICMS da operação própria que o informante teria de crédito no regime comum = **min(campo 05, campo 07)** × (redução de BC da ST, se houver) × alíquota da operação (interna ou interestadual). **Não é o `vICMSSubstituto` (N26b)** quando a nota vem com CST 60 ou CSOSN 500 |
| 07 | VL_UNIT_BC_ICMS_ST_CONV | N | – | 06 | O | BC-ST unitária paga ou retida (com redução, se houver) |
| 08 | VL_UNIT_ICMS_ST_CONV | N | – | 06 | O | **= campo 07 × alíquota interna (com FCP) − campo 06**. É a ST limitada ao fato gerador presumido não realizado |
| 09 | VL_UNIT_FCP_ST_CONV | N | – | 06 | OC | Parcela de FCP-ST contida no campo 08 |
| 10 | COD_DA | C | 001* | – | OC | 0 = estadual; 1 = GNRE |
| 11 | NUM_DA | C | – | – | OC | |

[XML] 05 = (vProd − vDesc + vFrete + vSeg + vOutro)/qCom na unidade convertida; 07 = vBCST ou vBCSTRet por unidade; o FCP vem de pFCPST/vFCPST ou vFCPSTRet.
- Quando o fornecedor informa CST 60 **sem** vBCSTRet (é comum), a BC tem de vir de pauta, MVA ou PMC calculada pelo sistema.

## 18. REGISTRO C181 – DEVOLUÇÃO DE SAÍDAS de mercadorias sujeitas a ST (01, 1B, 04 e 55)

- Uso: entrada (IND_OPER=0) que é devolução de uma venda. A UF define a obrigatoriedade. **Não pode coexistir com C180.**
- Só nas entradas. Nível 4. Ocorrência 1:N.
- Chave dentro do mesmo C170:
  - Eletrônicos (55, 59, 60, 65): CHV_DFE_SAIDA + NUM_ITEM_SAIDA.
  - Papel 01/1B/04: COD_MOD_SAIDA + SERIE + NUM_DOC + DT_DOC + NUM_ITEM.
  - 02/2D: COD_MOD + ECF_FAB + NUM_DOC + DT_DOC + NUM_ITEM.

| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | – | O | "C181" |
| 02 | COD_MOT_REST_COMPL | C | 005* | – | O | Tabela 5.7 da UF, com **3º caractere 5, 6, 7 ou 8** |
| 03 | QUANT_CONV | N | – | 06 | O | > 0 |
| 04 | UNID | C | 006 | – | O | 0190/0220, como no C180 |
| 05 | COD_MOD_SAIDA | C | 002* | – | O | [01, 1B, 02, 2D, 04, 55, 59, 60, 65] |
| 06 | SERIE_SAIDA | C | 003 | – | OC | Só se o COD_MOD_SAIDA for 01, 1B ou 04 |
| 07 | ECF_FAB_SAIDA | C | 021 | – | OC | Só se for 02 ou 2D |
| 08 | NUM_DOC_SAIDA | N | 009 | – | OC | Só se for 01, 1B, 02, 2D ou 04 |
| 09 | CHV_DFE_SAIDA | N | 044* | – | OC | Obrigatório se for 55, 59, 60 ou 65 (**inclusive a NFC-e devolvida**) |
| 10 | DT_DOC_SAIDA | N | 008* | – | O | ≤ DT_FIN |
| 11 | NUM_ITEM_SAIDA | N | 003 | – | OC | Item da saída no C185, C380, C480 ou C815 |
| 12 | VL_UNIT_CONV_SAIDA | N | – | 06 | OC | Valor do VL_UNIT_CONV na saída (conforme a UF) |
| 13 | VL_UNIT_ICMS_OP_ESTOQUE_CONV_SAIDA | N | – | 06 | OC | |
| 14 | VL_UNIT_ICMS_ST_ESTOQUE_CONV_SAIDA | N | – | 06 | OC | Inclui FCP-ST |
| 15 | VL_UNIT_FCP_ICMS_ST_ESTOQUE_CONV_SAIDA | N | – | 06 | OC | |
| 16 | VL_UNIT_ICMS_NA_OPERACAO_CONV_SAIDA | N | – | 06 | OC | |
| 17 | VL_UNIT_ICMS_OP_CONV_SAIDA | N | – | 06 | OC | Facultativo se a UF igualar ao campo 13 |
| 18 | VL_UNIT_ICMS_ST_CONV_REST | N | – | 06 | OC | Estorno do complemento = **16 − 13 − 14** |
| 19 | VL_UNIT_FCP_ST_CONV_REST | N | – | 06 | OC | |
| 20 | VL_UNIT_ICMS_ST_CONV_COMPL | N | – | 06 | OC | Estorno do ressarcimento: (a.1) **13 + 14 − 17**; (a.2) = 14, se o 17 não for obrigatório; (b) saída abaixo da BC-ST: **13 + 14 − 16** |
| 21 | VL_UNIT_FCP_ST_CONV_COMPL | N | – | 06 | OC | |

Matriz de preenchimento por 3º caractere do COD_MOT_REST_COMPL [Guia]:

| 3º caractere | Preencher | Não preencher |
|---|---|---|
| 5 | 13, 14, 15 | 16–21 |
| 6 | 13, 14, 15, 16, 20, 21 | 17, 18, 19 |
| 7 | 13, 14, 15, 17, 20, 21 | 18, 19 |
| 8 | 13, 14, 15, 16, 18, 19 | 17, 20, 21 |

## 19. REGISTRO C185 – Informações complementares das SAÍDAS com ST (01, 1B, 04, 55 e **65**)

- Uso: saídas (IND_OPER=1), **inclusive NFC-e**. Obrigatoriedade da UF. **Não pode coexistir com C186.**
- **Nível 3 (filho direto do C100, não do C170)**, por isso não obriga a gerar C170 na NF-e ou NFC-e própria. Ocorrência 1:N.
- Só nas saídas. NUM_ITEM **não precisa ser sequencial**: só os itens controlados (ST) entram.

| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra e XML |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | – | O | "C185" |
| 02 | NUM_ITEM | N | 003 | – | O | `det/@nItem` |
| 03 | COD_ITEM | C | 060 | – | O | 0200; o item tem que constar do documento |
| 04 | CST_ICMS | N | 003* | – | O | CST **do documento** (na saída é o próprio). Na NFC-e do Simples, o CSOSN? (o campo pede a Tabela 4.3.1; validar) |
| 05 | CFOP | N | 004* | – | O | CFOP do documento, começando com 5, 6 ou 7 e com o mesmo 1º dígito em todos os itens |
| 06 | COD_MOT_REST_COMPL | C | 005* | – | O | Tabela 5.7 da UF, com **3º caractere 0, 1, 2 ou 3** |
| 07 | QUANT_CONV | N | – | 06 | O | > 0, na unidade do 0200 ou de comercialização, conforme a UF |
| 08 | UNID | C | 006 | – | O | 0190; 0220 se for diferente do 0200 |
| 09 | VL_UNIT_CONV | N | – | 06 | O | Unitário líquido de descontos e acréscimos incondicionais |
| 10 | VL_UNIT_ICMS_NA_OPERACAO_CONV | N | – | 06 | OC | Alíquota interna (com FCP, do 0200) × valor da saída como se não houvesse ST (com a mesma redução da ST) |
| 11 | VL_UNIT_ICMS_OP_CONV | N | – | 06 | OC | ICMS da operação própria do substituto ou do remetente (regime comum); facultativo se a UF igualar ao campo 12 |
| 12 | VL_UNIT_ICMS_OP_ESTOQUE_CONV | N | – | 06 | OC | **Média** unitária do ICMS OP do estoque (período definido pela UF: diário, mensal...) |
| 13 | VL_UNIT_ICMS_ST_ESTOQUE_CONV | N | – | 06 | OC | Média unitária da ST + FCP-ST do estoque |
| 14 | VL_UNIT_FCP_ICMS_ST_ESTOQUE_CONV | N | – | 06 | OC | Parcela de FCP contida no campo 13 |
| 15 | VL_UNIT_ICMS_ST_CONV_REST | N | – | 06 | OC | Ressarcimento: (a.1) **12 + 13 − 11**; (a.2) = 13, se o 11 não for obrigatório; (b) saída abaixo da BC-ST: **12 + 13 − 10** |
| 16 | VL_UNIT_FCP_ST_CONV_REST | N | – | 06 | OC | |
| 17 | VL_UNIT_ICMS_ST_CONV_COMPL | N | – | 06 | OC | Complemento = **10 − 12 − 13** |
| 18 | VL_UNIT_FCP_ST_CONV_COMPL | N | – | 06 | OC | |

Matriz por 3º caractere [Guia]:

| 3º caractere | Preencher | Não preencher |
|---|---|---|
| 0 (saída sem ressarcimento nem complemento) | 12, 13, 14 | 10, 11, 15–18 |
| 1 (ressarcimento com saída abaixo da BC-ST) | 10, 12, 13, 14, 15, 16 | 11, 17, 18 |
| 2 (ressarcimento por não ocorrência do fato gerador ou saída interestadual) | 12, 13, 14, 15, 16 (o 11 conforme a UF) | 10, 17, 18 |
| 3 (complemento: saída acima da BC-ST) | 10, 12, 13, 14, 17, 18 | 11, 15, 16 |

Implementação: exige o **custo médio do ICMS OP e ST do estoque por item** (alimentado pelos C180 das entradas). É um motor de estoque fiscal, não só um conversor de XML.

## 20. REGISTRO C186 – DEVOLUÇÃO DE ENTRADAS com ST (01, 1B, 04 e 55)

- Uso: saída (IND_OPER=1) que devolve uma compra. Obrigatoriedade da UF. **Não pode coexistir com C185.**
- Nível 3. Ocorrência 1:N. Só nas saídas.
- Chave: CHV_DFE_ENTRADA + NUM_ITEM_ENTRADA (eletrônico: 55, 59, 65) ou COD_MOD + SERIE + NUM_DOC + DT_DOC + NUM_ITEM (papel).

| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | – | O | "C186" |
| 02 | NUM_ITEM | N | 003 | – | O | Item na NF de saída (devolução) |
| 03 | COD_ITEM | C | 060 | – | O | 0200 |
| 04 | CST_ICMS | N | 003* | – | (em branco na tabela) | CST no documento de saída |
| 05 | CFOP | N | 004* | – | O | CFOP da saída (ex.: 5.411/6.411) |
| 06 | COD_MOT_REST_COMPL | C | 005* | – | O | Tabela 5.7, com **3º caractere 4** |
| 07 | QUANT_CONV | N | – | 06 | O | Quantidade devolvida, > 0 |
| 08 | UNID | C | 006 | – | O | |
| 09 | COD_MOD_ENTRADA | C | 002* | – | O | [01, 1B, 04, 55] |
| 10 | SERIE_ENTRADA | C | 003 | – | OC | Só se o modelo for diferente de 55 |
| 11 | NUM_DOC_ENTRADA | N | 009 | – | OC | Só se o modelo for diferente de 55 |
| 12 | CHV_DFE_ENTRADA | N | 044* | – | OC | Obrigatório se o modelo for 55. [XML] `NFref/refNFe` da devolução |
| 13 | DT_DOC_ENTRADA | N | 008* | – | O | ≤ DT_FIN |
| 14 | NUM_ITEM_ENTRADA | N | 003 | – | O | Item da NF de compra |
| 15 | VL_UNIT_CONV_ENTRADA | N | – | 06 | OC | Valores do C180 da entrada original (conforme a UF) |
| 16 | VL_UNIT_ICMS_OP_CONV_ENTRADA | N | – | 06 | OC | |
| 17 | VL_UNIT_BC_ICMS_ST_CONV_ENTRADA | N | – | 06 | OC | |
| 18 | VL_UNIT_ICMS_ST_CONV_ENTRADA | N | – | 06 | OC | |
| 19 | VL_UNIT_FCP_ST_CONV_ENTRADA | N | – | 06 | OC | |

---

## 21. REGISTRO C190 – Registro analítico do documento (01, 1B, 04, 55 e 65) – CRÍTICO

- Uso: totaliza o documento por **CST_ICMS + CFOP + ALIQ_ICMS**. É o registro que **alimenta a apuração** (E110 e E210).
- Nível 3. Ocorrência 1:N. É **obrigatório** para todo C100 que não seja cancelado, denegado ou inutilizado, **inclusive complementares e NFC-e**.
- Validação: a combinação CST_ICMS + CFOP + ALIQ_ICMS não pode se repetir no documento e **tem que existir nos C170**, quando o C170 for exigido.

| Nº | Campo | Tipo | Tam | Dec | Entr | Saída | Descrição |
|---|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | – | O | O | "C190" |
| 02 | CST_ICMS | N | 003* | – | O | O | Tabela 4.3.1. Nas entradas, o CST convertido (enfoque do declarante) |
| 03 | CFOP | N | 004* | – | O | O | Nas entradas, o CFOP da destinação. **NFC-e: só CFOP 5xxx.** O 1º dígito segue o IND_OPER (0 → 1/2/3; 1 → 5/6/7) |
| 04 | ALIQ_ICMS | N | 006 | 02 | OC | OC | Alíquota do ICMS (pICMS). Vazio ou 0 em CST 40/41/50/60 |
| 05 | VL_OPR | N | – | 02 | O | O | Ver §21.1 |
| 06 | VL_BC_ICMS | N | – | 02 | O | O | Σ C170.VL_BC_ICMS do grupo (ou Σ `vBC` do XML quando não houver C170) |
| 07 | VL_ICMS | N | – | 02 | O | O | ICMS **incluindo o FCP**, quando aplicável (Σ `vICMS + vFCP`) |
| 08 | VL_BC_ICMS_ST | N | – | 02 | O | O | Σ C170.VL_BC_ICMS_ST (Σ `vBCST`) |
| 09 | VL_ICMS_ST | N | – | 02 | O | O | ST creditada ou debitada, **incluindo o FCP-ST** (Σ `vICMSST + vFCPST`) |
| 10 | VL_RED_BC | N | – | 02 | O | O | Valor não tributado por redução de BC |
| 11 | VL_IPI | N | – | 02 | O | O | Σ IPI do grupo |
| 12 | COD_OBS | C | 006 | – | OC | OC | Código do 0460. Só se a legislação da UF determinar |

### 21.1 VL_OPR – composição exata [Guia]

> "Na combinação de CST_ICMS, CFOP e ALIQ_ICMS, informar neste campo o valor das mercadorias somadas aos valores de fretes, seguros e outras despesas acessórias e os valores de ICMS_ST, FCP_ST e IPI (somente quando o IPI está destacado na NF), subtraídos o desconto incondicional e o abatimento não tributado e não comercial. Não devem ser incluídos neste campo os valores relativos a CBS, IBS e IS incidentes na operação."

Fórmula por item do XML, somada por grupo CST + CFOP + ALIQ:

```
VL_OPR(item) = vProd
             + vFrete + vSeg + vOutro          (rateados por item; no XML já vêm por det/prod)
             + vICMSST + vFCPST                 (ICMS-ST e FCP-ST DESTACADOS no documento)
             + vIPI                             (somente IPI destacado; [Prática] + vIPIDevol na devolução)
             - vDesc                            (desconto incondicional)
             - vAbatNT                          (abatimento não tributado/não comercial; ex. vICMSDeson ZFM)
             [NÃO somar vIBS/vCBS/vIS]
```

Observações de implementação:
- **Entradas sem crédito de ST ou IPI:** o VL_OPR **continua incluindo** a ST e o IPI destacados, porque o campo compõe o valor da operação. O que fica zero é VL_ICMS_ST e VL_IPI.
- **CST 60 ou CSOSN 500:** `vBCSTRet`, `vICMSSTRet`, `vICMSSubstituto` e `vFCPSTRet` **não** somam no VL_OPR. Não são destacados nem compõem o vNF. Também **não** vão em VL_BC_ICMS_ST ou VL_ICMS_ST (a regra das saídas exige ST = 0 quando o CST é diferente de 10/30/70). O FCP retido anteriormente vai no **C191.VL_FCP_RET**.
- **Desoneração (`vICMSDeson`):** se `indDeduzDeson=1` (NT 2023.004), o vNF já vem sem a desoneração. Para Σ VL_OPR bater com o VL_DOC, tratar a desoneração deduzida como abatimento (VL_ABAT_NT). [Prática] Verificar.
- **Imposto de importação e outros** (`vII`, IPI em importação etc.) somam no vNF e devem entrar no VL_OPR para fechar com o VL_DOC [Prática].
- **Conferência sugerida (warning):** Σ C190.VL_OPR == C100.VL_DOC. Em 2026 as duas bases excluem IBS/CBS/IS. Diferenças de centavos vêm de arredondamento no rateio.
- **Arredondamento:** somar os valores por item com 2 casas; não recalcular a BC × alíquota no agregado.

### 21.2 Demais validações do C190 [Guia]

- As somas de VL_BC_ICMS, VL_ICMS, VL_BC_ICMS_ST e VL_ICMS_ST têm que ser iguais às dos C170 do grupo, **se os C170 existirem**.
- **VL_RED_BC:** com COD_SIT 00 ou 01 e CST de final **20 ou 70**, o VL_RED_BC tem que ser **> 0**.
  - [Prática] VL_RED_BC = (vProd + vFrete + vSeg + vOutro − vDesc [+ vIPI, se compõe a BC]) − vBC do grupo.
  - Pode-se usar o `pRedBC`: BC cheia × pRedBC/100.
- **Os totais do C100 são as somas dos C190.**
- **Entradas (enfoque do declarante):** para o crédito entrar no E110, basta o VL_ICMS da entrada. O E110.VL_TOT_CREDITOS é Σ VL_ICMS de todos os C190 de entrada (exceto o CFOP 1605 e somado o 5605) [Fora do trecho, E110].

### 21.3 Geração a partir do XML (algoritmo)

1. Para cada `det`, determinar a chave (CST_efd, CFOP_efd, ALIQ):
   - Saída própria (55/65): CST = `orig` + `CST`. No Simples, usar o CSOSN (`orig` + `CSOSN`). CFOP = `prod/CFOP`. ALIQ = `pICMS` (0 ou vazio quando não houver).
   - Entrada: CST e CFOP convertidos (§11.3/§11.4). ALIQ = `pICMS` **se houver crédito**; senão 0 ou vazio.
2. Acumular os campos:
   - VL_OPR conforme §21.1.
   - VL_BC_ICMS (vBC se tiver crédito ou débito).
   - VL_ICMS (vICMS + vFCP).
   - VL_BC_ICMS_ST (vBCST).
   - VL_ICMS_ST (vICMSST + vFCPST).
   - VL_RED_BC.
   - VL_IPI.
3. Nas entradas sem crédito, zerar BC, ICMS, BC-ST, ST e IPI (mantendo o VL_OPR).
4. Nas saídas, aplicar as regras de CST do §11.2:
   - CST 60 → BC, ICMS, BC-ST e ST = 0.
   - CST 00 → BC, ALIQ e ICMS > 0.
   - CST 20/70 → VL_RED_BC > 0.
5. Gerar o C191 se houver FCP.
6. Totalizar o C100.

---

## 22. REGISTRO C191 – FCP na NF-e (55) e na NFC-e (65)

- Uso: informativo. **Não entra na apuração do Bloco E.** A obrigatoriedade é da UF.
- Não se aplica aos valores de FCP já informados no C101 (EC 87/15).
- Nível 4 (filho do C190). Ocorrência 1:1.

| Nº | Campo | Tipo | Dec | Obrig | Regra e XML |
|---|---|---|---|---|---|
| 1 | REG | C | – | O | "C191" |
| 2 | VL_FCP_OP | N | 02 | OC | Σ `vFCP` do grupo. **Só com CST x00, x10, x20, x51, x70 ou x90** |
| 3 | VL_FCP_ST | N | 02 | OC | Σ `vFCPST`. **Só com CST x10, x30, x70, x90 ou CSOSN 201, 202, 203 ou 900** |
| 4 | VL_FCP_RET | N | 02 | OC | Σ `vFCPSTRet`. **Só com CST x60 ou CSOSN 500**. É o caso típico da farmácia que revende item com ST |

---

## 23. REGISTRO C195 – Observações do lançamento fiscal (01, 1B, 04, 55 e 65)

- Uso: quando a legislação estadual prevê ajuste no documento (DIFAL, antecipação, benefício, estorno etc.). Equivale à coluna "Observações" dos livros fiscais.
- **Situação especial [Guia]: o ES (junto com PA e AM) exige outras apurações.** Nesses estados o C195 também é gerado para as sub-apurações.
- Nível 3. Ocorrência 1:N. É o pai do C197.

| Nº | Campo | Tipo | Tam | Obrig | Regra |
|---|---|---|---|---|---|
| 01 | REG | C | 004 | O | "C195" |
| 02 | COD_OBS | C | 006 | O | Código do **0460**. Usar este campo, e não o C190.COD_OBS, salvo quando a UF mandar usar o C190 |
| 03 | TXT_COMPL | C | – | OC | Complemento, quando o código for genérico |

Não é preciso informar os dados adicionais da NF que não interferem na apuração.

## 24. REGISTRO C197 – Outras obrigações tributárias, ajustes e informações de valores do documento

- Uso: detalha os ajustes do C195. Pode ou não alterar o imposto.
  - Os valores de ICMS vão para o **E110** (VL_AJ_DEBITOS ou VL_AJ_CREDITOS).
  - Os de ST vão para o **E210** (VL_AJ_CREDITOS_ST ou VL_AJ_DEBITOS_ST).
  - O destino depende do **3º caractere** do COD_AJ (Tabela 5.3).
- Também serve à **sub-apuração** (registro 1900): o 4º caractere de 3 a 8 indica a apuração em separado.
- **Só informar se a UF publicou a Tabela 5.3.**
- Nível 4. Ocorrência 1:N.

| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | – | O | "C197" |
| 02 | COD_AJ | C | 010* | – | O | Código da Tabela 5.3 da UF do informante (validado contra a tabela) |
| 03 | DESCR_COMPL_AJ | C | – | – | OC | **Obrigatório de fato quando o código for genérico** |
| 04 | COD_ITEM | C | 060 | – | OC | Quando o ajuste é do produto. **Mesmo sem C170 (NF-e própria), o item tem que estar no 0200** |
| 05 | VL_BC_ICMS | N | – | 02 | OC | BC do ICMS ou do ICMS-ST |
| 06 | ALIQ_ICMS | N | 006 | 02 | OC | |
| 07 | VL_ICMS | N | – | 02 | OC | Valor do ajuste. **Em ajuste de ST, é o valor da ST.** Somado na apuração quando não é informativo |
| 08 | VL_OUTROS | N | – | 02 | OC | Outros valores, quando o código é informativo |

### 24.1 Estrutura do COD_AJ (Tabela 5.3) e destino na apuração

O formato é `UF(2) + 3º caractere (tipo de ajuste) + 4º caractere (tipo de apuração) + sequencial(4)`. A estrutura foi deduzida das regras do E110 e do E210 no Guia (linhas ~13770–14320) e do texto do C197.

| 3º caractere | Efeito | 4º = 0 (ICMS próprio) → E110 | 4º = 1 (ST) → E210 (por UF) |
|---|---|---|---|
| 0, 1, 2 | Crédito, outros créditos, **estorno de débito** ("2 – Estorno de Débito") | VL_AJ_CREDITOS | VL_AJ_CREDITOS_ST |
| 3, 4, 5 | Débito, outros débitos, **estorno de crédito** ("5 – Estorno de Crédito") | VL_AJ_DEBITOS | VL_AJ_DEBITOS_ST |
| 6 | Dedução do imposto apurado | VL_TOT_DED | VL_DEDUCOES_ST |
| 7 | Débitos especiais | DEB_ESP | DEB_ESP_ST |
| 9 (ou outros, conforme a tabela) | Informativo (usa VL_OUTROS) | não soma | não soma |

- **4º caractere 3 a 8 = sub-apurações** (registro 1900/1920):
  - 3º = "2" (estorno de débito) e 4º em 3–8: gera crédito no E110 e débito transferido no 1920 da sub-apuração (VL_TOT_TRANSF_DEBITOS_OA).
  - 3º = "5" (estorno de crédito) e 4º em 3–8: gera débito no E110 e crédito no 1920 (VL_TOT_TRANSF_CREDITOS_OA).
  - O 4º caractere tem que coincidir com o IND_APUR_ICMS do 1900.
- Documentos extemporâneos (COD_SIT 01/07) têm tratamento próprio no E110: vão para DEB_ESP ou para o primeiro período [Fora do trecho].
- **Para o ES:** carregar a Tabela 5.3 publicada pela SEFAZ-ES (códigos "ES…") no banco. O validador deve rejeitar COD_AJ fora da tabela vigente na data.
- **Antecipação e ST de entrada interestadual sem retenção** [Prática/Fora do trecho]: normalmente o débito da ST fica sob responsabilidade do adquirente.
  - Pode ser um C197 com código de "outros débitos ST" (3º = 4, 4º = 1), que vai para o E210 da UF ES.
  - Ou pode ser lançado diretamente no E220/E111, conforme a orientação da SEFAZ-ES.
  - Vincular o DUA pago no C112 e/ou no E116/E250.
  - **Validar com o contador.**

---

## 25. Registros C300 a C330 (NF de venda a consumidor, modelo 02) – fora do escopo

Estão no final do trecho, só como referência. Não se aplicam a NF-e nem a NFC-e.
- **C300**: resumo diário por série e subsérie (nível 2); VL_DOC = Σ C321.VL_ITEM; sem sobreposição de intervalos.
- **C310**: números cancelados, dentro do intervalo do C300.
- **C320**: analítico CST + CFOP + ALIQ; CST com 1º caractere 0; CFOP 5xxx interno; VL_BC_ICMS e VL_ICMS = Σ C321.
- **C321**: itens por COD_ITEM único; VL_ITEM líquido > 0.
- **C330**: informações complementares de ST (nível 5, 1:1).
  - Mesma lógica do C185, com numeração deslocada: 06 = NA_OPERACAO; 07 = OP_CONV; 08 = OP_ESTOQUE; 09 = ST_ESTOQUE; 10 = FCP_ESTOQUE; 11 = REST; 12 = FCP_REST; 13 = COMPL; 14 = FCP_COMPL.
  - Matriz: 0 → 08, 09, 10; 1 → 06, 08–12; 2 → 08–12 (o 07 conforme a UF); 3 → 06, 08, 09, 10, 13, 14.
- O C350 começa na linha 7099.

---

## 26. COMO ESCRITURAR – roteiros práticos

### 26.1 NF-e de ENTRADA (compra de fornecedor, terceiros)

1. Confirmar que a NF-e está autorizada e não foi cancelada (consultar o evento). Se estiver cancelada, não escriturar.
2. Gerar o **0150** do emitente e o **0200/0190/0220** a partir do de-para do item.
3. Preencher o **C100**:
   - IND_OPER=0, IND_EMIT=1.
   - COD_PART = emitente.
   - COD_MOD=55, COD_SIT=00 (ou 08 se for avulsa série 890–899; 01 se for extemporânea).
   - SER, NUM_DOC, CHV_NFE.
   - DT_DOC = dhEmi. **DT_E_S = data de entrada efetiva** (obrigatória), que define o período de crédito.
   - VL_DOC = vNF.
   - VL_MERC = vProd (+ ST + IPI se não houver crédito).
   - VL_DESC, VL_FRT, VL_SEG, VL_OUT_DA.
   - IND_FRT = modFrete; IND_PGTO.
   - Totais de ICMS = Σ C190.
4. Gerar um **C170 por item** (obrigatório):
   - COD_ITEM interno e UNID = uCom (com 0220 se diferente da unidade de estoque).
   - CST convertido (§11.3) e CFOP convertido (§11.4).
   - Com direito a crédito (item tributado de fornecedor do regime normal, ou CSOSN 101): VL_BC_ICMS, ALIQ e VL_ICMS.
   - **Item ST (a maioria dos medicamentos no ES): CST x60, CFOP 1.403/2.403, sem ICMS nem ST.** VL_ITEM = vProd + vST + vFCPST + vIPI.
5. Filhos opcionais:
   - C180, se o ES exigir o controle de ST (leiaute novo).
   - C173 **não** (varejo).
   - C120 na importação.
   - C113 se referenciar outro documento; C112 se houver DUA ou GNRE.
6. Gerar o **C190** por CST + CFOP + ALIQ (§21), com VL_OPR incluindo ST e IPI.
7. **C191** com VL_FCP_RET se houver `vFCPSTRet` (CST 60), ou com VL_FCP_ST / VL_FCP_OP.
8. C195 e C197 se houver ajuste estadual (ex.: antecipação, estorno, crédito presumido ES).
9. Compra interestadual de item ST **sem retenção**: aplicar o cálculo da antecipação/ST pelo adquirente e lançar o débito conforme o ES (§24.1).
   - Guardar a BC e o valor pagos para o controle de estoque (C180/C185).

### 26.2 NF-e de SAÍDA própria (venda para PJ, transferência, devolução de compra)

1. Preencher o **C100**:
   - IND_OPER=1, IND_EMIT=0.
   - COD_PART = destinatário.
   - COD_MOD=55, COD_SIT=00.
   - DT_DOC = dhEmi; DT_E_S = dhSaiEnt, se houver (respeitando a regra do período).
   - Totais conforme o XML.
2. **Não gerar C170**, salvo se houver C176/C180/C181/C177 (Exc. 2). Se o ES exigir C176 (saída interestadual de item com ST retida antes), gerar C170 **só dos itens com C176**.
3. **C190** por CST + CFOP + ALIQ, diretamente dos `det`. Aplicar as validações das saídas:
   - CST 60: ICMS, BC e ST = 0.
   - CST 00 com alíquota > 0.
   - CST 20/70 com VL_RED_BC > 0.
4. C191 (FCP) conforme a UF.
5. C101 se for interestadual para não contribuinte (grupo `ICMSUFDest`).
6. C185 (ST na saída) ou C186 (devolução de compra com ST), se o ES exigir. O C186 referencia a chave e o item da NF de compra devolvida.
7. C195 e C197 para ajustes (ex.: estorno de crédito, benefícios ES).
8. **Devolução de compra** (finNFe=4, CFOP 5.202/6.202/5.411/6.411):
   - IND_OPER=1 e C190 com o CFOP de devolução.
   - O ICMS destacado é débito (estorno do crédito da entrada).
   - A ST destacada na devolução (5.411 com vST) vai para VL_ICMS_ST e, no E210, para VL_DEVOL_ST [Fora do trecho].
   - C113 com a NF de compra, se referenciada no infCpl.

### 26.3 NFC-e (modelo 65) – só saída

1. **Um C100 por NFC-e** (não há consolidação no Bloco C para o 65 neste trecho):
   - IND_OPER=1, IND_EMIT=0.
   - **COD_PART vazio.**
   - COD_MOD=65, COD_SIT=00.
   - SER (3 posições, `000` se não houver) e NUM_DOC.
   - CHV_NFE obrigatória (o DV é conferido).
   - DT_DOC; DT_E_S opcional.
   - VL_DOC = vNF; VL_DESC; VL_MERC; IND_PGTO; IND_FRT=9 (normalmente modFrete=9).
   - VL_BC_ICMS e VL_ICMS = Σ C190.
   - **Vazios:** VL_BC_ICMS_ST, VL_ICMS_ST, VL_IPI, VL_PIS, VL_COFINS, VL_PIS_ST e VL_COFINS_ST.
2. **Sem C170.** Gerar só o **C190**, com **CFOP 5xxx** obrigatório (ex.: 5.102, 5.405). Em farmácia é comum:
   - CST 060 / CFOP 5.405 com VL_OPR e o resto 0.
   - CST 000 / CFOP 5.102 / 17% (ou 12%, 25%, conforme o item no ES).
   - CST 040/041.
3. **C191** com VL_FCP_RET (CST 60) ou VL_FCP_OP, conforme a exigência do ES.
4. **C185**, a critério da UF (controle de ST na saída para o consumidor final, desde 01/2020).
5. C195 e C197 se houver ajuste.
6. **NFC-e cancelada:** C100 com COD_SIT=02 e só REG, IND_OPER, IND_EMIT, COD_MOD, COD_SIT, SER, NUM_DOC e CHV_NFE. Sem C190.
7. **NFC-e denegada ou inutilizada:** não escriturar (COD_SIT 04/05 descontinuados desde 2023).
8. **NFC-e nunca entra como entrada.** A devolução de NFC-e pelo consumidor é feita por NF-e **de entrada própria** (mod. 55, IND_OPER=0, IND_EMIT=0, CFOP 1.202/1.411), com NFref ou refNFe para a NFC-e.
   - Como é NF-e própria, vale a Exc. 2: C100 + C190 (C170 só se houver C181).
   - O C181 referencia a chave da NFC-e (COD_MOD_SAIDA=65, CHV_DFE_SAIDA, NUM_ITEM_SAIDA) quando o ES exigir.

### 26.4 Devoluções – resumo

| Caso | Documento | IND_OPER / IND_EMIT | CFOP (exemplos) | Filhos específicos |
|---|---|---|---|---|
| Cliente PJ devolve venda (emite a NF-e dele) | NF-e de terceiros | 0 / 1 | 1.202/2.202; 1.411/2.411 (ST) | C170 obrigatório; C181 (UF); C113 opcional; C190 com crédito do ICMS destacado na venda (se houver direito) |
| Consumidor devolve (a farmácia emite a entrada) | NF-e própria de entrada | 0 / 0 | 1.202; 1.411 | C190 (C170 só com C181); C101 invertido, se a venda foi EC87 |
| Farmácia devolve compra ao fornecedor | NF-e própria de saída | 1 / 0 | 5.202/6.202; 5.411/6.411 | C190; C186 (UF); C113 |
| Fornecedor recusa ou retorna | ver C105 OPER=2 | | | |

### 26.5 Canceladas, denegadas, inutilizadas e extemporâneas – resumo

- **Própria cancelada (55 ou 65):** C100 com COD_SIT=02, com a chave e sem filhos. Se o cancelamento for de documento já escriturado em período anterior (extemporâneo): COD_SIT=03.
- **Terceiros cancelada:** não escriturar [Prática]. Se já foi escriturada em período fechado, retificar aquele período.
- **Denegada ou inutilizada:** desde 12/2021 não é obrigatório e desde 01/2023 os códigos 04/05 foram descontinuados. **Não gerar.**
- **Entrada lançada fora do período:** COD_SIT=01 com as datas originais. O crédito entra conforme as regras do E110 (primeiro período ou DEB_ESP).
- **Complementar:** COD_SIT=06 (ou 07 se for extemporânea), com os campos mínimos da Exc. 3. C190 obrigatório. O C170, se houver, pode ter QTD 0 e IND_MOV=1.

---

## 27. Checklist do validador interno (derivado do trecho)

1. C001.IND_MOV coerente com a existência de registros.
2. Unicidade do C100 pela chave do §2.2; advertência de duplicidade para modelos diferentes de 55/65.
3. IND_EMIT=1 ⇒ IND_OPER=0; nenhum mod. 65 com IND_OPER=0.
4. Mod. 65: COD_PART, VL_BC_ICMS_ST, VL_ICMS_ST, VL_IPI e PIS/COFINS vazios; sem C170; C190 só com CFOP 5xxx.
5. CHV_NFE: DV módulo 11; cUF, CNPJ (própria), modelo, série e número batem com o C100.
6. Datas: DT_DOC ≤ DT_FIN; DT_E_S ≥ DT_DOC e ≤ DT_FIN; DT_E_S obrigatória na entrada.
7. COD_SIT 02/03: só os 8 campos e nenhum filho; 04/05 não gerados.
8. Todo C100 regular ou complementar tem C190; C170 obrigatório nas entradas de terceiros; C170 em NF-e própria só com C176/C180/C181/C177.
9. Σ C170.VL_ITEM = C100.VL_MERC; Σ C170.VL_ABAT_NT = C100.VL_ABAT_NT.
10. C100 VL_BC_ICMS, VL_ICMS, VL_BC_ICMS_ST, VL_ICMS_ST e VL_IPI = Σ C190.
11. C190: combinação CST + CFOP + ALIQ única e existente nos C170; somas dos C170 por grupo; VL_RED_BC > 0 para CST x20/x70 (COD_SIT 00/01).
12. Warning: Σ C190.VL_OPR ≠ C100.VL_DOC.
13. CFOP: 1º dígito coerente com IND_OPER e igual em todos os itens.
14. Regras de CST nas saídas (ICMS e ST zerados ou positivos), aplicadas ao C190 quando não houver C170.
15. C191: cada campo só com o CST permitido.
16. C197: COD_AJ na Tabela 5.3 do ES vigente; DESCR_COMPL_AJ quando o código é genérico; COD_ITEM no 0200.
17. C113: IND_EMIT=1 ⇒ IND_OPER=0; COD_MOD diferente de 02/2D/2E; DT_DOC ≤ C100.DT_DOC.
18. C112: COD_AUT obrigatório se NUM_DA vazio; VL_DA > 0.
19. C176: fórmulas dos campos 14, 15 e 17; regras de exclusão entre CHAVE_NFE_RET e COD_PART_NFE_RET; DT_ULT_E ≤ DT_DOC.
20. C180 × C181 e C185 × C186 mutuamente exclusivos; matriz de campos por 3º caractere do COD_MOT_REST_COMPL; fórmulas do C180 (campos 06 e 08), do C185 (15 e 17) e do C181 (18 e 20).
21. C170.UNID diferente da unidade do 0200 ⇒ existe 0220 (exceto TIPO_ITEM 07).
22. C173 não gerado para informante varejista.
