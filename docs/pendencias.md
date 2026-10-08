# Pendências do Appura

Lista viva do que ficou em aberto, das divergências e dos erros conhecidos. A mais recente fica no topo.

## 2026-10-08: Contábil, fase 1 (processador de lançamentos conforme a ata)

### Pendências

**Aguardando o escritório:**
- **Departamento Contábil:**
  - tabela DE/PARA fiscal (CFOP → débito, crédito e histórico);
  - DE/PARA da folha (rubrica → débito, crédito e histórico);
  - relação de empresas: código do Domínio, CNPJ e períodos pendentes;
  - plano de contas do Domínio novo;
  - uma empresa modelo do Simples (e uma do Real), já escrituradas, para comparar o resultado.
- **Departamento Fiscal:** confirmar o campo do valor contábil das notas (Contábil → Processar). Até lá, as notas ficam pendentes.
- **Arquivo do Domínio:** um export real de lançamentos (Utilitários → Exportação → Lançamentos) para confirmar o cabeçalho do leiaute (o campo do lote e o "1" final) e o código de histórico. Até a confirmação, usar só o arquivo de teste.
- **Leitura do banco do Domínio:** rodar `scripts/dominio/diagnostico-dominio.ps1` no servidor, uma vez no Domínio novo e outra no antigo, e mandar o relatório. O script não foi executado aqui, porque não há Windows nem banco SQL Anywhere neste ambiente. Pode precisar de ajuste no primeiro uso.

**A construir:**
- Leitor do banco do Domínio para a folha, só leitura e só SELECT. Depende do diagnóstico.
- Fontes ainda não cobertas: CT-e, notas de serviço e SPED Fiscal (fase 4 da ata).
- Contábil como sistema oficial, para substituir o Domínio:
  - saldos de abertura;
  - razão, balancete, DRE e balanço;
  - fechamento do período;
  - extrato bancário (OFX) e conciliação;
  - ECD e ECF.
- Lançamentos de partida múltipla: hoje cada lançamento tem um débito e um crédito.

**Limitações conhecidas:**
- **Escopo de empresas:** quem tem acesso limitado só vê as empresas do Contábil que estão ligadas à captação do Appura, e não processa a planilha da folha.
- **Processamento em segundo plano:** o processamento fiscal roda em segundo plano dentro do painel. Se o painel reiniciar no meio, o registro fica "processando". Basta processar de novo, porque nada duplica.

### Divergências em relação à ata

- **Objetivo:** a ata trata o Domínio novo como destino final. Por pedido do Washington, o objetivo é substituir o Domínio no futuro. Por isso o plano de contas e o livro de lançamentos já ficam no Appura, e o Domínio vira um destino opcional.
- **Ordem das fases:** a ata prioriza a folha. A parte fiscal veio junto porque as notas já estão no Appura, e a folha entrou por planilha enquanto a leitura do banco não fica pronta. Escolha do Washington: "os dois em paralelo".
- **Regra de inversão:** a regra usa as contas exatamente como foram cadastradas, e a marcação de inversão é só informativa. Falta o Contábil confirmar se é isso, ou se essa marcação deve trocar débito e crédito.
- **Valor contábil:** em vez de assumir um campo, o Appura oferece três opções e espera a confirmação do Fiscal (item 18 da ata).

### Erros encontrados na implementação (corrigidos)

- Nos testes: uma expectativa de arredondamento entre CFOPs, ids numéricos no banco de teste e um parêntese a mais na tela de plano de contas.
- Na conferência visual: um texto "null" aparecia na tela de lançamentos, e o período ficava com o layout quebrado.

## 2026-10-07: permissões por módulo, perfis e escopo de empresas

### Pendências

- **Primeiro módulo do Domínio:** não foi definido qual vem primeiro, provavelmente o Contábil. Os módulos Contábil, Folha, Societário e Financeiro estão no catálogo, nos perfis e no menu, mas ainda como "Em breve".
- **Sugestões do Acessórias sem dados:** hoje a tabela `acessorias_entregas` não tem departamento nem responsável preenchidos (1 linha, entregas vazias). As sugestões vão aparecer depois de atualizar as entregas do mês com a Acessórias configurada.
- **Equipes:** falta a ideia de "supervisor vê a carteira da sua equipe". Hoje o supervisor usa o escopo "todas" ou uma lista.
- **Carteira por módulo:** a carteira vale para todos os módulos. Quem é responsável por uma empresa no Fiscal também a vê na Captação. Falta separar a carteira por módulo, se o escritório precisar.
- **Ação `fiscal.fechar`:** ainda não existe, porque o fiscal não tem uma ação de "concluir competência". Entra quando a Central de Fechamento tiver o botão.
- **Testes do servidor:** não há teste de ponta a ponta das rotas com escopo (servidor HTTP real). As regras estão testadas em `test/usuarios.test.ts`, e o MCP sem escopo em `test/mcp*.test.ts`. Falta um teste do MCP com escopo limitado.
- **Lista "Empresas da Acessórias"** (`GET /api/acessorias/empresas`): não é filtrada pelo escopo. Mostra o resumo de todas as empresas da Acessórias, para quem vê o fiscal.
- **Atualizar entregas do mês** (`POST /api/acessorias/entregas/atualizar`): consulta todas as empresas, mesmo para quem tem escopo limitado. É só leitura na Acessórias, mas gasta chamadas.

- **Conferência no painel publicado:** a nova versão subiu (reinício às 02:50 UTC de 08/10) e as telas novas foram conferidas fora do painel, com dados simulados. Falta alguém do escritório abrir Administração → Perfis de acesso e Responsáveis logado e criar um usuário de teste com escopo limitado.

### Divergências em relação ao combinado

- **Relatórios:** a proposta citava "Relatórios" como algo que o perfil Consulta veria. Relatórios não virou um módulo: cada módulo cuida dos seus. No menu, "Relatórios" continua "Em breve" para quem vê algum módulo.
- **"Notas Fiscais" e a busca de XML:** ficaram no módulo Captação (`captacao.ver`), não no Fiscal. Assim o perfil contábil, por exemplo, vê as notas sem ver o fiscal.
- **Envio de SPED sem empresa:** quem tem escopo limitado precisa enviar o SPED pela tela da empresa. O envio solto, em que o Appura descobre a empresa pelo CNPJ, ficou só para quem vê todas.

### Erros encontrados na implementação (corrigidos)

- Nenhum em produção. Nos testes, foram corrigidas duas expectativas: o id gerado de "2º turno" e o nome mínimo de 2 letras.
