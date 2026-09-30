# EFD-ICMS/IPI — Blocos D e E (notas de desenvolvimento)

Fonte: Guia Prático EFD-ICMS/IPI v3.2.2 (atualização 11/02/2026), linhas 10498–15496 do `guia_icms_ipi.txt` (págs. 171–251).
Público: comércio no ES (farmácias/varejo), com ST e DIFAL. Objetivo: gerar e validar EFD a partir de XML (NF-e 55, NFC-e 65, CT-e 57/67) e calcular a apuração (E110/E210/E310).

Convenções:
- **[GUIA]**: regra literal do Guia.
- **[EXT]**: conhecimento externo ao trecho lido (MOC CT-e, Tabelas da NT 44/2018, legislação ES). É preciso confirmar/parametrizar.
- O = obrigatório, OC = obrigatório condicional, N = não apresentar. Datas `ddmmaaaa`; decimais com vírgula no arquivo.

---

## PARTE 1 — BLOCO D (serviços de transporte e comunicação)

Para empresa comercial, o uso relevante é a **ENTRADA de CT-e (tomador do frete)**: D100 (IND_OPER=0, IND_EMIT=1) + D190 (+ D101 raramente, + D195/D197 se houver ajuste).

### D001 — Abertura
| Nº | Campo | Regra |
|---|---|---|
| 01 | REG | "D001" |
| 02 | IND_MOV | 0 = com dados; 1 = sem dados. Se 1, só D001 + D990. |

### D100 — NF Serv. Transporte (07), CTRC (08, 8B), 09, 10, 11, 26, 27, **CT-e (57)**, BP-e (63), **CT-e OS (67)**
Nível 2, vários por arquivo.

**Chave de unicidade [GUIA]:** terceiros = IND_EMIT+NUM_DOC+COD_MOD+SER+SUB+COD_PART; próprios = IND_EMIT+NUM_DOC+COD_MOD+SER+SUB; desde 01/01/2014 **+ CHV_CTE**.

**Regra do enfoque do declarante [GUIA]:** na entrada, VL_BC_ICMS, VL_ICMS e a alíquota **só são informados se o tomador tiver direito ao crédito**.

**Todo D100 exige ≥1 D190**, com estas exceções [GUIA]:
- **Exc. 1**: COD_SIT 02/03 (cancelado) ou 04 (denegado) → só REG, IND_OPER, IND_EMIT, COD_MOD, COD_SIT, SER, SUB, NUM_DOC, CHV_CTE; o resto fica `||`; sem filhos. COD_SIT 05 (inutilizado) → mesmos campos, **sem** CHV_CTE. Desde 01/2023 os códigos 04 e 05 foram descontinuados; desde 12/2021 (Aj. SINIEF 28 e 39/2021) não é obrigatório escriturar denegados/inutilizados.
- **Exc. 2**: COD_SIT 06/07 (complementar e complementar extemporâneo) → são obrigatórios só REG, IND_OPER, IND_EMIT, COD_PART, COD_MOD, COD_SIT, SER, SUB, NUM_DOC, CHV_CTE e DT_DOC. D190 continua obrigatório.
- **Exc. 3**: COD_SIT 08 (regime especial) → D100 + D190 obrigatórios; CHV_CTE obrigatória para o modelo 57.
- **Exc. 4**: CT-e/CT-e OS de emissão própria → só D100 + D190 (+ D195/D197; + D101 em caso de EC 87/15). CT-e Simplificado de saída (a partir de 01/2025) → D130.
- **Exc. 5**: documento emitido por terceiro em nome do contribuinte (consórcio) → emissão de terceiros, COD_SIT=08; o PVA emite advertência.
- **Exc. 6**: BP-e (63) → sem COD_PART, SUB e IND_FRT; não é escriturado nas entradas.

| Nº | Campo | Tipo/Tam | Ent | Saí | Regras [GUIA] | Mapeamento CT-e XML [EXT] |
|---|---|---|---|---|---|---|
| 01 | REG | C 4 | O | O | "D100" | — |
| 02 | IND_OPER | C 1 | O | O | 0 = aquisição; 1 = prestação | tomador = informante → 0 |
| 03 | IND_EMIT | C 1 | O | O | 0 = própria; 1 = terceiros. Se 1, IND_OPER tem de ser 0. | CNPJ do emit ≠ 0000 → 1 |
| 04 | COD_PART | C 60 | O | O | Prestador (aquisição) ou tomador (prestação); deve existir no 0150 (exceto BP-e) | `emit` (CNPJ, IE, xNome, enderEmit) → 0150 |
| 05 | COD_MOD | C 2 | O | O | [07,08,8B,09,10,11,26,27,57,63,67] | `ide/mod` (57 ou 67) |
| 06 | COD_SIT | N 2 | O | O | [00..08] | 00 normal; 02 se houver evento de cancelamento; 06 se `tpCTe`=1 (complemento) [EXT] |
| 07 | SER | C 4 | OC | OC | Para 57/67: **3 posições**; sem série → "000" | `ide/serie`, com zeros à esquerda até 3 posições |
| 08 | SUB | C 3 | OC | OC | — | vazio |
| 09 | NUM_DOC | N 9 | O | O | > 0 | `ide/nCT` |
| 10 | CHV_CTE | N 44 | OC | OC | Obrigatória para 57/63/67 (exceto COD_SIT 05). Confere o DV; confere NUM_DOC/SER com a chave; na emissão própria, CNPJ base da chave = 0000 e UF da chave = UF do 0000 | `infCte/@Id` sem o prefixo "CTe" |
| 11 | DT_DOC | N 8 | O | O | ≤ DT_FIN do 0000. Modelos 07/09/10/11/26/27 só com data < 01/01/2019 | `ide/dhEmi` |
| 12 | DT_A_P | N 8 | O | OC | Aquisição: ≤ DT_FIN e ≥ DT_DOC. Prestação: ≥ DT_DOC, se informada | data de entrada/escrituração (definida pelo usuário) |
| 13 | TP_CT-e | N 1 | OC | OC | Obrigatório para 57/63/67 | `ide/tpCTe` (0 normal, 1 complemento, 2 anulação, 3 substituto; 5/6 simplificado) [EXT] |
| 14 | CHV_CTE_REF | N 44 | OC | OC | Só quando TP_CT-e = 3 ou 6 | `infCteSub/chCte` [EXT] |
| 15 | VL_DOC | N 2d | O | O | — | `vPrest/vTPrest` |
| 16 | VL_DESC | N 2d | OC | OC | — | `vTPrest - vRec` quando houver diferença [EXT] |
| 17 | IND_FRT | C 1 | O | OC | Desde 07/2012: 0 = emitente; 1 = destinatário/remetente; 2 = terceiros; 9 = sem frete. Não informar em BP-e. | derivado de `toma3/toma` ou `toma4` + papel do informante na NF de origem [EXT] |
| 18 | VL_SERV | N 2d | O | O | Inclui pedágio e demais despesas. CT-e simplificado de saída: = Σ D130.VL_FRT | `vPrest/vTPrest` |
| 19 | VL_BC_ICMS | N 2d | OC | OC | Só com direito a crédito | `imp/ICMS/ICMSxx/vBC` |
| 20 | VL_ICMS | N 2d | OC | OC | idem | `imp/ICMS/ICMSxx/vICMS` |
| 21 | VL_NT | N 2d | OC | OC | valor não tributado | VL_SERV − BC, quando isento/NT |
| 22 | COD_INF | C 6 | OC | OC | Deve existir no 0450 | — |
| 23 | COD_CTA | C | OC | OC | conta contábil | — |
| 24 | COD_MUN_ORIG | N 7 | OC | O | IBGE; 9999999 = exterior; 9999998 = CT-e simplificado. **Obrigatório na entrada para 57/63/67.** No BP-e, deve ser da UF do 0000. | `ide/cMunIni` |
| 25 | COD_MUN_DEST | N 7 | OC | O | IBGE; 9999999 = exterior; nunca 9999998 (proibido a partir de 2027). Obrigatório na entrada para 57/63/67. | `ide/cMunFim` |

Regra de crédito do frete [GUIA, campo 17]: "o tomador é quem contratou a transportadora e pagou o serviço; **só ele tem direito ao crédito**". O sistema deve comparar o CNPJ do tomador do CT-e (`toma3/toma` 0=remetente, 1=expedidor, 2=recebedor, 3=destinatário; ou `toma4/CNPJ`) com o CNPJ do 0000. Se o informante não for o tomador, **não escriturar o CT-e** (ou escriturar sem crédito, conforme a política do cliente).

Regras de crédito [EXT] a parametrizar:
- CT-e de transportador do Simples Nacional (`ICMSSN`): sem crédito. Informar D190 com CST de enfoque do declarante (ex.: 090) e VL_ICMS = 0.
- `ICMS60` (ST no transporte, com retenção pelo tomador): o ICMS é devido pelo tomador. É tratado por ajuste/obrigação conforme o RICMS-ES; não gera crédito normal.
- CFOP de entrada para o comércio: 1353/2353 (aquisição de serviço de transporte por estabelecimento comercial). O CT-e traz o CFOP do prestador (5353/6353, 5352…), por isso **converter para o CFOP de entrada** do declarante.
- Frete sobre compras de mercadoria sujeita a ST (farmácia) ou isenta: normalmente **não há crédito**, porque a saída não é tributada. O sistema deve permitir marcar o CT-e "sem crédito" com base nas NF-e vinculadas (`infDoc/infNFe/chave`).

### D101 — Complemento EC 87/15 (CT-e/BP-e/CT-e OS para consumidor final não contribuinte)
Nível 3, 1:1. Obrigatório a partir de 01/2016 em prestação interestadual para não contribuinte. **Não apresentar** se a UF de COD_MUN_ORIG for igual à UF de COD_MUN_DEST, nem se algum deles for 9999999. Para o BP-e interestadual, é obrigatório. Alimenta o E300/E310.
| Nº | Campo | Regra | CT-e [EXT] |
|---|---|---|---|
| 02 | VL_FCP_UF_DEST | O | `imp/ICMSUFFim/vFCPUFFim` |
| 03 | VL_ICMS_UF_DEST | O | `imp/ICMSUFFim/vICMSUFFim` |
| 04 | VL_ICMS_UF_REM | O | `imp/ICMSUFFim/vICMSUFIni` |
Na prática, uma farmácia **não emite CT-e**, então o D101 não se aplica às entradas dela.

### D190 — Registro analítico (C/D por CST+CFOP+ALIQ)
Nível 3, 1:N. Na entrada, o CST segue o **enfoque do declarante** (obrigatório desde 07/2012).
| Nº | Campo | Tipo | Regra [GUIA] |
|---|---|---|---|
| 02 | CST_ICMS | N 3 | Tabela 4.3.1; **1º dígito sempre 0** |
| 03 | CFOP | N 4 | Não pode ser título (x00/x50). IND_OPER=0 → começa com 1/2/3; IND_OPER=1 → 5/6/7 |
| 04 | ALIQ_ICMS | N 6,2 | OC |
| 05 | VL_OPR | N 2d | O |
| 06 | VL_BC_ICMS | N 2d | O; **Σ D190.VL_BC_ICMS = D100.VL_BC_ICMS** |
| 07 | VL_ICMS | N 2d | O; **Σ D190.VL_ICMS = D100.VL_ICMS** |
| 08 | VL_RED_BC | N 2d | O; só pode ser > 0 se o CST terminar em 20 ou 70 |
| 09 | COD_OBS | C 6 | OC; deve existir no 0460 |

Montagem a partir do CT-e: normalmente uma única linha. CST = "0"+`CST` do grupo ICMS; CFOP de entrada convertido; ALIQ = `pICMS`; VL_OPR = `vTPrest`; BC e ICMS vêm do XML se houver crédito, senão 0; VL_RED_BC = vTPrest − vBC quando o CST for 20.

### D195 — Observações do lançamento fiscal
Nível 3, 1:N. Campos: COD_OBS (O, deve existir no 0460) e TXT_COMPL (OC). Usado quando a legislação estadual exige ajuste no documento (ex.: diferencial de alíquota). "Sempre que existir um ajuste por documento deverá ... ocorrer uma observação." É o pai do D197.

### D197 — Outras obrigações, ajustes e informações do documento
Nível 4, 1:N. **Só para UFs que publicaram a Tabela 5.3.**
| Nº | Campo | Tipo | Regra |
|---|---|---|---|
| 02 | COD_AJ | C 10 | Tabela 5.3 da UF do informante |
| 03 | DESCR_COMPL_AJ | C | Obrigatório na prática para códigos genéricos |
| 04 | COD_ITEM | C 60 | Só para NF de serviço de transporte (modelo 07) de saída |
| 05 | VL_BC_ICMS | N | BC do ICMS ou do ICMS-ST |
| 06 | ALIQ_ICMS | N 6,2 | |
| 07 | VL_ICMS | N | Valor do ajuste (ICMS ou ICMS-ST). **Vai direto para a apuração.** |
| 08 | VL_OUTROS | N | Usado em códigos informativos |

O destino do valor depende do **3º caractere do COD_AJ** (Tabela 5.3). Ver o mapa na seção E110. Sub-apuração (4º caractere 3–8): um estorno de débito (3º=2) gera **crédito no E110 + débito no 1920**; um estorno de crédito (3º=5) gera **débito no E110 + crédito no 1920** (registro 1900).

### Demais registros do Bloco D (só transportadoras e telecom; não gerar para comércio)
- **D110/D120** — itens e complemento da NF de Serviço de Transporte (mod. 07), só na saída.
- **D130** — complemento do CTRC (08/8B) e do **CT-e Simplificado** (57, TP_CT-e 5/6, desde 01/2025): consignatário, redespacho, IND_FRT_RED, municípios, VL_LIQ_FRT/VL_FRT > 0 se IND_FRT ≠ 9.
- **D140** (aquaviário 09), **D150** (aéreo 10), **D160/D161/D162** (carga transportada, local de coleta/entrega, NFs transportadas; D162 não é gerado para CFOP 5359/6359), **D170/D180** (multimodal 26 e modais). Só na saída.
- **D300/D301/D310** — bilhetes de passagem consolidados (13–16) por CST/CFOP/ALIQ; CFOP começa com 5; VL_OPR = VL_SERV + VL_SEG + VL_OUT_DESP − VL_DESC.
- **D350/D355/D360/D365/D370/D390** — ECF de bilhetes (2E, 13–16), Redução Z, totalizadores.
- **D400/D410/D411/D420** — Resumo de Movimento Diário (18).
- **D500/D510/D530/D590** — NF de comunicação/telecom (21/22). **Relevante para o comércio: conta de telefone e internet recebida (D500 IND_OPER=0 + D590).** Crédito só se houver direito (em regra o comércio não tem crédito de comunicação, conforme a LC 87/96 art. 33 [EXT]). O D510 não é informado pelo adquirente.
- **D600/D610/D690** — consolidação de 21/22 de quem não está no Conv. 115/03. **D695/D696/D697** — quem está no Conv. 115/03 (inclui TV por assinatura).
- **D700/D730/D731/D735/D737** — **NFCom (62)**, individual. Relevante para a entrada de conta de telecom emitida em NFCom. Nas entradas, excluir os cClass 110/120/130 dos totais; não escriturar NFCom sem CST; o D731 (FCP) é informativo. **D750/D760/D761** — NFCom consolidada (saída).
- **D990** — QTD_LIN_D inclui D001 e D990.

---

## PARTE 2 — BLOCO E (apuração do ICMS e do IPI) — completo

Hierarquia:
```
E001
 E100 (período ICMS)
   E110 (apuração própria)
     E111 (ajustes 5.1.1)
       E112 (processo/DA)
       E113 (documentos)
     E115 (declaratórios 5.2)
     E116 (obrigações a recolher)
 E200 (período ST por UF)
   E210
     E220 → E230, E240
     E250
 E300 (período DIFAL/FCP por UF)
   E310
     E311 → E312, E313
     E316
 E500 (período IPI)
   E510, E520 → E530 → E531
E990
```

### E001 — Abertura do Bloco E
| Nº | Campo | Regra |
|---|---|---|
| 01 | REG | "E001" |
| 02 | IND_MOV | **Valor válido único: 0**. Sempre há E100+E110. Se 0000.IND_ATIV = 0 (industrial/equiparado), E500 e filhos são obrigatórios. |

### E100 — Período da apuração do ICMS
Nível 2, 1:N.
| Nº | Campo | Regra |
|---|---|---|
| 02 | DT_INI | DT_INI(0000) ≤ DT_INI ≤ DT_FIN(0000) e DT_INI ≤ E100.DT_FIN |
| 03 | DT_FIN | DT_INI(0000) ≤ DT_FIN ≤ DT_FIN(0000) |
Validações: não repetir (DT_INI, DT_FIN); os períodos devem cobrir o 0000 **sem lacunas nem sobreposição**. No caso normal (mensal): um E100 = período do 0000.

### E110 — Apuração do ICMS – Operações Próprias
Nível 3, obrigatório, um por E100. Deve ser informado **mesmo sem movimento** (tudo zerado). Todos os campos são N com 2 decimais e obrigatórios.

| Nº | Campo | Descrição |
|---|---|---|
| 02 | VL_TOT_DEBITOS | Débitos por saídas e prestações |
| 03 | VL_AJ_DEBITOS | Ajustes a débito vindos de documento (C197/D197…) |
| 04 | VL_TOT_AJ_DEBITOS | Ajustes a débito da apuração (E111) |
| 05 | VL_ESTORNOS_CRED | Estornos de crédito (E111) |
| 06 | VL_TOT_CREDITOS | Créditos por entradas |
| 07 | VL_AJ_CREDITOS | Ajustes a crédito vindos de documento |
| 08 | VL_TOT_AJ_CREDITOS | Ajustes a crédito da apuração (E111) |
| 09 | VL_ESTORNOS_DEB | Estornos de débito (E111) |
| 10 | VL_SLD_CREDOR_ANT | Saldo credor do período anterior |
| 11 | VL_SLD_APURADO | Saldo devedor apurado |
| 12 | VL_TOT_DED | Deduções |
| 13 | VL_ICMS_RECOLHER | ICMS a recolher (11 − 12) |
| 14 | VL_SLD_CREDOR_TRANSPORTAR | Saldo credor a transportar |
| 15 | DEB_ESP | Recolhidos/a recolher extra-apuração |

#### Fórmulas campo a campo [GUIA]

Data de competência do documento ("data de corte"):
- C100/C500/D700: `DT_E_S`; D100/D500: `DT_A_P`; se vazio, usar `DT_DOC`.
- C300/C405/C600/C800/C860/D300/D355/D400/D600/D700/D750: `DT_DOC`. C700/D695: `DT_DOC_FIN`.
- Documento conta se a data estiver dentro de [E100.DT_INI, E100.DT_FIN].
- Na UF que escritura pela data de emissão, se DT_E_S for posterior a E100.DT_FIN, **não preencher DT_E_S**.

**02 VL_TOT_DEBITOS**
```
Σ VL_ICMS de C190, C320, C390, C490, C590, C690, C790, C850, C890,
             D190, D300, D390, D410, D590, D690, D696, D730, D760
  somente de documentos de SAÍDA (CFOP 5/6/7) no período,
  EXCLUINDO: COD_SIT = 01 (extemporâneo) e 07 (complementar extemporâneo),
             CFOP 5605 (transferência de saldo devedor)
  INCLUINDO: CFOP 1605 (recebimento de saldo devedor por transferência)
```
Observação: o 1605 é CFOP de entrada, mas soma no débito. O 5605 é CFOP de saída, mas soma no crédito.

**03 VL_AJ_DEBITOS**
```
Σ VL_ICMS de C197, C597, C857, C897, D197, D737
  onde COD_AJ[3] ∈ {'3','4','5'} e COD_AJ[4] ∈ {'0','3','4','5','6','7','8'}
  documentos no período (DT_E_S de C100/C500/D700; DT_DOC ou DT_A_P de D100; DT_E_S vazio → DT_DOC)
  EXCLUI COD_SIT 01 e 07 (vão para DEB_ESP)
```

**04 VL_TOT_AJ_DEBITOS** = Σ E111.VL_AJ_APUR onde COD_AJ_APUR[3]='0' e [4]='0'

**05 VL_ESTORNOS_CRED** = Σ E111.VL_AJ_APUR onde [3]='0' e [4]='1'

**06 VL_TOT_CREDITOS**
```
Σ VL_ICMS de C190, C590, D190, D590, D730
  de documentos de ENTRADA (CFOP 1/2/3) no período (DT_E_S / DT_A_P; se vazio, DT_DOC)
  EXCLUINDO CFOP 1605; INCLUINDO CFOP 5605
  COD_SIT 01 e 07: SOMAM no PRIMEIRO período E100 (não são excluídos, ao contrário dos débitos)
```

**07 VL_AJ_CREDITOS**
```
Σ VL_ICMS de C197, C597, C857, C897, D197, D737
  onde COD_AJ[3] ∈ {'0','1','2'} e COD_AJ[4] ∈ {'0','3','4','5','6','7','8'}
  no período; COD_SIT 01/07 → primeiro período E100
```

**08 VL_TOT_AJ_CREDITOS** = Σ E111 onde [3]='0' e [4]='2'

**09 VL_ESTORNOS_DEB** = Σ E111 onde [3]='0' e [4]='3'

**10 VL_SLD_CREDOR_ANT** = E110.VL_SLD_CREDOR_TRANSPORTAR do período anterior. O Guia não dá fórmula de validação: o valor vem do arquivo anterior e o sistema deve guardá-lo por estabelecimento/competência.

**11 VL_SLD_APURADO**
```
X = (VL_TOT_DEBITOS + VL_AJ_DEBITOS + VL_TOT_AJ_DEBITOS + VL_ESTORNOS_CRED)
  − (VL_TOT_CREDITOS + VL_AJ_CREDITOS + VL_TOT_AJ_CREDITOS + VL_ESTORNOS_DEB + VL_SLD_CREDOR_ANT)
se X ≥ 0: VL_SLD_APURADO = X  e  VL_SLD_CREDOR_TRANSPORTAR = 0
se X < 0: VL_SLD_APURADO = 0  e  VL_SLD_CREDOR_TRANSPORTAR = |X| + VL_TOT_DED
```

**12 VL_TOT_DED**
```
Σ VL_ICMS de C197/C597/C857/C897/D197/D737 com COD_AJ[3]='6' e [4]='0'
  (período: DT_DOC de C800/C860, DT_E_S de C100/C500/D700, DT_DOC/DT_A_P de D100;
   COD_SIT 01/07 → primeiro período)
+ Σ E111.VL_AJ_APUR com [3]='0' e [4]='4'
```
Informar as deduções **mesmo que VL_SLD_APURADO = 0**.

**13 VL_ICMS_RECOLHER**
```
Y = VL_SLD_APURADO − VL_TOT_DED
se Y ≥ 0: VL_ICMS_RECOLHER = Y
se Y < 0: VL_ICMS_RECOLHER = 0 e |Y| vai para VL_SLD_CREDOR_TRANSPORTAR
         (verificar se a legislação da UF permite dedução maior que o saldo devedor)
Regra cruzada: VL_ICMS_RECOLHER + DEB_ESP = Σ E116.VL_OR
```

**14 VL_SLD_CREDOR_TRANSPORTAR**
```
Z = (VL_TOT_DEBITOS + VL_AJ_DEBITOS + VL_TOT_AJ_DEBITOS + VL_ESTORNOS_CRED)
  − (VL_TOT_CREDITOS + VL_AJ_CREDITOS + VL_TOT_AJ_CREDITOS + VL_ESTORNOS_DEB
     + VL_SLD_CREDOR_ANT + VL_TOT_DED)
se Z > 0 → 0 ; se Z < 0 → |Z|   (Z = 0 → 0)
```
A consequência prática é que, quando o saldo é credor, as deduções **aumentam** o saldo credor transportado. O texto do Guia é assim, mas o PVA pode restringir isso conforme a UF: parametrizar por UF (`permite_deducao_com_saldo_credor`).

**15 DEB_ESP** (extra-apuração: não entra no saldo, mas entra no E116)
```
(a) Σ ICMS dos documentos de SAÍDA com COD_SIT = 01 ou 07 (VL_ICMS dos analíticos C190 etc.)
(b) + Σ VL_ICMS de C197/C597/C857/C897/D197/D737 com COD_AJ[3]='7' e [4]='0'
(c) + Σ E111.VL_AJ_APUR com [3]='0' e [4]='5'
Regra cruzada: DEB_ESP + VL_ICMS_RECOLHER = Σ E116.VL_OR
```

#### Mapa dos códigos de ajuste de documento (Tabela 5.3, COD_AJ com 10 caracteres: C197/D197…)
Estrutura [GUIA + EXT]: `UF(2) + 3º tipo de ajuste + 4º tipo de apuração + 4 dígitos sequenciais + (2 dígitos)`. Exemplo: `ES10000001` [EXT, formato ilustrativo].

| 3º caractere | Significado [EXT, coerente com o Guia] | 4º='0' (próprio) → E110 | 4º='1' (ST) → E210 | 4º 3..8 (sub-apuração) |
|---|---|---|---|---|
| 0 | Outros créditos | VL_AJ_CREDITOS | VL_AJ_CREDITOS_ST | VL_AJ_CREDITOS + reg. 1900 |
| 1 | Crédito por saídas (ex.: diferimento ou outros) | VL_AJ_CREDITOS | VL_AJ_CREDITOS_ST | idem |
| 2 | Estorno de débito | VL_AJ_CREDITOS | VL_AJ_CREDITOS_ST | E110 crédito + 1920 débito |
| 3 | Outros débitos | VL_AJ_DEBITOS | VL_AJ_DEBITOS_ST | idem |
| 4 | Débito por entradas (ex.: DIFAL de uso e consumo e ativo) | VL_AJ_DEBITOS | VL_AJ_DEBITOS_ST | |
| 5 | Estorno de crédito | VL_AJ_DEBITOS | VL_AJ_DEBITOS_ST | E110 débito + 1920 crédito |
| 6 | Dedução | VL_TOT_DED | VL_DEDUÇÕES_ST | |
| 7 | Débito especial (extra-apuração) | DEB_ESP | DEB_ESP_ST | |
| 9 | Informativo (usa VL_OUTROS; não entra na apuração) [EXT] | — | — | |

Observação: o Guia não cita o 4º caractere '2' (DIFAL) na Tabela 5.3 para o E310. O E310 é alimentado pelo C101/D101 e pelo E311.

### E111 — Ajuste/benefício/incentivo da apuração do ICMS (Tabela 5.1.1)
Nível 4, 1:N. Discrimina os campos 04, 05, 08, 09, 12 e 15 do E110.
| Nº | Campo | Tipo | Regra |
|---|---|---|---|
| 02 | COD_AJ_APUR | C 8 | Tabela 5.1.1 da UF (0000.UF); se a UF não tiver tabela, usar a genérica da NT 44/2018 |
| 03 | DESCR_COMPL_AJ | C | Obrigatório (na prática) para códigos genéricos |
| 04 | VL_AJ_APUR | N 2d | O |

**Estrutura do código de 8 caracteres (Tabela 5.1.1):**
```
posição 1-2 : UF (ex.: "ES")
posição 3   : tipo de apuração → 0 = ICMS próprio (E111) | 1 = ICMS-ST (E220) | 2 = DIFAL (E311) | 3 = FCP (E311)
posição 4   : natureza → 0 outros débitos | 1 estorno de créditos | 2 outros créditos
                          3 estorno de débitos | 4 deduções | 5 débitos especiais
posição 5-8 : sequencial (9999 = genérico)
```
No E111, o 3º caractere **tem de ser '0'**. Códigos genéricos (padrão confirmado para DIFAL/FCP no E311): `XX009999`, `XX019999`, `XX029999`, `XX039999`, `XX049999`, `XX059999` [o padrão para ICMS próprio é inferido por analogia com os códigos XX2x9999/XX3x9999 citados no Guia; os códigos do ES vêm da tabela oficial da SEFAZ-ES/Portal SPED].
Havendo mais de um tipo de crédito com o mesmo código → um E111 para cada tipo.

Roteamento (E111, 4º caractere → campo do E110): 0 → 04 VL_TOT_AJ_DEBITOS; 1 → 05 VL_ESTORNOS_CRED; 2 → 08 VL_TOT_AJ_CREDITOS; 3 → 09 VL_ESTORNOS_DEB; 4 → 12 VL_TOT_DED; 5 → 15 DEB_ESP.

### E112 — Informações adicionais dos ajustes (processos e documentos de arrecadação)
Nível 5, 1:N. É usado quando o ajuste decorre de processo judicial/fiscal ou de documento de arrecadação. **Pagamentos que influenciam a apuração (pagamento indevido, pagamento antecipado) devem ser detalhados aqui, com o DA.**
| Nº | Campo | Regra |
|---|---|---|
| 02 | NUM_DA | OC; nº do documento de arrecadação (no ES, o DUA [EXT]) |
| 03 | NUM_PROC | OC; até 60 caracteres |
| 04 | IND_PROC | OC; 0 Sefaz, 1 JF, 2 JE, 9 outros |
| 05 | PROC | OC; descrição resumida |
| 06 | TXT_COMPL | OC |

### E113 — Identificação dos documentos fiscais do ajuste
Nível 5, 1:N.
| Nº | Campo | Tipo | Regra |
|---|---|---|---|
| 02 | COD_PART | C 60 | Entrada = emitente/remetente; saída = adquirente. **Vazio para modelos 59, 63, 65 (NFC-e)**; facultativo para 06/66; obrigatório para os demais; deve existir no 0150 |
| 03 | COD_MOD | C 2 | Tabela 4.1.1 |
| 04 | SER | C 4 | OC |
| 05 | SUB | N 3 | OC |
| 06 | NUM_DOC | N 9 | > 0 |
| 07 | DT_DOC | N 8 | emissão |
| 08 | COD_ITEM | C 60 | Só se o ajuste for de um item específico; deve existir no 0200 |
| 09 | VL_AJ_ITEM | N 2d | O |
| 10 | CHV_DOCe | N 44 | Chave de 55, 65, 59, 57, 67, 63, 66, 62. Confere o DV e a consistência de NUM_DOC/SER com a chave |

### E115 — Valores declaratórios (Tabela 5.2)
Nível 4, 1:N. **Não entra na apuração.**
| Nº | Campo | Regra |
|---|---|---|
| 02 | COD_INF_ADIC | C 8; tabela 5.2 da SEFAZ. **Se a UF não publicou tabela, o registro não é apresentado.** |
| 03 | VL_INF_ADIC | N 2d, O |
| 04 | DESCR_COMPL_AJ | OC |
No ES [EXT]: verificar a tabela 5.2 da SEFAZ-ES (ex.: informações sobre benefícios/Invest-ES, compete). Parametrizar por UF.

### E116 — Obrigações do ICMS recolhido ou a recolher (operações próprias)
Nível 4, 1:N. **Σ VL_OR = VL_ICMS_RECOLHER + DEB_ESP (E110).**
| Nº | Campo | Tipo | Regra |
|---|---|---|---|
| 02 | COD_OR | C 3 | Tabela 5.4. **Valores válidos no E116: 000, 003, 004, 005, 006, 090** |
| 03 | VL_OR | N 2d | Sem acréscimos legais (multa/juros) |
| 04 | DT_VCTO | N 8 | Data válida |
| 05 | COD_REC | C | Código de receita da UF, conforme legislação estadual (O) |
| 06 | NUM_PROC | C 60 | OC; se preenchido, IND_PROC e PROC também são obrigatórios |
| 07 | IND_PROC | C 1 | 0, 1, 2, 9 |
| 08 | PROC | C | OC |
| 09 | TXT_COMPL | C | OC (até 12/2010, mês do débito extemporâneo) |
| 10 | MES_REF | N 6 | `mmaaaa`, O (desde 01/2011); **não pode ser posterior à competência de 0000.DT_INI** |

Tabela 5.4 [EXT, NT 44/2018]: 000 ICMS a recolher; 001 ICMS-ST pelas entradas; 002 ICMS-ST pelas saídas para o estado; 003 antecipação do diferencial de alíquotas; 004 antecipação do ICMS da importação; 005 antecipação tributária; 006 ICMS resultante da alíquota adicional dos itens incluídos no FCP; 090 outras obrigações do ICMS; 999 ICMS-ST pelas saídas para outro estado.
Uso típico no ES: 000 = ICMS normal do mês (VL_ICMS_RECOLHER). DEB_ESP de documento extemporâneo = 000 ou 090 com MES_REF do mês de origem. DIFAL de uso e consumo do comércio lançado via ajuste = 003. FCP próprio = 006.
**COD_REC do ES: o Guia não traz os códigos.** Cadastrar em tabela parametrizável (receitas do DUA SEFAZ-ES [EXT]; ex.: ICMS comércio, ICMS-ST, DIFAL, FCP). Confirmar com a SEFAZ-ES ou com o escritório antes de fixar. DT_VCTO conforme o RICMS-ES/calendário por CNAE [EXT].

### E200 — Período de apuração do ICMS-ST (por UF)
Nível 2, 1:N.
Deve ser informado: para cada UF em que o informante é substituto (inclusive a própria UF, nas operações internas com ST); para a UF para a qual vendeu sem ter inscrição; **também pelo substituído responsável pelo recolhimento na entrada interestadual quando o remetente não reteve (caso típico de farmácia no ES que compra de fora sem retenção)**.
**Obrigatório** se, por UF: Σ VL_ICMS_ST de C190/C590/C597/C690/C791 > 0; OU existe 0015 para a UF; OU existe C197/D197 com COD_AJ[4] = '1'.
| Nº | Campo | Regra |
|---|---|---|
| 02 | UF | Tabela de UF |
| 03 | DT_INI | Dentro do 0000; ≤ DT_FIN |
| 04 | DT_FIN | Dentro do 0000 |
Não repetir (UF, DT_INI, DT_FIN); por UF, sem lacuna nem sobreposição.

### E210 — Apuração do ICMS-ST
Nível 3, um por E200. Deve ser informado mesmo sem movimento.
| Nº | Campo | Fórmula / Regra [GUIA] |
|---|---|---|
| 02 | IND_MOV_ST | 0 = sem operações com ST; 1 = com operações |
| 03 | VL_SLD_CRED_ANT_ST | Saldo credor ST anterior (= campo 14 do período anterior, por UF) |
| 04 | VL_DEVOL_ST | Σ C190.VL_ICMS_ST com CFOP ∈ {1410, 1411, 1414, 1415, 1660, 1661, 1662, 2410, 2411, 2414, 2415, 2660, 2661, 2662}, data C100 (DT_E_S, ou DT_DOC se vazio) no período. Segue a legislação da UF do substituído. |
| 05 | VL_RESSARC_ST | Σ C190.VL_ICMS_ST com CFOP ∈ {1603, 2603}; só se o ressarcimento tiver origem em documento fiscal |
| 06 | VL_OUT_CRED_ST | Σ E220.VL_AJ_APUR com [3]='1' e [4] ∈ {'2','3'} **+** Σ C190.VL_ICMS_ST com CFOP iniciado em 1 ou 2 **exceto** os CFOPs de devolução do campo 04 (demais CFOPs de entrada) |
| 07 | VL_AJ_CREDITOS_ST | Σ VL_ICMS de C197/C597/C857/C897/D197/D737, por UF, com COD_AJ[3] ∈ {'0','1','2'} e [4]='1'; período via DT_E_S (C100/C500/D700), DT_DOC/DT_A_P (D100), DT_DOC (C800/C860). COD_SIT 01/07 → primeiro E200 da UF |
| 08 | VL_RETENÇAO_ST | Σ VL_ICMS_ST de C190, C590, C690, C791 **+** Σ VL_ICMS_UF de D590, D690, por UF, com CFOP iniciado em **5 ou 6** (no C791, o CFOP do pai C790). Datas: DT_DOC (C600, D600), DT_E_S (C100, C500, D500), DT_DOC_FIN (C700, D695). UF = UF do COD_PART do C100 (ou do informante, se houver ajustes); D500 = UF do COD_PART; C500 = UF do COD_PART ou do COD_MUN_DEST; C600/D600 = COD_MUN; C791 = campo UF. **Se existir C105, a UF do E200 = C105.COD_UF.** |
| 09 | VL_OUT_DEB_ST | Σ E220.VL_AJ_APUR com [3]='1' e [4] ∈ {'0','1'} |
| 10 | VL_AJ_DEBITOS_ST | Σ VL_ICMS de C197/…/D737, por UF, com COD_AJ[3] ∈ {'3','4','5'} e [4]='1'; exclui COD_SIT 01/07 (que vão para DEB_ESP_ST) |
| 11 | VL_SLD_DEV_ANT_ST | ver fórmula abaixo |
| 12 | VL_DEDUÇÕES_ST | Σ E220 com [3]='1' e [4]='4' **+** Σ VL_ICMS de C197/…/D737 com COD_AJ[3]='6' e [4]='1' (datas de C100/C500/C700 DT_E_S, D100 DT_DOC/DT_A_P) |
| 13 | VL_ICMS_RECOL_ST | = VL_SLD_DEV_ANT_ST − VL_DEDUÇÕES_ST; **+ DEB_ESP_ST = Σ E250.VL_OR** |
| 14 | VL_SLD_CRED_ST_TRANSPORTAR | ver fórmula abaixo |
| 15 | DEB_ESP_ST | (a) ICMS-ST de documentos com COD_SIT 01/07; (b) + C197/…/D737 com COD_AJ[3]='7' e [4]='1'; (c) + E220 com [3]='1' e [4]='5' |

**Fórmulas ST:**
```
D = VL_RETENCAO_ST + VL_OUT_DEB_ST + VL_AJ_DEBITOS_ST
C = VL_SLD_CRED_ANT_ST + VL_DEVOL_ST + VL_RESSARC_ST + VL_OUT_CRED_ST + VL_AJ_CREDITOS_ST
VL_SLD_DEV_ANT_ST = max(D − C, 0)
W = D − (C + VL_DEDUCOES_ST)
VL_SLD_CRED_ST_TRANSPORTAR = (W ≥ 0) ? 0 : |W|
   (descrição do campo no leiaute: [(03+04+05+06+07+12) − (08+09+10)] quando positivo)
VL_ICMS_RECOL_ST = VL_SLD_DEV_ANT_ST − VL_DEDUCOES_ST   (piso zero na prática)
VL_ICMS_RECOL_ST + DEB_ESP_ST = Σ E250.VL_OR
```

### E220 — Ajustes da apuração do ICMS-ST (Tabela 5.1.1)
Nível 4, 1:N. Discrimina VL_OUT_CRED_ST, VL_OUT_DEB_ST, VL_DEDUÇÕES_ST e DEB_ESP_ST.
| Nº | Campo | Regra |
|---|---|---|
| 02 | COD_AJ_APUR | C 8. Tabela 5.1.1 **da UF do contribuinte substituído** (ou a genérica). **3º caractere = '1'.** 4º: 0 outros débitos, 1 estorno de créditos, 2 outros créditos, 3 estorno de débitos, 4 deduções, 5 débitos especiais |
| 03 | DESCR_COMPL_AJ | OC; obrigatório para código genérico |
| 04 | VL_AJ_APUR | **> 0** |
Roteamento: 4º '0'/'1' → 09 VL_OUT_DEB_ST; '2'/'3' → 06 VL_OUT_CRED_ST; '4' → 12 VL_DEDUÇÕES_ST; '5' → 15 DEB_ESP_ST.

### E230 — Informações adicionais dos ajustes ST (processo/DA)
Nível 5, 1:N. Mesma estrutura do E112: NUM_DA, NUM_PROC (60), IND_PROC (N 1: 0/1/2/9), PROC, TXT_COMPL. Valores recolhidos com influência na apuração ST devem ser identificados aqui com o DA.

### E240 — Documentos fiscais dos ajustes ST
Nível 5, 1:N. Mesma estrutura do E113, mas **COD_PART é O** e deve existir no 0150 ("até 15 caracteres" no texto, embora o leiaute diga 60 — seguir o 60 do leiaute). Campos: COD_PART, COD_MOD (O), SER, SUB, NUM_DOC (> 0), DT_DOC (O), COD_ITEM (se o ajuste for de item; existir no 0200), VL_AJ_ITEM (O), CHV_DOCe (DV e consistência com NUM_DOC/SER).

### E250 — Obrigações do ICMS-ST recolhido ou a recolher
Nível 4, 1:N. **Σ VL_OR = VL_ICMS_RECOL_ST + DEB_ESP_ST.**
| Nº | Campo | Regra |
|---|---|---|
| 02 | COD_OR | **Válidos: 001, 002, 006, 999** |
| 03 | VL_OR | Sem acréscimos |
| 04 | DT_VCTO | Data válida |
| 05 | COD_REC | Código de receita da UF do substituído. Se E200.UF = 0000.UF e existir tabela de receitas da UF, o valor tem de estar nela |
| 06 | NUM_PROC | Se preenchido, IND_PROC e PROC também devem estar; se vazio, eles também ficam vazios |
| 07 | IND_PROC | 0, 1, 2, 9 |
| 08 | PROC, 09 TXT_COMPL | OC |
| 10 | MES_REF | `mmaaaa`, O; ≤ competência do DT_INI do 0000 |
Uso [EXT]: 001 = ST na entrada (farmácia no ES que compra de fora sem retenção, ou antecipação na entrada); 002 = ST nas saídas internas (substituto); 999 = ST para outra UF.

### E300 — Período de apuração do FCP e do DIFAL (EC 87/15), por UF
Nível 2, 1:N.
**Obrigatório** se, por UF: Σ VL_ICMS_UF_DEST (C101+D101) > 0, OU VL_ICMS_UF_REM > 0, OU VL_FCP_UF_DEST > 0, OU existe 0015 para a UF.
**Desde 01/2019, o E300 da UF de origem deixou de ser obrigatório.** Os períodos devem cobrir toda a escrituração, por UF, sem intervalos.
| Nº | Campo | Regra |
|---|---|---|
| 02 | UF | C 2; tabela de UF |
| 03 | DT_INI | Dentro do 0000; ≤ DT_FIN |
| 04 | DT_FIN | Dentro do 0000 |

**Aplicabilidade ao varejo do ES:** o E300 surge quando a loja **vende para consumidor final não contribuinte de outra UF** (NF-e 55 com `ICMSUFDest` → C101), por exemplo em e-commerce ou em venda com entrega. NFC-e (65) é operação presencial interna e **não gera DIFAL EC 87**. O DIFAL de **uso e consumo e ativo** (compra interestadual pelo contribuinte) **não** é E300: vai para o E110 via ajuste (C197 com 3º caractere '4', ou E111) e para o E116 com COD_OR 003 [EXT, conforme RICMS-ES].

### E310 — Apuração do FCP e do DIFAL (leiaute válido desde 01/01/2017)
Nível 3, um por E300; obrigatório se existir E300; deve ser informado mesmo sem movimento.
(O leiaute até 31/12/2016 tinha 14 campos, com FCP e DIFAL somados. Só é relevante para retificação de períodos antigos: ver o fim desta seção.)

| Nº | Campo | Regra [GUIA] |
|---|---|---|
| 02 | IND_MOV_FCP_DIFAL | 0 = sem operações; 1 = com operações |
| 03 | VL_SLD_CRED_ANT_DIFAL | = VL_SLD_CRED_TRANSPORTAR_DIFAL do período anterior |
| 04 | VL_TOT_DEBITOS_DIFAL | ver abaixo |
| 05 | VL_OUT_DEB_DIFAL | Σ E311 com [3]='2' e [4] ∈ {'0','1'} |
| 06 | VL_TOT_CREDITOS_DIFAL | ver abaixo |
| 07 | VL_OUT_CRED_DIFAL | Σ E311 com [3]='2' e [4] ∈ {'2','3'} |
| 08 | VL_SLD_DEV_ANT_DIFAL | max((04+05) − (03+06+07), 0) |
| 09 | VL_DEDUÇÕES_DIFAL | Σ E311 com [3]='2' e [4]='4' |
| 10 | VL_RECOL_DIFAL | max(08 − 09, 0) |
| 11 | VL_SLD_CRED_TRANSPORTAR_DIFAL | se (03+06+07+09) − (04+05) > 0, esse valor; senão 0 |
| 12 | DEB_ESP_DIFAL | ver abaixo |
| 13 | VL_SLD_CRED_ANT_FCP | = VL_SLD_CRED_TRANSPORTAR_FCP do período anterior |
| 14 | VL_TOT_DEB_FCP | ver abaixo (**0 se E300.UF = 0000.UF**) |
| 15 | VL_OUT_DEB_FCP | Σ E311 com [3]='3' e [4] ∈ {'0','1'} |
| 16 | VL_TOT_CRED_FCP | ver abaixo (**0 se E300.UF = 0000.UF**) |
| 17 | VL_OUT_CRED_FCP | Σ E311 com [3]='3' e [4] ∈ {'2','3'} |
| 18 | VL_SLD_DEV_ANT_FCP | max((14+15) − (13+16+17), 0) |
| 19 | VL_DEDUÇÕES_FCP | Σ E311 com [3]='3' e [4]='4' |
| 20 | VL_RECOL_FCP | max(18 − 19, 0) |
| 21 | VL_SLD_CRED_TRANSPORTAR_FCP | se (13+16+17+19) − (14+15) > 0, esse valor; senão 0 |
| 22 | DEB_ESP_FCP | ver abaixo |

Regra cruzada: **VL_RECOL_DIFAL + DEB_ESP_DIFAL + VL_RECOL_FCP + DEB_ESP_FCP = Σ E316.VL_OR**

Data de competência: DT_E_S (C100) / DT_A_P (D100); se vazio, DT_DOC. COD_SIT 01/07 nas saídas → DEB_ESP_* do **primeiro** período E300; nas entradas → soma no primeiro período.

**04 VL_TOT_DEBITOS_DIFAL** (saídas: C100/D100 com IND_OPER=1, COD_SIT ∉ {01,07}):
```
Σ C101.VL_ICMS_UF_REM   se E300.UF = 0000.UF                       (UF de origem)
+ Σ C101.VL_ICMS_UF_DEST se E300.UF = UF do COD_PART do C100        (UF de destino)
+ Σ D101.VL_ICMS_UF_REM  se E300.UF = UF de D100.COD_MUN_ORIG
+ Σ D101.VL_ICMS_UF_DEST se E300.UF = UF de D100.COD_MUN_DEST
```
Observação: desde 2019 a partilha acabou (100% para o destino), então VL_ICMS_UF_REM = 0 e o E300 da UF de origem é dispensado.

**06 VL_TOT_CREDITOS_DIFAL** (entradas: IND_OPER=0, ou seja, devoluções):
```
Σ C101.VL_ICMS_UF_DEST  se E300.UF = 0000.UF
+ Σ C101.VL_ICMS_UF_REM  se E300.UF = UF do COD_PART do C100
+ Σ D101.VL_ICMS_UF_DEST se E300.UF = UF do COD_MUN_DEST
+ Σ D101.VL_ICMS_UF_REM  se E300.UF = UF do COD_MUN_ORIG
```
Uso prático: uma devolução, pelo consumidor de outra UF, de venda com DIFAL gera crédito no E310 **da UF de destino**. O Guia, para C101/IND_OPER=0, usa VL_ICMS_UF_DEST quando E300.UF = UF do 0000. Na devolução, a NF de entrada é emitida pelo próprio contribuinte e o C101 repete os valores da venda: **na prática o sistema deve lançar o crédito na E300 da UF do participante**. Validar contra o PVA antes de fechar a regra.

**12 DEB_ESP_DIFAL** = Σ E311 com [3]='2' e [4]='5' + (só no primeiro período) o equivalente ao campo 04 calculado **somente com os documentos de saída com COD_SIT 01/07**.

**14 VL_TOT_DEB_FCP** (saídas, COD_SIT ∉ {01,07}):
```
Σ C101.VL_FCP_UF_DEST se E300.UF = UF do COD_PART (destinatário) do C100
+ Σ D101.VL_FCP_UF_DEST se E300.UF = UF do COD_MUN_DEST
(= 0 se E300.UF = 0000.UF ou for a UF do COD_MUN_ORIG)
```
**16 VL_TOT_CRED_FCP** (entradas/devolução):
```
Σ C101.VL_FCP_UF_DEST se E300.UF = UF do remetente (em devolução)
+ Σ D101.VL_FCP_UF_DEST se E300.UF = UF do COD_MUN_ORIG   (UF do COD_MUN_DEST → 0)
(= 0 se E300.UF = 0000.UF)
```
**22 DEB_ESP_FCP** = Σ E311 com [3]='3' e [4]='5' + (só no primeiro período) os FCP_UF_DEST de saídas com COD_SIT 01/07 (C101 pela UF do COD_PART; D101 pela UF do COD_MUN_DEST).

Mapeamento XML → C101 [EXT]: `ICMSTot/vFCPUFDest` → VL_FCP_UF_DEST; `ICMSTot/vICMSUFDest` → VL_ICMS_UF_DEST; `ICMSTot/vICMSUFRemet` → VL_ICMS_UF_REM (ou somar `det/imposto/ICMSUFDest`).

Leiaute antigo (até 31/12/2016), 14 campos: 02 IND_MOV_DIFAL, 03 VL_SLD_CRED_ANT_DIFAL, 04 VL_TOT_DEBITOS_DIFAL, 05 VL_OUT_DEB_DIFAL, 06 VL_TOT_DEB_FCP, 07 VL_TOT_CREDITOS_DIFAL, 08 VL_TOT_CRED_FCP, 09 VL_OUT_CRED_DIFAL, 10 VL_SLD_DEV_ANT_DIFAL = max((04+05+06) − (03+07+09+08), 0), 11 VL_DEDUÇÕES_DIFAL, 12 VL_RECOL = max(10 − 11, 0), 13 VL_SLD_CRED_TRANSPORTAR = max((03+07+09+08) − (04+05+06), 0), 14 DEB_ESP_DIFAL. Regra cruzada: 12 + 14 = Σ E316.

### E311 — Ajustes da apuração do FCP e do DIFAL
Nível 4, 1:N.
| Nº | Campo | Regra |
|---|---|---|
| 02 | COD_AJ_APUR | C 8, tabela 5.1.1 da UF. **3º caractere '2' = DIFAL, '3' = FCP** (desde 2017) |
| 03 | DESCR_COMPL_AJ | Obrigatório para código genérico |
| 04 | VL_AJ_APUR | **> 0** |
Códigos genéricos [GUIA]: `XX209999` outros débitos DIFAL, `XX219999` estorno de créditos DIFAL, `XX229999` outros créditos DIFAL, `XX239999` estorno de débitos DIFAL, `XX249999` deduções DIFAL, `XX259999` débito especial DIFAL; `XX309999`…`XX359999` equivalentes para o FCP. (Até 2016, a série XX2x cobria DIFAL e FCP juntos.)
Roteamento: [3]='2': 4º 0/1 → 05; 2/3 → 07; 4 → 09; 5 → 12. [3]='3': 0/1 → 15; 2/3 → 17; 4 → 19; 5 → 22.

### E312 — Informações adicionais dos ajustes DIFAL/FCP (processo/DA)
Nível 5, 1:N. Mesma estrutura do E112/E230: NUM_DA, NUM_PROC (60), IND_PROC (N 1: 0/1/2/9), PROC, TXT_COMPL.

### E313 — Documentos fiscais dos ajustes DIFAL/FCP
Nível 5, 1:N. **A ordem dos campos é diferente do E113/E240:**
02 COD_PART (OC; existir no 0150, exceto BP-e 63), 03 COD_MOD (O), 04 SER, 05 SUB, 06 NUM_DOC (> 0), **07 CHV_DOCe** (55, 57, 67, 63; DV e consistência), **08 DT_DOC** (O), 09 COD_ITEM (existir no 0200), 10 VL_AJ_ITEM (**> 0**).

### E316 — Obrigações DIFAL/FCP recolhidas ou a recolher
Nível 4, 1:N. Desde 2017: **Σ VL_OR = VL_RECOL_DIFAL + DEB_ESP_DIFAL + VL_RECOL_FCP + DEB_ESP_FCP** (até 2016: VL_RECOL + DEB_ESP_DIFAL).
| Nº | Campo | Regra |
|---|---|---|
| 02 | COD_OR | **Válidos: 000, 003, 006, 090** |
| 03 | VL_OR | Sem acréscimos |
| 04 | DT_VCTO | Data válida |
| 05 | COD_REC | Receita da UF de origem/destino. Se E300.UF = 0000.UF e existir tabela da UF, deve constar nela |
| 06–09 | NUM_PROC, IND_PROC, PROC, TXT_COMPL | NUM_PROC preenchido ↔ IND_PROC e PROC preenchidos |
| 10 | MES_REF | `mmaaaa`, O; ≤ competência de 0000.DT_INI |
Uso típico: DIFAL devido à UF de destino = 000 (ou 003); FCP = 006. **COD_REC da UF de destino** (código GNRE, quando o remetente não é inscrito no destino [EXT]).

### E500 — Período de apuração do IPI (breve)
Obrigatório se 0000.IND_ATIV = 0 (industrial/equiparado). **Farmácia/varejo em regra não gera E500.** Campos: IND_APUR (0 mensal, 1 decendial), DT_INI, DT_FIN (dentro do 0000). Pode coexistir um período mensal com decendiais; os decendiais não podem ter sobreposição nem omissão.

### E510 — Consolidação do IPI por CFOP + CST_IPI (breve)
Base: C170 ou, para NF-e própria, o C100. Campos: CFOP, CST_IPI (00–05, 49 entradas; 50–55, 99 saídas; só para contribuinte do IPI), VL_CONT_IPI, VL_BC_IPI, VL_IPI. Chave: CFOP + CST_IPI. O total de débitos e créditos do E510 deve bater com o C190 e o E520.

### E520 — Apuração do IPI (breve)
```
VL_DEB_IPI  = Σ E510.VL_IPI com CFOP 5/6
VL_CRED_IPI = Σ E510.VL_IPI com CFOP 1/2/3
VL_OD_IPI   = Σ E530.VL_AJ com IND_AJ = 0
VL_OC_IPI   = Σ E530.VL_AJ com IND_AJ = 1
S = (VL_DEB_IPI + VL_OD_IPI) − (VL_SD_ANT_IPI + VL_CRED_IPI + VL_OC_IPI)
S ≥ 0 → VL_SD_IPI = S, VL_SC_IPI = 0 ;  S < 0 → VL_SC_IPI = |S|, VL_SD_IPI = 0
```

### E530 / E531 — Ajustes do IPI (breve)
E530: IND_AJ (0 débito, 1 crédito), VL_AJ (só valores não destacados em documento, exceto transferência de crédito), COD_AJ (tabela RFB: 001, 002, 010, 011, 012, 013, 019, 098, 099 = crédito; 101, 102, 103, 199 = débito; a natureza deve casar com IND_AJ), IND_DOC (0 judicial, 1 administrativo, 2 PER/DCOMP, 3 documento fiscal, 9 outros), NUM_DOC (vazio se IND_DOC=3), DESCR_AJ (O).
E531: só quando IND_DOC = 3. Campos: COD_PART, COD_MOD ∈ {01, 55}, SER (3 posições para a 55; "000" se não houver), SUB, NUM_DOC, DT_DOC, COD_ITEM, VL_AJ_ITEM, CHV_NFE (obrigatória para a 55, com DV e consistência).

### E990 — Encerramento
QTD_LIN_E = total de linhas do bloco, **incluindo o E001 e o E990**.

---

## PARTE 3 — Algoritmo de apuração do ICMS (E110)

Entrada: registros analíticos já gerados (C190 de NF-e/NFC-e, C590, D190, D590, D730…) e ajustes (C197/D197/E111), mais o saldo credor anterior persistido.

```python
def competencia(doc):
    # C100/C500/D700: DT_E_S ; D100/D500: DT_A_P ; fallback DT_DOC
    return doc.dt_e_s or doc.dt_a_p or doc.dt_doc

def apurar_icms_proprio(periodo, docs, ajustes_doc, e111, sld_credor_ant, primeiro_periodo):
    r = zeros()
    for doc in docs:
        extemp = doc.cod_sit in ('01', '07')
        if doc.cod_sit in ('02', '03', '04', '05'):
            continue                                  # cancelado/denegado/inutilizado: sem valores
        no_periodo = periodo.contem(competencia(doc))
        for a in doc.analiticos:                      # C190/C590/D190/...
            cf = a.cfop
            saida = cf[0] in '567'
            # --- débitos ---
            if (saida and cf != '5605') or cf == '1605':
                if extemp:
                    r.DEB_ESP += a.vl_icms            # extemporâneo de saída → DEB_ESP (primeiro período)
                elif no_periodo:
                    r.VL_TOT_DEBITOS += a.vl_icms
            # --- créditos --- (só C190, C590, D190, D590, D730)
            elif (not saida and cf != '1605') or cf == '5605':
                if a.reg in ('C190', 'C590', 'D190', 'D590', 'D730'):
                    if (extemp and primeiro_periodo) or (not extemp and no_periodo):
                        r.VL_TOT_CREDITOS += a.vl_icms
    for aj in ajustes_doc:                            # C197/C597/C857/C897/D197/D737
        t, ap = aj.cod_aj[2], aj.cod_aj[3]
        extemp = aj.doc.cod_sit in ('01', '07')
        if ap in '0345678':
            if t in '345':
                if extemp: r.DEB_ESP += aj.vl         # extemporâneo → extra-apuração
                else:      r.VL_AJ_DEBITOS += aj.vl
            elif t in '012':
                r.VL_AJ_CREDITOS += aj.vl             # extemporâneo → primeiro período
        if ap == '0':
            if t == '6': r.VL_TOT_DED += aj.vl
            if t == '7': r.DEB_ESP += aj.vl
            # t == '9' → informativo, ignora
    for e in e111:                                    # COD_AJ_APUR[2] tem de ser '0'
        campo = {'0': 'VL_TOT_AJ_DEBITOS', '1': 'VL_ESTORNOS_CRED',
                 '2': 'VL_TOT_AJ_CREDITOS', '3': 'VL_ESTORNOS_DEB',
                 '4': 'VL_TOT_DED', '5': 'DEB_ESP'}[e.cod[3]]
        r[campo] += e.vl
    r.VL_SLD_CREDOR_ANT = sld_credor_ant
    deb = r.VL_TOT_DEBITOS + r.VL_AJ_DEBITOS + r.VL_TOT_AJ_DEBITOS + r.VL_ESTORNOS_CRED
    cred = (r.VL_TOT_CREDITOS + r.VL_AJ_CREDITOS + r.VL_TOT_AJ_CREDITOS
            + r.VL_ESTORNOS_DEB + r.VL_SLD_CREDOR_ANT)
    x = deb - cred
    r.VL_SLD_APURADO = max(x, 0)
    y = r.VL_SLD_APURADO - r.VL_TOT_DED
    r.VL_ICMS_RECOLHER = max(y, 0)
    z = x - r.VL_TOT_DED
    r.VL_SLD_CREDOR_TRANSPORTAR = -z if z < 0 else 0
    # E116: gerar obrigações com Σ VL_OR = VL_ICMS_RECOLHER + DEB_ESP
    #   000 → VL_ICMS_RECOLHER (MES_REF = competência) ; DEB_ESP → linhas por MES_REF de origem
    return arredonda2(r)
```
Notas de implementação:
- Trabalhar em centavos inteiros ou `Decimal`. Arredondar só no analítico (C190), como o PVA faz.
- A **NFC-e (65)** entra no C190 (via C100 por documento ou consolidada no C800/C860, conforme a UF). Todas somam no VL_TOT_DEBITOS. O C850/C890 (CF-e SAT) não se aplica ao ES [EXT].
- **Farmácia com ST (CST x60 / CSOSN 500)**: C190 com VL_ICMS = 0, então não gera débito. As entradas com ST também têm C190 com VL_ICMS = 0 (sem crédito próprio), mas **VL_ICMS_ST > 0 nas entradas não entra no E110** (só no E210 da UF).
- O CT-e (D190) de entrada com crédito entra no VL_TOT_CREDITOS.
- O saldo credor do período anterior vem do E110.14 do arquivo anterior. Cuidado com a **retificação em cascata**: alterar um mês muda todos os seguintes.
- O **DIFAL de uso e consumo e ativo imobilizado** (compra interestadual de contribuinte ES) entra via ajuste de débito: C197 com COD_AJ ES + '4' + '0' (débito por entradas, vai para VL_AJ_DEBITOS) ou E111 [4]='0'. O imposto gera E116 com COD_OR 003 ou 000, conforme o RICMS-ES [EXT]. Não usar o E300 para isso.

## PARTE 4 — Algoritmo ST (E200/E210), por UF

```python
def ufs_st(0015, docs, ajustes):
    ufs = set(u for u in reg0015)                                 # substituto inscrito
    for a in C190 + C590 + C690 + C791:
        if a.vl_icms_st > 0: ufs.add(uf_do_doc(a))                # C105.COD_UF > UF do COD_PART
    for aj in C197 + D197:
        if aj.cod_aj[3] == '1': ufs.add(uf_do_doc(aj))
    return ufs   # a UF do próprio contribuinte entra quando há ST na entrada (antecipação/substituído responsável)

CFOP_DEVOL = {'1410','1411','1414','1415','1660','1661','1662',
              '2410','2411','2414','2415','2660','2661','2662'}

def apurar_st(uf, periodo, ...):
    for c190 in analiticos_C190_do_periodo(uf):     # data: DT_E_S ou DT_DOC do C100
        cf = c190.cfop; st = c190.vl_icms_st
        if cf in CFOP_DEVOL: r.VL_DEVOL_ST += st
        elif cf in ('1603', '2603'): r.VL_RESSARC_ST += st
        elif cf[0] in '12': r.VL_OUT_CRED_ST += st   # demais entradas com ST destacado
        elif cf[0] in '56': r.VL_RETENCAO_ST += st   # também C590, C690, C791 e D590/D690 (VL_ICMS_UF)
    for e in e220:   # 3º caractere = '1'
        t = e.cod[3]
        if t in '01': r.VL_OUT_DEB_ST += e.vl
        elif t in '23': r.VL_OUT_CRED_ST += e.vl
        elif t == '4': r.VL_DEDUCOES_ST += e.vl
        elif t == '5': r.DEB_ESP_ST += e.vl
    for aj in ajustes_doc_uf:   # 4º caractere = '1'
        t = aj.cod_aj[2]
        if t in '012': r.VL_AJ_CREDITOS_ST += aj.vl
        elif t in '345': (DEB_ESP_ST if extemporaneo else VL_AJ_DEBITOS_ST) += aj.vl
        elif t == '6': r.VL_DEDUCOES_ST += aj.vl
        elif t == '7': r.DEB_ESP_ST += aj.vl
    # docs de saída com COD_SIT 01/07 → DEB_ESP_ST
    D = r.VL_RETENCAO_ST + r.VL_OUT_DEB_ST + r.VL_AJ_DEBITOS_ST
    C = (r.VL_SLD_CRED_ANT_ST + r.VL_DEVOL_ST + r.VL_RESSARC_ST
         + r.VL_OUT_CRED_ST + r.VL_AJ_CREDITOS_ST)
    r.VL_SLD_DEV_ANT_ST = max(D - C, 0)
    r.VL_ICMS_RECOL_ST = max(r.VL_SLD_DEV_ANT_ST - r.VL_DEDUCOES_ST, 0)
    w = D - C - r.VL_DEDUCOES_ST
    r.VL_SLD_CRED_ST_TRANSPORTAR = -w if w < 0 else 0
    r.IND_MOV_ST = '1' if any_movimento else '0'
    # E250: Σ VL_OR = VL_ICMS_RECOL_ST + DEB_ESP_ST (COD_OR 001/002/006/999)
```
Cenários do varejo no ES:
1. **Compra interna com ST retido pelo fornecedor** (NF-e com vICMSST ou CST 60 na origem): o C190 da entrada normalmente fica com VL_ICMS_ST = 0 (a regra de escrituração da entrada do substituído varia; muitos informam o ST retido no C190 da entrada, o que alimenta VL_OUT_CRED_ST e pode gerar saldo credor ST indevido). **Parametrizar**: `informar_icms_st_retido_na_entrada` (padrão: não informar no C190.VL_ICMS_ST quando o informante é substituído e não tem direito a ressarcimento) [EXT, validar com o escritório].
2. **Compra interestadual sem retenção (antecipação pela farmácia no ES)**: E200 para UF=ES; o débito entra via ajuste (C197 com COD_AJ ES + '3'/'4' + '1' → VL_AJ_DEBITOS_ST, ou E220 [4]='0'), com E250 COD_OR 001 e COD_REC da SEFAZ-ES [EXT].
3. **Devolução de compra com ST** (CFOP 5411/6411): o ST destacado na devolução vai para VL_RETENCAO_ST (CFOP 5/6), a menos que a UF determine outro tratamento.
4. **Ressarcimento** (CFOP 5603/6603 → quem recebe usa 1603/2603): VL_RESSARC_ST.

## PARTE 5 — Algoritmo DIFAL/FCP EC 87/15 (E300/E310)

```python
def apurar_difal(uf, periodo, docs, e311, sld_ant_difal, sld_ant_fcp, primeiro):
    uf_inf = reg0000.UF
    for doc in docs_com_C101_ou_D101:
        saida = doc.ind_oper == '1'
        extemp = doc.cod_sit in ('01', '07')
        if not (periodo.contem(competencia(doc)) or (extemp and primeiro)):
            continue
        uf_dest_c = uf_participante(doc)            # C100: UF do COD_PART
        uf_ori_d = uf_mun(doc.cod_mun_orig); uf_dst_d = uf_mun(doc.cod_mun_dest)  # D100
        v = doc.c101_ou_d101
        if doc.reg == 'C100':
            difal = (v.VL_ICMS_UF_REM if uf == uf_inf else 0) + \
                    (v.VL_ICMS_UF_DEST if uf == uf_dest_c else 0)
            fcp = v.VL_FCP_UF_DEST if (uf == uf_dest_c and uf != uf_inf) else 0
            difal_cred = (v.VL_ICMS_UF_DEST if uf == uf_inf else 0) + \
                         (v.VL_ICMS_UF_REM if uf == uf_dest_c else 0)
        else:  # D100
            difal = (v.VL_ICMS_UF_REM if uf == uf_ori_d else 0) + \
                    (v.VL_ICMS_UF_DEST if uf == uf_dst_d else 0)
            fcp = v.VL_FCP_UF_DEST if uf == uf_dst_d else 0
            difal_cred = (v.VL_ICMS_UF_DEST if uf == uf_dst_d else 0) + \
                         (v.VL_ICMS_UF_REM if uf == uf_ori_d else 0)
        if saida:
            if extemp:
                r.DEB_ESP_DIFAL += difal; r.DEB_ESP_FCP += fcp   # só no primeiro período
            else:
                r.VL_TOT_DEBITOS_DIFAL += difal; r.VL_TOT_DEB_FCP += fcp
        else:
            r.VL_TOT_CREDITOS_DIFAL += difal_cred
            r.VL_TOT_CRED_FCP += fcp_devolucao(uf)   # C101 VL_FCP_UF_DEST se uf == UF do remetente
    if uf == uf_inf:
        r.VL_TOT_DEB_FCP = r.VL_TOT_CRED_FCP = 0
    for e in e311:
        tipo, nat = e.cod[2], e.cod[3]
        alvo = {('2','0'):'VL_OUT_DEB_DIFAL', ('2','1'):'VL_OUT_DEB_DIFAL',
                ('2','2'):'VL_OUT_CRED_DIFAL', ('2','3'):'VL_OUT_CRED_DIFAL',
                ('2','4'):'VL_DEDUCOES_DIFAL', ('2','5'):'DEB_ESP_DIFAL',
                ('3','0'):'VL_OUT_DEB_FCP', ('3','1'):'VL_OUT_DEB_FCP',
                ('3','2'):'VL_OUT_CRED_FCP', ('3','3'):'VL_OUT_CRED_FCP',
                ('3','4'):'VL_DEDUCOES_FCP', ('3','5'):'DEB_ESP_FCP'}[(tipo, nat)]
        r[alvo] += e.vl
    r.VL_SLD_CRED_ANT_DIFAL = sld_ant_difal; r.VL_SLD_CRED_ANT_FCP = sld_ant_fcp
    dD = r.VL_TOT_DEBITOS_DIFAL + r.VL_OUT_DEB_DIFAL
    cD = r.VL_SLD_CRED_ANT_DIFAL + r.VL_TOT_CREDITOS_DIFAL + r.VL_OUT_CRED_DIFAL
    r.VL_SLD_DEV_ANT_DIFAL = max(dD - cD, 0)
    r.VL_RECOL_DIFAL = max(r.VL_SLD_DEV_ANT_DIFAL - r.VL_DEDUCOES_DIFAL, 0)
    r.VL_SLD_CRED_TRANSPORTAR_DIFAL = max(cD + r.VL_DEDUCOES_DIFAL - dD, 0)
    dF = r.VL_TOT_DEB_FCP + r.VL_OUT_DEB_FCP
    cF = r.VL_SLD_CRED_ANT_FCP + r.VL_TOT_CRED_FCP + r.VL_OUT_CRED_FCP
    r.VL_SLD_DEV_ANT_FCP = max(dF - cF, 0)
    r.VL_RECOL_FCP = max(r.VL_SLD_DEV_ANT_FCP - r.VL_DEDUCOES_FCP, 0)
    r.VL_SLD_CRED_TRANSPORTAR_FCP = max(cF + r.VL_DEDUCOES_FCP - dF, 0)
    r.IND_MOV_FCP_DIFAL = '1' if movimento else '0'
    # E316: Σ VL_OR = VL_RECOL_DIFAL + DEB_ESP_DIFAL + VL_RECOL_FCP + DEB_ESP_FCP
    #       (ex.: 000 DIFAL, 006 FCP; COD_REC = receita/GNRE da UF de destino)
```
Observação: o saldo credor transportado inclui as deduções (a fórmula do Guia soma VL_DEDUÇÕES no lado credor). Aplica-se o mesmo raciocínio do E110.14.

---

## PARTE 6 — Regras de validação do Bloco E (checklist para o validador)

**Estruturais**
1. E001.IND_MOV = '0'; E100 + E110 sempre presentes.
2. 0000.IND_ATIV = 0 → E500/E510/E520 obrigatórios.
3. E100: DT_INI ≤ DT_FIN; ambas dentro do 0000; união dos períodos = [0000.DT_INI, 0000.DT_FIN], sem lacuna nem sobreposição; sem duplicata.
4. Um E110 por E100, informado mesmo zerado.
5. E200 obrigatório por UF se Σ VL_ICMS_ST (C190/C590/C597/C690/C791) > 0, ou se existe 0015 da UF, ou se existe C197/D197 com COD_AJ[4]='1'. Sem duplicata (UF, DT_INI, DT_FIN); sem lacuna nem sobreposição por UF; um E210 por E200.
6. E300 obrigatório por UF se Σ C101/D101 (UF_DEST, UF_REM ou FCP) > 0 ou se existe 0015 (a UF de origem é dispensada desde 2019). Períodos contínuos por UF; E310 obrigatório se houver E300.
7. E990.QTD_LIN_E = contagem real, incluindo E001 e E990.
8. E113/E240/E313/E531: NUM_DOC > 0; CHV_DOCe com DV válido e NUM_DOC/SER conferindo com a chave; COD_PART no 0150 (E113: vazio para 59/63/65); COD_ITEM no 0200.

**Aritméticas e de cruzamento (E110)**
9. E110.02 = Σ VL_ICMS dos analíticos de saída (regras de CFOP 5605/1605, exclusão de COD_SIT 01/07 e data de competência).
10. E110.03 = Σ ajustes de documento com [3] ∈ {3,4,5} e [4] ∈ {0,3..8}, sem extemporâneos.
11. E110.04/05/08/09 = Σ E111 por 4º caractere (0/1/2/3), com 3º caractere = '0'.
12. E110.06 = Σ VL_ICMS de C190/C590/D190/D590/D730 de entrada (−1605, +5605; extemporâneo no primeiro período).
13. E110.07 = Σ ajustes de documento com [3] ∈ {0,1,2} e [4] ∈ {0,3..8}.
14. E110.11/13/14 conforme as fórmulas X/Y/Z; nunca negativos.
15. E110.12 = Σ ajustes de documento com [3]='6' e [4]='0' + Σ E111 com [4]='4'.
16. E110.15 = extemporâneos de saída + ajustes de documento com [3]='7' e [4]='0' + E111 com [4]='5'.
17. **Σ E116.VL_OR = E110.VL_ICMS_RECOLHER + E110.DEB_ESP.** Se ambos forem 0, o E116 fica ausente.
18. E111.COD_AJ_APUR: 8 caracteres, UF = 0000.UF, 3º = '0', 4º ∈ 0..5, existe na tabela 5.1.1 da UF; código genérico (9999) → DESCR_COMPL_AJ preenchida (recomendado bloquear).
19. E115 só existe se a UF publicou a tabela 5.2; o código existe na tabela.
20. E116: COD_OR ∈ {000, 003, 004, 005, 006, 090}; DT_VCTO válida; COD_REC preenchido (e na tabela da UF); MES_REF ≤ competência de 0000.DT_INI; NUM_PROC ⇒ IND_PROC + PROC.
21. VL_SLD_CREDOR_ANT = E110.14 do mês anterior (checagem entre arquivos, só advertência).

**ST (E210/E220/E250)**
22. E210.04/05/06/07/08/09/10/12/15 conforme as fórmulas por UF (CFOPs de devolução, 1603/2603, demais 1/2; retenção 5/6; E220 por 4º caractere; ajustes de documento com [4]='1').
23. E210.11 = max(D − C, 0); E210.13 = 11 − 12; E210.14 = |min(D − C − 12, 0)|.
24. **Σ E250.VL_OR = E210.13 + E210.15** (por UF).
25. E220: 3º caractere = '1'; VL_AJ_APUR > 0; código na tabela da UF do substituído.
26. E250: COD_OR ∈ {001, 002, 006, 999}; COD_REC na tabela da UF quando E200.UF = 0000.UF; NUM_PROC ↔ IND_PROC/PROC (ambos os sentidos); MES_REF ≤ competência do 0000.

**DIFAL/FCP (E310/E311/E316)**
27. E310.04/06/14/16 conforme o roteamento de UF (UF do 0000, do COD_PART, do COD_MUN_ORIG/DEST); 14 e 16 = 0 quando E300.UF = 0000.UF.
28. E310.08/10/11 e 18/20/21 conforme as fórmulas max(); 12 e 22 incluem os extemporâneos só no primeiro período.
29. **Σ E316.VL_OR = VL_RECOL_DIFAL + DEB_ESP_DIFAL + VL_RECOL_FCP + DEB_ESP_FCP** (por UF).
30. E311: 3º caractere ∈ {2, 3}; VL_AJ_APUR > 0. E313: VL_AJ_ITEM > 0.
31. E316: COD_OR ∈ {000, 003, 006, 090}; mesmas regras de COD_REC, NUM_PROC e MES_REF.

**IPI**
32. E520: 03 = Σ E510 com CFOP 5/6; 04 = Σ E510 com CFOP 1/2/3; 05/06 = Σ E530 por IND_AJ; 07/08 por S; E510 = C190 (IPI).
33. E530.COD_AJ com natureza compatível com IND_AJ; E531 só se IND_DOC = 3; E531.CHV_NFE obrigatória para a 55.

**Bloco D ligado à apuração**
34. D190.VL_BC_ICMS/VL_ICMS somados = D100.VL_BC_ICMS/VL_ICMS; CFOP coerente com IND_OPER; CST com 1º dígito 0; VL_RED_BC só com CST 20/70.
35. D100: IND_EMIT=1 ⇒ IND_OPER=0; CHV_CTE com DV válido, NUM_DOC/SER iguais aos da chave; SER com 3 posições para 57/67; DT_A_P ≥ DT_DOC e ≤ DT_FIN; COD_MUN_ORIG/DEST obrigatórios na entrada de 57/67; TP_CT-e ∈ {3, 6} ⇔ CHV_CTE_REF preenchida.
36. D197.COD_AJ na tabela 5.3 da UF; D195.COD_OBS no 0460.
37. D101 ausente se UF(orig) = UF(dest) ou se algum município for 9999999.

---

## Pendências / parametrizações (fora do Guia)
- Tabela 5.1.1 (E111/E220/E311), 5.2 (E115) e 5.3 (C197/D197) **do ES**: baixar do Portal SPED / SEFAZ-ES e carregar como tabela de referência versionada por vigência.
- Tabela 5.4 (COD_OR): confirmar a lista completa na NT 44/2018.
- **COD_REC do ES** (DUA) e datas de vencimento por atividade (RICMS-ES): o Guia não traz esses dados. Criar tabela configurável por UF, CNAE e tipo de obrigação.
- Regra do ES para escrituração pela data de entrada ou de emissão (afeta DT_E_S/DT_A_P e o corte de período).
- Política de crédito de frete (CT-e) para mercadoria com ST ou isenta; CT-e de transportador do Simples; ICMS-ST no transporte.
- Tratamento do ICMS-ST retido nas entradas do substituído (informar ou não no C190.VL_ICMS_ST).
- Tratamento do DIFAL de uso e consumo e ativo no ES (ajuste C197/E111 + COD_OR 003).
