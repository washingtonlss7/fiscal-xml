# Módulos do escritório

Telas que antes apareciam como "Em breve" no menu. Todas usam o mesmo login e as permissões por módulo, ação e escopo de empresas (ver `docs/acesso.md`). A lista de clientes é a tabela `empresas` do Appura.

| Menu | Endereço | Permissão | O que faz |
|---|---|---|---|
| Auditoria | `#/auditoria` | `fiscal.ver` | Apontamentos do mês de todas as empresas, por empresa e por regra. Mostra também as notas ainda não auditadas. O tratamento de cada apontamento continua na aba Auditoria da empresa. |
| ICMS-ST | `#/icms-st` | `fiscal.ver` (substituir tabela: `fiscal.configurar`) | Entradas NF-e de fora do estado no mês, por empresa, com ST destacado ou não. Baixa e substitui a tabela de ST do ES. O cálculo por item continua na aba ICMS-ST da empresa. |
| Folha | `#/folha` | `folha.ver` / `operar` / `configurar` | Controle do mês por empresa com etapas configuráveis. As etapas padrão são folha fechada, eSocial, DCTFWeb, FGTS Digital, guias ao cliente e contabilizada. "Contabilizada" é marcada sozinha quando o Contábil gera os lançamentos da folha. A tela mostra as rubricas importadas no Contábil. |
| Societário | `#/societario/clientes`, `/vencimentos`, `/processos` | `societario.ver` / `operar` | Ficha do cliente (cadastro societário, sócios com participação, documentos com validade e arquivo cifrado, processos com etapas). Também tem os vencimentos de alvarás e certidões e os processos de abertura, alteração e baixa. "Novo cliente" cadastra uma empresa sem certificado (exige `administracao.empresas` e ver todas as empresas). |
| Financeiro | `#/financeiro/resumo`, `/cobrancas`, `/contratos` | `financeiro.ver` / `operar` / `configurar` | Contratos de honorários por cliente. As cobranças do mês são geradas a partir dos contratos vigentes, sem duplicar. Também há cobrança avulsa, baixa de pagamento, cancelar e reabrir, inadimplência e o resumo previsto × recebido. |
| Atendimento | `#/atendimento`, `#/atendimento/<nº>` | `atendimento.ver` / `operar` / `configurar` | Chamados por departamento, prioridade, canal, responsável e prazo, com conversa interna. As mudanças de situação e de responsável ficam registradas na conversa. Excluir exige `configurar`. |
| Relatórios | `#/relatorios` | ver algum módulo (cada planilha confere o módulo dela) | Planilhas xlsx: empresas, certificados, auditoria do mês, ICMS-ST do mês, pendências do Contábil, folha do mês, vencimentos do societário, honorários do mês, inadimplência e chamados em aberto. |
| Administração → Certificados | `#/certificados` | `administracao.empresas` | Validade dos certificados de todas as empresas: vencidos, vencendo em até 30 dias, sem certificado e em dia. |
| Administração → Configurações | `#/configuracoes` | `administracao.configuracoes` | Situação do Integra Contador, da Acessórias, da tabela de ST, do Contábil, das integrações por API, do Coletor, dos usuários e dos módulos, com o atalho para cada ajuste. |

## Banco

Migração `supabase/migrations/0044_modulos_escritorio.sql` (só tabelas novas). A reversão está em `supabase/rollback/0044_modulos_escritorio_down.sql`.

- Folha: `folha_etapas`, `folha_empresas`, `folha_controle` (uma linha por empresa, competência e etapa).
- Societário: `soc_cadastro`, `soc_socios`, `soc_documentos` (o arquivo fica cifrado no armazenamento, em `societario/<empresa>/…`), `soc_processos` (etapas em jsonb).
- Financeiro: `fin_contratos` e `fin_titulos` (uma cobrança por contrato e competência, com chave única).
- Atendimento: `atd_chamados` e `atd_mensagens`.
- O módulo `atendimento` entra em `escritorio_modulos` e nos perfis padrão.

## Código

- Serviços: `src/modulos/` (`comum.ts`, `folha.ts`, `societario.ts`, `financeiro.ts`, `atendimento.ts`, `escritorio.ts`). Toda consulta e toda gravação passa pelo escopo de empresas de quem chama.
- Rotas: `rotaModulos` em `src/painel/server.ts`. As permissões estão em `exigenciaDaRota` (`src/painel/acesso.ts`).
- Telas: `public/escritorio.js` (Auditoria, ICMS-ST, Relatórios, Certificados, Configurações e o kit de componentes `window.esKit`), `public/folha.js`, `public/societario.js`, `public/financeiro.js`, `public/atendimento.js`.
- Testes: `test/modulos.test.ts` (serviços com banco em memória e permissões) e `test/escritorio-tela.test.ts` (funções das telas, rotas e ligação no HTML, no service worker e no servidor).
