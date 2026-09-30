# EFD-Contribuições — Bloco C (Documentos Fiscais I – Mercadorias ICMS/IPI)

Fonte: Guia Prático EFD-Contribuições v1.35 (18/06/2021), linhas 5072–9355 do txt extraído.
Foco: gerar/validar a partir de XML NF-e (mod. 55) e NFC-e (mod. 65), farmácias/varejo (monofásico, ST, alíquota zero).

Convenções de tipo: `C` = alfanumérico, `N` = numérico; `*` no tamanho = tamanho fixo; `Dec` = casas decimais;
`Obrig` S/N (obrigatório/não). Formato de data `ddmmaaaa`. Decimais com vírgula no txt SPED.
Campos marcados "N" (não obrigatório) podem ser vazios `||`.

Legenda de nível: 0 = 0000; 1 = C001/C990; 2 = C010; 3 = C100/C180/C190/C380/C400/C490/C500/C600/C800/C860...; 4 = filhos; 5 = netos.

---

## Visão geral / decisões de arquitetura (resumo antecipado — detalhes por registro abaixo)

| Situação | Registro(s) | Observação |
|---|---|---|
| NF-e 55 **saída** (venda), escrituração por documento | C100 + C170 (+C110/C111) | Opcional para NF-e (alternativa ao C180) |
| NF-e 55 **saída**, escrituração consolidada | C180 + C181 (PIS) + C185 (COFINS) (+C188) | Consolidado por **item (0200)**; dispensa C100 |
| NF-e 55 **entrada com crédito / devoluções**, por documento | C100 + C170 (+C120 importação) | CST 50–66 no C170 |
| NF-e 55 **entrada com crédito / devoluções**, consolidada | C190 + C191 (PIS) + C195 (COFINS) (+C198, C199) | Consolidado por item + participante |
| NFC-e 65 (regra geral a partir de 09/2014) | C100 + **C175** (analítico por CFOP+CST+alíquota) | **Não** usar C170 para NFC-e |
| NFC-e 65 excepcional (arquivo > 1 GB se individualizado) | C180/C181/C185 | Condições específicas (ver C180) |
| NF mod. 01, 1B, 04 (papel) | C100 + C170 **obrigatório** | Não pode consolidar |
| Cupom Fiscal ECF (02, 2D) | C400 (por ECF) ou C490 (consolidado) | |
| CF-e SAT (59) | C860 (por equipamento) ou C800 (por documento) | Ver seção C800/C860 |
| Energia/água/gás (06, 28, 29 e 55 de energia) | C500 (entrada crédito) / C600 (saída) | |
| NF de venda a consumidor mod. 02 | C380 (+C381/C385) ou C395 (aquisição) | |

`C010.IND_ESCRI` (1 = consolidado C180/C190/C490; 2 = individualizado C100/C170/C400) só é exigido quando o arquivo
contém, para NF-e (ou ECF), **ambos** os tipos (individualizado e consolidado) para o mesmo estabelecimento.

---

## C001 — Abertura do Bloco C

Nível 1 · Ocorrência: 1 por arquivo.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C001" | C | 004* | - | S |
| 02 | IND_MOV | 0 = bloco com dados; 1 = sem dados | C | 001* | - | S |

Validação: IND_MOV=1 ⇒ só C001 e C990. IND_MOV=0 ⇒ pelo menos 1 registro além de C001/C990.

---

## C010 — Identificação do Estabelecimento

Nível 2 · Ocorrência: vários por arquivo · Obrigatório se C001.IND_MOV=0.

Só cadastrar estabelecimentos que efetivamente realizaram aquisição, venda ou devolução de mercadorias com documento
fiscal ICMS/IPI escriturável no Bloco C. Estabelecimento sem operações no período **não** deve ter C010.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C010" | C | 004* | - | S |
| 02 | CNPJ | CNPJ do estabelecimento | N | 014* | - | S |
| 03 | IND_ESCRI | 1 = apuração pelos consolidados (C180/C190 e C490); 2 = pelos individualizados (C100/C170 e C400) | C | 001* | - | N |

Validações:
- CNPJ: DV conferido; deve existir no registro **0140**.
- IND_ESCRI: preencher quando o arquivo contiver, para NF-e 55, C100 **e** C180/C190; ou, para ECF, C400 **e** C490.

Mapeamento XML: CNPJ = `emit/CNPJ` (saídas) ou `dest/CNPJ` (entradas) — sempre o CNPJ do **estabelecimento informante**.

---

## C100 — Documento: NF (01), NF Avulsa (1B), NF Produtor (04), NF-e (55) e NFC-e (65)

Nível 3 · Ocorrência 1:N (filho de C010).

Leiaute idêntico ao C100 da EFD ICMS/IPI (Ato COTEPE/ICMS 9/2008).

Uso:
- Um C100 por documento (01, 1B, 04, 55, 65) de entrada/saída que represente **receita** (tributada ou não) ou
  **aquisição/devolução com direito a crédito**. Não informar documentos que não gerem receita nem crédito.
- Para cada C100 é obrigatório pelo menos um C170 (ou C175 para NFC-e), **exceto** COD_SIT 02/03 (cancelado),
  04 (denegado), 05 (inutilizado): nesses casos **não** gerar filhos.
- Para NF-e 55 o C100 é **opcional** (alternativa ao consolidado C180/C190). Para 01, 1B, 04 é **obrigatório**.
- Se o arquivo tiver C100 e C180/C190 para NF-e ⇒ preencher C010.IND_ESCRI.

Chave de unicidade (não pode repetir dentro do mesmo C010):
- IND_EMIT=1 (terceiros): IND_OPER + IND_EMIT + COD_PART + COD_MOD + COD_SIT + SER + NUM_DOC
- IND_EMIT=0 (própria): IND_OPER + IND_EMIT + COD_MOD + COD_SIT + SER + NUM_DOC
- A partir de fatos geradores de **abril/2021**: CHV_NFE também integra a chave.

ATENÇÃO NFC-e (65): informar **somente C100 + C175**. No C100 da NFC-e **não precisam** ser informados: COD_PART,
VL_BC_ICMS_ST, VL_ICMS_ST, VL_IPI, VL_PIS, VL_COFINS, VL_PIS_ST, VL_COFINS_ST. Demais campos seguem obrigatoriedade normal.

Outras notas: bebidas frias (Lei 13.097/2015, a partir 05/2015) ⇒ ver NT 005/2015. NF-e avulsa das UF (séries 890–899)
= emissão de terceiros, COD_SIT = 08.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | XML NF-e/NFC-e |
|---|---|---|---|---|---|---|---|
| 01 | REG | "C100" | C | 004 | - | S | — |
| 02 | IND_OPER | 0 = Entrada; 1 = Saída | C | 001* | - | S | `ide/tpNF` (0 entrada/1 saída) na ótica do informante: NF-e de terceiro recebida ⇒ 0 |
| 03 | IND_EMIT | 0 = Emissão própria; 1 = Terceiros | C | 001* | - | S | `emit/CNPJ` == CNPJ do C010 ⇒ 0 |
| 04 | COD_PART | Código participante (0150): emitente/remetente nas entradas; adquirente nas saídas | C | 060 | - | S (dispensado p/ NFC-e) | `emit` (entrada) / `dest` (saída) → 0150 |
| 05 | COD_MOD | Tabela 4.1.1 | C | 002* | - | S | `ide/mod` (55/65) |
| 06 | COD_SIT | Tabela 4.1.2 | N | 002* | - | S | derivado de protocolo/evento (ver abaixo) |
| 07 | SER | Série | C | 003 | - | N (obrig. p/ 55 e 65 própria; "000" se não houver) | `ide/serie` (zero-pad 3) |
| 08 | NUM_DOC | Número | N | 009 | - | S | `ide/nNF` (>0) |
| 09 | CHV_NFE | Chave NF-e/NFC-e | N | 044* | - | N (obrig. própria 55/65 e, desde 04/2012, terceiros 55) | `infNFe/@Id` sem "NFe" / `protNFe/infProt/chNFe` |
| 10 | DT_DOC | Data de emissão | N | 008* | - | S | `ide/dhEmi` → ddmmaaaa |
| 11 | DT_E_S | Data entrada/saída | N | 008* | - | N (obrig. nas entradas) | `ide/dhSaiEnt` (saída) ou data de entrada do ERP (entrada) |
| 12 | VL_DOC | Valor total do documento | N | - | 02 | S | `total/ICMSTot/vNF` |
| 13 | IND_PGTO | 0 à vista; 1 a prazo; 9 sem pgto (até 06/2012) → a partir 01/07/2012: 0 à vista, 1 a prazo, 2 outros | C | 001* | - | S | `pag/detPag/indPag` / `cobr/dup` (existência de duplicatas ⇒ 1) |
| 14 | VL_DESC | Desconto total (incondicional) | N | - | 02 | N | `ICMSTot/vDesc` |
| 15 | VL_ABAT_NT | Abatimento não tributado e não comercial (ex.: desconto ICMS remessa ZFM) | N | - | 02 | N | `ICMSTot/vICMSDeson` (quando motDesICMS=7 ZFM) |
| 16 | VL_MERC | Valor total mercadorias/serviços | N | - | 02 | N | `ICMSTot/vProd` |
| 17 | IND_FRT | Indicador do frete (ver tabelas por período) | C | 001* | - | S | `transp/modFrete` (0–4, 9) |
| 18 | VL_FRT | Frete | N | - | 02 | N | `ICMSTot/vFrete` |
| 19 | VL_SEG | Seguro | N | - | 02 | N | `ICMSTot/vSeg` |
| 20 | VL_OUT_DA | Outras despesas acessórias | N | - | 02 | N | `ICMSTot/vOutro` |
| 21 | VL_BC_ICMS | BC ICMS | N | - | 02 | N | `ICMSTot/vBC` |
| 22 | VL_ICMS | ICMS | N | - | 02 | N | `ICMSTot/vICMS` |
| 23 | VL_BC_ICMS_ST | BC ICMS-ST | N | - | 02 | N (dispensado NFC-e) | `ICMSTot/vBCST` |
| 24 | VL_ICMS_ST | ICMS retido por ST | N | - | 02 | N (dispensado NFC-e) | `ICMSTot/vST` |
| 25 | VL_IPI | IPI total | N | - | 02 | N (dispensado NFC-e) | `ICMSTot/vIPI` |
| 26 | VL_PIS | PIS total (débito ou crédito) | N | - | 02 | N (dispensado NFC-e) | soma C170.VL_PIS (NÃO usar `vPIS` do XML de terceiro nas entradas — ótica do declarante) |
| 27 | VL_COFINS | COFINS total | N | - | 02 | N (dispensado NFC-e) | soma C170.VL_COFINS |
| 28 | VL_PIS_ST | PIS retido por ST | N | - | 02 | N (dispensado NFC-e) | soma `PISST/vPIS` |
| 29 | VL_COFINS_ST | COFINS retida por ST | N | - | 02 | N (dispensado NFC-e) | soma `COFINSST/vCOFINS` |

IND_FRT — tabelas por período:
- até 31/12/2011: 0 terceiros; 1 emitente; 2 destinatário; 9 sem frete.
- 01/01/2012 a 30/09/2017: 0 emitente; 1 destinatário/remetente; 2 terceiros; 9 sem frete.
- a partir 01/10/2017 (alinhado NF-e 4.0): 0 remetente (CIF); 1 destinatário (FOB); 2 terceiros; 3 transporte próprio
  remetente; 4 transporte próprio destinatário; 9 sem ocorrência de transporte. ⇒ **mapeamento direto de `modFrete`**.
- Remessas simbólicas, faturamento simbólico, transporte próprio, venda balcão ⇒ "9". Mais de um responsável ⇒ o do 1º percurso.

Regras de validação/preenchimento C100:
- IND_OPER [0,1]. Documento de entrada pode ser de terceiros ou emissão própria (ex.: NF de entrada própria de devolução).
- IND_EMIT [0,1]. Própria = emitido pelo CNPJ do C010. Se estado obriga escriturar NF avulsa em saída ⇒ IND_EMIT=0.
  **IND_EMIT=1 ⇒ IND_OPER=0** (documento de terceiro só pode ser entrada).
- COD_PART deve existir no 0150.
- COD_MOD válidos: [01, 1B, 04, 55, 65] (código ≠ modelo: "01" serve para "1" e "1A").
- COD_SIT válidos: [00,01,02,03,04,05,06,07,08] (Tabela 4.1.2). "04" (denegado) e "05" (inutilizado) só para NF-e de
  emissão própria. NF-e avulsa UF séries 890–899 ⇒ terceiros com COD_SIT 08.
  - Tabela 4.1.2 (referência): 00 regular; 01 extemporâneo regular; 02 cancelado; 03 cancelado extemporâneo;
    04 NF-e/CT-e denegado; 05 numeração inutilizada; 06 complementar; 07 complementar extemporâneo;
    08 regime especial/norma específica.
  - Mapeamento XML: `cStat` 100/150 ⇒ 00 (ou 06 se `ide/finNFe`=2 complementar); evento de cancelamento 110111 /
    cStat 101/151/135 ⇒ 02; cStat 110/301/302/303 (denegada) ⇒ 04; inutilização (retInutNFe cStat 102) ⇒ 05.
- SER: obrigatório 3 posições para 55 (própria ou terceiros) e 65 própria; "000" se inexistente.
- NUM_DOC > 0.
- CHV_NFE: DV conferido; obrigatório para 55/65 com IND_EMIT=0; para 55 terceiros obrigatório a partir de 04/2012
  (até 03/2012 opcional). Para emissão própria o PVA compara: CNPJ da chave = CNPJ do C010; número da chave = NUM_DOC;
  UF da chave = UF do 0000. Entradas de terceiros: confere DV e NUM_DOC vs chave.
- DT_DOC ou DT_E_S deve estar dentro do período do 0000 (campos 06/07). DT_E_S ≥ DT_DOC. DT_E_S obrigatório nas
  entradas; nas saídas só se o contribuinte tiver o dado.
- VL_MERC = Σ C170.VL_ITEM (mesma regra EFD ICMS/IPI).
- IND_PGTO: tipo pactuado, independentemente de quando ocorrer o pagamento.
- VL_DESC: desconto incondicional discriminado na nota.
- Campo 22 VL_ICMS: ICMS creditado (entrada) ou debitado (saída). Campo 24: ICMS-ST creditado/debitado.
- Campos 26–29: totais de PIS/COFINS (débito ou crédito) e PIS/COFINS-ST do documento.

Frete (campo 18) e CST — orientação importante:
- Frete cobrado do adquirente e integrante da venda compõe receita bruta (Lei 12.973/2014) e **segue o CST do produto
  transportado**: básica→básica; alíquota zero→zero; monofásico→monofásico; suspensão/isenção/NI→idem.
- Quando o frete é suportado pelo adquirente ⇒ somar o valor à BC de PIS/COFINS no C170 (ou escriturar a receita em F100
  seguindo a mesma regra de CST).
- Frete na venda suportado pelo vendedor ⇒ hipótese de crédito (art. 3º Leis 10.637/2002 e 10.833/2003) — no não cumulativo.

### Substituição tributária PIS/COFINS — orientações ao fabricante (C100/C170 ou C180)
1. **Cigarros/cigarrilhas**: recolhimento único, alíquotas básicas do cumulativo (0,65% e 3%). Fabricante pode usar CST 01
   ou 05; RFB identifica por NCM+CFOP.
2. **Motocicletas/máquinas agrícolas** (art. 43 MP 2.158-35/2001): dois recolhimentos (contribuinte + substituto).
   Por documento: 2 C170 — um CST 01 (contribuinte) e outro para a ST com **VL_ITEM = 0** (evita duplicar receita),
   preenchendo BC, alíquota e valor. Consolidado: 2 C181/C185 idem, com VL_ITEM (campo 04) = 0 no da ST.
3. **Monofásicos vendidos à ZFM** (arts. 64/65 Lei 11.196/2005): contribuinte CST 06 (alíquota zero) + substituto CST 05;
   mesma técnica (C170 da ST com VL_ITEM = 0; ou C181/C185 com VL_ITEM = 0).
4. **Revenda de bens sujeitos à ST de PIS/COFINS** (Decreto 4.524/2002 art. 37 — varejista de cigarros): escriturar
   - VL_ITEM / receita = valor da revenda;
   - CST PIS/COFINS = **05**;
   - BC = **0,00**;
   - Alíquota = **0,65** (PIS) e **3,00** (COFINS);
   - Valor PIS/COFINS = **0,00**.
   (Até PVA 2.0.4a usava-se alíquota zero; desde 2.0.5 usa-se as alíquotas acima; uso de alíquota zero descontinuado.)
   ⇒ Para o validador: **CST 05 na revenda ⇒ VL_BC=0 e VL=0** (não gera M400/M800 em versões novas).

### Esclarecimentos: vendas canceladas, retorno, devoluções
**I – Vendas canceladas, retorno de mercadorias e devolução de vendas (escrituração por C100):**
1. Cancelamento no **mesmo mês** da emissão: opção de não relacionar o documento, ou relacioná-lo só com C100 (COD_SIT 02)
   **sem C170**.
2. Cancelamento em **período posterior**: reduzir BC no mês do cancelamento via ajuste. Até 12/2018: M220/M620 (ajuste de
   redução de débito). A partir de **01/2019**: preferencialmente M210 campo 06 (VL_AJUS_REDUC_BC_PIS) / M610 campo 06,
   detalhando em M215/M615 com COD_AJ_BC = **01** (Vendas canceladas de receitas tributadas em períodos anteriores — tab. 4.3.18).
- **Retorno de mercadoria** (art. 234 RIPI/2010; Conv. SINIEF s/n 1970) = tratamento de **cancelamento de venda** (não
  integra BC nem créditos). A NF de entrada própria do retorno pode ser listada em C190 ou C100 só para transparência,
  com **CST 98 ou 99**.
- Venda cancelada = exclusão de BC (em C170 ou C181/C185), nos dois regimes.
- **Devolução de venda**:
  - Não cumulativo: é **hipótese de crédito** ⇒ escriturar com CFOP de devolução (1201/1202/2201/2202/1410/1411...) em C170
    (CST 50–56, tipicamente) ou em C191/C195 (consolidado).
  - Cumulativo: é **exclusão de BC**. Se a venda foi tributada:
    1. Usando C180: não incluir a receita na BC do C181/C185.
    2. Usando C100: incluir a NF de saída com **BC zerada** e informar em C110 o retorno (conforme verso/DANFE).
    3. Se não der no bloco C: ajuste no bloco M (M220/M620 com NUM_DOC e DESCR_AJ; a partir 01/2019 preferencialmente
       M210/M610 campo 06 + M215/M615 COD_AJ_BC = **02** — Devoluções de vendas tributadas em períodos anteriores).
    - A NF de devolução no cumulativo pode ser informada em C190/C100 por transparência com **CST 98 ou 99** (não gera crédito).

**II – Devolução de compras:**
- Escriturar no mês da devolução; crédito a estornar preferencialmente via **ajuste na BC da compra** (C100/C170 ou C190 e filhos).
- Se não for possível no bloco C (ex.: devolução em período posterior): ajuste no bloco M — campo 10 de M100/M500 e
  detalhamento em M110/M510 (ajuste de redução de crédito), com NUM_DOC e DESCR_AJ.
- A NF de devolução de compra é saída ⇒ **CST 49**.

---

## C110 — Informação Complementar da NF (01, 1B, 04, 55)

Nível 4 · Ocorrência 1:N (filho de C100). Leiaute EFD ICMS/IPI.
Dados do campo "Informações Complementares" de interesse do fisco (forma de pagamento, local da prestação, suspensão etc.).
Não repetir COD_INF no mesmo documento.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C110" | C | 004 | - | S |
| 02 | COD_INF | Código da informação complementar (0450) | C | 006 | - | S |
| 03 | TXT_COMPL | Descrição complementar do código de referência | C | - | - | N |

Validação: COD_INF deve existir no **0450**. XML: `infAdic/infCpl` e `infAdic/obsCont`.
Uso típico: devolução de venda no cumulativo (C100 com BC zerada + C110 explicando o retorno).

---

## C111 — Processo Referenciado

Nível 4 · Ocorrência 1:N. Informar processo judicial/administrativo que autorize CST, BC ou alíquota diversa da legislação.
Ao informar C111, gerar também **1010** (ação judicial) ou **1020** (processo administrativo).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C111" | C | 004* | - | S |
| 02 | NUM_PROC | Identificação do processo ou ato concessório | C | 020 | - | S |
| 03 | IND_PROC | 1 Justiça Federal; 3 SRFB; 9 Outros | C | 001* | - | S |

Observações:
1. Decisão judicial só pode alterar BC/alíquota/CST na apuração se **transitada em julgado**.
2. M200/M600 devem bater com a DCTF (IN RFB 1.599/2015).
3. Decisão sem trânsito em julgado com suspensão de exigibilidade: apurar normalmente e informar a parcela suspensa no
   1010 campo 06 (DESC_DEC_JUD); a partir de 01/2020 detalhar também no **1011**.
   Ex. txt: `|1010|xxxxxxx-xx.2016.1.00.0000|TRF3|10|02|6912/01=R$10.000,00 e 5856/01=R$18.000,00|20032019|`
Validação: IND_PROC ∈ [1,3,9].

---

## C120 — Operações de Importação (01, 1B, 04, 55)

Nível 4 · Ocorrência 1:N. Usar quando C100.IND_OPER=0 e há C170 com CST de crédito (50–56) e CFOP iniciado em **3**.
Usar mesmo que o documento seja NF-e 55 escriturada em C100/C170. (C199 só quando a PJ usa o consolidado C190.)
Não repetir NUM_DOC_IMP + NUM_ACDRAW no mesmo documento.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | XML |
|---|---|---|---|---|---|---|---|
| 01 | REG | "C120" | C | 004 | - | S | |
| 02 | COD_DOC_IMP | 0 DI; 1 DSI; 2 DUIMP (a partir 01/2019) | C | 001* | - | S | tipo de `det/prod/DI` |
| 03 | NUM_DOC_IMP | Nº do documento de importação | C | 015 | - | S | `DI/nDI` |
| 04 | VL_PIS_IMP | PIS pago na importação (somatório se vários) | N | - | 02 | N | (fora do XML / DI; às vezes `vOutro`) |
| 05 | VL_COFINS_IMP | COFINS pago na importação | N | - | 02 | N | idem |
| 06 | NUM_ACDRAW | Nº ato concessório Drawback | C | 020 | - | N | `DI/adi/nDraw` |

Crédito de importação (Lei 10.865/2004, art. 15) só sobre contribuições **efetivamente pagas**.
Validação: COD_DOC_IMP ∈ [0,1,2].

---

## C170 — Itens do Documento (01, 1B, 04, 55)

Nível 4 · Ocorrência 1:N (filho de C100). Leiaute EFD ICMS/IPI. **Não usar para NFC-e 65** (usa C175).
Obrigatório para discriminar itens, inclusive entradas com NF-e de terceiros. NUM_ITEM não pode repetir no documento.

IMPORTANTE (entradas): campos de BC, alíquota e valor de PIS/COFINS só se o adquirente tiver **direito ao crédito**
(ótica do declarante). Documentos sem direito a crédito **não precisam** ser relacionados. Se a NF tiver itens com e sem
direito, informar a nota **integralmente** (itens sem crédito com CST 70–75/98/99, sem BC/valor).

Não relacionar em C170 (têm registros próprios):
- Ativo imobilizado com crédito sobre depreciação (**F120**) ou valor de aquisição (**F130**). Se ainda assim listar em C170
  ⇒ CST_PIS/CST_COFINS = **98 ou 99**.
- Energia elétrica (06 ou 55) ⇒ C500 (aquisição) / C600 (fornecimento).
- Transporte (07, 08, 8B, 09, 10, 11, 26, 27, 57) ⇒ D100 / D200.
- Transporte de passageiros (2E, 13, 14, 15, 16, 18) ⇒ D300/D350.
- Comunicação/telecom (21, 22) ⇒ D500 / D600.
- Água/gás (28, 29) ⇒ C500 / C600.
- Cupom fiscal (02, 2D, 59) ⇒ C400/C490 (ECF) — (CF-e SAT: C800/C860).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | XML (`det[n]`) |
|---|---|---|---|---|---|---|---|
| 01 | REG | "C170" | C | 004 | - | S | |
| 02 | NUM_ITEM | Nº sequencial do item | N | 003 | - | S | `det/@nItem` |
| 03 | COD_ITEM | Código do item (0200) — **código do informante** | C | 060 | - | S | saída: `prod/cProd`; entrada: de-para fornecedor→código interno |
| 04 | DESCR_COMPL | Descrição complementar | C | - | - | N | `prod/xProd` / `infAdProd` |
| 05 | QTD | Quantidade | N | - | 05 | N | `prod/qCom` (>0) |
| 06 | UNID | Unidade (0190) | C | 006 | - | N | `prod/uCom` |
| 07 | VL_ITEM | Valor total do item (qtd × unitário) | N | - | 02 | S | `prod/vProd` |
| 08 | VL_DESC | Desconto comercial / exclusão da BC PIS/COFINS | N | - | 02 | N | `prod/vDesc` (+ ICMS excluído, se optar por aqui — ver Seção 12) |
| 09 | IND_MOV | Movimentação física: 0 Sim; 1 Não | C | 001 | - | N | 1 p/ complementar, simples faturamento, remessa simbólica |
| 10 | CST_ICMS | CST ICMS (tab 4.3.1) | N | 003* | - | N | `ICMS*/orig` + `CST` (ou CSOSN) |
| 11 | CFOP | CFOP | N | 004* | - | S | `prod/CFOP` (entrada: CFOP de entrada do informante, não o do emitente) |
| 12 | COD_NAT | Natureza da operação (0400) | C | 010 | - | N | `ide/natOp` |
| 13 | VL_BC_ICMS | BC ICMS | N | - | 02 | N | `ICMS*/vBC` |
| 14 | ALIQ_ICMS | Alíquota ICMS | N | 006 | 02 | N | `ICMS*/pICMS` |
| 15 | VL_ICMS | ICMS creditado/debitado | N | - | 02 | N | `ICMS*/vICMS` |
| 16 | VL_BC_ICMS_ST | BC ICMS-ST | N | - | 02 | N | `ICMS*/vBCST` |
| 17 | ALIQ_ST | Alíquota ICMS-ST UF destino | N | 006 | 02 | N | `ICMS*/pICMSST` |
| 18 | VL_ICMS_ST | ICMS-ST | N | - | 02 | N | `ICMS*/vICMSST` |
| 19 | IND_APUR | Período apuração IPI: 0 mensal; 1 decendial | C | 001* | - | N | |
| 20 | CST_IPI | CST IPI (tab 4.3.2) — só se contribuinte do IPI | C | 002* | - | N | `IPI/IPITrib/CST` |
| 21 | COD_ENQ | Enquadramento IPI (tab 4.5.3) | C | 003* | - | N | `IPI/cEnq` |
| 22 | VL_BC_IPI | BC IPI | N | - | 02 | N | `IPITrib/vBC` |
| 23 | ALIQ_IPI | Alíquota IPI (vazio se IPI por unidade) | N | 006 | 02 | N | `IPITrib/pIPI` |
| 24 | VL_IPI | IPI | N | - | 02 | N | `IPITrib/vIPI` |
| 25 | CST_PIS | CST PIS | N | 002* | - | S | saída: `PIS/*/CST`; entrada: CST de **entrada** do informante (50–99) |
| 26 | VL_BC_PIS | BC PIS (valor) | N | - | 02 | N | `PISAliq/vBC` (saída) / calculado (entrada) |
| 27 | ALIQ_PIS | Alíquota PIS (%) | N | 008 | 04 | N | `PISAliq/pPIS` |
| 28 | QUANT_BC_PIS | BC PIS em quantidade | N | - | 03 | N | `PISQtde/qBCProd` |
| 29 | ALIQ_PIS_QUANT | Alíquota PIS em reais | N | - | 04 | N | `PISQtde/vAliqProd` |
| 30 | VL_PIS | Valor PIS | N | - | 02 | N | `PIS*/vPIS` |
| 31 | CST_COFINS | CST COFINS | N | 002* | - | S | `COFINS/*/CST` |
| 32 | VL_BC_COFINS | BC COFINS | N | - | 02 | N | `COFINSAliq/vBC` |
| 33 | ALIQ_COFINS | Alíquota COFINS (%) | N | 008 | 04 | N | `COFINSAliq/pCOFINS` |
| 34 | QUANT_BC_COFINS | BC COFINS em quantidade | N | - | 03 | N | `COFINSQtde/qBCProd` |
| 35 | ALIQ_COFINS_QUANT | Alíquota COFINS em reais | N | - | 04 | N | `COFINSQtde/vAliqProd` |
| 36 | VL_COFINS | Valor COFINS | N | - | 02 | N | `COFINS*/vCOFINS` |
| 37 | COD_CTA | Conta contábil analítica | C | 255 | - | N* | plano de contas (0500) |

Regras C170:
- NUM_ITEM > 0 e sequencial.
- COD_ITEM deve existir no 0200; ótica do informante (nas entradas, código próprio, não o do fornecedor).
- QTD > 0. UNID deve existir no 0190.
- VL_ITEM = somente mercadoria (qtd × preço). Σ VL_ITEM = C100.VL_MERC.
- VL_DESC = descontos incondicionais do documento + demais exclusões de BC do item sem campo específico (ver Seções 11 e 12
  do guia — decisões judiciais e exclusão do ICMS da BC).
- IND_MOV = 1 quando não houver movimentação (complementar, simples faturamento, remessa simbólica).
- CFOP: entradas ⇒ código de acordo com a destinação do item. Deve existir na tabela CFOP (Ajuste SINIEF 07/01).
  **IND_OPER=0 ⇒ CFOP inicia 1, 2 ou 3; IND_OPER=1 ⇒ CFOP inicia 5, 6 ou 7. Primeiro dígito igual em todos os itens do documento.**
- M105/M505 (BC de crédito) consideram apenas itens com **CST 50–66** e CFOP de: aquisição p/ revenda; aquisição de insumo
  (bem ou serviço); devolução de vendas no não cumulativo; outras operações com direito a crédito. Lista na tabela
  "CFOP – Operações Geradoras de Crédito" do Portal SPED. ⇒ **o validador deve cruzar CST crédito × tabela CFOP-crédito**.
- COD_NAT deve existir no 0400.
- ALIQ_ICMS > 0 nas saídas se CST_ICMS termina em 00, 10, 20 ou 70.
- IND_APUR ∈ [0,1]. CST_IPI só se declarante for contribuinte do IPI (IN RFB 1009/2010). ALIQ_IPI vazia se IPI específico.
- VL_IPI totaliza para C190 (EFD ICMS) por CST_ICMS+CFOP+ALIQ_ICMS e é comparado com C100.
- CST_PIS/CST_COFINS: Tabelas II/III do Anexo Único da IN RFB 1.009/2010 (4.3.3 / 4.3.4).
- VL_BC_PIS (26): BC do item, para contribuição ou crédito. Recuperado em M210.VL_BC_CONT (débito) ou M105.VL_BC_PIS_TOT (crédito).
  Bebidas frias (fabricante/atacadista, a partir 05/2015): somar o frete à BC.
- QUANT_BC_* (28/34): apuração por unidade de medida (combustíveis, bebidas frias). Se preencher em quantidade ⇒
  **não** preencher VL_BC/ALIQ percentuais (e vice-versa). Recuperado em M210/M105 (QUANT_BC_*).
- VL_PIS (30) / VL_COFINS (36): **não** são recuperados no bloco M (o M recalcula BC totalizada × alíquota).
  Validação: VL_PIS = BC × alíquota (campo 26×27/100 ou 28×29). Idem COFINS (32×33/100 ou 34×35).
- COD_CTA: opcional até 10/2017; **obrigatório a partir de 11/2017**, exceto PJ dispensada de ECD (ex.: lucro presumido
  com livro caixa – art. 45 Lei 8.981/95). Pode ser conta sintética. Ver 0500.

---

## C175 — Registro Analítico do Documento (NFC-e, código 65)

Nível 4 · Ocorrência 1:N (filho de C100 com COD_MOD=65). Disponível no PVA 2.09, para fatos geradores a partir de **09/2014**.
NFC-e anteriores (até 08/2014) ⇒ consolidar em C180.

Totaliza os itens da NFC-e por **CFOP + CST PIS + CST COFINS + ALIQ PIS + ALIQ COFINS** (similar ao C190 da EFD ICMS/IPI).
O documento é individualizado no C100, mas os itens **não** vão em C170: vão agregados em C175.

Exemplo: NFC-e com 18 itens CST 01 + 30 itens CST 06 + 5 itens CST 05 + 30 itens CST 04 ⇒ 1 C100 + 4 C175.

Unicidade: não repetir combinação CFOP + CST (PIS e COFINS) + alíquotas (PIS e COFINS) no mesmo C100.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | XML NFC-e (agregação de `det`) |
|---|---|---|---|---|---|---|---|
| 01 | REG | "C175" | C | 004* | - | S | |
| 02 | CFOP | CFOP | N | 004* | - | S | `prod/CFOP` (só 5xxx) |
| 03 | VL_OPR | Σ valor das mercadorias da combinação | N | - | 02 | S | Σ `prod/vProd` |
| 04 | VL_DESC | Desconto comercial / exclusões de BC | N | - | 02 | N | Σ `prod/vDesc` (+ exclusões) |
| 05 | CST_PIS | CST PIS (tab 4.3.3) | N | 002* | - | N (na prática sempre preencher) | `PIS/*/CST` |
| 06 | VL_BC_PIS | BC PIS (valor) | N | - | 02 | N | Σ `PISAliq/vBC` |
| 07 | ALIQ_PIS | Alíquota PIS (%) | N | 008 | 04 | N | `pPIS` |
| 08 | QUANT_BC_PIS | BC PIS em quantidade | N | - | 03 | N | Σ `qBCProd` |
| 09 | ALIQ_PIS_QUANT | Alíquota PIS (R$) | N | - | 04 | N | `vAliqProd` |
| 10 | VL_PIS | Valor PIS | N | - | 02 | N | Σ `vPIS` (validar BC×alíq/100) |
| 11 | CST_COFINS | CST COFINS (tab 4.3.4) | N | 002* | - | S | `COFINS/*/CST` |
| 12 | VL_BC_COFINS | BC COFINS | N | - | 02 | N | Σ `COFINSAliq/vBC` |
| 13 | ALIQ_COFINS | Alíquota COFINS (%) | N | 008 | 04 | N | `pCOFINS` |
| 14 | QUANT_BC_COFINS | BC COFINS em quantidade | N | - | 03 | N | |
| 15 | ALIQ_COFINS_QUANT | Alíquota COFINS (R$) | N | - | 04 | N | |
| 16 | VL_COFINS | Valor COFINS | N | - | 02 | N | Σ `vCOFINS` |
| 17 | COD_CTA | Conta contábil | C | 255 | - | N* | |
| 18 | INFO_COMPL | Informação complementar | C | - | - | N | |

(O guia refere-se ao INFO_COMPL como "Campo 19" nas orientações — erro de numeração; o leiaute tem 18 campos.)

Regras C175:
- CFOP deve existir na tabela; não consolidar operações que não sejam receita de venda (ex.: transferências).
  **Na NFC-e só CFOP iniciado em 5** (regra EFD-Contribuições e EFD ICMS/IPI).
- CST válidos (saída) para PIS e COFINS: **01, 02, 03, 04, 05, 06, 07, 08, 09, 49, 99**.
  - 01 tributável alíquota básica; 02 alíquota diferenciada; 03 alíquota por unidade de medida; **04 monofásica – revenda
    a alíquota zero**; **05 substituição tributária**; **06 alíquota zero**; 07 isenta; 08 sem incidência; 09 suspensão;
    49 outras saídas; 99 outras operações.
- VL_BC_PIS/COFINS recuperados em M210/M610 (VL_BC_CONT). QUANT_BC_* recuperados em M210/M610 (QUANT_BC_*).
  Preencher quantidade dispensa BC valor.
- VL_PIS = VL_BC_PIS × ALIQ_PIS / 100 (ou QUANT_BC × ALIQ_QUANT). Ex.: 1.000.000,00 × 1,65 / 100 = 16.500,00.
  VL_COFINS = VL_BC_COFINS × ALIQ_COFINS / 100. Ex.: 1.000.000,00 × 7,6 / 100 = 76.000,00.
  VL_PIS/VL_COFINS **não** são recuperados no M (M recalcula).
- COD_CTA: obrigatório a partir 11/2017, salvo dispensados de ECD. Ex.: conta de receitas tributadas / não tributadas.

---

## C180 — Consolidação de NF-e/NFC-e emitidas (55 e 65) – Operações de VENDAS

Nível 3 · Ocorrência 1:N (filho de C010).

Consolida as **vendas** por **item vendido (0200)** emitidas por NF-e (55) e NFC-e (65). Dispensa C100/filhos das vendas.
Filhos: **C181 (PIS)**, **C185 (COFINS)**, **C188 (processo)**. Segregação nos filhos por CST + CFOP + alíquotas.

Regras NFC-e (65) no C180:
- Só pode consolidar NFC-e em C180 se o arquivo **ultrapassar 1 GB** caso as NFC-e fossem escrituradas individualmente
  em C100/C175. Além disso, todos os estabelecimentos emissores de NFC-e devem estar obrigados à escrituração
  individualizada na EFD ICMS/IPI.
- Excepcionalidade: fatos geradores **até 08/2014** ⇒ NFC-e obrigatoriamente em C180, com COD_MOD = "55" (o campo só
  validava 55) e identificação da receita NFC-e via código de item próprio no 0200.

IMPORTANTE:
1. C180 dispensa C100/filhos das vendas por NF-e do período.
2. **Não incluir** na consolidação: NF-e canceladas, denegadas, numeração inutilizada, transferências entre
   estabelecimentos, etc. (documentos que não representem receita auferida).
   **Incluir** as NF de venda emitidas no período que sejam objeto de devolução (devolução é tratada à parte: crédito
   no não cumulativo — art. 3º VIII Leis 10.637/10.833 — ou exclusão de BC no cumulativo — Lei 9.718/98).
3. Não relacionar: energia elétrica (C600), transporte (D200), passageiros (D300/D350), comunicação (D600), água/gás (C600),
   cupom fiscal 02/2D/59 (C400/C490).
4. Mudança de alíquota/CST/CFOP no mês ⇒ pode gerar um C180 para cada subperíodo (ex.: Decreto 7.455/2011 bebidas: 01–03/04 e 04–30/04).
5. Bebidas frias (a partir 05/2015): NT 005/2015.
6. Mesmas orientações de ST para fabricante descritas no C100 (C181/C185 da ST com **VL_ITEM = 0**).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | XML |
|---|---|---|---|---|---|---|---|
| 01 | REG | "C180" | C | 004* | - | S | |
| 02 | COD_MOD | "55" ou "65" | C | 002* | - | S | `ide/mod` |
| 03 | DT_DOC_INI | Data de emissão inicial dos documentos | N | 008* | - | S | min(`dhEmi`) |
| 04 | DT_DOC_FIN | Data de emissão final | N | 008* | - | S | max(`dhEmi`) |
| 05 | COD_ITEM | Código do item (0200) | C | 060 | - | S | `prod/cProd` |
| 06 | COD_NCM | NCM | C | 008* | - | N* | `prod/NCM` |
| 07 | EX_IPI | Código EX TIPI | C | 003 | - | N | `prod/EXTIPI` |
| 08 | VL_TOT_ITEM | Valor total do item (documentos consolidados) | N | - | 02 | S | Σ `prod/vProd` |

Validações/preenchimento:
- COD_MOD ∈ [55, 65]; COD_ITEM deve existir no 0200.
- NCM: determinante para validar incidência (cruza com CST/CFOP/BC/alíquota do C181/C185). Obrigatório para: indústrias
  e equiparadas; agroindústria (crédito presumido); exportadores/importadores; atacadistas/indústrias com vendas a alíquota
  zero/suspensão/isenção/NI vinculadas a NCM. **A partir do PVA 2.1.1 (08/2017) NCM é obrigatório**; para serviços usar "00".
  ⇒ Para farmácias (monofásicos por NCM — Lei 10.147/2000) **sempre preencher NCM**.
- VL_TOT_ITEM = valor total das NF-e consolidadas para o item.

Canceladas/retorno/devoluções: mesmas regras do C100 (ver acima). No C180, venda cancelada ⇒ não entra (ou é excluída)
no C181/C185; devolução no cumulativo ⇒ não incluir a receita na BC do C181/C185.

---

## C181 — Detalhamento da consolidação – Vendas – PIS/Pasep

Nível 4 · Ocorrência 1:N (filho de C180). Obrigatório. Um C181 para cada combinação **CST + CFOP + alíquota** do item no período.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | XML |
|---|---|---|---|---|---|---|---|
| 01 | REG | "C181" | C | 004* | - | S | |
| 02 | CST_PIS | CST PIS (4.3.3) | N | 002* | - | S | `PIS/*/CST` |
| 03 | CFOP | CFOP | N | 004* | - | S | `prod/CFOP` |
| 04 | VL_ITEM | Valor do item | N | - | 02 | S | Σ `vProd` |
| 05 | VL_DESC | Desconto comercial / exclusão da BC | N | - | 02 | N | Σ `vDesc` (+ exclusões) |
| 06 | VL_BC_PIS | BC PIS | N | - | 02 | N | Σ `PISAliq/vBC` |
| 07 | ALIQ_PIS | Alíquota PIS (%) | N | 008 | 04 | N | `pPIS` |
| 08 | QUANT_BC_PIS | BC em quantidade | N | - | 03 | N | Σ `qBCProd` |
| 09 | ALIQ_PIS_QUANT | Alíquota em reais | N | - | 04 | N | `vAliqProd` |
| 10 | VL_PIS | Valor PIS | N | - | 02 | N | Σ `vPIS` |
| 11 | COD_CTA | Conta contábil | C | 255 | - | N* | |

- CST válidos: 01, 02, 03, 04, 05, 06, 07, 08, 09, 49, 99.
- CFOP: tabela SINIEF 07/01; **não** consolidar operações que não sejam receita de venda (ex.: transferências 5151/5152/6151/6152...).
- VL_DESC: desconto comercial ou valores a excluir da BC (ver Seções 11/12 — decisões judiciais / exclusão do ICMS).
- VL_BC_PIS → M210.VL_BC_CONT. Bebidas frias: somar frete. QUANT_BC_PIS → M210.QUANT_BC_PIS (dispensa BC valor).
- VL_PIS = BC × ALIQ / 100 (ou QUANT × ALIQ_QUANT). Não recuperado no M.
- COD_CTA obrigatório a partir 11/2017 (exceto dispensados de ECD).

## C185 — Detalhamento da consolidação – Vendas – COFINS

Nível 4 · Ocorrência 1:N (filho de C180). Idêntico ao C181 trocando PIS→COFINS.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C185" | C | 004* | - | S |
| 02 | CST_COFINS | CST COFINS (4.3.4) | N | 002* | - | S |
| 03 | CFOP | CFOP | N | 004* | - | S |
| 04 | VL_ITEM | Valor do item | N | - | 02 | S |
| 05 | VL_DESC | Desconto / exclusão BC | N | - | 02 | N |
| 06 | VL_BC_COFINS | BC COFINS | N | - | 02 | N |
| 07 | ALIQ_COFINS | Alíquota (%) | N | 008 | 04 | N |
| 08 | QUANT_BC_COFINS | BC quantidade | N | - | 03 | N |
| 09 | ALIQ_COFINS_QUANT | Alíquota (R$) | N | - | 04 | N |
| 10 | VL_COFINS | Valor COFINS | N | - | 02 | N |
| 11 | COD_CTA | Conta contábil | C | 255 | - | N* |

Mesmas regras (CST de saída 01–09/49/99; VL_BC → M610.VL_BC_CONT; QUANT → M610.QUANT_BC_COFINS; VL = BC×alíq/100).
Ex.: 1.000.000,00 × 7,6 / 100 = 76.000,00.

## C188 — Processo Referenciado (filho de C180)

Nível 4 · 1:N. Mesmo leiaute e observações do C111 (gera 1010/1020; decisão judicial só com trânsito em julgado; 1011 a partir 01/2020).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C188" | C | 004* | - | S |
| 02 | NUM_PROC | Identificação do processo/ato concessório | C | 020 | - | S |
| 03 | IND_PROC | 1 Justiça Federal; 3 SRFB; 9 Outros | C | 001* | - | S |

---

## C190 — Consolidação de NF-e (55) – AQUISIÇÕES com direito a crédito e DEVOLUÇÕES de compras e vendas

Nível 3 · Ocorrência 1:N (filho de C010). Filhos: **C191 (PIS)**, **C195 (COFINS)**, **C198 (processo)**, **C199 (importação)**.
Consolida por **item (0200)**; filhos segregam por **fornecedor (CNPJ/CPF) + CST + CFOP + alíquota**.

IMPORTANTE:
1. Dispensa C100/filhos das aquisições do período.
2. **Não incluir**: documentos sem direito a crédito (que não sejam devoluções), NF-e canceladas, denegadas, inutilizadas,
   transferências entre estabelecimentos.
3. Não relacionar: ativo imobilizado (F120/F130 — se relacionar, CST 98/99 em C191/C195); energia elétrica (C500);
   transporte (D100); passageiros (D300/D350); comunicação (D500); água/gás (C500); cupom fiscal (C400/C490).
- **Incluir** devoluções de compras que geraram crédito na aquisição: escriturar no mês da devolução; estorno do crédito
  como "Ajuste de Redução" no campo 10 de M100/M500 + M110/M510 (ou, preferencialmente, redução da BC da compra no próprio
  C190 — ver "Devolução de compras").

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | XML |
|---|---|---|---|---|---|---|---|
| 01 | REG | "C190" | C | 004* | - | S | |
| 02 | COD_MOD | "55" | C | 002* | - | S | `ide/mod` |
| 03 | DT_REF_INI | Data inicial (emissão mais antiga) | N | 008* | - | S | min(`dhEmi`) |
| 04 | DT_REF_FIN | Data final (emissão mais recente) | N | 008* | - | S | max(`dhEmi`) |
| 05 | COD_ITEM | Código do item (0200) — **código do informante** | C | 060 | - | S | de-para `cProd` fornecedor → item interno |
| 06 | COD_NCM | NCM | C | 008* | - | N* | `prod/NCM` |
| 07 | EX_IPI | Código EX TIPI | C | 003 | - | N | `prod/EXTIPI` |
| 08 | VL_TOT_ITEM | Valor total do item | N | - | 02 | S | Σ `vProd` |

Validações: COD_MOD = 55 (**NFC-e 65 não entra no C190**; aquisição por NFC-e/cupom com crédito ⇒ C395/C396).
COD_ITEM no 0200 (ótica do informante). NCM obrigatório desde PVA 2.1.1 ("00" para serviços).

Esclarecimentos específicos do C190:
- Retorno de mercadoria = cancelamento de venda. **Nesta seção o guia diz que a NF de entrada própria do retorno NÃO deve
  ser relacionada em C190/C100** (não é hipótese de crédito) — contradiz a orientação no C100/C180 ("pode, com CST 98/99,
  para transparência"). ⇒ Implementação segura: não gerar crédito; se listar, usar CST 98/99; preferir omitir no C190.
- Devolução de venda no não cumulativo = crédito (C170 ou C191/C195 com CFOP de devolução e CST 50–56).
- Devolução de venda no cumulativo = exclusão de BC (C180/C181/C185 ou C100 com BC zerada + C110; senão bloco M:
  M220/M620 ou, a partir 01/2019, M210/M610 campo 06 + M215/M615 COD_AJ_BC = 02). Pode ser listada em C190 por
  transparência com **CST 99** (nesta seção o guia cita só o 99; em C100 cita 98 ou 99).
- Devolução de compra: CST **49**; ajuste da BC da compra no C190/C100, ou bloco M (campo 10 M100/M500 + M110/M510).

---

## C191 — Detalhamento da consolidação – Aquisições com crédito e devoluções – PIS/Pasep

Nível 4 · Ocorrência 1:N (filho de C190). Obrigatório. Um registro por **fornecedor + CST + CFOP + alíquota** do item.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | XML |
|---|---|---|---|---|---|---|---|
| 01 | REG | "C191" | C | 004* | - | S | |
| 02 | CNPJ_CPF_PART | CNPJ/CPF do participante (fornecedor/remetente) | C | 014 | - | N (obrig. exceto estrangeiro sem CNPJ/CPF) | `emit/CNPJ` ou `emit/CPF` |
| 03 | CST_PIS | CST PIS (entrada) | N | 002* | - | S | definido pelo informante |
| 04 | CFOP | CFOP **de entrada** (1/2/3) | N | 004* | - | S | converter 5xxx/6xxx do emitente → 1xxx/2xxx |
| 05 | VL_ITEM | Valor do item | N | - | 02 | S | Σ `vProd` |
| 06 | VL_DESC | Desconto / exclusão (ex.: devoluções de compras do mês) | N | - | 02 | N | Σ `vDesc` |
| 07 | VL_BC_PIS | BC do crédito | N | - | 02 | N | calculado |
| 08 | ALIQ_PIS | Alíquota (%) | N | 008 | 04 | N | 1,65 (NC) |
| 09 | QUANT_BC_PIS | BC em quantidade | N | - | 03 | N | |
| 10 | ALIQ_PIS_QUANT | Alíquota (R$) | N | - | 04 | N | |
| 11 | VL_PIS | Valor do crédito | N | - | 02 | N | BC × alíq / 100 |
| 12 | COD_CTA | Conta contábil | C | 255 | - | N* | |

CST válidos (entrada — Tabela II IN RFB 1.009/2010):
- **Crédito (básico)**: 50 vinculada exclusivamente a receita tributada MI; 51 exclusivamente não tributada MI;
  52 exclusivamente exportação; 53 tributada e não tributada MI; 54 tributada MI e exportação;
  55 não tributada MI e exportação; 56 tributada e não tributada MI e exportação.
- **Crédito presumido**: 60–66 (mesma lógica de vinculação que 50–56).
- **Sem crédito**: 70 aquisição sem direito a crédito; 71 com isenção; 72 com suspensão; **73 alíquota zero**;
  74 sem incidência; **75 substituição tributária**; 98 outras entradas; 99 outras operações.
- Devolução de compra (com crédito na aquisição) ⇒ **CST 49**.

Regras:
- CNPJ_CPF_PART obrigatório exceto importação de estrangeiro sem cadastro (em branco).
- M105 (BC crédito) considera só CST **50–66** com CFOP da tabela "CFOP – Operações Geradoras de Créditos" (revenda,
  insumo bem/serviço, devolução de vendas NC, outras com crédito).
- CFOP: existir na tabela; não consolidar transferências; **ótica do informante — CFOP de entrada (1, 2, 3)**, não o CFOP
  de saída do documento.
- **CFOP-título proibidos**: 1000, 1100, 1150, 1200, 1250, 1300, 1350, 1400, 1450, 1500, 1550, 1600, 1900, 2000, 2100, 2150,
  2200, 2250, 2300, 2350, 2400, 2500, 2550, 2600, 2900, 3000, 3100, 3200, 3250, 3300, 3350, 3500, 3550, 3650, 3900, 5000,
  5100, 5150, 5200, 5250, 5300, 5350, 5400, 5450, 5500, 5550, 5600, 5650, 5900, 6000, 6100, 6150, 6200, 6250, 6300, 6350,
  6400, 6500, 6550, 6600, 6650, 6900, 7000, 7100, 7200, 7250, 7300, 7350, 7500, 7550, 7650, 7900.
- VL_DESC: pode conter devoluções de compras do mês do item (forma preferida de estorno).
- VL_BC_PIS → M105.VL_BC_PIS_TOT; QUANT_BC_PIS → M105.QUANT_BC_PIS_TOT (importação de combustíveis/bebidas frias e
  devoluções de vendas desses produtos).
- VL_PIS = BC × ALIQ / 100 — **não** recuperado no M (M100/M500 recalcula VL_CRED).
- COD_CTA: obrigatório desde 11/2017 (salvo dispensa de ECD). Ex.: aquisições para revenda, insumos, devoluções de vendas.

## C195 — Detalhamento da consolidação – Aquisições com crédito e devoluções – COFINS

Nível 4 · 1:N (filho de C190). Idêntico ao C191 com COFINS.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C195" | C | 004* | - | S |
| 02 | CNPJ_CPF_PART | CNPJ/CPF do participante | C | 014 | - | N (obrig. exceto estrangeiro) |
| 03 | CST_COFINS | CST COFINS | N | 002* | - | S |
| 04 | CFOP | CFOP de entrada | N | 004* | - | S |
| 05 | VL_ITEM | Valor do item | N | - | 02 | S |
| 06 | VL_DESC | Desconto / exclusão | N | - | 02 | N |
| 07 | VL_BC_COFINS | BC crédito | N | - | 02 | N |
| 08 | ALIQ_COFINS | Alíquota (%) | N | 008 | 04 | N |
| 09 | QUANT_BC_COFINS | BC quantidade | N | - | 03 | N |
| 10 | ALIQ_COFINS_QUANT | Alíquota (R$) | N | - | 04 | N |
| 11 | VL_COFINS | Crédito COFINS | N | - | 02 | N |
| 12 | COD_CTA | Conta contábil | C | 255 | - | N* |

VL_BC_COFINS → M505.VL_BC_COFINS_TOT; QUANT → M505.QUANT_BC_COFINS_TOT. Ex.: 1.000.000,00 × 7,6/100 = 76.000,00.

## C198 — Processo Referenciado (filho de C190)

Nível 4 · 1:N. Leiaute idêntico a C111/C188: REG "C198" (C 004* S); NUM_PROC (C 020 S); IND_PROC [1,3,9] (C 001* S).
Gera 1010/1020; mesmas observações.

## C199 — Complemento – Operações de Importação (código 55) (filho de C190)

Nível 4 · 1:N. Usar quando C191/C195 tiverem CST 50–56 e CFOP iniciado em **3** (importação), na escrituração consolidada.
(Na escrituração por documento, usar C120.)

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C199" | C | 004* | - | S |
| 02 | COD_DOC_IMP | 0 DI; 1 DSI; 2 DUIMP (a partir 01/2019) | C | 001* | - | S |
| 03 | NUM_DOC_IMP | Nº documento de importação | C | 015 | - | S |
| 04 | VL_PIS_IMP | PIS-Importação pago (somatório) | N | - | 02 | N |
| 05 | VL_COFINS_IMP | COFINS-Importação pago (somatório) | N | - | 02 | N |
| 06 | NUM_ACDRAW | Ato concessório Drawback | C | 020 | - | N |

Crédito só sobre contribuições efetivamente pagas (art. 15 Lei 10.865/2004).

---

## C380 — NF de Venda a Consumidor (código 02) – Consolidação de documentos emitidos

Nível 3 · 1:N. NF de venda a consumidor **não emitida por ECF** (mod. 02, talonário). Consolida o período.
Filhos C381 (PIS) e C385 (COFINS) por CST, item e alíquota. Cancelados **não** entram em VL_DOC nem nos filhos.
(Não se aplica a NFC-e 65.)

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C380" | C | 004* | - | S |
| 02 | COD_MOD | "02" | C | 002* | - | S |
| 03 | DT_DOC_INI | Data emissão inicial | N | 008* | - | S |
| 04 | DT_DOC_FIN | Data emissão final | N | 008* | - | S |
| 05 | NUM_DOC_INI | Nº documento inicial | N | 006 | - | N |
| 06 | NUM_DOC_FIN | Nº documento final | N | 006 | - | N |
| 07 | VL_DOC | Valor total dos documentos emitidos | N | - | 02 | S |
| 08 | VL_DOC_CANC | Valor total dos cancelados | N | - | 02 | S |

Validações: COD_MOD=02; NUM_DOC_INI > 0 e ≤ NUM_DOC_FIN; NUM_DOC_FIN > 0 e ≥ NUM_DOC_INI.

## C381 — Detalhamento da consolidação (C380) – PIS/Pasep

Nível 4 · 1:N. Um registro por **item (0200)** e por CST (e alíquota).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C381" | C | 004* | - | S |
| 02 | CST_PIS | CST PIS | N | 002* | - | S |
| 03 | COD_ITEM | Código do item (0200) | C | 060 | - | S |
| 04 | VL_ITEM | Valor total dos itens | N | - | 02 | S |
| 05 | VL_BC_PIS | BC PIS | N | - | 02 | N |
| 06 | ALIQ_PIS | Alíquota (%) | N | 008 | 04 | N |
| 07 | QUANT_BC_PIS | BC quantidade | N | - | 03 | N |
| 08 | ALIQ_PIS_QUANT | Alíquota (R$) | N | - | 04 | N |
| 09 | VL_PIS | Valor PIS | N | - | 02 | **S** |
| 10 | COD_CTA | Conta contábil | C | 255 | - | N* |

CST de saída 01–09, 49, 99. VL_BC_PIS → M210.VL_BC_CONT; QUANT → M210.QUANT_BC_PIS. VL_PIS = BC×alíq/100. Ver Seções 11/12
(exclusão do ICMS etc.).

## C385 — Detalhamento da consolidação (C380) – COFINS

Nível 4 · 1:N. Idêntico ao C381 (CST_COFINS, VL_BC_COFINS, ALIQ_COFINS (008,04), QUANT_BC_COFINS (03),
ALIQ_COFINS_QUANT (04), VL_COFINS (S), COD_CTA). VL_BC → M610.VL_BC_CONT; QUANT → M610.QUANT_BC_COFINS.
(O guia diz "Campo 01 – Valor Válido: [C381]" no C385 — erro de digitação; é "C385".)

---

## C395 — NF de Venda a Consumidor (02, 2D, 2E, 59, 60, 65) – AQUISIÇÕES/ENTRADAS com crédito

Nível 3 · 1:N. Para aquisições com direito a crédito (ex.: insumos) documentadas por NF a consumidor / cupom / CF-e SAT /
**NFC-e (65)** recebida pelo informante como adquirente. Filho C396 com os itens.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | XML NFC-e recebida |
|---|---|---|---|---|---|---|---|
| 01 | REG | "C395" | C | 004* | - | S | |
| 02 | COD_MOD | Modelo (4.1.1) | C | 002* | - | S | `ide/mod` = 65 |
| 03 | COD_PART | Participante emitente (0150) | C | 060 | - | N | `emit` |
| 04 | SER | Série ("000" se não houver) | C | 003 | - | S | `ide/serie` |
| 05 | SUB_SER | Subsérie | C | 003 | - | N | |
| 06 | NUM_DOC | Nº do documento (só dígitos) | C | 006 | - | S | `ide/nNF` (atenção: tamanho 6!) |
| 07 | DT_DOC | Data de emissão | N | 008* | - | S | `dhEmi` |
| 08 | VL_DOC | Valor total | N | - | 02 | S | `vNF` |

Validações: COD_MOD ∈ [02, 2D, 2E, 59, 60, 65]; COD_PART no 0150; NUM_DOC > 0 e só dígitos.

## C396 — Itens do documento (02, 2D, 2E, 59, 60, 65) – Aquisições/Entradas com crédito

Nível 4 · 1:N (filho de C395). Um registro por item do documento. **Único registro do Bloco C com NAT_BC_CRED.**

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | XML |
|---|---|---|---|---|---|---|---|
| 01 | REG | "C396" | C | 004* | - | S | |
| 02 | COD_ITEM | Código do item (0200) | C | 060 | - | S | de-para interno |
| 03 | VL_ITEM | Valor total do item | N | - | 02 | S | `prod/vProd` |
| 04 | VL_DESC | Desconto comercial do item / valores a excluir | N | - | 02 | N | `prod/vDesc` |
| 05 | NAT_BC_CRED | Natureza da BC do crédito (Tabela 4.3.7) | C | 002* | - | S | regra de negócio |
| 06 | CST_PIS | CST PIS | N | 002* | - | S | 50–66 (crédito) |
| 07 | VL_BC_PIS | BC do crédito PIS | N | - | 02 | N | |
| 08 | ALIQ_PIS | Alíquota PIS (%) | N | 008 | 04 | N | |
| 09 | VL_PIS | Crédito PIS | N | - | 02 | N | |
| 10 | CST_COFINS | CST COFINS | N | 002* | - | S | |
| 11 | VL_BC_COFINS | BC do crédito COFINS | N | - | 02 | N | |
| 12 | ALIQ_COFINS | Alíquota COFINS (%) | N | 008 | 04 | N | |
| 13 | VL_COFINS | Crédito COFINS | N | - | 02 | N | |
| 14 | COD_CTA | Conta contábil | C | 255 | - | N* | |

- VL_BC_PIS → M105.VL_BC_PIS_TOT; VL_BC_COFINS → M505.VL_BC_COFINS_TOT (itens com CST de crédito).
- VL_PIS/VL_COFINS não recuperados no M.
- Tabela 4.3.7 (NAT_BC_CRED — referência do leiaute, não transcrita neste trecho do guia): 01 aquisição de bens para revenda;
  02 bens utilizados como insumo; 03 serviços utilizados como insumo; 04 energia elétrica e térmica; 05 aluguéis de prédios;
  06 aluguéis de máquinas e equipamentos; 07 armazenagem e frete na venda; 08 contraprestações de arrendamento mercantil;
  09 máquinas/equipamentos/bens do imobilizado (crédito sobre depreciação); 10 idem (crédito sobre valor de aquisição);
  11 amortização/depreciação de edificações e benfeitorias; 12 devolução de vendas sujeitas à incidência não cumulativa;
  13 outras operações com direito a crédito; 14 transporte de cargas – subcontratação; 15 atividade imobiliária – custo
  incorrido; 16 atividade imobiliária – custo orçado; 17 serviços de limpeza/conservação/manutenção; 18 estoque de abertura.
  (Validar contra a tabela oficial vigente no Portal SPED.)

---

## Operações por ECF — C400 / C405 / C481 / C485 / C489 e C490 / C491 / C495 / C499

Cupom fiscal (02, 2D) por ECF: escolha entre **C400 (por equipamento, detalhado por Redução Z)** ou **C490 (consolidado)**.
Optando por C490, não precisa C400 e filhos. Se o arquivo tiver ambos ⇒ C010.IND_ESCRI.
(Não se aplica a NFC-e 65. Útil para lojas com legado ECF.)

### C400 — Equipamento ECF (02 e 2D)
Nível 3 · 1:N.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C400" | C | 004* | - | S |
| 02 | COD_MOD | 02 ou 2D | C | 002* | - | S |
| 03 | ECF_MOD | Modelo do equipamento | C | 020 | - | S |
| 04 | ECF_FAB | Nº de série de fabricação | C | 021 | - | S |
| 05 | ECF_CX | Nº do caixa atribuído ao ECF | N | 003 | - | S |

- ECF_CX não pode ser usado por dois ECF ao mesmo tempo (pode ser reatribuído após cessação).
- Unicidade: COD_MOD + ECF_MOD + ECF_FAB.

### C405 — Redução Z (02 e 2D)
Nível 4 · 1:N · Obrigatório se existir C400. Inclui vendas no período de tolerância do ECF.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C405" | C | 004* | - | S |
| 02 | DT_DOC | Data do movimento da Redução Z | N | 008* | - | S |
| 03 | CRO | Contador de Reinício de Operação | N | 003 | - | S |
| 04 | CRZ | Contador de Redução Z | N | 006 | - | S |
| 05 | NUM_COO_FIN | COO do último documento do dia | N | 006 | - | S |
| 06 | GT_FIN | Grande Total final | N | - | 02 | S |
| 07 | VL_BRT | Venda bruta | N | - | 02 | S |

Validações: DT_DOC ≤ DT_FIN do arquivo; CRO, CRZ, NUM_COO_FIN > 0; GT_FIN ≥ VL_BRT (salvo reinício de operação).

### C481 — Resumo diário ECF – PIS/Pasep
Nível **5** (filho de C405) · 1:N. Um registro por item (0200) e por CST.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C481" | C | 004* | - | S |
| 02 | CST_PIS | CST PIS | N | 002* | - | S |
| 03 | VL_ITEM | Valor total dos itens (> 0) | N | - | 02 | S |
| 04 | VL_BC_PIS | BC PIS | N | - | 02 | N |
| 05 | ALIQ_PIS | Alíquota (%) | N | 008 | 04 | N |
| 06 | QUANT_BC_PIS | BC quantidade | N | - | 03 | N |
| 07 | ALIQ_PIS_QUANT | Alíquota (R$) | N | - | 04 | N |
| 08 | VL_PIS | Valor PIS | N | - | 02 | N |
| 09 | COD_ITEM | Código do item (0200) | C | 060 | - | N |
| 10 | COD_CTA | Conta contábil | C | 255 | - | N* |

CST de saída 01–09/49/99; VL_BC → M210.VL_BC_CONT; QUANT → M210.QUANT_BC_PIS; VL_PIS = BC×alíq/100.

### C485 — Resumo diário ECF – COFINS
Nível 5 · 1:N. Idêntico ao C481 com COFINS (CST_COFINS, VL_ITEM>0, VL_BC_COFINS, ALIQ_COFINS 008/04, QUANT_BC_COFINS 03,
ALIQ_COFINS_QUANT 04, VL_COFINS, COD_ITEM, COD_CTA). VL_BC → M610.VL_BC_CONT.

### C489 — Processo Referenciado (ECF, filho de C400)
Nível 4 · 1:N. REG "C489"; NUM_PROC (C 020 S); IND_PROC [1,3,9] (C 001* S). Mesmas regras de C111.

### C490 — Consolidação de documentos emitidos por ECF (02, 2D, 59, 60)
Nível 3 · 1:N. Substitui C400. Filhos C491/C495 por item, CST e alíquota. **Aceita também 59 (CF-e SAT) e 60 (CF-e ECF)**.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C490" | C | 004* | - | S |
| 02 | DT_DOC_INI | Data emissão inicial | N | 008* | - | S |
| 03 | DT_DOC_FIN | Data emissão final | N | 008* | - | S |
| 04 | COD_MOD | 02, 2D, 59, 60 | C | 002* | - | S |

Validações: DT_DOC_INI e DT_DOC_FIN ≤ DT_FIN do 0000.

### C491 — Detalhamento consolidação ECF – PIS/Pasep
Nível 4 · 1:N. Um por item (0200) e CST.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C491" | C | 004* | - | S |
| 02 | COD_ITEM | Código do item (0200) | C | 060 | - | N |
| 03 | CST_PIS | CST PIS | N | 002* | - | S |
| 04 | CFOP | CFOP | N | 004* | - | N |
| 05 | VL_ITEM | Valor total dos itens (> 0) | N | - | 02 | S |
| 06 | VL_BC_PIS | BC PIS | N | - | 02 | N |
| 07 | ALIQ_PIS | Alíquota (%) | N | 008 | 04 | N |
| 08 | QUANT_BC_PIS | BC quantidade | N | - | 03 | N |
| 09 | ALIQ_PIS_QUANT | Alíquota (R$) | N | - | 04 | N |
| 10 | VL_PIS | Valor PIS | N | - | 02 | N |
| 11 | COD_CTA | Conta contábil | C | 255 | - | N* |

CST saída; CFOP da tabela, sem transferências; VL_BC → M210; VL_PIS = BC×alíq/100.

### C495 — Detalhamento consolidação ECF – COFINS
Nível 4 · 1:N. Idêntico ao C491 com COFINS.

### C499 — Processo Referenciado (filho de C490)
Nível 4 · 1:N. REG "C499"; NUM_PROC (C 020 S); IND_PROC [1,3,9] (C 001* S).

---

## Energia elétrica, água e gás — C500 / C501 / C505 / C509 (entradas) e C600 / C601 / C605 / C609 (saídas)

Para farmácia/varejo: **C500 é onde vai o crédito de energia elétrica** (inclusive quando a conta vier em NF-e 55 ou NF3e 66).
Nunca colocar NF-e de energia em C100/C170 nem em C190.

### C500 — NF/Conta de Energia (06), NF3e (66), Água (29), Gás (28) e NF-e (55) — Entrada/aquisição com crédito
Nível 3 · 1:N. Créditos: energia consumida nos estabelecimentos (art. 3º III Leis 10.637/10.833); água/gás usados como insumo
na fabricação ou prestação de serviços (art. 3º II).
- A partir de **01/01/2020**: COD_MOD 66 ou 55 ⇒ **CHV_DOCe obrigatório**.
- Unicidade: COD_PART + COD_MOD + COD_SIT + SER + SUB + NUM_DOC + DT_DOC (+ CHV_DOCe a partir 01/01/2020).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C500" | C | 004* | - | S |
| 02 | COD_PART | Participante fornecedor (0150) | C | 060 | - | S |
| 03 | COD_MOD | 06, 28, 29, 55, 66 | C | 002* | - | S |
| 04 | COD_SIT | Tabela 4.1.2 — [00, 01, 02, 03, 06, 07, 08] | N | 002* | - | S |
| 05 | SER | Série | C | 004 | - | N |
| 06 | SUB | Subsérie | N | 003 | - | N |
| 07 | NUM_DOC | Número (>0; "000000000" se impossível) | N | 009 | - | S |
| 08 | DT_DOC | Data de emissão | N | 008* | - | S |
| 09 | DT_ENT | Data de entrada (≥ DT_DOC) | N | 008* | - | N |
| 10 | VL_DOC | Valor do documento com direito a crédito (>0) | N | - | 02 | S |
| 11 | VL_ICMS | ICMS do documento | N | - | 02 | N |
| 12 | COD_INF | Informação complementar (0450) | C | 006 | - | N |
| 13 | VL_PIS | PIS total | N | - | 02 | N |
| 14 | VL_COFINS | COFINS total | N | - | 02 | N |
| 15 | CHV_DOCe | Chave do documento eletrônico | N | 044* | - | N (obrig. 55/66 desde 01/2020) |

Validações: COD_PART no 0150; DT_DOC ou DT_ENT dentro do período do 0000; CHV_DOCe: DV, raiz CNPJ e UF do participante
= chave; COD_MOD/NUM_DOC/SER consistentes com a chave. (PVA ≥ 1.03 aceita NF-e 55 de energia aqui.)
XML NF-e de energia: `emit`→COD_PART; `ide/serie`; `ide/nNF`; `dhEmi`; `vNF`; `vICMS`; chave.

### C501 — Complemento (06, 28, 29) – PIS/Pasep
Nível 4 · 1:N. Um por item (energia/água/gás) com crédito; um por CST se houver mais de um.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C501" | C | 004* | - | S |
| 02 | CST_PIS | CST PIS (entrada 50–66, 70–75, 98, 99) | N | 002* | - | S |
| 03 | VL_ITEM | Valor total do item | N | - | 02 | S |
| 04 | NAT_BC_CRED | Natureza BC crédito (4.3.7): 01, 02, **04 energia elétrica**, 13 | C | 002* | - | N |
| 05 | VL_BC_PIS | BC | N | - | 02 | **S** |
| 06 | ALIQ_PIS | Alíquota (%) — 1,65 | N | 008 | 04 | **S** |
| 07 | VL_PIS | Crédito | N | - | 02 | **S** |
| 08 | COD_CTA | Conta contábil (custos, despesas) | C | 255 | - | N* |

VL_BC_PIS → M105.VL_BC_PIS_TOT. VL_PIS = BC × ALIQ / 100 (não recuperado no M).

### C505 — Complemento (06, 28, 29) – COFINS
Idêntico ao C501 com CST_COFINS, VL_BC_COFINS (S), ALIQ_COFINS 7,6 (S), VL_COFINS (S). → M505.VL_BC_COFINS_TOT.

### C509 — Processo Referenciado (filho de C500)
REG "C509"; NUM_PROC (C 020 S); IND_PROC [1,3,9] (C 001* S). Nível 4.

### C600 — Consolidação diária de NF/Conta Energia (06), NF3e (66), Água (29), Gás (28) — SAÍDAS
Nível 3 · 1:N. Para quem **vende** energia/água/gás (concessionárias) — independente do Conv. ICMS 115/03; NF-e 55 de
fornecimento de energia também vai aqui. NF3e a partir das escriturações de 01/2020. Pode segregar C601/C605 por conta contábil.
**Não aplicável** a farmácia/varejo típico.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C600" | C | 004* | - | S |
| 02 | COD_MOD | [01, 06, 28, 29, 55, 66] | C | 002* | - | S |
| 03 | COD_MUN | Município IBGE (7 dígitos) | N | 007* | - | N |
| 04 | SER | Série | C | 004 | - | N |
| 05 | SUB | Subsérie | N | 003 | - | N |
| 06 | COD_CONS | Classe de consumo (tab 4.4.5 energia / 4.4.2 água / 4.4.3 gás) | N | 002* | - | N |
| 07 | QTD_CONS | Qtde de documentos consolidados (>0) | N | - | - | S |
| 08 | QTD_CANC | Qtde cancelados (≤ QTD_CONS) | N | - | - | N |
| 09 | DT_DOC | Data dos documentos | N | 008* | - | S |
| 10 | VL_DOC | Valor total | N | - | 02 | S |
| 11 | VL_DESC | Descontos | N | - | 02 | N |
| 12 | CONS | Consumo total kWh (06) | N | - | - | N |
| 13 | VL_FORN | Valor do fornecimento | N | - | 02 | N |
| 14 | VL_SERV_NT | Serviços não tributados pelo ICMS | N | - | 02 | N |
| 15 | VL_TERC | Valores cobrados em nome de terceiros | N | - | 02 | N |
| 16 | VL_DA | Despesas acessórias | N | - | 02 | N |
| 17 | VL_BC_ICMS | BC ICMS | N | - | 02 | N |
| 18 | VL_ICMS | ICMS | N | - | 02 | N |
| 19 | VL_BC_ICMS_ST | BC ICMS-ST | N | - | 02 | N |
| 20 | VL_ICMS_ST | ICMS-ST | N | - | 02 | N |
| 21 | VL_PIS | PIS acumulado | N | - | 02 | S |
| 22 | VL_COFINS | COFINS acumulado | N | - | 02 | S |

Não considerar documentos denegados ou inutilizados.

### C601 — Complemento da consolidação diária – Saídas – PIS/Pasep
Nível 4 · 1:N. Um por CST.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C601" | C | 004* | - | S |
| 02 | CST_PIS | 01, 02, 06, 07, 08, 09, 49, 99 | N | 002* | - | S |
| 03 | VL_ITEM | Valor total dos itens | N | - | 02 | S |
| 04 | VL_BC_PIS | BC | N | - | 02 | S |
| 05 | ALIQ_PIS | Alíquota (0,65 ou 1,65) | N | 008 | 04 | S |
| 06 | VL_PIS | Valor | N | - | 02 | S |
| 07 | COD_CTA | Conta contábil | C | 255 | - | N* |

VL_BC → M210.VL_BC_CONT.

### C605 — Complemento da consolidação diária – Saídas – COFINS
Idêntico ao C601 (alíquota 3 ou 7,6). → M610.VL_BC_CONT.

### C609 — Processo Referenciado (filho de C600)
REG "C609"; NUM_PROC (C 020 S); IND_PROC [1,3,9] (C 001* S). Nível 4.

---

## CF-e SAT (modelo 59) — C800 / C810 / C820 / C830 e C860 / C870 / C880 / C890

Relevante para varejistas de SP (SAT) e CE (MFE). Escolha: **C800 (por documento)** OU **C860 (consolidado por
equipamento/dia)** — nunca ambos. **Atenção: C800/C810/C820/C830 constam como "não disponível para escrituração no
PVA"** ⇒ na prática, usar **C860/C870/C880/C890**. C860 disponível a partir do PVA 2.11 para períodos desde **05/2015**;
antes disso CF-e ia em C400/C490.

### C800 — Cupom Fiscal Eletrônico (59) — por documento (NÃO disponível no PVA)
Nível 3 · 1:N. Unicidade: COD_SIT + NUM_CFE + NR_SAT. Cancelado: só REG, COD_MOD, COD_SIT, NUM_CFE, NR_SAT, CHV_CFE.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C800" | C | 004 | - | S |
| 02 | COD_MOD | "59" | C | 002 | - | S |
| 03 | COD_SIT | [00, 01, 02, 03] | N | 002 | - | S |
| 04 | NUM_CFE | Número do CF-e | N | 009 | - | S |
| 05 | DT_DOC | Data de emissão (≤ DT_FIN 0000) | N | 008 | - | S |
| 06 | VL_CFE | Valor total do CF-e | N | - | 02 | S |
| 07 | VL_PIS | PIS total | N | - | 02 | N |
| 08 | VL_COFINS | COFINS total | N | - | 02 | N |
| 09 | CNPJ_CPF | CNPJ (14) ou CPF (11) do destinatário | N | 14 | - | N |
| 10 | NR_SAT | Série do SAT | N | 009 | - | N |
| 11 | CHV_CFE | Chave do CF-e | N | 044 | - | N |
| 12 | VL_DESC | Desconto/exclusão sobre item | N | - | 02 | N |
| 13 | VL_MERC | Total mercadorias/serviços | N | - | 02 | N |
| 14 | VL_OUT_DA | Outras despesas acessórias | N | - | 02 | N |
| 15 | VL_ICMS | ICMS | N | - | 02 | N |
| 16 | VL_PIS_ST | PIS-ST | N | - | 02 | N |
| 17 | VL_COFINS_ST | COFINS-ST | N | - | 02 | N |

Validações: VL_CFE = Σ VL_OPR dos filhos (o guia cita "C850", herança da EFD ICMS). CHV_CFE: DV módulo 11; CNPJ da chave =
CNPJ do 0000; NUM_CFE = nº na chave; AAMM da chave = mês/ano de DT_DOC; UF da chave = UF do 0000.
Chave CF-e (44): cUF(2) + AAMM(2+2) + CNPJ(14) + mod(2) + nº série SAT(9) + nº CF-e(6) + código numérico(6) + DV(1).

### C810 — Detalhamento do CF-e – PIS/COFINS (NÃO disponível no PVA)
Nível 4 · 1:N. Por item ou por CST; um por CST/CFOP/alíquota.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C810" | C | 004* | - | S |
| 02 | CFOP | CFOP | N | 004 | - | S |
| 03 | VL_ITEM | Valor dos itens | N | - | 02 | S |
| 04 | COD_ITEM | Item (0200) | C | 060 | - | N |
| 05 | CST_PIS | 01, 02, 04, 05, 06, 07, 08, 09, 49, 99 | N | 002* | - | S |
| 06 | VL_BC_PIS | BC | N | - | 02 | N |
| 07 | ALIQ_PIS | Alíquota (%) | N | 008 | 04 | N |
| 08 | VL_PIS | Valor | N | - | 02 | N |
| 09 | CST_COFINS | idem | N | 002* | - | S |
| 10 | VL_BC_COFINS | BC | N | - | 02 | N |
| 11 | ALIQ_COFINS | Alíquota (%) | N | 008 | 04 | N |
| 12 | VL_COFINS | Valor | N | - | 02 | N |
| 13 | COD_CTA | Conta contábil | C | 255 | - | N |

Revenda de monofásicos a alíquota zero (CST 04) vai no C810 (não no C820).

### C820 — Detalhamento do CF-e – PIS/COFINS por unidade de medida (NÃO disponível no PVA)
Nível 4 · 1:N. Só para fabricante/importador de combustíveis, álcool, bebidas frias e embalagens (e comerciante de embalagens).
Campos: REG; CFOP (N 004* S); VL_ITEM (S); COD_ITEM (N); CST_PIS [03,05,06,07,08,09,49,99] (S); QUANT_BC_PIS (03);
ALIQ_PIS_QUANT (04); VL_PIS; CST_COFINS (S); QUANT_BC_COFINS; ALIQ_COFINS_QUANT; VL_COFINS; COD_CTA.

### C830 — Processo Referenciado (filho de C800) (NÃO disponível no PVA)
REG "C830"; NUM_PROC (C 020 S); IND_PROC [1,3,9] (C 001* S).

### C860 — Identificação do Equipamento SAT-CF-e
Nível 3 · 1:N. Consolidação **por equipamento e por dia**; itens do dia em C870 (ou C880).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C860" | C | 004 | - | S |
| 02 | COD_MOD | "59" | C | 002 | - | S |
| 03 | NR_SAT | Nº de série do SAT | N | 009 | - | S |
| 04 | DT_DOC | Data de emissão dos documentos (dentro do período do 0000) | N | 008 | - | N |
| 05 | DOC_INI | Nº do primeiro CF-e emitido (mesmo cancelado) | N | 009 | - | N |
| 06 | DOC_FIM | Nº do último CF-e emitido (mesmo cancelado) | N | 009 | - | N |

Unicidade: COD_MOD + NR_SAT + DOC_INI + DOC_FIM (o guia também diz "COD_MOD e NR_SAT" — na prática um C860 por SAT/dia).
DOC_INI ≤ DOC_FIM.

### C870 — Resumo diário por SAT – PIS/COFINS
Nível 4 · 1:N. Por item ou por CST; um por CST/alíquota.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | XML CF-e |
|---|---|---|---|---|---|---|---|
| 01 | REG | "C870" | C | 004* | - | S | |
| 02 | COD_ITEM | Item (0200) | C | 060 | - | N | `prod/cProd` |
| 03 | CFOP | CFOP | N | 004* | - | S | `prod/CFOP` |
| 04 | VL_ITEM | Valor dos itens | N | - | 02 | S | Σ `vProd` |
| 05 | VL_DESC | Exclusões/desconto comercial (vendas canceladas, descontos incondicionais…) — "0,00" ou vazio se não houver | N | - | 02 | N | Σ `vDesc` + cancelados |
| 06 | CST_PIS | 01, 02, 04, 05, 06, 07, 08, 09, 49, 99 | N | 002* | - | S | |
| 07 | VL_BC_PIS | BC = VL_ITEM − VL_DESC | N | - | 02 | N | |
| 08 | ALIQ_PIS | Alíquota (%) | N | 008 | 04 | N | |
| 09 | VL_PIS | Valor | N | - | 02 | N | |
| 10 | CST_COFINS | idem | N | 002* | - | S | |
| 11 | VL_BC_COFINS | BC | N | - | 02 | N | |
| 12 | ALIQ_COFINS | Alíquota (%) | N | 008 | 04 | N | |
| 13 | VL_COFINS | Valor | N | - | 02 | N | |
| 14 | COD_CTA | Conta contábil | C | 255 | - | N* | |

Regra explícita: **VL_BC = VL_ITEM − VL_DESC** (exclusões). VL_BC → M210/M610.VL_BC_CONT. VL = BC × alíq / 100.
Revenda de monofásicos (CST 04) pelo comerciante vai no **C870** (não C880).

### C880 — Resumo diário por SAT – PIS/COFINS por unidade de medida
Nível 4 · 1:N. Só fabricante/importador de combustíveis, álcool, bebidas frias, embalagens.
Campos: REG; COD_ITEM (N); CFOP (S); VL_ITEM (S); VL_DESC (N — em R$, mas a redução da BC é em quantidade);
CST_PIS [03,05,06,07,08,09,49,99] (S); QUANT_BC_PIS (03); ALIQ_PIS_QUANT (04); VL_PIS; CST_COFINS (S); QUANT_BC_COFINS;
ALIQ_COFINS_QUANT; VL_COFINS; COD_CTA. VL = QUANT × ALIQ_QUANT.

### C890 — Processo Referenciado (filho de C860)
REG "C890"; NUM_PROC (C 020 S); IND_PROC [1,3,9] (C 001* S). Nível 4.

---

## C990 — Encerramento do Bloco C

Nível 1 · 1 por arquivo · obrigatório se existir C001.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "C990" | C | 004* | - | S |
| 02 | QTD_LIN_C | Quantidade total de linhas do Bloco C (inclui C001 e C990) | N | - | - | S |

Validação: QTD_LIN_C = número de linhas do bloco C.

---

# Hierarquia do Bloco C (árvore para o gerador)

```
C001 (1)
└─ C010 (2)  [por estabelecimento; CNPJ ∈ 0140]
   ├─ C100 (3) doc 01/1B/04/55/65
   │   ├─ C110 (4) inf. complementar      [01,1B,04,55]
   │   ├─ C111 (4) processo referenciado
   │   ├─ C120 (4) importação             [entradas CFOP 3xxx, CST 50-56]
   │   ├─ C170 (4) itens                  [01,1B,04,55 — NÃO 65]
   │   └─ C175 (4) analítico NFC-e        [somente 65]
   ├─ C180 (3) consolidação VENDAS NF-e/NFC-e por item
   │   ├─ C181 (4) PIS   ├─ C185 (4) COFINS   └─ C188 (4) processo
   ├─ C190 (3) consolidação AQUISIÇÕES/DEVOLUÇÕES NF-e 55 por item
   │   ├─ C191 (4) PIS   ├─ C195 (4) COFINS   ├─ C198 (4) processo   └─ C199 (4) importação
   ├─ C380 (3) NF venda consumidor mod 02 (consolidado)
   │   ├─ C381 (4) PIS   └─ C385 (4) COFINS
   ├─ C395 (3) aquisições com crédito via doc. consumidor (02,2D,2E,59,60,65)
   │   └─ C396 (4) itens
   ├─ C400 (3) ECF
   │   ├─ C405 (4) Redução Z
   │   │   ├─ C481 (5) PIS   └─ C485 (5) COFINS
   │   └─ C489 (4) processo
   ├─ C490 (3) consolidação ECF (02,2D,59,60)
   │   ├─ C491 (4) PIS   ├─ C495 (4) COFINS   └─ C499 (4) processo
   ├─ C500 (3) energia/água/gás — entradas com crédito (06,28,29,55,66)
   │   ├─ C501 (4) PIS   ├─ C505 (4) COFINS   └─ C509 (4) processo
   ├─ C600 (3) energia/água/gás — saídas (consolidação diária)
   │   ├─ C601 (4) PIS   ├─ C605 (4) COFINS   └─ C609 (4) processo
   ├─ C800 (3) CF-e SAT por documento  [NÃO disponível no PVA]
   │   ├─ C810 (4)  ├─ C820 (4)  └─ C830 (4)
   └─ C860 (3) SAT por equipamento/dia
       ├─ C870 (4)  ├─ C880 (4)  └─ C890 (4)
C990 (1)
```

---

# Tabela-resumo: ENTRADAS vs SAÍDAS

| Registro | Saídas (receita) | Entradas (crédito/devolução) |
|---|---|---|
| C100/C170 | NF-e 55 própria (IND_OPER=1), mod. 01/1B/04 | NF-e 55 de terceiros ou própria de entrada (IND_OPER=0), CST 50–66 (ou 70–99 p/ itens sem crédito na mesma nota) |
| C100/C175 | **NFC-e 65** (só saída, CFOP 5xxx) | — |
| C180/C181/C185 | NF-e/NFC-e consolidadas por item | — |
| C190/C191/C195 | — (exceto devolução de compra CST 49, que é saída mas vai aqui) | Aquisições NF-e 55 com crédito; devoluções de vendas (NC: crédito) |
| C380/C381/C385 | NF consumidor mod 02 | — |
| C395/C396 | — | Aquisições com crédito por 02/2D/2E/59/60/**65** |
| C400…C499 | Cupom ECF | — |
| C500…C509 | — | Energia/água/gás |
| C600…C609 | Venda de energia/água/gás | — |
| C800…C890 | CF-e SAT | — |

# Regime de caixa × competência

Neste trecho (Bloco C) o guia **não** traz regra específica de regime de caixa. O Bloco C é orientado a documento fiscal
(competência da emissão). O C010.IND_ESCRI refere-se a individualizado × consolidado, não a caixa × competência.
PJ do lucro presumido no **regime de caixa** (0110.IND_REG_CUM = 1) escritura receitas pelo recebimento no **Bloco F
(F500/F510/F525)** — consultar o capítulo do Bloco F/0110 do guia (fora do intervalo lido). Para competência
(0110.IND_REG_CUM = 2 consolidado F550/F560, ou 9 detalhado) pode-se usar Bloco C. O gerador deve decidir o bloco com base
no 0110, e não gerar receitas em duplicidade (Bloco C + F500).

---

# COMO ESCRITURAR NFC-e (MODELO 65) — regras exatas

1. **Regra geral (fatos geradores a partir de 09/2014)**: **1 C100 por NFC-e + N C175** (um por combinação
   CFOP + CST_PIS + CST_COFINS + ALIQ_PIS + ALIQ_COFINS). **Nunca C170** para NFC-e.
2. **C100 da NFC-e**:
   - IND_OPER = 1; IND_EMIT = 0; COD_MOD = "65".
   - **Dispensados**: COD_PART (deixe vazio — consumidor não precisa de 0150), VL_BC_ICMS_ST, VL_ICMS_ST, VL_IPI, VL_PIS,
     VL_COFINS, VL_PIS_ST, VL_COFINS_ST.
   - Obrigatórios: COD_SIT, SER (3 posições; "000" se não houver), NUM_DOC, **CHV_NFE** (obrigatória p/ emissão própria;
     PVA confere DV, CNPJ da chave = CNPJ do C010, nNF, UF = UF do 0000), DT_DOC, VL_DOC, IND_PGTO, IND_FRT (normalmente 9).
   - VL_MERC = `vProd` (a regra Σ C170 não se aplica; recomenda-se VL_MERC = Σ C175.VL_OPR).
3. **C175**: agregar `det` da NFC-e:
   - CFOP: **somente 5xxx** (5102, 5405 etc.). Agrupar também por CFOP.
   - VL_OPR = Σ `vProd`; VL_DESC = Σ `vDesc` (+ exclusões, ex.: ICMS, se a empresa aplicar a exclusão via este campo — ver
     Seção 12 do guia);
   - BC = VL_OPR − VL_DESC (para CST 01/02); alíquotas 0,65/3,00 (cumulativo) ou 1,65/7,60 (não cumulativo);
   - CST 04 (monofásico revenda), 06 (alíquota zero), 05 (ST), 07, 08, 09, 49, 99 ⇒ BC/alíquota/valor zerados ou vazios
     (exceto a regra CST 05 do Dec. 4.524: BC 0, alíq. 0,65/3,00, valor 0 — aplicável ao varejo de cigarros).
   - Exemplo do guia: NFC-e com itens CST 01, 06, 05 e 04 ⇒ 1 C100 + 4 C175.
4. **Canceladas (COD_SIT 02/03), denegadas (04), inutilizadas (05)**: C100 sem filhos (só dados básicos); ou, se cancelada no
   próprio mês, pode omitir. Inutilização: C100 com COD_SIT 05 (só para emissão própria).
5. **Consolidação em C180** (exceção): somente se a escrituração individualizada em C100/C175 geraria arquivo **> 1 GB**
   E todos os estabelecimentos emissores de NFC-e estiverem obrigados à escrituração individualizada na EFD ICMS/IPI.
   Nesse caso: C180 COD_MOD "65", por item (0200) com NCM, + C181/C185 por CST/CFOP/alíquota.
6. **Até 08/2014**: NFC-e obrigatoriamente em C180 com COD_MOD "55" (código de item específico).
7. NFC-e **recebida** (compra do informante com direito a crédito) ⇒ **C395/C396** (não C100).
8. Não misturar: se houver C100(65) e C180(65) no mesmo estabelecimento, ver C010.IND_ESCRI (o guia define o campo para NF-e 55
   e ECF; prudente evitar mistura).

Pseudocódigo:
```
for nfce in xmls(mod=65, emit.CNPJ == estab):
  c100 = C100(IND_OPER=1, IND_EMIT=0, COD_PART='', COD_MOD='65', COD_SIT=sit(nfce),
              SER=pad3(ide.serie), NUM_DOC=ide.nNF, CHV_NFE=chave, DT_DOC=ddmmaaaa(ide.dhEmi),
              DT_E_S='', VL_DOC=ICMSTot.vNF, IND_PGTO=ind_pgto, VL_DESC=ICMSTot.vDesc,
              VL_ABAT_NT='', VL_MERC=ICMSTot.vProd, IND_FRT=transp.modFrete or 9,
              VL_FRT=vFrete, VL_SEG=vSeg, VL_OUT_DA=vOutro, VL_BC_ICMS=vBC, VL_ICMS=vICMS,
              (demais vazios))
  if sit in (02,03,04,05): emit c100 sem filhos; continue
  groups = groupby(det, key=(CFOP, PIS.CST, COFINS.CST, pPIS, pCOFINS))
  for g in groups: emit C175(CFOP, Σ vProd, Σ vDesc, CST_PIS, Σ vBC_PIS, pPIS, '', '', Σ vPIS,
                             CST_COFINS, Σ vBC_COFINS, pCOFINS, '', '', Σ vCOFINS, COD_CTA, '')
```

---

# COMO ESCRITURAR NF-e DE ENTRADA COM CRÉDITO — regras exatas

Aplicável a PJ no **regime não cumulativo** (lucro real). No cumulativo (presumido) não há crédito: entradas só são
informadas por transparência (CST 70–75/98/99) ou para devolução (exclusão de BC).

**Escolha do registro:**
| Documento de entrada | Registro |
|---|---|
| NF-e 55 de mercadorias (revenda/insumo), por documento | **C100 (IND_OPER=0, IND_EMIT=1) + C170** (+C120 se importação) |
| NF-e 55 de mercadorias, consolidado | **C190 + C191/C195** (+C199 se importação) |
| NF-e 55 de **energia elétrica** / NF3e 66 / água / gás | **C500 + C501/C505** |
| CT-e / transporte (57 etc.) | D100 (Bloco D) |
| NFC-e 65, cupom, CF-e SAT recebidos com crédito | **C395 + C396** |
| Bens do ativo imobilizado | **F120/F130** (Bloco F); se listar no C170/C191, CST 98/99 |
| NF-e de devolução de venda (emitida pelo cliente ou entrada própria) — NC | C170 ou C191/C195 com CFOP 1201/1202/1410/1411/2201/2202... e CST 50–56 |
| NF-e de retorno de mercadoria | Tratar como cancelamento de venda; não gera crédito (omitir, ou CST 98/99 só para transparência) |
| Transferência entre estabelecimentos | Não relacionar |
| NF-e cancelada/denegada/inutilizada | Não relacionar no consolidado; no C100 sem filhos |

**Campos-chave (C170 / C191/C195):**
- COD_ITEM: código **do informante** (de-para `cProd`/`cEAN` do fornecedor → 0200 interno).
- CFOP: **CFOP de entrada** do informante (1xxx/2xxx/3xxx) conforme destinação; converter o 5xxx/6xxx do emitente
  (ex.: 5102→1102, 6102→2102, 5405→1403, 6403→2403, 5101→1101/1102 conforme destinação). CFOP-título proibidos.
  Primeiro dígito igual em todos os itens do documento (C170).
- CST de crédito **50–56** (básico) ou **60–66** (presumido), escolhido conforme a vinculação às receitas:
  50 exclusivamente receita tributada MI; 51 exclusivamente não tributada MI; 52 exclusivamente exportação; 53/54/55/56 rateio.
  Itens sem crédito: **70** (sem direito), 71 (isenção), 72 (suspensão), **73 (alíquota zero)**, 74 (sem incidência),
  **75 (ST)**, 98, 99. — ATENÇÃO: Em farmácias: aquisição de produtos monofásicos para revenda (Lei 10.147/2000) não gera crédito
  (vedação art. 3º, I, b das Leis 10.637/10.833) — usar CST sem crédito (usual 70 ou 73; confirmar com a contabilidade).
- NAT_BC_CRED: não existe em C170/C191/C195 (o PVA deriva do CFOP pela tabela "CFOP – Operações Geradoras de Créditos").
  Existe em C396 e C501/C505 (e registros do Bloco F).
- BC do crédito: valor do item (VL_ITEM) − VL_DESC; considerar regras de composição (IPI não recuperável, frete/seguro
  pagos na aquisição, exclusão do ICMS destacado conforme orientação vigente — fora deste trecho, ver Seção 12/legislação).
  ATENÇÃO: Os campos de BC/alíquota/valor **só se o adquirente tem direito a crédito** (ótica do declarante) — **não copiar
  `PIS/vBC`/`vPIS` do XML do fornecedor**.
- Alíquotas NC: 1,65 / 7,60 (básicas). VL = BC × ALIQ / 100.
- M105/M505 só consideram CST 50–66 com CFOP da tabela de crédito ⇒ **o validador deve rejeitar/alertar CST 50–66 com CFOP fora
  da tabela** (o crédito "some" do Bloco M).
- C191/C195: CNPJ_CPF_PART do fornecedor obrigatório (vazio só para estrangeiro); consolidar por item + fornecedor + CST +
  CFOP + alíquota.
- Importação (CFOP 3xxx, CST 50–56): C120 (C100) ou C199 (C190) com DI/DSI/DUIMP e PIS/COFINS-Importação efetivamente pagos.
- Documento com itens com e sem crédito: informar a nota inteira (C100/C170), itens sem crédito com CST 70–99 sem BC.
- Documentos sem nenhum item com crédito: não precisam ser informados (opcional).
- C100 de entrada: DT_E_S obrigatório; CHV_NFE obrigatória (desde 04/2012) — DV e nNF conferidos; COD_PART no 0150.

**Devolução de compra** (saída ao fornecedor de mercadoria adquirida com crédito): CST **49**; estorno preferencialmente
reduzindo a BC da compra (C170.VL_DESC / C191.VL_DESC) no mês; se em período posterior, ajuste de redução de crédito
M100/M500 campo 10 + M110/M510 (NUM_DOC, DESCR_AJ).

---

# Checklist de validação (implementar no validador)

Estrutura:
- [ ] C001.IND_MOV coerente com existência de registros; C990.QTD_LIN_C = nº linhas (incl. C001/C990).
- [ ] C010.CNPJ com DV válido e presente no 0140; um C010 só se houver operações.
- [ ] C010.IND_ESCRI preenchido quando coexistem C100(55)+C180/C190, ou C400+C490.
- [ ] Hierarquia: C170 nunca sob C100 mod 65; C175 só sob C100 mod 65; C120 só com IND_OPER=0.
- [ ] C100 COD_SIT 02/03/04/05 ⇒ sem filhos; demais ⇒ ≥1 C170/C175.
- [ ] C800/C810/C820/C830 não devem ser gerados (não disponíveis no PVA) — usar C860.
- [ ] C800 e C860 nunca juntos; C400 e C490 — um ou outro (ou IND_ESCRI).

C100:
- [ ] Chave de unicidade (com CHV_NFE a partir de 04/2021).
- [ ] IND_EMIT=1 ⇒ IND_OPER=0. COD_MOD ∈ {01,1B,04,55,65}. COD_SIT ∈ {00..08}; 04/05 só emissão própria.
- [ ] SER 3 posições para 55 e 65 própria ("000"). NUM_DOC > 0.
- [ ] CHV_NFE: DV; obrigatória 55/65 própria; 55 terceiros desde 04/2012; CNPJ/UF/nNF da chave coerentes.
- [ ] DT_DOC ou DT_E_S no período; DT_E_S ≥ DT_DOC; DT_E_S obrigatório em entradas.
- [ ] VL_MERC = Σ C170.VL_ITEM. IND_FRT conforme tabela do período (≥10/2017 = modFrete).
- [ ] COD_PART ∈ 0150 (exceto NFC-e, dispensado).

C170:
- [ ] NUM_ITEM sequencial > 0 e único; COD_ITEM ∈ 0200; UNID ∈ 0190; QTD > 0; COD_NAT ∈ 0400.
- [ ] CFOP válido, não-título; 1º dígito ∈ {1,2,3} se entrada / {5,6,7} se saída; igual em todo o documento.
- [ ] ALIQ_ICMS > 0 em saídas com CST_ICMS final 00/10/20/70.
- [ ] VL_PIS ≈ VL_BC_PIS × ALIQ_PIS / 100 (ou QUANT × ALIQ_QUANT); idem COFINS. Não preencher BC valor e BC quantidade juntos.
- [ ] Saídas: CST ∈ {01..09, 49, 99}; Entradas: CST ∈ {50..56, 60..66, 70..75, 98, 99} (e 49 para devolução de compra).
- [ ] CST 50–66 ⇒ CFOP na tabela "CFOP – Operações Geradoras de Crédito".
- [ ] COD_CTA obrigatório (≥ 11/2017) exceto dispensados de ECD.

C175 / C181 / C185 / C191 / C195 / C381 / C385 / C481 / C485 / C491 / C495 / C870:
- [ ] Unicidade da combinação CFOP + CST + alíquotas no pai.
- [ ] C175: CFOP 5xxx apenas; sem transferências.
- [ ] Valor = BC × alíquota / 100 (tolerância de arredondamento de centavos).
- [ ] C870: VL_BC = VL_ITEM − VL_DESC.
- [ ] C191/C195: CNPJ_CPF_PART preenchido (exceto estrangeiro); CFOP de entrada; sem CFOP-título.
- [ ] C180/C190: NCM obrigatório (PVA ≥ 2.1.1), "00" p/ serviços; COD_ITEM ∈ 0200.
- [ ] C180/C190: excluir cancelados/denegados/inutilizados/transferências.

Coerência de CST para varejo/farmácia (saídas):
- [ ] **CST 04 (monofásico – revenda a alíquota zero)**: BC 0/vazia, alíquota 0, valor 0. NCM deve estar na lista monofásica
      (Lei 10.147/2000 – farmacêuticos/perfumaria/higiene; autopeças, combustíveis, bebidas frias...).
- [ ] **CST 06 (alíquota zero)**: BC/valor zero (ex.: medicamentos da lista positiva — tratamento pode ser 04 ou 06 conforme
      o produto; cruzar com NCM).
- [ ] **CST 05 (ST)**: revenda de cigarros (varejista): BC 0,00, ALIQ 0,65/3,00, VL 0,00.
- [ ] **CST 01**: 0,65/3,00 (cumulativo) ou 1,65/7,60 (não cumulativo); BC = VL_ITEM − VL_DESC (+ frete cobrado do cliente).
- [ ] Frete cobrado do cliente segue o CST do produto transportado.

Devoluções/cancelamentos:
- [ ] Venda cancelada no mês ⇒ omitir ou C100 COD_SIT 02 sem filhos; consolidado ⇒ excluir.
- [ ] Cancelamento em mês posterior ⇒ ajuste M215/M615 COD_AJ_BC 01 (≥ 01/2019) ou M220/M620.
- [ ] Devolução de venda: NC ⇒ crédito (CST 50–56 + CFOP devolução); Cumulativo ⇒ exclusão (C100 BC zerada + C110; ou
      M215/M615 COD_AJ_BC 02); a NF de devolução no cumulativo só com CST 98/99.
- [ ] Devolução de compra ⇒ CST 49; estorno do crédito.

---

# Mapeamento rápido XML → EFD-Contribuições (NF-e/NFC-e 4.00)

| XML | Registro.Campo |
|---|---|
| `infNFe/@Id` (sem "NFe") / `chNFe` | C100.CHV_NFE; C500.CHV_DOCe |
| `ide/mod` | C100.COD_MOD; C180.COD_MOD; C190.COD_MOD |
| `ide/serie` | C100.SER (zero-pad 3) |
| `ide/nNF` | C100.NUM_DOC |
| `ide/dhEmi` | C100.DT_DOC; C180/C190 DT_*_INI/FIN |
| `ide/dhSaiEnt` | C100.DT_E_S (saídas) |
| `ide/tpNF` + CNPJ emitente | C100.IND_OPER / IND_EMIT |
| `ide/finNFe` (2=complementar, 4=devolução) | C100.COD_SIT 06; CFOP devolução/CST |
| `ide/natOp` | C170.COD_NAT (0400) |
| `emit` / `dest` | 0150 → C100.COD_PART; C191/C195.CNPJ_CPF_PART (= emit/CNPJ) |
| `total/ICMSTot/vNF` | C100.VL_DOC |
| `vProd` | C100.VL_MERC |
| `vDesc` | C100.VL_DESC |
| `vFrete` / `vSeg` / `vOutro` | C100.VL_FRT / VL_SEG / VL_OUT_DA |
| `vBC` / `vICMS` | C100.VL_BC_ICMS / VL_ICMS |
| `vBCST` / `vST` | C100.VL_BC_ICMS_ST / VL_ICMS_ST |
| `vIPI` | C100.VL_IPI |
| `vPIS` / `vCOFINS` | C100.VL_PIS / VL_COFINS (saídas; entradas: valor apurado pelo informante) |
| `transp/modFrete` | C100.IND_FRT (≥ 10/2017, direto) |
| `pag/detPag/indPag`, `cobr/dup` | C100.IND_PGTO |
| `det/@nItem` | C170.NUM_ITEM |
| `det/prod/cProd` | C170/C180/C190.COD_ITEM (via 0200) |
| `det/prod/xProd` | 0200.DESCR_ITEM / C170.DESCR_COMPL |
| `det/prod/NCM`, `EXTIPI` | 0200.COD_NCM; C180/C190.COD_NCM / EX_IPI |
| `det/prod/CFOP` | C170/C175/C181/C185.CFOP (saídas); entradas: converter p/ CFOP de entrada |
| `det/prod/uCom`, `qCom` | C170.UNID (0190) / QTD |
| `det/prod/vProd` | C170.VL_ITEM; C175.VL_OPR; C181.VL_ITEM |
| `det/prod/vDesc` | C170.VL_DESC; C175/C181.VL_DESC |
| `imposto/ICMS/*/orig+CST` (ou CSOSN) | C170.CST_ICMS |
| `ICMS/*/vBC, pICMS, vICMS` | C170.VL_BC_ICMS / ALIQ_ICMS / VL_ICMS |
| `ICMS/*/vBCST, pICMSST, vICMSST` | C170.VL_BC_ICMS_ST / ALIQ_ST / VL_ICMS_ST |
| `IPI/cEnq`, `IPITrib/CST, vBC, pIPI, vIPI` | C170.COD_ENQ / CST_IPI / VL_BC_IPI / ALIQ_IPI / VL_IPI |
| `PIS/PISAliq|PISNT|PISOutr|PISQtde/CST` | C170/C175/C181.CST_PIS |
| `PISAliq/vBC, pPIS, vPIS` | VL_BC_PIS / ALIQ_PIS / VL_PIS |
| `PISQtde/qBCProd, vAliqProd` | QUANT_BC_PIS / ALIQ_PIS_QUANT |
| `COFINS/...` (análogo) | CST_COFINS / VL_BC_COFINS / ALIQ_COFINS / VL_COFINS / QUANT_* |
| `PISST/vPIS`, `COFINSST/vCOFINS` | C100.VL_PIS_ST / VL_COFINS_ST |
| `DI/nDI`, `adi/nDraw` | C120/C199.NUM_DOC_IMP / NUM_ACDRAW |
| `infAdic/infCpl` | C110 (via 0450) |
| `protNFe/infProt/cStat` + eventos | C100.COD_SIT |

Observação: CST PIS/COFINS de **saída** vem do XML (emissão própria); CST de **entrada** é definido pelo
informante (nunca copiar o CST de saída do fornecedor — 01 no XML do fornecedor ≠ 50 automaticamente; depende de direito
a crédito, regime do adquirente e natureza do produto).

---

# Inconsistências/erratas do guia observadas neste trecho
- C175: orientações citam "Campo 19" (INFO_COMPL) mas o leiaute tem 18 campos.
- C175 CST_PIS consta Obrig "N" e CST_COFINS "S" — preencher sempre ambos.
- C385: "Campo 01 – Valor Válido: [C381]" (errata; é C385).
- C190: diz que NF de entrada de retorno "não deverá ser relacionada"; C100/C180 dizem "pode, com CST 98/99". C190 cita só
  CST 99 para devolução de venda no cumulativo; C100 cita 98 ou 99.
- C800: validação de VL_CFE refere-se a "C850" (inexistente na EFD-Contribuições).
- C860: unicidade citada de duas formas (COD_MOD+NR_SAT vs COD_MOD+NR_SAT+DOC_INI+DOC_FIM).
- C381/C385 e C601/C605: VL_PIS/VL_COFINS "S" (obrigatórios) diferente de outros registros.
- Seções 11 e 12 (decisões judiciais / exclusão do ICMS da BC) são referenciadas mas estão fora do trecho lido
  — ler antes de implementar a exclusão do ICMS (Tema 69 STF) via VL_DESC.
