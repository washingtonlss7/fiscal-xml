# EFD-ICMS/IPI — Notas de desenvolvimento (Guia Prático v3.2.2, 11/02/2026 — Cap. I e II)

Fonte: `guia_icms_ipi.txt` linhas 1–1659 (Cap. I, Cap. II e a lista de registros do Cap. III).
Complementado com trechos do mesmo arquivo: registro 0000 (l.1661–1790), aberturas de bloco
(0001, D001, E001, H001), registros 9900/9990/9999 (l.19700–19760) e **tabelas de obrigatoriedade
por perfil – item 2.6.1** (l.19762–20887). Nada fora do Guia foi inventado; onde uso conhecimento
externo está marcado **[EXTERNO – confirmar]**.

Contexto do produto: gerar / auditar / validar EFD-ICMS/IPI a partir de XML (NF-e 55, NFC-e 65,
CT-e 57/67) para comércio no ES (farmácias, varejo; Lucro Presumido/Real). Simples dispensado no ES.

---

## 1. Quem entrega, periodicidade, prazos, estabelecimento, assinatura, transmissão, retificação, guarda

### Obrigados
- Contribuintes do ICMS e/ou IPI inscritos no cadastro estadual (Conv. ICMS 143/2006, Ajuste SINIEF 02/2009,
  leiaute pelo **Ato COTEPE/ICMS 44/2018** e alterações). A obrigatoriedade concreta é **definida pela legislação estadual**.
- Simples Nacional: dispensado, salvo UF que obrigou até 1º trimestre/2014 (Prot. ICMS 49/2015, LC 147/2014).
  → Para o ES o usuário confirma que Simples é dispensado: o sistema deve bloquear geração para CRT=1/Simples (ou avisar).
- Estabelecimento com atividade paralisada **também entrega** (arquivo "sem movimento" com os registros "O").

### Por estabelecimento (diferença-chave vs EFD-Contribuições)
- "O contribuinte deve gerar e manter uma EFD-ICMS/IPI **para cada estabelecimento**" (l.113).
  → **Um arquivo por IE/CNPJ completo (14 dígitos) por mês**. Na EFD-Contribuições é um arquivo por CNPJ
  raiz (matriz consolida filiais); aqui NÃO. Chave do arquivo = (CNPJ, IE, UF, DT_INI, DT_FIN).
- Tudo é informado **sob o enfoque do declarante** (CFOP de entrada 1/2/3 nas aquisições, não o CFOP do emitente).

### Periodicidade
- **Mensal**, mês civil ou fração. DT_INI = dia 1 (exceto início de atividade/evento), DT_FIN = último dia do
  mesmo mês (exceto encerramento/evento). DT_INI e DT_FIN devem estar no mesmo mês/ano.
- Encerramento: último arquivo deve ter DT_FIN = data fim do credenciamento (consultar em
  sped.fazenda.gov.br/spedfiscalserver/ConsultaContribuinte).

### Prazo
- Definido por **legislação estadual** (o Guia não fixa). **ES = dia 20 do mês subsequente** (informado pelo
  usuário; **[EXTERNO – confirmar no RICMS/ES]**). Parametrizar prazo por UF em tabela.
- IPI em PE/DF: IN RFB 1371/2013 e 1685/2017 (irrelevante para ES).

### Assinatura (certificado ICP-Brasil A1 ou A3)
1. e-CNPJ com **mesma raiz (8 primeiros dígitos)** do estabelecimento;
2. e-CPF do produtor rural ou do representante legal no CNPJ;
3. sucessora, se CNPJ sucedido extinto por incorporação/fusão/cisão total e período anterior à sucessão;
4. PJ/PF com **procuração eletrônica e-CAC** (opção "Assinatura da EFD-ICMS/IPI"), **por estabelecimento**
   (para filial: login matriz → "CNPJ matriz atuando como CNPJ filial");
5. inventariante com procuração eletrônica.
→ Validador: checar raiz do CNPJ do certificado = raiz do 0000.CNPJ (ou marcar "requer procuração").

### Transmissão
- Fluxo: TXT → **PVA (Programa de Validação e Assinatura)** valida → assina → transmite (ReceitaNet).
- Recibo `.REC` gravado no mesmo diretório e com mesmo nome do TXT; contém hash do arquivo transmitido.
- Recibo perdido: ReceitanetBX (baixa o arquivo/recibo com certificado). Retransmitir o arquivo idêntico regrava o recibo.
- **Nosso software não substitui o PVA para assinar/transmitir** (o Guia só prevê PVA); geramos TXT pronto para o PVA.
- Importação de blocos no PVA (v2.0.6+): bloco estruturado = 0000 idêntico + abertura do bloco + registros + encerramento.
  Útil para gerar só o Bloco H/K/G separadamente.

### Retificação (Ajuste SINIEF 11/2012 e 27/2020)
- Dentro do prazo normal: pode substituir livremente (COD_FIN = 1 – arquivo substituto).
- Períodos ≥ jan/2013: retificação **sem autorização até o último dia do 3º mês subsequente** ao mês de apuração
  (ex.: jan → 30/abr). Depois disso, **só com autorização** da SEFAZ (ou se a SEFAZ dispensar a autorização —
  Ajuste SINIEF 27/20, a partir de 03/09/2020, só para ICMS).
- Retificação usa **o leiaute vigente no período de apuração** (COD_VER do período) e **o PVA atualizado da data de transmissão**.
- SEFAZ que pedem hash: é o hash do arquivo RETIFICADOR assinado ("ID do Arquivo Assinado (hash)", 32 caracteres).
- IPI: fora do prazo decadencial → e-mail faleconosco-sped-icms-ipi@rfb.gov.br; dentro do prazo decadencial de 5 anos → eProcesso.
- → Regra do sistema: calcular `data_limite_retif_livre = último dia de (mês_apuração + 3)`; após isso, alertar "requer autorização".

### Guarda
- Guardar **o TXT transmitido + recibo** pelo prazo de guarda dos documentos fiscais (não a "cópia de segurança"
  nem o TXT "exportado" pelo PVA). Guardar também os documentos de origem (XMLs).
- → Nosso storage: TXT exato transmitido (imutável, com hash), .REC, XMLs de origem, versão do gerador.

### Outras informações do Cap. I relevantes ao gerador
- **Extemporâneos**: COD_SIT = 01, 03 ou 07; DT_DOC e DT_E_S **fora** do período do 0000. Saídas extemporâneas não
  totalizam na apuração do período (imposto recolhido com acréscimos); entradas extemporâneas creditam normalmente.
- **PIS/COFINS**: campos de PIS/COFINS da EFD-ICMS/IPI são **dispensados → informar vazio `||`** (IN RFB 1252/2012).
- **CC-e não é escriturada**: escriturar o documento já corrigido (aplicar CC-e ao XML antes de gerar? — CC-e não altera valores; atenção a campos corrigíveis).
- Registros C176, C179, C197, C597, D197, 1200 não são usados por todas as UF → tabela de parametrização por UF.
- Se a tabela externa de uma UF (ex.: 5.1.1 ajustes) não for disponibilizada e não houver genérica → o registro vinculado **não é informado**.
- Situações de exceção (isenção, não-incidência, diferimento, suspensão) devem ser informadas com o dispositivo legal (C195/0460, C197).

---

## 2. Seção 10 — Reforma Tributária (IBS/CBS/IS)

Texto integral (l.379–385), resumido:
- A EFD-ICMS/IPI **não se presta à apuração de CBS, IBS e IS**. **Não há registros nem campos novos de IBS/CBS**
  neste Guia v3.2.2 (nenhuma subseção de leiaute cita IBS/CBS; a única inclusão 2026 é 1310 campo 11 CAP_TANQUE).
- **Valor total do documento** (ex.: **C100 campo 12 VL_DOC**) **deve considerar** CBS/IBS/IS
  **— EXCETO no exercício 2026**. Ou seja:
  - **2026**: VL_DOC **sem** IBS/CBS (ano-teste; na NF-e 2026 o vNF não soma IBS/CBS — alinhar VL_DOC ao total "antigo").
  - **2027 em diante**: VL_DOC **inclui** CBS/IBS/IS quando estes compuserem o total do documento.
- **Valor da operação dos registros analíticos NÃO inclui** CBS/IBS/IS (ex.: **C190 campo 05 VL_OPR**), em qualquer ano.
- Aplica-se a **todos os modelos** escriturados (C100/C190, D100/D190, C800/C850, etc.).

Implicações para o gerador:
- Ler do XML os totais `IBSCBSTot` / `vIBS`, `vCBS`, `vIS` (grupo `IBSCBS` da NT 2025.002) e:
  - 2026: `VL_DOC = vNF` somente se vNF não incluir IBS/CBS; garantir `VL_DOC` sem esses tributos.
  - ≥2027: `VL_DOC = vNF` (que passa a conter IBS/CBS/IS).
  - Sempre: `VL_OPR (C190) = soma itens sem IBS/CBS/IS`.
- Consequência de validação: a partir de 2027, a regra clássica "Σ VL_OPR(C190) = VL_DOC(C100)" deixa de fechar
  exatamente — diferença esperada = vIBS + vCBS + vIS. O auditor deve tolerar essa diferença explicável.
- Não há cronograma de extinção do ICMS neste Guia (a redução gradual do ICMS 2029–2032 é legislação da EC 132/LC 214 **[EXTERNO]**).

---

## 3. Versão do leiaute (COD_VER) e mudanças recentes

- 0000.COD_VER: N, 3 dígitos exatos (`003*`). **O Guia não traz o número**; remete à Tabela Versão do Leiaute
  (item 3.1.1 da Nota Técnica / Ato COTEPE 44/2018). Validação: a versão deve ser **válida na data DT_FIN**.
- **[EXTERNO – confirmar na Tabela 3.1.1]**: 017 = 2023, 018 = 2024, **019 = 2025**, **020 = 2026**.
  → Implementar tabela `versao_leiaute(cod_ver, dt_ini_vigencia, dt_fim_vigencia)` e escolher por DT_FIN.
  Retificação de período antigo usa o COD_VER daquele período.

Mudanças de leiaute (Cap. II, Seção 1) — as relevantes para comércio/farmácia no ES em negrito:

| Vigência | Inclusão | Impacto para nosso gerador |
|---|---|---|
| 2026 | 1310 campo 11 CAP_TANQUE | Só postos de combustível. Irrelevante. |
| 2025 | D700 campo 32 DED; D750 campo 17 DED | NFCom (62) — irrelevante (só telecom). |
| 2024 | 1391 campos 21–23 (resíduos usina) | Irrelevante. |
| **2023** | **K010** (tipo de leiaute Bloco K simplificado/completo), **0221** (correlação de itens comercializados), C855/C857 e C895/C897 (obs. CF-e SAT 59), D700–D761 (NFCom 62) | K010 só se obrigado ao Bloco K (comércio atacadista pode ser; varejo não). 0221: se o item vendido for "kit"/conversão de código. |
| **2023** | **COD_SIT 04 e 05 descontinuados** (Cap. IV 1.3) | NF-e denegada/inutilizada **não são mais escrituradas no C100** a partir de jan/2023 (o gerador deve pular XMLs de denegação/inutilização). |
| 2022 | **1601** (operações com instrumentos de pagamento eletrônico) substitui 1600; 0220 campo 04 COD_BARRA; C500 campos 34–40 | 1601: para quem recebe via intermediador/ PIX-cartão (dado vem de terceiros, não do XML). 0220.COD_BARRA: fator de conversão por embalagem com GTIN. |
| 2021 | C181, C186 (devoluções com ST) | Varejo com ST (farmácia!) — devoluções. |
| **2020** | **C180/C185** (compl. entradas/saídas ST), C330, C380, C430, C480, C810/C815, C870/C880, **H030** (inventário ST), 0002, 1250/1255 | Relevante p/ ressarcimento/complementação ST — no ES verificar se a SEFAZ exige (tabela por UF). |
| 2019 | **C191** (FCP na NF-e/NFC-e), C177, Bloco B (só DF), C176 campo 27, **C170 campo 38 VL_ABAT_NT** | C191 se houver FCP no XML. Bloco B: fora do DF só B001(IND_MOV=1)+B990. |
| 2018 | E531; D100 campos 24–25 COD_MUN_ORIG/DEST | D100 de CT-e precisa dos municípios de origem/destino (do XML do CT-e). |
| 2017 | K210–K280; C176 campos 10–26; **0200 campo 13 CEST**; CHV_DOCe em C113/E113/E240/1210/1923; E310 reestruturado (FCP DIFAL) | CEST do XML (prod/CEST). |
| 2016 | K001–K255, 0210; **C101, D101, E300–E316 (DIFAL EC 87/15)** | DIFAL de vendas interestaduais a não contribuinte (e-commerce). |
| 2015 | H010 campo 11 VL_ITEM_IR | Inventário. |
| 2012 | D195, D197, H020, **1010**, 1390/1391; H005 campo 04 MOT_INV | 1010 obrigatório. |
| 2011 | Bloco G (CIAP), 0300/0305/0500/0600, E116/E250 MES_REF, 1900–1926 | Bloco G obrigatório (ao menos G001/G990). |
| 2010 | C105, 1700/1710, 1800; 0205 COD_ANT_ITEM, C190 COD_OBS | — |

---

## 4. Perfis A / B / C

- Perfil é **determinado pelo Fisco estadual** (0000.IND_PERFIL ∈ {A,B,C}). **Arquivo é rejeitado se o perfil
  informado for diferente do estabelecido** → o perfil deve ser cadastro do estabelecimento, nunca escolhido pelo gerador.
- A = mais detalhado (documento a documento, com itens). B = sintético (totalizações diárias/mensais). C = mais sintético que B.
- Registros "na íntegra" e "resumo" do mesmo documento são **mutuamente excludentes** conforme perfil.

Tabela (item 2.6.1, colunas Entrada/Saída). O=obrigatório, OC=se houver, N=não pode, O(cond)=obrigatório se condição.

| Reg | Descrição | A Ent | A Saí | B Ent | B Saí | C Ent | C Saí |
|---|---|---|---|---|---|---|---|
| 0100 | Contabilista | O | O | O | O | — (O só se A ou B) | — |
| C100 | NF 01/1B/04/55/65 | OC (N p/ 65) | OC | OC (N p/ 65) | OC | OC (N p/ 65) | OC |
| C101 | EC 87/15 | OC | OC | OC | OC | OC | OC |
| C105 | ST p/ UF diversa | OC | OC | OC | OC | N | N |
| C110–C114, C116 | Complementos doc | OC | OC | OC | OC | N | N |
| C115 | Local coleta/entrega | N | OC | N | OC | N | N |
| C120 | Importação | OC | N | OC | N | N | N |
| C130 | ISSQN/IRRF/Prev | N | OC | N | OC | N | N |
| C140 / C141 | Fatura / vencimentos | OC / O(se C140) | OC / O(se C140) | idem | idem | N | N |
| C160, C165 | Volumes / combustíveis | N | OC | N | OC | N | N |
| **C170** | Itens | **O (se C100)*** | **O (se C100)*** | O (se C100)* | O (se C100)* | **N** | **N** |
| C171 | Armaz. combustível | OC | N | OC | N | N | N |
| C172, C174, C176, C178, C179 | ISSQN, armas, ressarc. ST, IPI qtde, ST | N | OC | N | OC | N | N |
| **C173** | **Medicamentos** | OC | OC | OC | OC | N | N |
| C175 | Veículos novos | OC | OC | OC | OC | N | N |
| C177 | Outras infos item | OC | OC | OC | OC | OC | OC |
| C180, C181 | Entrada ST / devol. saída ST | OC | N | OC | N | N | N |
| C185, C186 | Saída ST / devol. entrada ST | N | OC | N | OC | N | N |
| **C190** | Analítico | O (se C100) | O (se C100) | O (se C100) | O (se C100) | O (se C100) | O (se C100) |
| C191, C195, C197 | FCP / obs / ajustes | OC | OC | OC | OC | OC | OC |
| C300/C310 | Resumo diário NF 02 | N | N | N | OC | N | OC |
| C320 | Analítico C300 | N | N | N | O(se C300 e VL_DOC>0) | N | O(idem) |
| C321, C330 | Itens / ST | N | N | N | O(se C320...) / OC | N | N |
| C350/C370/C380/C390 | NF 02 individual | N | OC / O(se C350) / OC / O(se C350) | N | N | N | N |
| C400 | ECF | N | OC | N | OC | N | OC |
| C405, C420, C490 | Redução Z / totalizadores / analítico | N | O(se C400) | N | O(se C400) | N | O(se C400) |
| C410 | PIS/COFINS dia | N | OC | N | OC | N | N |
| C425 | Itens mov. diário | N | N | N | O(se C420, sem C495, totalizador tributado) | N | N |
| C430 | ST | N | N | N | OC | N | N |
| C460/C465/C470/C480 | Cupom por ECF | N | O(se C400 e sem C495)… | N | N | N | N |
| C495 | Resumo mensal ECF | N | O só BA | N | O só BA | N | N |
| C500 | Energia/água/gás/NF3e | OC | OC | OC | OC (N p/ 06,28,29) | OC | N |
| C510 | Itens C500 | N | O(se C500) | N | N | N | N |
| C590 | Analítico C500 | O(se C500) | O | O | N (O se C500) | O | N |
| C591, C595, C597 | | OC | OC | OC | OC | OC | OC |
| C600/C601/C610/C690 | Consolidação energia | N | N | N | OC/OC/O/O | N | N |
| C700/C790/C791 | Conv. 115 | N | OC/O/OC | N | OC/O/OC | N | N |
| C800–C857 | CF-e SAT individual | N | OC | N | N | N | N |
| C860–C897 | SAT resumo diário | N | N | N | OC (C890 O se C860) | N | OC (C890 O se C860) |
| D100 | CT-e etc. | OC | OC | OC | OC | OC | OC |
| D101 | EC 87/15 | OC | OC | OC | OC | OC | OC |
| D110/D120/D130/D140/D150/D170 | Complementos | N | O(se D100) | N | O(se D100) | N | N |
| D160 | Carga | N | O(modelo≠07 e CFOP D190≠5359/6359) | N | idem | N | N |
| D161 | | N | OC | N | N | N | N |
| D162, D180 | | N | OC | N | OC | N | N |
| **D190** | Analítico | O(se D100) | O | O | O | O | O |
| D195, D197 | | OC | OC | OC | OC | OC | OC |
| D300/D301 | Bilhetes | N | OC | N | OC | N | OC |
| D310 | | N | O(se D300) | N | O(se D300) | N | N |
| D350/D355/D365/D390 | ECF transporte | N | OC/O… | N | OC/O… | N | OC/O… |
| D360 | | N | OC | N | OC | N | N |
| D370 | | N | O(cond.) | N | N | N | N |
| D400/D410/D411 | Mov. diário 18 | N | OC/O/OC | N | OC/O/OC | N | OC/O/OC |
| D420 | | N | O(se D400) | N | O(se D400) | N | N |
| D500 | Comunicação 21/22 | OC | OC | OC | N | OC | OC |
| D510, D530 | | N | O(se D500) / OC | N | N | N | N |
| D590 | | O(se D500) | O | O | N | O | O |
| D600/D610/D690 | | N | N | N | OC/O/O | N | N |
| D695/D696/D697 | | N | OC/O/OC | N | OC/O/OC | N | N |
| D700/D730/D731/D735/D737 | NFCom | OC / O(se D700) / OC… | idem | idem | idem | idem | idem |
| D750/D760/D761 | NFCom consolidada | N | OC/O/O | N | OC/O/O | N | OC/O/O |
| Blocos 0 (demais), E, G, H, K, 1, 9 | independem de perfil (ver seção 6) | | | | | | |

\* A condição exata de C170 ("O se existir C100") comporta exceções detalhadas no registro C100/C170 (ex.: NF-e de
emissão própria não exige C170; NFC-e 65 nunca tem C170) — tratar no documento do Cap. III.

**Leitura prática para varejo/farmácia (NF-e + NFC-e + CT-e):**
- Qualquer perfil: C100/C190 para NF-e 55 (entrada e saída); NFC-e 65 **só em saída** (C100 com "N para código 65" em entradas).
- Perfil C: **proibido C170, C110–C116, C120, C173, C180–C186** → só C100 + C190 (+C191/C195/C197/C101/C177).
- Perfil A/B: C170 obrigatório nas entradas por NF-e de terceiros; **C173 (medicamentos)** e **C180/C185 (ST)** possíveis.

---

## 5. Regras de preenchimento de campos (Cap. II Seção 3 + 0000)

Formato de linha / arquivo (Seção 1):
- Arquivo = 0000 … blocos … 9999. **Todos os blocos são obrigatórios, na ordem**: 0, B, C, D, E, G, H, K, 1, 9.
- Cada bloco: registro de abertura (x001), dados, encerramento (x990). Bloco sem dados → x001 com IND_MOV=1 + x990.
- Registro: **todos os campos do leiaute, na ordem, mesmo vazios** (omitir campo = erro de estrutura).
  Linha no formato `|REG|campo2|...|campoN|` (pipe no início e no fim; delimitador `|`).
- Ordem dos registros dentro do bloco: sequencial e ascendente conforme hierarquia; **filhos logo após o pai**
  (C100 → C101…C197 do mesmo documento → próximo C100; depois C400 e filhos…).
- Registro filho exige registro pai. **Não gerar registros sem informação** (ex.: C110 sem dados adicionais).
- Correlação modelo × registro é obrigatória (55/65 → C100; 57/67 → D100; 06/66 → C500; 59 → C800/C860; 21/22 → D500; 62 → D700…).

Campos:
- **C (alfanumérico)**: qualquer ASCII exceto `|` (124) e não-imprimíveis (0–31). Máx. **255** caracteres salvo tamanho
  próprio. **Sem espaços no início/fim**. Maiúsculas = minúsculas (case-insensitive).
- **N (numérico)**: dígitos 0–9 (ASCII 48–57). Sem separador de milhar, sem sinal, sem `.`/`-`/`%`.
  - Decimais com **vírgula** (ASCII 44). Respeitar nº máximo de casas decimais do campo (ex.: alíquota 6 posições,
    2 decimais → máx 999,99). Casas decimais à direita podem ser omitidas: `10000` ≡ `10000,00`; `17` ≡ `17,00`; `0` ≡ `0,00`.
  - Sem limite de tamanho, **exceto** tamanho com `*` = **tamanho exato** (ex.: CNPJ 014*, CPF 011*, COD_MUN 007*, datas 008*, COD_VER 003*, UF 002*).
  - Percentual sem `%` e sem conversão ("17,00 %" → `17,00`).
  - Zeros à esquerda: em campos N com `*` (CNPJ, COD_MUN) preservar zeros.
- **Datas**: `ddmmaaaa`, sem separadores.
- **Campo vazio**: `||`. Campos PIS/COFINS da EFD-ICMS/IPI: sempre vazios.
- Charset: o Guia só restringe ao "ASCII" (sem `|` e sem 0–31); na prática o PVA lê ISO-8859-1/Latin-1 **[EXTERNO – confirmar]**.
  Sanitizar: remover CR/LF/TAB e `|` de xProd, infCpl, nomes; trim.
- Tabelas externas (CFOP, CST, municípios IBGE, tabelas 5.x por UF): sped.rfb.gov.br/pagina/show/1578 — versionar localmente.

Notação de obrigatoriedade:
- Registros: **O** sempre; **O(…)** obrigatório se condição; **OC** se houver informação; **N** não pode ser apresentado.
- Campos: **O** sempre preenchido (em analíticos C/D e no Bloco E todos os numéricos O: valor ou `0`); **OC** se houver a informação.
- Ocorrência: `1` (um por arquivo), `V` (vários), `1:1` (um filho por pai), `1:N` (vários filhos por pai).
- Nível hierárquico: 0 (0000, 9999), 1 (aberturas/encerramentos), 2, 3, 4, 5, 6.

Registro 0000 (campos):
`|0000|COD_VER|COD_FIN|DT_INI|DT_FIN|NOME|CNPJ|CPF|UF|IE|COD_MUN|IM|SUFRAMA|IND_PERFIL|IND_ATIV|`
- COD_VER N 3*; COD_FIN 0=original, 1=substituto; NOME C100; CNPJ/CPF mutuamente excludentes (um obrigatório);
  UF = UF do informante; IE C14 com DV por UF; COD_MUN 7 dígitos IBGE; IM OC; SUFRAMA C9* (DV se informado);
  IND_PERFIL A/B/C; IND_ATIV 0=industrial/equiparado, 1=outros (comércio = **1**).
- IND_ATIV=0 → 0002 obrigatório e E500 obrigatório; IND_ATIV=1 → não pode haver E500.

---

## 6. Blocos e registros (nível / ocorrência / obrigatoriedade geral – item 2.6.1)

Obrig. "por perfil" dos blocos C e D: ver seção 4. Demais blocos (todos os contribuintes):

**Bloco 0**
| Reg | Descrição | Nív | Ocor | Obrig |
|---|---|---|---|---|
| 0000 | Abertura/identificação | 0 | 1 | O |
| 0001 | Abertura bloco 0 (IND_MOV sempre 0) | 1 | 1 | O |
| 0002 | Classificação estab. industrial | 2 | 1 | OC (O se IND_ATIV=0) |
| 0005 | Dados complementares | 2 | 1 | O |
| 0015 | Substituto/responsável ICMS destino (IE em outra UF) | 2 | V | OC |
| 0100 | Contabilista | 2 | 1 | O (se perfil A ou B) |
| 0150 | Participantes | 2 | V | OC |
| 0175 | Alteração participante | 3 | 1:N | OC |
| 0190 | Unidades de medida | 2 | V | OC |
| 0200 | Itens | 2 | V | OC |
| 0205 | Alteração do item | 3 | 1:N | OC |
| 0206 | Código ANP | 3 | 1:1 | OC |
| 0210 | Consumo específico padronizado | 3 | 1:N | OC |
| 0220 | Fatores de conversão | 3 | 1:N | OC |
| 0221 | Correlação itens comercializados | 3 | 1:N | OC |
| 0300 | Bens ativo imobilizado | 2 | V | OC |
| 0305 | Utilização do bem | 3 | 1:1 | OC |
| 0400 | Natureza da operação | 2 | V | OC |
| 0450 | Inf. complementar | 2 | V | OC |
| 0460 | Observações lançamento | 2 | V | OC |
| 0500 | Plano de contas | 2 | V | O (se existir 0300) |
| 0600 | Centro de custos | 2 | V | O (se existir 0305) |
| 0990 | Encerramento | 1 | 1 | O |

**Bloco B** (ISS – só DF): B001 (1,1,O), B020 (2,V), B025 (3,1:N), B030 (2,V), B035 (1:N), B350, B420, B440, B460 (2,V),
B470 (2,1), B500 (2,1), B510 (3,V), B990 (1,1,O). Fora do DF: só `|B001|1|` + `|B990|2|`.

**Bloco C** (níveis/ocorrências): C001 1/1; C100 2/V; C101 3/1:1; C105 3/1:1; C110 3/1:N; C111–C116 4/1:N;
C120 3/1:N; C130 3/1:1; C140 3/1:1; C141 4/1:N; C160 3/1:1; C165 3/1:N; C170 3/1:N; C171 4/1:N; C172 4/1:1;
C173 4/1:N; C174 4/1:N; C175 4/1:N; C176 4/1:N; C177 4/1:1 (tabela 2.6.1 do Cap. II Seção 1 diz 1:N em 2019); C178 4/1:1; C179 4/1:1;
C180 4/1:1; C181 4/1:N; C185 3/1:N; C186 3/1:N; C190 3/1:N; C191 4/1:1; C195 3/1:N; C197 4/1:N;
C300 2/V; C310 3/1:N; C320 3/1:N; C321 4/1:N; C330 5/1:1; C350 2/V; C370 3/1:N; C380 4/1:1; C390 3/1:N;
C400 2/V; C405 3/1:N; C410 4/1:1; C420 4/1:N; C425 5/1:N; C430 6/1:N; C460 4/1:N; C465 5/1:1; C470 5/1:N; C480 6/1:1; C490 4/1:N;
C495 2/V; C500 2/V; C510 3/1:N; C590 3/1:N; C591 4/1:1; C595 3/1:N; C597 4/1:N; C600 2/V; C601 3/1:N; C610 3/1:N; C690 3/1:N;
C700 2/V; C790 3/1:N; C791 4/1:N; C800 2/V; C810 3/1:N; C815 4/1:1; C850 3/1:N; C855 3/1:N; C857 4/1:N;
C860 2/V; C870 3/1:N; C880 4/1:1; C890 3/1:N; C895 3/1:N; C897 4/1:N; C990 1/1.

**Bloco D**: D001 1/1; D100 2/V; D101 3/1:1; D110 3/1:N; D120 4/1:N; D130 3/1:N; D140 3/1:1; D150 3/1:1; D160 3/1:N;
D161 4/1:1; D162 4/1:N; D170 3/1:1; D180 3/1:N; D190 3/1:N; D195 3/1:N; D197 4/1:N; D300 2/V; D301 3/1:N; D310 3/1:N;
D350 2/V; D355 3/1:N; D360 4/1:1; D365 4/1:N; D370 5/1:N; D390 4/1:N; D400 2/V; D410 3/1:N; D411 4/1:N; D420 3/1:N;
D500 2/V; D510 3/1:N; D530 3/1:N; D590 3/1:N; D600 2/V; D610 3/1:N; D690 3/1:N; D695 2/V; D696 3/1:N; D697 4/1:N;
D700 2/V; D730 3/1:N; D731 4/1:1; D735 3/1:N; D737 4/1:N; D750 2/1:N; D760 3/1:N; D761 4/1:1; D990 1/1.

**Bloco E**
| Reg | Descrição | Nív | Ocor | Obrig |
|---|---|---|---|---|
| E001 | Abertura (IND_MOV sempre 0) | 1 | 1 | O |
| E100 | Período apuração ICMS | 2 | V | O |
| E110 | Apuração ICMS próprio | 3 | 1:1 | O |
| E111 | Ajustes | 4 | 1:N | OC |
| E112 / E113 | Inf. adic. ajustes / docs | 5 | 1:N | OC |
| E115 | Valores declaratórios | 4 | 1:N | OC |
| E116 | Obrigações a recolher | 4 | 1:N | OC |
| E200 | Período ST (por UF) | 2 | V | OC |
| E210 | Apuração ST | 3 | 1:1 | O (se E200) |
| E220 / E230 / E240 / E250 | Ajustes ST / inf / docs / obrigações | 4/5/5/4 | 1:N | OC |
| E300 | Período DIFAL/FCP EC 87/15 (por UF) | 2 | 1:N (V) | OC |
| E310 | Apuração DIFAL/FCP | 3 | 1:1 | OC |
| E311 / E312 / E313 / E316 | | 4/5/5/4 | 1:N | OC |
| E500 | Período IPI | 2 | V | OC (O se IND_ATIV=0) |
| E510 | Consolidação IPI | 3 | 1:N | OC |
| E520 | Apuração IPI | 3 | 1:1 | O (se E500) |
| E530 / E531 | Ajustes IPI / docs | 4/5 | 1:N | OC |
| E990 | Encerramento | 1 | 1 | O |

**Bloco G** (CIAP): G001 1/1 O; G110 2/V OC; G125 3/1:N O(se G110); G126 4/1:N OC; G130 4/1:N O(se G125);
G140 5/1:N O(se G130); G990 1/1 O. Sem CIAP → só G001(IND_MOV=1)/G990.

**Bloco H** (inventário): H001 1/1 O; H005 2/V OC; H010 3/1:N OC; H020 4/1:N OC; H030 4/1:1 OC; H990 1/1 O.

**Bloco K**: K001 1/1 O; K010 2/1 OC; K100 2/V OC; K200 3/1:N; K210 3/1:N; K215 4/1:N; K220 3/1:N; K230 3/1:N; K235 4/1:N;
K250 3/1:N; K255 4/1:N; K260 3/1:N; K265 4/1:N; K270 3/1:N; K275 4/1:N; K280 3/1:N; K290 3/1:N; K291 4/1:N; K292 4/1:N;
K300 3/1:N; K301 4/1:N (O); K302 4/1:N (O); K990 1/1 O. Não obrigado ao RCPE → só K001(IND_MOV=1)/K990.

**Bloco 1**
| Reg | Descrição | Nív | Ocor | Obrig |
|---|---|---|---|---|
| 1001 | Abertura | 1 | 1 | O |
| 1010 | Obrigatoriedade de registros do bloco 1 (S/N por grupo) | 2 | 1 | O |
| 1100 / 1105 / 1110 | Exportação | 2/3/4 | V/1:N/1:N | OC |
| 1200 / 1210 | Controle créditos ICMS | 2/3 | V/1:N | OC |
| 1250 / 1255 | Saldos restituição/ressarc./complementação ICMS | 2/3 | 1:1/1:N | OC |
| 1300 | Movimentação diária combustíveis | 2 | V | OC |
| 1310 / 1320 | por tanque / volume vendas | 3/4 | 1:N | O(se 1300) / OC |
| 1350 / 1360 / 1370 | Bombas / lacres / bicos | 2/3/3 | V/1:N/1:N | O(se 1300) |
| 1390 / 1391 | Usina | 2/3 | V/1:1 (1:N no Cap. III) | OC |
| 1400 | Valor agregado (IPM) | 2 | V | OC |
| 1500 / 1510 | Energia interestadual | 2/3 | V/1:N | OC |
| 1600 | Cartão crédito/débito (até 31/12/2021) | 2 | V | OC |
| 1601 | Instrumentos de pagamento eletrônico (desde 01/01/2022) | 2 | 1:N (V) | OC |
| 1700 / 1710 | Documentos utilizados / cancelados-inutilizados | 2/3 | V/1:N | OC |
| 1800 | DCTA transporte aéreo | 2 | 1 | OC |
| 1900–1926 | Sub-apuração ICMS (só UFs com tabela 5.3 cód. 3/4/5) | 2–6 | | OC |
| 1960 / 1970 / 1975 / 1980 | GIAF (só PE) | 2/2/3/2 | 1:N/1:N/1:4/1 | OC |
| 1990 | Encerramento | 1 | 1 | O |

**Bloco 9**: 9001 1/1 O; 9900 2/V O; 9990 1/1 O; 9999 0/1 O.

**Arquivo mínimo "sem movimento" (comércio fora do DF, sem K/G/H):**
0000, 0001(0), 0005, 0100 (perfil A/B), [0150/0190/0200 se houver], 0990, B001(1), B990, C001(1), C990, D001(1), D990,
E001(0), E100, E110 (zerado), E990, G001(1), G990, H001(1)*, H990, K001(1), K990, 1001(0), 1010, 1990, 9001, 9900…, 9990, 9999.
\* **Fevereiro**: H001 IND_MOV deve ser 0 (inventário de 31/12, H005 com DT_INV=31/12 e MOT_INV=01; PVA dá advertência se faltar).
Obs.: 1001 com IND_MOV=0 porque 1010 é sempre obrigatório.

---

## 7. Regras que o validador precisa checar (gerais e cruzadas encontradas)

### Estrutura do arquivo
1. Primeira linha = 0000; última = 9999. Blocos presentes **todos** e na ordem 0, B, C, D, E, G, H, K, 1, 9.
2. Cada bloco tem x001 e x990 exatamente uma vez. Se x001.IND_MOV=1 → só x001 e x990 no bloco; se 0 → pelo menos um registro além de x990.
3. 0001.IND_MOV **= 0** sempre; E001.IND_MOV **= 0** sempre (E100 e E110 sempre presentes).
4. Registros de ocorrência "1" aparecem uma única vez; registros 1:1 no máx. um filho por pai.
5. Filho só existe após o pai correspondente; ordem hierárquica ascendente; filhos agrupados sob o pai.
6. Número de campos por registro = leiaute da versão (COD_VER) — nem mais, nem menos.
7. Linha começa e termina com `|`; sem `|` dentro de conteúdo; sem caracteres ASCII 0–31 em conteúdo; sem espaços nas pontas.
8. Não pode haver registro "N" para o perfil/direção (tabela seção 4) — ex.: C170 em perfil C; C100 modelo 65 em entrada.
9. Correlação modelo → registro (55/65 → C100, 57/67 → D100, etc.). Documento não pode ir a registro de outro modelo.
10. Mutuamente exclusivos: representação integral vs. resumo do mesmo documento conforme perfil.
11. Registros com condição "O (se existir X)": C190 se C100; C141 se C140; C170 se C100 (perfis A/B, com exceções); D190 se D100;
    E210 se E200; E520 se E500; G125 se G110; G130 se G125; G140 se G130; 0500 se 0300; 0600 se 0305; 1310/1350/1360/1370 se 1300.
12. 0002 e E500 obrigatórios se 0000.IND_ATIV=0; E500 proibido se IND_ATIV=1.
13. 0100 obrigatório em perfil A e B.
14. Não gerar registro vazio de informação (C110 sem texto, etc.).

### Totalizadores (Bloco 9 e x990)
15. x990.QTD_LIN_x = nº de linhas do bloco **incluindo** abertura e encerramento.
16. 9900: um por tipo de registro existente (inclusive 0000, 9900, 9990, 9999); QTD_REG_BLC = contagem real.
17. 9990.QTD_LIN_9 = linhas do bloco 9 **+ a linha 9999**.
18. 9999.QTD_LIN = total de linhas do arquivo (inclui a própria 9999).

### Registro 0000
19. COD_VER válido na data DT_FIN (tabela de versões).
20. COD_FIN ∈ {0,1}. Se 1 e hoje > último dia do 3º mês após a apuração → alertar "requer autorização SEFAZ" (Ajuste SINIEF 11/12, 27/20).
21. DT_INI e DT_FIN formato ddmmaaaa válidos, mesmo mês/ano; DT_INI = dia 1 e DT_FIN = último dia (senão alertar: só início/encerramento de atividade).
22. CNPJ xor CPF; DV do CNPJ/CPF; DV da IE conforme UF; DV SUFRAMA se informado.
23. COD_MUN existe na tabela IBGE (7 dígitos) — e pertence à UF.
24. IND_PERFIL ∈ {A,B,C} e **igual ao perfil cadastrado pelo Fisco** (senão PVA/SEFAZ rejeita).
25. IND_ATIV ∈ {0,1}.
26. Raiz CNPJ do certificado de assinatura = raiz do 0000.CNPJ, ou procuração eletrônica (checagem pré-transmissão).

### Formato de campos
27. N: somente dígitos + vírgula decimal; nº de casas decimais ≤ máximo do campo; sem sinal negativo.
28. Tamanho exato para campos com `*`; C ≤ 255 (ou tamanho específico).
29. Datas ddmmaaaa válidas.
30. Campos "O" preenchidos; em registros analíticos (C190, D190…) e no Bloco E todos os numéricos preenchidos (valor ou 0).
31. Campos de PIS/COFINS devem estar **vazios**.
32. Códigos validados contra tabelas externas vigentes (CFOP, CST, COD_SIT, municípios, tabelas 5.x da UF).
33. CFOPs "título" proibidos: 1000, 1100, 1150, 1200, 1250, 1300, 1350, 1400, 1450, 1500, 1550, 1600, 1900, 2000, 2100, 2150,
    2200, 2250, 2300, 2350, 2400, 2500, 2550, 2600, 2900, 3000, 3100, 3200, 3250, 3300, 3350, 3500, 3550, 3650, 3900, 5000, 5100,
    5150, 5200, 5250, 5300, 5350, 5400, 5450, 5500, 5550, 5600, 5650, 5900, 6000, 6100, 6150, 6200, 6250, 6300, 6350, 6400, 6500,
    6550, 6600, 6650, 6900, 7000, 7100, 7200, 7250, 7300, 7350, 7500, 7550, 7650, 7900.
34. CFOP sob o enfoque do declarante: entradas 1/2/3, saídas 5/6/7.
35. CST ICMS = origem (0–8) + tributação (00,02,10,15,20,30,40,41,50,51,53,60,61,70,90). Entradas de Simples: usar CST (não CSOSN).
    Matriz de preenchimento (S/N/?) por CST para ALIQ_ICMS, VL_BC_ICMS, VL_ICMS, VL_BC_ICMS_ST, VL_ICMS_ST, VL_RED_BC (Cap. IV 1.1).

### Documentos / período
36. COD_SIT ∈ {00,01,02,03,06,07,08}; **04 e 05 não permitidos desde jan/2023** (denegadas/inutilizadas fora do C100).
37. Extemporâneo (COD_SIT 01/03/07): DT_DOC e DT_E_S **fora** do período do 0000; saídas extemporâneas não entram na totalização do E110.
    Documento regular (00): DT_E_S dentro do período.
38. CC-e não gera registro — o documento deve refletir a versão corrigida.
39. Reforma tributária: VL_DOC (C100 etc.) **exclui** IBS/CBS/IS em 2026 e **inclui** a partir de 2027; VL_OPR (C190/D190…) **nunca** inclui.
    Conciliação Σ VL_OPR(C190) × VL_DOC(C100) deve tolerar diferença = IBS+CBS+IS a partir de 2027.
40. Registros dependentes de UF (C176, C179, C197, C597, D197, 1200, 1900+, 1960–1980, Bloco B) só se a UF (ES) os exigir/tiver tabela.
41. Bloco B fora do DF: B001 IND_MOV=1 + B990.
42. Bloco H: em **fevereiro** H001.IND_MOV=0 com H005 DT_INV=31/12 do ano anterior e MOT_INV=01 (advertência do PVA).
43. Bloco G sem CIAP → G001(1)+G990; Bloco K sem RCPE → K001(1)+K990.
44. Retificação: usar leiaute (COD_VER) do período original.
45. Arquivo por estabelecimento: 0000.CNPJ/IE únicos por (período); não misturar documentos de outra IE/filial.

### Auditoria (derivadas do Cap. I, para o módulo auditor)
- "Se existir a informação, o contribuinte está obrigado a prestá-la": cruzar XMLs recebidos/emitidos (SEFAZ/DFe) × C100 escriturados → omissões.
- Situações de isenção/não-incidência/diferimento/suspensão devem ter dispositivo legal (C195/C197/0460).
