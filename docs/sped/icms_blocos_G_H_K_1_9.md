# EFD-ICMS/IPI: Blocos G, H, K, 1 e 9 (notas de desenvolvimento)

Fonte: Guia Prático EFD-ICMS/IPI v3.2.2 (atualização de 11/02/2026), linhas 15497 a 22164 do `guia_icms_ipi.txt`
(pp. 252–362: Blocos G, H, K, 1, 9, Seção 5 "Obrigatoriedade dos registros" (tabelas 2.6.1.5 a 2.6.1.9), Capítulo IV (tabelas) e histórico de alterações).
Público-alvo: gerador e validador de EFD para **comércio (varejo/atacado) no Espírito Santo (UF=ES)**.

Legenda: **O** = obrigatório, **OC** = obrigatório condicional, **[GUIA]** = regra literal do Guia/PVA,
**[ES?]** = depende da legislação da SEFAZ-ES e precisa ser confirmado, **[IMPL]** = recomendação de implementação (não é regra do PVA).

Formatos gerais que se aplicam aqui: datas `ddmmaaaa`; decimais com vírgula; `|REG|campo|...|`; tamanho `004*` = tamanho fixo.

---

## 0. Regras comuns a todos os blocos

- Todo bloco tem abertura `X001` (IND_MOV) e encerramento `X990` (QTD_LIN_X).
  - `IND_MOV=1`: o bloco contém **somente** X001 e X990 (então QTD_LIN_X = 2).
  - `IND_MOV=0`: precisa existir pelo menos um registro de dados (regras específicas abaixo).
- `QTD_LIN_X` conta **todas** as linhas do bloco, **inclusive** X001 e X990. [GUIA]
- Hierarquia (nível) define pai/filho: um registro de nível n+1 pertence ao último registro de nível n que o precede.
- Referências cruzadas com o Bloco 0: COD_ITEM → 0200; COD_PART → 0150; UNID → 0190 (+ 0220 se unidade ≠ UNID_INV do 0200); COD_IND_BEM → 0300; COD_CTA → 0500.
- Registro dispensado que for preenchido **é validado normalmente** pelo PVA (PVA único nacional). [GUIA, Seção 5]

---

## 1. BLOCO G: CIAP (crédito de ICMS do ativo imobilizado)

Objetivo: demonstrar a parcela mensal (1/48, conforme LC 87/96 art. 20 §5º) do crédito de ICMS de bens do ativo imobilizado.
Para varejista: aparece quando a empresa comprou bens do imobilizado com crédito (balcões refrigerados, câmaras frias, PDVs etc.) e apropria o crédito via CIAP.

### Estrutura

```
G001 (1)  IND_MOV
  G110 (2)  por período de apuração [OC]
    G125 (3)  por bem/componente x tipo de movimentação [O se existir G110]
      G126 (4)  outros créditos (parcelas não escrituradas em períodos anteriores) [OC]
      G130 (4)  documento fiscal do bem [O se existir G125, ver condições]
        G140 (5)  item do documento fiscal [O se existir G130]
G990 (1)
```

### G001
- `IND_MOV` [0,1]. 1 → só G001+G990 (não há crédito CIAP a apropriar). 0 → pelo menos um G110 com filhos.

### G110: ICMS do ativo permanente (1 por período)
| # | Campo | Tipo/Dec | Regra |
|---|---|---|---|
| 02 | DT_INI | N 8 | dentro do período do 0000 |
| 03 | DT_FIN | N 8 | dentro do período do 0000 |
| 04 | SALDO_IN_ICMS | N,2 | Σ(VL_IMOB_ICMS_OP + _ST + _FRT + _DIF) dos G125 com TIPO_MOV=`SI` (bens escriturados em períodos anteriores e que **já** tiveram parcela apropriada). **Não** inclui `IA` de período anterior (componentes de bem em construção). |
| 05 | SOM_PARC | N,2 | = Σ G125.VL_PARC_PASS (campo 10) |
| 06 | VL_TRIB_EXP | N,2 | saídas tributadas + exportação no período; **≤ VL_TOTAL** |
| 07 | VL_TOTAL | N,2 | total das saídas do período (conforme legislação da UF) |
| 08 | IND_PER_SAI | N,**8** | = VL_TRIB_EXP / VL_TOTAL (sempre ≤ 1) |
| 09 | ICMS_APROP | N,2 | = SOM_PARC × IND_PER_SAI |
| 10 | SOM_ICMS_OC | N,2 | = Σ G126.VL_PARC_APROP |

Chave: DT_INI+DT_FIN únicos, e **a combinação deve ser igual a um E100**. [GUIA]

Os valores ICMS_APROP e SOM_ICMS_OC são lançados na apuração (E110) como **ajuste de crédito** (E111, "outros créditos"), salvo se a legislação exigir emissão de documento fiscal. [GUIA] Código de ajuste: tabela 5.1.1 da SEFAZ-ES. [ES?]

#### Fórmulas CIAP (núcleo do cálculo)
```
ICMS_total_bem   = VL_IMOB_ICMS_OP + VL_IMOB_ICMS_ST + VL_IMOB_ICMS_FRT + VL_IMOB_ICMS_DIF
VL_PARC_PASS     = ICMS_total_bem / 0300.NR_PARC          (normalmente NR_PARC = 48)
                   validação: VL_PARC_PASS <= ICMS_total_bem / NR_PARC
SOM_PARC         = Σ VL_PARC_PASS (todos os G125 do G110)
IND_PER_SAI      = VL_TRIB_EXP / VL_TOTAL                 (8 casas)
ICMS_APROP       = SOM_PARC × IND_PER_SAI                 (arredondar 2 casas)
SOM_ICMS_OC      = Σ G126.VL_PARC_APROP
Crédito do mês   = ICMS_APROP + SOM_ICMS_OC  → E111 (ajuste a crédito)
```
[IMPL] Guardar por bem: número da parcela corrente, parcelas restantes e o saldo. Na última parcela, gerar SI (com a parcela) + BA.
[IMPL] Sobre o que compõe VL_TRIB_EXP e VL_TOTAL (ex.: ST, isentas, devoluções): o Guia remete à "legislação da UF". [ES?]

### G125: movimentação de bem ou componente
| # | Campo | Tipo | Obrig | Regra |
|---|---|---|---|---|
| 02 | COD_IND_BEM | C 60 | O | deve existir no **0300** |
| 03 | DT_MOV | N 8 | O | `SI` → = G110.DT_INI; demais tipos → ≤ G110.DT_FIN |
| 04 | TIPO_MOV | C 2 | O | SI, IM, IA, CI, MC, BA, AT, PE, OT |
| 05 | VL_IMOB_ICMS_OP | N,2 | OC | ICMS próprio do documento (inclui complementar) |
| 06 | VL_IMOB_ICMS_ST | N,2 | OC | ICMS ST |
| 07 | VL_IMOB_ICMS_FRT | N,2 | OC | ICMS do CT-e do frete |
| 08 | VL_IMOB_ICMS_DIF | N,2 | OC | DIFAL recolhido (documento de arrecadação) |
| 09 | NUM_PARC | N 3 | OC | obrigatório se VL_PARC_PASS > 0 |
| 10 | VL_PARC_PASS | N,2 | OC | parcela antes do índice; obrigatório se NUM_PARC > 0 |

Chave: **COD_IND_BEM + TIPO_MOV** único dentro do G110.

TIPO_MOV:
- `SI` saldo inicial (bem escriturado em período anterior e com parcela a apropriar); `IM` imobilização de bem individual; `IA` imobilização em andamento (componente); `CI` conclusão de imobilização em andamento (bem resultante); `MC` imobilização vinda do ativo circulante (estoque); `BA` baixa por fim do período de apropriação; `AT` alienação ou transferência; `PE` perecimento, extravio ou deterioração; `OT` outras saídas.

Regras de preenchimento [GUIA]:
- Tipos de **entrada** (SI, IM, IA, CI, MC): pelo menos um entre os campos 05 a 08 deve ser > 0. Para `CI`: soma do ICMS dos componentes `IA`.
- Tipos de **saída** (BA, AT, PE, OT): campos 05, 06, 07, 08, 09 e 10 **não podem** ser informados.
- SI, IM, IA, MC: informar NUM_PARC e VL_PARC_PASS (regra geral, crédito a partir da entrada).
- **Último mês do bem**: dois registros, `SI` com a última parcela (09/10 preenchidos) e `BA` sem valores.
- **Saída do bem (venda/transferência/perda)**: dois registros, `SI` e `AT`/`PE`/`OT`. A parcela do mês da saída só vai no SI se a UF permitir (LC 87 art. 20 §5º V). [ES?]
- Componente (`IA`) com crédito desde a entrada: IA no mês da aquisição com parcela; depois vira `SI` pelo próprio código até a baixa; **não** gerar `CI`.
- UF que só dá crédito sobre o bem resultante: `IA` **sem** NUM_PARC/VL_PARC_PASS; `CI` no mês da conclusão; no 1º período do CIAP digital, componentes anteriores entram como `IA` (só nesse período).
- Campos 05 a 08: cada um ≤ Σ do campo correspondente em G140 (VL_ICMS_*_APLICADO) dos filhos, se houver G140.

### G126: outros créditos CIAP (nível 4, filho do G125)
Parcelas que não foram escrituradas em períodos anteriores, quando a legislação permitir.
| # | Campo | Regra |
|---|---|---|
| 02 | DT_INI | início do período **a que a parcela se refere** |
| 03 | DT_FIM | fim desse período |
| 04 | NUM_PARC | nº da parcela |
| 05 | VL_PARC_PASS | valor passível de apropriação |
| 06 | VL_TRIB_OC | saídas tributadas + exportação **daquele período** |
| 07 | VL_TOTAL | saídas totais daquele período |
| 08 | IND_PER_SAI (8 casas) | = 06 / 07 |
| 09 | VL_PARC_APROP | **≤ VL_PARC_PASS × IND_PER_SAI** |

### G130: documento fiscal do bem (nível 4)
- Obrigatório quando TIPO_MOV ∈ {MC, IM, IA, AT}; também quando houver previsão legal de documento para os outros tipos.
- No período em que começa a escrituração do CIAP (obrigatória ou espontânea): obrigatório para SI originado de IM/IA/MC; para SI originado de CI e para CI, informar os documentos dos `IA` componentes.
- Campos: IND_EMIT [0 própria, 1 terceiros]; COD_PART (existir no 0150); COD_MOD ∈ {01, 1B, 04, 07, 08, 8B, 09, 10, 26, 27, 55, 57}; SERIE; NUM_DOC; CHV_NFE_CTE (chave validada se 55/57); DT_DOC; NUM_DA (opcional).
- Chave por bem: IND_EMIT+COD_PART+COD_MOD+SERIE+NUM_DOC+CHV_NFE_CTE (cada documento **uma única vez** por bem).

### G140: item do documento (nível 5)
- NUM_ITEM (N 3), COD_ITEM (existir no 0200), QTD (5 casas), UNID (existir no 0190; se ≠ UNID_INV do 0200 → 0220 com fator), VL_ICMS_OP_APLICADO, VL_ICMS_ST_APLICADO, VL_ICMS_FRT_APLICADO, VL_ICMS_DIF_APLICADO (proporcionais à quantidade aplicada no bem).
- Chave: NUM_ITEM + COD_ITEM.

### G990
- QTD_LIN_G = total de linhas do bloco G (inclui G001/G990).

### Dependências do Bloco 0
- 0300 (bem: COD_IND_BEM, IDENT_MERC, NR_PARC ...), 0305 (utilização do bem), **0500 obrigatório se existir 0300**, 0600 obrigatório se existir 0305. [GUIA, tabela 2.6.1.1]

---

## 2. BLOCO H: inventário físico

### Quando apresentar [GUIA]
- **Fevereiro de cada ano**: `H001.IND_MOV = 0` obrigatório. O inventário de 31/12 vai na EFD de **fevereiro** (até o 2º mês subsequente ao evento).
  - Se o contribuinte informou o inventário de 31/12 na EFD de dezembro ou janeiro, **deve repetir** na de fevereiro.
  - PVA emite **advertência** se a EFD de fevereiro não tiver H005 com DT_INV = 31/12 do ano anterior e MOT_INV = `01`.
- Regra de prazo: H005 com MOT_INV=01 **não pode** ser apresentado depois do 2º mês subsequente a DT_INV.
- **CNAE 4681-8/01 e 4681-8/02** (comércio atacadista de combustíveis): inventário **mensal** (desde 07/2012), MOT_INV=01, informado no próprio mês de referência.
- **MOT_INV=06 (ST: restituição/ressarcimento/complementação)**: se o arquivo tiver qualquer C180, C181, C185, C186, C330, C380, C430, C480, C815 ou C870, deve existir H005 com MOT_INV=06 e **DT_INV = dia anterior a 0000.DT_INI** (ou seja, estoque inicial do mês). Todo item desses registros deve ter H010 sob esse H005 (desde 01/2020; C181/C186 desde 01/2021), exceto se VL_INV=0. Relevante se o ES adotar a sistemática dos C18x. [ES?]
- Outros meses: bloco H vazio (`IND_MOV=1`) é normal, salvo motivos 02–05.
- Uso para IR (RIR/2018 art. 276): incluir também bens exigidos só pelo IR (almoxarifado) e informar VL_ITEM_IR.

### Estrutura
```
H001 (1)
  H005 (2)  totais por data/motivo [OC, 1:N]
    H010 (3) item do inventário [1:N]
      H020 (4) info complementar ICMS (MOT_INV 02..05) [1:1]
      H030 (4) info ST (MOT_INV 06) [1:1]
H990 (1)
```

### H001
- IND_MOV [0,1]; 0 → pelo menos um registro além do H990.

### H005: totais do inventário
| # | Campo | Regra |
|---|---|---|
| 02 | DT_INV | ≤ 0000.DT_FIN |
| 03 | VL_INV (N,2) | = Σ H010.VL_ITEM; se não houver H010 → `0` (zero = inventário sem estoque) |
| 04 | MOT_INV | 01 final do período; 02 mudança da forma de tributação da mercadoria (ex.: passou para ST; pode ser parcial); 03 baixa cadastral/paralisação; 04 mudança de regime de pagamento (ex.: Normal → Simples); 05 determinação do fisco; 06 controle de mercadorias em ST (restituição/ressarcimento/complementação) |

### H010: itens
| # | Campo | Tipo/Dec | Regra |
|---|---|---|---|
| 02 | COD_ITEM | C 60 | existir no 0200 |
| 03 | UNID | C 6 | deve ser a **UNID_INV do 0200** |
| 04 | QTD | N,3 | |
| 05 | VL_UNIT | N,**6** | |
| 06 | VL_ITEM | N,2 | [IMPL] conferir ≈ QTD × VL_UNIT |
| 07 | IND_PROP | C 1 | 0 próprio em seu poder; 1 próprio em posse de terceiros; 2 de terceiros em posse do informante |
| 08 | COD_PART | C 60 | obrigatório se IND_PROP ∈ {1,2}; existir no 0150 |
| 09 | TXT_COMPL | C | opcional |
| 10 | COD_CTA | C | obrigatório **apenas perfis A e B**; conta analítica (ou sintética) do 0500 |
| 11 | VL_ITEM_IR | N,2 | valor para IR (sem ICMS, PIS e COFINS recuperáveis); desde 01/2015 |
- Não informar H010 se H005.VL_INV = 0.
- [IMPL] Chave prática: COD_ITEM + IND_PROP + COD_PART dentro do H005 (evitar duplicidade).

### H020: informação complementar (MOT_INV 02 a 05)
- Apresentar quando MOT_INV ∈ {02,03,04,05}; não apresentar se VL_INV = 0. Com MOT_INV=02, só para os itens cuja tributação mudou.
- Campos: CST_ICMS (N 3, tabela 4.3.1; CST **após a alteração** se MOT_INV 2 ou 4), BC_ICMS (**unitária**), VL_ICMS (**unitário**, alíquota interna; após alteração se MOT 2/4).
- Uso típico no varejo: inclusão/exclusão de produto na ST (MOT 02) → crédito ou débito do estoque.

### H030: inventário das mercadorias em ST (MOT_INV = 06)
- **Obrigatório** quando MOT_INV=06; **proibido** nos demais motivos.
- Campos (todos N, 6 casas, **valores médios unitários**):
  - `VL_ICMS_OP`: ICMS próprio que daria direito a crédito se a mercadoria estivesse no regime normal;
  - `VL_BC_ICMS_ST`: BC do ST pago ou retido (com redução, se houver);
  - `VL_ICMS_ST`: ICMS ST pago ou retido, limitado ao fato gerador presumido ainda não realizado; **inclui o FCP-ST** quando houver;
  - `VL_FCP`: parcela do FCP contida em VL_ICMS_ST.

### H990
- QTD_LIN_H inclui H001 e H990.

### Relação com o 0200
- Todo COD_ITEM do H010 deve estar no 0200 (com UNID_INV preenchida e compatível). Unidade do H010 = 0200.UNID_INV.
- [IMPL] Itens inventariados sem movimento no mês precisam do 0200 no arquivo de fevereiro (o Bloco 0 só pode ter itens referenciados, então o H010 é o que "puxa" o item para o 0200).

---

## 3. BLOCO K: controle da produção e do estoque (resumo)

### Quem é obrigado
- [GUIA] Estabelecimentos **industriais** ou equiparados pela legislação federal e **atacadistas**, e, a critério do fisco, outros setores (Conv. s/nº 1970 art. 63 §4º). Em vigor na EFD desde 2016.
- [GUIA] **Simples Nacional: dispensado** (Resolução CGSN 94/2011).
- Escalonamento (Ajuste SINIEF 02/2009 e 25/2016; não está detalhado no Guia, confirmar a versão vigente):
  - indústria: CNAE **divisões 10 a 32**; atacadistas: CNAE **grupos 462 a 469**; equiparados a industrial;
  - para **atacadistas e equiparados**, a exigência é restrita aos **saldos de estoque** (K200 e K280), o que corresponde ao `K010.IND_TP_LEIAUTE = 2`.
- **Varejo (CNAE 47xx)**: em regra **não obrigado** → gerar `K001|1|` + `K990|2|`. [IMPL] Configurar por estabelecimento: CNAE principal + regime + override manual.
- [GUIA] Estabelecimentos equiparados a industrial e atacadistas informam o K200 e, se houver movimentação interna, o K220.

### Registros principais
- `K001` IND_MOV; se 0 → exige K100 e filhos.
- `K010` IND_TP_LEIAUTE (desde 2023; obrigatório se K001.IND_MOV=0): **0** simplificado, **1** completo, **2** restrito aos saldos de estoque.
- `K100` DT_INI/DT_FIN: períodos de apuração que cobrem **todo** o período do 0000, sem duplicidade.
- `K200` estoque escriturado no fim do período (nível 3): DT_EST (= K100.DT_FIN), COD_ITEM (TIPO_ITEM do 0200 ∈ {00,01,02,03,04,05,06,10}), QTD (3 casas, na UNID_INV), IND_EST [0,1,2], COD_PART (obrig. se IND_EST 1/2). Chave: DT_EST+COD_ITEM+IND_EST+COD_PART. Estoque zero pode ser omitido (ausência = zero). Estoque final = inicial + entradas/produção/mov. interna − saídas/consumo/mov. interna.
- `K210`/`K215` desmontagem (origem/destino); não se aplicam ao leiaute simplificado.
- `K220` outras movimentações internas (reclassificação de código): DT_MOV, COD_ITEM_ORI ≠ COD_ITEM_DEST, QTD_ORI > 0, QTD_DEST > 0.
- `K230`/`K235` produção própria e insumos consumidos (K235 dispensado no simplificado).
- `K250`/`K255` industrialização por terceiros.
- `K260`/`K265` reprocessamento/reparo.
- `K270`/`K275` correção de apontamentos de períodos anteriores.
- `K280` correção do estoque escriturado de período anterior: DT_EST < 0000.DT_INI; só **um** entre QTD_COR_POS e QTD_COR_NEG; deve ocorrer entre dois inventários (H005).
- `K290`–`K302` produção conjunta.
- `K990` QTD_LIN_K.
- Obrigatoriedade por leiaute (tabela do K010): simplificado exige K100, K200, K220, K230, K250, K270, K280, K290, K291, K300, K301; dispensa K210, K215, K235, K255, K260, K265, K275, K292, K302.

---

## 4. BLOCO 1: outras informações

### Estrutura e obrigatoriedade (tabela 2.6.1.8)
```
1001 (1) O
  1010 (2) O   indicadores S/N (sempre presente)
  1100 (2) OC  exportação         → 1105 (3) → 1110 (4)
  1200 (2) OC  créditos extra-apuração → 1210 (3)
  1250 (2) OC 1:1 restit./ressarc./complementação ICMS → 1255 (3)
  1300 (2) OC  combustíveis (LMC) → 1310 (3, O se 1300) → 1320 (4)
  1350 (2) O se 1300 bombas → 1360 (3) lacres, 1370 (3) bicos
  1390 (2) OC  usinas → 1391 (3)
  1400 (2) OC  valores agregados (IPM)
  1500 (2) OC  energia elétrica interestadual → 1510 (3)
  1600 (2)     cartões (VÁLIDO ATÉ 31/12/2021; não gerar)
  1601 (2) OC  instrumentos de pagamento eletrônico (desde 01/01/2022)
  1700 (2) OC  documentos fiscais em papel utilizados → 1710 (3)
  1800 (2) OC  DCTA (transporte aéreo)
  1900 (2) OC  sub-apuração → 1910 (3) → 1920 (4) → 1921 (5) → 1922/1923 (6); 1925 (5); 1926 (5)
  1960 / 1970 (→1975) / 1980 (2) OC  GIAF (somente Pernambuco)
1990 (1) O
```

### 1001
- IND_MOV (N) [0,1]. Além de 1001/1990, **sempre** deve existir o 1010. Na prática, IND_MOV = **0 sempre** (o 1010 é obrigatório). [GUIA]

### 1010: indicadores que controlam o Bloco 1 (obrigatório, ocorrência 1)
Resposta "S" → contribuinte **obrigado** a apresentar o registro correspondente. Se a UF dispensar o registro, responder "N". [GUIA]
[IMPL/PVA] Tratar como consistência nos dois sentidos: S ⇒ registro presente; N ⇒ registro ausente.

| # | Campo | Registro | Pergunta | Varejo ES (default sugerido) |
|---|---|---|---|---|
| 02 | IND_EXP | 1100 | Houve averbação (conclusão) de exportação no período? | N |
| 03 | IND_CCRF | 1200 | Há créditos de ICMS a controlar extra-apuração, definidos pela SEFAZ? | N (S se houver crédito acumulado controlado) |
| 04 | IND_COMB | 1300 | Varejista de combustíveis com movimentação/estoque? (sem mov./estoque → N) | N (S para posto) |
| 05 | IND_USINA | 1390 | Usina de açúcar/álcool com movimentação/estoque? | N |
| 06 | IND_VA | 1400 | Registro obrigatório na UF e há informações? | [ES?] |
| 07 | IND_EE | 1500 | Distribuidora de energia com fornecimento a outra UF? | N |
| 08 | IND_CART | 1601 | Realizou vendas com instrumentos eletrônicos de pagamento? (até 2021 era o 1600) | **S** na maioria dos varejistas |
| 09 | IND_FORM | 1700 | Emitiu documento fiscal em **papel** com AIDF em UF que exige controle? | N (S só com papel autorizado) |
| 10 | IND_AER | 1800 | Transporte aéreo? | N |
| 11 | IND_GIAF1 | 1960 | GIAF1 (só PE) | **N** (ES) |
| 12 | IND_GIAF3 | 1970 | GIAF3 (só PE) | **N** (ES) |
| 13 | IND_GIAF4 | 1980 | GIAF4 (só PE) | **N** (ES) |
| 14 | IND_REST_RESSARC_COMPL_ICMS | 1250 | Há saldos consolidados de restituição/ressarcimento/complementação do ICMS? | [ES?] |

Obs.: não há indicador para 1900 (a obrigatoriedade vem dos códigos de ajuste, ver abaixo).

Exemplo: `|1010|N|N|N|N|N|N|S|N|N|N|N|N|N|`

### 1100 / 1105 / 1110: exportação
- **1100** (1 por RE; no mês em que a exportação é **concluída/averbada** pelo exportador efetivo): IND_DOC [0 DE/DDE, 1 DSE, 2 DU-E]; NRO_DE (sem máscara); DT_DE ≤ DT_FIN; NAT_EXP [0 direta, 1 indireta]; NRO_RE e DT_RE (obrigatórios se IND_DOC=0); CHC_EMB; DT_CHC; DT_AVB (O); TP_CHC (tabela 01..99); PAIS (tabela SISCOMEX, 3 dígitos). Todas as datas ≤ 0000.DT_FIN.
- **1105**: documentos de exportação: COD_MOD ∈ {01,55}; NUM_DOC > 0; CHV_NFE obrigatória se 55 (DV e número conferidos); DT_DOC ≤ DT_FIN; COD_ITEM no 0200.
- **1110**: exportação indireta (mercadoria de terceiros adquirida com fim específico): COD_PART (0150), COD_MOD ∈ {01,1B,04,55}, SER, NUM_DOC > 0, DT_DOC, CHV_NFE (obrig. se 55), NR_MEMO, QTD > 0, UNID (0190).

### 1200 / 1210: controle de créditos fiscais (extra-apuração)
- Obrigatoriedade definida por cada UF. [ES?]
- **1200**: COD_AJ_APUR (tabela 5.1.1; desde 2013 só códigos com **4º caractere = "9"**, ex.: `ES09xxxx`); SLD_CRED (saldo anterior); CRED_APR (apropriado no mês, exceto transferências recebidas); CRED_RECEB (recebido por transferência); CRED_UTIL; SLD_CRED_FIM.
  - `CRED_UTIL = Σ 1210.VL_CRED_UTIL`
  - `SLD_CRED_FIM = SLD_CRED + CRED_APR + CRED_RECEB − CRED_UTIL`
- **1210**: TIPO_UTIL (tabela da UF ou 5.5 genérica: `ES01` dedução, `ES21` compensação, `ES41` transferência, `ES61` restituição, `ES81` estorno, `ES99` outros); NR_DOC; VL_CRED_UTIL > 0; CHV_DOCe (NF-e 55, CT-e 57, CT-e OS 67; DV e número conferidos com NR_DOC).

### 1250 / 1255: saldos de restituição, ressarcimento e complementação do ICMS (ST)
- Obrigatoriedade e forma definidas pela UF. [ES?] Ligado aos C181/C185/C330/C380/C430/C480/C815/C880 e ao H005 MOT_INV=06.
- **1250** (1:1): VL_CREDITO_ICMS_OP, VL_ICMS_ST_REST, VL_FCP_ST_REST, VL_ICMS_ST_COMPL, VL_FCP_ST_COMPL, cada um = Σ do campo correspondente `*_MOT` do 1255.
- **1255** (chave COD_MOT_REST_COMPL, tabela 5.7 da UF): VL_CREDITO_ICMS_OP_MOT, VL_ICMS_ST_REST_MOT, VL_FCP_ST_REST_MOT, VL_ICMS_ST_COMPL_MOT, VL_FCP_ST_COMPL_MOT.
  - `VL_ICMS_ST_REST_MOT = Σ (VL_UNIT_ICMS_ST_CONV_REST × QUANT_CONV)` dos C181, C185, C330, C380, C430, C480, C815, C880 com aquele motivo; o mesmo vale para FCP_ST_REST (VL_UNIT_FCP_ST_CONV_REST), ICMS_ST_COMPL (VL_UNIT_ICMS_ST_CONV_COMPL) e FCP_ST_COMPL (VL_UNIT_FCP_ST_CONV_COMPL).

### 1300 a 1370: combustíveis (postos, LMC). Só para clientes postos (IND_COMB=S)
- **1300** (1 por COD_ITEM + DT_FECH): ESTQ_ABERT, VOL_ENTR (dos C171), `VOL_DISP = ESTQ_ABERT + VOL_ENTR`, VOL_SAIDAS (Σ vendas), `ESTQ_ESCR = VOL_DISP − VOL_SAIDAS`, VAL_AJ_PERDA, VAL_AJ_GANHO, FECH_FISICO. DT_FECH dentro do período do 0000. Todas as quantidades em litros, 3 casas.
- **1310** (por tanque, NUM_TANQUE único): mesmas fórmulas por tanque; CAP_TANQUE; **Σ 1310.FECH_FISICO = 1300.FECH_FISICO**. Tanques interligados são agrupados em um só registro.
- **1320** (por bico; 1 registro extra por intervenção; 2 registros se o encerrante "virar"): `VOL_VENDAS = VAL_FECHA − VAL_ABERT − VOL_AFERI`; dados de intervenção só se houver.
- **1350** bombas (SERIE, FABRICANTE, MODELO, TIPO_MEDICAO [0,1]); **1360** lacres (NUM_LACRE, DT_APLICACAO); **1370** bicos (NUM_BICO; tanque sem bico → ≥ 990; COD_ITEM no 0200; NUM_TANQUE). 1310/1350/1360/1370 obrigatórios se existir 1300.

### 1390 / 1391: usinas de açúcar/álcool (não se aplica a comércio)
- 1390 COD_PROD (tabela 5.8); 1391 produção diária (estoques, produção, mel residual, resíduos; `QTD_RESIDUO = DDG + WDG + CANA`).

### 1400: informação sobre valores agregados (índice de participação dos municípios, IPM/DIPAM)
- Só se a UF do estabelecimento (ou UF onde tem IE de substituto, reg. 0015) exigir. [GUIA]
- Campos: COD_ITEM_IPM (Tabela 5.9.1 da UF, ou 5.9.2 UF_ST, **ou** COD_ITEM do 0200); MUN (IBGE, 7 dígitos, da UF do 0000 ou de UF do 0015); VALOR > 0 (valor ≤ 0 → não informar no mês).
- Validação: MUN da própria UF → código na 5.9.1 ou no 0200; MUN de UF do 0015 → código na 5.9.2 daquela UF.
- **ES**: [ES?] verificar se existe a Tabela 5.9.1 para ES no portal SPED (tabelas externas do PVA) e se a SEFAZ-ES coleta o valor adicionado pela EFD ou por outra declaração estadual. Sem essa tabela publicada/obrigação: IND_VA = N e sem 1400. Relevante para quem tem operações em mais de um município (ex.: compras de produtor rural).

### 1500 / 1510: energia elétrica interestadual (distribuidoras, Conv. 115/03). Não se aplica a comércio.
- 1500: IND_OPER=1, IND_EMIT=0, COD_MOD=06, COD_SIT ∈ {00,01,06,07,08}, COD_CONS 01..08 etc.; 1510 itens (CFOP começando com 6).

### 1600: cartões (válido até 31/12/2021). **Não gerar para períodos ≥ 2022.**

### 1601: operações com instrumentos de pagamentos eletrônicos (≥ 01/01/2022). IMPORTANTE PARA VAREJO
- Finalidade: total **recebido** pelo declarante por meio de instrumentos de pagamento eletrônico (cartão crédito/débito, private label e demais, conforme Conv. ICMS 134/2016; o Pix entra conforme a redação atual do convênio [ES?]), **por instituição de pagamento** e, se houver, **por intermediador**.
- Facultativo em 2022; a partir de 2023 a obrigatoriedade é definida por cada UF. [ES?] Confirmar o ato da SEFAZ-ES.
- Excluir estornos e cancelamentos. Consultar o contrato com a instituição para ratificar a prestação do serviço.

| # | Campo | Tipo | Obrig | Conteúdo |
|---|---|---|---|---|
| 02 | COD_PART_IP | C 60 | O | participante (0150) = **CNPJ da instituição que efetuou o pagamento** (adquirente/subadquirente/IP: Cielo, Rede, Stone, PagSeguro, Mercado Pago...) |
| 03 | COD_PART_IT | C 60 | OC | participante (0150) = **CNPJ do intermediador** (plataforma de delivery, marketplace, agenciador; ex.: iFood, Mercado Livre) |
| 04 | TOT_VS | N,2 | O | total **bruto** de vendas/prestações no campo de incidência do **ICMS**, inclusive imunes, isentas e não tributadas |
| 05 | TOT_ISS | N,2 | O | total bruto de serviços no campo do **ISS** |
| 06 | TOT_OUTROS | N,2 | O | operações fora do ICMS/ISS: cartão-presente, saques, pagamento de contas/faturas etc. |

Regras e implementação:
- Nível 2, ocorrência 1:N. [IMPL] Chave lógica: COD_PART_IP + COD_PART_IT (uma linha por par instituição × intermediador; sem intermediador → COD_PART_IT vazio).
- COD_PART_IP e COD_PART_IT **devem existir no 0150** → o gerador precisa criar 0150 para as instituições/intermediadores (PJ, CNPJ preenchido, UF/município). Isso também obriga o 0150 a conter participantes que não aparecem em documentos fiscais.
- Os campos 04 a 06 são "O": informar `0,00` quando não houver valor.
- Exige IND_CART=S no 1010.
- [IMPL] Fontes de dados: extratos/relatórios de conciliação das adquirentes (valor bruto por CNPJ da adquirente), grupo `pag/detPag/card` da NFC-e/NF-e (`CNPJ` credenciadora, `tBand`, `cAut`), intermediador da NF-e (`infIntermed/CNPJ`, `indIntermed=1`). Atenção: o fisco cruza o 1601 com a **DIMP** entregue pelas instituições (Conv. 134/16); divergências entre vendas no cartão e as saídas escrituradas (C100/C800/C190) são alvo de malha. Validador interno: Σ TOT_VS ≤ Σ saídas de mercadorias do período (alerta, não erro).

### 1700 / 1710: documentos fiscais em papel utilizados
- Obrigatoriedade definida pela UF; na prática só com documento em papel autorizado por AIDF (IND_FORM=S).
- 1700: COD_DISP [00 FS impressor autônomo, 01 FS-DA, 02 FS NF-e, 03 formulário contínuo, 04 blocos, 05 jogos soltos]; COD_MOD; SER; SUB; NUM_DOC_INI; NUM_DOC_FIN; NUM_AUT.
- 1710: faixas canceladas/inutilizadas dentro do intervalo do 1700 (cancelamento não contínuo → NUM_DOC_INI = NUM_DOC_FIN; ex.: 45–45, 50–52).

### 1800: DCTA, transporte aéreo (não se aplica)
- `VL_FAT = VL_CARGA + VL_PASS`; `IND_RAT = VL_CARGA / VL_FAT` (6 casas); `VL_ICMS_APUR = IND_RAT × VL_ICMS_ANT`; `VL_BC_ICMS_APUR = IND_RAT × VL_BC_ICMS`; `VL_DIF = VL_ICMS_ANT − VL_ICMS_APUR`.

### 1900 a 1926: sub-apuração do ICMS (apuração em separado)
- Somente para contribuintes obrigados pela legislação da UF. **Obrigatório** se houver C197, C597, C857, C897, D197 ou D737 com **4º dígito do COD_AJ ∈ {3,4,5,6,7,8}**, ou se 1920.VL_SLD_CREDOR_ANT_OA > 0.
- **1900**: IND_APUR_ICMS [3..8 → Apuração 1..6] (único por arquivo), DESCR_COMPL_OUT_APUR (norma legal).
- **1910**: DT_INI/DT_FIN cobrindo todo o período do 0000, sem lacunas nem sobreposições.
- **1920** (1 por período), espelho do E110:
  - 02 VL_TOT_TRANSF_DEBITOS_OA = Σ C197/D197.VL_ICMS com 3º/4º caracteres do COD_AJ = "2"/IND_APUR (saídas; exclui COD_SIT 01 e 07; data DT_E_S, ou DT_DOC se vazia, dentro do 1910);
  - 03 VL_TOT_AJ_DEBITOS_OA = Σ 1921 com 3º=0 e 4º=0; 04 VL_ESTORNOS_CRED_OA = 4º=1;
  - 05 VL_TOT_TRANSF_CREDITOS_OA = Σ C197/D197 com 3º/4º = "5"/IND_APUR (entradas; extemporâneos entram no 1º período);
  - 06 VL_TOT_AJ_CREDITOS_OA = 1921 4º=2; 07 VL_ESTORNOS_DEB_OA = 1921 4º=3;
  - 08 VL_SLD_CREDOR_ANT_OA (informado);
  - `X = (02+03+04) − (05+06+07+08)`; se X ≥ 0 → 09 VL_SLD_APURADO_OA = X e 12 = 0; se X < 0 → 09 = 0 e 12 VL_SLD_CREDOR_TRANSP_OA = |X|;
  - 10 VL_TOT_DED = Σ C197/D197 (3º=6, 4º ∈ 3..8) + Σ 1921 (3º=0, 4º=4);
  - 11 VL_ICMS_RECOLHER_OA = 09 − 10;
  - 13 DEB_ESP_OA = ICMS de documentos extemporâneos (COD_SIT 01/07) + C197/D197 (3º=7, 4º ∈ 3..8) + 1921 (3º=0, 4º=5);
  - **Σ 1926.VL_OR = 11 + 13**.
- **1921**: COD_AJ_APUR (tabela 5.1.1 da UF; 3º caractere = "0"; 4º: 0 outros débitos, 1 estorno de créditos, 2 outros créditos, 3 estorno de débitos, 4 deduções, 5 débitos especiais), DESCR_COMPL_AJ (obrigatória com códigos genéricos), VL_AJ_APUR.
- **1922**: NUM_DA, NUM_PROC, IND_PROC [0,1,2,9], PROC, TXT_COMPL. **1923**: documentos do ajuste (COD_PART no 0150, vazio para NFC-e 65; COD_MOD; SER; SUB; NUM_DOC > 0; DT_DOC; COD_ITEM; VL_AJ_ITEM; CHV_DOCe com DV e número/série conferidos).
- **1925**: valores declaratórios (COD_INF_ADIC da tabela 5.2 da UF; se a UF não publicou a tabela → não apresentar).
- **1926**: COD_OR ∈ {000,003,004,005,006,090}; VL_OR; DT_VCTO; COD_REC (código de receita estadual); NUM_PROC (se preenchido → IND_PROC e PROC obrigatórios); TXT_COMPL (extemporâneo: mmaaaa); MES_REF (mmaaaa, ≤ competência do 0000.DT_INI).

### 1960 / 1970 / 1975 / 1980: GIAF (somente Pernambuco)
- ES: **nunca gerar**; IND_GIAF1/3/4 = N.
- (Referência: 1960 G1_10 = G1_07 + G1_09 = E111 `UF04XX11`; 1970 G3_T = E111 `UF04XX13`; 1975 ALIQ_IMP_BASE ∈ {3,50; 6,00; 8,00; 10,00}; 1980 IND_AP = 02, G4_10 = E111 `UF04XX14`.)

### 1990
- QTD_LIN_1 inclui 1001 e 1990.

---

## 5. BLOCO 9: controle e encerramento

| Registro | Nível | Ocorr. | Campos | Regra |
|---|---|---|---|---|
| 9001 | 1 | 1 | IND_MOV | **sempre `0`** (valor válido único) |
| 9900 | 2 | V | REG_BLC, QTD_REG_BLC | uma linha para **cada tipo de registro existente no arquivo**, inclusive 0000, 9001, **9900**, 9990 e **9999** (inclusive os posteriores a ele); QTD = nº de linhas daquele tipo |
| 9990 | 1 | 1 | QTD_LIN_9 | linhas do bloco 9 **+ o 9999** |
| 9999 | 0 | 1 | QTD_LIN | total de linhas do arquivo, **incluindo o próprio 9999** |

Algoritmo de geração (determinístico):
```
linhas = [todas as linhas de 0000 até 1990]           # sem bloco 9
tipos = contagem por REG em linhas
tipos["9001"] = 1; tipos["9990"] = 1; tipos["9999"] = 1
n9900 = len(tipos) + 1                                 # +1 = a própria entrada "9900"
tipos["9900"] = n9900
emitir |9001|0|
para cada REG em ordem do arquivo: emitir |9900|REG|tipos[REG]|
QTD_LIN_9 = 1 (9001) + n9900 + 1 (9990) + 1 (9999)
emitir |9990|QTD_LIN_9|
QTD_LIN = len(linhas) + QTD_LIN_9
emitir |9999|QTD_LIN|
```
Validação: cada 9900.QTD_REG_BLC = contagem real; nenhum REG presente sem 9900 correspondente; sem 9900 para REG ausente; sem REG_BLC duplicado.

---

## 6. Regras de validação (checklist para o validador)

Legenda de severidade: **E** = erro do PVA (impede a transmissão), **A** = advertência do PVA, **I** = verificação interna recomendada.

### Gerais
- [E] Cada bloco com X001 e X990; X001.IND_MOV=1 ⇒ apenas X001+X990; IND_MOV=0 ⇒ ≥ 1 registro de dados.
- [E] X990.QTD_LIN_X = nº de linhas do bloco (incluindo X001/X990).
- [E] Toda referência COD_ITEM/COD_PART/UNID/COD_IND_BEM/COD_CTA existe no Bloco 0 (0200/0150/0190/0300/0500).
- [E] Datas válidas `ddmmaaaa` e dentro dos limites do 0000 quando exigido.

### Bloco G
- [E] G001.IND_MOV=0 ⇒ ≥ 1 G110 com filhos.
- [E] G110: DT_INI+DT_FIN únicos e iguais a um E100.
- [E] G110.SOM_PARC = Σ G125.VL_PARC_PASS.
- [E] G110.VL_TRIB_EXP ≤ VL_TOTAL; IND_PER_SAI = VL_TRIB_EXP / VL_TOTAL (8 casas).
- [E] G110.ICMS_APROP = SOM_PARC × IND_PER_SAI.
- [E] G110.SOM_ICMS_OC = Σ G126.VL_PARC_APROP.
- [I] G110.SALDO_IN_ICMS = Σ (campos 05 a 08) dos G125 `SI`.
- [E] G125: COD_IND_BEM no 0300; chave COD_IND_BEM+TIPO_MOV única; TIPO_MOV ∈ {SI,IM,IA,CI,MC,BA,AT,PE,OT}.
- [E] G125.DT_MOV: SI ⇒ = G110.DT_INI; demais ⇒ ≤ G110.DT_FIN.
- [E] G125 entradas (SI/IM/IA/CI/MC): algum dos campos 05 a 08 > 0; saídas (BA/AT/PE/OT): campos 05 a 10 vazios.
- [E] NUM_PARC ⇔ VL_PARC_PASS (um exige o outro quando > 0).
- [E] VL_PARC_PASS ≤ (OP+ST+FRT+DIF) / 0300.NR_PARC.
- [E] Campos 05 a 08 do G125 ≤ Σ dos respectivos *_APLICADO dos G140 filhos (se houver).
- [I] BA/AT/PE/OT sempre acompanhado de um SI do mesmo bem no mesmo período.
- [E] G126.VL_PARC_APROP ≤ VL_PARC_PASS × IND_PER_SAI.
- [E] G130 obrigatório para TIPO_MOV ∈ {MC,IM,IA,AT}; COD_MOD ∈ {01,1B,04,07,08,8B,09,10,26,27,55,57}; chave NF-e/CT-e válida; documento único por bem; COD_PART no 0150.
- [E] G140: COD_ITEM no 0200; UNID no 0190 (0220 se ≠ UNID_INV); NUM_ITEM+COD_ITEM único.
- [I] O crédito ICMS_APROP + SOM_ICMS_OC está lançado no E111 com código de ajuste de crédito CIAP da tabela ES.
- [E] Existe 0300 ⇒ existe 0500.

### Bloco H
- [A] Período de referência **fevereiro**: H001.IND_MOV=0 e um H005 com DT_INV = 31/12 do ano anterior e MOT_INV=01.
- [E] H005.DT_INV ≤ 0000.DT_FIN; MOT_INV=01 não pode ser apresentado após o 2º mês subsequente a DT_INV.
- [E] H005.VL_INV = Σ H010.VL_ITEM; sem H010 ⇒ VL_INV = 0; VL_INV = 0 ⇒ nenhum H010/H020.
- [E] MOT_INV ∈ {01..06}.
- [E] Arquivo com C180/C181/C185/C186/C330/C380/C430/C480/C815/C870 ⇒ H005 com MOT_INV=06 e DT_INV = 0000.DT_INI − 1 dia; todos os itens desses registros com H010 nesse H005 (salvo VL_INV=0).
- [I] CNAE 4681-8/01 ou 4681-8/02 ⇒ H005 MOT_INV=01 com DT_INV = fim do mês em **todos** os meses.
- [E] H010: COD_ITEM no 0200; UNID = 0200.UNID_INV; IND_PROP ∈ {0,1,2}; IND_PROP 1/2 ⇒ COD_PART (no 0150).
- [E] H010.COD_CTA obrigatório para perfil A e B (0000.IND_PERFIL).
- [I] |VL_ITEM − QTD × VL_UNIT| ≤ tolerância de arredondamento; nenhum COD_ITEM duplicado (mesmo IND_PROP/COD_PART) no mesmo H005.
- [E] H020 só com MOT_INV ∈ {02..05} (e VL_INV > 0); CST_ICMS válido (tabela 4.3.1).
- [E] H030 obrigatório se MOT_INV=06 e proibido nos demais motivos; VL_FCP ≤ VL_ICMS_ST (I).

### Bloco K
- [I] Varejista (CNAE 47xx) ou Simples Nacional ⇒ K001.IND_MOV=1.
- [E] K001.IND_MOV=0 ⇒ K010 presente e ≥ 1 K100.
- [E] K100 cobre todo o período do 0000 sem DT_INI/DT_FIN duplicados.
- [E] K200.DT_EST = K100.DT_FIN; TIPO_ITEM do 0200 ∈ {00,01,02,03,04,05,06,10}; IND_EST 1/2 ⇒ COD_PART; chave DT_EST+COD_ITEM+IND_EST+COD_PART.
- [E] K280: DT_EST < 0000.DT_INI; só um entre QTD_COR_POS e QTD_COR_NEG; quantidades não negativas.
- [I] K010 = 2 (restrito a saldos) ⇒ só K100/K200/K280 (e K220 se houver).

### Bloco 1
- [E] 1001 presente com 1010 sempre; 1990.QTD_LIN_1 correto.
- [E/I] Para cada indicador do 1010: S ⇒ registro correspondente presente (1100, 1200, 1300, 1390, 1400, 1500, 1601, 1700, 1800, 1960, 1970, 1980, 1250); N ⇒ ausente.
- [I] ES ⇒ IND_GIAF1/3/4 = N e nenhum 1960/1970/1975/1980.
- [E] Período ≥ 2022 ⇒ não gerar 1600; usar 1601.
- [E] 1601: COD_PART_IP (O) e COD_PART_IT (se informado) existem no 0150; TOT_VS, TOT_ISS, TOT_OUTROS preenchidos (≥ 0).
- [I] 1601: um registro por par (IP, IT); Σ TOT_VS coerente com as saídas escrituradas; valores sem estornos/cancelamentos; conciliar com os relatórios das adquirentes (DIMP).
- [E] 1200: COD_AJ_APUR válido na 5.1.1 da UF com 4º caractere "9"; CRED_UTIL = Σ 1210.VL_CRED_UTIL; SLD_CRED_FIM = SLD_CRED + CRED_APR + CRED_RECEB − CRED_UTIL.
- [E] 1210: TIPO_UTIL na tabela da UF (ou 5.5 genérica); VL_CRED_UTIL > 0; CHV_DOCe com DV válido e número consistente.
- [E] 1250 = Σ 1255 (5 campos); 1255 = Σ (unitário × QUANT_CONV) dos C181/C185/C330/C380/C430/C480/C815/C880 por motivo; COD_MOT_REST_COMPL na tabela 5.7 da UF.
- [E] 1300: VOL_DISP = ESTQ_ABERT + VOL_ENTR; ESTQ_ESCR = VOL_DISP − VOL_SAIDAS; 1 por COD_ITEM+DT_FECH; Σ 1310.FECH_FISICO = 1300.FECH_FISICO; 1320.VOL_VENDAS = VAL_FECHA − VAL_ABERT − VOL_AFERI; 1310/1350/1360/1370 presentes se houver 1300.
- [E] 1400: MUN (IBGE 7 dígitos) da UF do 0000 ou de UF do 0015; código na 5.9.1/5.9.2 ou no 0200; VALOR > 0.
- [E] 1900 obrigatório se houver C197/C597/C857/C897/D197/D737 com 4º dígito do COD_AJ ∈ 3..8 (ou saldo credor anterior da sub-apuração > 0); 1910 sem lacunas nem sobreposições; fórmulas do 1920; Σ 1926.VL_OR = VL_ICMS_RECOLHER_OA + DEB_ESP_OA; 1926.NUM_PROC ⇒ IND_PROC e PROC.
- [E] 1100: NRO_RE/DT_RE obrigatórios se IND_DOC=0; datas ≤ DT_FIN; PAIS na tabela SISCOMEX. 1105/1110: CHV_NFE obrigatória se modelo 55.

### Bloco 9
- [E] 9001.IND_MOV = 0.
- [E] Um 9900 por tipo de registro presente (inclusive 9900, 9990 e 9999), com QTD igual à contagem real; sem duplicatas.
- [E] 9990.QTD_LIN_9 = 1 + nº de 9900 + 1 + 1 (o 9999 conta).
- [E] 9999.QTD_LIN = total de linhas do arquivo, incluindo o próprio 9999.

---

## 7. Pendências de legislação ES (confirmar antes de codificar como regra dura)
1. Obrigatoriedade do **1601** no ES a partir de 2023 (ato da SEFAZ-ES) e se o Pix entra no escopo.
2. Exigência do **1400** no ES (existe tabela 5.9.1-ES?) e o que compõe o VALOR.
3. ES adota **1200/1210** (créditos acumulados), **1250/1255** e a sistemática C18x + H005 MOT_INV=06 (restituição/complementação de ST)?
4. Códigos de ajuste E111 do ES para crédito CIAP (G110) e composição de VL_TRIB_EXP/VL_TOTAL no RICMS/ES.
5. Apuração em separado (1900) exigida por algum benefício do ES (ex.: INVEST-ES, COMPETE-ES)?
6. Cronograma do Bloco K para atacadistas no ES (Ajuste SINIEF 25/16 e alterações) e eventuais dispensas estaduais.
