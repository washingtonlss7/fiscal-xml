# EFD-Contribuições — Bloco 0 e Bloco A (notas de desenvolvimento)

Fonte: Guia Prático EFD-Contribuições v1.35 (18/06/2021), linhas 3181–5071 do TXT extraído.
Objetivo: gerar e validar o TXT automaticamente a partir de XML NF-e/NFC-e/CT-e (+ NFS-e quando houver) e cadastros (empresa, estabelecimentos, contador).

Legenda de origem dos dados:
- **CAD_EMP** = cadastro da empresa/PJ titular (matriz)
- **CAD_EST** = cadastro de estabelecimentos (filiais)
- **CAD_CONT** = cadastro do contador/escritório
- **CAD_FISCAL** = parametrização fiscal da empresa por período (regime, método de crédito etc.)
- **XML NF-e** = tags do XML (caminho `infNFe/...`)
- **CALC** = calculado pelo gerador
- **MANUAL** = input do usuário (não deriva de XML)

Convenções gerais do leiaute (valem para todos os registros; regra geral do manual, fora desta faixa, mas essenciais):
- Linha: `|REG|campo2|...|campoN|` + CRLF; campo vazio = `||`.
- Datas `ddmmaaaa` sem separadores. Numéricos com decimais usam vírgula (`1234,56`), sem separador de milhar.
- `*` no tamanho = tamanho FIXO (ex.: `N 014*` → CNPJ sempre 14 dígitos, com zeros à esquerda).
- Tam `-` = sem limite definido. Dec `02` = 2 casas decimais.
- Obrig `S` = sempre; `N` = condicional/opcional (ver regras).

---

## Mapa de hierarquia (ordem de geração no arquivo)

```
0000 (nível 0, 1 por arquivo)
  0001 (1)
    0035 (2) [1:N]          – só se 0000.IND_NAT_PJ ∈ {03,04,05}
    0100 (2) [vários]       – contabilista(s)
    0110 (2) [1]            – regimes
      0111 (3) [1:1]        – se 0110.IND_APRO_CRED = 2
    0120 (2) [vários]       – meses sem dados
    0140 (2) [vários]       – um por estabelecimento
      0145 (3) [1:1]        – CPRB (Bloco P)
      0150 (3) [1:N]        – participantes DO estabelecimento
      0190 (3) [1:N]        – unidades
      0200 (3) [1:N]        – itens
        0205 (4) [1:N]      – alteração do item
        0206 (4) [1:1]      – código ANP
        0208 (4) [1:1]      – bebidas frias (até 04/2015)
      0400 (3) [1:N]        – natureza da operação
      0450 (3) [1:N]        – informação complementar
    0500 (2) [vários]       – plano de contas
    0600 (2) [vários]       – centros de custo
    0900 (2) [1]            – composição das receitas (entrega fora do prazo)
  0990 (1)
A001 (1)
  A010 (2) [vários]         – por estabelecimento (CNPJ deve estar em 0140)
    A100 (3) [1:N]          – NFS
      A110 (4) [1:N]        – inf. complementar (→0450)
      A111 (4) [1:N]        – processo referenciado
      A120 (4) [1:N]        – importação de serviço
      A170 (4) [1:N]        – itens (→0200, 0500, 0600)
A990 (1)
```

**IMPORTANTE (arquitetura):** 0150/0190/0200/0400/0450 são nível 3, filhos de 0140 (o guia confirma isso explicitamente para 0145: "registro filho 0145 em relação ao registro pai 0140"). Ou seja, as tabelas de participantes/unidades/itens são **por estabelecimento**: cada 0140 carrega os participantes/itens/unidades referenciados pelos documentos daquele CNPJ nos Blocos A, C, D, F e 1. O gerador deve montar os cadastros por CNPJ de estabelecimento a partir dos documentos efetivamente escriturados sob o A010/C010/D010/F010 correspondente. 0500 e 0600 são nível 2 (globais do arquivo).

---

## Registro 0000 — Abertura do Arquivo Digital e Identificação da PJ

- Nível 0 · Ocorrência: 1 por arquivo · Obrigatório (primeiro registro).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0000" | C | 004* | - | S | fixo |
| 02 | COD_VER | Código da versão do leiaute (tabela 3.1.1) | N | 003* | - | S | CALC: tabela versão × DT_FIN |
| 03 | TIPO_ESCRIT | 0-Original; 1-Retificadora | N | 001* | - | S | MANUAL/fluxo (retificação) |
| 04 | IND_SIT_ESP | 0-Abertura; 1-Cisão; 2-Fusão; 3-Incorporação; 4-Encerramento | N | 001* | - | N | MANUAL (evento societário) |
| 05 | NUM_REC_ANTERIOR | Recibo da escrituração anterior (se TIPO_ESCRIT=1) | C | 041* | - | N | MANUAL / histórico de transmissões |
| 06 | DT_INI | Data inicial | N | 008* | - | S | período |
| 07 | DT_FIN | Data final | N | 008* | - | S | período |
| 08 | NOME | Nome empresarial | C | 100 | - | S | CAD_EMP (razão social) |
| 09 | CNPJ | CNPJ do estabelecimento **matriz** | N | 014* | - | S | CAD_EMP |
| 10 | UF | UF da PJ (sede) | C | 002* | - | S | CAD_EMP |
| 11 | COD_MUN | Município IBGE (7 dígitos) | N | 007* | - | S | CAD_EMP |
| 12 | SUFRAMA | Inscrição Suframa | C | 009* | - | N | CAD_EMP |
| 13 | IND_NAT_PJ | Natureza da PJ (ver abaixo) | N | 002* | - | N | CAD_EMP |
| 14 | IND_ATIV | Atividade preponderante (ver abaixo) | N | 001 | - | S | CAD_FISCAL |

IND_NAT_PJ (a partir de 2014): 00-PJ em geral (não sócia ostensiva de SCP); 01-Cooperativa (não sócia ostensiva); 02-Entidade PIS exclusivamente sobre Folha; 03-PJ em geral sócia ostensiva de SCP; 04-Cooperativa sócia ostensiva de SCP; 05-SCP.
IND_ATIV: 0-Industrial/equiparado; 1-Serviços; 2-Comércio; 3-PJ dos §§6º, 8º e 9º art. 3º Lei 9.718/98 (financeiras); 4-Imobiliária; 9-Outros. Se mais de uma atividade → a preponderante.

Regras de validação / geração:
- COD_VER validado conforme DT_FIN (versão vigente na data final). Manter tabela interna de versões (3.1.1 do ADE Cofis 34/2010) — o guia só cita "002" para PVA 1.01; **o código atual deve vir da tabela de versões** (não está nesta seção).
- Campo 04: preencher apenas em situação especial; senão vazio.
- Campo 05: só quando TIPO_ESCRIT=1; recibo **em letras maiúsculas**.
- DT_INI e DT_FIN no mesmo mês/ano. DT_INI = dia 1 (exceto abertura); DT_FIN = último dia do mês (exceto encerramento, fusão, cisão, incorporação).
- Regra: 1 escrituração por mês por PJ; exceção: cisão parcial (pode haver mais de um arquivo no mesmo mês). Incorporação: incorporadora entrega o mês inteiro (créditos vertidos no F800); incorporada entrega de 01 até a data do evento.
- NOME: sem acentos. Caracteres aceitos: `a-z A-Z espaço / , . - @ : & * + _ < > ( ) ! ? ' $ % 0-9` → **sanitizar** (remover acentos, trocar ç→c, remover demais).
- CNPJ: validar DV. É o da MATRIZ.
- COD_MUN: deve existir na tabela IBGE, 7 dígitos.
- SUFRAMA: se informado, validar DV; vazio se não houver.
- Com IND_NAT_PJ 03/04/05 → obrigatório 0035.

---

## Registro 0001 — Abertura do Bloco 0

- Nível 1 · Ocorrência: 1 · Obrigatório.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0001" | C | 004* | - | S | fixo |
| 02 | IND_MOV | 0-Com dados; 1-Sem dados | N | 001 | - | S | fixo **"0"** |

Regra: como 0110 e 0140 são sempre obrigatórios, IND_MOV é **sempre 0**.

---

## Registro 0035 — Identificação de SCP

- Nível 2 · Ocorrência 1:N · Obrigatório quando 0000.IND_NAT_PJ ∈ {03, 04, 05}. (Coluna Obrig em branco no guia.)
- IND_NAT_PJ 03/04 (sócia ostensiva): um 0035 para cada SCP em que é sócia ostensiva (não lista SCPs onde é participante).
- IND_NAT_PJ 05 (arquivo da própria SCP): exatamente 1 registro 0035.
- A sócia ostensiva transmite 1 EFD própria + 1 EFD por SCP, todas assinadas com o mesmo certificado. Documentos das SCP (mesmo emitidos com o CNPJ da ostensiva) vão nos blocos A, C, D, F, M, P da EFD da SCP e **não** na da ostensiva → nosso sistema precisa de um "de/para" documento→SCP (MANUAL/regra por CFOP/centro de custo).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0035" | C | 004* | - | (S) | fixo |
| 02 | COD_SCP | Identificação da SCP | N | 014* | - | (S) | CAD_EMP (cadastro de SCPs) |
| 03 | DESC_SCP | Descrição da SCP (objeto/atividade) | C | - | - | | CAD_EMP |
| 04 | INF_COMP | Informação complementar | C | - | - | | CAD_EMP |

Validação COD_SCP: 14 dígitos numéricos, sem formatação. Livre até 03/2021; **a partir de abril/2021 deve ser o CNPJ da SCP** (DV validado e base do CNPJ ≠ base do CNPJ do 0000).

---

## Registro 0100 — Dados do Contabilista

- Nível 2 · Ocorrência: vários · Obrigatório (mesmo que o contador seja empregado). Se houver mais de um contabilista responsável (escrituração por estabelecimento), informar todos.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0100" | C | 004* | - | S | fixo |
| 02 | NOME | Nome do contabilista | C | 100 | - | S | CAD_CONT |
| 03 | CPF | CPF do contabilista | N | 011* | - | S | CAD_CONT |
| 04 | CRC | Nº CRC (na UF da sede) | C | 015 | - | S | CAD_CONT |
| 05 | CNPJ | CNPJ do escritório | N | 014* | - | N | CAD_CONT |
| 06 | CEP | CEP | N | 008* | - | N | CAD_CONT |
| 07 | END | Logradouro | C | 060 | - | N | CAD_CONT |
| 08 | NUM | Número | C | - | - | N | CAD_CONT |
| 09 | COMPL | Complemento | C | 060 | - | N | CAD_CONT |
| 10 | BAIRRO | Bairro | C | 060 | - | N | CAD_CONT |
| 11 | FONE | Telefone | C | 11 | - | N | CAD_CONT |
| 12 | FAX | Fax | C | 11 | - | N | CAD_CONT |
| 13 | EMAIL | E-mail | C | - | - | N | CAD_CONT |
| 14 | COD_MUN | Município IBGE | N | 007* | - | N | CAD_CONT |

Validações: CPF (DV), CNPJ (DV, se informado), COD_MUN existente na tabela IBGE (7 dígitos). Remover formatação (".", "/", "-"). FONE/FAX máx. 11 caracteres (só dígitos). Para escritório com 600+ clientes: o contador vem de um cadastro único do escritório reutilizado em todas as empresas.

---

## Registro 0110 — Regimes de Apuração da Contribuição Social e de Apropriação de Crédito ⭐

- Nível 2 · Ocorrência: 1 por arquivo · **Obrigatório**.
- Define o regime de incidência do período (não cumulativo / cumulativo / ambos) e, no não cumulativo, o método de apropriação dos créditos comuns (adotado para o **ano-calendário** — manter o mesmo método jan–dez).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0110" | C | 004* | - | S | fixo |
| 02 | COD_INC_TRIB | 1-Exclusivamente não cumulativo; 2-Exclusivamente cumulativo; 3-Não cumulativo e cumulativo | N | 001* | - | S | CAD_FISCAL (regime tributário + análise dos CST do período) |
| 03 | IND_APRO_CRED | Método de apropriação de créditos comuns (se COD_INC_TRIB=1 ou 3): 1-Apropriação Direta; 2-Rateio Proporcional (Receita Bruta) | N | 001* | - | N | CAD_FISCAL (anual) |
| 04 | COD_TIPO_CONT | 1-Exclusivamente alíquota básica; 2-Alíquotas específicas (diferenciadas e/ou por unidade de medida) | N | 001* | - | N | CALC (a partir dos CST/alíquotas dos itens) |
| 05 | IND_REG_CUM | Critério no cumulativo (só COD_INC_TRIB=2, Lucro Presumido): 1-Caixa, consolidado F500; 2-Competência, consolidado F550; 9-Competência detalhado (Blocos A, C, D, F) | N | 001* | - | N | CAD_FISCAL |

### Regras de preenchimento/negócio

**Campo 02 – COD_INC_TRIB**
- Lucro Real típico → 1 (não cumulativo). Mas se houver receitas que por lei ficam no cumulativo (ex.: certas receitas de serviços, contratos pré-2003, etc.) → 3.
- Lucro Presumido/Arbitrado → 2.
- Regra de sanidade para o gerador: se existirem CST de débito com alíquotas 0,65/3,00 (cumulativo) E 1,65/7,60 (não cumulativo) no período → deve ser 3. Se CAD_FISCAL disser 1 mas aparecerem alíquotas cumulativas → alertar.

**Campo 03 – IND_APRO_CRED**
- Preencher quando COD_INC_TRIB = 1 ou 3 e a PJ tiver créditos vinculados a mais de um tipo de receita. Também obrigatório mesmo no exclusivamente não cumulativo quando os créditos estão vinculados a receitas de naturezas diversas:
  - tributadas no mercado interno;
  - não tributadas no mercado interno (alíquota zero, suspensão, isenção, não incidência);
  - exportação.
- 1 = Apropriação Direta (custos apurados pela contabilidade de custos integrada).
- 2 = Rateio Proporcional com base na Receita Bruta → **0111 obrigatório**.
- Relação com CST de crédito: CST 53, 54, 55, 56, 63, 64, 65, 66 (créditos vinculados a mais de um tipo de receita) só fazem sentido com IND_APRO_CRED preenchido. Na prática, o gerador deve: se houver CST 53–56/63–66 nos itens de entrada → exigir IND_APRO_CRED; se = 2 → gerar 0111.
- Se COD_INC_TRIB = 2 → deixar vazio.

**Campo 04 – COD_TIPO_CONT**
- 1: apuração só nas alíquotas básicas 0,65%/1,65% (PIS) e 3%/7,6% (Cofins).
- 2: há operações a alíquotas específicas — monofásicos (combustíveis; farmacêuticos, perfumaria, higiene; veículos, autopeças, pneus; bebidas frias e embalagens), regimes especiais (ZFM, ALC), mesmo que as demais receitas sejam à alíquota básica.
- **Validação PVA:** se = 2, deve existir M210/M610 com COD_CONT ∈ {02, 03, 52, 53}. Nenhuma validação para 1.
- CALC: se qualquer item de saída com CST 02 ou 03 (alíquota diferenciada/por unidade) → 2; senão 1. Atenção: revenda de monofásico pelo varejista usa CST 04 (alíquota zero) — **não** gera COD_CONT 02/03 → continua 1.

**Campo 05 – IND_REG_CUM**
- Só para COD_INC_TRIB = 2 (Lucro Presumido).
- 1 = caixa (F500), 2 = competência consolidado (F550), 9 = competência detalhado (Blocos A/C/D/F).
- Nota histórica do guia: o campo não existia nos PVA 1.07/2.00 (0110 com 4 campos); passou a existir a partir do PVA 2.01A (jul/2012). **Para geração atual, sempre emitir os 5 campos** (vazio quando não aplicável).
- Consequência na geração: com 1 ou 2 → as receitas vão consolidadas no F500/F550 (e não em C100/C170 detalhados para apuração); com 9 → escrituração detalhada a partir dos XML (C100/C170/C175/C181/C185 etc.). Para nosso produto baseado em XML, **9 é o caminho natural**; 2 (F550) é uma alternativa simplificada a partir da soma por CST/alíquota.

Matriz de consistência sugerida:

| COD_INC_TRIB | IND_APRO_CRED | COD_TIPO_CONT | IND_REG_CUM | 0111 |
|---|---|---|---|---|
| 1 | 1 ou 2 (se créditos comuns) | 1/2 | vazio | se IND_APRO_CRED=2 |
| 2 | vazio | 1/2 | 1, 2 ou 9 | não |
| 3 | 1 ou 2 | 1/2 | vazio | se IND_APRO_CRED=2 |

---

## Registro 0111 — Tabela de Receita Bruta Mensal para Rateio de Créditos Comuns ⭐

- Nível 3 (filho de 0110) · Ocorrência 1:1 · **Obrigatório se 0110.IND_APRO_CRED = 2**.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0111" | C | 004* | - | S | fixo |
| 02 | REC_BRU_NCUM_TRIB_MI | RB não cumulativa – tributada mercado interno | N | - | 02 | S | CALC |
| 03 | REC_BRU_NCUM_NT_MI | RB não cumulativa – não tributada MI (suspensão, alíquota zero, isenção, sem incidência) | N | - | 02 | S | CALC |
| 04 | REC_BRU_NCUM_EXP | RB não cumulativa – exportação | N | - | 02 | S | CALC |
| 05 | REC_BRU_CUM | RB cumulativa | N | - | 02 | S | CALC |
| 06 | REC_BRU_TOTAL | Soma 02+03+04+05 | N | - | 02 | S | CALC |

Regras:
- Valores **consolidados da PJ** (soma de todos os estabelecimentos) no mês.
- Validação: campo 06 = 02 + 03 + 04 + 05 (exato).
- Usados pelo PVA para ratear/validar M105 (PIS) e M505 (Cofins) para créditos com CST 53, 54, 55, 56, 63, 64, 65, 66.
- Conceito de Receita Bruta (Lei 12.973/2014, art. 12 DL 1.598/77, incluindo AVP): I venda de bens em conta própria; II preço de serviços; III resultado em conta alheia; IV receitas da atividade/objeto principal.
- **Excluir** do rateio: venda de ativo imobilizado (não operacional); receitas financeiras/aluguéis não próprias da atividade; reversões de provisões e recuperação de créditos baixados; resultado de equivalência patrimonial e dividendos.

Mapeamento automático sugerido (a partir das saídas escrituradas; CST PIS/Cofins do item):
- Campo 02: CST 01, 02, 03, 05 no regime não cumulativo (alíquotas 1,65/7,6, monofásicas ou específicas).
- Campo 03: CST 04 (monofásica alíquota zero na revenda), 06 (alíquota zero), 07 (isenta), 08 (sem incidência), 09 (suspensão) — mercado interno.
- Campo 04: exportação — CFOP 7.xxx, 5.501/5.502/6.501/6.502 (venda com fim específico de exportação), serviços a residente no exterior com ingresso de divisas (CST normalmente 08/09 + CFOP exterior). Separar do campo 03 pelo CFOP/destino (`dest/enderDest/cPais != 1058` ou `idDest=3`).
- Campo 05: receitas tributadas no cumulativo (alíquotas 0,65/3,00).
- Filtrar só CFOPs de receita bruta (vendas/serviços); excluir ativo (5.551/6.551), remessas, devoluções (deduzir devoluções de venda conforme política), transferências.
- Permitir **override MANUAL** (o valor contábil pode diferir do XML).

---

## Registro 0120 — Identificação de EFD-Contribuições Sem Dados a Escriturar

- Nível 2 · Ocorrência: vários.
- Usos:
  1. Na EFD de **dezembro** (ou do mês de encerramento), listar os meses do ano em que a PJ ficou dispensada (sem receitas e sem créditos) e **não** transmitiu.
  2. Desde 01/08/2017: obrigatório em QUALQUER mês em que a escrituração transmitida esteja "zerada" (sem operações em A, C, D, F, I, nem registros obrigatórios de M ou P) — senão o PVA gera erro.
- Dispensa (IN RFB 1.252/2012, art. 5º §§7º e 8º): PJ do Lucro Real/Presumido fica dispensada nos meses sem receita (tributável ou não) e sem operações geradoras de crédito — **exceto dezembro**.
- Regras de quantidade:
  - Jan–nov transmitido sem dados: um único 0120 (o do próprio mês) com o motivo.
  - Dezembro/encerramento: se meses anteriores sem dados foram transmitidos → um único 0120 (dezembro); se não foram transmitidos → um 0120 **para cada mês dispensado**.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0120" | C | 004* | - | S | fixo |
| 02 | MES_REFER | Mês/ano sem dados, formato `mmaaaa` | C | 006* | - | S | CALC (meses sem XML/lançamentos) |
| 03 | INF_COMP | Motivo (código de 2 caracteres, até 90 caracteres no total) | C | 090 | - | S | MANUAL/CAD_FISCAL |

Códigos do campo 03: 01-PJ imune ou isenta do IRPJ (≈ IND_NAT_PJ "02"); 02-Órgãos públicos, autarquias e fundações públicas; 03-PJ inativa; 04-PJ em geral sem operações geradoras de receitas ou créditos; 05-SCP sem operações; 06-Cooperativa sem operações; 07-Escrituração decorrente de incorporação/fusão/cisão sem operações; 99-Demais hipóteses do art. 5º da IN RFB 1.252/2012.

Regra do gerador: manter histórico por empresa/ano dos meses transmitidos vs. dispensados; em dezembro, gerar automaticamente os 0120 dos meses sem movimento não transmitidos. Se o arquivo não tem nenhum registro de receita/crédito → forçar 0120 do mês.

---

## Registro 0140 — Tabela de Cadastro de Estabelecimentos

- Nível 2 · Ocorrência: vários (um por estabelecimento que se enquadra).
- Obrigatório para a **matriz**. Demais estabelecimentos só se, no período, auferiram receita (tributada ou não), fizeram operações com crédito ou sofreram retenção na fonte (operações dos Blocos A, C, D, F, ou extemporâneas do Bloco 1).
- Estabelecimento no exterior COM CNPJ: informar 0140 com o CNPJ dele, mas UF e COD_MUN da sede (0000). SEM CNPJ: não gerar 0140; operações vão no conjunto do estabelecimento sede (separar por plano de contas).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0140" | C | 004* | - | S | fixo |
| 02 | COD_EST | Código do estabelecimento (livre) | C | 060 | - | N | CAD_EST (id interno) |
| 03 | NOME | Nome empresarial do estabelecimento | C | 100 | - | S | CAD_EST / `emit/xNome` |
| 04 | CNPJ | CNPJ do estabelecimento | N | 014* | - | S | CAD_EST / `emit/CNPJ` |
| 05 | UF | UF | C | 002* | - | S | CAD_EST / `emit/enderEmit/UF` |
| 06 | IE | IE (contribuinte ICMS) | C | 014 | - | N | CAD_EST / `emit/IE` |
| 07 | COD_MUN | Município IBGE | N | 007* | - | S | CAD_EST / `emit/enderEmit/cMun` |
| 08 | IM | Inscrição Municipal | C | - | - | N | CAD_EST / `emit/IM` |
| 09 | SUFRAMA | Inscrição Suframa | C | 009* | - | N | CAD_EST |

Validações: CNPJ (DV); IE validada conforme UF derivada dos 2 primeiros dígitos do COD_MUN — **se o estabelecimento tiver mais de uma IE, deixar vazio**; COD_MUN existente (7 dígitos); SUFRAMA DV se informado.

Relação com demais registros:
- Todo CNPJ em A010, C010, D010, F010 (e I010, P010) deve existir em um 0140.
- Filhos 0145/0150/0190/0200/0400/0450 são listados sob o 0140 do estabelecimento cujos documentos os referenciam.

---

## Registro 0145 — Regime de Apuração da Contribuição Previdenciária sobre a Receita Bruta (CPRB)

- Nível 3 (filho de 0140) · Ocorrência 1:1 · Informativo (não transfere valores).
- Informar se a PJ auferiu receitas das atividades/produtos dos arts. 7º e 8º da Lei 12.546/2011 e é contribuinte da CPRB (obrigatória ou por opção). Habilita o Bloco P. Sem essas receitas → não gerar 0145 nem Bloco P.
- A partir do PVA 2.02: basta informar sob o 0140 da matriz; habilita P100 para todos os estabelecimentos.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0145" | C | 004* | - | S | fixo |
| 02 | COD_INC_TRIB | 1-CPRB exclusivamente sobre receita bruta; 2-CPRB sobre receita bruta e sobre remunerações (art. 22, I e III, Lei 8.212/91) | N | 001* | - | S | CAD_FISCAL |
| 03 | VL_REC_TOT | Receita bruta total da PJ no período | N | - | 02 | S | CALC (consolidado da PJ) |
| 04 | VL_REC_ATIV | RB das atividades sujeitas à CPRB | N | - | 02 | S | CALC (por NCM/CNAE/cód. serviço sujeitos) + MANUAL |
| 05 | VL_REC_DEMAIS_ATIV | RB das atividades não sujeitas | N | - | 02 | N | CALC |
| 06 | INFO_COMPL | Informação complementar | C | - | - | N | MANUAL |

Regras: valores são da **PJ consolidada** (mesmo valor repetido em cada 0145 se houver vários). Validação: 04 + 05 ≤ 03. Receita bruta sem ajuste AVP para os campos 03–05 (texto inicial), porém o guia também manda considerar valores de AVP no Bloco P — há contradição no próprio guia; seguir o PVA.

---

## Registro 0150 — Tabela de Cadastro do Participante

- Nível 3 (filho de 0140) · Ocorrência 1:N.
- Todos os participantes (clientes/fornecedores PF ou PJ) referenciados via COD_PART nos Blocos A, C, D, F e 1.
- NF-e (55): escrituração consolidada (C180 vendas / C190 aquisições) → participante **não** precisa estar no 0150 se só aparece em C180/C190. Escrituração individualizada (C100/C170) → obrigatório.
- Não obrigatório quando o registro do bloco identifica o participante diretamente por CNPJ/CPF (campo próprio).
- Consórcio (arts. 278/279 Lei 6.404/76): um 0150 específico para cada consórcio.
- Pode haver 0150 com os dados do próprio contribuinte (documentos emitidos contra si mesmo).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem (NF-e) |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0150" | C | 004* | - | S | fixo |
| 02 | COD_PART | Código do participante no arquivo | C | 060 | - | S | CALC (sugestão: CNPJ/CPF, ou id interno estável) |
| 03 | NOME | Nome/razão social | C | 100 | - | S | `dest/xNome` (saída) ou `emit/xNome` (entrada) |
| 04 | COD_PAIS | Código do país (tabela 3.2.1) — Brasil 01058 ou 1058 | N | 005 | - | S | `enderDest/cPais` / `enderEmit/cPais` (default 1058) |
| 05 | CNPJ | CNPJ | N | 014* | - | N | `dest/CNPJ` / `emit/CNPJ` |
| 06 | CPF | CPF | N | 011* | - | N | `dest/CPF` / `emit/CPF` |
| 07 | IE | Inscrição Estadual | C | 014 | - | N | `dest/IE` / `emit/IE` |
| 08 | COD_MUN | Município IBGE | N | 007* | - | N | `enderDest/cMun` / `enderEmit/cMun` |
| 09 | SUFRAMA | Inscrição Suframa | C | 009* | - | N | `dest/ISUF` |
| 10 | END | Logradouro | C | 060 | - | N | `xLgr` (exterior: incluir cidade e país) |
| 11 | NUM | Número | C | - | - | N | `nro` |
| 12 | COMPL | Complemento | C | 060 | - | N | `xCpl` |
| 13 | BAIRRO | Bairro | C | 060 | - | N | `xBairro` |

Para CT-e: remetente/destinatário/tomador/emitente conforme papel (`rem`, `dest`, `toma3/toma4`, `emit`). NFC-e (65): normalmente sem participante (consumidor final) — escrituração via C175/C180-C185 (não exige 0150).

Validações:
- COD_PART: livre (item 2.4.2.1 do Manual); único no arquivo por estabelecimento; todo COD_PART usado em A100/C100/D100 etc. **deve existir** no 0150 do mesmo 0140.
- COD_PAIS: deve existir na Tabela de Países; aceita 5 ou 4 caracteres; **informar também para Brasil**.
- CNPJ/CPF: DV validado; **mutuamente excludentes**; exatamente um deles obrigatório quando COD_PAIS = Brasil. Se exterior → ambos vazios.
- Venda a consumidor final (NFC-e/ECF) → CNPJ/CPF podem ser vazios. PF estrangeira → CPF vazio.
- IE validada pela UF dos 2 primeiros dígitos do COD_MUN. Tratar `dest/IE` = "ISENTO" → vazio. Pegar IE somente se `indIEDest` = 1.
- COD_MUN: obrigatório se Brasil (existir na tabela IBGE); exterior → vazio ou "9999999".
- SUFRAMA: DV se informado.
- Deduplicação: mesmo CNPJ/CPF com dados diferentes no período → usar a ocorrência mais recente (ou a do cadastro) e manter COD_PART único.

---

## Registro 0190 — Identificação das Unidades de Medida

- Nível 3 (filho de 0140) · Ocorrência 1:N.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0190" | C | 004* | - | S | fixo |
| 02 | UNID | Código da unidade | C | 006 | - | S | `det/prod/uCom` (ou unidade de-para interna) |
| 03 | DESCR | Descrição da unidade | C | - | - | S | tabela interna (ex.: UN→"UNIDADE") |

Validações: UNID e DESCR **não podem ser iguais** (gerar descrição por tabela; fallback "UNIDADE " + código). UNID até 6 caracteres (truncar/normalizar: maiúsculas, sem espaços). Toda unidade referenciada em 0200.UNID_INV, C170.UNID etc. deve existir no 0190 do mesmo estabelecimento. Gerar só as unidades efetivamente usadas.

---

## Registro 0200 — Tabela de Identificação do Item (Produtos e Serviços)

- Nível 3 (filho de 0140) · Ocorrência 1:N.
- Itens das operações (receitas e/ou créditos) nos Blocos A, C, D, F ou 1. Todo COD_ITEM referenciado em A170, C170, C181/C185, C191/C195 etc. deve existir aqui.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0200" | C | 004 | - | S | fixo |
| 02 | COD_ITEM | Código do item (próprio do informante) | C | 060 | - | S | saída: `det/prod/cProd`; entrada: de-para cProd fornecedor → código próprio |
| 03 | DESCR_ITEM | Descrição | C | - | - | S | `det/prod/xProd` (ou cadastro próprio) |
| 04 | COD_BARRA | Código de barras | C | - | - | N | `cEAN` (vazio se "SEM GTIN") |
| 05 | COD_ANT_ITEM | Código anterior do item | C | 060 | - | N | histórico de cadastro |
| 06 | UNID_INV | Unidade de estoque | C | 006 | - | N | `uCom`/cadastro (deve existir em 0190) |
| 07 | TIPO_ITEM | Tipo do item (ver lista) | N | 002* | - | S | cadastro / heurística por CFOP |
| 08 | COD_NCM | NCM | C | 008 | - | N | `det/prod/NCM` |
| 09 | EX_IPI | Código EX TIPI | C | 003 | - | N | `det/prod/EXTIPI` |
| 10 | COD_GEN | Gênero (tabela 4.2.1 = capítulo NCM; "00" = serviço) | N | 002* | - | N | CALC: 2 primeiros dígitos do NCM |
| 11 | COD_LST | Código de serviço LC 116/03 (4 dígitos, ou "XX.XX" desde PVA 2.11/maio 2015) | N | 004/005 | - | N | `det/prod/ISSQN/cListServ` ou NFS-e `ItemListaServico` |
| 12 | ALIQ_ICMS | Alíquota ICMS em operações internas | N | 006 | 02 | N | `ICMS/pICMS` de saída interna ou cadastro |

TIPO_ITEM: 00-Mercadoria para revenda; 01-Matéria-prima; 02-Embalagem; 03-Produto em processo; 04-Produto acabado; 05-Subproduto; 06-Produto intermediário; 07-Material de uso e consumo; 08-Ativo imobilizado; 09-Serviços; 10-Outros insumos; 99-Outras.

Regras/observações:
- COD_ITEM: código **do próprio informante**, o mesmo em todos os documentos (emissão, entrada, qualquer arquivo ao Fisco). Para NF-e de ENTRADA o `cProd` é do fornecedor → nosso sistema precisa de tabela de-para (fornecedor+cProd → item próprio) ou geração de código sintético estável (ex.: `CNPJforn-cProd`) — decisão de produto; alertar que o ideal é o código do ERP do cliente.
- Informar dados da última ocorrência do período (descrição, NCM etc.).
- DESCR_ITEM: vedadas descrições diferentes para o mesmo item e descrições genéricas, salvo: uso/consumo sem crédito; ativo imobilizado por gênero; consolidações de energia, água, gás, telecom.
- UNID_INV: se informado, deve existir em 0190.UNID.
- TIPO_ITEM: se o mesmo código tem mais de uma destinação, usar a mais relevante; destinação inicial. Heurística: CFOP 1.102/2.102/5.102 → 00; 1.101/2.101 → 01; 1.556/2.556 → 07; 1.551/2.551 → 08; 5.101/6.101 (produção própria) → 04; serviços (ISSQN) → 09.
- NCM obrigatório para: industriais/equiparados (itens da atividade-fim); agroindústria (itens com crédito presumido); quem exporta/importa; atacadistas/industriais em vendas com alíquota zero/suspensão/isenção/não incidência vinculadas a NCM. Demais casos opcional → **como vem do XML, sempre preencher** (NF-e tem NCM obrigatório; para serviço NCM "00" → deixar vazio).
- COD_GEN: obrigatório na aquisição de produtos primários; deve existir na tabela 4.2.1. Derivar dos 2 primeiros dígitos do NCM; serviço = "00".
- ALIQ_ICMS: não preencher para itens por gênero (ativo) ou item centralizado na matriz com alíquotas diferentes por UF.

---

## Registro 0205 — Alteração do Item

- Nível 4 (filho de 0200) · Ocorrência 1:N.
- Informa alteração na descrição (sem descaracterizar o produto) ou alteração do código do item. Se não houve movimento no período da alteração → informar no primeiro período com movimento. Sem sobreposição de períodos entre registros.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0205" | C | 004* | - | S | fixo |
| 02 | DESCR_ANT_ITEM | Descrição anterior | C | - | - | N | histórico do cadastro |
| 03 | DT_INI | Início de uso da descrição anterior | N | 008* | - | S | histórico |
| 04 | DT_FIM | Fim de uso da descrição anterior | N | 008* | - | S | histórico |
| 05 | COD_ANT_ITEM | Código anterior | C | 060 | - | N | histórico |

Validações: datas válidas `ddmmaaaa`; DT_FIM < 0000.DT_FIN. Gerador: detectar mudança de `xProd` para o mesmo COD_ITEM entre períodos/documentos (versionar cadastro de itens com vigência).

---

## Registro 0206 — Código de Produto conforme Tabela ANP (Combustíveis)

- Nível 4 (filho de 0200) · Ocorrência 1:1.
- Apenas produtores, importadores e distribuidores de combustíveis (varejo/posto não precisa).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0206" | C | 004 | - | S | fixo |
| 02 | COD_COMB | Código do combustível (Tabela ANP/SIMP tabela 12) | C | - | - | S | `det/prod/comb/cProdANP` |

Validação: código existente na tabela ANP; obrigatório quando produto é combustível e informante é produtor/importador/distribuidor (flag no CAD_FISCAL).

---

## Registro 0208 — Código de Grupos por Marca Comercial – REFRI (bebidas frias)

- Nível 4 (filho de 0200) · Ocorrência 1:1.
- Industrial/importador de bebidas frias optante do regime especial por litro (Lei 10.833/03, Decreto 6.707/08). **Não aplicável a fatos geradores a partir de maio/2015** (Lei 13.097/2015) → na prática o gerador NÃO deve gerar para períodos ≥ 05/2015.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0208" | C | 004* | - | S | fixo |
| 02 | COD_TAB | Tabela de incidência Anexo III Dec. 6.707/08: 01–12 (13 a partir de out/2012) | C | 002 | - | S | MANUAL |
| 03 | COD_GRU | Grupo (Anexo III); Tabelas I e II → "SN" | C | 002 | - | S | MANUAL |
| 04 | MARCA_COM | Marca comercial (se não listada, adota menor valor do tipo) | C | 060 | - | S | MANUAL |

---

## Registro 0400 — Tabela de Natureza da Operação/Prestação

- Nível 3 (filho de 0140) · Ocorrência 1:N.
- Codifica os textos de natureza da operação dos documentos (não é CFOP; agrupamentos próprios). Código livre; sem COD_NAT duplicado.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0400" | C | 004 | - | S | fixo |
| 02 | COD_NAT | Código da natureza | C | 010 | - | S | CALC (hash/sequencial do texto) |
| 03 | DESCR_NAT | Descrição | C | - | - | S | `ide/natOp` |

Gerar apenas se algum registro filho (ex.: C170.COD_NAT) referenciar. Deduplicar por texto normalizado.

---

## Registro 0450 — Tabela de Informação Complementar do Documento Fiscal

- Nível 3 (filho de 0140) · Ocorrência 1:N.
- Codifica os textos de "Dados Adicionais" exigidos pela legislação (ex.: ADE de suspensão para preponderantemente exportadora, referência a outro documento nas entradas). Código livre; sem COD_INF duplicado.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0450" | C | 004* | - | S | fixo |
| 02 | COD_INF | Código da informação complementar | C | 006 | - | S | CALC |
| 03 | TXT | Texto livre (norma, número, data, capitulação etc.) | C | - | - | S | `infAdic/infCpl` / `infAdic/infAdFisco` / NFS-e `OutrasInformacoes` |

Referenciado por A110.COD_INF e C110.COD_INF. Gerar só os usados. Sugestão: não despejar todo `infCpl` — só quando relevante (suspensão, processo, referência).

---

## Registro 0500 — Plano de Contas Contábeis

- Nível 2 · Ocorrência: vários.
- Apenas contas referenciadas em COD_CTA nos Blocos A, C, D, F, I, M e P. Sem duplicidade na combinação DT_ALT + COD_CTA + COD_CTA_REF.
- **COD_CTA obrigatório** a partir de 01/11/2017 (antes: aviso; depois: erro) para: PJ não cumulativa (Lucro Real) e PJ cumulativa por competência (Lucro Presumido/Arbitrado, IND_REG_CUM 2 ou 9).
- Lucro Presumido dispensado de ECD (IN RFB 1.774/2017): pode informar em COD_CTA o texto **"Dispensa de ECD - IN RFB nº 1.774/2017"** (opcional).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0500" | C | 004* | - | S | fixo |
| 02 | DT_ALT | Data inclusão/alteração | N | 008* | - | S | plano de contas do cliente |
| 03 | COD_NAT_CC | 01-Ativo; 02-Passivo; 03-PL; 04-Resultado; 05-Compensação; 09-Outras | C | 002* | - | S | plano de contas |
| 04 | IND_CTA | S-Sintética; A-Analítica | C | 001* | - | S | plano de contas |
| 05 | NIVEL | Nível da conta (crescente do menor detalhamento) | N | 005 | - | S | plano de contas |
| 06 | COD_CTA | Código da conta (até 255 desde PVA 2.1.1) | C | 255 | - | S | plano de contas |
| 07 | NOME_CTA | Nome da conta | C | 060 | - | S | plano de contas |
| 08 | COD_CTA_REF | Conta do Plano Referencial RFB | C | 060 | - | N | plano de contas (mapeamento referencial) |
| 09 | CNPJ_EST | CNPJ do estabelecimento se conta específica | N | 014* | - | N | plano de contas |

Validações: DT_ALT ≤ 0000.DT_FIN; COD_NAT_CC ∈ {01,02,03,04,05,09}; IND_CTA ∈ {S,A}.
Orientação: em registros por item (A170, C170, C181/C185) usar a conta analítica do item se existir; em consolidados (C175) pode ser a sintética.
Origem no nosso sistema: **não vem do XML**. Importar plano de contas do escritório contábil (Domínio, etc.) + regra de de-para CFOP/CST → conta (por empresa). Sem isso, a geração para Lucro Real falha validação a partir de 11/2017.

---

## Registro 0600 — Centro de Custos

- Nível 2 · Ocorrência: vários. Sem duplicidade DT_ALT + COD_CCUS.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "0600" | C | 004* | - | S | fixo |
| 02 | DT_ALT | Data inclusão/alteração | N | 008* | - | S | MANUAL/contábil |
| 03 | COD_CCUS | Código do centro de custos (até 255) | C | 255 | - | S | MANUAL/contábil |
| 04 | CCUS | Nome do centro de custos | C | 060 | - | S | MANUAL/contábil |

Validação: DT_ALT ≤ DT_FIN. Gerar só se algum COD_CCUS (ex.: A170.18) for referenciado.

---

## Registro 0900 — Composição das Receitas do Período (Receita Bruta e Demais Receitas)

- Nível 2 · Ocorrência 1.
- **Obrigatório quando o arquivo ORIGINAL é transmitido após o prazo** regular (após o 10º dia útil do 2º mês subsequente ao período). Gerador: comparar data de geração/transmissão com o prazo → incluir automaticamente.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "0900" | C | 004* | - | S |
| 02 | REC_TOTAL_BLOCO_A | Receita total Bloco A | N | - | 02 | S |
| 03 | REC_NRB_BLOCO_A | Parcela não receita bruta (Bloco A) | N | - | 02 | N |
| 04 | REC_TOTAL_BLOCO_C | Receita total Bloco C | N | - | 02 | S |
| 05 | REC_NRB_BLOCO_C | Parcela não RB (Bloco C) | N | - | 02 | N |
| 06 | REC_TOTAL_BLOCO_D | Receita total Bloco D | N | - | 02 | S |
| 07 | REC_NRB_BLOCO_D | Parcela não RB (Bloco D) | N | - | 02 | N |
| 08 | REC_TOTAL_BLOCO_F | Receita total Bloco F | N | - | 02 | S |
| 09 | REC_NRB_BLOCO_F | Parcela não RB (Bloco F) | N | - | 02 | N |
| 10 | REC_TOTAL_BLOCO_I | Receita total Bloco I | N | - | 02 | S |
| 11 | REC_NRB_BLOCO_I | Parcela não RB (Bloco I) | N | - | 02 | N |
| 12 | REC_TOTAL_BLOCO_1 | Receita total Bloco 1 (RET) | N | - | 02 | S |
| 13 | REC_NRB_BLOCO_1 | Parcela não RB (Bloco 1) | N | - | 02 | N |
| 14 | REC_TOTAL_PERIODO | Soma 02+04+06+08+10+12 | N | - | 02 | S |
| 15 | REC_TOTAL_NRB_PERIODO | Soma 03+05+07+09+11+13 | N | - | 02 | N |

Origem: tudo CALC a partir dos registros gerados (a parcela "não receita bruta" — campos ímpares — depende de classificação por CFOP/conta: ex. venda de imobilizado, receitas financeiras; permitir MANUAL).

Validações (somente CST_COFINS ∈ {01,02,03,04,05,06,07,08,09}):
- 02 = Σ A170.VL_ITEM.
- 04 = Σ de: C170.VL_ITEM (C100.COD_MOD ≠ 55 e IND_OPER=1); C170.VL_ITEM (COD_MOD = 55, IND_OPER=1, C010.IND_ESCRI ≠ 1); C175.VL_OPER; C185.VL_ITEM (C010.IND_ESCRI ≠ 2 ou C180.COD_MOD = 65); C385.VL_ITEM; C485.VL_ITEM (IND_ESCRI ≠ 1); C495.VL_ITEM (IND_ESCRI ≠ 2); C605.VL_ITEM; C870.VL_ITEM; C880.VL_ITEM.
- 06 = Σ D205.VL_ITEM + D300.VL_DOC + D350.VL_BRT + D605.VL_ITEM.
- 08 = Σ F100.VL_OPER (IND_OPER 1 ou 2) + F200.VL_TOT_REC + F500.VL_REC_CAIXA + F510.VL_REC_CAIXA + F550.VL_REC_COMP + F560.VL_REC_COMP.
- 10 = Σ I100.VL_REC.
- 12 = Σ 1800.REC_RECEB_RET + 1800.REC_FIN_RET.
- 14 = soma dos totais; 15 = soma das parcelas NRB.
(Obs.: o guia numera erroneamente "Campo 08" para REC_NRB_BLOCO_D; o correto é 07.)

Nota: o 0900 depende dos blocos C/D/F/I/1 → gerar o Bloco 0 **por último** (ou em duas passadas) para poder calcular 0900, 0150/0190/0200 referenciados e 0990.

---

## Registro 0990 — Encerramento do Bloco 0

- Nível 1 · Ocorrência 1 · Obrigatório.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "0990" | C | 004 | - | S |
| 02 | QTD_LIN_0 | Total de linhas do Bloco 0 | N | - | - | S |

CALC: contar todas as linhas do bloco 0, incluindo 0000, 0001 e o próprio 0990 (regra geral de encerramento de bloco; ver A990).

---

# BLOCO A — Documentos Fiscais – Serviços (sujeitos ao ISS)

Escopo: prestação (receita) e contratação (crédito) de serviços documentados em NFS-e/NF de serviço municipal que **não** estejam nos Blocos C, D ou F. Serviços já escriturados em C, D ou F não vão ao A. Documento equivalente (quando o município dispensa NF de serviço) → F100.

Origem de dados: **não vem de NF-e/NFC-e/CT-e**. Fonte = XML de NFS-e (padrão ABRASF por município ou padrão nacional NFS-e/ADN) quando o sistema capturar; caso contrário, importação/lançamento MANUAL. NF-e conjugada (modelo 55 com ISSQN) vai no Bloco C, não no A.

## Registro A001 — Abertura do Bloco A

- Nível 1 · Ocorrência 1 · Obrigatório.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "A001" | C | 004* | - | S | fixo |
| 02 | IND_MOV | 0-Com dados; 1-Sem dados | C | 001 | - | S | CALC |

Validação: IND_MOV=1 → apenas A001 e A990; IND_MOV=0 → pelo menos um registro além de abertura/encerramento.

## Registro A010 — Identificação do Estabelecimento

- Nível 2 · Ocorrência: vários · Obrigatório se A001.IND_MOV=0.
- Só estabelecimentos que tiveram operações de serviço com documento fiscal a escriturar no A. Cada A010 agrupa os A100 daquele CNPJ.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "A010" | C | 004* | - | S | fixo |
| 02 | CNPJ | CNPJ do estabelecimento | N | 014* | - | S | NFS-e: prestador (saída) ou tomador (entrada) quando = CNPJ da empresa |

Validação: DV do CNPJ; **deve existir em 0140**.

## Registro A100 — Documento – Nota Fiscal de Serviço

- Nível 3 · Ocorrência 1:N · Um por documento. **Todo A100 exige pelo menos um A170.**
- Documento cancelado (COD_SIT=02): preencher somente COD_SIT, IND_OPER, IND_EMIT, NUM_DOC, SER, SUB e COD_PART (SER/SUB opcionais; COD_PART obrigatório em contratação). (Implica: sem A170 para cancelado? O guia exige A170 para todo A100 — tratar conforme PVA; na prática cancelado não leva itens.)
- Chave de unicidade:
  - IND_EMIT=1 (terceiros): IND_OPER + IND_EMIT + COD_PART + COD_SIT + SER + NUM_DOC.
  - IND_EMIT=0 (própria): IND_OPER + IND_EMIT + COD_SIT + SER + NUM_DOC.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem (NFS-e) |
|---|---|---|---|---|---|---|---|
| 01 | REG | "A100" | C | 004* | - | S | fixo |
| 02 | IND_OPER | 0-Serviço contratado; 1-Serviço prestado | C | 001* | - | S | CALC (empresa é tomador → 0; prestador → 1) |
| 03 | IND_EMIT | 0-Emissão própria; 1-Terceiros | C | 001* | - | S | CALC (prestador = CNPJ do A010 → 0) |
| 04 | COD_PART | Participante (→0150): emitente (terceiros) ou adquirente (prestado) | C | 060 | - | N | tomador/prestador → 0150 |
| 05 | COD_SIT | 00-Regular; 02-Cancelado | N | 002* | - | S | status/cancelamento NFS-e |
| 06 | SER | Série | C | 020 | - | N | `Serie` (RPS/NFS-e) |
| 07 | SUB | Subsérie | C | 020 | - | N | - |
| 08 | NUM_DOC | Número (ou "SN") | C | 060 | - | S | `Numero` NFS-e |
| 09 | CHV_NFSE | Chave/código de verificação | C | 060 | - | N | `CodigoVerificacao` / chave de acesso NFS-e nacional |
| 10 | DT_DOC | Data de emissão | N | 008* | - | S | `DataEmissao` |
| 11 | DT_EXE_SERV | Data de execução/conclusão | N | 008* | - | N | `Competencia` ou DT_DOC |
| 12 | VL_DOC | Valor total do documento | N | - | 02 | S | `ValorServicos` |
| 13 | IND_PGTO | 0-À vista; 1-A prazo; 9-Sem pagamento | C | 001* | - | S | MANUAL/default (não costuma vir na NFS-e) |
| 14 | VL_DESC | Desconto total | N | - | 02 | N | `DescontoIncondicionado` (+condicionado conforme política) |
| 15 | VL_BC_PIS | Base PIS | N | - | 02 | S | CALC Σ A170.10 |
| 16 | VL_PIS | Valor PIS (débito/crédito) | N | - | 02 | S | CALC Σ A170.12 |
| 17 | VL_BC_COFINS | Base Cofins | N | - | 02 | S | CALC Σ A170.14 |
| 18 | VL_COFINS | Valor Cofins | N | - | 02 | S | CALC Σ A170.16 |
| 19 | VL_PIS_RET | PIS retido na fonte | N | - | 02 | N | `ValorPis` retido (quando retenção) |
| 20 | VL_COFINS_RET | Cofins retida na fonte | N | - | 02 | N | `ValorCofins` retido |
| 21 | VL_ISS | Valor do ISS | N | - | 02 | N | `ValorIss` |

Regras:
- Serviços contratados do exterior com crédito (Lei 10.865/04) → gerar A120.
- Operações sem NF de serviço (ou documento internacional) → F100, não A100.
- IND_EMIT=0 somente se emitido pelo próprio estabelecimento do A010; outra filial da mesma empresa = terceiros.
- COD_PART: deve existir no 0150; obrigatório em contratação (crédito); dispensável para prestação a consumidor final.
- NUM_DOC sem número → "SN".
- DT_DOC **ou** DT_EXE_SERV deve estar dentro de DT_INI..DT_FIN do 0000. Se não houver data de execução: usar data de emissão ou último dia do período. Contratos de longo prazo: data do laudo de progresso físico.
- IND_PGTO: tipo pactuado, independente de quando pago.
- Validação: VL_PIS = Σ A170.VL_PIS; VL_COFINS = Σ A170.VL_COFINS.
- VL_PIS_RET/VL_COFINS_RET: informativos (a retenção para dedução vai no F600).

## Registro A110 — Complemento do Documento – Informação Complementar da NF

- Nível 4 · Ocorrência 1:N. Sem COD_INF repetido no mesmo documento.
- Dados de Informações Complementares de interesse do Fisco (forma de pagamento, local de execução, suspensão das contribuições etc.).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "A110" | C | 004* | - | S | fixo |
| 02 | COD_INF | Código (→ 0450.COD_INF) | C | 006 | - | S | CALC |
| 03 | TXT_COMPL | Texto complementar | C | - | - | N | `OutrasInformacoes`/discriminação |

Validação: COD_INF deve existir no 0450.

## Registro A111 — Processo Referenciado

- Nível 4 · Ocorrência 1:N.
- Existência de processo judicial/administrativo que autoriza CST, exclusão de base ou alíquota diversa da legislação. Ao gerar A111 → gerar também 1010 (ação judicial) ou 1020 (processo administrativo).
- Decisão judicial só pode ser aplicada na apuração se **transitada em julgado**. Sem trânsito: apurar normalmente e informar a parcela suspensa no 1010.DESC_DEC_JUD (e, a partir de jan/2020, detalhar no 1011); guardar uniformidade com DCTF (M200/M600).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "A111" | C | 004* | - | S | fixo |
| 02 | NUM_PROC | Nº do processo/ato concessório | C | 015 | - | S | MANUAL (cadastro de processos da empresa) |
| 03 | IND_PROC | 1-Justiça Federal; 3-SRFB; 9-Outros | C | 001* | - | S | MANUAL |

Exemplo de 1010 dado pelo guia: `|1010|xxxxxxx-xx.2016.1.00.0000|TRF3|10|02|6912/01=R$10.000,00 e 5856/01=R$18.000,00|20032019|`

## Registro A120 — Informação Complementar – Operações de Importação

- Nível 4 · Ocorrência 1:N.
- Obrigatório para A100 cujo A170 tenha CST de crédito (50–56) e IND_ORIG_CRED = 1 (importação de serviço). Crédito só sobre PIS/Cofins-Importação **efetivamente pagos** (art. 15 Lei 10.865/04). Um registro por data de pagamento.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "A120" | C | 004 | - | S | fixo |
| 02 | VL_TOT_SERV | Valor total do serviço prestado por residente no exterior | N | - | 02 | S | MANUAL (contrato/invoice) |
| 03 | VL_BC_PIS | Base PIS-Importação | N | - | 02 | S | MANUAL/DARF |
| 04 | VL_PIS_IMP | PIS-Importação pago | N | - | 02 | N | MANUAL/DARF |
| 05 | DT_PAG_PIS | Data pagamento PIS-Imp. | N | 008* | - | N | MANUAL/DARF |
| 06 | VL_BC_COFINS | Base Cofins-Importação | N | - | 02 | S | MANUAL/DARF |
| 07 | VL_COFINS_IMP | Cofins-Importação paga | N | - | 02 | N | MANUAL/DARF |
| 08 | DT_PAG_COFINS | Data pagamento Cofins-Imp. | N | 008* | - | N | MANUAL/DARF |
| 09 | LOC_EXE_SERV | 0-Executado no País; 1-Executado no exterior com resultado no País | C | 001* | - | S | MANUAL |

## Registro A170 — Complemento do Documento – Itens do Documento

- Nível 4 · Ocorrência 1:N · Obrigatório (≥1 por A100). Sem NUM_ITEM repetido no documento.
- Bases (campos 10 e 14) alimentam o Bloco M: CST de receita → M210/M610.VL_BC_CONT; CST de crédito → M105.VL_BC_PIS_TOT / M505.VL_BC_COFINS_TOT.

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig | Origem |
|---|---|---|---|---|---|---|---|
| 01 | REG | "A170" | C | 004* | - | S | fixo |
| 02 | NUM_ITEM | Nº sequencial do item | N | 004 | - | S | CALC (1..n) |
| 03 | COD_ITEM | Código do item (→0200) | C | 060 | - | S | cadastro de serviço / `ItemListaServico` |
| 04 | DESCR_COMPL | Descrição complementar | C | - | - | N | `Discriminacao` |
| 05 | VL_ITEM | Valor total do item | N | - | 02 | S | `ValorServicos` (por item) |
| 06 | VL_DESC | Desconto / exclusão da base PIS/Cofins | N | - | 02 | N | desconto + exclusões |
| 07 | NAT_BC_CRED | Base de cálculo do crédito (tabela 4.3.7) | C | 002* | - | N | CALC (serviço contratado como insumo → "03") |
| 08 | IND_ORIG_CRED | 0-Mercado interno; 1-Importação | C | 001* | - | N | CALC (prestador exterior → 1) |
| 09 | CST_PIS | CST PIS (tabela 4.3.3) | N | 002* | - | S | CAD_FISCAL (regra por serviço/regime) |
| 10 | VL_BC_PIS | Base PIS | N | - | 02 | N | CALC |
| 11 | ALIQ_PIS | Alíquota PIS (%) | N | - | 02 | N | CAD_FISCAL (0,65/1,65) |
| 12 | VL_PIS | Valor PIS | N | - | 02 | N | CALC |
| 13 | CST_COFINS | CST Cofins (tabela 4.3.4) | N | 002* | - | S | CAD_FISCAL |
| 14 | VL_BC_COFINS | Base Cofins | N | - | 02 | N | CALC |
| 15 | ALIQ_COFINS | Alíquota Cofins (%) | N | 006 | 02 | N | CAD_FISCAL (3,00/7,60) |
| 16 | VL_COFINS | Valor Cofins | N | - | 02 | N | CALC |
| 17 | COD_CTA | Conta contábil (→0500) | C | 255 | - | N* | de-para contábil |
| 18 | COD_CCUS | Centro de custos (→0600) | C | 255 | - | N | MANUAL/de-para |

Regras:
- NUM_ITEM > 0 e sequencial.
- COD_ITEM deve existir em 0200 (código próprio da PJ). Para NFS-e sem código, criar item de serviço por `ItemListaServico` (TIPO_ITEM 09, COD_GEN "00", COD_LST).
- NAT_BC_CRED e IND_ORIG_CRED: **somente em serviços contratados** (IND_OPER=0) com CST de crédito (50–56, 60–66). IND_ORIG_CRED=1 → A120 obrigatório.
- VL_PIS = VL_BC_PIS × ALIQ_PIS / 100 (ex.: 1.000.000,00 × 1,65 / 100 = 16.500,00); VL_COFINS = VL_BC_COFINS × ALIQ_COFINS / 100 (ex.: × 7,6 / 100 = 76.000,00). Usar tolerância de arredondamento de 0,01 na validação interna.
- VL_PIS/VL_COFINS do item **não** são recuperados no Bloco M (M recalcula base × alíquota) — a base é o que importa.
- COD_CTA: opcional até 10/2017; **obrigatório a partir de 11/2017**, salvo PJ dispensada de ECD (Lucro Presumido com livro caixa, art. 45 Lei 8.981/95). Conta credora/devedora principal (pode ser sintética). Deve existir em 0500.
- COD_CCUS: em operações com crédito, se existir; deve existir em 0600.

## Registro A990 — Encerramento do Bloco A

- Nível 1 · Ocorrência 1 · Obrigatório se houver A001 (sempre).

| Nº | Campo | Descrição | Tipo | Tam | Dec | Obrig |
|---|---|---|---|---|---|---|
| 01 | REG | "A990" | C | 004* | - | S |
| 02 | QTD_LIN_A | Total de linhas do Bloco A | N | - | - | S |

QTD_LIN_A inclui A001 e A990. (O guia cita "registro C990" na validação — erro de digitação.)

---

## Checklist de validação cruzada (implementar no nosso validador)

1. 0000: CNPJ DV; DT_INI/DT_FIN mesmo mês, 1º/último dia salvo situação especial; COD_VER vigente em DT_FIN; NOME sanitizado; TIPO_ESCRIT=1 ⇒ NUM_REC_ANTERIOR (maiúsculas).
2. IND_NAT_PJ ∈ {03,04,05} ⇒ ≥1 0035 (05 ⇒ exatamente 1); COD_SCP = CNPJ válido de base ≠ 0000 a partir de 04/2021.
3. 0001.IND_MOV = 0; 0100 ≥ 1 com CPF válido; 0110 exatamente 1.
4. 0110.IND_APRO_CRED = 2 ⇔ 0111 presente; 0111.06 = 02+03+04+05.
5. 0110.COD_INC_TRIB = 2 ⇒ IND_APRO_CRED vazio; IND_REG_CUM ∈ {1,2,9}. COD_INC_TRIB ∈ {1,3} ⇒ IND_REG_CUM vazio.
6. 0110.COD_TIPO_CONT = 2 ⇒ existe M210/M610 com COD_CONT ∈ {02,03,52,53}.
7. Itens com CST 53–56/63–66 ⇒ IND_APRO_CRED preenchido.
8. Escrituração sem dados de receita/crédito ⇒ 0120 obrigatório; dezembro ⇒ 0120 para meses dispensados não transmitidos.
9. 0140 da matriz sempre presente; todo CNPJ de A010/C010/D010/F010 ∈ 0140; IE vazia se múltiplas IEs.
10. Todo COD_PART referenciado ∈ 0150 do mesmo 0140; 0150 com COD_PAIS sempre; CPF xor CNPJ se Brasil; COD_MUN obrigatório se Brasil.
11. Todo COD_ITEM referenciado ∈ 0200 do mesmo 0140; 0200.UNID_INV ∈ 0190; toda unidade de C170 ∈ 0190; 0190.UNID ≠ DESCR.
12. COD_NAT ∈ 0400; COD_INF (A110/C110) ∈ 0450; COD_CTA ∈ 0500 (obrigatório ≥ 11/2017 para LR e LP competência); COD_CCUS ∈ 0600; 0500/0600.DT_ALT ≤ DT_FIN.
13. 0205.DT_FIM < DT_FIN e sem sobreposição; 0208 não gerar ≥ 05/2015; 0206 só para produtor/importador/distribuidor.
14. Transmissão após 10º dia útil do 2º mês subsequente (original) ⇒ 0900 com somatórios conferindo com os blocos.
15. A001.IND_MOV coerente; A100 ≥1 A170; A100.VL_PIS/VL_COFINS = Σ A170; DT_DOC ou DT_EXE_SERV no período; chave de unicidade; A170.VL_PIS = BC×ALIQ/100; IND_ORIG_CRED=1 ⇒ A120.
16. 0990/A990: contagens incluem abertura e encerramento.

## Ordem de geração recomendada (pipeline)

1. Ingerir XMLs → normalizar documentos por estabelecimento (CNPJ) e por tipo (NF-e 55 entrada/saída, NFC-e 65, CT-e 57, NFS-e).
2. Aplicar regras fiscais (CST/alíquotas PIS/Cofins, NAT_BC_CRED, contas contábeis) → gerar Blocos A, C, D, F.
3. Gerar Bloco M (apuração) e demais.
4. Coletar referências usadas (COD_PART, COD_ITEM, UNID, COD_NAT, COD_INF, COD_CTA, COD_CCUS) por estabelecimento → gerar 0140 e filhos, 0500, 0600.
5. Calcular 0110 (COD_TIPO_CONT), 0111, 0120, 0900 → montar Bloco 0.
6. Contagens 0990/A990/…/9900/9990/9999 por último.

## Inconsistências/erros notados no próprio guia

- 0035: coluna Obrig em branco (tratar como S quando aplicável).
- 0110 obs. cita "IND_REC_CUM" (nome correto: IND_REG_CUM) e o histórico de PVA 1.07/2.00 com 4 campos — obsoleto.
- 0140 campo 09 fala em "pessoa jurídica titular" (copiado do 0000) — é a Suframa do estabelecimento.
- 0145: diz "sem ajuste AVP" no início e "considerar AVP" no final.
- 0200 campo 11: tamanho 004 (ou 005 no formato XX.XX desde 05/2015).
- 0900: duplicidade "Campo 08" (o primeiro é o 07).
- A170 campo 14: tamanho ausente; A990 validação cita "C990".
- 0208: texto diz "31 de abril de 2015" (use 30/04/2015).
