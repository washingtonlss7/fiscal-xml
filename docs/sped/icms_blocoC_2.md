# EFD-ICMS/IPI — Bloco C (parte 2): C350 → C990

Fonte: Guia Prático EFD-ICMS/IPI v3.2.2 (atualização 11/02/2026), linhas ~7099–10497 do `guia_icms_ipi.txt` (págs. 116–~172).
Contexto do produto: gerar e validar EFD a partir de XMLs NF-e (55) / NFC-e (65) / CT-e (57) para farmácias/varejo no **Espírito Santo (ES)**.

Convenções: Tipo N = numérico, C = caractere; Tam com `*` = tamanho fixo; Dec = casas decimais; Obrig.: O = obrigatório, OC = obrigatório condicional (pode vir vazio `||`), "Não apresentar" = não pode existir naquele sentido (Entrada/Saída).
Datas sempre `ddmmaaaa`. Decimais com vírgula no arquivo.

> **Observação geral de 1ª parte do Bloco C**: C350/C400/C800 e seus filhos **não** servem para NFC-e (mod. 65). NFC-e é escriturada em **C100** (sem C170 — ver Guia parte 1: NFC-e informa C100 + C190, CPF do consumidor não vai no 0150) — o documento de consolidação não é permitido para mod. 65 na EFD-ICMS/IPI (diferente da EFD-Contribuições, que tem C400/C490/C495 e C860 etc.). Confirme na nota da parte 1 (C100) as regras específicas mod. 65.

## Mapa rápido de relevância para farmácia/varejo no ES

| Registro(s) | Documento | Relevância no projeto |
|---|---|---|
| C350/C370/C380/C390 | NF de venda a consumidor mod. 02 (talão papel) | Legado; praticamente inexistente hoje. Implementar só leitura/validação opcional. |
| C400–C495 | ECF (cupom fiscal mod. 2D, 02; CF-e-ECF mod. 60) | **Obsoleto** no ES: ECF foi substituído pela NFC-e (o ES tornou NFC-e obrigatória e vedou novos ECF; uso residual até esgotamento/cessação). Não há XML — dados vinham de arquivo MFD/Redução Z. Implementar como "não suportado"/validação apenas se o cliente importar movimento ECF histórico. C495 era só BA até 2013 → ignorar. |
| **C500/C510/C590/C591/C595/C597** | Energia elétrica (06), NF3e (66), água (29), gás (28) | **Alta** — toda farmácia/loja recebe conta de energia; entrada com crédito de ICMS (comércio em regra NÃO se credita de energia — ver LC 87/96 art. 33 II; crédito só p/ industrialização etc.). Fonte: XML NF3e (mod. 66) quando disponível; conta papel mod. 06 digitada. |
| C600/C601/C610/C690 | Consolidação diária de saídas de energia/água/gás | Somente fornecedores (distribuidoras). **Não usar** para varejo. |
| C700/C790/C791 | Consolidação Conv. 115/03 e NF3e — saídas de distribuidoras | **Não usar** para varejo. |
| C800–C897 | CF-e-SAT (mod. 59) | **Somente SP** (SAT-CF-e é equipamento paulista; CE usa MFE mod. 59 também). **No ES não existe SAT** → não gerar. Validador: rejeitar/alertar mod. 59 para UF=ES. |
| C990 | Encerramento | Obrigatório sempre. |

---

## GRUPO C350 — NF de Venda a Consumidor modelo 02 (não emitida por ECF)

Hierarquia: `C350 (N2) → C370 (N3, 1:N) → C380 (N4, 1:1)` e `C350 → C390 (N3, 1:N)`.
Só **Saída** (Entrada = "Não apresentar"). Notas canceladas **não** são informadas. CNPJ/CPF do C350 **não** vai no 0150.
XML: não há (documento em papel). Alternativa moderna: NFC-e → C100.

### C350 — NF de venda a consumidor (cód. 02) — Nível 2, vários por arquivo
| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG = "C350" | C | 4 | - | O |
| 02 | SER | C | 3 | - | OC |
| 03 | SUB_SER | C | 3 | - | OC |
| 04 | NUM_DOC | N | 6 | - | O |
| 05 | DT_DOC | N | 8* | - | O |
| 06 | CNPJ_CPF (destinatário) | N | 14 | - | OC |
| 07 | VL_MERC | N | - | 2 | O |
| 08 | VL_DOC | N | - | 2 | O |
| 09 | VL_DESC | N | - | 2 | OC |
| 10 | VL_PIS | N | - | 2 | OC |
| 11 | VL_COFINS | N | - | 2 | OC |
| 12 | COD_CTA | C | - | - | OC |

Validações: CNPJ_CPF com 14 dígitos → valida CNPJ; 11 → CPF. VL_PIS/VL_COFINS: vazio (`||`) se o contribuinte entrega EFD-Contribuições do mesmo período (regra geral p/ todos os campos PIS/COFINS deste bloco).

### C370 — Itens do documento (cód. 02) — Nível 3, 1:N
Chave: NUM_ITEM + COD_ITEM.
| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG = "C370" | C | 4 | - | O |
| 02 | NUM_ITEM | N | 3 | - | O |
| 03 | COD_ITEM (0200) | C | 60 | - | O |
| 04 | QTD | N | - | 3 | O |
| 05 | UNID (0190) | C | 6 | - | O |
| 06 | VL_ITEM | N | - | 2 | O |
| 07 | VL_DESC | N | - | 2 | OC |
Validações: NUM_ITEM inicia em 1, incremento 1; COD_ITEM ∈ 0200; UNID ∈ 0190.

### C380 — Info complementares de saídas com ST (cód. 02) — Nível 4, 1:1 (filho do C370)
Obrigatoriedade definida pela UF (ressarcimento/restituição/complementação de ST – modelo "Tabela 5.7"). **Estrutura idêntica ao C430 e C480** (16 campos). **C815 e C880 têm só os campos 01–14 (sem CST_ICMS/CFOP, que já estão no pai C810/C870)**, e o **C880 usa 3 decimais** nos campos 05–14 (não 6). Implementar um tipo `InfoCompST` parametrizado (com/sem CST+CFOP, nº de decimais).

| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | COD_MOT_REST_COMPL (Tabela 5.7 da UF) | C | 5* | - | O |
| 03 | QUANT_CONV | N | - | 6 | O |
| 04 | UNID | C | 6 | - | O |
| 05 | VL_UNIT_CONV | N | - | 6 | O |
| 06 | VL_UNIT_ICMS_NA_OPERACAO_CONV | N | - | 6 | OC |
| 07 | VL_UNIT_ICMS_OP_CONV | N | - | 6 | OC |
| 08 | VL_UNIT_ICMS_OP_ESTOQUE_CONV | N | - | 6 | OC |
| 09 | VL_UNIT_ICMS_ST_ESTOQUE_CONV | N | - | 6 | OC |
| 10 | VL_UNIT_FCP_ICMS_ST_ESTOQUE_CONV | N | - | 6 | OC |
| 11 | VL_UNIT_ICMS_ST_CONV_REST | N | - | 6 | OC |
| 12 | VL_UNIT_FCP_ST_CONV_REST | N | - | 6 | OC |
| 13 | VL_UNIT_ICMS_ST_CONV_COMPL | N | - | 6 | OC |
| 14 | VL_UNIT_FCP_ST_CONV_COMPL | N | - | 6 | OC |
| 15 | CST_ICMS | N | 3* | - | O |
| 16 | CFOP | N | 4* | - | O |

Regras (comuns a C380/C430/C480/C815/C880) — por **3º caractere** do COD_MOT_REST_COMPL (deve ser 0,1,2,3):
- `0` → preencher 08, 09, 10; **vazios** 06, 07, 11–14.
- `1` → preencher 06, 08, 09, 10, 11, 12; vazios 07, 13, 14.
- `2` → preencher 08, 09, 10, 11, 12; vazios 06, 13, 14; 07 conforme UF.
- `3` → preencher 06, 08, 09, 10, 13, 14; vazios 07, 11, 12.
- QUANT_CONV > 0. UNID ∈ 0190; se ≠ unidade do 0200 → exigir 0220 com fator de conversão. UNID do filho pode diferir do pai (pai = unidade comercial do documento).
- VL_UNIT_CONV = valor unitário líquido (descontos/acréscimos incondicionais).
- Campo 06 = alíquota interna (incl. FCP, do 0200) × valor da saída como se não houvesse ST (com mesma redução de BC-ST).
- Fórmulas:
  - Restituição por não ocorrência do FG presumido, campo 07 obrigatório na UF: `11 = 08 + 09 − 07`.
  - Idem, campo 07 não obrigatório: `11 = 09` (o guia diz "campo 13 (VL_UNIT_ICMS_ST_ESTOQUE_CONV)" — erro de numeração; é o campo 09).
  - Saída com valor inferior à BC-ST: `11 = 08 + 09 − 06`.
  - Complemento: `13 = 06 − 08 − 09`.
- 09 inclui FCP-ST; 10 é a parcela FCP contida em 09; 12 e 14 = parcela FCP contida em 11 e 13.
- CST_ICMS ∈ tabela 4.3.1; CFOP = o do documento (em C430/C480/C815/C880 deve iniciar por "5").
- **ES**: verificar se SEFAZ-ES publicou Tabela 5.7 e se exige esse detalhamento (o ES historicamente não adotou o modelo de ressarcimento via C180/C185 como MG/SC/RS/PR/SP; tratar como opcional, habilitável por UF).
- Farmácia: medicamentos são ST → se a UF exigir, cada item de saída (C425/C470/C370/C810/C870) precisaria de C4x0/C8x0; no ES normalmente **não** gerar.

### C390 — Registro analítico das NF de venda a consumidor (cód. 02) — Nível 3, 1:N
Agrupar por CST_ICMS + CFOP + ALIQ_ICMS.
| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG = "C390" | C | 4 | - | O |
| 02 | CST_ICMS | N | 3* | - | O |
| 03 | CFOP | N | 4* | - | O |
| 04 | ALIQ_ICMS | N | 6 | 2 | OC |
| 05 | VL_OPR (incl. despesas acessórias/acréscimos) | N | - | 2 | O |
| 06 | VL_BC_ICMS | N | - | 2 | OC |
| 07 | VL_ICMS | N | - | 2 | OC |
| 08 | VL_RED_BC | N | - | 2 | OC |
| 09 | COD_OBS (0460) | C | 6 | - | OC |
Validações: CST com 1º caractere sempre "0" (origem nacional, Conv. SN/70); CFOP só saídas internas, iniciado por "5".

---

## GRUPO C400 — ECF (Emissor de Cupom Fiscal) — cód. 02, 2D e 60

Hierarquia:
```
C400 (N2, vários)  equipamento
 └ C405 (N3, 1:N)  Redução Z
    ├ C410 (N4, 1:1) PIS/COFINS do dia
    ├ C420 (N4, 1:N) totalizadores parciais
    │   └ C425 (N5, 1:N) resumo de itens do dia (perfil B ou quando não há C470)
    │       └ C430 (N6, 1:N) info compl. ST
    ├ C460 (N4, 1:N) documentos emitidos (perfil A)
    │   ├ C465 (N5, 1:1) complemento CF-e-ECF (mod. 60)
    │   └ C470 (N5, 1:N) itens
    │       └ C480 (N6, 1:1) info compl. ST
    └ C490 (N4, 1:N) analítico do dia (CST+CFOP+ALIQ)
C495 (N2) resumo mensal por item — só BA até 2013 (IGNORAR)
```
Tudo só **Saída**. **Status para o produto**: ECF é tecnologia em extinção; no ES a NFC-e substituiu o ECF (verificar cronograma/legislação SEFAZ-ES — RICMS/ES e Portarias sobre NFC-e; na prática não há novos ECF autorizados). Não há XML: os dados vêm do arquivo da MFD/Redução Z (Ato COTEPE 17/04). **Recomendação**: não gerar; aceitar importação de EFD já pronta desses registros e apenas validar estrutura/somatórios. Mod. 60 (CF-e-ECF) nunca foi massificado.

Perfis: Perfil A → C460/C470 por cupom; Perfil B → C425 (resumo de itens) — C470 não exigido.

### C400 — Equipamento ECF — Nível 2, vários
Unicidade: COD_MOD + ECF_MOD + ECF_FAB.
| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | COD_MOD [02, 2D, 60] | C | 2* | - | O |
| 03 | ECF_MOD | C | 20 | - | O |
| 04 | ECF_FAB (nº série) | C | 21 | - | O |
| 05 | ECF_CX (nº do caixa) | N | 3 | - | O |
ECF_CX não pode ser usado por dois ECF ao mesmo tempo (pode ser reatribuído após cessação).

### C405 — Redução Z — Nível 3, 1:N
| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | DT_DOC (data do movimento) | N | 8* | - | O |
| 03 | CRO | N | 3 | - | O |
| 04 | CRZ | N | 6 | - | O |
| 05 | NUM_COO_FIN | N | 9 | - | O |
| 06 | GT_FIN | N | - | 2 | O |
| 07 | VL_BRT | N | - | 2 | O |
Validações: DT_DOC ≤ DT_FIN do 0000; CRO, CRZ, COO > 0; GT_FIN ≥ VL_BRT (senão **advertência**, admitido em reinício de operação). VL_BRT = Σ C420.VLR_ACUM_TOT exceto COD_TOT_PAR ∈ {AT, AS, OPNF, DO, AO, Can-O, IOF}. Se VL_BRT = 0 → sem filhos e sem C490. Intervenção técnica: um C405 por Redução Z emitida.

### C410 — PIS e COFINS totalizados no dia — Nível 4, 1:1
Campos: 01 REG; 02 VL_PIS (N,-,2,OC); 03 VL_COFINS (N,-,2,OC). Dispensado se entregar EFD-Contribuições do período.

### C420 — Totalizadores parciais da Redução Z — Nível 4, 1:N
Unicidade: COD_TOT_PAR + NR_TOT.
| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | COD_TOT_PAR (Tabela 4.4.6) | C | 7 | - | O |
| 03 | VLR_ACUM_TOT | N | - | 2 | O |
| 04 | NR_TOT | N | 2 | - | OC |
| 05 | DESCR_NR_TOT | C | - | - | OC |
Regras: informar todos os totalizadores movimentados no dia. ICMS tributado: `Tnnnn` / `xxTnnnn` (nnnn = alíquota do C490.ALIQ_ICMS); ISS: `Snnnn`/`xxSnnnn`. Outros: Fn (ST), In (isento), Nn (não incidência), OPNF, DT/DS (descontos), AT/AS (acréscimos), Can-T/Can-S/Can-O, DO, AO, IOF. VLR_ACUM_TOT = Σ C490.VL_OPR para totalizadores T/S; Perfil B → = Σ C425.VL_ITEM. OPNF, DO, AO, Can-T, Can-S, Can-O → sem C490. NR_TOT = "xx" do código; > 0; obrigatório quando cargas efetivas idênticas (ex.: T1700 NR 1 = 17%, T1700 NR 2 = 17% por redução de BC). DESCR_NR_TOT só se NR_TOT preenchido.

### C425 — Resumo de itens do movimento diário — Nível 5, 1:N
Obrigatório quando C420.COD_TOT_PAR ∈ {Tnnnn, xxTnnnn, Fn, In, Nn}; proibido para OPNF, Can-T, Can-S, Can-O. Unicidade: COD_ITEM por C420.
| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | COD_ITEM (0200) | C | 60 | - | O |
| 03 | QTD | N | - | 3 | O |
| 04 | UNID (0190) | C | 6 | - | O |
| 05 | VL_ITEM | N | - | 2 | O |
| 06 | VL_PIS | N | - | 2 | OC |
| 07 | VL_COFINS | N | - | 2 | OC |
QTD > 0; VL_ITEM > 0 e = Σ valores líquidos; UNID ∈ 0190 e, se ≠ unidade do 0200, exigir 0220.

### C430 — Info compl. saídas com ST (ECF) — Nível 6, **1:N**
Mesma estrutura do C380 (16 campos) e mesmas regras; CFOP inicia por "5"; UNID do pai = C425.

### C460 — Documento fiscal emitido por ECF — Nível 4, 1:N
Unicidade: COD_MOD + NUM_DOC + DT_DOC. CPF/CNPJ **não** vai no 0150.
| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | COD_MOD [02, 2D, 60] | C | 2* | - | O |
| 03 | COD_SIT [00, 01, 02] | N | 2* | - | O |
| 04 | NUM_DOC (COO) | N | 9 | - | O |
| 05 | DT_DOC | N | 8* | - | O |
| 06 | VL_DOC | N | - | 2 | O |
| 07 | VL_PIS | N | - | 2 | OC |
| 08 | VL_COFINS | N | - | 2 | OC |
| 09 | CPF_CNPJ | N | 14 | - | OC |
| 10 | NOM_ADQ | C | 60 | - | OC |
Cancelado (COD_SIT=02): apenas REG, COD_MOD, COD_SIT, NUM_DOC; sem C470. NUM_DOC > 0. DT_DOC pode ser o dia seguinte ao movimento (tolerância de 2h, Conv. 85/01). VL_DOC > 0 e = Σ C470.VL_ITEM. CPF_CNPJ: 11 ou 14 dígitos, outro tamanho = inválido.

### C465 — Complemento do CF-e-ECF (cód. 60) — Nível 5, 1:1
Campos: 01 REG; 02 CHV_CFE (N,44,O — valida DV); 03 NUM_CCF (N,9,O, > 0).

### C470 — Itens do documento ECF (cód. 02 e 2D) — Nível 5, 1:N
Não informar para CF-e-ECF (60) nem para item totalmente cancelado. Serviço ISS também entra (item 0200 com TIPO_ITEM = 09).
| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | COD_ITEM | C | 60 | - | O |
| 03 | QTD | N | - | 3 | O |
| 04 | QTD_CANC | N | - | 3 | OC |
| 05 | UNID | C | 6 | - | O |
| 06 | VL_ITEM (líquido) | N | - | 2 | O |
| 07 | CST_ICMS | N | 3* | - | O |
| 08 | CFOP | N | 4* | - | O |
| 09 | ALIQ_ICMS (carga efetiva) | N | 6 | 2 | OC |
| 10 | VL_PIS | N | - | 2 | OC |
| 11 | VL_COFINS | N | - | 2 | OC |
QTD > 0; QTD_CANC < QTD; VL_ITEM > 0; CFOP inicia com "5".

### C480 — Info compl. ST (ECF item) — Nível 6, 1:1
Igual ao C380; UNID do pai = C470.

### C490 — Registro analítico do movimento diário (ECF) — Nível 4, 1:N
Não informar para OPNF, DO, AO, Can-T, Can-S, Can-O. Unicidade: CST_ICMS + CFOP + ALIQ_ICMS; a combinação deve existir nos C470 quando exigidos.
| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | CST_ICMS | N | 3* | - | O |
| 03 | CFOP | N | 4* | - | O |
| 04 | ALIQ_ICMS | N | 6 | 2 | OC |
| 05 | VL_OPR | N | - | 2 | O |
| 06 | VL_BC_ICMS | N | - | 2 | O |
| 07 | VL_ICMS | N | - | 2 | O |
| 08 | COD_OBS (0460) | C | 6 | - | OC |
Regra CST (padrão reutilizável — também C590, C690, C790, C850, C890):
- final 30, 40, 41, 50, 60 → VL_BC_ICMS = ALIQ_ICMS = VL_ICMS = 0;
- final 51 ou 90 → ≥ 0;
- demais → > 0.
CFOP inicia por "5". VL_OPR = líquido (+ despesas/acréscimos, − descontos incondicionais). Perfil A: VL_BC_ICMS = Σ C470.VL_ITEM de mesma combinação. VL_ICMS = carga efetiva × BC.

### C495 — Resumo mensal de itens do ECF (BA) — Nível 2, vários
Só BA até 31/12/2013; desde 2014 usa C425. **Não implementar** (apenas reconhecer e rejeitar para ES).
Campos: 01 REG; 02 ALIQ_ICMS (N,6,2,OC); 03 COD_ITEM (C,60,O); 04 QTD (N,-,3,O,>0); 05 QTD_CANC (N,-,3,OC); 06 UNID (C,6,O); 07 VL_ITEM (N,-,2,O,>0); 08 VL_DESC; 09 VL_CANC; 10 VL_ACMO; 11 VL_BC_ICMS; 12 VL_ICMS; 13 VL_ISEN; 14 VL_NT; 15 VL_ICMS_ST (todos N,-,2,OC). Unicidade COD_ITEM + ALIQ_ICMS.

---

## GRUPO C500 — Energia elétrica (06), NF3e (66), Água canalizada (29), Gás canalizado (28)  ★ PRIORIDADE

Hierarquia:
```
C500 (N2, vários)
 ├ C510 (N3, 1:N) itens — SÓ saída e SÓ documento NÃO eletrônico (06/28/29 papel)
 ├ C590 (N3, 1:N) analítico CST+CFOP+ALIQ  (≥1 obrigatório)
 │   └ C591 (N4, 1:1) FCP da NF3e (informativo)
 ├ C595 (N3, 1:N) observações do lançamento
 │   └ C597 (N4, 1:N) outras obrigações/ajustes
```

**Quem apresenta**: saídas → distribuidoras não obrigadas ao Conv. ICMS 115/03, fornecedores de gás, e desde 01/2020 emitentes de NF3e (mesmo obrigados ao 115/03). **Entradas → TODOS os contribuintes adquirentes** ⇒ a farmácia/varejo escritura aqui suas contas de luz, água e gás.

**Regra de ouro (entrada)**: campos de imposto, BC e alíquota só são preenchidos se o adquirente tiver **direito ao crédito** (enfoque do declarante). Comércio varejista: energia só gera crédito nas hipóteses da LC 87/96 art. 33, II (industrialização, exportação, quando ela própria é objeto de comercialização…) → para farmácia normalmente **sem crédito** ⇒ VL_BC_ICMS/VL_ICMS = 0 (ou vazios no C500), C590 com CST sob enfoque do declarante (ex.: `090` – "outras", ou `x90`/`x40` conforme parametrização) e VL_BC/ALIQ/VL_ICMS = 0. Água (29) não é fato gerador de ICMS em regra (CST 40/41). Parametrizar por empresa: `credita_energia: bool`.

**NF3e**: NF3e que contenha apenas itens sem CST **não** é escriturada. No C590 não entram itens sem CST nem itens de energia injetada; se a energia injetada gerar isenção sobre a fornecida (micro/minigeração — comum em lojas com painel solar), a parcela isenta vai em CST **40** com BC e ICMS = 0.

Exceções de preenchimento:
1. **COD_SIT 02/03 (cancelado)** → só REG, IND_OPER, IND_EMIT, COD_MOD, COD_SIT, SER, NUM_DOC, DT_DOC (+ CHV_DOCe se mod. 66); demais vazios; **sem filhos**.
2. NF3e **emissão própria** → sem C510.
3. **COD_SIT 06/07 (complementar)** → obrigatórios REG, IND_OPER, IND_EMIT, COD_PART, COD_MOD, COD_SIT, SER, NUM_DOC, DT_DOC; demais facultativos (validados se preenchidos); C590 obrigatório e completo.
4. **COD_SIT 08 (regime especial)** → C500 + C590 obrigatórios; mesmos campos obrigatórios da exceção 3 (+ CHV_DOCe se 66); no C590 só ALIQ_ICMS é facultativo.
5. NF3e de saída emitida por terceiros (consórcio Lei 6.404 arts. 278/279) → COD_SIT = 08 (PVA gera advertência).
Filiais com IE única/centralização: emissão própria + COD_SIT 00.
Regra geral: cada C500 (não cancelado) tem ≥1 C510 (quando aplicável) e ≥1 C590.

Unicidade C500: IND_OPER + IND_EMIT + COD_PART + SER + SUB + NUM_DOC + DT_DOC (+ CHV_DOCe desde 2020).

### C500 — campos (Nível 2, vários por arquivo)
| Nº | Campo | Tipo | Tam | Dec | Entr | Saída | Mapeamento XML NF3e (mod. 66) |
|---|---|---|---|---|---|---|---|
| 01 | REG = "C500" | C | 4 | - | O | O | — |
| 02 | IND_OPER 0-Entrada/1-Saída | C | 1* | - | O | O | entrada se `dest/CNPJ` = declarante |
| 03 | IND_EMIT 0-Própria/1-Terceiros | C | 1* | - | O | O | 1 se `emit/CNPJ` ≠ declarante |
| 04 | COD_PART (0150: fornecedor na entrada/adquirente na saída) | C | 60 | - | O | O | `emit` → 0150 (CNPJ, IE, xNome, enderEmit/cMun) |
| 05 | COD_MOD [06, 28, 29, 66] | C | 2* | - | O | O | `ide/mod` = 66 |
| 06 | COD_SIT [00,01,02,03,06,07,08] | N | 2* | - | O | O | 00 normal; `ide/finNF3e` 3/ajuste; protocolo cancelamento → 02 |
| 07 | SER | C | 4 | - | OC | OC | `ide/serie` |
| 08 | SUB | N | 3 | - | OC | OC | vazio se 66 |
| 09 | COD_CONS | C | 2* | - | OC | OC | vazio se 66; 06/28 → 01..08 (01 Comercial, 02 Consumo próprio, 03 Ilum. pública, 04 Industrial, 05 Poder público, 06 Residencial, 07 Rural, 08 Serviço público); 29 → Tabela 4.4.2 |
| 10 | NUM_DOC | N | 9 | - | O | O | `ide/nNF` |
| 11 | DT_DOC | N | 8* | - | O | O | `ide/dhEmi` |
| 12 | DT_E_S | N | 8* | - | O | O | data de entrada (escrituração) |
| 13 | VL_DOC | N | - | 2 | O | O | `total/vNF` |
| 14 | VL_DESC | N | - | 2 | OC | OC | desconto |
| 15 | VL_FORN | N | - | 2 | O | O | Σ itens cClass grupos 060–065, 085, 087 |
| 16 | VL_SERV_NT | N | - | 2 | OC | OC | Σ cClass grupos 070, 084, 085, 087 |
| 17 | VL_TERC | N | - | 2 | OC | OC | Σ cClass grupos 080, 081, 085, 086, 087 (ex.: COSIP/CIP iluminação pública, cobranças de terceiros) |
| 18 | VL_DA | N | - | 2 | OC | OC | despesas acessórias |
| 19 | VL_BC_ICMS | N | - | 2 | OC | OC | `total/ICMSTot/vBC` (só se credita) |
| 20 | VL_ICMS | N | - | 2 | OC | OC | `total/ICMSTot/vICMS` (só se credita) |
| 21 | VL_BC_ICMS_ST | N | - | 2 | OC | OC | `vBCST` |
| 22 | VL_ICMS_ST | N | - | 2 | OC | OC | `vST` |
| 23 | COD_INF (0450) | C | 6 | - | OC | OC | — |
| 24 | VL_PIS | N | - | 2 | OC | OC | `vPIS` (vazio se entrega EFD-Contrib.) |
| 25 | VL_COFINS | N | - | 2 | OC | OC | `vCOFINS` (idem) |
| 26 | TP_LIGACAO 1-Mono/2-Bi/3-Trifásico | N | 1* | - | OC | OC | vazio se 66 |
| 27 | COD_GRUPO_TENSAO 01..14 | C | 2* | - | OC | OC | vazio se 66 |
| 28 | CHV_DOCe | N | 44* | - | OC | OC | `infNF3e/@Id` sem prefixo "NF3e" — obrigatório se mod 66 |
| 29 | FIN_DOCe 1-Normal/2-Substituição/3-Normal c/ ajuste | N | 1* | - | OC | OC | `ide/finNF3e` — só mod 66 |
| 30 | CHV_DOCe_REF | N | 44* | - | OC | OC | `gSub/chNF3e` |
| 31 | IND_DEST 1-Contrib./2-Isento IE/9-Não contrib. | N | 1* | - | **N** | O | (só saída) `dest/indIEDest` |
| 32 | COD_MUN_DEST (IBGE 7) | N | 7* | - | **N** | O | (só saída) |
| 33 | COD_CTA | C | - | - | OC | OC | plano de contas |
| 34 | COD_MOD_DOC_REF [06, 66] | N | 2* | - | OC | OC | só se FIN_DOCe = 2 |
| 35 | HASH_DOC_REF (Conv. 115) | C | 32 | - | OC | OC | só se ref. mod 06 |
| 36 | SER_DOC_REF | C | 4 | - | OC | OC | `gSub/gNF/serie` |
| 37 | NUM_DOC_REF | N | 9 | - | OC | OC | `gSub/gNF/nNF` |
| 38 | MES_DOC_REF (mmaaaa) | N | 6* | - | OC | OC | `gSub/gNF/CompetEmis` |
| 39 | ENER_INJET | N | - | 2 | OC | OC | Σ cClass grupo 560, 085, 087 |
| 40 | OUTRAS_DED | N | - | 2 | OC | OC | Σ cClass grupo 590, 085, 087 |

> ⚠ Os caminhos XML NF3e acima são indicativos — conferir contra o leiaute NF3e (MOC NF3e / schema `nf3e_v1.00`), em especial `gSub`, `total`, `cClass` (7 dígitos, os 3 primeiros = grupo).

Validações C500:
- IND_OPER, IND_EMIT ∈ {0,1}. COD_PART ∈ 0150; se mod 66 e saída → COD_PART só quando IND_DEST = 1.
- SUB vazio se 66; COD_CONS vazio se 66; TP_LIGACAO e COD_GRUPO_TENSAO obrigatórios na saída mod 06, vazios se 66.
- NUM_DOC > 0. DT_DOC ≤ DT_FIN. DT_DOC ≤ DT_E_S ≤ DT_FIN.
- **VL_DOC = VL_FORN + VL_DA + VL_SERV_NT + VL_TERC − VL_DESC − ENER_INJET − OUTRAS_DED.**
- VL_ICMS = Σ C590.VL_ICMS; VL_ICMS_ST = Σ C590.VL_ICMS_ST.
- COD_INF ∈ 0450.
- CHV_DOCe: DV (módulo 11); se IND_EMIT=0 → raiz CNPJ da chave = raiz CNPJ do 0000; COD_MOD, SER, NUM_DOC coerentes com a chave; cUF da chave = UF do 0000 (⚠ isso vale para emissão própria? o guia diz "será comparada a UF" sem restrição — em entradas a distribuidora é da mesma UF (EDP ES, cUF 32), então ok).
- FIN_DOCe só se mod 66. CHV_DOCe_REF obrigatório se COD_MOD_DOC_REF = 66 (valida DV). COD_MOD_DOC_REF só se FIN_DOCe = 2.
- Ref. mod 06: HASH_DOC_REF **xor** (SER_DOC_REF + NUM_DOC_REF + MES_DOC_REF simultâneos). Esses campos vazios se COD_MOD_DOC_REF ≠ 06. SER_DOC_REF = "0" para série única; NUM_DOC_REF > 0.
- IND_DEST ∈ {1,2,9}; COD_MUN_DEST ∈ tabela IBGE (7 dígitos).

Notas ES: distribuidora de energia no ES = EDP Espírito Santo (+ algumas cooperativas/permissionárias, ex.: ELFSM, Santa Maria); NF3e já é emitida no ES — portanto **priorizar importação de XML NF3e**. Água (CESAN, SAAEs) e gás (ES Gás) normalmente mod. 29/28 em papel/PDF → entrada manual ou OCR; podem nem precisar ser escrituradas se a SEFAZ-ES não exigir (em regra devem, pois o C500 é "todos os adquirentes" — conferir orientação local).

### C510 — Itens do documento (06, 28, 29) — Nível 3, 1:N — **só saída, só não eletrônico**
Não se aplica à farmácia (entrada nunca tem C510). Unicidade NUM_ITEM + COD_ITEM.
| Nº | Campo | Tipo | Tam | Dec | Obrig (saída) |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | NUM_ITEM | N | 3 | - | O |
| 03 | COD_ITEM (0200) | C | 60 | - | O |
| 04 | COD_CLASS (Tabela 4.4.1; só energia) | N | 4* | - | OC |
| 05 | QTD | N | - | 3 | OC |
| 06 | UNID (0190) | C | 6 | - | OC |
| 07 | VL_ITEM (qtd × unitário) | N | - | 2 | O |
| 08 | VL_DESC | N | - | 2 | OC |
| 09 | CST_ICMS | N | 3* | - | O |
| 10 | CFOP | N | 4* | - | O |
| 11 | VL_BC_ICMS | N | - | 2 | OC |
| 12 | ALIQ_ICMS | N | 6 | 2 | OC |
| 13 | VL_ICMS | N | - | 2 | OC |
| 14 | VL_BC_ICMS_ST | N | - | 2 | OC |
| 15 | ALIQ_ST | N | 6 | 2 | OC |
| 16 | VL_ICMS_ST | N | - | 2 | OC |
| 17 | IND_REC 0-Própria/1-Terceiros | C | 1* | - | O |
| 18 | COD_PART (receptor da receita de terceiros) | C | 60 | - | OC |
| 19 | VL_PIS | N | - | 2 | OC |
| 20 | VL_COFINS | N | - | 2 | OC |
| 21 | COD_CTA | C | - | - | OC |
Validações: regra CST ICMS normal (30/40/41/50/60 → 0; 51/90 → ≥0; demais > 0) e **ICMS ST** (final 10, 30, 70 → BC_ST/ALIQ_ST/ICMS_ST ≥ 0; demais → = 0). CFOP: entrada 1/2/3, saída 5/6/7; mesmo 1º dígito em todos os itens; proibidos códigos-título (final 00 ou 50, ex. 5100). COD_CLASS vazio se não for energia.

### C590 — Registro analítico (06, 28, 29, 66) — Nível 3, 1:N  ★ usado na entrada
Um por combinação CST_ICMS + CFOP + ALIQ_ICMS (única); se houver C510, a combinação deve existir nos itens.
| Nº | Campo | Tipo | Tam | Dec | Entr | Saída |
|---|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O | O |
| 02 | CST_ICMS | N | 3* | - | O | O |
| 03 | CFOP | N | 4* | - | O | O |
| 04 | ALIQ_ICMS | N | 6 | 2 | OC | OC |
| 05 | VL_OPR | N | - | 2 | O | O |
| 06 | VL_BC_ICMS | N | - | 2 | OC | O |
| 07 | VL_ICMS | N | - | 2 | OC | O |
| 08 | VL_BC_ICMS_ST | N | - | 2 | OC | O |
| 09 | VL_ICMS_ST | N | - | 2 | OC | O |
| 10 | VL_RED_BC | N | - | 2 | OC | O |
| 11 | COD_OBS (0460) | C | 6 | - | OC | OC |

Preenchimento/validações:
- CST sob **enfoque do declarante** (desde 07/2012). Ex.: uso e consumo tributado → `090`; mercadoria p/ revenda com ST retida → `060`. Energia para farmácia sem crédito → sugerido `090` com BC/ICMS zerados (ou `041`/`040` conforme o caso — água). Conferir com o contador; tornar configurável.
- Regra CST ICMS normal/ST idêntica ao C510.
- CFOP entrada: tratamento conforme destinação — energia (Ajuste SINIEF 07/01): 1.251 comercialização/distribuição, 1.252 estabelecimento industrial, **1.253 estabelecimento comercial (farmácia/varejo)**, 1.254 prestador de transporte, 1.255 prestador de comunicação, 1.256 produtor rural, 1.257 consumo por demanda contratada (conferir descrição vigente na tabela CFOP). Gás canalizado: 1.653 (combustível p/ consumo) ou 1.556; água: 1.556 (uso e consumo) é o usual — **parametrizar**. Títulos (final 00/50) proibidos; IND_OPER=0 → 1/2/3; =1 → 5/6/7.
- VL_OPR = valor fornecido + despesas acessórias − desconto incondicional.
- VL_BC_ICMS, VL_ICMS, VL_BC_ICMS_ST, VL_ICMS_ST = Σ correspondentes do C510 (se existir).
- VL_RED_BC só se CST final 20 ou 70.
- Σ C590.VL_ICMS = C500.VL_ICMS; Σ C590.VL_ICMS_ST = C500.VL_ICMS_ST.
- NF3e: excluir itens sem CST e energia injetada; parcela isenta por compensação → CST 40, BC=ICMS=0.
- Particularidade DF (distribuidoras): itens ISS CFOP 5933 com zeros — irrelevante para ES.

Mapeamento NF3e → C590: agrupar `det/detItem/imposto/ICMS*` (CST, vBC, pICMS, vICMS, vBCST, vICMSST) por CST+CFOP(derivado pela destinação na entrada)+pICMS; VL_OPR = Σ `vProd` dos itens com CST.

### C591 — FCP na NF3e (mod. 66) — Nível 4, 1:1 (filho do C590)
Informativo — **não** entra na apuração do Bloco E. Obrigatoriedade definida por UF.
| Nº | Campo | Tipo | Tam | Dec | Entr | Saída |
|---|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O | O |
| 02 | VL_FCP_OP | N | - | 2 | OC | OC |
| 03 | VL_FCP_ST | N | - | 2 | OC | OC |
Validações: VL_FCP_OP só se CST do C590 = x00 ou x20; VL_FCP_ST só se CST = x10. XML: `vFCP` / `vFCPST` dos itens agrupados. **ES**: o ES não instituiu FCP adicional sobre energia (conferir) → em regra não gerar C591.

### C595 — Observações do lançamento fiscal (06, 28, 29, 66) — Nível 3, 1:N
Usado quando a legislação estadual exige ajustes do documento (DIFAL, antecipação, benefícios etc.) — equivale à coluna "Observações" dos livros (Conv. SN/70 art. 63). Mesmo padrão do C195 (NF-e).
| Nº | Campo | Tipo | Tam | Dec | Entr | Saída |
|---|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O | O |
| 02 | COD_OBS (0460) | C | 6 | - | O | O |
| 03 | TXT_COMPL | C | - | - | OC | OC |
Regras: COD_OBS ∈ 0460 (e usar aqui, salvo se a UF mandar usar C590.COD_OBS). TXT_COMPL complementa observação genérica.

### C597 — Outras obrigações tributárias, ajustes e informações do documento — Nível 4, 1:N (filho do C595)
Mesmo padrão do C197. Só para UF que publicou **Tabela 5.3** (ES publica — Tabela 5.3 ES). Valores de VL_ICMS entram direto na apuração conforme **3º caractere** do COD_AJ (Tabela 5.3):
- ICMS próprio → E110.VL_AJ_DEBITOS / VL_AJ_CREDITOS; ST → E210.VL_AJ_CREDITOS_ST / VL_AJ_DEBITOS_ST.
- Sub-apuração (1900/1920): 4º caractere ∈ {3..8}; 3º caractere "2" (estorno de débito) → crédito no E110 + débito em 1920.VL_TOT_TRANSF_DEBITOS_OA; "5" (estorno de crédito) → débito no E110 + crédito em 1920.VL_TOT_TRANSF_CRÉDITOS_OA; 1900.IND_APUR_ICMS = 4º caractere.
- Ajustes informativos → só VL_OUTROS, não entram na apuração.
| Nº | Campo | Tipo | Tam | Dec | Entr | Saída |
|---|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O | O |
| 02 | COD_AJ (Tabela 5.3 da UF) | C | 10* | - | O | O |
| 03 | DESCR_COMPL_AJ | C | - | - | OC | OC |
| 04 | COD_ITEM (0200) | C | 60 | - | OC | OC |
| 05 | VL_BC_ICMS (ICMS ou ST) | N | - | 2 | OC | OC |
| 06 | ALIQ_ICMS | N | 6 | 2 | OC | OC |
| 07 | VL_ICMS (ICMS ou ST) | N | - | 2 | OC | OC |
| 08 | VL_OUTROS | N | - | 2 | OC | OC |
Validações: COD_AJ ∈ Tabela 5.3 da UF do 0000 (2 primeiros caracteres = UF, ex. "ES"); DESCR_COMPL_AJ obrigatória para códigos genéricos; COD_ITEM ∈ 0200 quando ajuste por produto.
Uso no ES p/ energia: raro. Ex.: estorno de crédito/crédito presumido previstos no RICMS/ES — só se o contador indicar.

---

## GRUPO C600 — Consolidação diária de energia (06), água (29), gás (28) — empresas NÃO obrigadas ao Conv. 115/03
**Só saída, só fornecedores** (distribuidoras pequenas, SAAEs, gás). **Não se aplica a farmácia/varejo** — implementar só para completude do validador.
Apresentar C600 ⇒ não apresentar C700 nem C500 (para esses documentos).
Hierarquia: `C600 (N2, vários) → C601 (N3, 1:N) cancelados; C610 (N3, 1:N) itens; C690 (N3, 1:N) analítico`.

### C600 — Consolidação diária — Nível 2
Unicidade: COD_MOD + COD_MUN + COD_CONS (⚠ o guia não inclui DT_DOC na chave; na prática por dia).
| Nº | Campo | Tipo | Tam | Dec | Saída |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | COD_MOD [06, 28, 29] | C | 2* | - | O |
| 03 | COD_MUN (IBGE, pontos de consumo) | N | 7* | - | O |
| 04 | SER | C | 4 | - | OC |
| 05 | SUB | N | 3 | - | OC |
| 06 | COD_CONS (01–08; água → Tabela 4.4.2) | C | 2* | - | O |
| 07 | QTD_CONS (qtde docs) | N | - | - | O |
| 08 | QTD_CANC | N | - | - | OC |
| 09 | DT_DOC | N | 8* | - | O |
| 10 | VL_DOC | N | - | 2 | O |
| 11 | VL_DESC | N | - | 2 | OC |
| 12 | CONS (kWh, só 06) | N | - | - | OC |
| 13 | VL_FORN | N | - | 2 | OC |
| 14 | VL_SERV_NT | N | - | 2 | OC |
| 15 | VL_TERC | N | - | 2 | OC |
| 16 | VL_DA | N | - | 2 | OC |
| 17 | VL_BC_ICMS | N | - | 2 | OC |
| 18 | VL_ICMS | N | - | 2 | OC |
| 19 | VL_BC_ICMS_ST | N | - | 2 | OC |
| 20 | VL_ICMS_ST | N | - | 2 | OC |
| 21 | VL_PIS | N | - | 2 | OC |
| 22 | VL_COFINS | N | - | 2 | OC |
Validações: COD_MUN IBGE 7 dígitos; QTD_CONS > 0; QTD_CANC ≤ QTD_CONS e = nº de C601; DT_DOC ≤ DT_FIN; campos 17–20 = Σ correspondentes em C610.

### C601 — Documentos cancelados da consolidação — Nível 3, 1:N
Campos: 01 REG; 02 NUM_DOC_CANC (N, 9, O, > 0).

### C610 — Itens do documento consolidado — Nível 3, 1:N
Unicidade: COD_CLASS + COD_ITEM + ALIQ_ICMS.
| Nº | Campo | Tipo | Tam | Dec | Saída |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | COD_CLASS (Tab. 4.4.1; só mod 06, senão vazio) | N | 4* | - | OC |
| 03 | COD_ITEM | C | 60 | - | O |
| 04 | QTD | N | - | 3 | O |
| 05 | UNID | C | 6 | - | O |
| 06 | VL_ITEM | N | - | 2 | O |
| 07 | VL_DESC | N | - | 2 | OC |
| 08 | CST_ICMS | N | 3* | - | O |
| 09 | CFOP | N | 4* | - | O |
| 10 | ALIQ_ICMS | N | 6 | 2 | OC |
| 11 | VL_BC_ICMS | N | - | 2 | OC |
| 12 | VL_ICMS | N | - | 2 | OC |
| 13 | VL_BC_ICMS_ST | N | - | 2 | OC |
| 14 | VL_ICMS_ST | N | - | 2 | OC |
| 15 | VL_PIS | N | - | 2 | OC |
| 16 | VL_COFINS | N | - | 2 | OC |
| 17 | COD_CTA | C | - | - | OC |
Validações: COD_ITEM ∈ 0200; QTD > 0; UNID ∈ 0190; regras CST normal/ST (como C510); CFOP inicia 5/6/7.

### C690 — Analítico dos documentos consolidados — Nível 3, 1:N
Unicidade CST_ICMS + CFOP + ALIQ_ICMS; combinação deve existir no C610.
| Nº | Campo | Tipo | Tam | Dec | Saída |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | CST_ICMS | N | 3* | - | O |
| 03 | CFOP | N | 4* | - | O |
| 04 | ALIQ_ICMS | N | 6 | 2 | OC |
| 05 | VL_OPR | N | - | 2 | O |
| 06 | VL_BC_ICMS | N | - | 2 | O |
| 07 | VL_ICMS | N | - | 2 | O |
| 08 | VL_RED_BC | N | - | 2 | O |
| 09 | VL_BC_ICMS_ST | N | - | 2 | O |
| 10 | VL_ICMS_ST | N | - | 2 | O |
| 11 | COD_OBS (0460) | C | 6 | - | OC |
Validações: campos 06, 07, 09, 10 = Σ C610 da combinação; VL_RED_BC só CST 20/70. **Atenção à ordem dos campos**: aqui VL_RED_BC (08) vem ANTES de VL_BC_ICMS_ST (09) — diferente do C590/C790 (BC_ST, ICMS_ST, RED_BC).

---

## GRUPO C700 — Consolidação NF/Conta energia (06) via única Conv. 115/03, gás (28) e NF3e (66)
**Só saída, só distribuidoras** obrigadas ao Conv. 115/03 e emitentes de NF3e (para UF que permite escrituração consolidada; NF3e sem ajustes da Tabela 5.3). **Não se aplica à farmácia.**
C700 ⇒ não apresentar C600. Documento escriturado individualmente no C500 não entra no C700. Operações interestaduais também no 1500 (declaratório). NF3e só com itens sem CST não é escriturada.
Hierarquia: `C700 (N2, vários) → C790 (N3, 1:N) → C791 (N4, 1:N)`.

### C700 — Nível 2
Unicidade: SER + NRO_ORD_INI + NRO_ORD_FIN; exceto mod 66, sem sobreposição de intervalos na mesma série.
| Nº | Campo | Tipo | Tam | Dec | Saída |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | COD_MOD [06, 28, 66] | C | 2* | - | O |
| 03 | SER | C | 4 | - | OC |
| 04 | NRO_ORD_INI | N | 9 | - | O |
| 05 | NRO_ORD_FIN | N | 9 | - | O |
| 06 | DT_DOC_INI (emissão ou vencimento inicial) | N | 8* | - | O |
| 07 | DT_DOC_FIN | N | 8* | - | O |
| 08 | NOM_MEST (arquivo Mestre Conv. 115; 33 pos. desde 2017) | C | 33 | - | OC |
| 09 | CHV_COD_DIG (chave do arquivo Mestre) | C | 32 | - | OC |
Validações: NRO_ORD_INI > 0; FIN ≥ INI; DT_INI(0000) ≤ DT_DOC_INI ≤ DT_DOC_FIN ≤ DT_FIN(0000); mod 66 → DT_DOC_FIN = DT_DOC_INI (consolida por data de emissão e série) e NOM_MEST/CHV_COD_DIG vazios.

### C790 — Analítico (06, 28, 66) — Nível 3, 1:N
Unicidade CST+CFOP+ALIQ. NF3e: excluir itens sem CST e energia injetada; parcela isenta → CST 40 zerado.
Campos (mesma ordem do C590): 01 REG; 02 CST_ICMS (N,3*,O); 03 CFOP (N,4*,O — só CFOP de saída); 04 ALIQ_ICMS (N,6,2,OC); 05 VL_OPR; 06 VL_BC_ICMS; 07 VL_ICMS; 08 VL_BC_ICMS_ST; 09 VL_ICMS_ST; 10 VL_RED_BC (todos N,-,2,O); 11 COD_OBS (C,6,OC, ∈ 0460). VL_RED_BC só CST 20/70.

### C791 — Informações de ST por UF (06 e 66) — Nível 4, 1:N
Campos: 01 REG; 02 UF (C,2*,O — tabela de UF); 03 VL_BC_ICMS_ST (N,-,2,O); 04 VL_ICMS_ST (N,-,2,O).

---

## GRUPO C800 — CF-e-SAT (modelo 59)

**Situação por UF**: o SAT-CF-e (Ajuste SINIEF 11/2010) foi adotado por **SP** (SAT) e **CE** (MFE – Módulo Fiscal Eletrônico, também mod. 59). **O Espírito Santo NÃO usa SAT/MFE** — varejo no ES emite **NFC-e (mod. 65)**, escriturada no **C100 + C190** (parte 1 do Bloco C). Além disso, SP vem migrando o SAT para NFC-e (cronograma de descontinuação). ⇒ **Gerador: nunca produzir C800–C897 para UF=ES**; **Validador: se aparecer mod. 59 com 0000.UF = ES → erro/alerta de inconsistência**. Mantemos a especificação para validar arquivos de clientes de outras UFs, se um dia houver.

Duas formas alternativas (conforme UF): **individual** (C800 por cupom + C810/C815 + C850 + C855/C857) ou **consolidada por equipamento/dia** (C860 + C870/C880 + C890 + C895/C897).
Hierarquia:
```
C800 (N2, vários) CF-e-SAT
 ├ C810 (N3, 1:N) itens — só quando houver C815
 │   └ C815 (N4, 1:1) info compl. ST
 ├ C850 (N3, 1:N) analítico CST+CFOP+ALIQ   (≥1, exceto cancelados)
 │   (C855 N3 1:N observações → C857 N4 1:N ajustes)
C860 (N2, vários) equipamento SAT / dia
 ├ C870 (N3, 1:N) itens do resumo diário (obrigatoriedade pela UF)
 │   └ C880 (N4, 1:1) info compl. ST
 ├ C890 (N3, 1:N) resumo diário analítico
 │   (C895 N3 1:N observações → C897 N4 1:N ajustes)
```
Tudo só Saída (Entrada = Não apresentar), exceto C855/C857/C895/C897 que têm coluna Entr "O/OC" no guia (irrelevante — pai só existe em saída).

### C800 — CF-e-SAT (cód. 59) — Nível 2, vários
Unicidade: COD_SIT + NUM_CFE + NR_SAT + DT_DOC. Cancelado (02/03): só REG, COD_MOD, COD_SIT, NUM_CFE, NR_SAT, CHV_CFE; sem C850. Filiais com IE única/centralizada → emissão própria, COD_SIT 00.
| Nº | Campo | Tipo | Tam | Dec | Saída | XML CF-e (`CFe/infCFe`) |
|---|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O | — |
| 02 | COD_MOD = 59 | C | 2 | - | O | `ide/mod` |
| 03 | COD_SIT [00,01,02,03] | N | 2 | - | O | — |
| 04 | NUM_CFE | N | 6 | - | O | `ide/nCFe` |
| 05 | DT_DOC | N | 8 | - | O | `ide/dEmi` (AAAAMMDD → ddmmaaaa) |
| 06 | VL_CFE | N | - | 2 | O | `total/vCFe` |
| 07 | VL_PIS | N | - | 2 | OC | `total/ICMSTot/vPIS` |
| 08 | VL_COFINS | N | - | 2 | OC | `total/ICMSTot/vCOFINS` |
| 09 | CNPJ_CPF | N | 14 | - | OC | **não informar** (validação) |
| 10 | NR_SAT | N | 9 | - | O | `ide/nserieSAT` |
| 11 | CHV_CFE | N | 44 | - | O | `@Id` sem "CFe" |
| 12 | VL_DESC | N | - | 2 | O | `total/ICMSTot/vDesc` |
| 13 | VL_MERC | N | - | 2 | O | `total/ICMSTot/vProd` |
| 14 | VL_OUT_DA | N | - | 2 | O | `total/ICMSTot/vOutro` |
| 15 | VL_ICMS | N | - | 2 | O | `total/ICMSTot/vICMS` |
| 16 | VL_PIS_ST | N | - | 2 | O* | `vPISST` |
| 17 | VL_COFINS_ST | N | - | 2 | O* | `vCOFINSST` |
(*) 07, 08, 16, 17: vazios se entrega EFD-Contribuições.
Validações: DT_DOC ≤ DT_FIN; VL_CFE = Σ C850.VL_OPR; VL_ICMS = Σ C850.VL_ICMS; CHV_CFE: DV mód. 11, CNPJ da chave = CNPJ do 0000, nº na chave = NUM_CFE, AAMM da chave = mês/ano de DT_DOC, cUF da chave = UF do 0000.
Chave CF-e (44): cUF(2) + AAMM(4) + CNPJ(14) + mod(2) + nº série SAT(9) + nº CF-e(6) + código numérico(6) + DV(1). (Diferente da chave NF-e: não tem série/tpEmis.)

### C810 — Itens do CF-e-SAT — Nível 3, 1:N — **só quando houver C815**
| Nº | Campo | Tipo | Tam | Dec | Saída |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | NUM_ITEM | N | 3 | - | O |
| 03 | COD_ITEM (0200) | C | 60 | - | O |
| 04 | QTD | N | - | **5** | O |
| 05 | UNID (0190) | C | 6 | - | O |
| 06 | VL_ITEM | N | - | 2 | O |
| 07 | CST_ICMS (do documento) | N | 3* | - | O |
| 08 | CFOP (inicia "5") | N | 4* | - | O |

### C815 — Info compl. ST (CF-e-SAT) — Nível 4, 1:1
Campos 01–14 idênticos ao C380 (6 decimais), **sem** CST_ICMS/CFOP. Mesmas regras por 3º caractere do COD_MOT_REST_COMPL e fórmulas. UNID do pai = C810.

### C850 — Registro analítico do CF-e-SAT — Nível 3, 1:N
Unicidade por CF-e: CST_ICMS + CFOP + ALIQ_ICMS.
| Nº | Campo | Tipo | Tam | Dec | Saída |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | CST_ICMS | N | 3 | - | O |
| 03 | CFOP | N | 4 | - | O |
| 04 | ALIQ_ICMS | N | 6 | 2 | OC |
| 05 | VL_OPR (Σ valor líquido dos itens) | N | - | 2 | O |
| 06 | VL_BC_ICMS | N | - | 2 | O |
| 07 | VL_ICMS | N | - | 2 | O |
| 08 | COD_OBS (0460; só se a UF exigir) | C | 6 | - | OC |
Regra CST **própria do CF-e** (diferente do C190/C490!): final 40, 41, 50, 60 → BC/ALIQ/ICMS = 0; final 00 → > 0; final 20 ou 90 → ≥ 0. (Não lista 30/51/10/70.)
CFOP sempre "5xxx" (ex. 5102, 5405). Σ VL_OPR = C800.VL_CFE; VL_BC_ICMS = VL_OPR quando > 0 (alíquota efetiva) e Σ VL_BC = VL_CFE; Σ VL_ICMS = C800.VL_ICMS.

### C855 — Observações do lançamento (cód. 59) — Nível 3, 1:N
Campos: 01 REG; 02 COD_OBS (C,6,O, ∈ 0460; usar aqui salvo UF que mande usar C850.COD_OBS); 03 TXT_COMPL (C,-,OC).

### C857 — Outras obrigações/ajustes (cód. 59) — Nível 4, 1:N
Idêntico ao C597 (8 campos: REG, COD_AJ C10*, DESCR_COMPL_AJ, COD_ITEM, VL_BC_ICMS, ALIQ_ICMS, VL_ICMS, VL_OUTROS) e mesmas regras de reflexo em E110/E210/1900/1920. Só UFs com Tabela 5.3.

### C860 — Identificação do equipamento SAT-CF-e — Nível 2, vários
Unicidade: COD_MOD + NR_SAT + DOC_INI + DOC_FIM.
| Nº | Campo | Tipo | Tam | Dec | Saída |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | COD_MOD = 59 | C | 2 | - | O |
| 03 | NR_SAT | N | 9 | - | O |
| 04 | DT_DOC | N | 8 | - | O |
| 05 | DOC_INI (1º CF-e do período, mesmo cancelado) | N | 6 | - | O |
| 06 | DOC_FIM (último, mesmo cancelado) | N | 6 | - | O |
Validações: DT_DOC dentro do período do 0000; **se DT_DOC < DT_INI, o ICMS do C890 vai para "Débitos Especiais" do E110** (DEB_ESP). DOC_INI ≤ DOC_FIM.

### C870 — Itens do resumo diário (CF-e-SAT) — Nível 3, 1:N (obrigatoriedade pela UF)
| Nº | Campo | Tipo | Tam | Dec | Saída |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | COD_ITEM (0200, constante do documento) | C | 60 | - | O |
| 03 | QTD | N | - | 5 | O |
| 04 | UNID (0190; se ≠ 0200 → 0220) | C | 6 | - | O |
| 05 | CST_ICMS | N | 3* | - | O |
| 06 | CFOP (inicia "5") | N | 4* | - | O |
QTD > 0.

### C880 — Info compl. ST (resumo diário SAT) — Nível 4, 1:1
Campos 01–14 como C815, **mas com 3 decimais** em 05–14 (QUANT_CONV mantém 6). Mesmas regras. UNID do pai = C870.

### C890 — Resumo diário do CF-e-SAT por equipamento — Nível 3, 1:N (filho do C860)
Unicidade: DT_DOC + NR_SAT (do C860) + CST_ICMS + CFOP + ALIQ_ICMS.
| Nº | Campo | Tipo | Tam | Dec | Saída |
|---|---|---|---|---|---|
| 01 | REG | C | 4 | - | O |
| 02 | CST_ICMS (Conv. SN/70 art. 5º) | N | 3 | - | O |
| 03 | CFOP (inicia "5") | N | 4 | - | O |
| 04 | ALIQ_ICMS | N | 6 | 2 | OC |
| 05 | VL_OPR | N | - | 2 | O |
| 06 | VL_BC_ICMS | N | - | 2 | O |
| 07 | VL_ICMS | N | - | 2 | O |
| 08 | COD_OBS (0460; só se UF exigir) | C | 6 | - | OC |
VL_OPR/VL_BC_ICMS/VL_ICMS = Σ dos CF-e do equipamento/dia na combinação (o guia diz "registros informados no reg. C860", i.e., CF-e do intervalo DOC_INI–DOC_FIM).

### C895 — Observações (cód. 59, consolidado) — Nível 3, 1:N
Campos: 01 REG; 02 COD_OBS (C,6,O, ∈ 0460; salvo UF que use C890.COD_OBS); 03 TXT_COMPL (C,-,OC).

### C897 — Outras obrigações/ajustes (cód. 59, consolidado) — Nível 4, 1:N
Idêntico ao C597/C857. Só UFs com Tabela 5.3.

---

## C990 — Encerramento do Bloco C — Nível 1, um por arquivo (obrigatório)
| Nº | Campo | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|
| 01 | REG = "C990" | C | 4 | - | O |
| 02 | QTD_LIN_C | N | - | - | O |
QTD_LIN_C = total de linhas do bloco C **incluindo C001 e C990**. Gerador: calcular após serializar o bloco; Validador: contar linhas cujo REG começa com "C".

---

## Resumo de regras reutilizáveis (para o motor de validação)

1. **PIS/COFINS**: em todos os registros deste trecho, se o contribuinte entrega EFD-Contribuições do mesmo período → campos VL_PIS/VL_COFINS (e *_ST) vazios `||`. Flag global `entrega_efd_contrib`.
2. **Regra CST × valores (analíticos)**:
   - Padrão (C390, C490, C510, C590, C610, C690, C790): final 30/40/41/50/60 → BC/ALIQ/ICMS = 0; 51/90 → ≥ 0; demais → > 0. ST (C510/C590/C610): final 10/30/70 → BC_ST/ALIQ_ST/ICMS_ST ≥ 0; senão = 0.
   - CF-e (C850): 40/41/50/60 → 0; 00 → > 0; 20/90 → ≥ 0.
   - VL_RED_BC só com CST final 20 ou 70 (C590, C690, C790).
3. **CFOP**: nunca código-título (final 00/50); entrada 1/2/3, saída 5/6/7; consumidor final/ECF/SAT/NF mod. 02 → "5".
4. **Unicidade analítica**: CST_ICMS + CFOP + ALIQ_ICMS por documento/consolidação.
5. **Chaves de acesso**: validar DV mód. 11; conferir CNPJ/UF/modelo/número/série (e AAMM no CF-e) contra 0000 e campos do registro.
6. **UNID ≠ unidade do 0200 ⇒ exigir 0220** (C425, C870, C380/C430/C480/C815/C880).
7. **Tabela 5.3 (C597/C857/C897)**: COD_AJ começa com a UF do 0000; 3º caractere define reflexo em E110/E210; 4º caractere 3–8 ⇒ sub-apuração 1900/1920.
8. **Tabela 5.7 (C380/C430/C480/C815/C880)**: 3º caractere 0–3 define quais campos preencher/vazios.
9. **Cancelados**: C350 não informa; C460 só REG/COD_MOD/COD_SIT/NUM_DOC; C500 só campos-chave (+CHV_DOCe se 66) sem filhos; C800 só REG/COD_MOD/COD_SIT/NUM_CFE/NR_SAT/CHV_CFE sem C850.

## Decisões recomendadas para o produto (farmácia/varejo ES)
- **Gerar**: C500 + C590 (+ C595/C597 se houver ajuste) a partir de XML **NF3e** (EDP-ES) e digitação/OCR de contas mod. 06/28/29; C990.
- **Parametrizar** por empresa: crédito de energia (normalmente não p/ comércio), CFOP de entrada (1253 energia comercial; 1556/1653 água/gás), CST sob enfoque do declarante (090/040/041).
- **Não gerar** (UF=ES): C350–C390 (mod. 02), C400–C495 (ECF), C600–C791 (fornecedores de energia/água/gás), C800–C897 (SAT). Validador reconhece a estrutura e emite alertas de "registro atípico para ES/varejo".
- **NFC-e (65)**: escriturar em C100 (+C190; sem C170; sem participante) — ver notas da parte 1. Nenhum registro deste trecho (C350–C897) serve para NFC-e na EFD-ICMS/IPI.
- CT-e (57) de frete de entrada → Bloco D (D100/D190), não Bloco C.
