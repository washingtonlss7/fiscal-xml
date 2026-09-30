# EFD-Contribuições: Guia Prático v1.35 (18/06/2021), notas dos Caps. I, II e III (Seções 1 e 2)

Fonte: linhas 417 a 3180 do TXT do Guia Prático. O Cap. III Seção 3 (leiaute campo a campo) NÃO está neste trecho.
Base legal: IN RFB 1.052/2010, 1.252/2012 (obrigatoriedade), 1.280/2012, 1.305/2012, 1.387/2013 (retificação 5 anos); ADE Cofis 34/2010, 20/2012 (manual atual), 65/2012 e 91/2013 (Bloco I), 82/2018 (leiaute 005).

---

## 1. Obrigatoriedade, dispensa, prazos, entrega, retificação e guarda

### 1.1 Quem é obrigado (IN RFB 1.252/2012, art. 5º)
- PIS/Cofins, **Lucro Real**: fatos geradores a partir de 01/01/2012.
- PIS/Cofins, **Lucro Presumido ou Arbitrado**: a partir de 01/01/2013.
- PIS/Cofins, **instituições financeiras e equiparadas** (§§ 6º, 8º e 9º do art. 3º da Lei 9.718/98, e Lei 7.102/83): a partir de 01/01/2014 (Bloco I).
- **CPRB** (contribuição previdenciária sobre a receita bruta, Lei 12.546/2011): a partir de 01/03/2012 (arts. 7º e 8º da MP 540) ou de 01/04/2012 (arts. 7º e 8º e anexos da Lei 12.546).
- Um Lucro Presumido com CPRB em 2012 entregou a EFD só com o Bloco P de mar/abr a dez/2012; a partir de jan/2013 entrega as 3 contribuições.
- A escrituração é obrigatória **mesmo em mês sem operações**, salvo nos casos de dispensa abaixo.
- Quem transmitiu por vontade própria estando dispensado **não** passa a ser obrigado nos demais períodos. Só precisa retificar se os valores de M200 (PIS) e M600 (Cofins) forem diferentes do que foi declarado em DCTF.

### 1.2 Dispensa por falta de movimento (Lucro Real ou Presumido)
- Fica dispensado o mês em que a PJ, ao mesmo tempo:
  - (I) não teve receita bruta nem receita de outra natureza, tributada ou não (inclui isenção, não incidência, suspensão e alíquota zero); **e**
  - (II) não fez operações que geram crédito da não cumulatividade (inclui importação).
- **Dezembro nunca é dispensado.** A EFD de dezembro deve informar os meses dispensados do ano no **Registro 0120**.
- Inativa o ano todo (ou desde o início das atividades): dispensada nos meses em que ficou nessa condição.
- Ficou inativa **durante** o ano: só fica dispensada a partir de janeiro do ano seguinte. No ano corrente continua entregando, com IND_MOV = 1 ("Bloco sem dados informados") nas aberturas dos blocos A, C, D e F.
- Inatividade = nenhuma atividade operacional, não operacional, patrimonial ou financeira, inclusive aplicação financeira. Pagar tributo de anos anteriores ou multa acessória **não** tira a PJ da condição de inativa.
- PJ paralisada mas obrigada: apresenta os registros "O" (identificação, período e valores zerados nos demais blocos).

### 1.3 Dispensados da EFD-Contribuições
1. **ME/EPP do Simples Nacional** (LC 123/2006), nos períodos em que estão no regime. O guia não cita o MEI em separado; como o MEI é optante do Simples (SIMEI), cai nesta mesma dispensa.
2. **Imunes e isentas do IRPJ** cuja soma mensal de PIS (sobre receita) + Cofins + CPRB seja **≤ R$ 10.000,00**.
   - O PIS sobre a folha NÃO entra na soma.
   - Se ultrapassar o limite, fica obrigada a partir daquele mês e em todos os meses seguintes do mesmo ano-calendário.
3. PJ inativa (ver 1.2).
4. Órgãos públicos.
5. Autarquias e fundações públicas.
6. PJ ainda não inscrita no CNPJ: do mês do registro dos atos constitutivos até o mês anterior à inscrição.

Também dispensados, mesmo com CNPJ:
- condomínios edilícios;
- consórcios e grupos de sociedades (arts. 265, 278 e 279 da Lei 6.404). Consórcio que faz negócios em nome próprio **pode** apresentar, com as consorciadas solidárias;
- consórcios de empregadores;
- clubes de investimento;
- FII que não se enquadra no art. 2º da Lei 9.779;
- fundos mútuos de investimento;
- embaixadas, consulados etc.;
- representações de organizações internacionais;
- **cartórios** (serviços notariais e registrais);
- fundos especiais sem personalidade jurídica;
- candidatos e comitês de partidos políticos;
- **incorporações imobiliárias no RET**: a obrigação recai sobre a incorporadora, para cada incorporação;
- entidades estrangeiras com bens no Brasil;
- comissões criadas por ato internacional;
- comissões de conciliação prévia.

### 1.4 Periodicidade e período do arquivo
- A escrituração é **mensal**: um mês civil ou fração dele (abertura, sucessão, encerramento).
- 0000.DT_INI = dia 1 do mês, ou a data de início de atividade ou de outro evento.
- 0000.DT_FIN = último dia do **mesmo** mês, ou a data de encerramento ou paralisação.

### 1.5 Centralização (matriz)
- **Um arquivo único por PJ**, gerado pela **matriz** (art. 15 da Lei 9.779/99). O PVA **não** importa arquivos separados por estabelecimento.
- Nos Blocos A, C, D e F os dados são separados **por estabelecimento** (registros x010). O que não se liga a um estabelecimento específico é informado pelo estabelecimento sede.
- Os estabelecimentos são cadastrados no 0140.

### 1.6 Prazo e multas
- Prazo: até o **10º dia útil do 2º mês subsequente** ao mês de referência.
- Multas do art. 12 da Lei 8.218/91 (redação da Lei 13.670/2018):
  - 0,5% da receita bruta do período, se o arquivo não atender os requisitos;
  - 5% do valor da operação, limitado a 1% da receita bruta, por omissão ou informação incorreta;
  - **0,02% por dia de atraso** sobre a receita bruta, limitado a 1%.
- Código DARF da multa por atraso: **2203**. Desde 01/01/2020 a multa é calculada e cientificada no momento da transmissão fora do prazo.
- Dacon extinto para fatos geradores a partir de 01/2014 (IN 1.441/2014).

### 1.7 Assinatura digital
- Certificado ICP-Brasil **A1 ou A3**.
- Pode assinar:
  - o e-CNPJ / e-PJ com a mesma **raiz de CNPJ (8 primeiros dígitos)** do estabelecimento; ou
  - o representante legal ou procurador com **procuração eletrônica** (IN RFB 944/2009) no e-CAC, opção "Transmissão de Declarações/Arquivos, inclusive todos do CNPJ, com Assinatura Digital via Receitanet".
- Existência, prazo e validade do certificado são verificados no início da transmissão.

### 1.8 Validação e transmissão
- O arquivo passa pelo **PVA**, que valida, assina, transmite e visualiza. A transmissão é feita pelo **Receitanet**.
- As regras de validação do PVA podem mudar a qualquer tempo.
- A ausência de uma regra de validação **não** dispensa informar os dados existentes. Omitir informação pode gerar penalidade e a reapresentação integral do arquivo.
- O recibo é gravado na mesma pasta do arquivo, com o mesmo nome e extensão `.REC`.
  - Para recuperar o recibo: retransmitir o mesmo arquivo; ou, se o arquivo se perdeu, usar o ReceitanetBX e o PVA 4.0+ ("EFD Contribuições/Recuperar Recibo de Transmissão").
- "Exportar TXT" no PVA gera só aquela EFD, sem assinatura. A "Cópia de segurança" leva toda a base do PVA.

### 1.9 Guarda
- Guardar o **TXT transmitido** (não a cópia de segurança), junto com o recibo `.REC` e os documentos de origem, pelo prazo de guarda dos documentos fiscais.
- O arquivo deve manter segurança, autenticidade e integridade.

### 1.10 Retificação (art. 11 da IN 1.252, redação da IN 1.387/2013)
- A retificação **substitui o arquivo inteiro**. Não existe arquivo complementar para o mesmo período.
- Pode incluir, alterar ou excluir documentos, operações, créditos e contribuições. Não há multa pelo ato de retificar.
- Prazo: **5 anos contados do 1º dia do exercício seguinte** ao do período escriturado.
- A retificadora **não produz efeito** quando:
  - (I) reduz débitos já enviados à PGFN para Dívida Ativa, ou já examinados em fiscalização;
  - (II) altera débitos depois de a PJ ser intimada do início de procedimento fiscal;
  - (III) altera créditos já em fiscalização ou em PER/DCOMP.
  - Exceções, só atendendo a intimação e para corrigir erro de fato:
    - no caso (II), se houve recolhimento anterior à fiscalização maior que o escriturado e declarado em DCTF;
    - no caso (III), se foram omitidas operações com crédito ou elas foram escrituradas fora do leiaute.
- Se a retificadora altera valores declarados em DCTF, é preciso transmitir **também a DCTF retificadora**.
- A empresa sucessora pode retificar as EFDs da sucedida extinta.
- **Operações extemporâneas**: a partir do PA 08/2013, crédito ou contribuição de período anterior entra por **retificação do período de competência** (A100, C100 etc.).
  - Os registros 1101/1102/1200/1210/1220 e 1501/1502/1600/1610/1620 só valem para PA até 07/2013. O PVA dá erro nesses registros a partir de 08/2013.
- Blocos A, C, D e F aceitam documentos com data de emissão diferente (anterior ou posterior) do período do 0000.

### 1.11 Consulta
- Informações no portal SPED (sped.gov.br). Informações sobre documentos dos blocos C e D no CONFAZ.
- Dúvidas pelo "Fale Conosco" do SPED ou por sped@receita.fazenda.gov.br.

### 1.12 O que escriturar (Seções 4, 6 e 7)
- Receitas (faturamento = receita bruta + demais receitas), aquisições, custos e despesas com crédito, e exceções (suspensão, isenção, alíquota zero, NT, diferimento) com o dispositivo legal.
- Também: retenções na fonte, outras deduções, PIS-folha de cooperativas, créditos recebidos por incorporação, fusão ou cisão, processos administrativos e judiciais, e controle de saldos de créditos.
- Documentos que não geram receita nem crédito **não precisam** ser informados.
- **Enfoque do informante**: numa NF-e de entrada, os campos CFOP, CST-PIS e CST-Cofins de C170, C191 e C195 são os **do adquirente**, não os do XML do emitente. O CFOP de entrada segue a destinação do item.
- O código de item e o código de participante são **próprios** do informante.

---

## 2. Regras técnicas do arquivo (Cap. II)

### 2.1 Formato
- Arquivo texto **ASCII ISO-8859-1 (Latin-1)**. Não se aceita packed, zonado, binário, float nem EBCDIC.
- Linha: começa na coluna 1, tamanho variável, campos na ordem exata do leiaute.
- **Pipe `|` (ASCII 124) no início da linha e ao final de cada campo.**
  - Linha = `|REG|campo2|...|campoN|` + **CRLF** (ASCII 13 e 10).
  - O pipe nunca pode aparecer dentro de um conteúdo; é preciso sanitizar descrições.
- Campo vazio = `||`. Todos os campos do leiaute devem estar presentes; faltar campo quebra a estrutura.
- **Proibidas linhas em branco.** Uma linha em branco impede validação, assinatura e transmissão.
- Organização hierárquica pelo nível do registro.

### 2.2 Tipos de campo
- **C** (alfanumérico): qualquer caractere ASCII exceto `|` e os não imprimíveis (0 a 31).
  - Tamanho máximo **255** se não houver indicação. Tam "-" = 255. Tam "65536" = excepcional (ex.: TXT).
- **N** (numérico): só dígitos 0 a 9 (ASCII 48 a 57). Na prática também a vírgula decimal.
- Coluna Tam:
  - número = tamanho máximo;
  - "-" em N = sem máximo;
  - **`*` = tamanho exato** (ex.: CNPJ 014*, CPF 011*, COD_MUN 007*, CEP 008*).
- Coluna Dec: número = máximo de casas decimais; "-" = sem decimais.

### 2.3 Números
- Sem separador de milhar, sem sinal, sem `%`, sem `.` ou `-`. **Vírgula** como separador decimal.
- Respeitar o máximo de casas decimais. Zeros à direita são opcionais: `10000` e `10000,00` valem; `0` e `0,00` valem.
- Percentual sem `%`: 17,00% vira `|17|` ou `|17,00|`.
- Exemplos: `1129998,05`, `234,567`, `0,010`.

### 2.4 Data, período, ano, hora
- Data: `ddmmaaaa` (ex.: `01012011`).
- Período: `mmaaaa`.
- Exercício: `aaaa` (4 dígitos).
- Hora: `hhmmss` (24h).
- Sem separadores. Vazio = `||`.

### 2.5 Códigos de identificação
- N com regra do órgão (CNPJ, CPF, CEP): todos os dígitos, **zeros à esquerda**, sem máscara.
- C (IE, IM): sem máscara, com zeros à esquerda quando o órgão exigir, na quantidade de caracteres do órgão.
- Identificação de documento ou equipamento (SER, SUB, ECF_FAB, ECF_CX): sem máscara ("U-2" vira "U2"; "003" vira "3" em N).
  - O **mesmo tamanho** deve ser usado em todos os registros, blocos e arquivos.
  - Série/subsérie "D-1" vira `|D|1|`.
- Identificação de objeto (NUM_DA, NUM_PROC etc.): **mantém a máscara original** (ex.: `2002/123456-78`).
- Campo C de código próprio (COD_ITEM, COD_PART etc.): caracteres de formatação fazem parte do código; espaços são permitidos.

### 2.6 Tabelas
- Tabelas externas: CST, CFOP, NCM, municípios IBGE, países BACEN, CEP, LC 116.
- Tabelas intrínsecas: o domínio listado no próprio campo (ex.: IND_MOV 0/1).
- Tabelas do próprio informante:
  - **0150 Participante**:
    - código livre, válido só dentro do arquivo;
    - sem duplicidade;
    - descrição precisa; é proibido genérico ("clientes", "fornecedores", "consumidores");
    - usa os dados da última ocorrência do período; alterações vão em registro filho com data.
  - **0200 Item**:
    - o mesmo código em todos os documentos e arquivos;
    - não reaproveitar código já usado;
    - item que muda suas características recebe código novo;
    - troca de código vai no 0205 (código e descrição anteriores, datas);
    - é proibida descrição genérica ("diversas entradas", "mercadorias p/ revenda"), exceto:
      - uso e consumo sem crédito;
      - ativo imobilizado por gênero;
      - utilities (energia, água, gás, comunicação) consolidadas por classe.
  - 0400 natureza da operação, 0450 informação complementar (todas as do documento), 0190 unidades, fatores de conversão.
- **Todo código usado em um registro deve existir na tabela correspondente** (0150, 0190, 0200, 0400, 0450, 0500, 0600).

### 2.7 Organização
- Ordem dos blocos: **0, A, C, D, F, I, M, P, 1, 9**. Todos os blocos são obrigatórios; o registro de abertura diz se há dados (IND_MOV 0 = com dados, 1 = sem dados).
- Arquivo: começa em 0000 e termina em 9999. Cada bloco tem x001 (abertura) e x990 (encerramento).
- Dentro do bloco e da hierarquia, a ordem é sequencial e ascendente. O pai vem seguido de todos os seus filhos, e só depois o próximo pai.
  - Ex.: todos os C100 com seus filhos; depois os C400 com seus filhos.
- Não gerar registro sem informação (ex.: não gerar C110 sem dados adicionais).
- Filho exige pai.
- Ocorrência:
  - "1" = uma vez por arquivo;
  - "V" = vários;
  - "1:1" = um filho por pai;
  - "1:N" = vários filhos por pai.
- **Representação integral e consolidada são mutuamente excludentes**: se a NF-e de venda está no C180, não pode ter C170. C490 fica "N" se houver C400.
- **Correlação obrigatória modelo → registro** (Tabela 4.1.1):

| Mod | Documento | Registro |
|---|---|---|
| — | NFS municipal / NFS-e | A100 |
| 01 | NF 1/1A | C100 |
| 1B | NF Avulsa | C100 |
| 02 | NF Venda Consumidor | C380 (saída); C395 (aquisição) |
| 2D | Cupom Fiscal ECF | C400 e C490 |
| 2E | CF Bilhete de Passagem | D350 |
| 04 | NF Produtor | C100 |
| 06 | NF/Conta Energia Elétrica | C500 (aquisição) / C600 (fornecimento) |
| 07, 08, 8B, 09, 10, 11, 26, 27 | Transporte | D100 (aquisição) / D200 (prestação) |
| 13, 14, 15, 16 | Bilhetes de passagem | D300 e D350 |
| 18 | Resumo Movimento Diário | D300 |
| 17, 20, 23, 24, 25 | — | sem registro |
| 21, 22 | Comunicação/Telecom | D500 (aquisição) / D600 (fornecimento) |
| 28, 29 | Gás / Água canalizados | C500 / C600 |
| **55** | **NF-e venda** | **C100 (+C170) ou C180** |
| **55** | **NF-e aquisição/devolução** | **C100 (+C170) ou C190** |
| **57** | **CT-e** | **D100 (aquisição) / D200 (prestação)** |
| 59 | CF-e-SAT | C490; C860 a partir do PVA 2.11 (PA ≥ 05/2015); C800 |
| 60 | CF-e-ECF | C490 (e C400) |
| 63 | BP-e | D100 / D200 |
| **65** | **NFC-e** | **C100 + C175 (PVA ≥ 2.09, a partir de 10/2014)**; antes C180 |
| 66 | NF3e | C500 / C600 |
| 67 | CT-e OS | D100 / D200 |

- Outras correlações:
  - receitas financeiras e outras receitas sem documento fiscal: F100;
  - locação: F100;
  - depreciação do imobilizado: F120;
  - valor de aquisição do imobilizado: F130;
  - estoque de abertura: F150;
  - custo imobiliário: F205;
  - energia adquirida: C500;
  - comunicação adquirida: D500.

### 2.8 Tabela 4.1.2: Situação do documento (COD_SIT)
| Cód | Situação |
|---|---|
| 00 | Documento regular |
| 01 | Extemporâneo regular |
| 02 | Cancelado |
| 03 | Extemporâneo cancelado |
| 04 | NF-e/CT-e denegado |
| 05 | NF-e/CT-e numeração inutilizada |
| 06 | Complementar |
| 07 | Extemporâneo complementar |
| 08 | Regime especial / norma específica |

### 2.9 Bloco 9 (contagem)
- Registros: 9001 (O, nível 1, ocorrência 1), **9900 (O, nível 2, ocorrência V)**, 9990 (O), **9999 (O, nível 0, ocorrência 1)**.
- O detalhe dos campos (9900 = REG_BLC + QTD_REG_BLC para cada tipo de registro, inclusive o próprio 9900 e o 9999; x990 e 9999 com a quantidade de linhas) **não aparece neste trecho**; está no Cap. III Seção 3.
- Regra usual do SPED, a confirmar na Seção 3:
  - x990.QTD_LIN_x = linhas do bloco, incluindo o x001 e o x990;
  - 9999.QTD_LIN = total de linhas do arquivo.

---

## 3. Blocos e registros (Cap. III, Seção 1)

Colunas: Nível | Ocorrência | Obrigatoriedade | Escrituração de Contribuição (Contr) / Crédito (Créd), quando a tabela traz essa informação.

### Bloco 0: Abertura, Identificação e Referências
| Reg | Descrição | Nív | Ocor | Obrig |
|---|---|---|---|---|
| 0000 | Abertura do arquivo e identificação da PJ | 0 | 1 | O |
| 0001 | Abertura do Bloco 0 | 1 | 1 | O |
| 0035 | Identificação de SCP | 2 | 1:N | O se 0000.IND_NAT_PJ = 03, 04 ou 05 |
| 0100 | Dados do contabilista | 2 | V | OC |
| 0110 | Regimes de apuração e apropriação de crédito | 2 | 1 | O |
| 0111 | Receita bruta mensal para rateio de créditos comuns | 3 | 1:1 | O se 0110.COD_INC_TRIB = 1 ou 3 **e** IND_APRO_CRED = 2; N se COD_INC_TRIB = 2 ou IND_APRO_CRED = 1 |
| 0120 | EFD sem dados a escriturar (meses dispensados) | 2 | V | OC |
| 0140 | Cadastro de estabelecimento | 2 | V | O |
| 0145 | Regime da CPRB | 3 | 1:1 | OC |
| 0150 | Participante | 3 | 1:N | OC |
| 0190 | Unidades de medida | 3 | 1:N | OC |
| 0200 | Item (produtos/serviços) | 3 | 1:N | OC |
| 0205 | Alteração do item | 4 | 1:N | OC |
| 0206 | Código ANP (combustíveis) | 4 | 1:1 | OC |
| 0208 | Grupos por marca REFRI (bebidas frias) | 4 | 1:1 | OC |
| 0400 | Natureza da operação/prestação | 3 | 1:N | OC |
| 0450 | Informação complementar do documento | 3 | 1:N | OC |
| 0500 | Plano de contas (contas informadas) | 2 | V | OC |
| 0600 | Centro de custos | 2 | V | OC |
| 0900 | Composição das receitas do período (leiaute 006, a partir de 2020) | 2 | 1 | O se transmitida **após o prazo regular** |
| 0990 | Encerramento do Bloco 0 | 1 | 1 | O |

### Bloco A: Serviços (ISS)
| Reg | Descrição | Nív | Ocor | Obrig | Contr | Créd |
|---|---|---|---|---|---|---|
| A001 | Abertura | 1 | 1 | O | - | - |
| A010 | Identificação do estabelecimento | 2 | V | O se A001.IND_MOV = 0 | - | - |
| A100 | Nota fiscal de serviço | 3 | 1:N | OC | S | S |
| A110 | Informação complementar da NF | 4 | 1:N | OC | S | S |
| A111 | Processo referenciado | 4 | 1:N | OC | S | S |
| A120 | Importação | 4 | 1:N | OC | N | S |
| A170 | Itens do documento | 4 | 1:N | O se existir A100 | S | S |
| A990 | Encerramento | 1 | 1 | O | - | - |

### Bloco C: Mercadorias (ICMS/IPI)
| Reg | Descrição | Nív | Ocor | Obrig | Contr | Créd |
|---|---|---|---|---|---|---|
| C001 | Abertura | 1 | 1 | O | - | - |
| C010 | Identificação do estabelecimento | 2 | V | O se C001.IND_MOV = 0 (o guia traz "01") | - | - |
| C100 | NF 01, 1B, 04, 55 (e 65) | 3 | 1:N | OC | S | S |
| C110 | Informação complementar | 4 | 1:N | OC | S | S |
| C111 | Processo referenciado | 4 | 1:N | OC | S | S |
| C120 | Importação (cód. 01) | 4 | 1:N | O se houver CFOP iniciado em 3 e presente na tabela "CFOP geradores de crédito" | N | S |
| C170 | Itens do documento | 4 | 1:N | O se existir C100 | S | S |
| C175 | Registro analítico NFC-e (65), PVA 2.09+ | 4 | 1:N | O se existir C100 com COD_MOD = 65 | S | N |
| C180 | Consolidação NF-e 55 emitidas (vendas) | 3 | 1:N | OC | S | N |
| C181 | Detalhe PIS (C180) | 4 | 1:N | O se existir C180 | S | N |
| C185 | Detalhe Cofins (C180) | 4 | 1:N | O se existir C180 | S | N |
| C188 | Processo referenciado | 4 | 1:N | OC | S | N |
| C190 | Consolidação NF-e 55 aquisição com crédito e devoluções | 3 | 1:N | OC | N | S |
| C191 | Detalhe PIS (C190) | 4 | 1:N | O se existir C190 | N | S |
| C195 | Detalhe Cofins (C190) | 4 | 1:N | O se existir C190 | N | S |
| C198 | Processo referenciado | 4 | 1:N | OC | N | S |
| C199 | Importação (cód. 55) | 4 | 1:N | O se houver CFOP iniciado em 3 em C191/C195 e presente na tabela de CFOP geradores de crédito | N | S |
| C380 | NF venda consumidor (02), consolidação | 3 | 1:N | OC | S | N |
| C381 | Detalhe PIS | 4 | 1:N | O se C380.VL_DOC > 0 | S | N |
| C385 | Detalhe Cofins | 4 | 1:N | O se C380.VL_DOC > 0 | S | N |
| C395 | Documentos 02, 2D, 2E, 59: aquisições com crédito | 3 | 1:N | OC | N | S |
| C396 | Itens | 4 | 1:N | O se existir C395 | N | S |
| C400 | Equipamento ECF (02, 2D) | 3 | 1:N | OC | S | N |
| C405 | Redução Z | 4 | 1:N | O se existir C400 | S | N |
| C481 | Resumo diário ECF, PIS | 5 | 1:N | OC | S | N |
| C485 | Resumo diário ECF, Cofins | 5 | 1:N | OC | S | N |
| C489 | Processo referenciado | 4 | 1:N | OC | S | N |
| C490 | Consolidação ECF (02, 2D, 59, 60) | 3 | 1:N | OC (N se houver C400) | S | N |
| C491 | Detalhe PIS | 4 | 1:N | OC | S | N |
| C495 | Detalhe Cofins | 4 | 1:N | OC | S | N |
| C499 | Processo referenciado ECF | 4 | 1:N | OC | S | N |
| C500 | Energia (06), NF3e (66), água (29), gás (28), NF-e (55): entradas com crédito | 3 | 1:N | OC | N | S |
| C501 | Complemento PIS | 4 | 1:N | O se existir C500 | N | S |
| C505 | Complemento Cofins | 4 | 1:N | O se existir C500 | N | S |
| C509 | Processo referenciado | 4 | 1:N | OC | N | S |
| C600 | Consolidação diária de saídas (06, 29, 28) | 3 | 1:N | OC | S | N |
| C601 | Complemento PIS | 4 | 1:N | O se existir C600 | S | N |
| C605 | Complemento Cofins | 4 | 1:N | O se existir C600 | S | N |
| C609 | Processo referenciado | 4 | 1:N | OC | S | N |
| C800 | CF-e (59) | 3 | 1:N | OC; N se existir C860 | S | N |
| C810 | Detalhe CF-e PIS/Cofins | 4 | 1:N | OC | S | N |
| C820 | Detalhe CF-e por unidade de medida | 4 | 1:N | O se não existir C810 | S | N |
| C830 | Processo referenciado | 4 | 1:N | OC | S | N |
| C860 | Equipamento SAT-CF-e (59), PVA 2.11+, PA ≥ 05/2015 | 3 | 1:N | OC | S | N |
| C870 | Detalhe CF-e PIS/Cofins | 4 | 1:N | OC | S | N |
| C880 | Detalhe por unidade de medida | 4 | 1:N | O se não existir C870 | S | N |
| C890 | Processo referenciado | 4 | 1:N | OC | S | N |
| C990 | Encerramento | 1 | 1 | O | - | - |

### Bloco D: Transporte e Comunicação (ICMS)
| Reg | Descrição | Nív | Ocor | Obrig | Contr | Créd |
|---|---|---|---|---|---|---|
| D001 | Abertura | 1 | 1 | O | - | - |
| D010 | Identificação do estabelecimento | 2 | V | OC | - | - |
| D100 | Aquisição de transporte (07, 08, 8B, 09, 10, 11, 26, 27, 57, 63, 67) | 3 | 1:N | OC | N | S |
| D101 | Complemento PIS | 4 | 1:N | OC | N | S |
| D105 | Complemento Cofins | 4 | 1:N | OC | N | S |
| D111 | Processo referenciado | 4 | 1:N | OC | N | S |
| D200 | Resumo diário de prestação de transporte (mesmos modelos) | 3 | 1:N | OC | S | N |
| D201 | Totalização PIS | 4 | 1:N | OC | S | N |
| D205 | Totalização Cofins | 4 | 1:N | OC | S | N |
| D209 | Processo referenciado | 4 | 1:N | OC | S | N |
| D300 | Resumo diário (13, 14, 15, 16, 18) | 3 | 1:N | OC | S | N |
| D309 | Processo referenciado | 4 | 1:N | OC | S | N |
| D350 | Resumo diário de cupom ECF (2E, 13, 14, 15, 16) | 3 | 1:N | OC | S | N |
| D359 | Processo referenciado | 4 | 1:N | OC | S | N |
| D500 | Aquisição de comunicação/telecom (21, 22) com crédito | 3 | 1:N | OC | N | S |
| D501 | Complemento PIS | 4 | 1:N | OC | N | S |
| D505 | Complemento Cofins | 4 | 1:N | OC | N | S |
| D509 | Processo referenciado | 4 | 1:N | OC | N | S |
| D600 | Consolidação de prestação (21, 22) | 3 | 1:N | OC | S | N |
| D601 | Complemento PIS | 4 | 1:N | OC | S | N |
| D605 | Complemento Cofins | 4 | 1:N | OC | S | N |
| D609 | Processo referenciado | 4 | 1:N | OC | S | N |
| D990 | Encerramento | 1 | 1 | O | - | - |

### Bloco F: Demais documentos e operações
| Reg | Descrição | Nív | Ocor | Obrig | Contr | Créd |
|---|---|---|---|---|---|---|
| F001 | Abertura | 1 | 1 | O | - | - |
| F010 | Identificação do estabelecimento | 2 | V | OC | - | - |
| F100 | Demais documentos e operações | 3 | 1:N | OC | S | S |
| F111 | Processo referenciado | 4 | 1:N | OC | S | S |
| F120 | Imobilizado: depreciação/amortização | 3 | 1:N | OC | N | S |
| F129 | Processo referenciado | 4 | 1:N | OC | N | S |
| F130 | Imobilizado: valor de aquisição | 3 | 1:N | OC | N | S |
| F139 | Processo referenciado | 4 | 1:N | OC | N | S |
| F150 | Crédito presumido sobre estoque de abertura | 3 | 1:N | OC | N | S |
| F200 | Atividade imobiliária: unidade vendida | 3 | 1:N | OC | S | S |
| F205 | Custo incorrido | 4 | 1:1 | OC | N | S |
| F210 | Custo orçado | 4 | 1:N | OC | N | S |
| F211 | Processo referenciado | 4 | 1:N | OC | S | S |
| F500 | Lucro Presumido, **caixa**, consolidado | 3 | 1:N | OC se 0110.COD_INC_TRIB = 2 **e** IND_REG_CUM = 1; N se COD_INC_TRIB = 1 ou 3, ou IND_REG_CUM = 2 ou 9 | S | N |
| F509 | Processo referenciado | 4 | 1:N | OC | S | N |
| F510 | Lucro Presumido, caixa, por unidade de medida | 3 | 1:N | mesma condição do F500 | S | N |
| F519 | Processo referenciado | 4 | 1:N | OC | S | N |
| F525 | Composição da receita recebida (caixa) | 3 | 1:N | OC | S | N |
| F550 | Lucro Presumido, **competência**, consolidado | 3 | 1:N | OC se COD_INC_TRIB = 2 **e** IND_REG_CUM = 2; N se COD_INC_TRIB = 1 ou 3, ou IND_REG_CUM = 1 ou 9 | S | N |
| F559 | Processo referenciado | 4 | 1:N | OC | S | N |
| F560 | Lucro Presumido, competência, por unidade de medida | 3 | 1:N | mesma condição do F550 | S | N |
| F569 | Processo referenciado | 4 | 1:N | OC | S | N |
| F600 | Contribuição retida na fonte | 3 | 1:N | OC | S | - |
| F700 | Deduções diversas | 3 | 1:N | OC | S | - |
| F800 | Créditos de incorporação, fusão e cisão | 3 | 1:N | OC | N | S |
| F990 | Encerramento | 1 | 1 | O | - | - |

### Bloco I: Instituições financeiras, seguradoras, previdência privada, planos de saúde
| Reg | Descrição | Nív | Ocor | Obrig |
|---|---|---|---|---|
| I001 | Abertura | 1 | 1 | O se 0000.DT_INI ≥ 01072013 |
| I010 | Identificação da PJ | 2 | V | O se I001.IND_MOV = 0 |
| I100 | Consolidação das operações | 3 | 1:N | OC se 0110.IND_ATIV = 3; N se diferente |
| I199 | Processo referenciado | 4 | 1:N | OC |
| I200 | Composição de receitas, deduções e exclusões | 4 | 1:N | OC |
| I299 | Processo referenciado | 5 | 1:N | OC |
| I300 | Detalhamento de receitas, deduções e exclusões | 5 | 1:N | OC |
| I399 | Processo referenciado | 6 | 1:N | OC |
| I990 | Encerramento | 1 | 1 | O |

(Registros com Contr = S e Créd = N.)

### Bloco M: Apuração de PIS/Pasep e Cofins
| Reg | Descrição | Nív | Ocor | Obrig |
|---|---|---|---|---|
| M001 | Abertura | 1 | 1 | O |
| M100 | Crédito de PIS do período | 2 | V | OC |
| M105 | Detalhe da base de cálculo do crédito PIS | 3 | 1:N | OC |
| M110 | Ajustes do crédito PIS | 3 | 1:N | OC |
| M115 | Detalhe dos ajustes do crédito PIS (PVA 2.0.12, PA ≥ 10/2015) | 4 | 1:N | OC (futuro: O se existir M110) |
| M200 | Consolidação da contribuição PIS | 2 | 1 | O |
| M205 | PIS a recolher por código de receita (visão DCTF) | 3 | 1:N | O se M200.VL_CONT_NC_REC > 0 ou VL_CONT_CUM_REC > 0; N se ambos = 0 ou vazios |
| M210 | Detalhe da contribuição PIS | 3 | 1:N | O se houver A, C, D ou F com CST 01, 02, 03 ou 05 |
| M211 | Cooperativas: composição da base PIS | 4 | 1:1 | O se 0000.IND_NAT_PJ = 01 |
| M215 | Ajustes da base de cálculo PIS | 4 | 1:N | O se M210.VL_AJUS_ACRES_BC_PIS > 0 ou VL_AJUS_REDUC_BC_PIS > 0; N se ambos = 0 |
| M220 | Ajustes da contribuição PIS | 4 | 1:N | OC |
| M225 | Detalhe dos ajustes da contribuição PIS (PVA 2.0.12) | 5 | 1:N | OC |
| M230 | Informações de diferimento | 4 | 1:N | OC |
| M300 | PIS diferido de períodos anteriores a pagar | 2 | V | OC |
| M350 | PIS sobre a folha | 2 | 1 | OC |
| M400 | Receitas isentas, NT, alíquota zero, suspensão (PIS) | 2 | V | OC |
| M410 | Detalhe do M400 | 3 | 1:N | O se existir M400 |
| M500 | Crédito de Cofins do período | 2 | V | OC |
| M505 | Detalhe da base do crédito Cofins | 3 | 1:N | OC |
| M510 | Ajustes do crédito Cofins | 3 | 1:N | OC |
| M515 | Detalhe dos ajustes do crédito Cofins (PVA 2.0.12) | 4 | 1:N | OC (futuro: O se existir M510) |
| M600 | Consolidação da Cofins | 2 | 1 | O |
| M605 | Cofins a recolher por código de receita | 3 | 1:N | O se M600.VL_CONT_NC_REC > 0 ou VL_CONT_CUM_REC > 0; N se ambos = 0 ou vazios |
| M610 | Detalhe da Cofins | 3 | 1:N | O se houver A, C, D ou F com CST 01, 02, 03 ou 05 |
| M611 | Cooperativas: base Cofins | 4 | 1:1 | O se 0000.IND_NAT_PJ = 01 |
| M615 | Ajustes da base Cofins | 4 | 1:N | O se M610.VL_AJUS_ACRES_BC_COFINS > 0 ou VL_AJUS_REDUC_BC_COFINS > 0; N se ambos = 0 |
| M620 | Ajustes da Cofins | 4 | 1:N | OC |
| M625 | Detalhe dos ajustes da Cofins (PVA 2.0.12) | 5 | 1:N | OC |
| M630 | Diferimento | 4 | 1:N | OC |
| M700 | Cofins diferida de períodos anteriores a pagar | 2 | V | OC |
| M800 | Receitas isentas, NT, alíquota zero, suspensão (Cofins) | 2 | V | OC |
| M810 | Detalhe do M800 | 3 | 1:N | O se existir M800 |
| M990 | Encerramento | 1 | 1 | O |

Nota: a Seção 2 cita "M200 e M210 sempre obrigatórios", mas a tabela condiciona o M210 ao CST. Usar a tabela.

### Bloco P: CPRB
| Reg | Descrição | Nív | Ocor | Obrig |
|---|---|---|---|---|
| P001 | Abertura | 1 | 1 | O se houver 0145 |
| P010 | Identificação do estabelecimento | 2 | V | O se houver 0145 |
| P100 | CPRB | 3 | 1:N | O se houver 0145 |
| P110 | Detalhamento da apuração | 4 | 1:N | OC |
| P199 | Processo referenciado | 4 | 1:N | OC |
| P200 | Consolidação da CPRB | 2 | V | O se houver P100 |
| P210 | Ajuste da CPRB | 3 | 1:N | OC |
| P990 | Encerramento | 1 | 1 | O se houver 0145 |

Pela regra geral de blocos, P001 e P990 existem sempre, com IND_MOV = 1 quando não há 0145.

### Bloco 1: Complemento
| Reg | Descrição | Nív | Ocor | Obrig |
|---|---|---|---|---|
| 1001 | Abertura | 1 | 1 | O |
| 1010 | Processo referenciado: ação judicial | 2 | V | OC |
| 1011 | Detalhe das contribuições com exigibilidade suspensa (leiaute 006) | 3 | 1:N | OC |
| 1020 | Processo administrativo | 2 | V | OC |
| 1050 | Ajustes de base de cálculo extra-apuração | 2 | 1:N | OC |
| 1100 | Controle de créditos PIS | 2 | V | OC |
| 1101 | Crédito extemporâneo PIS (PA ≤ 07/2013) | 3 | 1:N | O se 1100.VL_CRED_EXT_APU > 0 |
| 1102 | Crédito extemporâneo PIS vinculado a mais de um tipo de receita | 4 | 1:1 | O se 1101.CST_PIS ∈ {53, 54, 55, 56, 63, 64, 65, 66} |
| 1200 | Contribuição extemporânea PIS (≤ 07/2013) | 2 | V | OC |
| 1210 | Detalhe | 3 | 1:N | O se existir 1200 |
| 1220 | Crédito a descontar da contribuição extemporânea PIS | 3 | 1:N | OC |
| 1300 | Controle de retenções na fonte PIS | 2 | V | OC |
| 1500 | Controle de créditos Cofins | 2 | V | OC |
| 1501 | Crédito extemporâneo Cofins (≤ 07/2013) | 3 | 1:N | O se 1500.VL_CRED_EXT_APU > 0 |
| 1502 | Crédito extemporâneo Cofins vinculado a mais de um tipo de receita | 4 | 1:1 | O se 1501.CST_COFINS ∈ {53, 54, 55, 56, 63, 64, 65, 66} |
| 1600 | Contribuição extemporânea Cofins (≤ 07/2013) | 2 | V | OC |
| 1610 | Detalhe | 3 | 1:N | O se existir 1600 |
| 1620 | Crédito a descontar | 3 | 1:N | OC |
| 1700 | Controle de retenções Cofins | 2 | V | OC |
| 1800 | Incorporação imobiliária (RET) | 2 | V | OC |
| 1809 | Processo referenciado | 3 | 1:N | OC |
| 1900 | Consolidação de documentos emitidos (Lucro Presumido, caixa ou competência) | 2 | V | OC |
| 1990 | Encerramento | 1 | 1 | O |

### Bloco 9
| Reg | Descrição | Nív | Ocor | Obrig |
|---|---|---|---|---|
| 9001 | Abertura | 1 | 1 | O |
| 9900 | Registros do arquivo (contagem por tipo) | 2 | V | O |
| 9990 | Encerramento do bloco | 1 | 1 | O |
| 9999 | Encerramento do arquivo | 0 | 1 | O |

---

## 4. Cap. III, Seção 2: notação, campos e tabelas

### 4.1 Notação de obrigatoriedade
- Do registro:
  - **O** = sempre;
  - **OC** = obrigatório se houver informação;
  - **O(...)** = obrigatório se a condição for atendida;
  - **N** = não deve ser informado.
- Do campo (coluna acrescentada pelo Guia):
  - **S** = sempre preenchido. Nos Blocos A, C, D, F e na apuração do M, os campos numéricos obrigatórios levam valor ou **"0"**; nunca ficam vazios;
  - **N** = não obrigatório, mas deve ser preenchido quando houver a informação.
- Colunas da Tabela de Campos: Nº, Campo (mnemônico), Descrição, Tipo (N/C), Tam (número = máximo; "-" = sem limite em N ou 255 em C; 65536; `*` = exato), Dec (número = máximo de decimais; "-" = sem decimais).

### 4.2 Tabela 3.1.1: Versão do leiaute (0000.COD_VER)
| Código | Versão | Ato | PA inicial |
|---|---|---|---|
| 001 | 1.00 | ADE Cofis 31/2010 | 01/04/2011 |
| 002 | 1.01 | ADE 34/2010 + 37/2010 | 01/04/2011 |
| 002 | 2.00 | ADE 20/2012 | 01/04/2011 |
| 003 | 2.01A | ADE 20/2012 | 01/07/2012 |
| 004 | 3.0.0 | ADE 20/2012 | 01/06/2018 |
| 005 | 3.1.0 | ADE 82/2018 | 01/01/2019 |
| 006 | 3.2.0 | — | 01/01/2020 |

- A versão 006 trouxe:
  - os registros 0900 e 1011;
  - os códigos 12, 13, 14, 15, 16, 17 e 19 no 1010.IND_NAT_ACAO (campo 05);
  - o campo 15 CHV_DOCe e o modelo 66 (NF3e) no C500.
- A versão 005 trouxe: novos campos de ajuste de base em M210/M610, os registros M215/M615 e o 1050.
- A versão 004 trouxe: BP-e 63 e CT-e OS 67 em D100/D200, e CF-e-ECF 60 em C400.
- No leiaute antigo, o 0110 tinha 4 campos; a partir da 2.01A tem 5 campos.
- Para PA atual (≥ 2020) usar **006**. A 1.35 do guia é de 2021; conferir no portal SPED se já existe versão posterior.

### 4.3 Tabelas externas (órgão mantenedor)
- IBGE: municípios.
- BACEN: países.
- CONFAZ: CFOP e CST-ICMS.
- RFB/SPED (sped.rfb.gov.br): CST-IPI, **CST-PIS (4.3.3)**, **CST-Cofins (4.3.4)**, NCM, TIPI (EX_IPI).
- Correios: CEP.
- Planalto: lista de serviços da LC 116/03.
- **Os códigos de CST-PIS/Cofins NÃO estão listados neste trecho**; baixar a tabela do portal SPED.
- Pelo texto do Cap. I: CST tributados na saída = 01, 02, 05; não tributados = 04, 06, 07, 08, 09; créditos vinculados a mais de um tipo de receita = 53, 54, 55, 56, 63, 64, 65, 66.

### 4.4 Tabela 4.1.1: Modelos de documentos
01, 1B, 02, 2D, 2E, 04, 06, 07, 08, 8B, 09, 10, 11, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 55, 57, 59, 63, 65, 67, mais "-" para NFS municipal e NFS-e. O 60 e o 66 aparecem na correlação com os registros (ver 2.7).

### 4.5 Tabela 4.1.2: Situação do documento
Ver 2.8.

### 4.6 Tabela 4.2.1: Gênero do item
- 00 = Serviço; 01 a 99 = capítulos da NCM. Ou seja, gênero = 2 primeiros dígitos da NCM, com 77 e 98 reservados.
- Pode ser derivado da NCM do XML.

### 4.7 Tabela 4.3.5: Código de Contribuição Social Apurada (Bloco M: M210/M610 e ajustes)
| Cód | Descrição |
|---|---|
| 01 | Não cumulativa, alíquota básica |
| 02 | Não cumulativa, alíquotas diferenciadas |
| 03 | Não cumulativa, por unidade de medida de produto |
| 04 | Não cumulativa, alíquota básica, atividade imobiliária |
| 31 | Substituição tributária |
| 32 | ST, vendas à ZFM |
| 51 | Cumulativa, alíquota básica |
| 52 | Cumulativa, alíquotas diferenciadas |
| 53 | Cumulativa, por unidade de medida |
| 54 | Cumulativa, alíquota básica, atividade imobiliária |
| 71 | SCP, não cumulativa |
| 72 | SCP, cumulativa |
| 99 | PIS/Pasep sobre a folha de salários |

### 4.8 Tabela 4.3.6: Código de Tipo de Crédito (M100/M500 e Bloco 1)
- Grupo **100**: vinculado à receita tributada no mercado interno.
- Grupo **200**: vinculado à receita não tributada no mercado interno.
- Grupo **300**: vinculado à receita de exportação.
- Sufixos:

| Sufixo | Significado |
|---|---|
| x01 | Alíquota básica |
| x02 | Alíquotas diferenciadas |
| x03 | Alíquota por unidade de produto |
| x04 | Estoque de abertura |
| x05 | Aquisição de embalagens para revenda |
| x06 | Presumido da agroindústria |
| x07 | Outros créditos presumidos |
| x08 | Importação |
| 109 | Atividade imobiliária (**só no grupo 100**) |
| x99 | Outros |

- Códigos válidos:
  - 101 a 109 e 199;
  - 201 a 208 e 299;
  - 301 a 308 e 399.

### 4.9 Tabela 4.3.7: Código de Base de Cálculo do Crédito (NAT_BC_CRED: A, C, D, F e 1)
| Cód | Descrição |
|---|---|
| 01 | Aquisição de bens para revenda |
| 02 | Bens utilizados como insumo |
| 03 | Serviços utilizados como insumo |
| 04 | Energia elétrica e térmica (inclusive vapor) |
| 05 | Aluguéis de prédios |
| 06 | Aluguéis de máquinas e equipamentos |
| 07 | Armazenagem e frete na venda |
| 08 | Contraprestações de arrendamento mercantil |
| 09 | Imobilizado: encargos de depreciação |
| 10 | Imobilizado: valor de aquisição |
| 11 | Amortização/depreciação de edificações e benfeitorias |
| 12 | Devolução de vendas sujeitas à não cumulatividade |
| 13 | Outras operações com direito a crédito |
| 14 | Transporte de cargas: subcontratação |
| 15 | Atividade imobiliária: custo incorrido |
| 16 | Atividade imobiliária: custo orçado |
| 17 | Limpeza, conservação e manutenção: vale-transporte, refeição, alimentação, uniforme |
| 18 | Estoque de abertura de bens |

### 4.10 Tabela 4.3.8: Código de Ajustes de Contribuição ou Créditos (M110, M220, M510, M620, P210)
| Cód | Descrição |
|---|---|
| 01 | Ação judicial |
| 02 | Processo administrativo |
| 03 | Legislação tributária |
| 04 | RTT |
| 05 | Outras situações |
| 06 | Estorno |
| 07 | CPRB: adoção do regime de caixa |
| 08 | CPRB: diferimento de valores a recolher |
| 09 | CPRB: adição de valores diferidos anteriormente |

### 4.11 Tabelas externas da RFB (só o nome; baixar do portal SPED)
- 4.3.9: alíquotas de crédito presumido da agroindústria.
- 4.3.10: produtos com alíquotas diferenciadas, monofásico e pauta (bebidas frias), CST 02 e 04.
- 4.3.11: produtos com alíquota por unidade de medida, CST 03 e 04.
- 4.3.12: produtos sujeitos à ST da contribuição, CST 05.
- 4.3.13: produtos com alíquota zero, CST 06. **Essas tabelas trazem o "código da natureza da receita" usado em M410/M810.**
- 4.3.14: operações com isenção, CST 07.
- 4.3.15: operações sem incidência, CST 08.
- 4.3.16: operações com suspensão, CST 09.
- 4.3.17: outros produtos com alíquotas diferenciadas, CST 02.
- 4.3.18: código de ajuste da base de cálculo mensal (M215, M615 e 1050; a partir de 01/2019).
- 5.1.1: código de atividades, produtos e serviços da CPRB (P100).
- 5.1.2: código de detalhamento da CPRB (P110). Códigos listados:
  - 00000001 = por documento fiscal;
  - 00000002 = por item/produto/serviço;
  - 00000003 = por NCM;
  - 00000004 = por cliente;
  - 00000999 = outros critérios.
- 7.1.1 a 7.1.4: composição e detalhamento de receitas, deduções e exclusões das instituições financeiras (Bloco I).

---

## 5. Ações judiciais e exclusão do ICMS da base (Cap. I, Seções 11 e 12)

### 5.1 Efeito das decisões judiciais
- Só se altera base, alíquota ou CST na escrituração se a decisão **transitou em julgado**, se aplica aos fatos geradores do período e não tem limitação temporal.
- **Sem trânsito em julgado** (ex.: liminar ou sentença que suspende a exigibilidade):
  - apurar normalmente, **com** a parcela suspensa incluída;
  - informar a parcela suspensa no **1010, campo 06 (DESC_DEC_JUD)** e destacá-la também na DCTF;
  - a partir do **PA 01/2020**, detalhar essa parcela no **1011**.

### 5.2 Exclusão do ICMS (RE 574.706, "Tema do Século")
- Embargos julgados em **13/05/2021**: a exclusão vale **após 15/03/2017**, exceto para ações e requerimentos administrativos protocolados até 15/03/2017. O ICMS a excluir é o **destacado na nota fiscal**.
- Parecer SEI 7698/2021/ME (PGFN):
  - receitas a partir de **16/03/2017**: excluir o ICMS destacado, **tendo a PJ ação judicial ou não**;
  - receitas até **15/03/2017**: excluir **só se** a PJ protocolou ação até 15/03/2017.

### 5.3 Como fazer o ajuste
- Na EFD original do período; ou pela **retificação de cada período** separadamente.
- **Proibido** concentrar em uma EFD ajustes de vários períodos.
- **Não existe campo próprio para a exclusão.** O ajuste é feito reduzindo a base de cálculo (ou o campo de desconto) **item a item, em cada registro**:

| Registro | Campo onde vai a exclusão do ICMS (e desconto incondicional e demais exclusões) |
|---|---|
| C170 | ICMS: campo 15 VL_ICMS (a base PIS/Cofins já sai reduzida); desconto incondicional e demais exclusões: campo 08 VL_DESC |
| C175 | 04 VL_DESC |
| C181 / C185 | 05 VL_DESC |
| C381 / C385 | 05 VL_BC_PIS / VL_BC_COFINS |
| C481 / C485 | 04 VL_BC_PIS / VL_BC_COFINS |
| C491 / C495 | 06 VL_BC_PIS / VL_BC_COFINS |
| C601 / C605 | 04 VL_BC_PIS / VL_BC_COFINS |
| C870 | 05 VL_DESC |
| D201 / D205 | 04 VL_BC_PIS / VL_BC_COFINS |
| D300 | 10 VL_DESC |
| D350 | 12 VL_BC_PIS e 18 VL_BC_COFINS |
| D601 / D605 | 04 VL_DESC |
| F100 | 08 VL_BC_PIS e 12 VL_BC_COFINS (uso subsidiário: documento excepcional com ICMS destacado) |
| F500 / F550 | 04 VL_DESC_PIS e 09 VL_DESC_COFINS |

- Só se exclui ICMS de **operação com documento fiscal e ICMS destacado**.
- A exclusão é **vinculada à natureza da receita de cada item**: o ICMS de receita não tributada (CST 04, 06, 07, 08, 09) não pode reduzir a base da receita tributada (CST 01, 02, 05).
- Exemplo: venda de R$ 6.000 com CST 01 e ICMS de R$ 720; venda de R$ 4.000 com CST 06 e ICMS de R$ 480.
  - Base do item CST 01 = 5.280; PIS 1,65% = 87,12; Cofins 7,6% = 401,28.
  - Base do item CST 06 = 3.520, com alíquota 0.
- No C181, VL_DESC = 720 e VL_BC_PIS = 5.280. No F550, VL_DESC_PIS = 720 e INFO_COMPL explica a exclusão.
- Para o gerador a partir do XML:

```
base_pis_item = vProd - vDesc - vICMS (do item)
```

  - Aplicar só a receitas com PA a partir de 16/03/2017, ou antes disso quando a PJ tiver ação até 15/03/2017.
  - Guardar um flag de ação judicial por cliente.

---

## 6. Regras que o nosso validador precisa checar

### Estrutura e formatação
- [ ] Charset ISO-8859-1. Rejeitar caracteres fora do Latin-1 e os de controle (0 a 31) dentro dos campos. Rejeitar `|` dentro do conteúdo.
- [ ] Toda linha começa com `|` e termina com `|` + CRLF. Nenhuma linha em branco, nem no final do arquivo.
- [ ] Quantidade de campos por linha = a do leiaute do registro **na versão de COD_VER** (ex.: 0110 com 4 ou 5 campos conforme a versão).
- [ ] Tipo N: só dígitos (e vírgula, se Dec > 0). Sem ponto, sinal ou `%`. Casas decimais ≤ Dec. Dec "-" = sem vírgula.
- [ ] Tamanho: C ≤ 255 (ou o indicado; 65536 quando for o caso). Tam com `*` = tamanho exato (CNPJ 14, CPF 11, COD_MUN 7, CEP 8).
- [ ] Datas `ddmmaaaa` válidas no calendário; períodos `mmaaaa`; anos `aaaa`; horas `hhmmss` de 00 a 23.
- [ ] CNPJ e CPF com dígito verificador válido e zeros à esquerda. IE e IM sem máscara.
- [ ] Campos com obrigatoriedade "S" preenchidos. Nos Blocos A, C, D, F e M, numérico obrigatório sem valor leva `0`, não vazio.

### Hierarquia e ordem
- [ ] 1ª linha = 0000; última = 9999. Blocos na ordem 0, A, C, D, F, I, M, P, 1, 9, todos presentes com x001 e x990.
- [ ] Ordem ascendente dos registros dentro do bloco. Cada pai é seguido pelos seus filhos antes do próximo pai do mesmo nível.
- [ ] Filho sem pai = erro. O nível de cada registro bate com a tabela.
- [ ] Ocorrências:
  - "1" = exatamente uma vez;
  - "1:1" = no máximo um filho por pai (0111, 0145, 0206, 0208, F205, M211, M611, 1102, 1502).
- [ ] IND_MOV = 1 → o bloco só tem x001 e x990. IND_MOV = 0 → deve haver ao menos um registro de dados; A010, C010 e I010 obrigatórios.
- [ ] Não gerar registros vazios (ex.: C110 sem texto).

### Obrigatoriedades condicionais
- [ ] 0035 obrigatório se 0000.IND_NAT_PJ ∈ {03, 04, 05}.
- [ ] 0111:
  - obrigatório se 0110.COD_INC_TRIB ∈ {1, 3} e IND_APRO_CRED = 2;
  - proibido se COD_INC_TRIB = 2 ou IND_APRO_CRED = 1.
- [ ] 0900 obrigatório se a transmissão for depois do prazo (10º dia útil do 2º mês seguinte).
- [ ] 0140 ao menos um. 0110 exatamente um.
- [ ] A170 obrigatório para cada A100. C170 obrigatório para C100, **exceto** COD_MOD 65, que usa C175 obrigatório. C181 e C185 para cada C180. C191 e C195 para cada C190. C501 e C505 para C500. C601 e C605 para C600. C396 para C395. C405 para C400.
- [ ] C381 e C385 obrigatórios se C380.VL_DOC > 0.
- [ ] C120 obrigatório se o C170 tem CFOP 3xxx gerador de crédito. C199 obrigatório se C191 ou C195 têm CFOP 3xxx gerador de crédito.
- [ ] C820 obrigatório se não houver C810. C880 obrigatório se não houver C870. C800 proibido se houver C860.
- [ ] Mutuamente excludentes:
  - a mesma NF-e de venda não pode estar em C100/C170 e em C180;
  - a mesma NF-e de entrada não pode estar em C100/C170 e em C190;
  - C490 proibido se houver C400.
- [ ] F500/F510:
  - só se COD_INC_TRIB = 2 e IND_REG_CUM = 1 (caixa);
  - F550/F560 só se COD_INC_TRIB = 2 e IND_REG_CUM = 2 (competência);
  - com IND_REG_CUM = 9 (detalhado), nenhum dos quatro.
- [ ] Bloco I:
  - I001 existe se DT_INI ≥ 01/07/2013 (na prática, sempre);
  - I100 só se 0110.IND_ATIV = 3.
- [ ] M200 e M600 sempre, uma vez cada.
- [ ] M210 e M610 obrigatórios se houver CST 01, 02, 03 ou 05 em A, C, D ou F.
- [ ] M205 obrigatório se M200.VL_CONT_NC_REC > 0 ou VL_CONT_CUM_REC > 0; proibido se ambos forem 0. O mesmo para M605 e M600.
- [ ] M215 obrigatório se M210.VL_AJUS_ACRES_BC_PIS > 0 ou VL_AJUS_REDUC_BC_PIS > 0; proibido se ambos forem 0. O mesmo para M615 e M610.
- [ ] M211 e M611 obrigatórios se IND_NAT_PJ = 01 (cooperativa).
- [ ] M410 obrigatório para cada M400; M810 para cada M800.
- [ ] Bloco P com dados (P010, P100) se houver 0145. P200 obrigatório se houver P100.
- [ ] 1101 obrigatório se 1100.VL_CRED_EXT_APU > 0; 1501 se 1500.VL_CRED_EXT_APU > 0.
- [ ] 1102 obrigatório se 1101.CST_PIS ∈ {53, 54, 55, 56, 63, 64, 65, 66}; o mesmo para 1502 e 1501.CST_COFINS.
- [ ] 1210 obrigatório para cada 1200; 1610 para cada 1600.
- [ ] **PA ≥ 08/2013: proibidos 1101, 1102, 1200, 1210, 1220, 1501, 1502, 1600, 1610 e 1620** (erro no PVA).
- [ ] Novidades de 2020 (leiaute 006): 0900 e 1011, e o C500 com CHV_DOCe.

### Cabeçalho e período
- [ ] 0000.COD_VER compatível com DT_INI (≥ 01/2020 → 006, pela Tabela 3.1.1).
- [ ] DT_INI e DT_FIN no **mesmo mês**. DT_INI é o dia 01, salvo início de atividade. DT_FIN é o último dia do mês, salvo encerramento.
- [ ] Os estabelecimentos das x010 têm a mesma raiz de CNPJ (8 dígitos) do 0000 e estão no 0140.
- [ ] O certificado de assinatura tem a mesma raiz de CNPJ, ou é de um procurador (verificação de transmissão; fora do TXT).

### Cadastros e referências
- [ ] Todo COD_PART existe no 0150; todo COD_ITEM no 0200; toda UNID no 0190; todo COD_NAT no 0400; todo COD_INF no 0450; todo COD_CTA no 0500; todo COD_CCUS no 0600.
- [ ] 0150 sem código duplicado nem nome genérico ("clientes", "consumidor", "fornecedores").
- [ ] 0200 sem código duplicado nem descrição genérica, exceto uso e consumo, imobilizado e utilities.
- [ ] 0200.COD_GEN = 2 primeiros dígitos da NCM, ou 00 para serviço. O domínio vai de 00 a 99, exceto 77 e 98.
- [ ] O SER tem o mesmo tamanho e formato em todos os registros do mesmo documento.
- [ ] NUM_PROC e NUM_DA mantêm a máscara original.

### Correlação modelo × registro
- [ ] COD_MOD 55 só em C100, C180, C190 ou C500. 65 só em C100 (+C175). 57/67/63 só em D100/D200. 59 só em C490, C800 ou C860. 06/28/29/66 só em C500/C600. 21/22 só em D500/D600. 02 em C380/C395. 2D em C400/C490/C395.
- [ ] Modelos 17, 20, 23, 24 e 25 não são escriturados.
- [ ] COD_SIT ∈ {00, ..., 08}. Documentos cancelados, denegados ou inutilizados (02, 03, 04, 05) sem itens e sem valores (conferir o detalhe na Seção 3).

### Regras tributárias e de enfoque
- [ ] Nas entradas, CFOP, CST-PIS e CST-Cofins são do **adquirente**: não copiar do XML de terceiros. Converter o CFOP 5xxx/6xxx do emitente para 1xxx/2xxx e mapear o CST de crédito (50 a 66, 70 a 75, 98, 99).
- [ ] Registros de crédito (A100/A170, C100/C170 de entrada, C190, C500, D100, D500, F100 de crédito, F120, F130, F150) com NAT_BC_CRED ∈ Tabela 4.3.7 (01 a 18).
- [ ] M100/M500.COD_CRED ∈ Tabela 4.3.6 (101–109, 199, 201–208, 299, 301–308, 399). COD_CRED 109 só no grupo 100.
- [ ] M210/M610.COD_CONT ∈ Tabela 4.3.5 (01, 02, 03, 04, 31, 32, 51, 52, 53, 54, 71, 72, 99).
- [ ] Coerência do regime: COD_INC_TRIB = 1 (não cumulativo) → COD_CONT 01–04; COD_INC_TRIB = 2 (cumulativo) → 51–54; 3 → ambos. (Inferência; confirmar na Seção 3.)
- [ ] Código de ajuste (M110, M220, M510, M620, P210) ∈ Tabela 4.3.8 (01 a 09). Códigos 07, 08 e 09 só na CPRB.
- [ ] CST 04, 06, 07, 08 e 09 nas saídas geram M400/M410 e M800/M810, com o código de natureza da receita das tabelas 4.3.10 a 4.3.16, coerente com CST e NCM.
- [ ] Exclusão do ICMS:
  - base PIS/Cofins do item = VL_ITEM − VL_DESC − VL_ICMS do item (quando aplicável);
  - só com ICMS destacado;
  - vinculada ao CST do próprio item (não transferir ICMS de item CST 06 para item CST 01);
  - por período, nunca acumulando outros períodos;
  - só para receitas ≥ 16/03/2017, ou para anteriores quando o cliente tiver ação até 15/03/2017.
- [ ] Cálculo: VL_PIS = VL_BC_PIS × ALIQ_PIS / 100 (1,65% no não cumulativo, 0,65% no cumulativo); Cofins 7,6% ou 3%. Tolerância de arredondamento de centavos.
- [ ] Ação judicial sem trânsito em julgado:
  - apuração cheia no M200/M600;
  - parcela suspensa no 1010.DESC_DEC_JUD;
  - a partir de 01/2020, também o 1011.
- [ ] M200 e M600 (valor a recolher) devem bater com a DCTF (alerta de auditoria).
- [ ] Imune ou isenta: calcular PIS + Cofins + CPRB do mês. Se ≤ R$ 10 mil, marcar "dispensado", salvo se já passou do limite em mês anterior do mesmo ano. Não somar o PIS sobre folha.
- [ ] Cliente do Simples Nacional: não gerar EFD-Contribuições (dispensado).
- [ ] Mês sem receita e sem crédito (LR/LP): dispensado, **exceto dezembro**, que deve ter o 0120 listando os meses dispensados.
- [ ] Inativo no curso do ano: gerar a EFD com IND_MOV = 1 em A, C, D e F nos meses restantes do ano.
- [ ] Prazo: alertar se passou do 10º dia útil do 2º mês seguinte (multa de 0,02% ao dia, até 1%, código 2203) e exigir o 0900.
- [ ] Retificadora: arquivo completo; período dentro de 5 anos (contados de 1º/jan do ano seguinte ao PA); alertar para a DCTF retificadora se M200/M600 mudarem.
