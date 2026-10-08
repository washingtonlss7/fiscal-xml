# Pendências do Appura

Lista viva do que ficou em aberto, das divergências e dos erros conhecidos. A mais recente fica no topo.

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

### Divergências em relação ao combinado

- **Relatórios:** a proposta citava "Relatórios" como algo que o perfil Consulta veria. Relatórios não virou um módulo: cada módulo cuida dos seus. No menu, "Relatórios" continua "Em breve" para quem vê algum módulo.
- **"Notas Fiscais" e a busca de XML:** ficaram no módulo Captação (`captacao.ver`), não no Fiscal. Assim o perfil contábil, por exemplo, vê as notas sem ver o fiscal.
- **Envio de SPED sem empresa:** quem tem escopo limitado precisa enviar o SPED pela tela da empresa. O envio solto, em que o Appura descobre a empresa pelo CNPJ, ficou só para quem vê todas.

### Erros encontrados na implementação (corrigidos)

- Nenhum em produção. Nos testes, foram corrigidas duas expectativas: o id gerado de "2º turno" e o nome mínimo de 2 letras.
