# Gerador EFD-Contribuições: especificação campo a campo

Escopo: **farmácia varejista, Lucro Real, regime não cumulativo** (0110: `1|1|1|`), uma raiz de CNPJ (matriz e
filiais), UF = ES. Entradas por NF-e 55 (C100/C170), saídas por NF-e 55 (C100/C170) e NFC-e 65 (C100/C175),
CT-e tomado (D100/D101/D105) e apuração no Bloco M. Períodos de 2025 e 2026.

Fontes: notas locais do Guia Prático v1.35 (`contrib_*.md`), leitor `src/sped/contribuicoes.ts` e pesquisa
na web (seção 14). Itens marcados **CONFERIR** não puderam ser confirmados em fonte oficial.

---

## 0. Decisões de versão (verificadas em 30/09/2026)

| Item | Valor | Base |
|---|---|---|
| `0000.COD_VER` | **`006`** (leiaute 3.2.0), para qualquer período de 2020 em diante, **inclusive 2025 e 2026** | Tabela 3.1.1 do Guia (006 = PA ≥ 01/01/2020). A NT 009/2024 (PGE 6.0.0) mexeu no D500 (campo 23, NFCom) e na CPRB sem trocar o código. A NT 011/2026 afirma que "não haverá alteração do leiaute da EFD-Contribuições" em 2026. |
| Guia Prático | **1.35 (18/06/2021)** é a última versão encontrada. Nenhuma 1.36 ou 1.37 apareceu nas buscas. **CONFERIR** no Portal SPED: o `sped.rfb.gov.br` está bloqueado neste ambiente, e a NT 011/2026 diz que as novas orientações "serão incorporadas ao Guia Prático". | busca web (seção 14) |
| PVA/PGE vigente | 6.2.0 (a página de download da RFB lista 6.2.0 e 6.1.2) | gov.br/receitafederal |
| M210/M610 | leiaute **de 16 campos** (PA ≥ 01/2019) | Guia 1.35 |
| Bloco P / 0145 | A partir de 01/01/2025 não se escritura mais o 0145, portanto não há CPRB no arquivo. Gerar `P001` com IND_MOV = 1 e `P990` (ver P001). | NT 009/2024 |
| Fim da obrigação | A EFD-Contribuições **não será usada para fatos geradores a partir de 01/2027** (a CBS substitui PIS/COFINS). Em 2026, os valores de IBS/CBS/IS destacados na NF-e **não entram** nos valores dos itens e documentos. | NT 011/2026 |
| LC 224/2025 | Redução linear de 10% dos benefícios a partir de 01/04/2026: afeta operações a alíquota zero (CST 06) e isentas (CST 07). Ver seção 12. | NT 012/2026 (**CONFERIR** o texto oficial) |

**Registros que faltam na lista pedida e são necessários:** `I001` e `I990` (o Bloco I é obrigatório em
todo arquivo com DT_INI ≥ 01/07/2013; aqui vai só `|I001|1|` e `|I990|2|`). Eles entram entre `F990` e `M001`.
A spec já os inclui. `A010` e `F010` não são gerados, porque os blocos A e F vão com IND_MOV = 1.

---

## 1. Formato do arquivo

| Regra | Especificação |
|---|---|
| Codificação | **ISO-8859-1 (Latin-1)**. Converter a string com `Buffer.from(texto, 'latin1')`. Caracteres fora do Latin-1 (emoji, “ ” – etc.) viram o equivalente ASCII ou são removidos. |
| Linha | `|REG|campo2|...|campoN|` seguida de **CRLF** (`\r\n`), inclusive na última linha (9999). **Nenhuma linha em branco.** |
| Campo vazio | `||`. **Todos** os campos do leiaute estão presentes, na ordem exata, mesmo quando vazios. |
| Pipe e controle | Remover `|` e caracteres 0–31 de todo conteúdo de texto (trocar por espaço). Fazer `trim` e colapsar espaços duplos. |
| Números | Sem separador de milhar, sem sinal, sem `%`, sem ponto. **Vírgula decimal.** Regra do gerador: escrever exatamente `Dec` casas (valores `0,00`; alíquotas `1,6500`; quantidade `1,00000`). O leitor (`num()` em `efd.ts`) remove `.` e troca `,` por `.`, então **nunca** emitir ponto. |
| Negativos | Proibidos. Nenhum campo fica negativo. Na apuração, limitar os descontos para que 08 e 12 do M200 ≥ 0. |
| Obrigatório "S" numérico | Nos blocos A, C, D, F e M sai `0` ou `0,00` e **nunca vazio**. Numérico "N" sem informação sai vazio. |
| Data | `DDMMAAAA` (ex.: `01032026`). Período `MMAAAA`. |
| CNPJ/CPF/CEP/COD_MUN | Só dígitos, zeros à esquerda, tamanho exato (14/11/8/7). |
| Tamanho `*` | Tamanho exato. Os demais são máximos: C sem tamanho = 255; truncar descrições nesse limite. |
| Ordem dos blocos | `0, A, C, D, F, I, M, P, 1, 9`. Cada bloco tem x001 e x990. |
| Ordem dentro do bloco | Pai seguido de todos os seus filhos antes do próximo pai (ex.: C100, C170, C170, C100, C175…). Irmãos de nível igual seguem a ordem do leiaute (0140 → 0150 → 0190 → 0200). |
| Arredondamento | Half-up com 2 casas em cada registro: `Math.round((x + Number.EPSILON) * 100) / 100` ou decimal.js. Os totais do pai são a **soma dos filhos já arredondados**. |

Indexação no leitor: `f = linha.slice(1,-1).split('|')`, logo **`f[i]` = campo Nº `i+1`** (ex.: C100 VL_PIS = campo 26 = `f[25]`).
A seção 13 lista os índices que `contribuicoes.ts` lê, para o gerador bater com eles.

### Pipeline de geração (duas passadas)
1. Montar os documentos por estabelecimento (C, D) e as linhas de apuração.
2. Gerar o Bloco M a partir das linhas (seção 11).
3. Coletar as referências usadas (COD_PART, UNID, COD_ITEM por estabelecimento; COD_CTA global) e gerar o Bloco 0.
4. Montar os blocos na ordem, contar linhas (x990) e gerar o Bloco 9.

---

## 2. Bloco 0

Ordem: `0000, 0001, 0100, 0110, [0140, 0150*, 0190*, 0200*]*, 0500*, 0990`.
0150, 0190 e 0200 são **nível 3, filhos do 0140**: cada 0140 traz só os participantes, unidades e itens usados
nos documentos daquele CNPJ (C010/D010). 0500 é nível 2 e vem depois de todos os grupos 0140.

### 0000: Abertura do arquivo (nível 0, 1 ocorrência, O)
| Nº | Campo | Tipo | Tam | Dec | Obrig | Valor / regra |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004* | - | S | `0000` |
| 02 | COD_VER | N | 003* | - | S | `006` |
| 03 | TIPO_ESCRIT | N | 001* | - | S | `0` original; `1` retificadora |
| 04 | IND_SIT_ESP | N | 001* | - | N | vazio (0 abertura, 1 cisão, 2 fusão, 3 incorporação, 4 encerramento; só em evento) |
| 05 | NUM_REC_ANTERIOR | C | 041* | - | N | vazio se original; retificadora: recibo da anterior, **maiúsculas**, 41 posições |
| 06 | DT_INI | N | 008* | - | S | 1º dia do mês |
| 07 | DT_FIN | N | 008* | - | S | último dia do **mesmo** mês |
| 08 | NOME | C | 100 | - | S | razão social da matriz. Sanitizar: sem acentos, ç→c, só `A-Z a-z 0-9 espaço / , . - @ : & * + _ < > ( ) ! ? ' $ %` (**CONFERIR**: a restrição vem das notas do guia; aplicar só neste campo) |
| 09 | CNPJ | N | 014* | - | S | CNPJ da **matriz** (DV válido) |
| 10 | UF | C | 002* | - | S | `ES` |
| 11 | COD_MUN | N | 007* | - | S | IBGE da sede (ex.: Vitória `3205309`) |
| 12 | SUFRAMA | C | 009* | - | N | vazio |
| 13 | IND_NAT_PJ | N | 002* | - | N | `00` (PJ em geral) |
| 14 | IND_ATIV | N | 001 | - | S | `2` (comércio) |

Exemplo: `|0000|006|0|||01032026|31032026|FARMACIA EXEMPLO LTDA|12345678000195|ES|3205309||00|2|`

### 0001: Abertura do Bloco 0
| Nº | Campo | Tipo | Tam | Obrig | Valor |
|---|---|---|---|---|---|
| 01 | REG | C | 004* | S | `0001` |
| 02 | IND_MOV | N | 001 | S | `0` (sempre) |

### 0100: Dados do contabilista (nível 2, V, obrigatório na prática)
| Nº | Campo | Tipo | Tam | Obrig | Regra |
|---|---|---|---|---|---|
| 01 | REG | C | 004* | S | `0100` |
| 02 | NOME | C | 100 | S | nome do contador |
| 03 | CPF | N | 011* | S | DV válido |
| 04 | CRC | C | 015 | S | nº CRC (UF da sede), sem máscara |
| 05 | CNPJ | N | 014* | N | escritório (DV) |
| 06 | CEP | N | 008* | N | |
| 07 | END | C | 060 | N | |
| 08 | NUM | C | - | N | |
| 09 | COMPL | C | 060 | N | |
| 10 | BAIRRO | C | 060 | N | |
| 11 | FONE | C | 011 | N | só dígitos (DDD + número) |
| 12 | FAX | C | 011 | N | |
| 13 | EMAIL | C | - | N | |
| 14 | COD_MUN | N | 007* | N | IBGE |

### 0110: Regimes de apuração (nível 2, 1 ocorrência, O), com 5 campos
| Nº | Campo | Tipo | Tam | Obrig | Valor |
|---|---|---|---|---|---|
| 01 | REG | C | 004* | S | `0110` |
| 02 | COD_INC_TRIB | N | 001* | S | **`1`** (exclusivamente não cumulativo) |
| 03 | IND_APRO_CRED | N | 001* | N | **`1`** (apropriação direta). Com `1`, **não** existe 0111. |
| 04 | COD_TIPO_CONT | N | 001* | N | **`1`** (só alíquota básica). CST 04/06 na revenda **não** leva a 2. Mudar para `2` só se houver saída com CST 02 ou 03 (e aí M210 com COD_CONT 02/03). |
| 05 | IND_REG_CUM | N | 001* | N | **vazio** (só para COD_INC_TRIB = 2) |

Linha: `|0110|1|1|1||`

### 0140: Estabelecimento (nível 2, V, O)
Um por estabelecimento com operação no período (C010/D010). A **matriz sempre**, mesmo sem movimento.
Ordem sugerida: matriz primeiro, depois as filiais por CNPJ crescente.
| Nº | Campo | Tipo | Tam | Obrig | Regra |
|---|---|---|---|---|---|
| 01 | REG | C | 004* | S | `0140` |
| 02 | COD_EST | C | 060 | N | id interno (opcional) |
| 03 | NOME | C | 100 | S | razão social do estabelecimento |
| 04 | CNPJ | N | 014* | S | DV válido; mesma raiz de 8 dígitos do 0000 |
| 05 | UF | C | 002* | S | `ES` (ou a UF da filial) |
| 06 | IE | C | 014 | N | IE sem máscara; vazio se o estabelecimento tiver mais de uma IE |
| 07 | COD_MUN | N | 007* | S | IBGE |
| 08 | IM | C | - | N | inscrição municipal |
| 09 | SUFRAMA | C | 009* | N | vazio |

### 0150: Participante (nível 3, filho do 0140, 1:N)
Todo COD_PART usado em C100 (NF-e 55) e D100 **daquele estabelecimento**. NFC-e não usa participante.
| Nº | Campo | Tipo | Tam | Obrig | Regra (NF-e: entrada → `emit`; saída → `dest`; CT-e → `emit` da transportadora) |
|---|---|---|---|---|---|
| 01 | REG | C | 004* | S | `0150` |
| 02 | COD_PART | C | 060 | S | código estável e único no 0140 (sugestão: o CNPJ ou CPF; estrangeiro: `EX` + id) |
| 03 | NOME | C | 100 | S | `xNome` (nome genérico como "CONSUMIDOR" é proibido) |
| 04 | COD_PAIS | N | 005 | S | `01058` (Brasil) ou `cPais` com zero à esquerda |
| 05 | CNPJ | N | 014* | N | exclusivo com o CPF; um dos dois obrigatório se Brasil |
| 06 | CPF | N | 011* | N | |
| 07 | IE | C | 014 | N | IE sem máscara; vazio se "ISENTO" ou se `indIEDest` ≠ 1 |
| 08 | COD_MUN | N | 007* | N | obrigatório se Brasil (`cMun`) |
| 09 | SUFRAMA | C | 009* | N | vazio |
| 10 | END | C | 060 | N | `xLgr` |
| 11 | NUM | C | - | N | `nro` |
| 12 | COMPL | C | 060 | N | `xCpl` |
| 13 | BAIRRO | C | 060 | N | `xBairro` |
Mesmo CNPJ/CPF com dados diferentes no mês: usar a ocorrência mais recente.

### 0190: Unidade de medida (nível 3, 1:N)
| Nº | Campo | Tipo | Tam | Obrig | Regra |
|---|---|---|---|---|---|
| 01 | REG | C | 004* | S | `0190` |
| 02 | UNID | C | 006 | S | `uCom` normalizado (maiúsculas, sem espaços, até 6 caracteres) |
| 03 | DESCR | C | - | S | descrição **diferente** de UNID (tabela interna: UN→UNIDADE, CX→CAIXA, FR→FRASCO…; fallback `UNIDADE <UNID>`) |
Só as unidades usadas em C170.UNID e 0200.UNID_INV do estabelecimento.

### 0200: Item (nível 3, 1:N)
Todo COD_ITEM de C170 do estabelecimento. **C175 não referencia item**, então as NFC-e não geram 0200.
| Nº | Campo | Tipo | Tam | Obrig | Regra |
|---|---|---|---|---|---|
| 01 | REG | C | 004 | S | `0200` |
| 02 | COD_ITEM | C | 060 | S | saída: `cProd` próprio. Entrada: código **próprio**. De-para por `cEAN` com o catálogo próprio; senão, código sintético estável `F<CNPJ fornecedor>-<cProd>` (≤ 60). |
| 03 | DESCR_ITEM | C | - | S | `xProd` (sem descrição genérica) |
| 04 | COD_BARRA | C | - | N | `cEAN` (vazio se "SEM GTIN") |
| 05 | COD_ANT_ITEM | C | 060 | N | vazio |
| 06 | UNID_INV | C | 006 | N | unidade (deve existir no 0190) ou vazio |
| 07 | TIPO_ITEM | N | 002* | S | `00` revenda; `07` uso e consumo; `08` imobilizado; `09` serviço; `99` outros |
| 08 | COD_NCM | C | 008 | N | `NCM` do XML (preencher sempre; é a base do NAT_REC) |
| 09 | EX_IPI | C | 003 | N | `EXTIPI` |
| 10 | COD_GEN | N | 002* | N | 2 primeiros dígitos do NCM (vazio se NCM vazio) |
| 11 | COD_LST | C/N | 005 | N | vazio (mercadoria) |
| 12 | ALIQ_ICMS | N | 006 | N | vazio |

### 0500: Plano de contas (nível 2, V)
**COD_CTA é obrigatório desde 01/11/2017** (erro no PVA) para o Lucro Real, em C170, C175, D101, D105, M400,
M410, M800 e M810. Gerar um 0500 para **cada** COD_CTA referenciado (não para o plano inteiro).
| Nº | Campo | Tipo | Tam | Obrig | Regra |
|---|---|---|---|---|---|
| 01 | REG | C | 004* | S | `0500` |
| 02 | DT_ALT | N | 008* | S | data de inclusão/alteração da conta (≤ DT_FIN) |
| 03 | COD_NAT_CC | C | 002* | S | `01` ativo, `02` passivo, `03` PL, `04` resultado, `05` compensação, `09` outras (receitas e despesas = `04`; estoque = `01`) |
| 04 | IND_CTA | C | 001* | S | `A` analítica (a conta referenciada deve ser analítica; `S` só se usar sintética em C175/M400) |
| 05 | NIVEL | N | 005 | S | nível da conta no plano |
| 06 | COD_CTA | C | 255 | S | código da conta |
| 07 | NOME_CTA | C | 060 | S | nome |
| 08 | COD_CTA_REF | C | 060 | N | conta referencial RFB (opcional) |
| 09 | CNPJ_EST | N | 014* | N | vazio (conta comum a todos os estabelecimentos) |
Sem duplicar a combinação DT_ALT + COD_CTA + COD_CTA_REF. Origem: parametrização por empresa
(CFOP/CST → conta). Exemplos: receita de venda tributada, receita de venda monofásica (alíquota zero),
mercadorias para revenda (compra), fretes sobre vendas.

### 0990: Encerramento do Bloco 0
`|0990|QTD_LIN_0|`, com QTD_LIN_0 = linhas de 0000 até 0990, inclusive as duas.

---

## 3. Bloco A (sem dados)
| Registro | Linha |
|---|---|
| A001 (REG C 004*; IND_MOV C 001) | `|A001|1|` |
| A990 (REG; QTD_LIN_A N) | `|A990|2|` |

---

## 4. Bloco C

Ordem: `C001, [C010, C100, (C170* | C175*), C100, ...]*, C990`.

### C001
`|C001|0|` se houver ao menos um C100; senão `|C001|1|` (e aí só C001 e C990).

### C010: Estabelecimento (nível 2, V; O se IND_MOV = 0)
| Nº | Campo | Tipo | Tam | Obrig | Valor |
|---|---|---|---|---|---|
| 01 | REG | C | 004* | S | `C010` |
| 02 | CNPJ | N | 014* | S | CNPJ do estabelecimento (deve estar no 0140) |
| 03 | IND_ESCRI | C | 001* | N | **vazio** (só preencher se o arquivo tiver C100 e C180/C190 para NF-e; aqui não há C180/C190) |
Só para estabelecimentos com documento no Bloco C.

### Que documentos entram
| Documento | Registro | Entra? |
|---|---|---|
| NF-e 55 de **venda** própria (CFOP 5101, 5102, 5403, 5405, 6102, 6108, 6403, 6404…) | C100 IND_OPER=1 + **C170** | sim. **C170 é obrigatório** para todo C100 não cancelado (tabela: "C170 O se existir C100"; só o mod. 65 usa C175). A alternativa legal é o consolidado C180, que não está no escopo. |
| NF-e 55 própria **5929/6929** (emitida sobre cupom ou NFC-e já escriturado) | não | nunca: duplica a receita |
| NF-e 55 de transferência (5152/5409/6152/6409), remessas (59xx), simples faturamento, retorno | não | não é receita nem crédito |
| NF-e 55 de **devolução de compra** (5202, 5411, 6202, 6411) | C100 IND_OPER=1 + C170 com **CST 49** | opcional (transparência). O estorno do crédito é feito na base (ver C170 de entrada). |
| NFC-e 65 | C100 + **C175** (nunca C170) | sim |
| NF-e 55 de **compra para revenda/insumo** com crédito | C100 IND_OPER=0, IND_EMIT=1 + C170 | sim, com a nota **inteira** (itens sem crédito com CST 70–75/98/99, sem base) |
| NF-e 55 de compra sem **nenhum** item com crédito (ex.: só monofásicos) | C100 + C170 CST 70 | **opcional**. Recomendado incluir, para o cruzamento com o SPED Fiscal. Configurável. |
| NF-e 55 de **devolução de venda** (1202, 1411, 2202, 2411), emitida pelo cliente ou entrada própria | C100 IND_OPER=0 + C170 | sim: crédito CST 50 se a venda foi tributada (CST 01); sem crédito se a venda foi monofásica (ver C170) |
| NF-e 55 de uso e consumo (1556/2556) | não | não gera crédito no varejo |
| NF-e 55 de imobilizado (1551/2551) | não | o crédito seria no F120/F130, fora do escopo |
| NF-e 55 de energia elétrica | não | seria C500, fora do escopo |
| **Canceladas, denegadas, inutilizadas** (COD_SIT 02/03/04/05) | **não gerar** (padrão) | Documento que não gera receita nem crédito não precisa ser informado; cancelamento no mesmo mês pode ser omitido. Opção configurável: C100 **sem filhos**, preenchendo só REG, IND_OPER, IND_EMIT, COD_MOD, COD_SIT, SER, NUM_DOC e CHV_NFE, com os demais campos vazios (padrão EFD ICMS/IPI; **CONFERIR** a aceitação de DT_DOC vazio no PVA Contribuições). |
| Cancelamento em mês posterior ao da venda | ajuste M215/M615 COD_AJ_BC 01 | **fora da lista pedida**: exige M215/M615 e 1050 |

### C100: Documento (nível 3, 1:N, filho do C010)
| Nº | Campo | Tipo | Tam | Dec | Obrig | NF-e 55 saída | NF-e 55 entrada | NFC-e 65 |
|---|---|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | - | S | `C100` | `C100` | `C100` |
| 02 | IND_OPER | C | 001* | - | S | `1` | `0` | `1` |
| 03 | IND_EMIT | C | 001* | - | S | `0` | `1` terceiros; `0` entrada própria (devolução emitida pela farmácia) | `0` |
| 04 | COD_PART | C | 060 | - | S | `dest` → 0150 | `emit` → 0150 (entrada própria: o remetente) | **vazio** (dispensado) |
| 05 | COD_MOD | C | 002* | - | S | `55` | `55` | `65` |
| 06 | COD_SIT | N | 002* | - | S | `00` regular; `06` complementar (`finNFe`=2); `08` regime especial | `00` (`06` complementar; `08` NF-e avulsa, séries 890–899) | `00` |
| 07 | SER | C | 003 | - | N | `ide/serie` com 3 dígitos e zeros à esquerda (`001`); `000` se vazia. **CONFERIR** se o PVA aceita sem zeros (`1`); a série deve bater com a chave. | idem | idem |
| 08 | NUM_DOC | N | 009 | - | S | `nNF` sem zeros à esquerda | `nNF` | `nNF` |
| 09 | CHV_NFE | N | 044* | - | N* | chave (obrigatória) | chave (obrigatória desde 04/2012) | chave (obrigatória) |
| 10 | DT_DOC | N | 008* | - | S | `dhEmi` | `dhEmi` | `dhEmi` |
| 11 | DT_E_S | N | 008* | - | N | `dhSaiEnt` se houver, senão vazio | **obrigatório**: data de entrada (ERP ou recebimento); se não houver, a data da manifestação ou o `dhEmi`. ≥ DT_DOC. | vazio |
| 12 | VL_DOC | N | - | 02 | S | `vNF` | `vNF` | `vNF` |
| 13 | IND_PGTO | C | 001* | - | S | `0` à vista, `1` a prazo (existe `cobr/dup` ou `indPag`=1), `2` outros | idem | `0` (ou pelo `indPag`) |
| 14 | VL_DESC | N | - | 02 | N | `vDesc` | `vDesc` | `vDesc` |
| 15 | VL_ABAT_NT | N | - | 02 | N | vazio | vazio | vazio |
| 16 | VL_MERC | N | - | 02 | N | `vProd` (= Σ C170.VL_ITEM) | `vProd` (= Σ C170.VL_ITEM) | `vProd` (= Σ C175.VL_OPR se VL_OPR for só vProd) |
| 17 | IND_FRT | C | 001* | - | S | `modFrete` direto (0,1,2,3,4,9) | `modFrete` | `9` (ou `modFrete`) |
| 18 | VL_FRT | N | - | 02 | N | `vFrete` | `vFrete` | `vFrete` |
| 19 | VL_SEG | N | - | 02 | N | `vSeg` | `vSeg` | `vSeg` |
| 20 | VL_OUT_DA | N | - | 02 | N | `vOutro` | `vOutro` | `vOutro` |
| 21 | VL_BC_ICMS | N | - | 02 | N | `vBC` | `vBC` | `vBC` |
| 22 | VL_ICMS | N | - | 02 | N | `vICMS` | `vICMS` | `vICMS` |
| 23 | VL_BC_ICMS_ST | N | - | 02 | N | `vBCST` | `vBCST` | vazio (dispensado) |
| 24 | VL_ICMS_ST | N | - | 02 | N | `vST` | `vST` | vazio |
| 25 | VL_IPI | N | - | 02 | N | `vIPI` | `vIPI` | vazio |
| 26 | VL_PIS | N | - | 02 | N | Σ C170.VL_PIS | Σ C170.VL_PIS (crédito calculado; **não** o `vPIS` do fornecedor) | vazio |
| 27 | VL_COFINS | N | - | 02 | N | Σ C170.VL_COFINS | Σ C170.VL_COFINS | vazio |
| 28 | VL_PIS_ST | N | - | 02 | N | vazio (ou Σ `PISST/vPIS`) | vazio | vazio |
| 29 | VL_COFINS_ST | N | - | 02 | N | vazio | vazio | vazio |

Regras:
- DT_DOC **ou** DT_E_S dentro do período do 0000. A entrada entra no período da data de entrada.
- CHV_NFE: DV válido. Nos documentos próprios, CNPJ da chave = CNPJ do C010, UF da chave = UF do 0000 e nº da chave = NUM_DOC.
- IND_EMIT = 1 implica IND_OPER = 0.
- Chave de unicidade no C010: IND_OPER + IND_EMIT + (COD_PART se terceiros) + COD_MOD + COD_SIT + SER + NUM_DOC + CHV_NFE (esta desde 04/2021).
- Em 2026, os grupos `IBSCBS`/`vIBS`/`vCBS`/`vNFTot` do XML são **ignorados**. VL_DOC = `vNF` (NT 011/2026).
- Campos 23–29 "N": vazio quando a informação não existe; `0,00` também é aceito.

### C170: Itens (nível 4, 1:N, filho do C100 mod. 55)
| Nº | Campo | Tipo | Tam | Dec | Obrig | Saída (NF-e própria) | Entrada |
|---|---|---|---|---|---|---|---|
| 01 | REG | C | 004 | - | S | `C170` | `C170` |
| 02 | NUM_ITEM | N | 003 | - | S | `det/@nItem` | `det/@nItem` |
| 03 | COD_ITEM | C | 060 | - | S | `cProd` (0200) | código próprio (de-para; 0200) |
| 04 | DESCR_COMPL | C | - | - | N | vazio (ou `infAdProd`) | vazio |
| 05 | QTD | N | - | 05 | N | `qCom` | `qCom` |
| 06 | UNID | C | 006 | - | N | `uCom` (0190) | `uCom` (0190) |
| 07 | VL_ITEM | N | - | 02 | S | `vProd` | `vProd` |
| 08 | VL_DESC | N | - | 02 | N | `vDesc` do item | `vDesc` do item (+ devoluções de compra do mesmo mês, se estornar por aqui) |
| 09 | IND_MOV | C | 001 | - | N | `0` | `0` |
| 10 | CST_ICMS | N | 003* | - | N | `orig`+`CST` (ex.: `060`); vazio se CSOSN | `orig`+`CST`; vazio se o fornecedor usa CSOSN (**CONFERIR**) |
| 11 | CFOP | N | 004* | - | S | `prod/CFOP` (5/6/7) | **CFOP de entrada do informante** (1/2/3): 5102→1102, 6102→2102, 5405/5403→1403, 6403/6404→2403, 5202/6202→1202/2202 (devolução)… O 1º dígito é igual em todo o documento; CFOP-título proibido. |
| 12 | COD_NAT | C | 010 | - | N | vazio (não gerar 0400) | vazio |
| 13 | VL_BC_ICMS | N | - | 02 | N | `ICMS/vBC` | `ICMS/vBC` |
| 14 | ALIQ_ICMS | N | 006 | 02 | N | `pICMS` | `pICMS` |
| 15 | VL_ICMS | N | - | 02 | N | `vICMS` | `vICMS` |
| 16 | VL_BC_ICMS_ST | N | - | 02 | N | `vBCST` | `vBCST` |
| 17 | ALIQ_ST | N | 006 | 02 | N | `pICMSST` | `pICMSST` |
| 18 | VL_ICMS_ST | N | - | 02 | N | `vICMSST` | `vICMSST` |
| 19 | IND_APUR | C | 001* | - | N | vazio | vazio |
| 20 | CST_IPI | C | 002* | - | N | vazio (farmácia não é contribuinte do IPI) | vazio |
| 21 | COD_ENQ | C | 003* | - | N | vazio | vazio |
| 22 | VL_BC_IPI | N | - | 02 | N | vazio | vazio |
| 23 | ALIQ_IPI | N | 006 | 02 | N | vazio | vazio |
| 24 | VL_IPI | N | - | 02 | N | vazio | vazio (o IPI entra na base do crédito, não aqui) |
| 25 | CST_PIS | N | 002* | - | S | CST do XML (01, 04, 06, 49…) | **CST do adquirente**: 50–56, 70–75, 98, 99 |
| 26 | VL_BC_PIS | N | - | 02 | N | ver "Base de débito" | ver "Base de crédito"; vazio se CST ≥ 70 |
| 27 | ALIQ_PIS | N | 008 | 04 | N | `1,6500` (CST 01); `0,0000` (04/06) | `1,6500` (50–56); vazio se sem crédito |
| 28 | QUANT_BC_PIS | N | - | 03 | N | vazio | vazio |
| 29 | ALIQ_PIS_QUANT | N | - | 04 | N | vazio | vazio |
| 30 | VL_PIS | N | - | 02 | N | round(26 × 27 / 100, 2) | round(26 × 27 / 100, 2) |
| 31 | CST_COFINS | N | 002* | - | S | = CST_PIS | = CST_PIS |
| 32 | VL_BC_COFINS | N | - | 02 | N | = 26 | = 26 |
| 33 | ALIQ_COFINS | N | 008 | 04 | N | `7,6000` (CST 01); `0,0000` (04/06) | `7,6000` (50–56) |
| 34 | QUANT_BC_COFINS | N | - | 03 | N | vazio | vazio |
| 35 | ALIQ_COFINS_QUANT | N | - | 04 | N | vazio | vazio |
| 36 | VL_COFINS | N | - | 02 | N | round(32 × 33 / 100, 2) | round(32 × 33 / 100, 2) |
| 37 | COD_CTA | C | 255 | - | N* | **obrigatório** (conta de receita, 0500) | **obrigatório** (conta de estoque/custo, 0500) |

**CST de saída (NF-e própria):** usar o CST do XML, depois de validar o NCM contra a lista monofásica (o leitor já faz isso).
01 = tributada; **04 = monofásico, revenda a alíquota zero** (farmacêuticos e perfumaria/higiene da Lei 10.147/2000);
06 = alíquota zero (tab. 4.3.13); 05 = ST (varejo de cigarros: BC `0`, ALIQ `0,6500`/`3,0000`, VL `0`); 49 = devolução de compra.
Para CST 04, 06, 07, 08, 09 e 49: VL_BC = `0,00`, ALIQ = `0,0000`, VL = `0,00` (ou vazios; os dois são aceitos).

**Base de débito (CST 01):** `VL_BC_PIS = VL_ITEM − VL_DESC + vFrete_item + vSeg_item + vOutro_item − vICMS_item`.
- O frete, o seguro e as despesas cobradas do cliente compõem a receita e seguem o CST do produto.
- A exclusão do ICMS destacado (RE 574.706) é uma opção por empresa, padrão ligado. Só subtrair o `vICMS` do próprio item (CST 01), nunca o de item 04/06.
- No C170 o ICMS **não** vai no VL_DESC: a base já sai reduzida (Guia, Seção 12).
- **CONFERIR** com a contabilidade a inclusão de vOutro/vFrete na base e a política de exclusão do ICMS.

**CST de entrada (ótica do adquirente, nunca copiar o do XML):**
| Situação | CST PIS/COFINS | Crédito |
|---|---|---|
| Compra para revenda de item **tributado** (não monofásico), CFOP 1102/2102/1403/2403 | **50** | sim, 1,65/7,6 |
| Compra para revenda de **monofásico** (NCM na lista da Lei 10.147) | **70** (aquisição sem direito a crédito). **CONFERIR**: há quem use 73. | não (vedação do art. 3º, I, b) |
| Compra de item a alíquota zero (tab. 4.3.13) | 73 | não |
| Devolução de venda tributada (1202/2202/1411/2411) | 50 | sim (NAT 12) |
| Devolução de venda monofásica ou a alíquota zero | 98 (**CONFERIR**; alternativa 73) | não |
| Fornecedor do Simples Nacional, item tributado para revenda | 50 | sim, à alíquota cheia |
| Item de nota mista sem crédito (brinde, uso e consumo) | 70 ou 98 | não |

**Base de crédito (CST 50–56):**
`VL_BC = vProd − vDesc + vFrete + vSeg + vOutro + vIPI − vICMS` (valores do item).
- **Exclusão do ICMS** destacado da base do crédito: obrigatória desde 01/05/2023 (Lei 14.592/2023, art. 3º, § 2º, III das Leis 10.637 e 10.833).
- **ICMS-ST pago na compra (vICMSST): NÃO incluir** por padrão (conservador; ver o tema no STJ). **CONFERIR** com a contabilidade; deixar configurável.
- Devolução de compra no mesmo mês: pode reduzir a base do item comprado via VL_DESC (forma preferencial). Em mês posterior: M110/M510, **fora da lista**.
- O crédito só é "visto" pelo M105 se o CFOP estiver na tabela oficial "CFOP – Operações Geradoras de Crédito" (Portal SPED). **CONFERIR** a lista atual. Mínimo para farmácia: 1102, 2102, 1403, 2403, 1101, 2101, 1401, 2401 (insumo), 1201, 1202, 2201, 2202, 1410, 1411, 2410, 2411 (devolução).

**NAT_BC_CRED** (não é campo do C170; é derivado para o M105):
- 1102/2102/1403/2403 → `01`
- 1101/2101/1401/2401 → `02`
- 1201/1202/1410/1411/2201/2202/2410/2411 → `12`

### C175: Registro analítico da NFC-e (nível 4, 1:N, filho do C100 mod. 65)
Uma linha por combinação **CFOP + CST_PIS + CST_COFINS + ALIQ_PIS + ALIQ_COFINS** dentro da NFC-e.
Ex.: uma NFC-e com itens CST 01 e CST 04 em 5102 e 5405 gera até 4 C175.
| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004* | - | S | `C175` |
| 02 | CFOP | N | 004* | - | S | `prod/CFOP`, **somente 5xxx** |
| 03 | VL_OPR | N | - | 02 | S | Σ (`vProd` + `vFrete` + `vSeg` + `vOutro`) dos itens do grupo. Na farmácia, na prática Σ `vProd`. **CONFERIR** se as despesas acessórias entram aqui ou só vProd. |
| 04 | VL_DESC | N | - | 02 | N | Σ `vDesc` + (se a exclusão do ICMS estiver ligada e o CST for 01) Σ `vICMS` do grupo. **Aqui o ICMS vai no VL_DESC** (Guia, Seção 12). |
| 05 | CST_PIS | N | 002* | - | N | preencher sempre |
| 06 | VL_BC_PIS | N | - | 02 | N | CST 01: `03 − 04`; demais: `0,00` |
| 07 | ALIQ_PIS | N | 008 | 04 | N | `1,6500` (01); `0,0000` (04/06/…) |
| 08 | QUANT_BC_PIS | N | - | 03 | N | vazio |
| 09 | ALIQ_PIS_QUANT | N | - | 04 | N | vazio |
| 10 | VL_PIS | N | - | 02 | N | round(06 × 07 / 100, 2) |
| 11 | CST_COFINS | N | 002* | - | S | = CST_PIS |
| 12 | VL_BC_COFINS | N | - | 02 | N | = 06 |
| 13 | ALIQ_COFINS | N | 008 | 04 | N | `7,6000` / `0,0000` |
| 14 | QUANT_BC_COFINS | N | - | 03 | N | vazio |
| 15 | ALIQ_COFINS_QUANT | N | - | 04 | N | vazio |
| 16 | VL_COFINS | N | - | 02 | N | round(12 × 13 / 100, 2) |
| 17 | COD_CTA | C | 255 | - | N* | **obrigatório** (conta de receita tributada ou monofásica; pode ser sintética) |
| 18 | INFO_COMPL | C | - | - | N | vazio |

Regras:
- Arredondamento: somar as bases dos itens e calcular VL uma vez por C175 (não somar vPIS item a item).
- Linha com VL_OPR = 0 não é gerada. A combinação é única por C100.
- A agregação inclui a alíquota: um mesmo CST 01 com alíquota diferente gera outra linha.

### C990
`|C990|QTD_LIN_C|`, contando de C001 a C990, inclusive.

---

## 5. Bloco D: CT-e tomado (crédito sobre frete)

### D001
`|D001|0|` se houver D100; senão `|D001|1|` + `|D990|2|`.

### D010: `REG C 004* S | CNPJ N 014* S`
CNPJ do estabelecimento **tomador**, presente no 0140.

### Quais CT-e entram
Só o CT-e em que a empresa é **tomadora** (raiz do CNPJ do tomador = raiz do 0000; tomador via
`ide/toma3/toma` → papel, ou `toma4/CNPJ`) **e** o frete dá direito a crédito. Cancelados, denegados e
inutilizados: **não gerar**. Transferências entre estabelecimentos (IND_NAT_FRT 4/5): omitir.

### D100 (nível 3, 1:N)
| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra (XML CT-e) |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004* | - | S | `D100` |
| 02 | IND_OPER | C | 001* | - | S | `0` (único válido) |
| 03 | IND_EMIT | C | 001* | - | S | `1` |
| 04 | COD_PART | C | 060 | - | S | transportadora (`emit`) → 0150 do estabelecimento |
| 05 | COD_MOD | C | 002* | - | S | `57` (ou `67` CT-e OS) |
| 06 | COD_SIT | N | 002* | - | S | `00`; complemento (`tpCTe`=1) → `06` |
| 07 | SER | C | 004 | - | N | `ide/serie` |
| 08 | SUB | C | 003 | - | N | vazio |
| 09 | NUM_DOC | N | 009 | - | S | `nCT` |
| 10 | CHV_CTE | N | 044* | - | N* | chave (obrigatória para o mod. 57) |
| 11 | DT_DOC | N | 008* | - | S | `dhEmi` |
| 12 | DT_A_P | N | 008* | - | N | data de aquisição/recebimento. Usar quando DT_DOC está fora do período. DT_DOC ou DT_A_P deve estar no período. |
| 13 | TP_CT-e | N | 001* | - | N | `tpCTe` (0 normal, 1 complemento, 3 substituto) |
| 14 | CHV_CTE_REF | N | 044* | - | N | **vazio** |
| 15 | VL_DOC | N | - | 02 | S | `vPrest/vTPrest` |
| 16 | VL_DESC | N | - | 02 | N | `0,00` |
| 17 | IND_FRT | C | 001* | - | S | `0` por conta do emitente; `1` destinatário ou remetente; `2` terceiros; `9` sem frete. Tomador = remetente ou destinatário → `1`; tomador "outros" → `2`. |
| 18 | VL_SERV | N | - | 02 | S | `vTPrest` |
| 19 | VL_BC_ICMS | N | - | 02 | N | `imp/ICMS/*/vBC` (validação: = VL_SERV − VL_NT) |
| 20 | VL_ICMS | N | - | 02 | N | `vICMS` |
| 21 | VL_NT | N | - | 02 | N | VL_SERV − VL_BC_ICMS |
| 22 | COD_INF | C | 006 | - | N | vazio |
| 23 | COD_CTA | C | 255 | - | N | conta (recomendado preencher) |
Para cada D100: **pelo menos 1 D101 e 1 D105**.

### D101 (PIS) / D105 (COFINS) (nível 4, 1:N)
| Nº | D101 | D105 | Tipo | Tam | Dec | Obrig | Regra |
|---|---|---|---|---|---|---|---|
| 01 | REG | REG | C | 004* | - | S | `D101` / `D105` |
| 02 | IND_NAT_FRT | IND_NAT_FRT | C | 001* | - | S | `0` venda, ônus do vendedor; `1` venda, ônus do adquirente; `2` compra geradora de crédito; `3` compra sem crédito; `4`/`5` transferência; `9` outras |
| 03 | VL_ITEM | VL_ITEM | N | - | 02 | S | valor do frete da natureza/CST (normalmente vTPrest) |
| 04 | CST_PIS | CST_COFINS | N | 002* | - | S | 50/51/53 (crédito) ou 70 (sem) |
| 05 | NAT_BC_CRED | NAT_BC_CRED | C | 002* | - | N (S se CST 50–66) | ver abaixo |
| 06 | VL_BC_PIS | VL_BC_COFINS | N | - | 02 | N | parcela com crédito: `VL_ITEM − ICMS proporcional` (**CONFERIR** se a Lei 14.592/2023 alcança o frete; padrão: excluir o ICMS do CT-e) |
| 07 | ALIQ_PIS | ALIQ_COFINS | N | 008 | 04 | N | `1,6500` / `7,6000` |
| 08 | VL_PIS | VL_COFINS | N | - | 02 | N | round(06 × 07 / 100, 2) |
| 09 | COD_CTA | COD_CTA | C | 255 | - | N | conta de despesa com frete (obrigatória, 0500) |

Classificação (a partir das NF-e em `infCTeNorm/infDoc/infNFe/chave`):
| NF-e vinculada | IND_NAT_FRT | CST | NAT_BC_CRED |
|---|---|---|---|
| Venda da empresa (emitente = estabelecimento), frete pago pela farmácia, itens só CST 01 | 0 | 50 | **07** (armazenagem e frete na venda) |
| Venda, itens só monofásicos ou alíquota zero | 0 | 51 (crédito ligado a receita não tributada, grupo 201). **CONFERIR** a admissibilidade com a contabilidade. | 07 |
| Venda com itens mistos | 0 | 53, com a base repartida (apropriação direta) pelo valor dos itens CST 01 × CST 04/06 da NF-e: um M105 sob 101 e outro sob 201 | 07 |
| Compra (destinatário = estabelecimento) de mercadoria **com crédito** (CST 50), frete FOB pago pela farmácia | 2 | 50 | **01** para frete na compra de bens para revenda (integra o custo de aquisição). **CONFERIR**: na prática também se vê 03. **Não** pode somar esse frete também na base do C170. |
| Compra de monofásico (sem crédito) | 3 | 70 | vazio (ou omitir o CT-e) |
| Sem NF-e vinculada identificável | não gerar crédito | – | – |

### D990
`|D990|QTD_LIN_D|`

---

## 6. Bloco F (sem dados)
`|F001|1|` e `|F990|2|`.
Aviso: retenções (F600), deduções (F700) e imobilizado (F120/F130) ficam fora do escopo; se existirem, o bloco F passa a ter dados.

## 7. Bloco I (obrigatório, sem dados; faltava na lista)
`|I001|1|` e `|I990|2|` (REG C 004*; IND_MOV C 001 / QTD_LIN_I N).

---

## 8. Bloco M: leiautes

Ordem: `M001, [M100, M105*]*, M200, M205*, M210*, [M400, M410*]*, [M500, M505*]*, M600, M605*, M610*, [M800, M810*]*, M990`.
(Na ordem do leiaute: M205 antes de M210, e M400 depois dos M2xx do PIS.)

### M001
`|M001|0|` (sempre com dados: M200 e M600 existem sempre).

### M100: Crédito de PIS do período (nível 2, V; um por COD_CRED + ALIQ_PIS + IND_CRED_ORI)
| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004* | - | S | `M100` |
| 02 | COD_CRED | C | 003* | - | S | Tab. 4.3.6: `101` (CST 50 e parcela tributada do 53), `201` (CST 51 e parcela não tributada do 53) |
| 03 | IND_CRED_ORI | N | 001* | - | S | `0` |
| 04 | VL_BC_PIS | N | - | 02 | N | Σ M105.07 dos filhos |
| 05 | ALIQ_PIS | N | 008 | 04 | N | `1,6500` |
| 06 | QUANT_BC_PIS | N | - | 03 | N | vazio |
| 07 | ALIQ_PIS_QUANT | N | - | 04 | N | vazio |
| 08 | VL_CRED | N | - | 02 | S | round(04 × 05 / 100, 2) |
| 09 | VL_AJUS_ACRES | N | - | 02 | S | `0,00` (M110 fora do escopo) |
| 10 | VL_AJUS_REDUC | N | - | 02 | S | `0,00` |
| 11 | VL_CRED_DIF | N | - | 02 | S | `0,00` |
| 12 | VL_CRED_DISP | N | - | 02 | S | 08 + 09 − 10 − 11 |
| 13 | IND_DESC_CRED | C | 001* | - | S | `0` se 14 = 12 (uso total); `1` se parcial (inclusive 14 = 0) |
| 14 | VL_CRED_DESC | N | - | 02 | N | parte descontada no M200 do período (algoritmo 11.4) |
| 15 | SLD_CRED | N | - | 02 | S | 12 − 14 (se > 0, gerar o 1100 do período) |

### M105: Detalhe da base do crédito de PIS (nível 3, 1:N; um por NAT_BC_CRED + CST sob o M100)
| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004* | - | S | `M105` |
| 02 | NAT_BC_CRED | C | 002* | - | S | 01, 02, 07, 12… |
| 03 | CST_PIS | N | 002* | - | S | 50–56 |
| 04 | VL_BC_PIS_TOT | N | - | 02 | N | Σ VL_BC_PIS das linhas C170 (entrada) e D101 com esse NAT + CST (base **total**, antes do rateio) |
| 05 | VL_BC_PIS_CUM | N | - | 02 | N | **vazio** (só para COD_INC_TRIB = 3). **CONFERIR**: `0,00` também é aceito. |
| 06 | VL_BC_PIS_NC | N | - | 02 | N | = 04 |
| 07 | VL_BC_PIS | N | - | 02 | N | CST 50/51/52 → = 06. CST 53–56 → parcela do grupo do pai (apropriação direta). |
| 08 | QUANT_BC_PIS_TOT | N | - | 03 | N | vazio |
| 09 | QUANT_BC_PIS | N | - | 03 | N | vazio |
| 10 | DESC_CRED | C | 060 | - | N | obrigatório só para NAT_BC_CRED = 13 |

### M200: Consolidação do PIS (nível 2, 1, O). Todos os campos S (`0,00` quando zero)
| Nº | Campo | Tipo | Tam | Dec | Regra (NC exclusivo) |
|---|---|---|---|---|---|
| 01 | REG | C | 004* | - | `M200` |
| 02 | VL_TOT_CONT_NC_PER | N | - | 02 | Σ M210.16 (VL_CONT_PER) com COD_CONT 01, 02, 03, 04 (+32) |
| 03 | VL_TOT_CRED_DESC | N | - | 02 | Σ M100.14 |
| 04 | VL_TOT_CRED_DESC_ANT | N | - | 02 | Σ 1100.13 (créditos de períodos anteriores) |
| 05 | VL_TOT_CONT_NC_DEV | N | - | 02 | 02 − 03 − 04 |
| 06 | VL_RET_NC | N | - | 02 | `0,00` (sem F600) |
| 07 | VL_OUT_DED_NC | N | - | 02 | `0,00` (sem F700) |
| 08 | VL_CONT_NC_REC | N | - | 02 | 05 − 06 − 07 |
| 09 | VL_TOT_CONT_CUM_PER | N | - | 02 | Σ M210.16 com COD_CONT 31, 51–54 (normalmente `0,00`; COD_CONT 31, da revenda de cigarros com CST 05, entra aqui com valor 0) |
| 10 | VL_RET_CUM | N | - | 02 | `0,00` |
| 11 | VL_OUT_DED_CUM | N | - | 02 | `0,00` |
| 12 | VL_CONT_CUM_REC | N | - | 02 | 09 − 10 − 11 |
| 13 | VL_TOT_CONT_REC | N | - | 02 | 08 + 12 |
Restrições: 03 + 04 ≤ 02; nenhum campo negativo.

### M205: PIS a recolher por código de receita (nível 3; O se M200.08 > 0 ou M200.12 > 0; **proibido** se ambos = 0)
| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004* | - | S | `M205` |
| 02 | NUM_CAMPO | C | 002* | - | S | `08` = parcela não cumulativa (M200.08); `12` = cumulativa (M200.12) |
| 03 | COD_REC | C | 006* | - | S | **`691201`** (PIS não cumulativo, DARF 6912, extensão DCTF `01`); cumulativo seria `810902` |
| 04 | VL_DEBITO | N | - | 02 | S | = M200.08 (ou .12) |
Σ VL_DEBITO por NUM_CAMPO = campo correspondente do M200. Exemplo: `|M205|08|691201|1234,56|`.
Desde 01/2025 o débito é declarado na DCTFWeb (MIT); o código de 6 dígitos continua o mesmo.

### M210: Detalhe da contribuição PIS, **leiaute ≥ 01/2019, 16 campos** (nível 3; O se houver CST 01/02/03/05)
Um por **COD_CONT + ALIQ_PIS + ALIQ_PIS_QUANT**.
| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004* | - | S | `M210` |
| 02 | COD_CONT | C | 002* | - | S | `01` (CST 01 a 1,65); `31` (CST 05 a 0,65, cigarros); `02`/`03` só com CST 02/03 |
| 03 | VL_REC_BRT | N | - | 02 | S | Σ C170.VL_ITEM (saídas, COD_MOD 55) + Σ C175.VL_OPR, das linhas com esse CST e alíquota |
| 04 | VL_BC_CONT | N | - | 02 | S | Σ C170.VL_BC_PIS + Σ C175.VL_BC_PIS |
| 05 | VL_AJUS_ACRES_BC_PIS | N | - | 02 | S | `0,00` (Σ M215 acréscimo; fora do escopo) |
| 06 | VL_AJUS_REDUC_BC_PIS | N | - | 02 | S | `0,00` (Σ M215 redução) |
| 07 | VL_BC_CONT_AJUS | N | - | 02 | S | 04 + 05 − 06 |
| 08 | ALIQ_PIS | N | 008 | 04 | N | `1,6500` |
| 09 | QUANT_BC_PIS | N | - | 03 | N | vazio |
| 10 | ALIQ_PIS_QUANT | N | - | 04 | N | vazio |
| 11 | VL_CONT_APUR | N | - | 02 | S | round(07 × 08 / 100, 2) |
| 12 | VL_AJUS_ACRES | N | - | 02 | S | `0,00` (Σ M220 IND_AJ = 1) |
| 13 | VL_AJUS_REDUC | N | - | 02 | S | `0,00` (Σ M220 IND_AJ = 0) |
| 14 | VL_CONT_DIFER | N | - | 02 | N | `0,00` ou vazio |
| 15 | VL_CONT_DIFER_ANT | N | - | 02 | N | `0,00` ou vazio |
| 16 | VL_CONT_PER | N | - | 02 | S | 11 + 12 − 13 − 14 + 15 |
Exemplo: `|M210|01|100000,00|90000,00|0,00|0,00|90000,00|1,6500|||1485,00|0,00|0,00|0,00|0,00|1485,00|`

### M400: Receitas não tributadas, PIS (nível 2, V; um por CST)
| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004* | - | S | `M400` |
| 02 | CST_PIS | C | 002* | - | S | `04`, `06`, `07`, `08` ou `09` (o 05 não entra: pelo PGE ≥ 2.0.5 vai para o M210) |
| 03 | VL_TOT_REC | N | - | 02 | S | Σ M410.03 = Σ C170.VL_ITEM (saídas) + Σ C175.VL_OPR com esse CST |
| 04 | COD_CTA | C | 255 | - | N | conta (obrigatória desde 11/2017; pode ser sintética) |
| 05 | DESC_COMPL | C | - | - | N | vazio |

### M410: Detalhe do M400 (nível 3, 1:N; um por NAT_REC + COD_CTA + DESC_COMPL)
| Nº | Campo | Tipo | Tam | Dec | Obrig | Regra |
|---|---|---|---|---|---|---|
| 01 | REG | C | 004* | - | S | `M410` |
| 02 | NAT_REC | C | 003* | - | S | pela tabela do CST do pai (ver abaixo) |
| 03 | VL_REC | N | - | 02 | S | receita da natureza |
| 04 | COD_CTA | C | 255 | - | N | conta analítica (obrigatória) |
| 05 | DESC_COMPL | C | - | - | N | vazio |

**NAT_REC para farmácia** (CST 04 → Tabela 4.3.10, "monofásicos, alíquotas diferenciadas"):
| NAT_REC | Descrição | NCM (prefixos) |
|---|---|---|
| **201** | Produtos farmacêuticos (Lei 10.147/2000, art. 1º, I, "a") | 3001, 3003, 3004, 3002.10.1x, 3002.10.2x, 3002.10.3x, 3002.20.1x, 3002.20.2x, 3006.30.1x, 3006.30.2x, 3002.90.20, 3002.90.92, 3002.90.99, 3005.10.10, 3006.60.00 (há exceções de NCM; ex.: 3003.90.56 e 3004.90.46 ficam fora) |
| **202** | Perfumaria, toucador e higiene pessoal (art. 1º, I, "b") | 3303, 3304, 3305, 3306, 3307, 3401.11.90, 3401.20.10, 9603.21.00 |

Os dois códigos foram confirmados em uma única fonte secundária (buscadorncm) e batem com o conhecimento do
leiaute. **CONFERIR** contra o arquivo oficial da Tabela 4.3.10 (com vigência) baixado do PVA/Portal SPED
antes de gravar em produção. A lista de NCM e as exceções também devem vir do arquivo oficial.
- **CST 06** (alíquota zero) → Tabela 4.3.13, por NCM. Na farmácia aparece pouco (ex.: alguns produtos para
  saúde). Buscar no arquivo oficial; **não** usar 201/202 para CST 06.
- CST 07/08/09 → Tabelas 4.3.14/4.3.15/4.3.16 (improvável neste perfil).
- Item com CST 04 sem NAT_REC mapeado: é erro do gerador. Não emitir código genérico; bloquear a geração e apontar o NCM.

### M500 / M505 / M600 / M605 / M610 / M800 / M810 (COFINS): espelhos exatos
Mesmos campos e na mesma ordem dos equivalentes do PIS, com os nomes trocados:
- **M500**: `REG|COD_CRED|IND_CRED_ORI|VL_BC_COFINS|ALIQ_COFINS|QUANT_BC_COFINS|ALIQ_COFINS_QUANT|VL_CRED|VL_AJUS_ACRES|VL_AJUS_REDUC|VL_CRED_DIFER|VL_CRED_DISP|IND_DESC_CRED|VL_CRED_DESC|SLD_CRED|` (15 campos; alíquota `7,6000`)
- **M505**: `REG|NAT_BC_CRED|CST_COFINS|VL_BC_COFINS_TOT|VL_BC_COFINS_CUM|VL_BC_COFINS_NC|VL_BC_COFINS|QUANT_BC_COFINS_TOT|QUANT_BC_COFINS|DESC_CRED|` (10 campos)
- **M600**: `REG|VL_TOT_CONT_NC_PER|VL_TOT_CRED_DESC|VL_TOT_CRED_DESC_ANT|VL_TOT_CONT_NC_DEV|VL_RET_NC|VL_OUT_DED_NC|VL_CONT_NC_REC|VL_TOT_CONT_CUM_PER|VL_RET_CUM|VL_OUT_DED_CUM|VL_CONT_CUM_REC|VL_TOT_CONT_REC|` (13 campos; 03 = Σ M500.14; 04 = Σ 1500.13)
- **M605**: `REG|NUM_CAMPO|COD_REC|VL_DEBITO|`, com COD_REC **`585601`** (COFINS não cumulativa, DARF 5856); cumulativa seria `217201`
- **M610** (16 campos): `REG|COD_CONT|VL_REC_BRT|VL_BC_CONT|VL_AJUS_ACRES_BC_COFINS|VL_AJUS_REDUC_BC_COFINS|VL_BC_CONT_AJUS|ALIQ_COFINS|QUANT_BC_COFINS|ALIQ_COFINS_QUANT|VL_CONT_APUR|VL_AJUS_ACRES|VL_AJUS_REDUC|VL_CONT_DIFER|VL_CONT_DIFER_ANT|VL_CONT_PER|`, com as fontes C170.VL_BC_COFINS e C175.VL_BC_COFINS
- **M800**: `REG|CST_COFINS|VL_TOT_REC|COD_CTA|DESC_COMPL|`
- **M810**: `REG|NAT_REC|VL_REC|COD_CTA|DESC_COMPL|` (mesmos NAT_REC 201/202 da Tab. 4.3.10)

### M990
`|M990|QTD_LIN_M|`

---

## 9. Bloco P
`|P001|1|` e `|P990|2|`.
Desde 01/2025 não existe 0145 (NT 009/2024), portanto não há P010/P100/P200. A tabela do guia marca
"P001 O se houver 0145", mas os arquivos exportados pelo PVA trazem o bloco com IND_MOV = 1.
**CONFERIR** importando um arquivo de teste no PVA 6.2.0. Se o PVA reclamar, basta omitir P001 e P990.

## 10. Bloco 1

### 1001
`|1001|0|` se houver 1100 ou 1500; senão `|1001|1|` e `|1990|2|`.

### 1100: Controle de créditos de PIS (nível 2, V)
**Quando gerar:**
- (a) para cada M100 do período com SLD_CRED > 0 (linha do próprio período);
- (b) para cada crédito de período anterior (mesmo PER_APU_CRED + COD_CRED) que tinha SLD_CRED_FIM > 0 no mês anterior, tenha sido usado agora ou não.
Um registro por **mês de origem + COD_CRED** (não agregar meses). Crédito do próprio período usado por inteiro não gera 1100.
| Nº | Campo | Tipo | Tam | Dec | Obrig | (a) crédito do período | (b) crédito de período anterior P |
|---|---|---|---|---|---|---|---|
| 01 | REG | C | 004* | - | S | `1100` | `1100` |
| 02 | PER_APU_CRED | N | 006 | - | S | MMAAAA do período | MMAAAA de P |
| 03 | ORIG_CRED | N | 002* | - | S | `01` | `01` |
| 04 | CNPJ_SUC | N | 014* | - | N | vazio | vazio |
| 05 | COD_CRED | N | 003* | - | S | COD_CRED do M100 | idem |
| 06 | VL_CRED_APU | N | - | 02 | S | M100.12 (VL_CRED_DISP) | M100.12 da EFD de P |
| 07 | VL_CRED_EXT_APU | N | - | 02 | N | vazio | vazio |
| 08 | VL_TOT_CRED_APU | N | - | 02 | S | = 06 | = 06 |
| 09 | VL_CRED_DESC_PA_ANT | N | - | 02 | S | M100.14 (descontado no próprio período) | 1100(mês anterior).09 + 1100(mês anterior).13 |
| 10 | VL_CRED_PER_PA_ANT | N | - | 02 | N | vazio | acumulado de PER anteriores (só para os códigos 201…308) |
| 11 | VL_CRED_DCOMP_PA_ANT | N | - | 02 | N | vazio | acumulado de DCOMP (só 301…308) |
| 12 | SD_CRED_DISP_EFD | N | - | 02 | S | 08 − 09 − 10 − 11 (= M100.15) | 08 − 09 − 10 − 11 |
| 13 | VL_CRED_DESC_EFD | N | - | 02 | N | **`0,00`** (o uso do próprio período já está no M200.03) | valor usado agora (vai para o M200.04) |
| 14 | VL_CRED_PER_EFD | N | - | 02 | N | vazio | vazio |
| 15 | VL_CRED_DCOMP_EFD | N | - | 02 | N | vazio | vazio |
| 16 | VL_CRED_TRANS | N | - | 02 | N | vazio | vazio |
| 17 | VL_CRED_OUT | N | - | 02 | N | vazio | vazio |
| 18 | SLD_CRED_FIM | N | - | 02 | N | 12 − 13 − 14 − 15 − 16 − 17 | idem |
Regras: Σ 1100.13 = M200.04; ordem por PER_APU_CRED crescente e depois COD_CRED.
O gerador precisa **guardar o estado** (os 1100/1500 do mês anterior, ou os M100 das EFD transmitidas) para
fazer o rollover. Saldos de antes da adoção do sistema entram por importação manual.

### 1500: Controle de créditos de COFINS
Idêntico ao 1100 (mesmos 18 campos, na mesma ordem). A origem é o M500. **1500.18 (SLD_CRED_FIM) é obrigatório (S).**
Σ 1500.13 = M600.04.

### 1990
`|1990|QTD_LIN_1|`

---

## 11. Algoritmo de apuração

### 11.1 Linhas de receita (saídas; C100 IND_OPER = 1, COD_SIT ∉ {02, 03, 04, 05})
Para cada C170 (mod. 55) e C175 (mod. 65), gerar uma linha por tributo:
`{cst, aliq, recBrt: C170.VL_ITEM | C175.VL_OPR, bc: VL_BC_x, codCta}`, com PIS e COFINS separados.
- CST ∈ {01, 02, 03, 05}: agrupar por COD_CONT + alíquota (+ alíquota em quantidade) e gerar M210/M610:
  - 03 = Σ recBrt; 04 = Σ bc; 07 = 04 (sem M215);
  - 11 = round(07 × aliq / 100, 2), **calculado sobre a base somada** e não somando o VL_PIS das linhas;
  - 16 = 11.
- CST ∈ {04, 06, 07, 08, 09}: agrupar por CST para o M400/M800 (03 = Σ recBrt) e por (NAT_REC, COD_CTA) para o M410/M810.
- CST 49 e 99: não entram no Bloco M.

### 11.2 Linhas de crédito (C170 de entrada com CST 50–56 e CFOP da tabela de crédito; D101/D105 com CST 50–56)
- Chave do M105: **NAT_BC_CRED + CST**. VL_BC_TOT = Σ bases.
- CST 50 → M100 COD_CRED `101`; 51 → `201`; 52 → `301`.
- CST 53 com apropriação direta: o sistema informa a parte "tributada" (T) e a "não tributada" (N) e gera dois M105 (07 = T sob 101; 07 = N sob 201), ambos com 04 = 06 = total.
  - Regra do gerador para o frete de venda misto: repartir pelo valor dos itens CST 01 × CST 04/06 das NF-e vinculadas.
  - A diferença de centavos vai para o último grupo, para que Σ 07 = 06.
- M100 por (COD_CRED, alíquota): 04 = Σ M105.07; 08 = round(04 × 1,65 / 100, 2); 12 = 08.

### 11.3 Contribuição NC
`NC_PIS = Σ M210.16 (COD_CONT 01–04)`; `CUM_PIS = Σ M210.16 (31, 51–54)`. O mesmo vale para a COFINS com o M610.

### 11.4 Uso dos créditos (por tributo, separado)
```
restante = NC
# política configurável; padrão: saldos anteriores primeiro (mais antigo primeiro, por causa da decadência de 5 anos)
for r in 1100_anteriores ordenados por PER_APU_CRED, COD_CRED (grupo 1xx, depois 2xx, depois 3xx):
    r.13 = min(r.12, restante); restante -= r.13; r.18 = r.12 - r.13
for m in M100 ordenados por COD_CRED (101, 102, ..., 201, ..., 301):
    m.14 = min(m.12, restante); restante -= m.14
    m.13 = '0' if m.14 == m.12 else '1';  m.15 = m.12 - m.14
M200.03 = Σ M100.14 ; M200.04 = Σ 1100.13
M200.05 = 02 - 03 - 04 ; 06 = 0 ; 07 = 0 ; 08 = 05
M200.09 = CUM ; 10 = 0 ; 11 = 0 ; 12 = 09 ; 13 = 08 + 12
M205: se 08 > 0 → (08, '691201', M200.08); se 12 > 0 → (12, '810902', M200.12)
1100: linhas (a) para M100 com 15 > 0; linhas (b) para todos os saldos anteriores
```
A COFINS repete o processo com M500, M600, M605 (`585601` / `217201`) e 1500.
A ordem "atuais primeiro" também é válida; deixar como parâmetro por empresa.

### 11.5 Checagens antes de gravar
- Σ C170/C175 CST 01 (PIS) = M210.04; M210.11 ≈ Σ VL_PIS das linhas (tolerância de ±0,01 por linha).
- M400 por CST = Σ receitas com esse CST; M410 soma = M400.03.
- M200.03 + M200.04 ≤ M200.02.
- Todo COD_CTA existe no 0500; todo COD_PART, UNID e COD_ITEM existe no 0140 do estabelecimento correto.
- `0110.COD_TIPO_CONT = 1` ⇒ nenhum M210/M610 com COD_CONT 02/03.

### 11.6 Bloco 9 (fechamento)
| Registro | Campos | Regra |
|---|---|---|
| 9001 | `REG C 004*`, `IND_MOV N 001*` | `|9001|0|` |
| 9900 | `REG`, `REG_BLC C 004`, `QTD_REG_BLC N` | Uma linha por tipo de registro presente, **na ordem de primeira aparição no arquivo**, inclusive `9001`, `9900`, `9990` e `9999`. QTD de 9900 = nº de linhas 9900 (inclusive a própria). |
| 9990 | `REG`, `QTD_LIN_9 N` | 9001 + todas as 9900 + 9990 + **9999** |
| 9999 | `REG`, `QTD_LIN N` | total de linhas do arquivo, inclusive a própria |
```
tipos = [ordem de aparição de REG nas linhas 0000..1990] + ['9001','9900','9990','9999']
n9900 = len(tipos); qtd9990 = 1 + n9900 + 1 + 1; qtd9999 = linhasAte1990 + qtd9990
```
Cada x990: nº de linhas do bloco, contando o x001 e o x990. O leitor (`validarEstrutura`) confere 9900,
x990 (somando por 1º caractere do REG, portanto o bloco 9 inclui o 9999) e 9999.

---

## 12. Pendências regulatórias que afetam o gerador (fora da lista de registros)

1. **LC 224/2025 (a partir de 01/04/2026)**. A redução linear de 10% alcança as operações a alíquota zero (CST 06) e isentas (CST 07).
   - A NT 012/2026 manda manter o CST 06/07 no documento, colocar a frase "Operação sujeita ao disposto na Lei Complementar Nº 224 DE 26/12/2025" em `infAdFisco`, reproduzi-la no **C110** e lançar o débito residual por **ajuste no Bloco M**.
   - As fontes secundárias divergem sobre o registro: uma diz M220/M620 (e M110/M510 no crédito presumido), outra diz M215/M615.
   - Nenhum desses registros está na lista pedida. **CONFERIR** a NT 012/2026 oficial.
   - Para a farmácia, a **revenda monofásica (CST 04) em regra fica fora** da redução, pelas fontes consultadas. **CONFERIR.** Itens CST 06 vendidos a partir de 04/2026 podem exigir o ajuste.
2. **Cancelamento ou devolução em período posterior**: exige M215/M615 + 1050 (venda) ou M110/M510 (compra). Fora da lista.
3. **0900**: obrigatório se o arquivo original for transmitido **depois do prazo** (10º dia útil do 2º mês seguinte). Fora da lista: o gerador deve bloquear ou avisar.
4. **Retenções (F600) e deduções (F700)**: fora do escopo. M200.06/07 ficam em 0.

---

## 13. Índices que o leitor `contribuicoes.ts` usa (`f[i]` = campo i+1)

| Registro | Índices lidos | Campo |
|---|---|---|
| 0000 | f[1] COD_VER, f[2] TIPO_ESCRIT, f[4] NUM_REC_ANTERIOR, f[5] DT_INI, f[6] DT_FIN, f[7] NOME, f[8] CNPJ, f[9] UF, f[10] COD_MUN, f[12] IND_NAT_PJ, f[13] IND_ATIV | 02,03,05,06,07,08,09,10,11,13,14 |
| 0100 | f[1] NOME, f[2] CPF, f[3] CRC, f[4] CNPJ, f[10] FONE, f[12] EMAIL, f[13] COD_MUN | 02,03,04,05,11,13,14 |
| 0110 | f[1..4] | 02–05 |
| 0140 | f[2] NOME, f[3] CNPJ, f[4] UF, f[5] IE, f[6] COD_MUN | 03–07 |
| C100 | f[1] IND_OPER, f[2] IND_EMIT, f[4] COD_MOD, f[5] COD_SIT, f[7] NUM_DOC, f[8] CHV_NFE, f[9] DT_DOC, f[11] VL_DOC, f[25] VL_PIS, f[26] VL_COFINS | 02,03,05,06,08,09,10,12,26,27 |
| C170 | f[6] VL_ITEM, f[7] VL_DESC, f[10] CFOP, f[24] CST_PIS, f[29] VL_PIS, f[30] CST_COFINS, f[35] VL_COFINS | 07,08,11,25,30,31,36 |
| C175 | f[1] CFOP, f[2] VL_OPR, f[3] VL_DESC, f[4] CST_PIS, f[9] VL_PIS, f[10] CST_COFINS, f[15] VL_COFINS | 02,03,04,05,10,11,16 |
| M200/M600 | f.slice(1): [0] = campo 02 … [7] = campo 09, [1] = 03, [11] = 13 | |
| M400/M800 | f[1] CST, f[2] VL_TOT_REC | 02, 03 |

Observação de consistência: o leitor calcula a receita como **VL_ITEM − VL_DESC** (C170) e
**VL_OPR − VL_DESC** (C175), e compara com o M400.03 (tolerância R$ 1). Pela regra do guia, o M400.03 soma o
**VL_ITEM/VL_OPR bruto**. Com desconto relevante em itens CST 04, o leitor vai alertar mesmo com o arquivo
correto. **CONFERIR** qual das duas o PVA usa e alinhar o leitor ou o gerador.

---

## 14. Fontes
- Notas locais do Guia Prático EFD-Contribuições v1.35: `docs/sped/contrib_cap1-3.md`, `contrib_bloco0_A.md`, `contrib_blocoC.md`, `contrib_blocosDFIP.md`, `contrib_blocosM19.md`.
- PVA vigente 6.2.0: https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/download/sped/efdc
- NT 009/2024 (PGE 6.0.0: fim do 0145/CPRB em 01/2025 e D500 campo 23): https://portalspedbrasil.com.br/forum/efd-contribuicoes-versao-6-0-0-do-pge-nota-tecnica-efd-contribuicoes-no-009/
- NT 011/2026 (sem alteração de leiaute em 2026; fim para fatos geradores a partir de 01/2027; IBS/CBS fora dos valores): https://documentacao.senior.com.br/exigenciaslegais/noticias/federal/2026/2026-02-04-nota-tecnica-11-2026-descontinuidade-efd-contribuicoes-com-orientacoes-para-contribuintes-pis-e-cofins/
- NT 012/2026 (LC 224/2025): http://sped.rfb.gov.br/arquivo/download/8126 (oficial, não acessível daqui); resumos em https://www.contabeis.com.br/noticias/77353/rfb-novas-regras-para-reducao-linear-de-incentivos-na-efd-contribuicoes/ e https://portalspedbrasil.com.br/forum/nota-tecnica-012-2026-orienta-sobre-a-efd-contribuicoes-com-a-red-linear-da-lc-224-2025/
- Tabela 4.3.10, NAT_REC 201/202: https://buscadorncm.com.br/pis-cofins-monofasico
- Registro 1100 (campos e regras): https://www.vriconsulting.com.br/guias/guiasIndex.php?idGuia=536
- Guia Prático 1.35 (última versão encontrada): https://www.gov.br/sped/pt-br/assuntos/escrituracoes-digitais/efd-contribuicoes/manuais/guia_pratico_efd_contribuicoes_versao_1_35-18_06_2021.pdf/@@display-file/file
