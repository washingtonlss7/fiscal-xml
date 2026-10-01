'use strict';
/*
 * Conexões de IA (#/ia): o MCP do Appura. Endereço para conectar apps de IA (Claude, ChatGPT...) pelo login
 * do Appura (OAuth) e tokens pessoais para quem usa cabeçalho fixo (n8n, Claude Code, Cursor).
 * Cada usuário vê, cria e revoga só as próprias conexões. Leitura sempre; ações (justificar divergências,
 * verificar procuração, enviar guias à Acessórias) só quando o usuário permite e o perfil pode operar,
 * e sempre com prévia + confirmação na conversa.
 * Usa os utilitários globais do app.js (h, $, chamar, icone, comOcupado, avisar).
 */

/* ---------- funções puras (testadas em test/ia-tela.test.ts) ---------- */
const iaData = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');

/** Texto de "último uso" de uma conexão. */
function iaUltimoUso(iso, agora = Date.now()) {
  if (!iso) return 'Ainda não usado';
  const min = Math.floor((agora - new Date(iso).getTime()) / 60000);
  if (min < 60) return 'Usado há menos de 1 hora';
  if (min < 1440) return `Usado há ${Math.floor(min / 60)} h`;
  return `Usado em ${iaData(iso)}`;
}

/** Configuração pronta para clientes que aceitam JSON de servidores MCP (Claude Code, Cursor...). */
function iaConfigJson(url, token) {
  return JSON.stringify({ mcpServers: { appura: { type: 'http', url, headers: { Authorization: `Bearer ${token || 'SEU_TOKEN'}` } } } }, null, 2);
}

/** Selo de acesso de uma conexão. Ações só valem para quem pode operar (o servidor confere a cada chamada). */
function iaAcesso(acoes, podeOperar) {
  if (!acoes) return { texto: 'Leitura', classe: 'neutro' };
  return podeOperar ? { texto: 'Leitura e ações', classe: 'pendente' } : { texto: 'Leitura (ações bloqueadas pelo perfil)', classe: 'neutro' };
}

/** Nome das ferramentas do MCP para a tela. */
const IA_FERRAMENTAS = {
  appura_listar_empresas: 'Listar empresas', appura_central_fechamento: 'Central de Fechamento', appura_resumo_empresa: 'Resumo da empresa',
  appura_divergencias: 'Divergências', appura_apontamentos_auditoria: 'Apontamentos da auditoria', appura_notas_fiscais: 'Notas fiscais', appura_guias: 'Guias',
  appura_apuracao_simples: 'Apuração do Simples', appura_sped_gerado: 'SPED gerado', appura_acessorias: 'Obrigações na Acessórias',
  appura_justificar_divergencias: 'Justificar divergências', appura_reabrir_divergencias: 'Reabrir divergências', appura_tratar_apontamentos: 'Tratar apontamentos',
  appura_verificar_procuracao: 'Verificar procuração', appura_gerar_das: 'Gerar DAS', appura_enviar_guias_acessorias: 'Enviar à Acessórias',
};
const iaFerramenta = (nome) => IA_FERRAMENTAS[nome] || nome;

if (typeof module !== 'undefined') module.exports = { iaUltimoUso, iaConfigJson, iaAcesso, iaFerramenta };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  var ia = { dados: null, erro: null, novoToken: null, confirmar: null, uso: null, usoErro: null, usoDias: 7 };

  function iaMostrar() {
    for (const id of ['tela-visao', 'tela-fechamento', 'tela-empresas', 'tela-notas', 'tela-usuarios', 'tela-sped', 'tela-guias', 'tela-escritorio', 'tela-xml']) $(id).hidden = true;
    $('tela-ia').hidden = false;
    window.scrollTo(0, 0);
    ia.novoToken = null; ia.confirmar = null;
    iaCarregar();
  }

  async function iaCarregar() {
    try { ia.dados = await chamar('/api/mcp/conexoes'); ia.erro = null; } catch (e) { ia.erro = e.message; }
    iaRender();
    if (pode('usuarios')) iaCarregarUso();
  }

  async function iaCarregarUso() {
    try { ia.uso = await chamar(`/api/mcp/uso?dias=${ia.usoDias}`); ia.usoErro = null; } catch (e) { ia.usoErro = e.message; }
    iaRender();
  }

  async function iaCopiar(texto, botao) {
    try {
      await navigator.clipboard.writeText(texto);
      const antes = botao.lastChild.textContent; botao.lastChild.textContent = 'Copiado';
      setTimeout(() => { if (botao.isConnected) botao.lastChild.textContent = antes; }, 1600);
    } catch { avisar('Não foi possível copiar: selecione o texto e copie manualmente.', { tipo: 'erro' }); }
  }

  const iaBotaoCopiar = (texto, rotulo = 'Copiar') => h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => iaCopiar(texto, ev.currentTarget) }, icone('file-text'), h('span', { text: rotulo }));

  function iaRender() {
    if ($('tela-ia').hidden) return;
    const alvo = $('ia-conteudo');
    if (ia.erro && !ia.dados) {
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar as conexões.' }), h('span', { text: ia.erro }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: iaCarregar }, icone('refresh-cw'), 'Tentar de novo')));
      return;
    }
    if (!ia.dados) { alvo.replaceChildren(h('div', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }), h('div', { class: 'vg-skel', 'aria-hidden': 'true' }))); return; }
    const d = ia.dados;

    const endereco = h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Endereço do MCP do Appura' }),
        h('p', { class: 'meta', text: 'Qualquer app de IA compatível com MCP (servidor remoto) se conecta por este endereço. A IA consulta empresas, Central de Fechamento, SPED/SINTEGRA, auditoria, notas e guias com as permissões do seu perfil. Se você permitir, ela também justifica divergências, trata apontamentos, verifica procurações, gera DAS e envia guias à Acessórias, sempre mostrando uma prévia e esperando a sua confirmação.' })),
        h('span', { class: 'selo info', text: iaPodeOperar() ? 'Leitura + ações com confirmação' : 'Somente leitura' })),
      h('div', { class: 'ia-url' }, h('code', { class: 'mono', text: d.url }), iaBotaoCopiar(d.url, 'Copiar endereço')));

    const passo = (titulo, texto) => h('li', {}, h('div', {}, h('strong', { text: titulo }), h('span', { class: 'meta', text: texto })));
    const como = h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Como conectar' })),
      h('ol', { class: 'gu-passos ia-passos' },
        passo('Claude, ChatGPT e outros apps com login', 'Nas configurações de conectores do app, adicione um conector personalizado (servidor MCP remoto) com o endereço acima. O app abre a tela do Appura: entre com seu e-mail e senha e clique em "Permitir acesso".'),
        passo('n8n, Claude Code, Cursor e automações', 'Crie um token pessoal (quadro "Token pessoal") e use o endereço acima com o cabeçalho Authorization: Bearer <token>. No n8n, use o nó de cliente MCP com autenticação por cabeçalho.'),
        passo('Ações com confirmação', 'Com ações permitidas, a IA primeiro mostra o que vai fazer (quais divergências, quais empresas, quais guias) e só executa depois que você confirmar na conversa. Gerar DAS e verificar procuração são chamadas cobradas pelo SERPRO: a prévia mostra quantas. Ela nunca apaga nada.'),
        passo('Segurança', 'Os dados consultados vão para o provedor da IA escolhida. Certificados, senhas e chaves nunca saem do Appura. Toda consulta e toda ação ficam registradas com o seu usuário.')));

    const seloAcesso = (acoes) => { const s = iaAcesso(acoes, iaPodeOperar()); return h('span', { class: `selo ${s.classe}`, text: s.texto }); };
    const apps = d.apps.map((a) => h('li', {},
      h('span', { class: 'ia-selos' }, h('span', { class: 'selo ok', text: 'App' }), seloAcesso(a.acoes)),
      h('div', { class: 'ia-conexao' }, h('strong', { text: a.nome }), h('span', { class: 'meta', text: `${a.origem ? `${a.origem} · ` : ''}conectado em ${iaData(a.criadoEm)} · ${iaUltimoUso(a.ultimoUsoEm)}` })),
      iaBotaoRevogar(a.id, 'Desconectar')));
    const pessoais = d.pessoais.map((t) => h('li', {},
      h('span', { class: 'ia-selos' }, h('span', { class: 'selo neutro', text: 'Token' }), seloAcesso(t.acoes)),
      h('div', { class: 'ia-conexao' }, h('strong', { text: t.nome }), h('span', { class: 'meta', text: `••••${t.final || ''} · vence em ${iaData(t.expiraEm)} · ${iaUltimoUso(t.ultimoUsoEm)}` })),
      iaBotaoRevogar(t.id, 'Revogar')));
    const lista = h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Minhas conexões' }), h('span', { class: 'meta', text: `${apps.length + pessoais.length} ativa${apps.length + pessoais.length === 1 ? '' : 's'}` })),
      apps.length + pessoais.length ? h('ul', { class: 'sped-envios ia-lista' }, ...apps, ...pessoais)
        : h('div', { class: 'vg-vazio pequeno' }, h('strong', { text: 'Nenhuma conexão ainda.' }), h('span', { text: 'Conecte um app pelo endereço acima ou crie um token pessoal.' })));

    alvo.replaceChildren(endereco, ia.novoToken ? iaCardNovoToken(d.url) : iaCardCriar(), lista, ...(pode('usuarios') ? [iaCardUso()] : []), como);
  }

  const iaDataHora = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  /** Uso do MCP (administração): números do período, uso por pessoa, ações executadas e falhas. */
  function iaCardUso() {
    const seletor = h('select', { id: 'ia-uso-dias', 'aria-label': 'Período', onchange: (ev) => { ia.usoDias = Number(ev.currentTarget.value); ia.uso = null; iaRender(); iaCarregarUso(); } },
      ...[7, 30, 90].map((d) => h('option', { value: String(d), text: `Últimos ${d} dias`, selected: ia.usoDias === d })));
    const topo = h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Uso do MCP no escritório' }),
      h('p', { class: 'meta', text: 'Todas as conexões de IA de todos os usuários. Prévias contam como consulta; ações são as confirmadas.' })), seletor);
    if (ia.usoErro && !ia.uso) return h('section', { class: 'vg-card' }, topo, h('p', { class: 'erro', role: 'alert', text: ia.usoErro }));
    if (!ia.uso) return h('section', { class: 'vg-card' }, topo, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }));
    const u = ia.uso;
    const numero = (valor, rotulo, tom) => h('div', { class: `ia-numero${tom ? ` ${tom}` : ''}` }, h('strong', { text: String(valor) }), h('span', { text: rotulo }));
    const numeros = h('div', { class: 'ia-numeros' },
      numero(u.totais.chamadas, 'chamadas'), numero(u.totais.acoesExecutadas, 'ações executadas', u.totais.acoesExecutadas ? 'pendente' : ''),
      numero(u.totais.falhas, 'falhas', u.totais.falhas ? 'problema' : ''), numero(u.totais.usuarios, u.totais.usuarios === 1 ? 'usuário' : 'usuários'));
    if (!u.totais.chamadas) return h('section', { class: 'vg-card' }, topo, numeros, h('div', { class: 'vg-vazio pequeno' }, h('strong', { text: 'Nenhum uso no período.' })));

    const pessoas = h('div', { class: 'vg-tabela-caixa ia-tabela-caixa' }, h('table', { class: 'vg-tabela ia-tabela' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Usuário' }), h('th', { class: 'num', text: 'Chamadas' }), h('th', { class: 'num', text: 'Ações' }), h('th', { class: 'num', text: 'Falhas' }), h('th', { text: 'Último uso' }))),
      h('tbody', {}, ...u.porUsuario.map((p) => h('tr', {}, h('td', { text: p.email }), h('td', { class: 'num', text: String(p.chamadas) }), h('td', { class: 'num', text: String(p.acoes) }),
        h('td', { class: 'num', text: String(p.falhas) }), h('td', { text: iaDataHora(p.ultimoUso) }))))));
    const linhaChamada = (c) => h('li', {},
      h('span', { class: `selo ${c.sucesso ? 'ok' : 'problema'}`, text: c.sucesso ? 'Feito' : 'Falhou' }),
      h('div', { class: 'ia-conexao' }, h('strong', { text: iaFerramenta(c.ferramenta) }),
        h('span', { class: 'meta', text: `${iaDataHora(c.em)} · ${c.email} · ${c.app}` }), c.resumo ? h('span', { class: 'meta ia-resumo', text: c.resumo }) : null));
    const ferramentas = h('p', { class: 'meta', text: `Mais usadas: ${u.porFerramenta.slice(0, 5).map((f) => `${iaFerramenta(f.ferramenta)} (${f.chamadas})`).join(', ')}` });
    return h('section', { class: 'vg-card' }, topo, numeros, pessoas, ferramentas,
      h('h3', { class: 'ia-subtitulo', text: 'Ações executadas' }),
      u.acoes.length ? h('ul', { class: 'sped-envios ia-lista' }, ...u.acoes.map(linhaChamada)) : h('p', { class: 'meta', text: 'Nenhuma ação executada no período.' }),
      u.falhas.length ? h('details', { class: 'gu-composicao' }, h('summary', { text: `Falhas recentes (${u.falhas.length})` }), h('ul', { class: 'sped-envios ia-lista' }, ...u.falhas.map(linhaChamada))) : null);
  }

  function iaBotaoRevogar(id, texto) {
    if (ia.confirmar === id) {
      return h('span', { class: 'gu-botoes' },
        h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => { ia.confirmar = null; iaRender(); } }, 'Cancelar'),
        h('button', { type: 'button', class: 'botao pequeno perigo-cheio', onclick: (ev) => comOcupado(ev.currentTarget, 'Revogando…', async () => {
          await chamar(`/api/mcp/conexoes/${id}`, { method: 'DELETE' });
          ia.confirmar = null; avisar('Conexão revogada: o app perdeu o acesso na hora.', { tipo: 'ok' }); await iaCarregar();
        }, `ia-rev-${id}`) }, h('span', { text: `Confirmar` })));
    }
    return h('button', { type: 'button', class: 'botao pequeno perigo', onclick: () => { ia.confirmar = id; iaRender(); } }, texto);
  }

  function iaPodeOperar() {
    return typeof pode === 'function' ? pode('operar') : false;
  }

  function iaCardCriar() {
    const podeOperar = iaPodeOperar();
    const form = h('form', { class: 'es-chaves', novalidate: true, onsubmit: (ev) => { ev.preventDefault(); iaCriar(form); } },
      h('label', { class: 'campo' }, h('span', { text: 'Nome (para você reconhecer depois)' }), h('input', { id: 'ia-nome', type: 'text', maxlength: '60', placeholder: 'Ex.: n8n do escritório', autocomplete: 'off' })),
      h('label', { class: 'campo' }, h('span', { text: 'Validade' }), h('select', { id: 'ia-dias' },
        h('option', { value: '30', text: '30 dias' }), h('option', { value: '90', text: '90 dias', selected: true }), h('option', { value: '180', text: '180 dias' }), h('option', { value: '365', text: '1 ano' }))),
      h('label', { class: 'mcp-permissao' }, h('input', { id: 'ia-acoes', type: 'checkbox', disabled: !podeOperar }),
        h('span', {}, h('strong', { text: 'Permitir ações' }), podeOperar
          ? ' (justificar divergências, tratar apontamentos da auditoria, verificar procuração, gerar DAS e enviar guias à Acessórias). Cada ação mostra uma prévia e só é feita depois de confirmada.'
          : ' indisponível: seu perfil é de consulta, o token será só de leitura.')),
      h('p', { id: 'ia-erro', class: 'erro', role: 'alert', hidden: true }),
      h('div', { class: 'gu-botoes' }, h('button', { type: 'submit', class: 'botao primario' }, icone('key-round'), h('span', { text: 'Criar token' }))));
    return h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Token pessoal' }),
        h('p', { class: 'meta', text: 'Para apps que não fazem login (n8n, Claude Code, Cursor). O token dá o mesmo acesso que você tem (só leitura, a não ser que você permita ações) e aparece uma única vez.' }))),
      form);
  }

  async function iaCriar(form) {
    const erro = $('ia-erro');
    const nome = $('ia-nome').value.trim();
    erro.hidden = true;
    if (nome.length < 2) { erro.textContent = 'Dê um nome para o token.'; erro.hidden = false; $('ia-nome').setAttribute('aria-invalid', 'true'); return; }
    await comOcupado(form.querySelector('button[type=submit]'), 'Criando…', async () => {
      try { ia.novoToken = await chamar('/api/mcp/tokens', { method: 'POST', body: { nome, dias: Number($('ia-dias').value), acoes: !!$('ia-acoes').checked } }); } catch (e) { erro.textContent = e.message; erro.hidden = false; return; }
      await iaCarregar();
    }, 'ia-criar');
  }

  function iaCardNovoToken(url) {
    const t = ia.novoToken;
    return h('section', { class: 'vg-card ia-novo' },
      h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: `Token "${t.nome}" criado` }), h('span', { class: 'selo pendente', text: 'Copie agora' })),
      h('p', { class: 'meta', text: `Este token não aparece de novo. Guarde num lugar seguro (por exemplo, nas credenciais do n8n). Vence em ${iaData(t.expiraEm)}.` }),
      h('div', { class: 'ia-url' }, h('code', { class: 'mono ia-token', text: t.token }), iaBotaoCopiar(t.token, 'Copiar token')),
      h('details', { class: 'gu-composicao' }, h('summary', { text: 'Configuração em JSON (Claude Code, Cursor)' }),
        h('pre', { class: 'mono ia-json', text: iaConfigJson(url, t.token) }), iaBotaoCopiar(iaConfigJson(url, t.token), 'Copiar configuração')),
      h('div', { class: 'gu-botoes' }, h('button', { type: 'button', class: 'botao', onclick: () => { ia.novoToken = null; iaRender(); } }, 'Já copiei')));
  }

  window.iaMostrar = iaMostrar;
}
