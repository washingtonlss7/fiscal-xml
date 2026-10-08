# Acesso: módulos, perfis e empresas

Um login só para tudo. O que cada pessoa vê e faz sai de três coisas:

1. **Perfil**: lista de permissões no formato `<módulo>.<ação>`.
2. **Exceções**: permissões dadas ou tiradas só daquela pessoa, sem mudar o perfil.
3. **Escopo de empresas**:
   - `todas`;
   - `carteira`: as empresas em que a pessoa é responsável em algum módulo;
   - `lista`: empresas escolhidas uma a uma.

O servidor confere tudo em cada chamada. A tela só esconde o que a pessoa não pode usar.

## Módulos e ações

| Módulo | Ações | Situação |
|---|---|---|
| `captacao` Captação e notas | ver, operar (sincronizar, importar) | no ar |
| `fiscal` Fiscal | ver, operar, transmitir (PGDAS-D), configurar (tabela ICMS-ST) | no ar |
| `contabil` Contábil | ver, operar, fechar, transmitir, configurar | em breve |
| `folha` Folha | ver, operar, fechar, transmitir, configurar | em breve |
| `societario` Societário | ver, operar, configurar | em breve |
| `financeiro` Financeiro do escritório | ver, operar, configurar | em breve |
| `administracao` Administração | usuarios (usuários, perfis, responsáveis), empresas (empresas, certificados, coletor, cadastros), configuracoes (integrações, SERPRO, Acessórias) | no ar |

As regras de cada rota ficam em `src/painel/acesso.ts` (`exigenciaDaRota`).

- **Rota sem regra:** leitura exige `fiscal.ver` e gravação exige `fiscal.operar`. Uma rota nova nunca fica aberta por engano.
- **Telas comuns:** a lista de empresas e a Empresa 360° exigem "ver algum módulo".

## Perfis prontos

Ficam na migration 0042 e em `PERFIS_PADRAO`. O teste confere que os dois são iguais. Não são editáveis pela tela: use "Duplicar".

- **Administrador:** tudo.
- **Gestor:** todo o trabalho de todos os módulos, sem administração.
- **Supervisor fiscal** (antigo Supervisor): captação, fiscal com transmitir, e empresas/certificados.
- **Analista fiscal** (antigo Analista): captação e fiscal, ver e operar.
- **Analista contábil:** contábil ver, operar e fechar, mais ver captação e fiscal.
- **Analista de folha:** folha ver, operar e fechar.
- **Consulta:** ver captação e fiscal.

Na conversão, cada usuário recebeu o perfil equivalente ao antigo, com escopo `todas`. Nada mudou para ninguém.

## Escopo de empresas

Com escopo diferente de `todas`, as restrições abaixo valem em todo o sistema.

**Rotas de uma empresa:**
- Toda rota `/api/empresas/<id>/…` confere a empresa.
- As rotas de registros também conferem, pela empresa do registro: apontamentos, SPED, apuração, ajustes, SPED gerado, documentos e guias.

**Listas filtradas:**
- Empresas e Visão Geral.
- Captação: monitor, lacunas, importações e histórico (o histórico usa `captacao_por_dia_escopo`).
- Coletores, guias, entregas e documentos do Acessórias.
- Busca, ZIP e Excel de XML, pela função `busca_xml_escopo`.
- Cadastros sugeridos.

**Ações em lote:** guias em lote, enviar pendentes e enviar documentos ficam limitadas às empresas do escopo. Escopo vazio recusa a ação, em vez de virar "todas".

**Envio de SPED sem empresa** (o Appura acha pelo CNPJ do arquivo): só para quem vê todas as empresas.

**MCP (IA):**
- As ferramentas respeitam o módulo (notas exigem `captacao.ver`; o resto, `fiscal.ver`) e o escopo.
- As ações exigem `fiscal.operar`.

## Responsáveis (carteira)

A tabela `empresa_responsaveis` guarda empresa, módulo e e-mail. A tela fica em Administração → Responsáveis.

- **Responsáveis por módulo:** marque as empresas e escolha quem cuida delas naquele módulo.
- **Sugestões do Acessórias:** o Appura lê o departamento e o responsável das entregas e associa o departamento ao módulo (Fiscal → fiscal, Pessoal/DP → folha, Contábil → contabil, Societário/Legal → societario).
- **Como o nome casa com o usuário:** nome igual, ou o mesmo primeiro nome e último sobrenome. Um nome que casa com mais de um usuário não casa com nenhum.
- **Nada muda sozinho:** a sugestão só vale depois que o administrador aplica.

## Módulos do escritório

A tabela `escritorio_modulos` guarda quais módulos o escritório usa.

- Um módulo desligado some do menu e as permissões dele deixam de valer para todos, inclusive para os administradores fixos.
- A Administração não desliga.

## Proteções

- Ninguém muda o próprio acesso: perfil, escopo, exceções ou ativo.
- Sempre sobra pelo menos uma pessoa com `administracao.usuarios`. Isso vale também ao editar um perfil.
- Os administradores fixos (`PAINEL_EMAILS`) têm tudo e não são editáveis pela tela.
- Toda mudança fica registrada:
  - mudanças de usuário em `painel_usuarios_log`;
  - perfis, módulos e responsáveis em `acesso_log`.
- A coluna antiga `painel_usuarios.perfil` continua sendo gravada (admin/supervisor/analista/consulta), para permitir o rollback (`supabase/rollback/0042_acesso_modulos_down.sql`).
