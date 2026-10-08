'use strict';
/*
 * Integrações por API (#/integracoes): outro sistema (ex.: OnnePharma) lê os XMLs de NF-e e NFC-e dos CNPJs liberados,
 * pela API (cursor) e pelo webhook (aviso assinado a cada nota nova ou alterada). Só a administração cria e altera.
 * Usa os utilitários globais do app.js (h, $, chamar, icone, comOcupado, avisar, pode, empresas, carregarEmpresas)
 * e do nucleo.js (formatarCnpj).
 */

/* ---------- funções puras (testadas em test/integracoes-tela.test.ts) ---------- */
const itNomesModelos = (m) => (m || []).map((x) => (x === '65' ? 'NFC-e' : 'NF-e')).join(' e ');
const itNomesDirecoes = (d) => (d || []).map((x) => (x === 'entrada' ? 'entrada' : 'saída')).join(' e ');

/** Situação do webhook para o selo. */
function itSituacaoWebhook(w, url) {
  if (!url) return { tom: 'neutro', texto: 'Sem webhook' };
  if (w.falhas7d > 0 && w.pendentes > 0) return { tom: 'problema', texto: `${w.falhas7d} falha${w.falhas7d === 1 ? '' : 's'} · ${w.pendentes} na fila` };
  if (w.falhas7d > 0) return { tom: 'problema', texto: `${w.falhas7d} falha${w.falhas7d === 1 ? '' : 's'} em 7 dias` };
  if (w.pendentes > 0) return { tom: 'atencao', texto: `${w.pendentes} na fila` };
  return { tom: 'ok', texto: 'Entregando' };
}

/** Exemplo de chamada para o desenvolvedor do sistema integrado. */
function itExemploCurl(base, token) {
  return `curl -H "Authorization: Bearer ${token || 'SEU_TOKEN'}" "${base}/api/integracao/v1/documentos?limite=100"`;
}

if (typeof module !== 'undefined') module.exports = { itNomesModelos, itNomesDirecoes, itSituacaoWebhook, itExemploCurl };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  const it = { f: {}, dados: null, erro: null, novo: null, form: false, marcados: new Set(), busca: '', confirmar: null, editandoUrl: null };
  const base = () => location.origin;
  const podeEditar = () => typeof pode === 'function' && pode('administracao.configuracoes');

  function itMostrar() {
    $('tela-integracoes').hidden = false; window.scrollTo(0, 0);
    it.novo = null; it.confirmar = null; it.editandoUrl = null;
    if (!empresas.length) carregarEmpresas().then(itRender);
    itCarregar();
  }

  async function itCarregar() {
    try { it.dados = await chamar('/api/integracoes'); it.erro = null; } catch (e) { it.erro = e.message; }
    itRender();
  }

  async function copiar(texto, botao) {
    try { await navigator.clipboard.writeText(texto); const a = botao.lastChild.textContent; botao.lastChild.textContent = 'Copiado'; setTimeout(() => { if (botao.isConnected) botao.lastChild.textContent = a; }, 1600); }
    catch { avisar('Não foi possível copiar: selecione e copie manualmente.', { tipo: 'erro' }); }
  }
  const botaoCopiar = (texto, rotulo = 'Copiar') => h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => copiar(texto, ev.currentTarget) }, icone('file-text'), h('span', { text: rotulo }));
  const segredoCaixa = (rotulo, valor) => h('div', { class: 'it-segredo' }, h('span', { class: 'cl-rotulo', text: rotulo }), h('div', { class: 'ia-url' }, h('code', { class: 'mono ia-token', text: valor }), botaoCopiar(valor)));

  function itRender() {
    if ($('tela-integracoes').hidden) return;
    const alvo = $('it-conteudo');
    if (it.erro && !it.dados) { alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar as integrações.' }), h('span', { text: it.erro }))); return; }
    if (!it.dados) { alvo.replaceChildren(h('div', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }))); return; }
    const topo = h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Como funciona' }),
        h('p', { class: 'meta', text: 'O sistema integrado recebe um token próprio que só lê NF-e e NFC-e (entrada e saída) dos CNPJs que você liberar; CT-e nunca. Ele busca as notas novas ou alteradas pela API (com cursor) e, se tiver webhook, recebe um aviso assinado a cada nota nova, cancelamento ou XML completo que chegar, com o XML junto. Toda chamada fica registrada. Revogue a qualquer momento.' })),
        podeEditar() && !it.form && !it.novo ? h('button', { type: 'button', class: 'botao primario', onclick: () => { it.form = true; it.marcados = new Set(); it.busca = ''; it.f = { nome: '', url: '', nfe: true, nfce: true, entrada: true, saida: true, hist: false }; itRender(); } }, icone('key-round'), h('span', { text: 'Nova integração' })) : null));
    const partes = [topo];
    if (it.novo) partes.push(itCardNovo());
    else if (it.form) partes.push(itCardForm());
    if (!it.dados.integracoes.length && !it.form && !it.novo) partes.push(h('div', { class: 'vg-vazio' }, h('strong', { text: 'Nenhuma integração ainda.' })));
    for (const i of it.dados.integracoes) partes.push(itCardIntegracao(i));
    partes.push(itCardDoc());
    alvo.replaceChildren(...partes);
  }

  function seletorEmpresas(aoMudar) {
    const lista = clFiltrar(empresas.filter((e) => e.ativo !== false), it.busca);
    const bloco = h('div', { class: 'cl-seletor' }, h('span', { class: 'cl-rotulo', text: 'CNPJs liberados' }),
      h('input', { type: 'search', class: 'cl-busca', placeholder: 'Buscar por CNPJ ou razão social', value: it.busca, 'aria-label': 'Buscar empresa',
        oninput: (ev) => { it.busca = ev.currentTarget.value; const n = seletorEmpresas(aoMudar); bloco.replaceWith(n); const b = n.querySelector('input[type=search]'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }),
      h('ul', { class: 'cl-empresas', role: 'list' }, ...lista.slice(0, 200).map((e) => h('li', {}, h('label', { class: 'cl-empresa' },
        h('input', { type: 'checkbox', checked: it.marcados.has(e.id), onchange: (ev) => { if (ev.currentTarget.checked) it.marcados.add(e.id); else it.marcados.delete(e.id); aoMudar(); } }),
        h('span', {}, h('strong', { text: e.razao_social }), h('span', { class: 'meta mono', text: formatarCnpj(e.cnpj) })))))),
      h('p', { class: 'meta', text: `${it.marcados.size} marcada${it.marcados.size === 1 ? '' : 's'}` }));
    return bloco;
  }

  // O formulário é refeito quando se marca um CNPJ: os valores ficam guardados em it.f para não se perderem
  const caixa = (id, campo, rotulo) => h('label', { class: 'cp-check' }, h('input', { type: 'checkbox', id, checked: !!it.f[campo], onchange: (ev) => { it.f[campo] = ev.currentTarget.checked; } }), h('span', { text: rotulo }));

  function itCardForm() {
    const card = h('section', { class: 'vg-card' });
    const montar = () => card.replaceChildren(
      h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Nova integração' })),
      h('label', { class: 'campo' }, h('span', { text: 'Nome do sistema' }), h('input', { id: 'it-nome', type: 'text', maxlength: '80', placeholder: 'Ex.: OnnePharma', autocomplete: 'off', value: it.f.nome || '', oninput: (ev) => { it.f.nome = ev.currentTarget.value; } })),
      seletorEmpresas(montar),
      h('div', { class: 'cp-filtros' }, h('span', { class: 'cl-rotulo', text: 'O que pode ler:' }), caixa('it-nfe', 'nfe', 'NF-e'), caixa('it-nfce', 'nfce', 'NFC-e'), caixa('it-entrada', 'entrada', 'Entradas'), caixa('it-saida', 'saida', 'Saídas')),
      h('label', { class: 'campo' }, h('span', { text: 'Webhook (opcional): endereço https do sistema que recebe os avisos' }), h('input', { id: 'it-url', type: 'url', placeholder: 'https://onnepharma.com.br/api/appura/webhook', autocomplete: 'off', value: it.f.url || '', oninput: (ev) => { it.f.url = ev.currentTarget.value; } })),
      caixa('it-hist', 'hist', 'Enviar também as notas que já existem pelo webhook (normalmente o sistema lê o histórico pela API)', false),
      h('p', { id: 'it-erro', class: 'erro', role: 'alert', hidden: true }),
      h('div', { class: 'gu-botoes' }, h('button', { type: 'button', class: 'botao fantasma', onclick: () => { it.form = false; itRender(); } }, 'Cancelar'),
        h('button', { type: 'button', class: 'botao primario', onclick: (ev) => itCriar(ev.currentTarget) }, icone('key-round'), h('span', { text: 'Criar e gerar token' }))));
    montar();
    return card;
  }

  async function itCriar(botao) {
    const erro = $('it-erro'); erro.hidden = true;
    const falha = (t) => { erro.textContent = t; erro.hidden = false; };
    const nome = $('it-nome').value.trim();
    const modelos = [$('it-nfe').checked && '55', $('it-nfce').checked && '65'].filter(Boolean);
    const direcoes = [$('it-entrada').checked && 'entrada', $('it-saida').checked && 'saida'].filter(Boolean);
    if (nome.length < 2) return falha('Dê um nome para a integração.');
    if (!it.marcados.size) return falha('Marque pelo menos um CNPJ.');
    if (!modelos.length || !direcoes.length) return falha('Marque pelo menos um modelo e um tipo (entrada ou saída).');
    await comOcupado(botao, 'Criando…', async () => {
      try { const r = await chamar('/api/integracoes', { method: 'POST', body: { nome, empresas: [...it.marcados], modelos, direcoes, webhookUrl: $('it-url').value.trim() || null, webhookHistorico: $('it-hist').checked } }); it.novo = { nome, ...r }; it.form = false; }
      catch (e) { return falha(e.message); }
      await itCarregar();
    }, 'it-criar');
  }

  function itCardNovo() {
    const n = it.novo;
    return h('section', { class: 'vg-card ia-novo' },
      h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: n.token ? `Integração "${n.nome}" criada` : `Novo segredo de "${n.nome}"` }), h('span', { class: 'selo pendente', text: 'Copie agora' })),
      h('p', { class: 'meta', text: 'Estes valores aparecem só agora. Guarde nas variáveis de ambiente do sistema integrado (nunca no código nem em grupo de WhatsApp). Se perder, revogue e crie outra (token) ou gere um novo segredo (webhook).' }),
      n.token ? segredoCaixa('Token da API (Authorization: Bearer …)', n.token) : null,
      n.webhookSegredo ? segredoCaixa('Segredo do webhook (confere a assinatura X-Appura-Assinatura)', n.webhookSegredo) : null,
      n.token ? h('details', { class: 'gu-composicao' }, h('summary', { text: 'Exemplo de chamada' }), h('pre', { class: 'mono ia-json', text: itExemploCurl(base(), n.token) })) : null,
      h('div', { class: 'gu-botoes' }, h('button', { type: 'button', class: 'botao primario', onclick: () => { it.novo = null; itRender(); } }, 'Já copiei')));
  }

  const acao = (rotulo, fn, chave, classe = '') => h('button', { type: 'button', class: `botao pequeno ${classe}`, onclick: (ev) => comOcupado(ev.currentTarget, `${rotulo}…`, fn, chave) }, h('span', { text: rotulo }));

  function itCardIntegracao(i) {
    const w = itSituacaoWebhook(i.webhook, i.webhookUrl);
    const editar = podeEditar() && i.ativo;
    const urlEdicao = it.editandoUrl === i.id ? h('div', { class: 'linha-campo it-url' },
      h('input', { type: 'url', id: `it-url-${i.id}`, value: i.webhookUrl || '', placeholder: 'https://… (vazio = sem webhook)', 'aria-label': 'Endereço do webhook' }),
      h('button', { type: 'button', class: 'botao fantasma pequeno', onclick: () => { it.editandoUrl = null; itRender(); } }, 'Cancelar'),
      acao('Salvar', async () => {
        try { const r = await chamar(`/api/integracoes/${i.id}`, { method: 'PATCH', body: { webhookUrl: $(`it-url-${i.id}`).value.trim() || null } }); it.editandoUrl = null; if (r.webhookSegredo) it.novo = { nome: i.nome, webhookSegredo: r.webhookSegredo }; avisar('Webhook salvo.', { tipo: 'ok' }); }
        catch (e) { avisar(e.message, { tipo: 'erro' }); return; }
        await itCarregar();
      }, `it-url-s-${i.id}`, 'primario')) : null;
    const confirmarRevogar = it.confirmar === i.id;
    return h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: i.nome }),
        h('p', { class: 'meta', text: `${itNomesModelos(i.modelos)} de ${itNomesDirecoes(i.direcoes)} · ${i.empresas.map((e) => `${e.razaoSocial} (${formatarCnpj(e.cnpj)})`).join(', ') || 'nenhum CNPJ'}` })),
        h('span', { class: `selo ${i.revogadoEm ? 'neutro' : i.ativo ? 'ok' : 'atencao'}`, text: i.revogadoEm ? 'Revogada' : i.ativo ? 'Ativa' : 'Pausada' })),
      h('ul', { class: 'sped-envios ia-lista' },
        h('li', {}, h('span', { class: 'selo neutro', text: 'API' }), h('div', { class: 'ia-conexao' }, h('strong', { text: `Token ${i.prefixo}…` }),
          h('span', { class: 'meta', text: `último uso ${i.ultimoUsoEm ? cpQuando(i.ultimoUsoEm) : 'nunca'} · ${i.api24h.chamadas} chamada${i.api24h.chamadas === 1 ? '' : 's'} e ${i.api24h.notas} nota${i.api24h.notas === 1 ? '' : 's'} em 24 h${i.api24h.erros ? ` · ${i.api24h.erros} com erro` : ''}` }))),
        h('li', {}, h('span', { class: `selo ${w.tom}`, text: 'Webhook' }), h('div', { class: 'ia-conexao' }, h('strong', { class: 'mono', text: i.webhookUrl || 'Sem webhook' }),
          i.webhookUrl ? h('span', { class: 'meta', text: `${w.texto} · ${i.webhook.entregues7d} entregue${i.webhook.entregues7d === 1 ? '' : 's'} em 7 dias · última ${i.webhook.ultimaEntregaEm ? cpQuando(i.webhook.ultimaEntregaEm) : 'nunca'}` }) : null,
          i.webhook.ultimoErro ? h('span', { class: 'meta erro', text: `Último erro: ${i.webhook.ultimoErro}` }) : null))),
      urlEdicao,
      editar ? h('div', { class: 'gu-botoes' },
        i.webhookUrl ? acao('Testar webhook', async () => { try { const r = await chamar(`/api/integracoes/${i.id}/testar`, { method: 'POST' }); avisar(r.ok ? `Webhook respondeu ${r.status}.` : `Webhook não aceitou: ${r.status ?? ''} ${r.resposta}`, { tipo: r.ok ? 'ok' : 'erro' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); } }, `it-t-${i.id}`) : null,
        i.webhook.falhas7d ? acao('Reenviar falhas', async () => { try { const r = await chamar(`/api/integracoes/${i.id}/reenviar`, { method: 'POST' }); avisar(`${r.reenviadas} aviso(s) de volta à fila.`, { tipo: 'ok' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); } await itCarregar(); }, `it-r-${i.id}`) : null,
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => { it.editandoUrl = i.id; itRender(); } }, h('span', { text: i.webhookUrl ? 'Alterar webhook' : 'Configurar webhook' })),
        i.webhookUrl ? acao('Novo segredo', async () => { try { const r = await chamar(`/api/integracoes/${i.id}/segredo`, { method: 'POST' }); it.novo = { nome: i.nome, webhookSegredo: r.webhookSegredo }; itRender(); window.scrollTo(0, 0); } catch (e) { avisar(e.message, { tipo: 'erro' }); } }, `it-s-${i.id}`) : null,
        acao('Pausar', async () => { try { await chamar(`/api/integracoes/${i.id}`, { method: 'PATCH', body: { ativo: false } }); } catch (e) { avisar(e.message, { tipo: 'erro' }); } await itCarregar(); }, `it-p-${i.id}`),
        confirmarRevogar ? h('span', { class: 'gu-botoes' }, h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => { it.confirmar = null; itRender(); } }, 'Cancelar'),
          acao('Confirmar revogação', async () => { try { await chamar(`/api/integracoes/${i.id}/revogar`, { method: 'POST' }); it.confirmar = null; avisar('Integração revogada: o token parou de funcionar na hora.', { tipo: 'ok' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); } await itCarregar(); }, `it-v-${i.id}`, 'perigo-cheio'))
          : h('button', { type: 'button', class: 'botao pequeno perigo', onclick: () => { it.confirmar = i.id; itRender(); } }, 'Revogar'))
        : (podeEditar() && !i.revogadoEm ? h('div', { class: 'gu-botoes' }, acao('Reativar', async () => { try { await chamar(`/api/integracoes/${i.id}`, { method: 'PATCH', body: { ativo: true } }); } catch (e) { avisar(e.message, { tipo: 'erro' }); } await itCarregar(); }, `it-a-${i.id}`)) : null));
  }

  function itCardDoc() {
    const linha = (m, r, d) => h('tr', {}, h('td', { class: 'mono', text: m }), h('td', { class: 'mono', text: r }), h('td', { text: d }));
    return h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Para o desenvolvedor do sistema integrado' })),
      h('p', { class: 'meta', text: `Endereço: ${base()} · cabeçalho Authorization: Bearer <token> · até 120 chamadas por minuto. O guia completo (formato do aviso, conferência da assinatura e exemplo em Node.js) está em docs/api-integracao.md no repositório do Appura.` }),
      h('div', { class: 'rolagem' }, h('table', { class: 'notas' }, h('thead', {}, h('tr', {}, h('th', { text: 'Método' }), h('th', { text: 'Rota' }), h('th', { text: 'O que faz' }))), h('tbody', {},
        linha('GET', '/api/integracao/v1/empresas', 'CNPJs liberados, modelos e tipos que o token pode ler.'),
        linha('GET', '/api/integracao/v1/documentos?cursor=&limite=100', 'Notas novas ou alteradas depois do cursor (sem cursor = desde o início). Guarde "proximoCursor"; "temMais" = já pode chamar de novo. Filtros: cnpj, modelo=nfe|nfce, direcao=entrada|saida.'),
        linha('GET', '/api/integracao/v1/documentos/{chave}/xml', 'XML da nota (o completo, ou o resumo enquanto o completo não chega: cabeçalho X-Appura-Completo).'),
        linha('POST', '/api/integracao/v1/xml/zip', 'ZIP com até 500 XMLs: corpo {"chaves": ["…"]}.'),
        linha('Webhook', 'POST no seu endereço', 'Corpo {id, evento: documento.novo | documento.atualizado | teste, documento, xml}. Confira X-Appura-Assinatura (t=…,v1=HMAC-SHA256 de "t.corpo" com o segredo). Responda 2xx em até 15 s; senão o Appura tenta de novo (1 min, 5 min, 15 min… até 24 h). Trate pela chave: o mesmo aviso pode chegar mais de uma vez.')))));
  }

  window.itMostrar = itMostrar;
}
