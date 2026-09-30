# EFD-Contribuições — Blocos D, F, I e P (notas para desenvolvedor)

Fonte: Guia Prático EFD-Contribuições v1.35 (18/06/2021), linhas 9356–14421 (D, F, I) e 18239–18780 (P) do .txt.
Contexto do produto: gerar e validar EFD-Contribuições a partir de XML de NF-e/NFC-e/CT-e para comércio
(farmácias, varejo) no Lucro Presumido (cumulativo) e Lucro Real (não cumulativo).

Convenções das tabelas: Tipo C=alfanumérico, N=numérico; Tam com `*` = tamanho fixo; Dec = casas decimais;
Obrig S/N. Datas sempre `ddmmaaaa` sem separadores. Valores com vírgula decimal no TXT.

## Regras transversais (valem para D, F e boa parte do P)

- **VL_PIS / VL_COFINS de linha NÃO são recuperados pelo Bloco M.** O M recalcula: soma das bases por
  CST/alíquota × alíquota. O PVA só valida `VL = BC × ALIQ / 100` na linha. => o gerador deve agrupar bases
  por (CST, alíquota, NAT_BC_CRED, origem) exatamente como o M agrupa; arredondamento final ocorre no M.
- **Bases de receita** (CST 01, 02, 03, 05) → M210/M610 `VL_BC_CONT`. **Bases de crédito** (CST 50–56, 60–66)
  → M105/M505 `VL_BC_PIS_TOT` / `VL_BC_COFINS_TOT` (chave NAT_BC_CRED + CST).
- **COD_CTA**: opcional até out/2017; **obrigatório a partir de nov/2017, exceto** PJ dispensada de ECD
  (ex.: Lucro Presumido que escritura Livro Caixa, art. 45 Lei 8.981/95). Regra de validação no nosso
  software: se regime = Lucro Real (ou presumido com ECD) e período >= 11/2017 → COD_CTA obrigatório e deve
  existir no 0500. Pode ser conta sintética.
- **Registros "x09/x11/x19..." Processo Referenciado** (D111, D209, D309, D359, D509, D609, F111, F129,
  F139, F209, F219, F509, F519, F559, F569, I199...): campos `REG | NUM_PROC C(020) S | IND_PROC C(001*) S`
  com IND_PROC ∈ {1=Justiça Federal, 3=SRFB, 9=Outros}. Ao usar, gerar obrigatoriamente 1010 (judicial) ou
  1020 (administrativo). Decisão judicial só altera base/CST/alíquota se **transitada em julgado**; sem
  trânsito → apura normal e informa exigibilidade suspensa no 1010 campo 06 (DESC_DEC_JUD) e, a partir de
  jan/2020, detalha no 1011. M200/M600 devem bater com a DCTF (IN RFB 1.599/2015).
- **x001 / x990** (abertura/encerramento): `IND_MOV` 0=com dados (exige ≥1 registro além de abertura e
  encerramento), 1=sem dados (só abertura+encerramento). `QTD_LIN_x` conta inclusive o x001 e o x990.
- **x010** (identificação do estabelecimento): `REG | CNPJ N(014*) S`. Validar DV; CNPJ deve existir no 0140.
  Só gerar x010 para estabelecimentos com movimento no bloco (nunca x010 "vazio").
- Referência ICMS da base (Tese do Século): ver Seções 11 e 12 do Guia (fora deste recorte) — ajuste de
  exclusão do ICMS da base é aplicável aos campos de BC de receita de D201/D205/D300/D350/D601/D605/F100 etc.

---

# BLOCO D — Documentos Fiscais II – Serviços (ICMS): transporte e comunicação

Hierarquia:
```
D001 (1)
 └ D010 (2, por estabelecimento)
    ├ D100 (3) aquisição de transporte com crédito ── D101 (4, PIS) / D105 (4, COFINS) / D111 (4, processo)
    ├ D200 (3) resumo diário de PRESTAÇÃO de transporte ── D201 / D205 / D209
    ├ D300 (3) resumo diário bilhetes (13,14,15,16,18) ── D309
    ├ D350 (3) resumo diário ECF transporte (2E,13–16) ── D359
    ├ D500 (3) aquisição comunicação/telecom com crédito ── D501 / D505 / D509
    └ D600 (3) consolidação PRESTAÇÃO comunicação/telecom ── D601 / D605 / D609
D990 (1)
```
Para comércio (farmácia/varejo): na prática só **D100/D101/D105** (CT-e de frete contratado, Lucro Real) e
eventualmente **D500/D501/D505** (conta de telefone/internet – só gera crédito se for insumo, raro no
comércio). D200/D300/D350/D600 são de transportadoras/teles (prestadores) → não gerar para nossos clientes.

## D001 — Abertura do Bloco D
| Nº | Campo | Descrição | Tipo | Tam | Obrig |
|---|---|---|---|---|---|
| 01 | REG | "D001" | C | 004* | S |
| 02 | IND_MOV | 0=com dados; 1=sem dados | C | 001 | S |
Nível 1, uma ocorrência por arquivo.

## D010 — Identificação do Estabelecimento
`REG "D010" | CNPJ N(014*) S`. Nível 2, várias ocorrências. Registro obrigatório (se bloco com dados).
Só estabelecimentos que efetivamente prestaram/contrataram transporte/comunicação com documento fiscal
do Bloco D. DV do CNPJ conferido; deve estar no 0140.

## D100 — Aquisição de Serviços de Transporte (mod. 07, 08, 8B, 09, 10, 11, 26, 27, 57 CT-e, 63 BP-e, 67 CT-e OS)

**Quando usar:** contribuinte ADQUIRENTE (tomador) de serviço de transporte **cuja operação dê direito a
crédito** de PIS/COFINS (regime não cumulativo → na prática **Lucro Real**). Só relacionar aquisições com
direito a crédito ("Só devem ser relacionados neste registro as aquisições de serviços de transportes que,
de acordo com a legislação tributária, confiram direito ao crédito").
Lucro Presumido (cumulativo) não toma crédito → não gera D100.

**Fretes que dão crédito (básico ou presumido):**
- Frete na **venda/revenda** de mercadorias com ônus suportado pelo vendedor (titular da escrituração)
  → IND_NAT_FRT = 0.
- Frete na venda de bens fabricados pelo titular, ônus do titular → IND_NAT_FRT = 0.
- Crédito presumido de transportadora que subcontrata TAC (pessoa física) ou transportadora do Simples
  (§§19–20 art. 3º Lei 10.833/2003): alíquotas 1,2375% PIS e 5,7% COFINS (Tabela 4.3.17), CST 60–66,
  NAT_BC_CRED 14, IND_NAT_FRT 9. (Não se aplica a comércio.)

**Frete na COMPRA de mercadorias** (ônus do adquirente): integra o custo de aquisição (art. 289 §1º
RIR/1999) e pode compor a base de crédito de duas formas (escolher UMA, nunca as duas — risco de crédito
em duplicidade):
1. Somar o frete à base de crédito do item em C170 (por documento) ou C191/C195 (consolidado); **ou**
2. Escriturar o CT-e em D100 com D101/D105 `IND_NAT_FRT = 2` (compras geradoras de crédito).
   Se a mercadoria comprada não gera crédito (ex.: monofásico/ST de farmácia com CST 70/73...), o frete
   dessa compra também não gera → IND_NAT_FRT = 3 e CST 70 (ou simplesmente não escriturar).

**Fretes SEM direito a crédito:** transferência entre estabelecimentos da mesma PJ (produto acabado ou em
elaboração; IND_NAT_FRT 4/5 com CST 70 salvo previsão legal); transporte de bens recebidos em devolução
(do comprador para o vendedor).

**Unicidade (validação do registro):** não pode haver dois D100 com a mesma chave:
- terceiros: `IND_EMIT+NUM_DOC+COD_MOD+SER+SUB+COD_PART`
- própria: `IND_EMIT+NUM_DOC+COD_MOD+SER+SUB`
Para cada D100 é **obrigatório** ter D101 (PIS) e D105 (COFINS).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "D100" | C | 004* | - | S |
| 02 | IND_OPER | 0=Aquisição (único valor válido) | C | 001* | - | S |
| 03 | IND_EMIT | 0=Emissão própria; 1=Terceiros | C | 001* | - | S |
| 04 | COD_PART | Participante (0150) = transportadora | C | 060 | - | S |
| 05 | COD_MOD | Modelo (Tab. 4.1.1) | C | 002* | - | S |
| 06 | COD_SIT | Situação (Tab. 4.1.2) | N | 002* | - | S |
| 07 | SER | Série | C | 004 | - | N |
| 08 | SUB | Subsérie | C | 003 | - | N |
| 09 | NUM_DOC | Número do documento | N | 009 | - | S |
| 10 | CHV_CTE | Chave do CT-e | N | 044* | - | N* |
| 11 | DT_DOC | Data de emissão | N | 008* | - | S |
| 12 | DT_A_P | Data da aquisição/prestação | N | 008* | - | N |
| 13 | TP_CT-e | Tipo do CT-e (Manual CT-e) | N | 001* | - | N |
| 14 | CHV_CTE_REF | Chave do CT-e referenciado | N | 044* | - | N |
| 15 | VL_DOC | Valor total do documento | N | - | 02 | S |
| 16 | VL_DESC | Valor total do desconto | N | - | 02 | N |
| 17 | IND_FRT | Indicador do frete (ver abaixo) | C | 001* | - | S |
| 18 | VL_SERV | Valor total da prestação | N | - | 02 | S |
| 19 | VL_BC_ICMS | Base do ICMS | N | - | 02 | N |
| 20 | VL_ICMS | Valor do ICMS | N | - | 02 | N |
| 21 | VL_NT | Valor não tributado do ICMS | N | - | 02 | N |
| 22 | COD_INF | Inf. complementar (0450) | C | 006 | - | N |
| 23 | COD_CTA | Conta contábil | C | 255 | - | N |

Regras de campo:
- 02: [0]. 03: [0,1]. 04: deve existir no 0150 (transportadora; ou subcontratado no caso de crédito presumido).
- 05: [07, 08, 8B, 09, 10, 11, 26, 27, 57, 63, 67].
- 06 COD_SIT: [00, 02, 04, 05, 06, 08] (00 regular, 02 cancelado, 04 denegado, 05 inutilizado,
  06 complementar, 08 regime especial — conferir Tab. 4.1.2). Obs.: 01/07 (extemporâneo) NÃO são válidos
  no D100. Na prática, CT-e cancelado não gera crédito — não enviar ou enviar com COD_SIT 02 sem valores.
- 09: > 0; se impossível informar, "000000000".
- 10 CHV_CTE: obrigatório para mod. 57 (própria ou terceiros) **a partir de abr/2012 em todas as situações**.
  Validações PVA: DV da chave; raiz CNPJ + UF do emitente (COD_PART) = chave; COD_MOD, NUM_DOC e SER
  consistentes com a chave. (Para 63 e 67 o guia não detalha aqui, mas gravar a chave é boa prática.)
- 11/12: DT_DOC **ou** DT_A_P deve estar dentro do período (0000 campos 06–07). Útil: CT-e emitido no mês
  anterior mas recebido no mês → usar DT_A_P no período.
- 13 TP_CT-e: informar quando COD_MOD = 57 (0=Normal, 1=Complemento, 2=Anulação, 3=Substituto — tpCTe).
- 14 CHV_CTE_REF: **não preencher (vazio)**, apesar da descrição.
- 17 IND_FRT (a partir de 01/07/2012): 0=Por conta do emitente; 1=Por conta do destinatário/remetente;
  2=Por conta de terceiros; 9=Sem frete. Usar "2" quando o tomador for diferente do emitente e do
  destinatário. Tomador = quem contratou e paga; **só o tomador tem direito ao crédito**. Transporte feito
  pelo próprio emissor → "0". (Tabela antiga até 30/06/2012: 0=terceiros,1=emitente,2=destinatário,9=sem.)
- 18 VL_SERV: inclui pedágio e demais despesas.
- 19 VL_BC_ICMS: validação = VL_SERV − VL_NT.
- 22: deve existir no 0450.

### D101 — Complemento do Documento de Transporte – PIS/Pasep
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "D101" | C | 004* | - | S |
| 02 | IND_NAT_FRT | Natureza do frete contratado | C | 001* | - | S |
| 03 | VL_ITEM | Valor total dos itens | N | - | 02 | S |
| 04 | CST_PIS | CST PIS | N | 002* | - | S |
| 05 | NAT_BC_CRED | Base de cálculo do crédito (Tab. 4.3.7) | C | 002* | - | N |
| 06 | VL_BC_PIS | Base de cálculo | N | - | 02 | N |
| 07 | ALIQ_PIS | Alíquota (%) | N | 008 | 04 | N |
| 08 | VL_PIS | Valor | N | - | 02 | N |
| 09 | COD_CTA | Conta contábil | C | 255 | - | N |
Nível 4, 1:N. **Um registro por IND_NAT_FRT** (e por CST).
IND_NAT_FRT: 0=venda, ônus do vendedor; 1=venda, ônus do adquirente; 2=compras geradoras de crédito;
3=compras não geradoras de crédito; 4=transferência de produtos acabados; 5=transferência de produtos em
elaboração; 9=outras (subcontratação de transportadora).
CST válidos (entradas): 50–56 (crédito), 60–66 (presumido), 70–75, 98, 99. Transferências (4/5) sem
previsão de crédito → CST 70.
NAT_BC_CRED: obrigatório se CST de crédito. Para frete de venda: **07 = "Armazenagem de mercadoria e
frete na operação de venda"** (Tab. 4.3.7). Para frete na compra (IND_NAT_FRT 2) usar o código da
aquisição correspondente (01 = aquisição de bens para revenda; 02 = bens utilizados como insumo; 03 =
serviços como insumo) — conferir Tab. 4.3.7. Subcontratação: 14.
VL_BC_PIS: somente a parcela com direito a crédito (se parte do serviço não gera crédito, informar só a
parte com crédito). Recuperado em M105 `VL_BC_PIS_TOT`.
ALIQ_PIS: 1,65 (não cumulativo); 1,2375 no presumido de subcontratação.
Validação: VL_PIS = VL_BC_PIS × ALIQ_PIS / 100. VL_PIS **não** é levado ao M (recalculado lá).
COD_CTA: ex. "fretes sobre vendas", "despesas de comercialização".

### D105 — Complemento do Documento de Transporte – Cofins
Idêntico ao D101 trocando PIS→COFINS: `REG "D105" | IND_NAT_FRT | VL_ITEM | CST_COFINS | NAT_BC_CRED |
VL_BC_COFINS | ALIQ_COFINS N(008,04) | VL_COFINS | COD_CTA`. Alíquota 7,6 (presumido subcontratação 5,7).
Base → M505 `VL_BC_COFINS_TOT`. Validação VL_COFINS = BC × ALIQ / 100.
Ex.: BC 1.000.000,00 × 7,6/100 = 76.000,00.

### D111 — Processo Referenciado (filho de D100) — ver regra transversal.

### Mapeamento CT-e (XML) → D100/D101/D105 (empresa tomadora)
| Campo SPED | XML CT-e (mod 57 / 67) | Observação |
|---|---|---|
| IND_OPER | fixo "0" | |
| IND_EMIT | "1" (terceiros) | "0" só se o CNPJ do emitente for estabelecimento próprio |
| COD_PART | `emit/CNPJ` (+IE, xNome, UF, cMun → 0150) | transportadora |
| COD_MOD | `ide/mod` (57, 67) | |
| COD_SIT | `protCTe/infProt/cStat` + eventos: 100→00; cancelado (evento 110111)→02; 110/301/302 denegado→04; inutilizado→05; `tpCTe`=1 complemento→06 | |
| SER | `ide/serie` | |
| NUM_DOC | `ide/nCT` | |
| CHV_CTE | `infCte/@Id` sem prefixo "CTe" (44 díg.) | validar DV mod 11, CNPJ/UF/mod/série/nº |
| DT_DOC | `ide/dhEmi` → ddmmaaaa | |
| DT_A_P | data de entrada/recebimento no ERP (ou dhEmi) | |
| TP_CT-e | `ide/tpCTe` | |
| CHV_CTE_REF | vazio | (apesar de haver `infCteComp/chCTe` ou `infCteAnu/chCte`) |
| VL_DOC | `vPrest/vTPrest` | |
| VL_DESC | 0 (CT-e não tem desconto próprio) | |
| IND_FRT | derivar de `ide/toma3/toma` ou `toma4`: 0=remetente,1=expedidor,2=recebedor,3=destinatário,4=outros. Tomador=destinatário/remetente→"1"; tomador≠remetente e ≠destinatário ("outros"/terceiro)→"2" | |
| VL_SERV | `vPrest/vTPrest` (inclui pedágio/Comp) | |
| VL_BC_ICMS | `imp/ICMS/*/vBC` | valida = VL_SERV − VL_NT |
| VL_ICMS | `imp/ICMS/*/vICMS` | |
| VL_NT | VL_SERV − vBC (ICMS isento/não tributado, CST 40/41/51/SN) | |
| **Validação de tomador** | CNPJ do tomador (`toma3`→ pega o CNPJ do papel indicado; `toma4/CNPJ`) deve ter raiz = CNPJ da empresa escriturante | só o tomador credita |
| IND_NAT_FRT | derivar dos NF-e vinculados (`infCTeNorm/infDoc/infNFe/chave`): se a NF-e é SAÍDA do cliente (emitente = empresa) → 0; se é ENTRADA (compra; destinatário = empresa) → 2 (ou 3 se itens sem crédito); se NF-e de transferência (CFOP 5152/6152/5151/6151) → 4/5 CST 70; devolução → sem crédito | |
| VL_ITEM | vTPrest (ou rateio por natureza) | |
| CST/NAT_BC_CRED | 50 / 07 (venda) ; 50 / 01-02-03 (compra) | CST 53/56 quando receita tributada + não tributada (farmácia com monofásicos → rateio no M) |

**Atenção farmácia/varejo:** muitas vendas de farmácia são monofásicas (CST 04) → receitas "não
tributadas". Frete na venda vinculado a receitas tributadas e não tributadas: usar CST 53 e fazer rateio
proporcional (M105 + 0111). Frete na compra de monofásico: sem crédito (IND_NAT_FRT 3, CST 70).

## D200 — Resumo da Escrituração Diária – PRESTAÇÃO de Serviços de Transporte (07,08,8B,09,10,11,26,27,57,63,67)
Consolidação diária dos documentos **válidos** emitidos (receita de frete — transportadoras). Não usar em comércio.
Campos: `REG "D200" C004*S | COD_MOD C002*S | COD_SIT N002*S | SER C004 N | SUB C003 N | NUM_DOC_INI N009 S |
NUM_DOC_FIN N009 S | CFOP N004* S | DT_REF N008* S | VL_DOC N-02 S | VL_DESC N-02 N`.
Nível 3, 1:N. COD_MOD [07,08,8B,09,10,11,26,27,57,63,67]; COD_SIT [00,01,06,07,08] — não incluir
cancelados/denegados/inutilizados. NUM_DOC_INI > 0 e ≤ NUM_DOC_FIN. Agrupar por modelo+série+subsérie+CFOP+dia.

### D201 (PIS) / D205 (COFINS) — Totalização do resumo diário
`REG | CST N002* S | VL_ITEM N-02 S | VL_BC N-02 N | ALIQ N008,04 N | VL N-02 N | COD_CTA C255 N`.
CST de saída: 01, 02, 06, 07, 08, 09, 49, 99. Alíquota PIS 0,65/1,65; COFINS 3/7,6. BC → M210/M610 VL_BC_CONT.
D209 — processo referenciado.

## D300 — Resumo diário – Bilhetes consolidados (13 rodoviário, 14 aquaviário, 15 passagem+bagagem, 16 ferroviário, 18 resumo movimento diário)
Transporte de passageiros. Campos: REG, COD_MOD C002*S, SER C004, SUB N003, NUM_DOC_INI N006, NUM_DOC_FIN
N006, CFOP N004*S, DT_REF N008*S, VL_DOC S, VL_DESC, CST_PIS S, VL_BC_PIS, ALIQ_PIS, VL_PIS, CST_COFINS S,
VL_BC_COFINS, ALIQ_COFINS, VL_COFINS, COD_CTA (19 campos). Nível 3. NUM_DOC_INI ≤ FIN, > 0. D309 processo.

## D350 — Resumo diário de Cupom Fiscal por ECF (2E, 13, 14, 15, 16) — transporte
Campos: REG, COD_MOD S, ECF_MOD C020 S, ECF_FAB C021 S, DT_DOC S (≤ DT_FIN), CRO N003 S (>0), CRZ N006 S
(>0), NUM_COO_FIN N006 S (>0), GT_FIN S, VL_BRT S (>0), CST_PIS S, VL_BC_PIS, ALIQ_PIS, QUANT_BC_PIS
(N-03), ALIQ_PIS_QUANT (R$, N-04), VL_PIS, CST_COFINS S, VL_BC_COFINS, ALIQ_COFINS, QUANT_BC_COFINS,
ALIQ_COFINS_QUANT, VL_COFINS, COD_CTA (23 campos). BC valor → M210/M610 VL_BC_CONT; quantidade →
QUANT_BC_*_TOT. D359 processo. (Não aplicável a comércio.)

## D500 — Aquisição de Serviço de Comunicação (21) / Telecomunicação (22) com direito a crédito
**Quando usar:** contratação de comunicação/telecom que, pela natureza do serviço e atividade da PJ,
gere crédito (insumo). Para varejo, telefone/internet normalmente **não** é insumo → não escriturar
(sujeito a análise do conceito de insumo, REsp 1.221.170 — decisão do contador).
| Nº | Campo | Tipo | Tam | Obrig |
|---|---|---|---|---|
| 01 REG "D500" | C | 004* | S |
| 02 IND_OPER [0] | C | 001* | S |
| 03 IND_EMIT [0,1] | C | 001* | S |
| 04 COD_PART (0150, prestador) | C | 060 | S |
| 05 COD_MOD [21,22] | C | 002* | S |
| 06 COD_SIT [00,01,02,03,06,07,08] | N | 002* | S |
| 07 SER | C | 004 | N |
| 08 SUB | N | 003 | N |
| 09 NUM_DOC (>0) | N | 009 | S |
| 10 DT_DOC | N | 008* | S |
| 11 DT_A_P (data entrada) | N | 008* | S |
| 12 VL_DOC (>0; valor com direito a crédito) | N | -,02 | S |
| 13 VL_DESC | N | -,02 | N |
| 14 VL_SERV | N | -,02 | S |
| 15 VL_SERV_NT | N | -,02 | N |
| 16 VL_TERC | N | -,02 | N |
| 17 VL_DA (outras despesas) | N | -,02 | N |
| 18 VL_BC_ICMS | N | -,02 | N |
| 19 VL_ICMS | N | -,02 | N |
| 20 COD_INF (0450) | C | 006 | N |
| 21 VL_PIS | N | -,02 | N |
| 22 VL_COFINS | N | -,02 | N |
DT_DOC ou DT_A_P dentro do período. (NFCom mod. 62 é posterior a este guia — verificar leiaute atual.)

### D501 (PIS) / D505 (COFINS)
`REG | CST N002* S | VL_ITEM N-02 S | NAT_BC_CRED C002* N | VL_BC N-02 N | ALIQ N008,04 N | VL N-02 N | COD_CTA C255 N`.
Um registro por item com crédito e por CST. NAT_BC_CRED: 03 (serviços como insumo) ou 13 (outras
operações com direito a crédito). Alíquotas 1,65/7,6. BC → M105/M505. Valida VL = BC×ALIQ/100.
D509 — processo.

## D600 — Consolidação da PRESTAÇÃO de serviços de comunicação/telecom (21, 22)
Para empresas de telecom (receita). Inclui receitas "a faturar" (serviço prestado, não faturado) — em
D600, não em F100. Campos: REG, COD_MOD [21,22] S, COD_MUN N007* (IBGE), SER, SUB, IND_REC N001* S,
QTD_CONS S, DT_DOC_INI S, DT_DOC_FIN S, VL_DOC S (>0), VL_DESC, VL_SERV S, VL_SERV_NT, VL_TERC, VL_DA,
VL_BC_ICMS, VL_ICMS, VL_PIS, VL_COFINS.
IND_REC: 0 serviços prestados; 1 cobrança de débitos; 2 pré-pago faturado em períodos anteriores; 3 pré-pago
faturado no período; 4 outras receitas próprias de comunicação; 5 co-faturamento; 6 a faturar em período
futuro; 7 outras receitas próprias não cumulativas; 8 receitas de terceiros; 9 outras.
### D601 (PIS) / D605 (COFINS)
`REG | COD_CLASS N004* S (Tab. 4.4.1 Ato COTEPE 09/2008) | VL_ITEM S (>0) | VL_DESC (descontos/exclusões) |
CST S | VL_BC | ALIQ | VL | COD_CTA`. CST de saída (01,02,06,07,08,09,49,99). D609 processo.
(Não aplicável a comércio.)

## D990 — Encerramento do Bloco D
`REG "D990" | QTD_LIN_D N S`. Obrigatório se existir D001; conta D001 e D990.

---

# BLOCO F — Demais Documentos e Operações

Operações geradoras de contribuição ou crédito **não informadas nos Blocos A, C e D**.
Mapa do guia:
| Registro | Conteúdo |
|---|---|
| F100 | Demais receitas (financeiras, JCP, aluguéis, venda de ativo não circulante, outras) e outras operações com crédito (arrendamento mercantil, aluguéis de prédios/máquinas, armazenagem, insumos sem NF de A/C/D, importação via DI) |
| F120 | Crédito sobre encargos de depreciação/amortização do imobilizado |
| F130 | Crédito sobre valor de aquisição do imobilizado |
| F150 | Crédito presumido sobre estoque de abertura |
| F200/F205/F210 | Atividade imobiliária (receita / custo incorrido / custo orçado) |
| F500/F510 | Lucro Presumido — regime de CAIXA, consolidado (ad valorem / por unidade) |
| F525 | Composição da receita recebida (regime de caixa) |
| F550/F560 | Lucro Presumido — regime de COMPETÊNCIA, consolidado (ad valorem / por unidade) |
| F600 | Retenções na fonte |
| F700 | Outras deduções |
| F800 | Créditos de eventos de incorporação, fusão e cisão |
Escrituração centralizada: tudo sob o F010 da sede. Por estabelecimento: segregado sob cada F010.

Hierarquia:
```
F001 (1)
 └ F010 (2)
    ├ F100 (3) ── F111 (4)
    ├ F120 (3) ── F129 (4)
    ├ F130 (3) ── F139 (4)
    ├ F150 (3)
    ├ F200 (3) ── F205 (4, 1:1) / F210 (4) / F211 (4)
    ├ F500 (3) ── F509 (4)
    ├ F510 (3) ── F519 (4)
    ├ F525 (3)
    ├ F550 (3) ── F559 (4)
    ├ F560 (3) ── F569 (4)
    ├ F600 (3)
    ├ F700 (3)
    └ F800 (3)
F990 (1)
```

## F001 — Abertura do Bloco F
`REG "F001" C004* S | IND_MOV C001 S [0,1]`. Nível 1, um por arquivo. IND_MOV=1 → só F001 e F990.

## F010 — Identificação do Estabelecimento
`REG "F010" | CNPJ N014* S`. Nível 2. DV conferido, deve estar no 0140. Só estabelecimentos com operações no Bloco F.

## F100 — Demais Documentos e Operações Geradoras de Contribuição e Créditos
**Quando usar:** operações que, pela natureza ou documentação, não cabem em registros próprios de A, C, D e F:
- Receitas: financeiras; JCP recebidos; aluguéis (bens móveis/imóveis); faturamento atribuído a
  associado/cooperado; outras receitas operacionais/não operacionais sem documento fiscal específico
  (ex.: venda de imobilizado — imóvel), receitas de consórcio, construção civil por empreitada, contratos,
  educação/saúde etc.
- Créditos (Lucro Real): aluguel de prédios, máquinas e equipamentos (de PJ) usados na atividade;
  contraprestação de arrendamento mercantil; **armazenagem de mercadorias**; insumos com documentação que
  não vai em A/C/D; **importação** quando o crédito é tomado pela DI (competência do desembaraço) e não pela
  NF de entrada; crédito presumido de subcontratação de transporte (seguir regras do D100);
  **créditos presumidos sobre receitas específicas** (café exportação Lei 12.599/2012, soja/margarina/biodiesel
  Lei 12.865/2013 etc.).
- **Operações sem direito a crédito NÃO precisam ser escrituradas no F100.**
- Individualizar operações com crédito (cada contrato de locação, cada arrendamento). Receitas: por
  natureza/tratamento; pode consolidar quando o volume justifica (ex.: "Rendimentos aplicação – Banco X").
- Operações não vinculadas a estabelecimento específico → sob o F010 da sede.

**Comércio (farmácia/varejo):** Lucro Real → aluguel do ponto comercial pago a PJ (crédito, NAT_BC_CRED 05 — conferir Tab. 4.3.7:
01 revenda, 02 insumos-bens, 03 insumos-serviços, 04 energia, 05 aluguel de prédios, 06 aluguel de máquinas,
07 armazenagem/frete na venda, 08 arrendamento, 09 depreciação, 10 aquisição imobilizado, 11 amortização,
12 devolução de vendas, 13 outras, 14 subcontratação transporte, 15/16 imobiliária, 17 serviços de limpeza etc., 18 estoque de abertura —
"aluguéis de prédios"), energia não vai aqui (vai no C500), receitas financeiras (no Real, desde
jul/2015 o Decreto 8.426/2015 fixa 0,65% / 4% → CST 02 alíquota diferenciada; JCP recebido 1,65/7,6 —
fora do texto do guia, confirmar com o contador), aluguéis recebidos. Lucro Presumido → receitas financeiras em regra NÃO compõem base do cumulativo
(receita bruta, Lei 12.973/2014) → CST 08/49/99 com IND_OPER 2 ou simplesmente não informar; conferir com o contador.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "F100" | C | 004* | - | S |
| 02 | IND_OPER | 0=aquisição/custo/despesa/encargo ou receita com crédito (CST 50–66); 1=receita tributada (CST 01,02,03,05); 2=receita não tributada (CST 04,06,07,08,09,49,99) | C | 001* | - | S |
| 03 | COD_PART | Participante (0150) | C | 060 | - | N (S se IND_OPER=0) |
| 04 | COD_ITEM | Item (0200) | C | 060 | - | N |
| 05 | DT_OPER | Data da operação | N | 008* | - | S |
| 06 | VL_OPER | Valor da operação/item | N | - | 02 | S |
| 07 | CST_PIS | CST PIS (Tab. 4.3.3) | N | 002* | - | S |
| 08 | VL_BC_PIS | Base PIS | N | - | **04** | N |
| 09 | ALIQ_PIS | Alíquota PIS | N | 008 | 04 | N |
| 10 | VL_PIS | Valor PIS | N | - | 02 | N |
| 11 | CST_COFINS | CST COFINS (Tab. 4.3.4) | N | 002* | - | S |
| 12 | VL_BC_COFINS | Base COFINS | N | - | **04** | N |
| 13 | ALIQ_COFINS | Alíquota COFINS | N | 008 | 04 | N |
| 14 | VL_COFINS | Valor COFINS | N | - | 02 | N |
| 15 | NAT_BC_CRED | Base de crédito (Tab. 4.3.7) se CST de crédito | C | 002* | - | N |
| 16 | IND_ORIG_CRED | 0=mercado interno; 1=importação | C | 001* | - | N |
| 17 | COD_CTA | Conta contábil | C | 255 | - | N |
| 18 | COD_CCUS | Centro de custos (operações com crédito) | C | 255 | - | N |
| 19 | DESC_DOC_OPER | Descrição do documento/operação | C | - | - | N |

Regras:
- IND_OPER deve ser coerente com CST: 0 ↔ 50–66; 1 ↔ 01,02,03,05; 2 ↔ 04,06,07,08,09,49,99.
  (O guia menciona 05 em ambos no texto do campo; seguir a tabela do campo 02.)
- COD_PART: obrigatório se IND_OPER=0 (fornecedor/prestador no 0150); opcional para receitas (usar campo 19).
- COD_ITEM, se informado, deve existir no 0200 (códigos próprios da PJ).
- DT_OPER: se a operação abrange vários dias, usar o dia final ou o último dia do período.
- Bases com 4 decimais no leiaute (por causa de alíquota por quantidade — combustíveis/bebidas frias);
  PVA arredonda. Gerar com 2 decimais para ad valorem.
- VL = BC × ALIQ / 100 (ad valorem). Não recuperado no M.
- BC de receita tributada (01,02,03,05) → M210/M610 VL_BC_CONT; BC de crédito (50–56, 60–67) → M105/M505.
- Crédito presumido específico: NAT_BC_CRED 13 obriga preencher DESC_CRED em M105/M505
  (ex.: CST 62, ALIQ 0,1650/0,76 — café exportação, Tab. 4.3.9 item 110). Devoluções de vendas sujeitas a
  crédito presumido reduzem a base.

## F111 — Processo Referenciado (filho de F100). Ver regra transversal.

## F120 — Imobilizado: créditos sobre ENCARGOS DE DEPRECIAÇÃO/AMORTIZAÇÃO
**Quando usar:** Lucro Real; bens do ativo imobilizado usados na **produção de bens para venda, prestação de
serviços ou locação a terceiros**, e amortização de **edificações e benfeitorias** em imóveis próprios ou de
terceiros usados na atividade. Valor = encargo contabilizado no período, só da parcela com direito a crédito.
Um bem nunca pode estar em F120 e F130 ao mesmo tempo.
Sem direito a crédito: bens adquiridos antes de maio/2004 (art. 31 Lei 10.865/2004); máquinas/equipamentos
de área administrativa, comercial, gerencial, TI, almoxarifado. **Comércio varejista:** em regra só
edificações/benfeitorias (reforma de loja, IDENT_BEM_IMOB 01/02, NAT 11) geram crédito; máquinas de loja
(balcões, PDV) são "comerciais" → sem crédito (IND_UTIL 9).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "F120" | C | 004* | - | S |
| 02 | NAT_BC_CRED | 09=depreciação; 11=amortização | C | 002* | - | S |
| 03 | IDENT_BEM_IMOB | 01 edif./benf. imóveis próprios; 02 edif./benf. imóveis de terceiros; 03 instalações; 04 máquinas; 05 equipamentos; 06 veículos; 99 outros | N | 002* | - | S |
| 04 | IND_ORIG_CRED | 0 interno; 1 importação (branco = PVA assume 0) | C | 001* | - | N |
| 05 | IND_UTIL_BEM_IMOB | 1 produção de bens p/ venda; 2 prestação de serviços; 3 locação a terceiros; 9 outros | N | 001* | - | S |
| 06 | VL_OPER_DEP | Encargo de depreciação/amortização do período | N | - | 02 | S |
| 07 | PARC_OPER_NAO_BC_CRED | Parcela sem direito a crédito | N | - | 02 | N |
| 08 | CST_PIS | | N | 002* | - | S |
| 09 | VL_BC_PIS | = 06 − 07 | N | - | 02 | N |
| 10 | ALIQ_PIS | % | N | 008 | 04 | N |
| 11 | VL_PIS | | N | - | 02 | N |
| 12 | CST_COFINS | | N | 002* | - | S |
| 13 | VL_BC_COFINS | = 06 − 07 | N | - | 02 | N |
| 14 | ALIQ_COFINS | % | N | 008 | 04 | N |
| 15 | VL_COFINS | | N | - | 02 | N |
| 16 | COD_CTA | | C | 255 | - | N |
| 17 | COD_CCUS | | C | 255 | - | N |
| 18 | DESC_BEM_IMOB | Descrição do bem/grupo | C | - | - | N |
Validações: NAT [09,11]; IDENT [01,02,03,04,05,06,99] (grupo misto → qualquer código do grupo); IND_UTIL
[1,2,3,9]; BC = 06 − 07; VL = BC×ALIQ/100. Campo 07 inclui: bens adquiridos de pessoa física; bens não
sujeitos ao pagamento das contribuições na aquisição; edificações não usadas na atividade; máquinas não
usadas em produção/locação/serviços. BC → M105/M505.
F129 — processo referenciado.

## F130 — Imobilizado: créditos sobre VALOR DE AQUISIÇÃO
**Quando usar:** Lucro Real; bens para produção/serviços que, por natureza/NCM/destinação/data, permitem
crédito sobre o valor de aquisição (integral, 12, 24, 48 meses etc.). Excludente com F120.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "F130" | C | 004* | - | S |
| 02 | NAT_BC_CRED | fixo "10" | C | 002* | - | S |
| 03 | IDENT_BEM_IMOB | 01 edificações e benfeitorias; 03; 04; 05; 06; 99 (02 aparece nos valores válidos também) | N | 002* | - | S |
| 04 | IND_ORIG_CRED | 0/1 | C | 001* | - | N |
| 05 | IND_UTIL_BEM_IMOB | 1,2,3,9 | N | 001* | - | S |
| 06 | MES_OPER_AQUIS | mmaaaa da aquisição (branco se grupo com datas diversas) | N | 006* | - | N |
| 07 | VL_OPER_AQUIS | Valor de aquisição | N | - | 02 | S |
| 08 | PARC_OPER_NAO_BC_CRED | Parcela sem crédito | N | - | 02 | N |
| 09 | VL_BC_CRED | = 07 − 08 (base total) | N | - | 02 | S |
| 10 | IND_NR_PARC | 1 integral; 2 12 meses; 3 24 meses; 4 48 meses; 5 6 meses (embalagens bebidas frias); 9 outra | N | 001* | - | S |
| 11 | CST_PIS | | N | 002* | - | S |
| 12 | VL_BC_PIS | base MENSAL = 09 / nº meses | N | - | 02 | N |
| 13 | ALIQ_PIS | | N | 008 | 04 | N |
| 14 | VL_PIS | | N | - | 02 | N |
| 15 | CST_COFINS | | N | 002* | - | S |
| 16 | VL_BC_COFINS | base MENSAL = 09 / nº meses | N | - | 02 | N |
| 17 | ALIQ_COFINS | | N | 008 | 04 | N |
| 18 | VL_COFINS | | N | - | 02 | N |
| 19 | COD_CTA | | C | 255 | - | N |
| 20 | COD_CCUS | | C | 255 | - | N |
| 21 | DESC_BEM_IMOB | | C | - | - | N |
Regras: NAT [10]; IND_ORIG [0,1]; IND_NR_PARC [1,2,3,4,5,9]. Máquinas/equipamentos a partir de 03/08/2011
com prazo < 12 meses (MP 540/2011) → indicador 9 e MES_OPER_AQUIS identifica o nº de meses.
Validações: 09 = 07 − 08; 12/16 = 09 / nº meses; VL = BC×ALIQ/100. O software deve controlar as parcelas
mês a mês (gera F130 em todas as competências até esgotar). F139 — processo.

## F150 — Crédito Presumido sobre Estoque de Abertura
**Quando usar:** PJ que **ingressou no regime não cumulativo** (ex.: passou de Presumido para Real) — crédito
sobre estoque existente na data de ingresso de bens para revenda (**exceto ST e monofásicos** — muito
relevante para farmácia: medicamentos monofásicos ficam fora) e insumos, adquiridos de PJ no país. Bens
recebidos em devolução tributados antes da mudança integram o estoque de abertura.
Só preencher se o ingresso no não cumulativo ocorreu **até 12 meses antes** do período; crédito em
**12 parcelas mensais iguais** a partir do ingresso.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "F150" | C | 004* | - | S |
| 02 | NAT_BC_CRED | fixo "18" | C | 002* | - | S |
| 03 | VL_TOT_EST | Valor total do estoque de abertura (livros fiscais) | N | - | 02 | S |
| 04 | EST_IMP | Parcela importada ou sem direito a crédito (PF, alíquota zero, ST, monofásico...) | N | - | 02 | N |
| 05 | VL_BC_EST | = 03 − 04 | N | - | 02 | S |
| 06 | VL_BC_MEN_EST | = 05 / 12 | N | - | 02 | S |
| 07 | CST_PIS | [50–56] | N | 002* | - | S |
| 08 | ALIQ_PIS | fixo 0,65 | N | 008 | 04 | S |
| 09 | VL_CRED_PIS | = 06 × 08 / 100 | N | - | 02 | S |
| 10 | CST_COFINS | [50–56] | N | 002* | - | S |
| 11 | ALIQ_COFINS | fixo 3,0 | N | 008 | 04 | S |
| 12 | VL_CRED_COFINS | = 06 × 11 / 100 | N | - | 02 | S |
| 13 | DESC_EST | Descrição/composição (opcional) | C | 100 | - | N |
| 14 | COD_CTA | | C | 255 | - | N |
Atenção: alíquotas presumidas 0,65% / 3% (não 1,65/7,6). Parcela mensal vai ao M100/M500 e desconta em M200/M600.

## F200 — Atividade Imobiliária – Unidade Imobiliária Vendida
Só para PJ com receita imobiliária (compra para venda, loteamento, desmembramento, incorporação, construção
para venda). Um registro por unidade vendida. Não aplicável a comércio.
Campos: REG; IND_OPER N002* S [01 venda à vista concluída, 02 a prazo concluída, 03 à vista em construção,
04 a prazo em construção, 05 outras]; UNID_IMOB N002* S [01 terreno p/ venda, 02 loteamento, 03
desmembramento, 04 incorporação, 05 prédio construído/em construção, 06 outras]; IDENT_EMP C S; DESC_UNID_IMOB
C090 N; NUM_CONT C090 N; CPF_CNPJ_ADQU C014 S (adquirente, não o pagador; demais adquirentes no INF_COMP);
DT_OPER S; VL_TOT_VEND S (atualizado); VL_REC_ACUM N (até mês anterior); VL_TOT_REC S (no mês); CST_PIS S;
VL_BC_PIS; ALIQ_PIS (0,65/1,65); VL_PIS; CST_COFINS S; VL_BC_COFINS; ALIQ_COFINS (3/7,6); VL_COFINS;
PERC_REC_RECEB N006,02 = (10+11)/09; IND_NAT_EMP [1 consórcio, 2 SCP, 3 incorporação em condomínio, 4 outras];
INF_COMP C090. BC → M210/M610. Distrato: estorno de créditos via M110/M510.
### F205 — Custo incorrido da unidade (1:1)
VL_CUS_INC_ACUM_ANT, VL_CUS_INC_PER_ESC, VL_CUS_INC_ACUM (=02+03), VL_EXC_BC_CUS_INC_ACUM (mão de obra PF,
encargos, bens sem contribuição), VL_BC_CUS_INC (=04−05), CST_PIS (50), ALIQ_PIS 1,65, VL_CRED_PIS_ACUM
(=06×08), VL_CRED_PIS_DESC_ANT, VL_CRED_PIS_DESC (proporcional à receita do mês → desconta no M200),
VL_CRED_PIS_DESC_FUT (=09−10−11); idem COFINS (7,6). Todos obrigatórios.
### F210 — Custo orçado (opcional; só IND_OPER 03/04 do F200)
VL_CUS_ORC S, VL_EXC S, VL_CUS_ORC_AJU S (=02−03), VL_BC_CRED S (proporcional à receita do mês), CST_PIS S,
ALIQ_PIS, VL_CRED_PIS_UTIL (=05×07), CST_COFINS S, ALIQ_COFINS, VL_CRED_COFINS_UTIL.
### F211 — Processo referenciado.

## Lucro Presumido consolidado — visão geral F500/F510/F525/F550/F560
Estes registros são a alternativa **simplificada** para PJ do **Lucro Presumido** (regime cumulativo,
0,65% / 3%), em vez de escriturar documento a documento nos Blocos A/C/D:
| Regime de reconhecimento | Alíquota ad valorem (% sobre R$) | Alíquota por unidade (R$ por quantidade) | Detalhamento obrigatório |
|---|---|---|---|
| **Caixa** (art. 20 MP 2.158-35/2001) | **F500** | F510 | **F525** (obrigatório a partir de abr/2013) |
| **Competência** (Lei 9.718/1998) | **F550** | F560 | Receitas devem constar no **Bloco 1 / registro 1900** — o guia diz "L900", ver nota |
Regras comuns:
- **Um registro por combinação CST + alíquota** (ex.: farmácia no presumido: CST 01 0,65/3 para
  tributados; CST 04 alíquota 0 para monofásicos revendidos; CST 05 para ST; CST 06 alíquota zero; CST 07/08/09).
- VL_PIS = VL_BC × ALIQ / 100 (ex.: 1.000.000,00 × 0,65 / 100 = 6.500,00; COFINS × 3,0 = 30.000,00).
  Não recuperado no M; M210/M610 recalculam sobre VL_BC_CONT.
- Base → M210/M610 VL_BC_CONT (só CST tributado). Ajuste de exclusão do ICMS: Seção 12 do guia.
- COD_MOD opcional mas recomendado: 55 (NF-e), **65 (NFC-e)**, 99 (outros), 98 (NFS municipal).
  Na prática: segregar F500/F550 por COD_MOD + CFOP + CST + alíquota gera uma escrituração "mais transparente"
  e casa com a origem XML (NF-e/NFC-e).
- CFOP opcional; se informado, deve existir na tabela (Ajuste SINIEF 07/01).
- COD_CTA: obrigatório a partir de nov/2017 (erro no PVA) para quem tem ECD; PJ do presumido dispensada de ECD
  (IN RFB 1.774/2017) pode informar o texto literal **"Dispensa de ECD - IN RFB nº 1.774/2017"** no COD_CTA.
- Alternativa: Lucro Presumido **pode** escriturar por documento (C100/C170, C180/C190 para NFC-e etc.) em
  vez de consolidado; a escolha é declarada no 0110 campo IND_REG_CUM (regime cumulativo) — conferir os
  valores exatos do 0110 no Bloco 0 do guia (não faz parte deste recorte).
- **Estratégia para nosso gerador (farmácia no Presumido, competência):** somar itens das NF-e/NFC-e de saída
  autorizadas (excluir canceladas/denegadas/inutilizadas), subtrair devoluções de venda (CFOP 1202/2202/1411...)
  como VL_DESC ou reduzindo a receita, agrupar por (COD_MOD, CFOP, CST_PIS, ALIQ_PIS, CST_COFINS,
  ALIQ_COFINS), gerar F550 com VL_REC_COMP = soma vProd − vDesc (+ vOutro/vFrete se receita); VL_BC = receita
  − exclusões (ICMS destacado, exclusão da "Tese do Século" RE 574.706 — ver Seção 12 do guia; confirmar
  com o contador se e como aplicar, e usar VL_DESC_PIS/VL_DESC_COFINS para a exclusão).

## F500 — Lucro Presumido, regime de CAIXA (ad valorem)
Receitas **recebidas** no período por CST. Total dos F500 = total dos F525.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "F500" | C | 004* | - | S |
| 02 | VL_REC_CAIXA | Receita recebida (CST + alíquota) | N | - | 02 | S |
| 03 | CST_PIS | [01,02,04,05,06,07,08,09,49,99] | N | 002* | - | S |
| 04 | VL_DESC_PIS | Desconto/exclusão da base | N | - | 02 | N |
| 05 | VL_BC_PIS | Base | N | - | 02 | N |
| 06 | ALIQ_PIS | % | N | 008 | 04 | N |
| 07 | VL_PIS | | N | - | 02 | N |
| 08 | CST_COFINS | mesmos valores | N | 002* | - | S |
| 09 | VL_DESC_COFINS | | N | - | 02 | N |
| 10 | VL_BC_COFINS | | N | - | 02 | N |
| 11 | ALIQ_COFINS | % | N | 008 | 04 | N |
| 12 | VL_COFINS | | N | - | 02 | N |
| 13 | COD_MOD | Tab. 4.1.1 (65 NFC-e, 99 outros, 98 NFS) | C | 002* | - | N |
| 14 | CFOP | | N | 004* | - | N |
| 15 | COD_CTA | | C | 255 | - | N |
| 16 | INFO_COMPL | | C | - | - | N |
Validações de campo: CST válido na lista; VL = BC × ALIQ / 100. (Implícito: VL_BC = VL_REC − VL_DESC.)
F509 — processo.

## F510 — Lucro Presumido, CAIXA, alíquota por unidade de medida (R$)
Para fabricante/importador de bebidas frias (regime especial art. 58-J Lei 10.833), combustíveis (art. 23
Lei 10.865), álcool (art. 5º Lei 9.718), embalagens de bebidas frias (art. 51 Lei 10.833) etc.
Campos: REG; VL_REC_CAIXA S; CST_PIS S [03,05,06,07,08,09,49,99]; VL_DESC_PIS; QUANT_BC_PIS (N,03);
ALIQ_PIS_QUANT (R$, N 008,04); VL_PIS (= QUANT × ALIQ); CST_COFINS S; VL_DESC_COFINS; QUANT_BC_COFINS;
ALIQ_COFINS_QUANT; VL_COFINS; COD_MOD; CFOP; COD_CTA; INFO_COMPL. Quantidade → M210/M610 QUANT_BC_*.
Um registro por CST + alíquota. F519 — processo. **Não se aplica a farmácia/varejo** (revendedor de
monofásico usa CST 04 no F500/F550, não F510/F560).

## F525 — Composição da Receita Escriturada no Período – Receita Recebida pelo Regime de Caixa
**Obrigatório** (desde abr/2013) para Presumido no regime de caixa. Total de F525 = total de F500 (+F510).
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "F525" | C | 004* | - | S |
| 02 | VL_REC | Receita recebida total do indicador | N | - | 02 | S |
| 03 | IND_REC | 01 clientes; 02 administradora de cartão; 03 título de crédito (duplicata, NP, cheque); 04 documento fiscal; 05 item vendido; 99 outros (detalhar no campo 10) | C | 002* | - | S |
| 04 | CNPJ_CPF | Cliente pagador (01) ou administradora de cartões (02) | C | 014 | - | N |
| 05 | NUM_DOC | Nº do título (03) ou documento fiscal (04) | C | 060 | - | N |
| 06 | COD_ITEM | Item (0200) se IND_REC 05 | C | 060 | - | N |
| 07 | VL_REC_DET | Valor detalhado | N | - | 02 | S |
| 08 | CST_PIS | | N | 002* | - | N |
| 09 | CST_COFINS | | N | 002* | - | N |
| 10 | INFO_COMPL | | C | - | - | N |
| 11 | COD_CTA | | C | 255 | - | N |
Uso de "99" só quando nenhum outro se aplica (ex.: rendimentos de aplicação financeira).
**Varejo/farmácia no caixa:** vendas NFC-e à vista → IND_REC 04 (por documento) ou 05 (por item); cartão →
IND_REC 02 com CNPJ da adquirente (precisa de dado financeiro — **não vem do XML**; o XML só tem
`pag/detPag/card/CNPJ` quando integrado — usar se existir). Regime de caixa exige conciliação
financeira: XML sozinho NÃO basta (recebimento a prazo). Sinalizar ao usuário.

## F550 — Lucro Presumido, regime de COMPETÊNCIA (ad valorem) — **principal para nossos clientes do Presumido**
Receitas **auferidas** no período (independe do recebimento), por CST + alíquota.
Campos idênticos ao F500, trocando `VL_REC_CAIXA` por `VL_REC_COMP`:
`REG | VL_REC_COMP N-02 S | CST_PIS N002* S | VL_DESC_PIS | VL_BC_PIS | ALIQ_PIS N008,04 | VL_PIS | CST_COFINS S |
VL_DESC_COFINS | VL_BC_COFINS | ALIQ_COFINS | VL_COFINS | COD_MOD C002* N | CFOP N004* N | COD_CTA C255 N | INFO_COMPL C N`.
CST válidos [01,02,04,05,06,07,08,09,49,99]. ALIQ pode ser % ou R$ (produtores/importadores monofásicos) — mas
para unidade de medida o próprio guia manda usar F560. Base → M210/M610. F559 — processo.
Nota do guia: receitas do F550 "devem estar relacionadas no registro L900" — no leiaute atual o
demonstrativo consolidado de receitas por documento é o **registro 1900** (Bloco 1). Validar no leiaute.

## F560 — Lucro Presumido, COMPETÊNCIA, alíquota por unidade (R$)
Igual F510 trocando VL_REC_CAIXA → VL_REC_COMP. CST [03,05,06,07,08,09,49,99]. Hipóteses: bebidas frias e
embalagens (fatos geradores até 30/04/2015), combustíveis, álcool. F569 — processo.

## F600 — Contribuição Retida na Fonte
**Quando usar:** PJ **beneficiária** (sofreu retenção) informa PIS/COFINS efetivamente retidos:
1) órgãos/autarquias/fundações federais (art. 64 Lei 9.430/96); 2) empresas públicas/SEM federais (art. 34
Lei 10.833); 3) PJ de direito privado pagando serviços de limpeza, conservação, manutenção, segurança,
vigilância, transporte de valores, locação de mão de obra, assessoria creditícia/mercadológica, gestão de
crédito, contas a pagar/receber, serviços profissionais (art. 30 Lei 10.833 — 4,65% CSRF); 4) associações,
sindicatos, cooperativas, condomínios idem; 5) órgãos estaduais/municipais (art. 33 Lei 9.430); 6) montadoras
na aquisição de autopeças (art. 3º Lei 10.485/02); 7) outras. Também recolhimentos por cooperativas de
vendas em comum (art. 66 Lei 9.430) — pela cooperada (IND_DEC 0) ou pela cooperativa (IND_DEC 1).
**Visão financeira:** informar o efetivamente retido no pagamento, **não** o destacado na NF.
**Não é levado automaticamente ao M200/M600** — o gerador deve preencher a dedução em M200/M600
(campos de retenção na fonte) do valor a utilizar no mês. Para varejo: raro (venda a órgão público).
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "F600" | C | 004* | - | S |
| 02 | IND_NAT_RET | 01 órgãos/autarquias/fundações federais; 02 outras entidades da adm. pública federal; 03 PJ de direito privado; 04 recolhimento por cooperativa; 05 fabricante de máquinas e veículos; 99 outras | N | 002* | - | S |
| 03 | DT_RET | Data da retenção (≤ DT_FIN; várias/desconhecida → DT_FIN do 0000) | N | 008* | - | S |
| 04 | VL_BC_RET | Base da retenção (se desconhecida: líquido recebido + IR/CSLL/PIS/COFINS retidos) | N | - | **04** | S |
| 05 | VL_RET | Total retido (se desconhecido: soma campos 09+10) | N | - | 02 | S |
| 06 | COD_REC | Código de receita DARF (branco se desconhecido) | C | 004 | - | N |
| 07 | IND_NAT_REC | 0 não cumulativa (inclusive mista); 1 cumulativa | N | 001* | - | N |
| 08 | CNPJ | Fonte pagadora (se beneficiária) ou beneficiária (se responsável) | N | 014* | - | S |
| 09 | VL_RET_PIS | | N | - | 02 | S |
| 10 | VL_RET_COFINS | | N | - | 02 | S |
| 11 | IND_DEC | 0 beneficiária; 1 responsável pelo recolhimento | N | 001* | - | S |
Ex. base desconhecida: fatura 1.000,00, retido 45,00 (CSLL 1% + PIS 0,65% + COFINS 3%), líquido 955,00 → VL_BC_RET 1.000,00.

## F700 — Deduções Diversas
Deduções previstas em lei (inclusive créditos não específicos do não cumulativo) abatidas em M200/M600.
**Chave única:** IND_ORI_DED + IND_NAT_DED + CNPJ.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "F700" | C | 004* | - | S |
| 02 | IND_ORI_DED | 01 créditos presumidos – medicamentos; 02 créditos admitidos no cumulativo – bebidas frias; 03 contribuição paga pelo substituto tributário – ZFM; 04 ST – não ocorrência do fato gerador presumido; 99 outras | N | 002* | - | S |
| 03 | IND_NAT_DED | 0 não cumulativa; 1 cumulativa | N | 001* | - | S |
| 04 | VL_DED_PIS | | N | - | 02 | S |
| 05 | VL_DED_COFINS | | N | - | 02 | S |
| 06 | VL_BC_OPER | Base da operação que gerou a dedução | N | - | 02 | N |
| 07 | CNPJ | PJ relacionada (não obrigatório p/ IND_ORI_DED 01; bebidas frias/CMB: CNPJ do envasador) | N | 014* | - | N |
| 08 | INF_COMP | | C | 090 | - | N |
Farmácia: "01 – créditos presumidos medicamentos" refere-se ao crédito presumido do regime especial de
fabricantes/importadores (lista positiva, Lei 10.147/2000) — **não** é do varejista. Farmácia só usaria F700
em hipóteses como 04 (ST com fato gerador presumido não ocorrido) ou 99. Também não é recuperado
automaticamente — o gerador precisa levar ao M200/M600 (campo de outras deduções).

## F800 — Créditos Decorrentes de Eventos de Incorporação, Fusão e Cisão
Sucessora informa créditos (art. 3º Leis 10.637/10.833 e importação Lei 10.865) recebidos da sucedida.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "F800" | C | 004* | - | S |
| 02 | IND_NAT_EVEN | 01 incorporação; 02 fusão; 03 cisão total; 04 cisão parcial; 99 outros | N | 002* | - | S |
| 03 | DT_EVEN | Data do evento (≤ DT_FIN) | N | 008* | - | S |
| 04 | CNPJ_SUCED | CNPJ da sucedida | N | 014* | - | S |
| 05 | PA_CONT_CRED | Período de apuração do crédito (mmaaaa) | N | 006* | - | S |
| 06 | COD_CRED | Tipo de crédito (Tab. 4.3.6) | N | 003* | - | S |
| 07 | VL_CRED_PIS | Crédito transferido PIS | N | - | 02 | S |
| 08 | VL_CRED_COFINS | Crédito transferido COFINS | N | - | 02 | S |
| 09 | PER_CRED_CIS | % transferido (cisão) | N | 006 | 02 | N |
Créditos mantêm as condições de origem (desconto se mercado interno; compensação/ressarcimento se exportação/não tributadas).

## F990 — Encerramento do Bloco F
`REG "F990" | QTD_LIN_F N S`. Conta F001 e F990. Obrigatório se existir F001.

---

# BLOCO I — Instituições Financeiras, Seguradoras, Previdência Privada, Planos de Saúde (§§ 6º, 8º e 9º art. 3º Lei 9.718/98) — resumo

**Não se aplica a farmácias/varejo.** Só habilitado quando 0000 campo 14 `IND_ATIV = 3`; nesse caso o PVA
**desabilita os Blocos A, C, D e F** e todas as receitas vão ao Bloco I (regime cumulativo, IN RFB 1.285/2012;
obrigatório desde fatos geradores de 01/2014). Também agências de fomento (MP 2.192-70).
Nosso validador: se IND_ATIV ≠ 3 → Bloco I deve ser só `I001|1|` + `I990|2|`; se IND_ATIV = 3 → rejeitar
registros de A/C/D/F.
Registros:
- **I001** abertura (IND_MOV 0/1) · **I990** encerramento (QTD_LIN_I).
- **I010** — CNPJ N014* (DV, no 0140; centralizado = CNPJ do 0000) + IND_ATIV N002* [01 IF e assemelhadas;
  02 seguros privados; 03 previdência complementar; 04 capitalização; 05 planos de saúde; 06 mais de um] + INFO_COMPL.
- **I100** — consolidação por CST: VL_REC, CST_PIS_COFINS [01,02,03,04,05,06,07,08,09,49,99],
  VL_TOT_DED_GER, VL_TOT_DED_ESP, VL_BC_PIS, ALIQ_PIS (0,65), VL_PIS, VL_BC_COFINS, ALIQ_COFINS (4% em
  regra, 3% aceito — ambos exigem CST 01), VL_COFINS, INFO_COMPL. Chave: CST+ALIQ_PIS+ALIQ_COFINS+INFO_COMPL.
  BC → M210/M610. BC COFINS pode diferir da BC PIS (dedução específica D0110 – arrecadação de receitas federais).
- **I199** processo (filho I100).
- **I200** — composição de I100 campos 02/04/05: NUM_CAMPO C002*, COD_DET C005* (Tab. 7.1.1 receitas /
  7.1.2 deduções), DET_VALOR, COD_CTA, INFO_COMPL. Soma dos I200 = campo correspondente do I100.
  Chave NUM_CAMPO+COD_DET+COD_CTA+INFO_COMPL. **I299** processo.
- **I300** — detalhamento analítico do I200 (desde 01/2014): COD_COMP C060 (Tab. 7.1.3/7.1.4), DET_VALOR,
  COD_CTA, INFO_COMPL. Soma dos I300 = DET_VALOR do I200 pai. **I399** processo (nível 6).

---

# BLOCO P — Contribuição Previdenciária sobre a Receita Bruta (CPRB)

**O que é:** contribuição substitutiva da cota patronal do INSS (art. 22, I e III, Lei 8.212/91) sobre a
receita bruta — "desoneração da folha" (arts. 7º e 8º Lei 12.546/2011: TI/TIC, call center, fabricantes de
vestuário, calçados, couro etc.; atividades/NCM/alíquotas na **Tabela 5.1.1**; alíquotas típicas 1%–4,5%).
**Independente** dos Blocos A/C/D/F/M: não recupera nem envia dados a eles.

**Quando se aplica / quando gerar:**
- Só se existir ao menos um **registro 0145** (filho do 0140). Sem 0145 → **não gerar nenhum registro do
  Bloco P** (nem P001/P990). Com 0145 → P001, P010, P100 (≥1), P200, P990 obrigatórios.
- 0145 na matriz dispensa 0145 nos demais estabelecimentos fabricantes (PVA ≥ 2.02).
- Para fabricantes: só incide sobre produtos **industrializados pela empresa** (não sobre revenda).
- Empresa com outras atividades: CPRB sobre a receita da Tab. 5.1.1 + INSS patronal proporcional sobre a
  folha. Se as outras atividades ≤ 5% da receita total (atividade sujeita ≥ 95%) → CPRB sobre a receita
  total, demais receitas com código **99999999**.
- Nos meses sem receita sujeita → INSS sobre a folha integral.
- **Comércio varejista:** esteve sujeito (códigos 00100020–00100190 da Tab. 5.1.1) em abr–mai/2013 (MP 601),
  e a partir de nov/2013 (Lei 12.844/2013, com antecipação opcional jun–out/2013). A Lei 13.161/2015 tornou a
  CPRB **opcional** (anual, a partir de 12/2015) e a **Lei 13.670/2018 excluiu a maioria dos setores,
  inclusive varejo, a partir de set/2018** (fora do texto do guia — conferir). Hoje o varejo (farmácias)
  em regra **não** tem CPRB.
- **Migração para a EFD-Reinf:** CPRB passou a ser escriturada na **EFD-Reinf (evento R-2060)** conforme o
  cronograma de cada grupo (NT EFD-Contribuições 07/2018; IN RFB 1.701/2017). A partir da obrigatoriedade na
  Reinf, **não escriturar mais o Bloco P**. Para períodos atuais (2019+), na prática o Bloco P não é gerado.
  => Nosso gerador: não gerar 0145/Bloco P para períodos atuais; o validador deve alertar se aparecer 0145.

**Hierarquia:**
```
P001 (1)
 ├ P010 (2, por estabelecimento com 0145)
 │  └ P100 (3) ── P110 (4, opcional) / P199 (4, processo)
 └ P200 (2, consolidação na matriz) ── P210 (3, ajustes)
P990 (1)
```

## P001 — Abertura: `REG | IND_MOV C001 S [0,1]`.

## P010 — Identificação do Estabelecimento
`REG | CNPJ N014* S`. DV; deve estar no 0140 **e ter 0145**. Só estabelecimentos com receita sujeita à CPRB.

## P100 — Contribuição Previdenciária sobre a Receita Bruta
Chave: DT_INI + DT_FIN + COD_ATIV_ECON + ALIQ_CONT + COD_CTA. ≥1 por estabelecimento com receita sujeita.
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "P100" | C | 004* | - | S |
| 02 | DT_INI | Data inicial da apuração | C | 008* | - | S |
| 03 | DT_FIN | Data final | C | 008* | - | S |
| 04 | VL_REC_TOT_EST | Receita bruta total do estabelecimento (sujeitas + não sujeitas) | N | - | 02 | S |
| 05 | COD_ATIV_ECON | Código da atividade (Tab. 5.1.1, 8 caracteres fixos) | C | 008* | - | S |
| 06 | VL_REC_ATIV_ESTAB | Receita bruta da atividade do campo 05 (≤ campo 04) | N | - | 02 | S |
| 07 | VL_EXC | Exclusões da receita (se decisão judicial transitada → P199 + 1010) | N | - | 02 | N |
| 08 | VL_BC_CONT | = 06 − 07 | N | - | 02 | S |
| 09 | ALIQ_CONT | Alíquota (deve constar na Tab. 5.1.1) | N | 008 | 04 | S |
| 10 | VL_CONT_APU | = 08 × 09 (/100) | N | - | 02 | S |
| 11 | COD_CTA | Conta contábil (regra nov/2017) | C | 255 | - | N |
| 12 | INFO_COMPL | | C | - | - | N |
Receita sempre pelo **regime de competência** (mesmo que PIS/COFINS no caixa). Um P100 por código da
Tab. 5.1.1 (classificação por NCM do produto fabricado).

## P110 — Detalhamento da apuração (opcional)
`REG | NUM_CAMPO C002* S (campo do P100 detalhado) | COD_DET C008* N (Tab. 5.1.2) | DET_VALOR N-02 S | INF_COMPL C N`.
Soma dos DET_VALOR por NUM_CAMPO ≤ valor do campo no P100.

## P199 — Processo referenciado (filho P100). Ver regra transversal.

## P200 — Consolidação da CPRB (centralizada na matriz)
| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "P200" | C | 004* | - | S |
| 02 | PER_REF | mmaaaa | N | 006* | - | S |
| 03 | VL_TOT_CONT_APU | Σ P100.VL_CONT_APU do período | N | - | 02 | S |
| 04 | VL_TOT_AJ_REDUC | Σ P210.VL_AJ com IND_AJ=0 | N | - | 02 | N |
| 05 | VL_TOT_AJ_ACRES | Σ P210.VL_AJ com IND_AJ=1 | N | - | 02 | N |
| 06 | VL_TOT_CONT_DEV | = 03 − 04 + 05 | N | - | 02 | S |
| 07 | COD_REC | Código DCTF sem barra, 6 posições: 298501 (art. 7º), 298504 / 298506 (construção, CEI até/desde 12/2015), 299101 (art. 8º) | C | 006* | - | S |
Nível 2, vários por arquivo.

## P210 — Ajustes da CPRB
| Nº | Campo | Descrição | Tipo | Tam | Obrig |
|---|---|---|---|---|---|
| 01 | REG "P210" | | C | 004* | S |
| 02 | IND_AJ | 0 redução; 1 acréscimo | C | 001* | S |
| 03 | VL_AJ | Valor (N,02) | N | - | S |
| 04 | COD_AJ | Tab. 4.3.8: 07 = regime de caixa no Presumido; 08 = diferimento (venda a órgão público não recebida, art. 7º Lei 9.718); 09 = recebimento de receita diferida | C | 002* | S |
| 05 | NUM_DOC | Processo/documento/ato | C | - | N |
| 06 | DESCR_AJ | Descrição | C | - | N |
| 07 | DT_REF | ddmmaaaa | N | 008* | N |

## P990 — Encerramento: `REG | QTD_LIN_P`. Obrigatório se houver P001.

---

# Checklist de validação sugerido (D/F/P) para o nosso validador

1. Blocos: x001.IND_MOV coerente com existência de filhos; x990.QTD_LIN = contagem real (inclui abertura/fecho).
2. x010: CNPJ com DV válido e presente no 0140; sem x010 sem filhos.
3. Campos numéricos: vírgula decimal, casas conforme leiaute (F100 BC com até 4, F600 VL_BC_RET 4, alíquotas 4).
4. Linha: VL_PIS/VL_COFINS = BC × ALIQ / 100 (tolerância de arredondamento ±0,01).
5. D100: COD_MOD ∈ lista; COD_SIT ∈ {00,02,04,05,06,08}; CHV_CTE obrigatória para 57 (DV, CNPJ raiz/UF do
   COD_PART, modelo/série/número); DT_DOC ou DT_A_P no período; VL_BC_ICMS = VL_SERV − VL_NT; chave única;
   ≥1 D101 e ≥1 D105; CHV_CTE_REF vazio; empresa = tomador do CT-e.
6. D101/D105: IND_NAT_FRT ∈ {0,1,2,3,4,5,9}; CST de entrada; NAT_BC_CRED obrigatório se CST 50–66; IND 4/5 → CST 70;
   regime cumulativo (Presumido) não deve ter D100 com CST de crédito.
7. F100: IND_OPER × CST coerentes; COD_PART obrigatório p/ IND_OPER 0; COD_PART no 0150; COD_ITEM no 0200;
   NAT_BC_CRED p/ CST de crédito; NAT 13 exige DESC_CRED em M105/M505.
8. F120: NAT ∈ {09,11}; BC = VL_OPER_DEP − PARC; bem não pode estar também em F130.
9. F130: NAT = 10; BC_CRED = VL_OPER_AQUIS − PARC; BC mensal = BC_CRED / meses(IND_NR_PARC).
10. F150: NAT 18; CST 50–56; ALIQ 0,65 / 3,00; BC_MEN = BC_EST/12; só até 12 meses após ingresso no não cumulativo.
11. F500/F550: CST ∈ {01,02,04,05,06,07,08,09,49,99}; um registro por (CST, alíquota[, COD_MOD, CFOP]); CFOP válido;
    Presumido-caixa → F525 obrigatório e Σ F525.VL_REC = Σ F500.VL_REC_CAIXA (+F510).
12. F510/F560: CST ∈ {03,05,06,07,08,09,49,99}; VL = QUANT × ALIQ_QUANT.
13. F600/F700: valores não sobem automaticamente ao M — conferir M200/M600 (deduções) = soma utilizada.
    F600: DT_RET ≤ DT_FIN. F700: chave IND_ORI_DED+IND_NAT_DED+CNPJ única.
14. F800: DT_EVEN ≤ DT_FIN; COD_CRED na Tab. 4.3.6.
15. COD_CTA obrigatório (erro) desde 11/2017 exceto Presumido sem ECD (aceita "Dispensa de ECD - IN RFB nº 1.774/2017").
16. Coerência regime (0110): cumulativo (Presumido) → sem créditos (D101/D105/F100 IND_OPER 0/F120/F130/F150);
    não cumulativo (Real) → sem F500/F510/F525/F550/F560.
17. Bloco P: só se houver 0145; P010 CNPJ com 0145; P100.VL_REC_ATIV ≤ VL_REC_TOT; BC = REC − EXC; P200.03 = Σ P100.10;
    P200.06 = 03 − 04 + 05; COD_REC 6 posições. Períodos pós-Reinf → alertar.
