# Contábil

Hoje o Contábil é um processador de lançamentos que segue a especificação funcional da Contabilfarma (a ata). O objetivo final é maior: substituir o Domínio. O plano de contas e o livro de lançamentos já moram no Appura, e o Domínio é só um destino opcional enquanto for usado.

```
FONTE → EXTRAÇÃO → PADRONIZAÇÃO → REGRAS DO CONTÁBIL → LANÇAMENTOS → VALIDAÇÃO → ARQUIVO (Domínio novo)
```

## Princípios (da especificação)

- **Regras só em tabela:** nenhuma conta fica no código. O Departamento Contábil preenche a tabela DE/PARA: fiscal por CFOP, folha por rubrica.
- **Sem regra vira pendência:** o registro com CFOP ou rubrica desconhecida, conta inválida ou empresa não identificada não é contabilizado. Só ele para; o resto do lote segue.
- **Valor contábil:** o sistema não escolhe o campo de valor das notas. O Fiscal escolhe em Contábil → Processar. Até lá, as notas ficam com a pendência "valor não definido".
- **Idempotência:** cada movimento tem uma chave única (sha256 de empresa, origem, documento, CFOP ou rubrica). Processar de novo não duplica nada.
- **Camadas:**
  - RAW: o XML guardado pelo Appura e a planilha da folha em `ctb_raw_folha`;
  - STAGING: `ctb_movimentos`;
  - OUTPUT: `ctb_lancamentos`.
- **Log obrigatório:** cada processamento grava em `ctb_processamentos` quem rodou, a fonte, o período, o que foi recebido, processado, ficou sem regra, foi rejeitado ou duplicado, e quantos lançamentos saíram.
- **Erros classificados:**
  - empresa não encontrada, CNPJ inválido;
  - CFOP sem regra, rubrica sem regra, regra incompleta;
  - valor inválido, data inválida, competência inválida, documento duplicado;
  - conta inexistente ou sintética;
  - valor não definido, nota sem itens, valor não fecha.
- **Validação:** total de débitos = total de créditos, na planilha de conferência (aba "Totais por conta").
- **Homologação em degraus:** 5 registros → 1 empresa → 1 competência → mais empresas → em massa. O arquivo de teste não trava nada. O definitivo só sai sem pendências no período e trava os lançamentos exportados.

## Fontes

### Fiscal: notas do Appura

Entram NF-e e NFC-e, de entrada e de saída, das empresas do Contábil ligadas à captação (mesmo CNPJ).

- **Canceladas:** não geram lançamento. Se uma nota já tinha gerado e foi cancelada antes do arquivo definitivo, o lançamento é retirado.
- **Um movimento por CFOP:** os valores saem dos itens. Com o total da nota, a soma confere com o vNF da nota; uma diferença de centavos vai para o maior CFOP, e uma diferença maior vira a pendência "valor não fecha".
- **Campo de valor** (escolha do Fiscal):
  - total da nota = produtos − desconto + frete + seguro + outras + ST + IPI;
  - valor dos produtos;
  - produtos menos desconto.
- **Data:** a data de emissão no fuso de São Paulo, sem hora.
- **Participante:** na saída é o destinatário; na entrada, o emitente. Nome vazio vira "Consumidor Final".
- **NFC-e:** uma por lançamento, ou opcionalmente agrupadas por dia e CFOP.
- **Fora desta versão:** CT-e e notas de serviço.

### Folha: planilha, enquanto a leitura do banco não fica pronta

Colunas: código da empresa (ou CNPJ), competência, rubrica, descrição e valor.

- A data do lançamento é o último dia da competência.
- A linha original fica guardada.
- Uma linha repetida no mesmo arquivo conta como duplicada.

### Folha: banco do Domínio (próxima etapa)

O banco do Domínio roda num servidor do escritório (SQL Anywhere).

1. Rodar o diagnóstico: `scripts/dominio/diagnostico-dominio.ps1`, no servidor. Ele é só leitura: lê apenas o catálogo do banco (nomes de tabelas e colunas), nenhum dado de cliente, e não guarda a senha.
2. Com o relatório, mapear as tabelas de empresas, folhas, competências e rubricas, nos dois bancos (novo e antigo).
3. Criar o leitor: um programa no servidor, como o Appura Coletor, que faz só `SELECT` e envia ao Appura.

## Regras DE/PARA

**Fiscal (`ctb_regras_fiscais`):**
- Campos: CFOP, tipo de movimento, conta de débito, conta de crédito (código reduzido, até 7 dígitos), histórico, código de histórico do Domínio (opcional), regra de inversão (marcação), ativo.
- Escopo: a regra de uma empresa vale antes da regra do regime, que vale antes da geral.

**Folha (`ctb_regras_folha`):**
- Campos: rubrica, descrição, contas, histórico, tipo e ativo.

**Variáveis do histórico:**
- Fiscal: `{numero}`, `{serie}`, `{participante}`, `{cfop}`, `{data}`, `{competencia}`, `{chave}`, `{modelo}`.
- Folha: `{rubrica}`, `{descricao}`, `{competencia}`.

As regras podem ser importadas por planilha (CSV ou XLSX). Os modelos ficam na própria tela.

## Plano de contas

`ctb_planos` e `ctb_contas` guardam o código reduzido, a classificação, a descrição, o tipo (S/A) e a natureza.

- Normalmente há um plano padrão do escritório, que é o do Domínio novo. Uma empresa pode ter um plano próprio.
- Com o plano carregado, a conta da regra precisa existir e ser analítica. Sem plano, o Appura não confere, e quem confere é o Domínio na importação.

## Saídas

- **Planilha de conferência (XLSX):** as colunas pedidas no item 31 da ata (empresa, data, débito, crédito, valor, histórico, origem, documento, competência) e mais a regra usada. Traz uma aba de totais por conta.
- **TXT do Domínio, "Lançamentos contábeis em lote"** (Utilitários → Importação):
  - leiaute posicional: 01 cabeçalho (55), 02 lançamento (165) com 03 partida (664) e 99 rodapé;
  - Latin-1 sem BOM, CRLF, valores em centavos, contas com 7 dígitos;
  - o leiaute foi descrito a partir de um arquivo exportado pelo Domínio. Falta confirmar o campo do lote e o "1" final do cabeçalho com um export real do escritório.

## Livro (Appura como contabilidade)

- `ctb_lancamentos` guarda tanto os lançamentos gerados por regra quanto os manuais.
- Próximas fases para substituir o Domínio:
  - saldos de abertura;
  - razão, balancete, DRE e balanço;
  - fechamento do período;
  - extrato bancário (OFX) e conciliação;
  - ECD e ECF.

## Permissões

| Permissão | O que libera |
|---|---|
| `contabil.ver` | Ver as telas e baixar a planilha de conferência |
| `contabil.configurar` | Regras, empresas, plano de contas e configuração do valor |
| `contabil.operar` | Processar, reprocessar, lançamento manual e arquivo de teste |
| `contabil.fechar` | Arquivo definitivo (trava os lançamentos exportados) |

## Código

- `src/contabil/motor.ts`: as regras, sem banco.
- `src/contabil/dominio.ts`: o leiaute do Domínio e a planilha de conferência.
- `src/contabil/planilha.ts`: leitura de CSV e XLSX.
- `src/contabil/servico.ts`: o banco, o processamento e os arquivos.
- `public/contabil.js`: as telas.
- Testes: `test/contabil.test.ts` e `test/contabil-tela.test.ts`.
- Migration: `0043_contabil.sql`, com o rollback em `supabase/rollback/0043_contabil_down.sql`.
