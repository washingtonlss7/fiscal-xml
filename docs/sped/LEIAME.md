# Notas técnicas — EFD-Contribuições e EFD-ICMS/IPI

Resumo do **Guia Prático da EFD-Contribuições, versão 1.35 (18/06/2021)**, organizado para quem vai
programar a geração, a apuração e a validação do arquivo.

| Arquivo | Conteúdo |
|---|---|
| `contrib_cap1-3.md` | Obrigatoriedade, prazos, formato do arquivo, estrutura de blocos e registros, tabelas, regras gerais de validação |
| `contrib_bloco0_A.md` | Bloco 0 (abertura, cadastros, regime 0110/0111) e Bloco A (serviços/ISS) |
| `contrib_blocoC.md` | Bloco C (NF-e, NFC-e, entradas com crédito, consolidações) com mapeamento para as tags do XML |
| `contrib_blocosDFIP.md` | Blocos D (CT-e/frete), F (demais operações, Lucro Presumido consolidado), I e P |
| `contrib_blocosM19.md` | Bloco M (apuração), Bloco 1 (controle de créditos) e Bloco 9 (encerramento), com o algoritmo de apuração |

**Atenção:** o guia usado é de 2021. Antes de programar cada registro, conferir no Portal SPED a versão
vigente do guia, do leiaute (tabela 3.1.1) e das tabelas externas (natureza da receita 4.3.10 a 4.3.17,
CFOP geradores de crédito). Itens marcados como **[EXTERNO]** ou **conferir** nas notas não vieram do guia.

## EFD-ICMS/IPI (SPED Fiscal)

Resumo do **Guia Prático da EFD-ICMS/IPI, versão 3.2.2 (11/02/2026)**.

| Arquivo | Conteúdo |
|---|---|
| `icms_cap1-2.md` | Obrigatoriedade, perfis A/B/C, Reforma Tributária (Seção 10), formato, lista de registros, 45 regras gerais |
| `icms_bloco0_B.md` | Bloco 0 (0000, 0005, 0100, 0150, 0200 com CEST, 0220, 0221…) e Bloco B (ISS do DF) |
| `icms_blocoC_1.md` | C100 a C197: NF-e de entrada e saída, NFC-e, C190 (VL_OPR), ST (C176, C180–C186), ajustes C197 |
| `icms_blocoC_2.md` | C350 a C990: energia/água/gás (C500/C590), ECF, CF-e SAT e registros de concessionárias |
| `icms_blocosD_E.md` | D100 (CT-e) e Bloco E (apuração do ICMS, ST, DIFAL/FCP, IPI) com os algoritmos de apuração |
| `icms_blocos_G_H_K_1_9.md` | CIAP, inventário, Bloco K, Bloco 1 (1010, 1601 pagamentos eletrônicos) e Bloco 9 |

Pendências que o guia não resolve e que vêm da SEFAZ-ES: tabelas 5.1.1, 5.2 e 5.3 de códigos de ajuste do ES,
códigos de receita do DUA e vencimentos, perfil (A/B/C) de cada estabelecimento, exigência do 1601, 1400 e 0221.

## Gerador do Appura (implementado)

| Arquivo | Conteúdo |
|---|---|
| `gerador-icms-spec.md` | Especificação campo a campo usada pelo gerador da EFD ICMS/IPI (Guia 3.2.2, leiaute 020 em 2026) |
| `gerador-contrib-spec.md` | Especificação campo a campo usada pelo gerador da EFD-Contribuições (leiaute 006, não cumulativo) |

**Código:**

- `src/sped/gerar/`: motores puros, testados em `test/sped-gerar.test.ts`.
  - `escrita.ts`: formatação, contadores e bloco 9.
  - `anterior.ts`: o que vem do SPED do mês anterior.
  - `xml.ts`: campos extras do XML.
  - `icms.ts` e `contribuicoes.ts`: os dois geradores.
- `src/painel/gerarSped.ts`: carrega os dados, gera, valida com o leitor, guarda as versões (`sped_gerados`) e audita pelo caminho do SPED recebido.
- A tela é o cartão "Gerar SPED" na aba SPED da empresa (`public/sped-gerar.js`).

**Do SPED anterior vêm:**

- contabilista, perfil e IE;
- código próprio dos itens (de-para pelo GTIN) e fatores do 0220;
- CST e CFOP usados na última entrada de cada item;
- saldo credor do E110;
- código de receita e vencimento do E116;
- 1010;
- contas contábeis por CST/CFOP;
- saldos 1100/1500.

**Ainda não gerados (viram pendência de erro quando necessários):**

- E200/E210 (ST com débito ou crédito);
- inventário em fevereiro (H005/H010);
- 1601 (IND_CART = S);
- C101/E300 (DIFAL);
- NAT_REC dos CST 06 a 09;
- EFD-Contribuições do Lucro Presumido (cumulativo).

Antes de transmitir, valide sempre no PVA.
