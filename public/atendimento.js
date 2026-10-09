'use strict';
/*
 * Atendimento (#/atendimento[/<nº>]): chamados dos clientes por departamento, com responsável, prazo, situação e a
 * conversa interna (mudanças de situação e responsável ficam registradas na conversa).
 * Usa o kit de escritorio.js (window.esKit) e os utilitários globais do app.js.
 */

/* ---------- funções puras (testadas em test/escritorio-tela.test.ts) ---------- */
const AT_TOM_STATUS = { aberto: 'info', em_andamento: 'progresso', aguardando_cliente: 'atencao', resolvido: 'ok', fechado: 'neutro' };
const AT_TOM_PRIORIDADE = { baixa: 'neutro', normal: 'info', alta: 'atencao', urgente: 'problema' };
/** Mensagem de histórico (gerada pelo sistema) vem entre colchetes. */
const atEhHistorico = (texto) => /^\[.*\]$/s.test(String(texto || ''));
/** Nome curto de um e-mail da equipe: "ana.souza@x.com" → "ana.souza" (usa o nome, se houver). */
const atNome = (email, equipe = []) => { if (!email) return '—'; const u = equipe.find((x) => x.email === email); return (u && u.nome) || String(email).replace(/@.*/, ''); };

if (typeof module !== 'undefined') module.exports = { AT_TOM_STATUS, AT_TOM_PRIORIDADE, atEhHistorico, atNome };

if (typeof window !== 'undefined') {
  const kit = window.esKit;
  const at = { resumo: null, erro: null, lista: null, filtro: { status: 'ativos', departamento: '', responsavel: '', empresa: '', busca: '' }, id: null, detalhe: null, novo: null, resposta: '' };
  const t = () => at.resumo.tipos;
  const podeOp = () => !!(at.resumo && at.resumo.pode.operar);
  let lista = [];

  async function atMostrar(rota) {
    at.id = rota.id || null; at.detalhe = null;
    $('tela-atendimento').hidden = false; window.scrollTo(0, 0);
    lista = await kit.empresas();
    await atCarregar();
  }
  async function atCarregar() {
    try {
      const f = at.filtro;
      const [r, l] = await Promise.all([chamar('/api/atendimento/resumo'), at.id ? null : chamar(`/api/atendimento/chamados?status=${f.status}&departamento=${f.departamento}&responsavel=${encodeURIComponent(f.responsavel)}&empresa=${f.empresa}&busca=${encodeURIComponent(f.busca)}`)]);
      at.resumo = r; if (l) at.lista = l.chamados;
      if (at.id) at.detalhe = await chamar(`/api/atendimento/chamados/${at.id}`);
      at.erro = null;
    } catch (e) { at.erro = e.message; }
    atRender();
  }

  function atRender() {
    if ($('tela-atendimento').hidden) return;
    $('at-acoes').replaceChildren(podeOp() && !at.id ? h('button', { type: 'button', class: 'botao primario pequeno', onclick: () => { at.novo = { assunto: '', empresa_id: '', departamento: 'fiscal', prioridade: 'normal', canal: 'whatsapp', solicitante: '', responsavel: at.resumo.eu, prazo: '', mensagem: '' }; atRender(); } }, h('span', { text: 'Novo chamado' })) : '');
    const alvo = $('at-conteudo');
    if (at.erro && !at.resumo) return alvo.replaceChildren(kit.erro('Não foi possível abrir o Atendimento.', at.erro));
    if (!at.resumo) return alvo.replaceChildren(kit.carregando());
    const corpo = at.id ? atDetalhe() : atLista();
    alvo.replaceChildren(...(at.erro ? [kit.erro('Algo deu errado.', at.erro)] : []), ...[].concat(corpo).filter(Boolean));
  }

  const opEquipe = (vazio) => [['', vazio], ...at.resumo.equipe.map((u) => [u.email, u.nome ? `${u.nome} (${u.email})` : u.email])];

  /* ----- Lista ----- */
  function atLista() {
    const r = at.resumo; const f = at.filtro;
    const out = [kit.kpis([
      { rotulo: 'Chamados ativos', valor: esN(r.ativos), icone: 'message-circle' },
      { rotulo: 'Comigo', valor: esN(r.meus), tom: 'info', icone: 'users' },
      { rotulo: 'Sem responsável', valor: esN(r.semResponsavel), tom: r.semResponsavel ? 'atencao' : 'ok', icone: 'circle-alert' },
      { rotulo: 'Prazo vencido', valor: esN(r.atrasados), tom: r.atrasados ? 'problema' : 'ok', icone: 'clock-alert' },
    ])];
    if (at.novo) out.push(atFormNovo());
    const muda = (k) => (ev) => { f[k] = ev.currentTarget.value; at.lista = null; atRender(); atCarregar(); };
    out.push(kit.cartao(
      kit.linha(
        kit.campo('Situação', f, 'status', 'select', { onchange: muda('status') }, [['ativos', 'Ativos (aberto, em andamento, aguardando)'], ...Object.entries(t().status)]),
        kit.campo('Departamento', f, 'departamento', 'select', { onchange: muda('departamento') }, [['', 'Todos'], ...Object.entries(t().departamentos)]),
        kit.campo('Responsável', f, 'responsavel', 'select', { onchange: muda('responsavel') }, [['', 'Todos'], [r.eu, 'Comigo'], ['__sem', 'Sem responsável'], ...opEquipe('').slice(1).filter(([e]) => e !== r.eu)]),
        kit.campo('Cliente', f, 'empresa', 'select', { onchange: muda('empresa') }, kit.opcoesEmpresa(lista, 'Todos'))),
      h('input', { type: 'search', class: 'cl-busca', placeholder: 'Buscar no assunto (Enter)', value: f.busca, onchange: muda('busca') })));
    if (!at.lista) { out.push(kit.carregando()); return out; }
    if (!at.lista.length) { out.push(kit.vazio('Nenhum chamado neste filtro.')); return out; }
    const d = t();
    out.push(kit.cartao(kit.tabela(['Nº', 'Assunto', 'Cliente', 'Departamento', 'Prioridade', 'Situação', 'Responsável', 'Prazo', ''], at.lista.map((c) => h('tr', {},
      h('td', { class: 'mono', text: `#${c.id}` }),
      h('td', {}, h('a', { href: `#/atendimento/${c.id}` }, h('strong', { text: c.assunto })), h('span', { class: 'sub', text: `${d.canais[c.canal] || c.canal}${c.solicitante ? ` · ${c.solicitante}` : ''} · aberto em ${esDataHora(c.criado_em)}` })),
      h('td', { text: c.empresa || '—' }), h('td', { text: d.departamentos[c.departamento] }),
      h('td', {}, kit.selo(d.prioridades[c.prioridade], AT_TOM_PRIORIDADE[c.prioridade])),
      h('td', {}, kit.selo(d.status[c.status], AT_TOM_STATUS[c.status])),
      h('td', { text: c.responsavel ? atNome(c.responsavel, at.resumo.equipe) : '—' }),
      h('td', {}, esData(c.prazo), c.atrasado ? kit.selo('Vencido', 'problema') : null),
      h('td', {}, h('a', { class: 'botao pequeno', href: `#/atendimento/${c.id}` }, 'Abrir')))))));
    return out;
  }

  function atFormNovo() {
    const f = at.novo; const d = t();
    return kit.cartao(kit.topo('Novo chamado', 'Registre o pedido do cliente. A primeira mensagem fica no início da conversa.'),
      kit.linha(kit.campo('Assunto', f, 'assunto', 'text', { maxlength: '200' }), kit.campo('Cliente', f, 'empresa_id', 'select', {}, kit.opcoesEmpresa(lista, '— sem cliente (interno) —'))),
      kit.linha(kit.campo('Departamento', f, 'departamento', 'select', {}, Object.entries(d.departamentos)), kit.campo('Prioridade', f, 'prioridade', 'select', {}, Object.entries(d.prioridades)), kit.campo('Canal', f, 'canal', 'select', {}, Object.entries(d.canais))),
      kit.linha(kit.campo('Quem pediu', f, 'solicitante', 'text', { maxlength: '200', placeholder: 'Nome e contato do cliente' }), kit.campo('Responsável', f, 'responsavel', 'select', {}, opEquipe('— ninguém ainda —')), kit.campo('Prazo', f, 'prazo', 'date')),
      kit.campo('Mensagem', f, 'mensagem', 'textarea', { maxlength: '8000', rows: 4 }),
      kit.acoesForm(() => { at.novo = null; atRender(); }, async () => {
        const r = await chamar('/api/atendimento/chamados', { method: 'POST', body: { ...f, empresa_id: f.empresa_id || null, responsavel: f.responsavel || null, prazo: f.prazo || null } });
        avisar(`Chamado #${r.id} aberto.`, { tipo: 'ok' }); at.novo = null; location.hash = `#/atendimento/${r.id}`;
      }, 'Abrir chamado'));
  }

  /* ----- Detalhe ----- */
  function atDetalhe() {
    const c = at.detalhe;
    const voltar = h('div', { class: 'gu-botoes' }, h('a', { class: 'botao pequeno fantasma', href: '#/atendimento' }, '← Chamados'));
    if (!c) return [voltar, kit.carregando()];
    const d = t();
    const f = { departamento: c.departamento, prioridade: c.prioridade, status: c.status, responsavel: c.responsavel || '', prazo: c.prazo || '' };
    const atualizar = async (k) => {
      try { await chamar(`/api/atendimento/chamados/${c.id}`, { method: 'PATCH', body: { [k]: f[k] || null } }); avisar('Chamado atualizado.', { tipo: 'ok' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); }
      await atCarregar();
    };
    const sel = (rot, k, opcoes) => kit.campo(rot, f, k, 'select', { disabled: !podeOp(), onchange: (ev) => { f[k] = ev.currentTarget.value; atualizar(k); } }, opcoes);
    const out = [voltar,
      kit.cartao(kit.topo(`#${c.id} · ${c.assunto}`, `${c.empresa ? `${c.empresa} · ${formatarCnpj(c.cnpj)} · ` : ''}${d.canais[c.canal] || c.canal}${c.solicitante ? ` · pedido por ${c.solicitante}` : ''} · aberto por ${atNome(c.criado_por, at.resumo.equipe)} em ${esDataHora(c.criado_em)}`,
        kit.selo(d.status[c.status], AT_TOM_STATUS[c.status])),
        kit.linha(sel('Situação', 'status', Object.entries(d.status)), sel('Responsável', 'responsavel', opEquipe('— ninguém —')), sel('Departamento', 'departamento', Object.entries(d.departamentos)), sel('Prioridade', 'prioridade', Object.entries(d.prioridades)),
          kit.campo('Prazo', f, 'prazo', 'date', { disabled: !podeOp(), onchange: (ev) => { f.prazo = ev.currentTarget.value; atualizar('prazo'); } })),
        c.atrasado ? h('p', { class: 'meta', role: 'alert', text: 'O prazo deste chamado já venceu.' }) : null,
        c.resolvido_em ? h('p', { class: 'meta', text: `Resolvido em ${esDataHora(c.resolvido_em)}.` }) : null),
      kit.cartao(kit.topo('Conversa', 'Anotações internas da equipe (o cliente não vê).'),
        c.mensagens.length ? h('ol', { class: 'at-conversa' }, ...c.mensagens.map((m) => atEhHistorico(m.texto)
          ? h('li', { class: 'at-historico' }, h('span', { text: `${atNome(m.autor, at.resumo.equipe)} · ${m.texto.slice(1, -1)} · ${esDataHora(m.criado_em)}` }))
          : h('li', { class: `at-msg${m.autor === at.resumo.eu ? ' minha' : ''}` }, h('div', { class: 'at-autor', text: `${atNome(m.autor, at.resumo.equipe)} · ${esDataHora(m.criado_em)}` }), h('div', { class: 'at-texto', text: m.texto })))) : h('p', { class: 'meta', text: 'Nenhuma mensagem ainda.' }),
        podeOp() ? h('div', { class: 'pilha' }, (() => { const ta = h('textarea', { rows: 3, maxlength: '8000', 'aria-label': 'Nova mensagem', placeholder: 'Escreva o andamento, o que foi pedido ao cliente, a solução…', oninput: (ev) => { at.resposta = ev.currentTarget.value; } }); ta.value = at.resposta; return ta; })(),
          kit.botoes(kit.btn('Enviar', async () => {
            if (!at.resposta.trim()) throw new Error('Escreva a mensagem.');
            await chamar(`/api/atendimento/chamados/${c.id}/mensagens`, { method: 'POST', body: { texto: at.resposta } });
            at.resposta = ''; await atCarregar();
          }, 'botao primario pequeno'),
          c.status !== 'resolvido' && c.status !== 'fechado' ? kit.btn('Marcar como resolvido', async () => { f.status = 'resolvido'; await atualizar('status'); }) : null,
          at.resumo.pode.excluir ? kit.btn('Excluir chamado', async () => { if (!kit.confirmar(`Excluir o chamado #${c.id} e toda a conversa? Não dá para desfazer.`)) return; await chamar(`/api/atendimento/chamados/${c.id}`, { method: 'DELETE' }); avisar('Chamado excluído.', { tipo: 'ok' }); location.hash = '#/atendimento'; }, 'botao pequeno perigo') : null)) : null)];
    return out;
  }

  window.atMostrar = atMostrar;
}
