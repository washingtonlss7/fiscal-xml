# Apuração do Simples Nacional no Appura (desenho)

Objetivo: fechar o ciclo do Simples sem sair do Appura:

1. O Appura calcula a receita do mês a partir das notas de saída.
2. Separa a receita com ICMS-ST e com PIS/COFINS monofásico.
3. O analista confere a prévia.
4. A Receita calcula o imposto numa simulação.
5. O Appura transmite o PGDAS-D.
6. O Appura gera o DAS e o envia à Acessórias.

Status:

- **Etapa B implementada.** É a aba "Apuração" da Empresa 360°, com prévia, alertas e ajustes. O motor está em `src/fiscal/simples.ts` e o serviço em `src/painel/apuracao.ts`.
- **Etapas A, C e D:** a fazer.

## 1. Como a Receita recebe a declaração (Integra Contador)

O serviço é `PGDASD / TRANSDECLARACAO11` (`Declarar`).

**O Appura não precisa calcular o imposto.** O pedido tem dois indicadores:

- `indicadorTransmissao: false`: a Receita **só calcula** e devolve `valoresDevidos` por tributo, sem transmitir. Isso é a nossa **simulação**.
- `indicadorComparacao: true` + `valoresParaComparacao`: na transmissão, a Receita confere se o cálculo dela bate **exatamente** com os valores informados. Se houver 1 centavo de diferença, ela não transmite (MSG_ISN_035).

Então o fluxo é:

1. Simular.
2. O analista aprova.
3. Transmitir com comparação, usando os valores da simulação. O valor transmitido é, garantidamente, o que o analista viu.

A tabela do Anexo I, a alíquota efetiva, o RBT12, os sublimites e a partilha ficam com a Receita, que já tem o histórico da empresa. O Appura só precisa informar **a receita do mês, bem segregada**. É aí que está o valor para farmácia: segregação errada é imposto pago a mais.

Estrutura (campos exatos):

```
cnpjCompleto, pa (AAAAMM), indicadorTransmissao, indicadorComparacao,
declaracao: {
  tipoDeclaracao (1 original | 2 retificadora),
  receitaPaCompetenciaInterno, receitaPaCompetenciaExterno,
  receitasBrutasAnteriores[{pa, valorInterno, valorExterno}]   ← só 1ª declaração / sem histórico
  estabelecimentos[{ cnpjCompleto, atividades[{
      idAtividade, valorAtividade,
      receitasAtividade[{ valor, qualificacoesTributarias[{codigoTributo, id}], isencoes, reducoes, ... }]
  }]}]
},
valoresParaComparacao[{codigoTributo, valor}]
```

- Tributos: 1001 IRPJ, 1002 CSLL, 1004 COFINS, 1005 PIS, 1006 CPP, 1007 ICMS, 1010 ISS.
- Atividades usadas no comércio:
  - 1: revenda **sem** ST, monofásico ou antecipação.
  - 2: revenda **com** ST, monofásico ou antecipação.
  - 3: revenda para exportação.
- Qualificações: 8 substituição tributária, 9 tributação monofásica, 10 antecipação com encerramento.
- A resposta traz `idDeclaracao`, o **recibo e a declaração em PDF**, os `valoresDevidos` e, se houver atraso, a notificação e o DARF da MAED.
- Se o período já tiver declaração, só é possível enviar uma **retificadora** (`tipoDeclaracao: 2`).
- `estabelecimentos` precisa conter **todos** os estabelecimentos ativos: matriz e filiais na mesma declaração.

⚠️ **A confirmar no ambiente de teste (trial) do SERPRO antes de transmitir de verdade:**

- A forma de `qualificacoesTributarias` (`{codigoTributo, id}` com `id` = 8/9/10). O exemplo oficial manda a lista vazia; o formato veio de uma biblioteca de terceiros.
- Os códigos de município. Parecem ser TOM/SIAFI (4 dígitos), não IBGE.

## 2. De onde vem a receita (o ponto crítico)

**Hoje o Appura não tem notas de saída.** A captação pela SEFAZ só traz as notas em que o cliente é destinatário. A NFC-e (quase toda a venda de farmácia) e as NF-e emitidas pelo próprio cliente não vêm por esse canal. Na produção atual há 1.006 NF-e de entrada, 323 CT-e e **nenhuma saída**.

Fontes possíveis:

| Fonte | O que dá | Situação |
|---|---|---|
| **Importar XML/ZIP** | Todas as notas, item a item, com NCM e CSOSN (segregação exata) | Já existe (tela Notas). Depende de alguém baixar do sistema de venda ou da Sieg/Jettax todo mês |
| **API da Sieg / Jettax** | O mesmo que o XML, automático | A construir. O escritório já usa: é o caminho natural |
| **SINTEGRA** (61/61R e 75) | Totais de NFC-e por dia e por produto, com NCM no 75 | O leitor já existe. Segregação por item, menos precisa; boa como **conferência** |

Recomendação:

- XML como fonte de cálculo, via API da Sieg/Jettax quando possível, com a importação manual como alternativa.
- SINTEGRA como **conferência de completude**, sem entrar no cálculo.

**Completude antes de apurar.** O Appura bloqueia ou avisa quando:

- falta numeração na sequência de NFC-e/NF-e por série (nota que não chegou);
- há nota só com resumo (sem itens);
- o total do XML diverge do SINTEGRA do mês (quando enviado).

## 3. Segregação (motor de apuração)

Por item de nota de saída **autorizada** (canceladas ficam de fora):

- **Receita do item** = `vProd − vDesc + vFrete + vSeg + vOutro`. O desconto incondicional reduz; IPI e ICMS-ST não entram.
- **O CFOP decide se é receita.**
  - Entram: venda (51xx/61xx, 54xx/64xx ST, 5656/5667 etc.).
  - Ficam de fora: remessa, transferência, bonificação, conserto, devolução de compra (5202/6202/5411/6411) e outros não-receita. Isso vai numa tabela revisável pelo escritório, como as outras da auditoria.
  - Exportação (7xxx) vai para a atividade 3.
- **Devoluções de venda** (entradas 1202/2202/1411/2411) são deduzidas da receita do mês em que a devolução ocorre, na mesma segregação do item devolvido.
- **Qualificação do item:**
  - **ICMS-ST (8):** CSOSN 500 (ICMS cobrado anteriormente por ST, caso típico da farmácia) ou CST 60.
    - CSOSN 201/202/203 (o cliente é o substituto) ficam como **tributado**, com alerta para o analista.
    - Item com CSOSN 102 mas com NCM/CEST na tabela de ST do ES → **alerta de possível ST não aplicada**, que é imposto pago a mais. A tabela de ST do ES já existe no Appura.
  - **Monofásico PIS/COFINS (9):** pelo **NCM**, com a mesma lista da auditoria (`src/auditoria/tabelas.ts`: farmacêuticos, perfumaria e higiene, bebidas frias, pneus). No Simples o CST de PIS da NFC-e costuma vir 49/99 e não é confiável; se o CST disser o contrário, vira alerta.
  - Itens **sem NCM** entram como tributados, com alerta. Na dúvida, o Appura não reduz imposto sem base.
- **Agrupamento:**
  - Atividade 1 (sem qualificação).
  - Atividade 2 com até 3 parcelas: {ST}, {monofásico}, {ST + monofásico}.
  - Atividade 3 (exportação).
  - Matriz e filiais (mesma raiz de CNPJ, regime Simples) vão juntas, cada uma no seu `estabelecimento`.
- **Ajustes manuais** para receita fora das notas (serviço com NFS-e, venda sem nota emitida depois etc.). Cada ajuste tem valor, atividade, qualificação e **justificativa obrigatória**, e fica no histórico.

## 4. Telas e fluxo

A apuração é uma aba nova na **Empresa 360°** e uma etapa nova na **Central de Fechamento**, entre Validação e Guias.

1. **Prévia (grátis, sem SERPRO).**
   - Receita total e quadro por atividade e qualificação.
   - Os NCMs que mais pesam em cada grupo.
   - Os alertas: completude, possível ST não aplicada, itens sem NCM, CST incoerente.
   - Os ajustes manuais.
   - Comparação com a receita do mês anterior e do mesmo mês do ano passado, para pegar valor fora da curva.
2. **"Calcular na Receita"** (1 chamada SERPRO). Mostra os valores por tributo (IRPJ … ICMS), o total do DAS e a alíquota efetiva que resultou.
3. **"Transmitir PGDAS-D"**, com confirmação forte:
   - resumo do que será declarado;
   - aviso de que é uma declaração oficial;
   - quando for retificadora, a diferença para a declaração anterior.

   Sai com o recibo e a declaração em PDF guardados.
4. **Gera o DAS** (serviço que já existe) e **envia à Acessórias** (já existe, automático). O analista pode escolher enviar também o recibo e o extrato.

Trilha: cada apuração guarda:

- as notas usadas (chaves) e os ajustes;
- a simulação;
- quem transmitiu e quando;
- o `idDeclaracao` e os PDFs.

A apuração transmitida fica **travada**. Mudança depois disso é uma nova apuração retificadora.

## 5. Dados (novas tabelas)

- `apuracoes_simples`:
  - identificação: empresa (matriz), competência;
  - `status` (rascunho → simulada → transmitida → retificada) e tipo (original/retificadora);
  - valores: receita por grupo (jsonb), simulação (valores por tributo), total do DAS;
  - transmissão: `id_declaracao`, caminhos do recibo e da declaração (R2), por/em de cada etapa.
- `apuracao_ajustes`: valor, atividade, qualificações, justificativa, por, em.
- `apuracao_notas`: chaves e valores usados, para auditoria e para reproduzir a apuração.
- CFOPs de receita: tabela editável como as outras.

## 6. Etapas de entrega

| Etapa | Entrega | Depende de |
|---|---|---|
| **A** | Fonte das saídas (API Sieg/Jettax e/ou importação guiada) + checagem de completude (sequência, resumo, SINTEGRA) | Decisão 1 |
| **B** | Motor de segregação + prévia + ajustes manuais (sem SERPRO) | A |
| **C** | Simulação + transmissão com comparação + recibo + DAS + Acessórias; teste no trial do SERPRO | B |
| **D** | Retificadora, etapa na Central de Fechamento, ferramentas no MCP (consulta e prévia; transmissão só pelo painel) | C |

A etapa B já entrega valor sozinha. Mesmo com a transmissão feita fora, ela mostra quanto o cliente deveria declarar e onde o imposto está sendo pago a mais.

## 7. Fora desta etapa

- Regime de caixa (`receitaPaCaixa*`).
- Serviços dos Anexos III, IV e V com fator r (folha de salários).
- Farmácia de manipulação (industrialização).
- ISS com retenção ou outro município.
- Isenções e reduções de ICMS (cesta básica).
- Exigibilidade suspensa.
- IBS/CBS da reforma tributária.

O desenho não fecha a porta para nenhum deles: todos são outras atividades e qualificações no mesmo pedido.

## 8. Decisões

Tomadas em 30/09/2026:

1. **Fonte das saídas:** API Sieg/Jettax como fonte principal, com a importação de XML/ZIP de reserva.
2. **Quem transmite:** o analista confere e simula; **supervisor ou admin transmite**.
3. **Escopo da 1ª versão:** só comércio (revenda, Anexo I).
4. **Ordem:** a etapa B primeiro, antes da fonte automática e do SERPRO.

**Ainda a validar com o escritório:**
   - devolução deduzida no mês da devolução;
   - frete destacado na nota entra na receita;
   - bonificação fora da receita.
