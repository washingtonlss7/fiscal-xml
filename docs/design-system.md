# Appura — Design System

> **Regra para desenvolvimentos futuros:** a partir do Checkpoint 5, novas telas do Appura devem reutilizar o Design System existente. **Não criar um novo padrão visual por módulo.**
> Isso vale especialmente para SPED Fiscal, SPED Contribuições, SINTEGRA, Validação, Guias, Relatórios e Atendimento.

Fonte única dos estilos: `public/app.css`.
- Os **tokens** ficam em `:root` (tema claro) e no bloco do tema escuro.
- A seção **"COMPONENTES BASE (Checkpoint 5)"** fica no fim do arquivo e unifica os componentes equivalentes.
- Formatação e rotas ficam em `public/nucleo.js`, com testes em `test/nucleo.test.ts`.

---

## 1. Cores

| Token | Uso | Claro | Escuro |
|---|---|---|---|
| `--fundo` | fundo da página | `#f5f7fb` | `#0b1220` |
| `--superficie` | cards, tabelas, campos | `#ffffff` | `#111a2b` |
| `--superficie-2` | fundo secundário (cabeçalho de tabela, hover) | `#f8fafc` | `#162033` |
| `--linha` / `--linha-forte` | bordas | `#e5e9f0` / `#d5dbe5` | `#22304a` / `#2c3c5a` |
| `--tinta` | texto principal | `#0f172a` | `#e5ecf5` |
| `--tinta-2` | texto secundário | `#556274` | `#94a3b8` |
| `--tinta-3` | texto auxiliar / desabilitado | `#637085` | `#7d8ba1` |
| `--primaria` | azul Appura (ações, foco, link) | `#1d6af2` | `#5b9bff` |
| `--texto-no-destaque` | texto sobre a cor primária | `#ffffff` | `#0b1220` |
| `--lateral*` | sidebar (escura nos dois temas) | | |

Todos os pares de texto atingem contraste AA (4,5:1) sobre `--superficie`. A verificação foi refeita no Checkpoint 5.

### Status
Cada status tem três tokens:
- **texto** (`--ok`): legível sobre o fundo;
- **fundo** (`--ok-fundo`): para selos e caixas;
- **vivo** (`--ok-vivo`): para pontos, barras e gráficos.

| Status | Significado | Exemplos |
|---|---|---|
| `ok` | sucesso / concluído | Captação regular, Auditada, Válido |
| `info` | informativo / em andamento | Em andamento, Auditando |
| `pendente` | precisa de ação (amarelo) | Com pendências, divergências |
| `atencao` | alerta (laranja) | Captação atrasada, Erro na consulta |
| `problema` | erro / bloqueio (vermelho) | Bloqueado, Certificado vencido |
| `progresso` | roxo / informativo secundário | ICMS-ST, Simples Nacional |
| `neutro` | sem dado, pausado, desabilitado | Pausada, Não disponível, Em breve |

**Status nunca é comunicado só pela cor.** Sempre há texto e, quando cabe, símbolo ou ícone (✓ ! ✕ –).

---

## 2. Tipografia
- **Inter** para toda a interface.
- **Poppins** só na marca ("appura").
- Números usam `font-variant-numeric: tabular-nums`.

| Token | px | Uso |
|---|---|---|
| `--t-2xs` | 11 | rótulos em caixa alta ("EM BREVE") |
| `--t-xs` | 12 | selos, etiquetas, cabeçalho de tabela, tabelas densas |
| `--t-s` | 13 | texto auxiliar (`.meta`), botões pequenos |
| `--t-m` | 14 | corpo de card, controles, tabela |
| `--t-base` | 15 | corpo da página |
| `--t-card` | 16 | título de card / folha |
| `--t-l` | 18 | título de seção (`h2`) |
| `--t-xl` | 22 | título de página (`h1`) |
| `--t-num` | 26 | números de indicador (KPI) |

Pesos da fonte: 400 (corpo), 550 (rótulos e botões), 600 (selos e títulos de card), 650/700 (títulos e números).

---

## 3. Espaçamento, raio, borda e sombra
- **Espaço:** `--esp-1` a `--esp-9` = 4, 8, 12, 16, 20, 24, 32, 40, 48 px. Valores fora da escala (6, 10, 14, 18 px) ficaram só em ajustes finos de componentes já aprovados.
- **Raio:**
  - `--raio` 10px: cards e contêineres;
  - `--raio-m` 8px: botões, campos e selects;
  - `--raio-p` 6px: etiquetas;
  - `--raio-pilula` 999px: selos e contagens.
- **Borda:** `--borda` (1px `--linha`).
- **Foco:** `:focus-visible` com contorno de 2px na cor primária. Os campos usam o anel `--anel-foco`.
- **Sombra:**
  - `--sombra-cartao` (quase imperceptível; nenhuma no escuro) para cards;
  - `--sombra` só para camadas flutuantes (menus, gaveta, folha, aviso).
- **Sobreposição de diálogo:** `--sobreposicao`.

---

## 4. Breakpoints
| Largura | Comportamento |
|---|---|
| ≤ 760px | **celular**: header compacto, barra inferior, cards no lugar de tabelas, folha de ações, alvos de 44px |
| 761–1023px | tablet: sidebar vira gaveta, grades de 2 colunas |
| 1024–1279px | desktop compacto: sidebar recolhível |
| 1280–1599px | desktop: CNPJ e regime sob o nome na Central |
| ≥ 1600px | desktop largo: todas as colunas |

Alguns ajustes pontuais de telas antigas ainda usam 374, 560, 700 e 900px. Não crie novos: use os da tabela.

---

## 5. Componentes

### Botão (`.botao`)
| Variante | Classe | Quando |
|---|---|---|
| primário | `.botao.primario` | a ação principal da tela (uma por área) |
| secundário | `.botao` | demais ações |
| fantasma | `.botao.fantasma` | ações de baixo peso (voltar, limpar, recusar) |
| perigo | `.botao.perigo` / `.botao.perigo-cheio` | pausar, excluir (sempre com confirmação) |
| ícone | `.botao-icone` (+ `aria-label`) | ações só com ícone |
| pequeno | `.botao.pequeno` | ações dentro de linhas e cards (32px; 44px no celular) |
| desabilitado | `disabled` | |
| ocupado | `aria-busy="true"` | aplicado por `comOcupado()`: giro, texto "…ando" e bloqueio de duplo clique |

Altura padrão: `--controle-altura` (40px).

**Ação assíncrona:** sempre use `comOcupado(botao, 'Sincronizando…', fn, chave)`.
- O botão fica desabilitado e com o giro enquanto a ação roda.
- O `avisar()` mostra o resultado.
- Em erro, o aviso traz "Tentar de novo".
- A `chave` impede pedidos duplicados.

### Campo e select (`.campo input`, `.vg-select`, buscas)
- Mesma altura (40px; 44px no celular), mesmo raio (8px) e o mesmo anel de foco.
- **Erro:** `aria-invalid="true"` (borda e anel vermelhos) e mensagem em `.erro`.
- **Desabilitado:** fundo `--superficie-2` e texto `--tinta-3`.
- Todo campo tem `<label>`. Se o rótulo não aparece na tela, use `.visualmente-oculto`.

### Selo, etiqueta e contagem
| Componente | Classe | Forma | Uso |
|---|---|---|---|
| Selo de status | `.selo.<status>` | pílula | Bloqueado, Com pendências, Em andamento, Concluído, Válido, Não enviado |
| Etiqueta | `.etiqueta.<status>` (= `.e360-selo`, `.vg-regime`) | retângulo, raio 6 | dados cadastrais: regime, UF, Ativa/Pausada, Matriz |
| Contagem | `.contagem` (= `.contador`, `.fc-pend`) | pílula numérica | abas, pendências |
| "Em breve" | `.em-breve-rotulo` (= `.nav-breve`, `.vg-breve`) | caixa alta 11px | itens não implementados |

### Card
- **Contêiner base:** `.vg-card`.
- **Variações:**
  - `.vg-kpi`: indicador (ícone + número + rótulo + meta);
  - `.e360-card`: módulo (ícone + título + valor + lista de números + ação);
  - `.vg-atencao-item`: alerta clicável que leva à tela da ação;
  - `.fc-cartao`: empresa no celular.
- **Estados:** `.vg-vazio` (vazio), `.vg-erro` (erro com "Tentar de novo"), `.vg-skel` (carregando) e `.e360-breve` (indisponível / "Em breve").

### Tabela
- `.vg-tabela` (Central, SPED, Arquivos), `table.notas` e `table.usuarios` têm o mesmo cabeçalho: 12px, peso 600, `--tinta-2`, fundo `--superficie-2`, sem caixa alta.
- Linhas com hover e última linha sem borda.
- Números alinhados à direita com `tabular-nums`. Ações na última coluna.
- **No celular, tabelas grandes viram cards** (`.fc-cartoes`, `.notas-cartoes`). Nunca espremer a tabela.
- **Estado vazio:** mensagem na área da tabela.

### Abas
- `.abas-tela` com `role="tablist"`, `aria-selected` e contagem opcional.
- A aba ativa atualiza o endereço (`#/empresas/<id>/<aba>`) sem perder a empresa nem a competência.
- No celular, só a barra de abas rola na horizontal; a aba ativa é trazida para a vista.

### Diálogos: gaveta, folha e menu
| Componente | Classe | Uso |
|---|---|---|
| Gaveta lateral | `.gaveta` + `.gaveta-fundo` | formulários: certificado, usuário |
| Folha inferior (celular) | `.folha` + `.folha-fundo` | "+ Ações" da empresa. Rola quando há muitas ações (máx. 85% da altura) |
| Menu suspenso | `.menu-suspenso` / `.menu-acoes` | "Mais ações", menu do usuário |

Regras comuns:
- `role="dialog"`, `aria-modal="true"` e título ligado por `aria-labelledby`.
- ESC, clique fora e botão ✕ fecham.
- `abrirDialogo()` / `fecharDialogo()`: o foco fica preso dentro do diálogo, a rolagem da página trava (`body.com-dialogo`) e, ao fechar, o foco volta ao botão que abriu.

### Lista de divergências com justificativa (`spedListaDiv()` em `empresa-360.js`)
Padrão único para SPED Fiscal, SPED Contribuições e SINTEGRA (e para as próximas validações):
- situação em `.segmentos` (**Abertas · Justificadas · Todas**, só aparece quando há justificadas) e tipo em chips `.vg-chip-f`;
- cada item: selo do tipo (tom pelo nível), selo "✓ Justificada", documento, data, valores e chave;
- **Justificar** abre a gaveta `#gj` (observação obrigatória, mín. 5 caracteres, erro com `aria-invalid`); **"Justificar todas as N"** aplica ao filtro atual;
- justificada mostra a observação, quem e quando (`.sped-just`) e **Reabrir**;
- ações só com a permissão `operar`; o backend grava quem/quando, e a justificativa sobrevive a um arquivo retificador.

### Tooltip / ajuda (`vgAjuda()` → `.ajuda` + `.ajuda-texto`)
- O "?" abre ao passar o mouse, ao focar pelo teclado ou ao tocar.
- Tem `aria-describedby` e fecha com ESC ou clique fora.
- Área de toque de 44px (pseudo-elemento).

### Aviso flutuante (`avisar(texto, { tipo, acao })`)
| Tipo | Aparência | Duração |
|---|---|---|
| `info` | neutro | 4s |
| `ok` | ícone ✓ | 4s |
| `erro` | ícone, cores de problema, `role="alert"` | 8s |

- `acao` adiciona um botão, por exemplo "Tentar de novo".
- **Mensagens nunca são técnicas.** Falha de rede vira "Sem conexão com o servidor…" e erro 5xx vira "O servidor não conseguiu concluir…".

---

## 6. Estados de tela
Toda área que depende da API trata os estados abaixo:

| Estado | Como aparece |
|---|---|
| **Carregando** | skeleton (`.vg-skel`) no lugar do conteúdo, sem piscar dados da empresa anterior |
| **Vazio** | frase específica: "Nenhuma empresa com esses filtros.", "Nenhum SPED Contribuições de Setembro / 2026 enviado ainda." |
| **Erro** | `.vg-erro` com mensagem compreensível e "Tentar de novo" |
| **Indisponível** | "Em breve" ou "Não disponível", nunca dados fictícios |
| **Sem permissão** | a ação não é desenhada. Rota direta sem permissão volta para a Visão Geral com aviso. O backend continua bloqueando |

---

## 7. Navegação
- **Desktop:** sidebar escura com os estados normal, hover, ativo (`aria-current="page"`), recolhida com dica, submenu e "Em breve" (não clicável). A preferência de recolher fica salva.
- **Rotas:** `resolverRota()` em `public/nucleo.js`. Endereço desconhecido redireciona, e aba inexistente volta para a Visão Geral da empresa. Nenhum endereço abre página em branco.
- **Competência** global no header, mantida ao navegar. Ao enviar um SPED de outro mês, o Appura vai para o mês do arquivo.

## 8. Tema escuro
- **Automático** (padrão) segue o sistema.
- **Claro/Escuro** são escolhidos no menu do usuário, ficam salvos no navegador e são aplicados com `data-tema` no `<html>`.
- Todas as cores vêm dos tokens. Não use cor fixa em componente; a única exceção é o branco sobre a sidebar e os pontos "vivos".

## 9. Formatação (pt-BR)
| Dado | Formato | Função |
|---|---|---|
| Moeda | R$ 18.420,35 | `moeda()` |
| Data | 30/09/2026 | `formatarData()` |
| Hora | 02:48 | `formatarHora()` |
| Competência | Setembro / 2026 | `textoCompetencia()` |
| CNPJ | 00.000.000/0001-00 | `formatarCnpj()` |
| Percentual | 69,6% | `formatarPercentual()` |

## 10. Termos
| Use | Evite |
|---|---|
| Captação (regular, atrasada, aguardando 1ª captação) | "sincronização em dia" para status |
| Sincronizar XML (a **ação** de pedir a captação agora) | |
| Com pendências · Em andamento · Bloqueado · Concluído (status do fechamento) | |
| Competência | |
| Central de Fechamento · Empresa 360° | |
| Certificado A1 | |
| Auditoria | |

---

## 11. MOBILE
**Referências:** 390 × 844, 393 × 852 e 430 × 932. O layout nunca depende de altura fixa; use `dvh` só como limite, por exemplo na folha de ações.

- **Breakpoint** do celular: `max-width: 760px`.
- **Header:** ☰, logo appura, sino e avatar na primeira linha; seletor de competência inteiro na segunda. Tudo com alvo de 44px. Mesmo header em todas as telas.
- **Barra inferior:** Início, Empresas, Pendências, Avisos e Mais.
  - Ícone acima do rótulo e estado ativo pela rota atual.
  - Respeita `safe-area-inset-bottom`.
  - O conteúdo tem `padding-bottom` de 96px + safe area e nunca fica escondido atrás dela. O aviso flutuante sobe acima da barra.
- **Tabelas** viram cards. Nenhuma página tem rolagem horizontal; só a barra de abas pode rolar.
- **Abas horizontais** da Empresa 360°: rolam dentro da barra, e a ativa sempre fica visível.
- **Cards:** padding de 12 a 16px e margem lateral de 16px.
- **Folha inferior:** "+ Ações" abre a folha com alça, título, itens de 52px, fechar, ESC e fundo clicável. Rola se houver muitas ações.
- **Toque:** botões, campos, selects e ícones com 44px no mínimo. O "?" usa área de toque estendida.
- **Safe areas:** topo no header, base na barra inferior, na folha e no aviso.

---

## 12. Decisões registradas na aprovação do Checkpoint 5 (30/09/2026)
- O redesign está encerrado. Daqui em diante, as fases são fiscais e constroem sobre este Design System, sem reinventar interface.
- Trocar de aba na Empresa 360° **não** cria passo no histórico do navegador: "voltar" leva à página anterior, como aprovado no CP4.
- Os breakpoints legados (374, 560, 700 e 900px) ficam como estão enquanto funcionarem. Telas novas usam 760, 1024, 1280 e 1600px.
- A tela Empresas mantém o layout aprovado, inclusive os cabeçalhos em caixa alta. Não haverá mudança só estética.
