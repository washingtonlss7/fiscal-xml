# MCP do Appura

Endereço: `https://<appura>/mcp` (Streamable HTTP, sem estado). Tela: Administração › Conexões de IA (`#/ia`).

## Autenticação

- **Apps com login** (Claude, ChatGPT...): OAuth 2.1 conforme a especificação MCP 2025-11-25. Suporta PKCE S256, resource (RFC 8707), CIMD, DCR e refresh rotativo com detecção de reuso. O usuário entra com e-mail e senha do Appura na tela de consentimento.
- **Token pessoal** (n8n, Claude Code, Cursor): `Authorization: Bearer appura_pt_...`. É criado na tela, aparece uma única vez e vale de 30 a 365 dias.
- O banco guarda só o hash SHA-256 de códigos e tokens. Um usuário removido do Appura perde o MCP na hora (403).

## Escopos

| Escopo | O que libera |
|---|---|
| `appura.leitura` | 7 ferramentas de consulta: empresas, Central de Fechamento, resumo da empresa, divergências, auditoria, notas e guias |
| `appura.acoes` | 4 ferramentas de ação (abaixo) |

As ações só aparecem quando duas condições valem ao mesmo tempo:

1. A conexão tem `appura.acoes`. Na tela de consentimento, a caixa "Permitir também ações" vem marcada e pode ser desmarcada. No token pessoal, a opção "Permitir ações" só existe para perfis que podem operar.
2. O perfil do usuário tem a permissão `operar`. Isso é conferido a cada requisição, então o perfil Consulta nunca executa ações.

## Ações (fase 2)

| Ferramenta | O que faz |
|---|---|
| `appura_justificar_divergencias` | Justifica divergências em aberto do SPED/SINTEGRA, filtradas por tipo, chave, número ou todas (até 500). Exige observação. |
| `appura_reabrir_divergencias` | Tira a justificativa. |
| `appura_verificar_procuracao` | Consulta a procuração no Integra Contador, até 20 empresas. Cada empresa é uma consulta cobrada pelo SERPRO. |
| `appura_enviar_guias_acessorias` | Envia à Acessórias as guias DAS já geradas que ainda não foram enviadas. Não gera guia. |

Toda ação acontece em duas etapas (`src/mcp/acoes.ts`):

1. A chamada sem `confirmacao` devolve a prévia (item a item) e um código. Nada é alterado.
2. A chamada com `confirmacao` executa exatamente o alvo da prévia.

Sobre o código de confirmação:

- É `exp36.hmac` (HMAC-SHA256 com chave derivada da `MASTER_KEY`) sobre usuário, ferramenta e alvo já resolvido: ids, lista de itens, texto.
- Vale 10 minutos e só pode ser usado uma vez.
- Se o alvo mudar entre a prévia e a execução, ou os argumentos forem outros, o código é recusado e a IA precisa gerar nova prévia.
- As instruções do servidor dizem à IA para mostrar a prévia e só confirmar depois do "sim" explícito do usuário.

Toda chamada, seja prévia, execução ou falha, fica em `mcp_chamadas` com e-mail, app e argumentos.

## Fora do MCP (de propósito)

Não passam pelo MCP:

- gerar DAS ou qualquer guia nova;
- apagar dados;
- mexer em certificados, chaves do SERPRO ou token da Acessórias;
- cadastrar usuários.
