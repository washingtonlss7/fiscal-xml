# EFD-Contribuições — Blocos M, 1 e 9 (notas de desenvolvimento)

Fonte: Guia Prático EFD-Contribuições v1.35 (18/06/2021), linhas 14422–18238 (Bloco M) e 18781–21554 (Bloco 1, Bloco 9, Anexo).
Tabelas 4.3.5 / 4.3.6 / 4.3.7 / 4.3.8 copiadas do próprio Guia (linhas ~3019–3107).
Itens marcados **[EXTERNO]** NÃO estão no Guia (conhecimento geral / legislação posterior) — conferir antes de codificar.

Convenções:
- Tipo: C = caractere, N = numérico. Tam `004*` = tamanho fixo. Dec = casas decimais. Obrig S/N.
- Valores numéricos no TXT usam vírgula decimal, sem separador de milhar (`|M100|101|0|500000|1,65|...`).
- "Visão empresa": o Bloco M é consolidado por CNPJ raiz (matriz); A/C/D/F são por estabelecimento.
- PIS e COFINS são **espelhos**: M100↔M500, M105↔M505, M110↔M510, M115↔M515, M200↔M600, M205↔M605, M210↔M610, M211↔M611, M215↔M615, M220↔M620, M225↔M625, M230↔M630, M300↔M700, M400↔M800, M410↔M810; 1100↔1500, 1101↔1501, 1102↔1502, 1200↔1600, 1210↔1610, 1220↔1620, 1300↔1700. **M350 (folha) só existe para PIS.** A implementação deve ser uma única rotina parametrizada por `tributo ∈ {PIS, COFINS}`.

---

## 0. Tabelas de códigos (do Guia)

### 0.1 Tabela 4.3.5 — Código de Contribuição Social Apurada (COD_CONT de M210/M610, M300/M700, NAT_CONT_REC de 1200/1600)
| Cód | Descrição | Regime (M200/M600) |
|---|---|---|
| 01 | Não-cumulativa, alíquota básica (PIS 1,65 / COFINS 7,6) | NC (campo 02) |
| 02 | Não-cumulativa, alíquotas diferenciadas | NC |
| 03 | Não-cumulativa, alíquota por unidade de medida de produto | NC |
| 04 | Não-cumulativa, alíquota básica – Atividade Imobiliária (F200) | NC |
| 31 | Apurada por substituição tributária (CST 05, PIS 0,65 / COFINS 3,0) | Cum (campo 09) |
| 32 | Substituição tributária – Vendas à ZFM (CST 05, aliq ≠0 e ≠0,65/3,0, ou quant>0) | NC se PJ sujeita à NC (exclusiva ou não); Cum se PJ exclusivamente cumulativa |
| 51 | Cumulativa, alíquota básica (PIS 0,65 / COFINS 3,0) | Cum |
| 52 | Cumulativa, alíquotas diferenciadas | Cum |
| 53 | Cumulativa, alíquota por unidade de medida | Cum |
| 54 | Cumulativa, alíquota básica – Atividade Imobiliária (F200) | Cum |
| 71 | SCP – Incidência Não Cumulativa (só até 12/2013; não gerado/validado pelo PVA) | NC |
| 72 | SCP – Incidência Cumulativa (idem) | Cum |
| 99 | PIS/Pasep – Folha de Salários (usar M350; não gerado pelo PVA em M210) | — |

### 0.2 Tabela 4.3.6 — Código de Tipo de Crédito (COD_CRED de M100/M500, M230/M630, 1100/1500, 1220/1620)
Grupo = 1º dígito: **1xx** vinculado a receita tributada no MI; **2xx** receita NÃO tributada no MI; **3xx** receita de exportação.
Sufixo (igual nos 3 grupos):
| Sufixo | Tipo | Origem na geração automática |
|---|---|---|
| x01 | Alíquota básica (1,65 / 7,6) | CST + alíquota básica |
| x02 | Alíquotas diferenciadas | CST + alíquota ≠ básica |
| x03 | Alíquota por unidade de produto (R$) | ALIQ_QUANT > 0 |
| x04 | Estoque de abertura | F150 (NAT_BC_CRED = 18) |
| x05 | Aquisição de embalagens para revenda | alíquota/produto de embalagem |
| x06 | Presumido da agroindústria | CST 60–66 (agro, tab. 4.3.9) |
| x07 | Outros créditos presumidos (ex.: subcontratação transporte de cargas) | CST 60–66 (outros) |
| x08 | Importação | CFOP iniciado em 3, ou IND_ORIG_CRED = 1 |
| 109 | Atividade imobiliária (só grupo 100) | F205 / F210 |
| x99 | Outros (199, 299, 399) | — |

### 0.3 CST de crédito → grupos (M105 campo 03)
- Grupo 100 (tributada MI): CST 50, 53, 54, 56, 60, 63, 64, 66
- Grupo 200 (não tributada MI): CST 51, 53, 55, 56, 61, 63, 65, 66
- Grupo 300 (exportação): CST 52, 54, 55, 56, 62, 64, 65, 66
- Exclusivos: 50→100, 51→200, 52→300, 60→106/107, 61→206/207, 62→306/307.
- Comuns (rateio): 53/63 = 100+200; 54/64 = 100+300; 55/65 = 200+300; 56/66 = 100+200+300.

### 0.4 Tabela 4.3.7 — Natureza da Base de Cálculo do Crédito (NAT_BC_CRED de M105/M505, 1101/1501)
01 bens p/ revenda · 02 bens insumo · 03 serviços insumo · 04 energia elétrica/térmica · 05 aluguéis de prédios · 06 aluguéis máquinas/equip. · 07 armazenagem e frete na venda · 08 arrendamento mercantil · 09 imobilizado (depreciação) · 10 imobilizado (valor de aquisição) · 11 amortização/depreciação edificações e benfeitorias · 12 devolução de vendas sujeitas à NC · 13 outras operações com direito a crédito (**exige DESC_CRED em M105/M505**) · 14 transporte de cargas – subcontratação · 15 imobiliária – custo incorrido · 16 imobiliária – custo orçado · 17 limpeza/conservação – vale-transp./refeição/uniforme · 18 estoque de abertura.

### 0.5 Tabela 4.3.8 — Código de Ajuste (COD_AJ de M110/M220/M510/M620)
01 ação judicial · 02 processo administrativo · 03 legislação tributária · 04 RTT · 05 outras situações · 06 estorno · 07/08/09 (CPRB — não usar no M).
Tabela 4.3.18 (COD_AJ_BC de M215/M615/1050) é externa (portal SPED), vigente a partir de 01/2019.

### 0.6 CST de receita (saída) — destino no Bloco M
| CST | Significado | Vai para |
|---|---|---|
| 01 | Tributável alíquota básica | M210/M610 (01 ou 51 conforme alíquota/regime) |
| 02 | Alíquota diferenciada | M210/M610 (02 NC ou 52 Cum) |
| 03 | Por unidade de medida | M210/M610 (03 / 53) |
| 04 | Monofásica – revenda a alíquota zero | M400/M800 + M410/M810 (NAT_REC tab. 4.3.10 ou 4.3.11) |
| 05 | Substituição tributária | M210/M610 COD_CONT 31/32 (PGE ≥ 2.0.5: TODO CST 05, inclusive alíquota zero, vai p/ M210/M610; até 2.0.4a, CST 05 aliq. zero ia p/ M400/M800 com tab. 4.3.12) |
| 06 | Alíquota zero | M400/M800 (tab. 4.3.13) |
| 07 | Isenta | M400/M800 (tab. 4.3.14) |
| 08 | Sem incidência | M400/M800 (tab. 4.3.15) |
| 09 | Suspensão | M400/M800 (tab. 4.3.16) |
| 49 | Outras operações de saída | não totalizado no M (M400 só aceita 04–09) — ver nota em M210 campo 03 |
| 99 | Outras operações | não totalizado |

### 0.7 Tabelas de Natureza da Receita (NAT_REC, 3 posições) — M410/M810
Todas **externas**, versionadas no portal SPED (baixar os arquivos de tabela do PVA com vigência e manter por data):
- 4.3.10 Monofásicos – alíquotas diferenciadas (CST 04 revenda; também CST 02)
- 4.3.11 Monofásicos – alíquota por unidade de medida (CST 04 revenda; também CST 03)
- 4.3.12 Substituição tributária (CST 05 revenda) — só p/ PGE ≤ 2.0.4a
- 4.3.13 Alíquota zero (CST 06)
- 4.3.14 Isenção (CST 07)
- 4.3.15 Não incidência (CST 08)
- 4.3.16 Suspensão (CST 09)
- 4.3.17 Outros produtos com alíquota diferenciada (CST 02)
Regra de sistema: a NAT_REC deve ser buscada na tabela do CST do M400/M800 pai; a validade (dt_ini/dt_fim) da linha da tabela deve cobrir o período. Normalmente a NAT_REC é derivada do NCM do item (0200) — manter de-para NCM→NAT_REC por tabela.

---

## 1. BLOCO M — registros

Hierarquia / ordem física no arquivo:
```
M001 (1)
 M100 (2) ─ M105 (3), M110 (3) ─ M115 (4)
 M200 (2) ─ M205 (3), M210 (3) ─ M211 (4), M215 (4), M220 (4) ─ M225 (5), M230 (4)
 M300 (2)
 M350 (2)
 M400 (2) ─ M410 (3)
 M500 (2) ─ M505 (3), M510 (3) ─ M515 (4)
 M600 (2) ─ M605 (3), M610 (3) ─ M611 (4), M615 (4), M620 (4) ─ M625 (5), M630 (4)
 M700 (2)
 M800 (2) ─ M810 (3)
M990 (1)
```
(Filhos imediatamente após o pai, na ordem acima.)

### M001 — Abertura do Bloco M
| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG = "M001" | C | 004* | - | S |
| 02 | IND_MOV (0 = com dados; 1 = sem dados) | C | 001* | - | S |
Um por arquivo, obrigatório. IND_MOV=1 ⇒ só M001/M990; IND_MOV=0 ⇒ pelo menos 1 registro além de abertura/encerramento.

### M100 — Crédito de PIS/Pasep relativo ao período
Finalidade: consolidar o crédito NC do período, **um M100 por COD_CRED + alíquota** (e por IND_CRED_ORI: operações próprias vs sucessão). **PJ exclusivamente cumulativa NÃO preenche** (créditos admitidos no cumulativo vão em F700 → M200 campo 11).
Documentos-fonte: A100/A170, C100/C170, C190/C191, C395/C396, C500/C501, D100/D101, D500/D501, F100, F120, F130, F150 (+ F205/F210 p/ 109, F800 p/ sucessão).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "M100" | C | 004* | - | S |
| 02 | COD_CRED | Tabela 4.3.6 | C | 003* | - | S |
| 03 | IND_CRED_ORI | 0 próprias; 1 incorporação/cisão/fusão | N | 001* | - | S |
| 04 | VL_BC_PIS | Base de cálculo do crédito | N | - | 02 | N |
| 05 | ALIQ_PIS | Alíquota % | N | 008 | 04 | N |
| 06 | QUANT_BC_PIS | Base em quantidade | N | - | 03 | N |
| 07 | ALIQ_PIS_QUANT | Alíquota em R$ | N | - | 04 | N |
| 08 | VL_CRED | Crédito apurado | N | - | 02 | S |
| 09 | VL_AJUS_ACRES | Ajustes de acréscimo | N | - | 02 | S |
| 10 | VL_AJUS_REDUC | Ajustes de redução | N | - | 02 | S |
| 11 | VL_CRED_DIF | Crédito diferido no período | N | - | 02 | S |
| 12 | VL_CRED_DISP | Disponível = 08+09−10−11 | N | - | 02 | S |
| 13 | IND_DESC_CRED | 0 = usa total; 1 = usa parcial | C | 001* | - | S |
| 14 | VL_CRED_DESC | Crédito descontado no próprio período | N | - | 02 | N |
| 15 | SLD_CRED | Saldo p/ períodos futuros = 12−14 | N | - | 02 | S |

Cálculos:
- `VL_BC_PIS = Σ M105.VL_BC_PIS` (filhos). Vazio se sucessão (F800), se COD_CRED=109, ou se crédito por quantidade.
- `QUANT_BC_PIS = Σ M105.QUANT_BC_PIS`; só admitido p/ COD_CRED ∈ {103,203,303,105,205,305,108,208,308}. `ALIQ_PIS_QUANT` idem.
- `VL_CRED = QUANT_BC_PIS × ALIQ_PIS_QUANT` (quantidade) **ou** `VL_BC_PIS × ALIQ_PIS / 100`.
  - COD_CRED 109: `VL_CRED = Σ F205.VL_CRED_PIS_DESC + Σ F210.VL_CRED_PIS_UTIL`.
  - Sucessão (IND_CRED_ORI=1): `VL_CRED = Σ F800.VL_CRED_PIS` de mesmo COD_CRED.
- `VL_AJUS_ACRES = Σ M110.VL_AJ (IND_AJ=1)`; `VL_AJUS_REDUC = Σ M110.VL_AJ (IND_AJ=0)`. Preenchimento obriga M110.
- `VL_CRED_DIF`: créditos vinculados a receitas não recebidas de órgãos públicos (art. 7º Lei 9.718). Obriga M230; `Σ M100.VL_CRED_DIF = Σ M230.VL_CRED_DIF` por COD_CRED. **Validação: VL_CRED_DIF ≤ VL_CRED + VL_AJUS_ACRES − VL_AJUS_REDUC.**
- `VL_CRED_DISP = VL_CRED + VL_AJUS_ACRES − VL_AJUS_REDUC − VL_CRED_DIF`.
- `IND_DESC_CRED=0 ⇒ VL_CRED_DESC = VL_CRED_DISP`; `=1 ⇒ VL_CRED_DESC < VL_CRED_DISP` (parcial).
- `SLD_CRED = VL_CRED_DISP − VL_CRED_DESC` → se > 0, gerar registro 1100 (período atual) para controlar o saldo.
- PVA "Gerar Apurações" (Ctrl+M) só calcula campos 02–08 (e 13/14 ao descontar); **ajustes (09/10) e diferimento (11/12) não são recuperados** — devem vir do arquivo/edição. Valores gerados **sobrescrevem** os existentes.
- Ordem de aproveitamento na geração automática: do grupo de **menor** disponibilidade (100, tributada MI) para o de maior (300, exportação): 1xx → 2xx → 3xx.
- Créditos comuns (CST 53–56, 63–66): o PVA só calcula se 0110.IND_APRO_CRED = 2 (rateio proporcional pela receita bruta, usando 0111). Se = 1 (apropriação direta), o PVA calcula só CST 50,51,52,60,61,62 e a PJ edita os M105 dos CST comuns (contabilidade de custos integrada, art. 3º §8º Lei 10.637/10.833).

Exemplos do Guia (TXT):
```
|M100|101|0|500000|1,65|0||8250|0|0|0|8250|0|8250|8250|      <- (sic: campo 13=0 e 15 igual 14 no exemplo; ver nota)
|M105|02|56|1000000|200000|800000|500000||0||
|M100|201|0|200000|1,65|0||3300|0|0|0|3300|1|0|3300|
|M100|301|0|100000|1,65|0||1650|0|0|0|1650|1|0|1650|
COFINS: |M500|101|0|500000|7,6|0||38000|0|0|0|38000|1|22834,2|15165,8|
```
Nota: no 1º exemplo PIS o campo 15 aparece como 8250 com 14=8250 — inconsistente com a fórmula (15 = 12−14 = 0). Confiar na fórmula.

Exemplo "usar crédito anterior em vez do atual" (débito 500, crédito do mês 400, usar 400 de período anterior):
M100: 08=400, 12=400, 13="1", 14=100, 15=300 · M200: 02=500, 03=100, 04=400, 05=0 · 1100 (período anterior): 06=2000, 08=2000, 13=400, 18=1600.

### M105 — Detalhamento da base de cálculo do crédito (PIS)
Um M105 por **NAT_BC_CRED + CST_PIS** recuperado de A/C/D/F, vinculado ao COD_CRED do pai. Para CST comuns: 2 M105 (CST 53,54,55,63,64,65) ou 3 M105 (CST 56,66) — um sob cada M100 do grupo.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "M105" | C | 004* | - | S |
| 02 | NAT_BC_CRED | Tabela 4.3.7 | C | 002* | - | S |
| 03 | CST_PIS | CST de crédito (50–56, 60–66) | N | 002* | - | S |
| 04 | VL_BC_PIS_TOT | Base total dos documentos p/ o CST | N | - | 02 | N |
| 05 | VL_BC_PIS_CUM | Parcela vinculada a receitas cumulativas (só COD_INC_TRIB=3) | N | - | 02 | N |
| 06 | VL_BC_PIS_NC | = 04 − 05 | N | - | 02 | N |
| 07 | VL_BC_PIS | Base do tipo de crédito do pai → vai p/ M100.04 | N | - | 02 | N |
| 08 | QUANT_BC_PIS_TOT | Quantidade total | N | - | 03 | N |
| 09 | QUANT_BC_PIS | Parcela da quantidade do tipo do pai → M100.06 | N | - | 03 | N |
| 10 | DESC_CRED | Descrição (obrigatório se NAT_BC_CRED = 13) | C | 060 | - | N |

Cálculos:
- `04 = Σ VL_BC_PIS dos documentos` com esse CST e NAT_BC_CRED (A170, C170, C191, C396, C501, D101, D501, F100, F120, F130, F150 …).
- `05`: se 0110.COD_INC_TRIB = 3 e rateio (IND_APRO_CRED=2): `05 = 04 × RB_cum / RB_total` (0111). Se exclusivamente NC: 0,00 ou vazio.
- `06 = 04 − 05`.
- `07`: CST 50,51,52,60,61,62 → `07 = 06`. CST comuns com rateio (valores do 0111: T = REC_BRU_NCUM_TRIB_MI, N = REC_BRU_NCUM_NT_MI, E = REC_BRU_NCUM_EXP):
  - 53/63: grupo100 = 06×T/(T+N); grupo200 = 06×N/(T+N)
  - 54/64: grupo100 = 06×T/(T+E); grupo300 = 06×E/(T+E)
  - 55/65: grupo200 = 06×N/(N+E); grupo300 = 06×E/(N+E)
  - 56/66: grupo100 = 06×T/(T+N+E); grupo200 = 06×N/(T+N+E); grupo300 = 06×E/(T+N+E)
  - Apropriação direta: valor informado pela PJ.
- Exemplo Guia: TOT 1.000.000; 0111: T 1.250.000 (50%), N 500.000 (20%), E 250.000 (10%), Cum 500.000 (20%) → CUM 200.000, NC 800.000 → 101: 500.000; 201: 200.000; 301: 100.000.
- 08/09: só créditos por unidade (103/203/303; opcional 105/205/305, 108/208/308). CST 50/51/52 → 09 = 08; comuns → parcela.
- Arredondamento: calcular a parcela de cada grupo e jogar a diferença de centavos no último grupo para que Σ 07 = 06 (recomendação de implementação, não do Guia).

### M110 — Ajustes do crédito de PIS apurado
Detalha M100 campos 09/10. **Devoluções de compras** (bens que geraram crédito) devem ser informadas aqui como ajuste de **redução** (IND_AJ = 0).
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "M110" | C | 004* | - | S |
| 02 | IND_AJ | 0 redução; 1 acréscimo | C | 001* | - | S |
| 03 | VL_AJ | Valor | N | - | 02 | S |
| 04 | COD_AJ | Tabela 4.3.8 | C | 002* | - | S |
| 05 | NUM_DOC | Processo/documento/ato | C | - | - | N |
| 06 | DESCR_AJ | Descrição | C | - | - | N |
| 07 | DT_REF | ddmmaaaa | N | 008* | - | N |
Nível 3, 1:N. Σ VL_AJ(IND_AJ=1) = M100.09; Σ VL_AJ(IND_AJ=0) = M100.10.

### M115 — Detalhamento dos ajustes do crédito (PIS)
Disponível p/ fatos geradores a partir de 01/10/2015 (PVA 2.12). Nível 4, 1:N. Não obrigatório (conforme detalhamento do M110).
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "M115" | C | 004* | - | S |
| 02 | DET_VALOR_AJ | Parcela do VL_AJ do M110 | N | - | 02 | S |
| 03 | CST_PIS | CST da operação | N | 002* | - | N |
| 04 | DET_BC_CRED | Base do ajuste | N | - | 03 | N |
| 05 | DET_ALIQ | Alíquota do ajuste | N | 08 | 04 | N |
| 06 | DT_OPER_AJ | Data da operação | N | 008* | - | S |
| 07 | DESC_AJ | Descrição | C | - | - | N |
| 08 | COD_CTA | Conta contábil (obrig. a partir de 11/2017, exceto PJ dispensada de ECD – LP com livro caixa) | C | 255 | - | N |
| 09 | INFO_COMPL | Informação complementar | C | - | - | N |
Regra: Σ M115.DET_VALOR_AJ deve demonstrar o M110.VL_AJ.

### M200 — Consolidação da contribuição para o PIS do período
Um por arquivo, nível 2, obrigatório. Consolida NC e Cum, desconta créditos, retenções e deduções → valor a recolher.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "M200" | C | 004* | - | S |
| 02 | VL_TOT_CONT_NC_PER | Σ M210.VL_CONT_PER (COD_CONT 01,02,03,04,32*,71) | N | - | 02 | S |
| 03 | VL_TOT_CRED_DESC | Σ M100.VL_CRED_DESC | N | - | 02 | S |
| 04 | VL_TOT_CRED_DESC_ANT | Σ 1100.VL_CRED_DESC_EFD (campo 13) | N | - | 02 | S |
| 05 | VL_TOT_CONT_NC_DEV | 02 − 03 − 04 | N | - | 02 | S |
| 06 | VL_RET_NC | Retenção na fonte deduzida (NC) | N | - | 02 | S |
| 07 | VL_OUT_DED_NC | Outras deduções NC = Σ F700.VL_DED_PIS (IND_NAT_DED=0) | N | - | 02 | S |
| 08 | VL_CONT_NC_REC | 05 − 06 − 07 | N | - | 02 | S |
| 09 | VL_TOT_CONT_CUM_PER | Σ M210.VL_CONT_PER (COD_CONT 31,32**,51,52,53,54,72) | N | - | 02 | S |
| 10 | VL_RET_CUM | Retenção na fonte deduzida (Cum) | N | - | 02 | S |
| 11 | VL_OUT_DED_CUM | Outras deduções Cum ≤ Σ F700.VL_DED_PIS (IND_NAT_DED=1) | N | - | 02 | S |
| 12 | VL_CONT_CUM_REC | 09 − 10 − 11 | N | - | 02 | S |
| 13 | VL_TOT_CONT_REC | 08 + 12 | N | - | 02 | S |
\* 32 entra em NC quando a PJ está sujeita à não cumulatividade (exclusiva ou não). \*\* 32 entra em Cum quando a PJ é exclusivamente cumulativa.

Regras:
- PJ exclusivamente cumulativa (Lucro Presumido): campos 02, 03, 04, 05, 06, 07, 08 = 0.
- PJ exclusivamente NC: campos 09, 10, 11, 12 = 0.
- **03 + 04 ≤ 02.**
- **06 ≤ 05**; **10 ≤ 09**.
- Retenções (06/10) devem correlacionar com F600.VL_RET_PIS (campo 09) e, havendo saldo p/ futuro, com 1300.
- PVA Ctrl+M preenche só 02, 09, 03, 04 (sobrescrevendo); 06, 07, 10, 11 são sempre digitados/importados.
- Se a legislação não permitir desconto de créditos/retenções sobre parte da contribuição NC, ajustar M100.14 / 1100.13 e os campos 03, 04, 06, 07.
- Não há campo para "saldo credor" negativo: 08 e 12 não devem ficar negativos (limitar descontos).

### M205 — PIS a recolher: detalhamento por código de receita (visão débito DCTF)
Obrigatório a partir de PA 04/2014 (opcional 01–03/2014). Nível 3, vários.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "M205" | C | 004* | - | S |
| 02 | NUM_CAMPO | "08" (NC) ou "12" (Cum) do M200 | C | 002* | - | S |
| 03 | COD_REC | Código de receita da **DCTF, 6 dígitos** (não o de 4 dígitos do DARF) | C | 006* | - | S |
| 04 | VL_DEBITO | Valor do débito | N | - | 02 | S |
Regra: Σ VL_DEBITO (NUM_CAMPO=08) = M200.08; Σ (NUM_CAMPO=12) = M200.12. Códigos conforme ADE Codac 36/2014 (extensões publicadas no site da RFB).
O Guia só exemplifica `6912/01` (PIS NC) e `5856/01` (COFINS NC) — no 1010.

**[EXTERNO] Códigos usuais (DARF 4 díg. / DCTF 6 díg.):**
| Tributo/regime | DARF | COD_REC M205/M605 |
|---|---|---|
| PIS não cumulativo | 6912 | 691201 |
| COFINS não cumulativa | 5856 | 585601 |
| PIS cumulativo (faturamento) | 8109 | 810902 |
| COFINS cumulativa (faturamento) | 2172 | 217201 |
| PIS folha de salários (M350) | 8301 | 830102 (não vai em M205 — M205 só detalha M200.08/12) |
| PIS/COFINS instituições financeiras (Bloco I) | 4574 / 7987 | 457401 / 798701 |
Há extensões específicas (combustíveis, bebidas, etc.) — manter tabela configurável.
**[EXTERNO] DCTFWeb:** a partir do PA 01/2025 os débitos de PIS/COFINS passaram da DCTF para a DCTFWeb (módulo MIT). O M205/M605 continua usando o código de 6 dígitos; o DARF é emitido pela DCTFWeb/MIT. Conferir a legislação vigente (IN RFB 2.237/2024 e posteriores) antes de implementar integração.
Vencimento **[EXTERNO]**: até o 25º dia do mês seguinte (antecipa se não útil).

### M210 — Detalhamento da contribuição para o PIS do período
Um M210 por **COD_CONT + ALIQ_PIS_QUANT + ALIQ_PIS** (chave). Nível 3, 1:N. Dois leiautes:

**Leiaute até 31/12/2018 (13 campos)**
| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG "M210" | C | 004* | - | S |
| 02 | COD_CONT (4.3.5) | C | 002* | - | S |
| 03 | VL_REC_BRT | N | - | 02 | S |
| 04 | VL_BC_CONT | N | - | 02 | S |
| 05 | ALIQ_PIS (%) | N | 008 | 04 | N |
| 06 | QUANT_BC_PIS | N | - | 03 | N |
| 07 | ALIQ_PIS_QUANT (R$) | N | - | 04 | N |
| 08 | VL_CONT_APUR | N | - | 02 | S |
| 09 | VL_AJUS_ACRES | N | - | 02 | S |
| 10 | VL_AJUS_REDUC | N | - | 02 | S |
| 11 | VL_CONT_DIFER | N | - | 02 | N |
| 12 | VL_CONT_DIFER_ANT | N | - | 02 | N |
| 13 | VL_CONT_PER = 08+09−10−11+12 | N | - | 02 | S |

**Leiaute a partir de 01/01/2019 (16 campos)** — usar este:
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "M210" | C | 004* | - | S |
| 02 | COD_CONT | Tabela 4.3.5 | C | 002* | - | S |
| 03 | VL_REC_BRT | Receita bruta | N | - | 02 | S |
| 04 | VL_BC_CONT | Base antes de ajustes | N | - | 02 | S |
| 05 | VL_AJUS_ACRES_BC_PIS | Σ M215 acréscimo | N | - | 02 | S |
| 06 | VL_AJUS_REDUC_BC_PIS | Σ M215 redução | N | - | 02 | S |
| 07 | VL_BC_CONT_AJUS | 04 + 05 − 06 | N | - | 02 | S |
| 08 | ALIQ_PIS | % | N | 008 | 04 | N |
| 09 | QUANT_BC_PIS | Quantidade | N | - | 03 | N |
| 10 | ALIQ_PIS_QUANT | R$ | N | - | 04 | N |
| 11 | VL_CONT_APUR | Contribuição apurada | N | - | 02 | S |
| 12 | VL_AJUS_ACRES | Σ M220 IND_AJ=1 | N | - | 02 | S |
| 13 | VL_AJUS_REDUC | Σ M220 IND_AJ=0 | N | - | 02 | S |
| 14 | VL_CONT_DIFER | Σ M230.VL_CONT_DIF | N | - | 02 | N |
| 15 | VL_CONT_DIFER_ANT | Σ M300.VL_CONT_DIFER_ANT (mesmo COD_CONT) | N | - | 02 | N |
| 16 | VL_CONT_PER | 11 + 12 − 13 − 14 + 15 | N | - | 02 | S |
Ajustes relativos a fatos geradores ≤ 31/12/2018 vão nas escriturações daqueles períodos (campos 09/10 do leiaute antigo).

**Determinação do COD_CONT na geração automática (M210 PIS / M610 COFINS):**
| COD_CONT | CST | 0110.COD_INC_TRIB | ALIQ % | ALIQ R$ |
|---|---|---|---|---|
| 01 | 01 | 1 ou 3 | 1,65 / 7,6 | - |
| 51 | 01 | 2 ou 3 | 0,65 / 3,0 | - |
| 02 | 02 | 1 ou 3 | - | - |
| 52 | 02 | 2 | - | - |
| 03 | 03 | 1 ou 3 | - (ou >0*) | >0 |
| 53 | 03 | 2 | - (ou >0*) | >0 |
| 31 | 05 | - | 0,65 / 3,0 | - |
| 32 | 05 | - | ≠0 e ≠0,65/3,0 | - (ou >0 em R$) |
| 04 (F200) | 01 | 1 ou 3 | 1,65 / 7,6 | - |
| 54 (F200) | 01 | 2 ou 3 | 0,65 / 3,0 | - |
\* CST 03 com alíquota percentual > 0 também gera 03/53.
71, 72, 99 não são gerados nem validados pelo PVA.
Obs. 3 do Guia: se 0110.COD_TIPO_CONT = 2 (alíquotas específicas), deve existir ao menos um M210 com COD_CONT 02 ou 03 (NC) ou 52 ou 53 (Cum).

**Campo 03 VL_REC_BRT** (validação p/ COD_CONT 01, 51, 02, 52, 31, 32; CST da operação 01, 02, 03, 04, 05 com alíquota ≠ 0 e 49 — o "49" aparece só no texto do PIS, não no da COFINS):
- A170.VL_ITEM com A100.IND_OPER = 1
- C170.VL_ITEM com C100.IND_OPER = 1 e (COD_MOD ≠ 55, ou COD_MOD = 55 com C010.IND_ESCRI = 2)
- C181 e C491.VL_ITEM se C010.IND_ESCRI = 1 (COFINS: C185 e C495)
- C481.VL_ITEM se C010.IND_ESCRI = 2 (COFINS: C485)
- C381, C601, C870, C880, D201, D601 .VL_ITEM (COFINS: C385, C605, C870, C880, D205, D605)
- D300.VL_DOC; D350.VL_BRT; C175.VL_OPR
- F100.VL_OPER com IND_OPER = 1 ou 2
- F200.VL_TOT_REC; F500 e F510.VL_REC_CAIXA; F550 e F560.VL_REC_COMP; I100.VL_REC

**Campo 04 VL_BC_CONT** (PJ não cooperativa — 0000.IND_NAT_PJ ∈ {00,02,03,05}; COD_CONT 01,51,02,52,31,32):
- VL_BC_PIS de A170 (A100.IND_OPER=1), C170 (mesmas condições acima), C181/C491 (IND_ESCRI=1), C481 (IND_ESCRI=2), C175, C381, C601, C870, D201, D300, D350, D601, F200, F500, F550, I100
- F100.VL_BC_PIS quando ALIQ_PIS **não** consta na tabela 4.3.11 (monofásico por unidade)
- COD_CONT 03/53 ⇒ campo 04 = 0.
- Cooperativa (IND_NAT_PJ 01 ou 04) ⇒ campo 04 = M211.VL_BC_CONT.
- COFINS: usar os registros-filho equivalentes (C185/C495/C485/C385/C605/D205/D605) e VL_BC_COFINS.

**Campo 09 QUANT_BC_PIS** (COD_CONT 03, 53, 32): QUANT_BC_PIS de C170 (condições acima), C181/C491 (IND_ESCRI=1), C481 (IND_ESCRI=2), C381, C880, D350, F510, F560; e F100.VL_BC_PIS quando ALIQ_PIS consta na tab. 4.3.11. Para 01,51,02,52,31 → vazio.
**Campo 08/10**: alíquota % vazia se por unidade; alíquota R$ vazia se não for por unidade.
**Campo 11**: `QUANT_BC_PIS × ALIQ_PIS_QUANT` (unidade) ou `VL_BC_CONT_AJUS × ALIQ_PIS / 100`.
**Campos 12/13**: obrigam M220. **14**: obriga M230 (Σ M230.VL_CONT_DIF). **15**: obriga M300 (Σ M210.15 = Σ M300.VL_CONT_DIFER_ANT por COD_CONT).

SCP: até 12/2013 usar COD_CONT 71/72 com ajustes (redução em M110/M220 da ostensiva; acréscimo em M220 da SCP). A partir de 01/2014: uma EFD-Contribuições por SCP, identificada no 0035.
CST 05: a partir do PGE 2.0.5 **todas** as operações CST 05 (inclusive alíquota zero) totalizam em M210/M610.

### M211 — Sociedades cooperativas: composição da base (PIS)
Obrigatório se 0000.IND_NAT_PJ = 01 ou 04. Nível 4, 1:1.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "M211" | C | 004* | - | S |
| 02 | IND_TIP_COOP | 01 agropecuária; 02 consumo; 03 crédito; 04 eletrificação rural; 05 transp. rodov. cargas; 06 médicos; 99 outras (preponderante) | N | 002* | - | S |
| 03 | VL_BC_CONT_ANT_EXC_COOP | Base dos blocos A/C/D/F antes das exclusões (mesma regra do M210.04) | N | - | 02 | S |
| 04 | VL_EXC_COOP_GER | Exclusão geral (sobras → Fundo de Reserva e FATES) | N | - | 02 | N |
| 05 | VL_EXC_ESP_COOP | Exclusões específicas do tipo | N | - | 02 | N |
| 06 | VL_BC_CONT | 03 − 04 − 05 → M210.04 | N | - | 02 | S |

### M215 — Ajustes da base de cálculo do PIS (a partir de 01/2019)
Nível 4, 1:N. Chave: IND_AJ_BC + COD_AJ_BC + NUM_DOC + COD_CTA + DT_REF + CNPJ + INFO_COMPL.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "M215" | C | 004 | - | S |
| 02 | IND_AJ_BC | 0 redução; 1 acréscimo | C | 001* | - | S |
| 03 | VL_AJ_BC | Valor | N | - | 02 | S |
| 04 | COD_AJ_BC | Tabela 4.3.18 | C | 002* | - | S |
| 05 | NUM_DOC | Processo/ato | C | - | - | N |
| 06 | DESCR_AJ_BC | Descrição | C | - | - | N |
| 07 | DT_REF | ddmmaaaa (se não específico: último dia do mês) | N | 008* | - | N |
| 08 | COD_CTA | Conta contábil | C | 255 | - | N |
| 09 | CNPJ | Estabelecimento (matriz do 0000 se não específico) | N | 014* | - | S |
| 10 | INFO_COMPL | Complemento | C | - | - | N |
Σ IND_AJ_BC=1 = M210.05; Σ IND_AJ_BC=0 = M210.06. Deve guardar correspondência com 1050.

### M220 — Ajustes da contribuição PIS apurada
Mesmo leiaute do M110 (REG "M220", IND_AJ, VL_AJ, COD_AJ 4.3.8, NUM_DOC, DESCR_AJ, DT_REF). Nível 4, 1:N.
Σ IND_AJ=1 → M210 VL_AJUS_ACRES (campo 12 no leiaute 2019; 09 no antigo); Σ IND_AJ=0 → VL_AJUS_REDUC (13; 10 no antigo). NUM_DOC pode ser, p.ex., o documento referenciado na devolução de venda.

### M225 — Detalhamento dos ajustes da contribuição PIS
Mesmo leiaute do M115 (REG "M225", DET_VALOR_AJ S, CST_PIS, DET_BC_CRED (3 dec), DET_ALIQ, DT_OPER_AJ S, DESC_AJ, COD_CTA, INFO_COMPL). Nível 5. A partir de 10/2015. Não obrigatório (usar quando M220 não for suficientemente analítico).

### M230 — Informações adicionais de diferimento (PIS)
Detalha M210.VL_CONT_DIFER (e M100.VL_CRED_DIF) — receitas não recebidas de órgãos/empresas públicas (art. 7º Lei 9.718). Chave CNPJ + COD_CRED. Nível 4, 1:N.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "M230" | C | 004* | - | S |
| 02 | CNPJ | Ente público contratante | N | 014* | - | S |
| 03 | VL_VEND | Vendas no período | N | - | 02 | S |
| 04 | VL_NAO_RECEB | Não recebido no período | N | - | 02 | S |
| 05 | VL_CONT_DIF | Contribuição diferida | N | - | 02 | S |
| 06 | VL_CRED_DIF | Crédito diferido | N | - | 02 | N |
| 07 | COD_CRED | Tipo de crédito diferido (4.3.6) | C | 003* | - | N |
Σ 05 = M210.VL_CONT_DIFER (pai); Σ 06 por COD_CRED = Σ M100.VL_CRED_DIF desse COD_CRED.

### M300 — PIS diferido em períodos anteriores – valores a pagar no período
Nível 2, vários. Chave COD_CONT + NAT_CRED_DESC + PER_APUR + DT_RECEB.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "M300" | C | 004* | - | S |
| 02 | COD_CONT | 4.3.5 | C | 002 | - | S |
| 03 | VL_CONT_APUR_DIFER | Contribuição diferida | N | - | 02 | S |
| 04 | NAT_CRED_DESC | 01 básica; 02 diferenciada; 03 unidade; 04 presumido agro | C | 002 | - | N |
| 05 | VL_CRED_DESC_DIFER | Crédito a descontar | N | - | 02 | N |
| 06 | VL_CONT_DIFER_ANT | 03 − 05 → M210.15 | N | - | 02 | S |
| 07 | PER_APUR | mmaaaa do diferimento (≠ período atual; conforme M230 da época) | N | 006* | - | S |
| 08 | DT_RECEB | Data do recebimento (dentro do período atual) | N | 008* | - | N |

### M350 — PIS/Pasep – Folha de salários (só PIS)
Um por arquivo, nível 2. Para contribuintes do PIS-folha (IND_NAT_PJ = 02: templos, partidos, entidades imunes/isentas arts. 12 e 15 Lei 9.532, sindicatos, conselhos profissionais, fundações, condomínios) e cooperativas que façam as exclusões do art. 15 MP 2.158/2001 / art. 1º Lei 10.676/2003.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "M350" | C | 004* | - | S |
| 02 | VL_TOT_FOL | Folha de salários | N | - | 02 | S |
| 03 | VL_EXC_BC | Exclusões (salário-família, aviso prévio indenizado, FGTS rescisão, indenização por dispensa) | N | - | 02 | S |
| 04 | VL_TOT_BC | 02 − 03 | N | - | 02 | S |
| 05 | ALIQ_PIS_FOL | Valor válido: 1 (%) | N | 006 | 02 | S |
| 06 | VL_TOT_CONT_FOL | 04 × 05 / 100 | N | - | 02 | S |
Não entra no M200. **[EXTERNO]** DARF 8301.

### M400 — Receitas isentas / não alcançadas / alíquota zero / suspensão (PIS)
Nível 2, vários (um por CST). Gerado pelo PVA no Ctrl+M, **mas os M410 filhos (obrigatórios) são sempre preenchidos pela PJ.**
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "M400" | C | 004* | - | S |
| 02 | CST_PIS | Valores válidos 04, 05, 06, 07, 08, 09 | C | 002* | - | S |
| 03 | VL_TOT_REC | Receita bruta do CST = Σ M410.VL_REC | N | - | 02 | S |
| 04 | COD_CTA | Conta (pode ser sintética; filho usa nível inferior) | C | 255 | - | N |
| 05 | DESC_COMPL | Descrição complementar | C | - | - | N |
Campo 03 = soma (para o CST): A170.VL_ITEM (A100.IND_OPER=1); C170.VL_ITEM (C100.IND_OPER=1 e COD_MOD≠55 ou 55 c/ IND_ESCRI=2); C181/C491 (IND_ESCRI=1); C481 (IND_ESCRI=2); C381, C601, D201, D601 .VL_ITEM; D300.VL_DOC; D350.VL_BRT; C175.VL_OPR; F100.VL_OPER (IND_OPER 1 ou 2); F200.VL_TOT_REC; F500/F510.VL_REC_CAIXA; F550/F560.VL_REC_COMP; I100.VL_REC. CST 05 só quando alíquota zero (e só PGE ≤ 2.0.4a).
COD_CTA obrigatório a partir de 11/2017 (exceto PJ dispensada de ECD).

### M410 — Detalhamento das receitas do M400 (PIS)
Nível 3, 1:N. Chave NAT_REC + COD_CTA + DESC_COMPL. **Não gerado pelo PVA.**
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "M410" | C | 004* | - | S |
| 02 | NAT_REC | Natureza da receita (tabela conforme CST do pai: 04→4.3.10/4.3.11; 05→4.3.12; 06→4.3.13; 07→4.3.14; 08→4.3.15; 09→4.3.16) | C | 003* | - | S |
| 03 | VL_REC | Receita da natureza | N | - | 02 | S |
| 04 | COD_CTA | Conta de nível inferior à do M400 | C | 255 | - | N |
| 05 | DESC_COMPL | Descrição | C | - | - | N |
Σ VL_REC = M400.VL_TOT_REC. As receitas devem existir nos blocos A/C/D/F.

### M500 / M505 / M510 / M515 — Créditos de COFINS
Idênticos a M100/M105/M110/M115 trocando PIS→COFINS:
- Alíquota básica NC 7,6 %. Campos: VL_BC_COFINS, ALIQ_COFINS, QUANT_BC_COFINS, ALIQ_COFINS_QUANT; M505: VL_BC_COFINS_TOT/_CUM/_NC, VL_BC_COFINS, QUANT_BC_COFINS_TOT, QUANT_BC_COFINS; CST pela tabela 4.3.4.
- Documentos-fonte: A170, C170, C190/C195, C395/C396, C500/C505, D100/D105, D500/D505, F100, F120, F130, F150.
- 109: Σ F205.VL_CRED_COFINS_DESC + Σ F210.VL_CRED_COFINS_UTIL; sucessão: Σ F800.VL_CRED_COFINS.
- M500.11 (VL_CRED_DIFER) obriga M630; M500 desconta no M600; saldo → 1500.
- M505 campo 06 é de preenchimento facultativo (uniformizado com M105).

### M600 / M605 / M610 / M611 / M615 / M620 / M625 / M630 / M700 / M800 / M810 — COFINS
Idênticos aos equivalentes do PIS:
- M600 = M200 (campo 04 = Σ 1500.13; campo 07 = Σ F700.VL_DED_COFINS IND_NAT_DED=0; campo 11 ≤ Σ F700.VL_DED_COFINS IND_NAT_DED=1; retenções vs F600.VL_RET_COFINS (campo 10) e 1700).
- M605 = M205 (NUM_CAMPO 08/12 do M600; COD_REC ex.: 585601 NC, 217201 Cum).
- M610 = M210 (alíquotas 7,6 NC / 3,0 Cum; registros-fonte COFINS: C185, C495, C485, C385, C605, D205, D605 …). Leiautes 13 campos (≤2018) e 16 campos (≥2019: VL_AJUS_ACRES_BC_COFINS, VL_AJUS_REDUC_BC_COFINS, VL_BC_CONT_AJUS, ALIQ_COFINS, QUANT_BC_COFINS, ALIQ_COFINS_QUANT …).
- M611 = M211; M615 = M215 (M610 campos 05/06); M620 = M220; M625 = M225; M630 = M230 (vs M500.VL_CRED_DIF).
- M700 = M300 (→ M610.15).
- M800/M810 = M400/M410 (CST_COFINS, tabela 4.3.4).

**Relação PIS × COFINS (regras de sistema):**
- Mesmos documentos, mesmas bases na maioria dos casos; CSTs de PIS e COFINS normalmente iguais por item (validar divergência como alerta).
- Alíquotas padrão: NC PIS 1,65 / COFINS 7,6; Cum PIS 0,65 / COFINS 3,0.
- Cada M2xx tem um M6xx espelho; M100↔M500 com mesmos COD_CRED; 1100↔1500.
- M350 não tem espelho.

### M990 — Encerramento do Bloco M
| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG = "M990" | C | 004* | - | S |
| 02 | QTD_LIN_M | N | - | - | S |
QTD_LIN_M = nº de linhas do Bloco M **incluindo M001 e M990**.

---

## 2. BLOCO 1 — Complemento: controle de saldos, retenções, processos, extemporâneos

Escriturado na visão da empresa.

| Registro | Nível | Finalidade | Quando gerar |
|---|---|---|---|
| **1001** | 1 | Abertura (IND_MOV **N** 001*: 0 com dados / 1 sem dados) | Sempre |
| **1010** | 2 | Processo referenciado – ação judicial | Sempre que houver registro "x99 Processo Referenciado" (A/C/D/F…/1809/P199) vinculado a ação judicial, ou decisão com exigibilidade suspensa |
| **1011** | 3 | Detalhamento das contribuições com exigibilidade suspensa | A partir de 01/2020 (leiaute 006): ≥1 por 1010 com IND_NAT_ACAO 12–19 |
| **1020** | 2 | Processo referenciado – processo administrativo | Quando houver processo administrativo que autorize tratamento específico |
| **1050** | 2 | Detalhamento de ajustes de base de cálculo – valores extra apuração | A partir de 01/2019; espelha M215/M615 segregando por CST |
| **1100** | 2 | Controle de créditos fiscais – PIS | Sempre que houver saldo de crédito NC de períodos anteriores a utilizar, ou saldo do próprio período (M100.SLD_CRED > 0) |
| **1101** | 3 | Crédito extemporâneo – documentos (PIS) | Só PA ≤ 07/2013 (a partir de 08/2013 o PVA dá erro; usar retificação) |
| **1102** | 4 | Crédito extemporâneo vinculado a mais de um tipo de receita (PIS) | Idem, CST 53–56/63–66 |
| **1200** | 2 | Contribuição social extemporânea – PIS | Só PA ≤ 07/2013 |
| **1210** | 3 | Detalhamento da contribuição extemporânea – PIS | Idem |
| **1220** | 3 | Crédito descontado da contribuição extemporânea – PIS | Idem |
| **1300** | 2 | Controle dos valores retidos na fonte – PIS | Retenções do período/anteriores com dedução/saldo (correlação com M200.06/10 e F600) |
| **1500/1501/1502** | 2/3/4 | = 1100/1101/1102 para COFINS | idem |
| **1600/1610/1620** | 2/3/3 | = 1200/1210/1220 para COFINS | idem |
| **1700** | 2 | = 1300 para COFINS | idem (vs M600) |
| **1800** | 2 | Incorporação imobiliária – RET | Incorporadora com empreendimento optante do RET |
| **1809** | 3 | Processo referenciado (do 1800) | Se RET com processo |
| **1900** | 2 | Consolidação dos documentos emitidos – Lucro Presumido (caixa ou competência) | PJ do LP que escritura receitas consolidadas em F500/F510 (caixa) ou F550/F560 (competência). **Obrigatório a partir de 04/2013, mesmo sem receita (valor 0 e qtd 0)** |
| **1990** | 1 | Encerramento (QTD_LIN_1, inclui 1001 e 1990) | Sempre |

### 1010 — Processo referenciado – ação judicial
Campos: 01 REG; 02 NUM_PROC (C 020, S); 03 ID_SEC_JUD (C, S); 04 ID_VARA (C 002, S); 05 IND_NAT_ACAO (C 002*, S): 01 transitada em julgado a favor; 02 não transitada a favor; 03 liminar MS; 04 liminar cautelar; 05 antecipação de tutela; 06 depósito integral; 07 PJ não é autora; 08 súmula vinculante STF/STJ; 09 liminar MS coletivo; 12–17, 19 = versões "exigibilidade suspensa" de 02–07/09; 99 outros; 06 DESC_DEC_JUD (C 100, N) — efeitos + parcela com exigibilidade suspensa (ex.: `6912/01=R$10.000,00 e 5856/01=R$18.000,00`); 07 DT_SENT_JUD (N 008*, N; essencial à validação).
Regra-chave: base/alíquota/CST diferentes da lei só com decisão **transitada em julgado**; sem trânsito, apurar pela lei e informar a parcela suspensa (DCTF + 1011 a partir de 2020).

### 1011 — Detalhamento das contribuições com exigibilidade suspensa (≥ 01/2020)
Campos: 01 REG; 02 REG_REF (C 004*, N — nome do registro, maiúsculas, ex. "C170"); 03 CHAVE_DOC (C 090, N — validada p/ C100/C180/C190/C500/D100); 04 COD_PART (0150); 05 COD_ITEM (0200); 06 DT_OPER (S); 07 VL_OPER (S, > 0); 08 CST_PIS (S); 09 VL_BC_PIS (4 dec); 10 ALIQ_PIS; 11 VL_PIS; 12 CST_COFINS (S); 13 VL_BC_COFINS; 14 ALIQ_COFINS; 15 VL_COFINS; 16 CST_PIS_SUSP (S); 17 VL_BC_PIS_SUSP; 18 ALIQ_PIS_SUSP; 19 VL_PIS_SUSP; 20 CST_COFINS_SUSP (S); 21 VL_BC_COFINS_SUSP; 22 ALIQ_COFINS_SUSP; 23 VL_COFINS_SUSP; 24 COD_CTA (obrig. exceto dispensada de ECD; deve existir no 0500); 25 COD_CCUS; 26 DESC_DOC_OPER.
Campos 08–15 = escrituração pela lei; 16–23 = conforme decisão (campos não afetados repetem o 1º grupo). Parcela suspensa = VL_x − VL_x_SUSP.

### 1020 — Processo referenciado – processo administrativo
02 NUM_PROC (C 020, S); 03 IND_NAT_ACAO (01 consulta; 02 despacho decisório; 03 ADE; 04 ADI; 05 DRJ/CARF; 06 auto de infração; 99 outros); 04 DT_DEC_ADM (S).

### 1050 — Ajustes de base de cálculo – valores extra apuração (≥ 01/2019)
02 DT_REF (S); 03 IND_AJ_BC (tab. 4.3.18, C 002*); 04 CNPJ (S); 05 VL_AJ_TOT; 06–16 VL_AJ_CST01, 02, 03, 04, 05, 06, 07, 08, 09, 49, 99 (todos S); 17 IND_APROP (01 PIS e COFINS; 02 só PIS; 03 só COFINS); 18 NUM_REC (recibo; se de outra escrituração, 41 posições maiúsculas); 19 INFO_COMPL.
Regra: 05 = Σ 06..16 (implícito); valores devem corresponder aos M215/M615 por CNPJ. Em 01/2019, excepcionalmente, pode demonstrar ajustes de períodos ≤ 2018.

### 1100 — Controle de créditos fiscais – PIS (1500 = COFINS)
Chave: PER_APU_CRED + ORIG_CRED + CNPJ_SUC + COD_CRED. **Um registro por mês de origem** (não agregar meses). Não é preciso escriturar créditos do próprio período totalmente utilizados.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "1100" | C | 004* | - | S |
| 02 | PER_APU_CRED | mmaaaa (≤ período atual) | N | 006 | - | S |
| 03 | ORIG_CRED | 01 próprias; 02 sucedida | N | 002* | - | S |
| 04 | CNPJ_SUC | CNPJ cedente (se 02) | N | 014* | - | N |
| 05 | COD_CRED | 4.3.6 | N | 003* | - | S |
| 06 | VL_CRED_APU | Crédito apurado na origem (= M100.VL_CRED_DISP do mesmo COD_CRED no período de origem; ou DACON fichas 06A/06B (COFINS 16A/16B); ou Σ F800.VL_CRED_PIS p/ sucessão) | N | - | 02 | S |
| 07 | VL_CRED_EXT_APU | Extemporâneo (Σ 1101/1102) | N | - | 02 | N |
| 08 | VL_TOT_CRED_APU | 06 + 07 | N | - | 02 | S |
| 09 | VL_CRED_DESC_PA_ANT | Descontado no período de origem e posteriores, anteriores ao atual (inclui M100.VL_CRED_DESC da origem) | N | - | 02 | S |
| 10 | VL_CRED_PER_PA_ANT | Ressarcimento (PER) anteriores — só COD_CRED 201,202,203,204,208,301,302,303,304,307,308 | N | - | 02 | N |
| 11 | VL_CRED_DCOMP_PA_ANT | DCOMP intermediária anteriores — só 301,302,303,304,308 | N | - | 02 | N |
| 12 | SD_CRED_DISP_EFD | 08 − 09 − 10 − 11 | N | - | 02 | S |
| 13 | VL_CRED_DESC_EFD | Descontado neste período → Σ = M200.04 | N | - | 02 | N |
| 14 | VL_CRED_PER_EFD | PER neste período (mesmos códigos do 10) | N | - | 02 | N |
| 15 | VL_CRED_DCOMP_EFD | DCOMP intermediária neste período (mesmos do 11) | N | - | 02 | N |
| 16 | VL_CRED_TRANS | Transferido em cisão/fusão/incorporação (vai p/ F800 da sucessora) | N | - | 02 | N |
| 17 | VL_CRED_OUT | Outras formas | N | - | 02 | N |
| 18 | SLD_CRED_FIM | 12 − 13 − 14 − 15 − 16 − 17 | N | - | 02 | N (1100) / **S** (1500) |
Implementação — rollover mensal: `1100(mês M+1).09 = 1100(M).09 + 1100(M).13 + …` (acumular usos anteriores); linha do crédito do próprio período (quando M100.SLD_CRED > 0): 02 = período atual, 06 = M100.12, 09 = M100.14, 13 = 0, 18 = M100.15 (interpretação — o desconto do próprio período está em M200.03, não em M200.04).

### 1101 / 1102 (PIS) e 1501 / 1502 (COFINS) — Crédito extemporâneo
**Não válidos para PA ≥ 08/2013** (IN RFB 1.387/2013 permite retificar em 5 anos; o PVA gera erro). Manter só para leitura/validação de arquivos antigos.
1101: 02 COD_PART; 03 COD_ITEM; 04 COD_MOD; 05 SER; 06 SUB_SER; 07 NUM_DOC; 08 DT_OPER (S); 09 CHV_NFE; 10 VL_OPER (S); 11 CFOP; 12 NAT_BC_CRED (S); 13 IND_ORIG_CRED 0/1 (S); 14 CST_PIS (S); 15 VL_BC_PIS (3 dec, S); 16 ALIQ_PIS (4 dec, S); 17 VL_PIS = BC×ALIQ (unid.) ou BC×ALIQ/100 (S) → Σ = 1100.07; 18 COD_CTA; 19 COD_CCUS; 20 DESC_COMPL; 21 PER_ESCRIT (apropriação direta, < período atual); 22 CNPJ (S, no 0140).
1102 (1:1, obrigatório se CST 53–56/63–66): 02 VL_CRED_PIS_TRIB_MI (só se 1100.COD_CRED começa com 1); 03 VL_CRED_PIS_NT_MI (começa com 2); 04 VL_CRED_PIS_EXP (começa com 3).
1100.07 = Σ 1101.17 (CST 50,51,52,60,61,62) + Σ 1102.02+03+04 (CST comuns).

### 1200 / 1210 / 1220 (PIS) e 1600 / 1610 / 1620 (COFINS) — Contribuição extemporânea
Mesma restrição (PA ≤ 07/2013).
1200 (chave PER_APUR_ANT + NAT_CONT_REC + DT_RECOL): 02 PER_APUR_ANT (< atual); 03 NAT_CONT_REC (4.3.5); 04 VL_CONT_APUR = Σ 1210.09; 05 VL_CRED_PIS_DESC = Σ 1220.05; 06 VL_CONT_DEV = 04 − 05; 07 VL_OUT_DED; 08 VL_CONT_EXT = 06 − 07; 09 VL_MUL; 10 VL_JUR; 11 DT_RECOL (1600: dentro do período atual).
1210 (chave CNPJ + CST + COD_PART + DT_OPER + ALIQ + COD_CTA): 02 CNPJ; 03 CST; 04 COD_PART; 05 DT_OPER; 06 VL_OPER; 07 VL_BC (3 dec); 08 ALIQ (4 dec); 09 VL = BC×ALIQ(/100); 10 COD_CTA; 11 DESC_COMPL.
1220 (chave PER_APU_CRED + ORIG_CRED + COD_CRED): 02 PER_APU_CRED (≤ PER_APUR_ANT do pai); 03 ORIG_CRED 01/02; 04 COD_CRED; 05 VL_CRED.

### 1300 — Controle dos valores retidos na fonte – PIS (1700 = COFINS)
Chave IND_NAT_RET + PR_REC_RET.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "1300" | C | 004* | - | S |
| 02 | IND_NAT_RET | até 2013: 01,02,03,04,05,99; a partir de 01/2014: 01 órgãos/autarquias/fundações federais; 02 outras entidades da adm. pública federal; 03 PJ direito privado; 04 cooperativa; 05 fabricante máquinas/veículos; 99 outras (regra geral NC ou Cum — LR NC e LP/Arbitrado); **51–55, 59** = mesmas naturezas p/ receitas cumulativas de PJ do Lucro Real (art. 8º Lei 10.637 / art. 10 Lei 10.833) | N | 002* | - | S |
| 03 | PR_REC_RET | mmaaaa (≤ período atual) | N | 006 | - | S |
| 04 | VL_RET_APU | Retenção total sofrida | N | - | 02 | S |
| 05 | VL_RET_DED | Deduzida (acumulada: atual + anteriores) — correlação com M200.06/10 | N | - | 02 | S |
| 06 | VL_RET_PER | Pedido de restituição (acumulado) | N | - | 02 | S |
| 07 | VL_RET_DCOMP | Compensação (acumulado) | N | - | 02 | S |
| 08 | SLD_RET | 04 − 05 − 06 − 07 | N | - | 02 | S |
Regra legal (IN RFB 1.234/2012 art. 9º, red. IN 1.540/2015): retenções de órgãos federais/empresas públicas etc. só deduzem da **mesma contribuição e do mesmo mês** da retenção; excesso → PER/DCOMP.

### 1800 — Incorporação imobiliária – RET
02 INC_IMOB (CNPJ do empreendimento, 14 posições, S); 03 REC_RECEB_RET (S); 04 REC_FIN_RET (N); 05 BC_RET = 03 + 04 − cancelamentos/devoluções/descontos incondicionais (S); 06 ALIQ_RET (N 006, 2 dec, S: 1% interesse social/educação infantil; 4% ou 6% demais, conforme período); 07 VL_REC_UNI (S); 08 DT_REC_UNI; 09 COD_REC (DARF 4 posições). Receita RET não entra nos demais registros.
1809 (filho): 02 NUM_PROC (C 020, S); 03 IND_PROC 1 Justiça Federal / 3 RFB / 9 outros.

### 1900 — Consolidação dos documentos emitidos – Lucro Presumido
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "1900" | C | 004* | - | S |
| 02 | CNPJ | Estabelecimento emitente (no 0140) | N | 014* | - | S |
| 03 | COD_MOD | Tab. 4.1.1, ou 98 (NFS ISS), 99 (outros) | C | 002* | - | S |
| 04 | SER | | C | 004 | - | N |
| 05 | SUB_SER | | N | 020 | - | N |
| 06 | COD_SIT | 00 regular; 02 cancelado; 99 outros | N | 02* | - | N |
| 07 | VL_TOT_REC | Receita total dos documentos emitidos (recebida ou não) | N | - | 02 | S |
| 08 | QUANT_DOC | Qtde documentos | N | - | - | N |
| 09 | CST_PIS | 01–09, 49, 99 (vazio se vários CST não decomponíveis) | N | 002* | - | N |
| 10 | CST_COFINS | idem | N | 002* | - | N |
| 11 | CFOP | | N | 004* | - | N |
| 12 | INF_COMPL | (natureza se COD_MOD 99) | C | - | - | N |
| 13 | COD_CTA | Conta; LP sem ECD pode usar "Dispensa de ECD - IN RFB nº 1.774/2017" | C | 255 | - | N |
Mesmo sem emissão: gerar com VL_TOT_REC = 0 e QUANT_DOC = 0.

---

## 3. BLOCO 9 — Controle e encerramento

| Registro | Campos | Regras |
|---|---|---|
| **9001** (nível 1, 1 por arquivo, obrig.) | 01 REG "9001" C 004*; 02 IND_MOV N 001* (0/1) | Na prática sempre 0 (há ao menos 9900) |
| **9900** (nível 2, vários, obrig.) | 01 REG "9900" C 004*; 02 REG_BLC C 004 (código do registro totalizado); 03 QTD_REG_BLC N | **Uma linha para cada tipo de registro presente no arquivo, inclusive 0000, 9001, 9900, 9990 e 9999**. QTD_REG_BLC = contagem de linhas daquele REG. A linha `|9900|9900|n|` conta todas as 9900 (inclusive ela) |
| **9990** (nível 1, 1, obrig.) | 01 REG "9990"; 02 QTD_LIN_9 N | Linhas do Bloco 9 incluindo 9001, todas as 9900, 9990 **e também o 9999** |
| **9999** (nível 0, 1, obrig.) | 01 REG "9999"; 02 QTD_LIN N | Total de linhas do arquivo inteiro, incluindo a própria 9999 |

Algoritmo de fechamento:
```
regs = linhas de 0000 até 1990 (+ P, se houver)
tipos = set(REG) ∪ {"9001","9900","9990","9999"}
n9900 = len(tipos)
qtd["9001"]=1; qtd["9900"]=n9900; qtd["9990"]=1; qtd["9999"]=1
QTD_LIN_9 = 1 + n9900 + 1 + 1
QTD_LIN   = len(regs) + QTD_LIN_9
```
Idem para cada bloco: `X990.QTD_LIN_X` = linhas de X001 até X990 inclusive.

---

## 4. Algoritmo de apuração (geração automática do Bloco M a partir de A/C/D/F)

### 4.0 Entradas e parâmetros
- 0000: DT_INI/DT_FIN, IND_NAT_PJ — o Guia (trecho lido) usa: 01 ou 04 ⇒ cooperativa (M211/M611 obrigatório); 02 ⇒ entidades do PIS-folha (M350); 00, 02, 03, 05 ⇒ não cooperativa (base M210.04 direta). Descrição completa dos códigos está no registro 0000 (fora deste trecho).
- 0110: **COD_INC_TRIB** (1 = exclusivamente NC; 2 = exclusivamente cumulativo; 3 = ambos), **IND_APRO_CRED** (1 apropriação direta; 2 rateio proporcional), **COD_TIPO_CONT** (1 alíquota básica; 2 alíquotas específicas), IND_REG_CUM (caixa/competência consolidada/detalhada).
- 0111: receitas brutas p/ rateio (T, N, E, Cum, Total).
- Tabelas: 4.3.5, 4.3.6, 4.3.7, 4.3.10–4.3.17 (vigência), alíquotas monofásicas/unidade.
- Entradas manuais: ajustes (M110/M220/M215), diferimentos (M230/M300), retenções (F600 + saldo 1300/1700), deduções (F700), saldos anteriores (1100/1500 do mês anterior), escolha de uso de créditos (parcial/total), processos (1010/1011), códigos DCTF.

### 4.1 Normalizar as "linhas de apuração" dos blocos A/C/D/F (por tributo)
Para cada registro-fonte gerar uma linha normalizada:
`{tributo, estab_cnpj, reg_origem, natureza: RECEITA|CREDITO, cst, aliq_pct, aliq_quant, vl_item (receita bruta), vl_bc, quant_bc, nat_bc_cred, ind_orig_cred, cfop, cod_cta, cod_item/ncm, nat_rec}`
- **Receitas (saídas)**: A170 (A100.IND_OPER=1), C170 (C100.IND_OPER=1, COD_MOD≠55 ou IND_ESCRI=2), C181/C185 & C491/C495 (IND_ESCRI=1), C481/C485 (IND_ESCRI=2), C175, C381/C385, C601/C605, C870, C880, D201/D205, D300, D350, D601/D605, F100 (IND_OPER 1/2), F200, F500/F510 (caixa), F550/F560 (competência), I100.
  - Campo "receita bruta": VL_ITEM / VL_DOC (D300) / VL_BRT (D350) / VL_OPR (C175) / VL_OPER (F100) / VL_TOT_REC (F200) / VL_REC_CAIXA (F500/F510) / VL_REC_COMP (F550/F560) / VL_REC (I100).
- **Créditos (entradas)**: CST 50–56, 60–66 em A170 (IND_OPER=0), C170 (IND_OPER=0), C191/C195, C396, C501/C505, D101/D105, D501/D505, F100 (IND_OPER=0), F120, F130, F150, F205/F210, F800.

### 4.2 Contribuições → M210/M610 (+ M400/M800)
1. Filtrar receitas com CST ∈ {01,02,03,05}. Para cada linha determinar COD_CONT pela tabela da seção 1/M210 usando CST + 0110.COD_INC_TRIB + alíquota (F200 → 04/54).
2. Agrupar por (COD_CONT, ALIQ_QUANT, ALIQ_PCT). Para cada grupo:
   - `VL_REC_BRT = Σ receita bruta`; `VL_BC_CONT = Σ vl_bc` (0 para 03/53; cooperativa → via M211).
   - `VL_AJUS_ACRES_BC / VL_AJUS_REDUC_BC = Σ M215` (entrada manual, ≥ 2019); `VL_BC_CONT_AJUS = 04 + 05 − 06`.
   - `QUANT_BC = Σ quant_bc` (03, 53, 32).
   - `VL_CONT_APUR = round(QUANT × ALIQ_QUANT, 2)` ou `round(BC_AJUS × ALIQ/100, 2)`.
   - Ajustes M220, diferimento M230, diferido anterior M300 → `VL_CONT_PER = 11 + 12 − 13 − 14 + 15`.
3. Receitas com CST ∈ {04,06,07,08,09} → agrupar por CST → M400/M800 (`VL_TOT_REC = Σ receita bruta`), e por (NAT_REC, COD_CTA, DESC_COMPL) → M410/M810. (O PVA não gera M410 — nosso software deve gerar a partir do de-para NCM→NAT_REC.)
4. CST 49/99: não entram no Bloco M.

### 4.3 Créditos → M105/M100 (M505/M500) — só COD_INC_TRIB 1 ou 3
1. Agrupar linhas de crédito por (CST, NAT_BC_CRED, "tipo/alíquota") → base `VL_BC_TOT`, `QUANT_TOT`.
2. Tipo de crédito (sufixo): 04 se F150/NAT_BC_CRED=18; 08 se CFOP 3xxx ou IND_ORIG_CRED=1; 06/07 se CST 60–66 (agro vs outros); 03 se ALIQ_QUANT>0; 05 embalagens; 01 se aliq = 1,65/7,6; 02 demais; 109 de F205/F210 (sem M105); sucessão (F800) com IND_CRED_ORI=1 (sem M105).
3. Se COD_INC_TRIB = 3: `VL_BC_CUM = VL_BC_TOT × RB_cum/RB_total`; `VL_BC_NC = VL_BC_TOT − VL_BC_CUM`. Senão CUM = 0, NC = TOT.
4. Distribuir entre grupos: CST exclusivo → 100% no grupo; CST comum → rateio (seção M105) se IND_APRO_CRED=2; se =1, exigir valores de apropriação direta (entrada manual/sistema de custos).
5. Montar M105 sob o M100 (COD_CRED = grupo + sufixo; + alíquota). M100: `VL_BC = Σ M105.VL_BC_PIS`, `VL_CRED = VL_BC × ALIQ/100` (ou quantidade × R$), ajustes M110 (devoluções de compras = redução), diferimento M230, `VL_CRED_DISP`.

### 4.4 Consolidação M200/M600 — **Lucro Real / Não cumulativo** (COD_INC_TRIB 1 ou 3)
```
NC  = Σ M210.VL_CONT_PER where COD_CONT in {01,02,03,04,71} (+32 se sujeito à NC)
CUM = Σ M210.VL_CONT_PER where COD_CONT in {31,51,52,53,54,72} (+32 se exclusivamente cumulativo)  [regime 3: parcela cumulativa]
restante = NC
# 1) créditos do próprio período, ordem 1xx → 2xx → 3xx (respeitando IND_DESC_CRED escolhido)
for m100 in sorted(M100, key=grupo):
    uso = min(m100.VL_CRED_DISP, restante) (ou valor parcial escolhido)
    m100.VL_CRED_DESC = uso; m100.IND_DESC_CRED = 0 if uso == DISP else 1
    m100.SLD_CRED = DISP − uso; restante -= uso
M200.03 = Σ M100.VL_CRED_DESC
# 2) créditos de períodos anteriores (1100), ordem sugerida: mais antigos primeiro (decadência 5 anos)
for r in 1100 sorted by PER_APU_CRED:
    r.VL_CRED_DESC_EFD = min(r.SD_CRED_DISP_EFD, restante); restante -= ...
M200.04 = Σ 1100.13
M200.05 = NC − 03 − 04
# 3) retenções (F600/1300) e deduções (F700)
M200.06 = min(retenções_NC_disponíveis, 05); M200.07 = min(Σ F700 IND_NAT_DED=0, 05−06)
M200.08 = 05 − 06 − 07
M200.09 = CUM; 10 = min(ret_CUM, 09); 11 = min(Σ F700 IND_NAT_DED=1, 09−10); 12 = 09 − 10 − 11
M200.13 = 08 + 12
M205: (08, "691201", M200.08) ; (12, "810902", M200.12)   # COFINS: 585601 / 217201
1100 (período atual) para cada M100 com SLD_CRED > 0; rollover dos 1100 anteriores (18 → novo 06/09 no mês seguinte).
1300: atualizar VL_RET_DED acumulado e SLD_RET.
```
Mesma coisa para COFINS com M500/M600/1500/1700.

### 4.5 Consolidação M200/M600 — **Lucro Presumido / Cumulativo** (COD_INC_TRIB 2)
```
Não gerar M100/M105/M110/M500... (créditos admitidos no cumulativo → F700 → campo 11)
M210: COD_CONT 51 (0,65) / M610 51 (3,0) a partir de C170/C175/C181/A170/F100/F500(caixa)/F550(competência)...
      (+ 52/53 p/ alíquotas específicas, 31/32 p/ ST, 54 p/ F200 imobiliária)
M200.02..08 = 0
M200.09 = Σ M210.VL_CONT_PER (31,51,52,53,54,72,32)
M200.10 = min(retenções (F600/1300), 09)    # IND_NAT_RET 01..05, 99
M200.11 = min(Σ F700.VL_DED_PIS IND_NAT_DED=1, 09 − 10)
M200.12 = 09 − 10 − 11 ; M200.13 = 12
M205: (12, "810902", M200.12)   # COFINS M605: (12, "217201", ...)
M400/M410 e M800/M810 para CST 04, 06, 07, 08, 09 (ex.: revenda monofásica CST 04 – muito comum em comércio LP)
Bloco 1: 1900 obrigatório se regime de caixa/competência consolidado (F500/F510/F550/F560); 1300/1700 se houver retenção.
```
Observações: no regime de caixa (F500/F510) a base é a receita **recebida** no mês; o 1900 traz a receita **emitida**. Devoluções de venda no cumulativo reduzem a base — escriturar como ajuste (M215 a partir de 2019 com código da tab. 4.3.18, ou M220 COD_AJ conforme orientação vigente) — **[confirmar prática com o escritório]**.

### 4.6 Regime misto (COD_INC_TRIB 3)
- Receitas: CST 01 com 1,65/7,6 → 01 (NC); com 0,65/3,0 → 51 (Cum). Ambos coexistem no M210.
- Créditos: M105.05 (parcela cumulativa) = base × RB_cum/RB_total (0111) — essa parcela não gera crédito.
- M200 preenche NC e Cum; créditos só abatem o NC (03+04 ≤ 02).
- Retenções: IND_NAT_RET 51–55/59 são das receitas cumulativas de PJ do Lucro Real.

### 4.7 Pós-processamento
1. Arredondar todos os valores a 2 casas (half-up) no nível de cada registro; recalcular pais a partir dos filhos arredondados (Σ filhos = pai exato).
2. Gerar registros na ordem hierárquica; M001.IND_MOV = 0 se houver M200/M600 (sempre há, mesmo zerados, se houver receita) — **[confirmar]** se M200/M600 são exigidos mesmo sem movimento; o PVA gera M200/M600 zerados.
3. Contar linhas (M990, 1990) e montar Bloco 9.

---

## 5. Regras de validação do Bloco M (cross-checks que o PVA faz / que devemos replicar)

Estruturais:
- V01 M001 único; IND_MOV=1 ⇒ só M001/M990; IND_MOV=0 ⇒ ≥1 registro intermediário.
- V02 M990.QTD_LIN_M = nº de linhas M001..M990.
- V03 Registros-filho só após o respectivo pai; M200 e M600 no máximo 1 cada; M350 no máximo 1; M211/M611 1:1.
- V04 Versão de leiaute: M210/M610 com 16 campos só se PA ≥ 01/2019 (13 antes); M215/M615/1050 só ≥ 2019; M115/M225/M515/M625 só ≥ 10/2015; M205/M605 obrigatórios ≥ 04/2014; 1011 ≥ 01/2020.

Créditos (M100/M500, M105/M505):
- V10 PJ COD_INC_TRIB = 2 ⇒ não pode haver M100/M500.
- V11 Deve existir M100 para cada COD_CRED/alíquota presente nos documentos de crédito (A/C/D/F), exceto atividade imobiliária.
- V12 M100.04 = Σ M105.07; M100.06 = Σ M105.09.
- V13 M100.06/07 só com COD_CRED ∈ {103,203,303,105,205,305,108,208,308}; 04/05 vazios se crédito por quantidade, se 109 ou se sucessão.
- V14 M100.08 = 04×05/100 ou 06×07; 109 → = Σ F205/F210; sucessão → = Σ F800 do COD_CRED.
- V15 M100.09 = Σ M110 (IND_AJ=1); M100.10 = Σ M110 (IND_AJ=0).
- V16 M100.11 ≤ 08 + 09 − 10; Σ M100.11 por COD_CRED = Σ M230.06 do mesmo COD_CRED (e M500 vs M630).
- V17 M100.12 = 08 + 09 − 10 − 11; M100.15 = 12 − 14; IND_DESC_CRED=0 ⇒ 14 = 12.
- V18 M105.03 compatível com o grupo do COD_CRED do pai (tabela da seção 0.3).
- V19 M105.06 = 04 − 05; M105.05 só se COD_INC_TRIB = 3 (senão 0/vazio); M105.07 = 06 para CST 50,51,52,60,61,62; para comuns, Σ 07 entre os M105 irmãos de mesmo CST/NAT_BC ≤ 06 (= 06 no rateio).
- V20 M105.10 obrigatório se NAT_BC_CRED = 13.
- V21 M105 base total por CST deve bater com Σ VL_BC dos documentos A/C/D/F daquele CST/NAT_BC (o PVA recalcula no Ctrl+M).

Contribuição (M210/M610):
- V30 COD_CONT coerente com CST/alíquota/COD_INC_TRIB (tabela 4.2); 71, 72, 99 não validados.
- V31 Receita bruta (campo 03) e base (04) = somatórios dos registros-fonte (listas da seção M210) para 01,51,02,52,31,32; 03/53 ⇒ campo 04 = 0.
- V32 Quantidade (09) = somatório dos fontes para 03,53,32; vazio para 01,51,02,52,31.
- V33 Alíquota %: vazia se por unidade; alíquota R$: vazia se não por unidade.
- V34 VL_BC_CONT_AJUS = 04 + 05 − 06; 05/06 = Σ M215 por indicador.
- V35 VL_CONT_APUR = BC_AJUS × ALIQ/100 ou QUANT × ALIQ_QUANT.
- V36 VL_AJUS_ACRES/REDUC = Σ M220 por IND_AJ.
- V37 VL_CONT_DIFER = Σ M230.05; Σ M210.VL_CONT_DIFER_ANT = Σ M300.06 por COD_CONT (M610 × M700).
- V38 VL_CONT_PER = 11 + 12 − 13 − 14 + 15.
- V39 COD_TIPO_CONT = 2 ⇒ ao menos um M210/M610 com COD_CONT 02, 03, 52 ou 53.
- V40 Cooperativa (IND_NAT_PJ 01/04) ⇒ M211/M611 obrigatório e M210.04 = M211.06; M211.06 = 03 − 04 − 05.
- V41 Chave M210: COD_CONT + ALIQ_QUANT + ALIQ única.

Consolidação (M200/M600):
- V50 M200.02 = Σ M210.VL_CONT_PER (01,02,03,04,71 [+32 NC]); M200.09 = Σ (31,51,52,53,54,72 [+32 Cum]).
- V51 M200.03 = Σ M100.14; M200.04 = Σ 1100.13 (M600: M500 / 1500).
- V52 M200.03 + M200.04 ≤ M200.02.
- V53 M200.05 = 02 − 03 − 04; 08 = 05 − 06 − 07; 12 = 09 − 10 − 11; 13 = 08 + 12.
- V54 M200.06 ≤ 05; M200.10 ≤ 09; retenções correlatas com F600 e 1300/1700.
- V55 M200.07 = Σ F700.VL_DED_PIS (IND_NAT_DED=0); M200.11 ≤ Σ F700 (IND_NAT_DED=1).
- V56 COD_INC_TRIB = 2 ⇒ M200.02..08 = 0; COD_INC_TRIB = 1 ⇒ M200.09..12 = 0.
- V57 Σ M205.VL_DEBITO (NUM_CAMPO=08) = M200.08 e (=12) = M200.12; COD_REC com 6 dígitos válidos; idem M605/M600.
- V58 (Negócio) M200/M600 a recolher devem bater com a DCTF/DCTFWeb do mês.

Diferimento:
- V60 M300.06 = 03 − 05; M300.07 ≠ período atual; M300.08 dentro do período atual; NAT_CRED_DESC ∈ {01,02,03,04}.
- V61 M230 chave CNPJ + COD_CRED única; CNPJ com DV válido.

Receitas não tributadas:
- V70 M400.02 ∈ {04,05,06,07,08,09}; M400.03 = Σ M410.03 (M800/M810).
- V71 M400.03 = Σ receitas-fonte com esse CST (lista do M400); CST 05 só se alíquota zero (PGE antigo).
- V72 M410.NAT_REC existente na tabela do CST do pai e vigente no período; chave NAT_REC+COD_CTA+DESC_COMPL única.
- V73 Existência de receitas CST 04–09 nos blocos A/C/D/F ⇒ M400/M800 (e M410/M810) obrigatórios.

Contas contábeis:
- V80 COD_CTA (M115, M215, M225, M400, M410, M515, M615, M625, M800, M810, 1011) obrigatório para fatos geradores ≥ 11/2017, exceto PJ dispensada de ECD (LP com livro caixa — pode usar "Dispensa de ECD - IN RFB nº 1.774/2017"); deve existir no 0500.

Bloco 1:
- V90 1100.08 = 06 + 07; 12 = 08 − 09 − 10 − 11; 18 = 12 − 13 − 14 − 15 − 16 − 17; PER_APU_CRED ≤ período; 10/14 só p/ COD_CRED 201,202,203,204,208,301,302,303,304,307,308; 11/15 só p/ 301,302,303,304,308; CNPJ_SUC só se ORIG_CRED=02. (1500 idem; 1500.18 obrigatório.)
- V91 1100.06 (períodos com EFD) = M100.12 do período de origem, mesmo COD_CRED; 1100.07 = Σ 1101/1102.
- V92 1101/1102/1200/1210/1220/1501/1502/1600/1610/1620 proibidos para PA ≥ 08/2013.
- V93 1300.08 = 04 − 05 − 06 − 07; IND_NAT_RET válido para o período (≥2014: 01–05, 51–55, 59?, 99 — o Guia lista "01,02,03,04,05,51,52,53,54,55 e 99" nos valores válidos mas descreve também 59; aceitar 59).
- V94 1010.07 data obrigatória para validação; 1010.05 ∈ lista; 12–19 ⇒ exigir 1011 (≥ 2020).
- V95 1011: REG_REF existente na escrituração; CHAVE_DOC válida; COD_PART no 0150; COD_ITEM no 0200; VL_OPER > 0.
- V96 1900 obrigatório (≥ 04/2013) para LP com F500/F510/F550/F560; CNPJ no 0140; COD_SIT ∈ {00,02,99}.
- V97 1990.QTD_LIN_1 correta.

Bloco 9:
- V98 9900 para todo REG presente (inclusive 9900/9990/9999), contagens exatas; 9990 inclui 9999; 9999 = total de linhas.

---

## 6. Anexo — alterações estruturais relevantes (histórico de versões do Guia)
- v1.34 (02/2021): M200/M600 – informação sobre desconto automático de créditos; M210/M610 – correções p/ PA < 2019; M210/M610/M400/M800 – totalização de CST 05 (revenda ST) e correção do campo totalizador do C175 (VL_OPR).
- v1.33 (12/2019): modelo 66 (NF3e) em C500/C600; 1300/1700 conforme IN 1.540/2015 e IN 1.911/2019.
- v1.32 (10/2019): leiaute 006 (PA ≥ 01/2020); registro 0900; **registro 1011**; novos códigos 1010.IND_NAT_ACAO (12–19); M210/M610 e M211/M611 – campos 03/04/06 revisados; vínculo processo referenciado × 1011.
- Versão com leiaute 005 (PA ≥ 01/2019): **M215, M615, 1050**, novos campos de ajuste de base em M210/M610 (16 campos); tabela 4.3.18.
- Leiaute 004 / 11/2017: COD_CTA obrigatório (erro) nos registros de receitas/créditos; exceção LP dispensado de ECD (IN 1.774/2017).
- PVA 2.12 (FG ≥ 10/2015): M115, M225, M515, M625.
- PVA 2.06 (PA ≥ 01/2014, obrigatório ≥ 04/2014): M205, M605; novos códigos de retenção 51–59 em 1300/1700; Bloco I; SCP em escrituração própria (0035).
- 08/2013: registros extemporâneos (1101/1102/1200/1210/1220/1501/1502/1600/1610/1620) deixam de ser aceitos (retificação em 5 anos, IN 1.387/2013).
- 04/2013: 1900 obrigatório para LP.
- PGE 2.0.5: CST 05 totaliza sempre em M210/M610.
