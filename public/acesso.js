'use strict';
/*
 * Acesso por módulo e empresa: Perfis de acesso (#/perfis), Responsáveis por empresa (#/responsaveis) e o bloco de
 * acesso da gaveta de usuário (escopo de empresas e exceções de permissão).
 * Usa os utilitários globais do app.js (h, $, chamar, icone, comOcupado, avisar, pode, empresas, carregarEmpresas)
 * e do nucleo.js (formatarCnpj). As regras valem no servidor (src/painel/acesso.ts); aqui é só a tela.
 */

/* ---------- funções puras (testadas em test/acesso-tela.test.ts) ---------- */

/** Exceções a partir do que ficou marcado: dar o que o perfil não tem, tirar o que ele tem. */
function acDiferenca(doPerfil, marcadas) {
  const p = new Set(doPerfil || []); const m = new Set(marcadas || []);
  return { extras: [...m].filter((x) => !p.has(x)).sort(), removidas: [...p].filter((x) => !m.has(x)).sort() };
}

/** Permissões efetivas: perfil + extras − removidas. */
function acEfetivas(doPerfil, extras, removidas) {
  const tirar = new Set(removidas || []);
  return [...new Set([...(doPerfil || []), ...(extras || [])])].filter((x) => !tirar.has(x)).sort();
}

const AC_ESCOPOS = {
  todas: { nome: 'Todas as empresas', dica: 'Vê todos os clientes do escritório.' },
  carteira: { nome: 'Carteira', dica: 'Só as empresas em que a pessoa é responsável (em Administração → Responsáveis).' },
  lista: { nome: 'Empresas escolhidas', dica: 'Só as empresas marcadas abaixo.' },
};

/** Texto curto do escopo de um usuário. */
function acResumoEscopo(u) {
  if (!u || u.fixo || u.escopo === 'todas' || !u.escopo) return 'Todas as empresas';
  const n = u.empresasNoEscopo ?? (u.empresas || []).length;
  return `${u.escopo === 'carteira' ? 'Carteira' : 'Lista'}: ${n} empresa${n === 1 ? '' : 's'}`;
}

/** "Captação: ver, operar · Fiscal: ver" (só módulos com alguma permissão). */
function acResumoPermissoes(perms, modulos) {
  const s = new Set(perms || []);
  return (modulos || []).map((m) => {
    const acoes = m.acoes.filter((a) => s.has(`${m.id}.${a.id}`)).map((a) => a.nome.toLowerCase());
    return acoes.length ? `${m.nome}: ${acoes.join(', ')}` : null;
  }).filter(Boolean).join(' · ');
}

/** Busca por razão social ou CNPJ (com ou sem pontuação). */
function acFiltrarEmpresas(lista, termo) {
  const t = String(termo || '').trim().toLowerCase();
  if (!t) return lista;
  const d = t.replace(/\D/g, '');
  return lista.filter((e) => String(e.razao_social || e.razaoSocial || '').toLowerCase().includes(t) || (d.length >= 3 && String(e.cnpj || '').includes(d)));
}

/** Marcar uma ação liga também o "ver" do módulo (e desmarcar o "ver" desliga o resto do módulo). */
function acAlternar(marcadas, perm, ligar) {
  const s = new Set(marcadas);
  const [mod, acao] = perm.split('.');
  if (ligar) { s.add(perm); if (acao !== 'ver' && mod !== 'administracao') s.add(`${mod}.ver`); }
  else { s.delete(perm); if (acao === 'ver') for (const x of [...s]) if (x.startsWith(`${mod}.`)) s.delete(x); }
  return [...s].sort();
}

if (typeof module !== 'undefined') module.exports = { acDiferenca, acEfetivas, acResumoEscopo, acResumoPermissoes, acFiltrarEmpresas, acAlternar, AC_ESCOPOS };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  /** Grade módulos × ações com caixas de marcar. `base` (opcional) destaca o que difere do perfil. */
  function acGrade(modulos, marcadas, aoMudar, opcoes = {}) {
    const s = new Set(marcadas); const base = opcoes.base ? new Set(opcoes.base) : null;
    const linhas = modulos.map((m) => h('tr', { class: m.ativo === false ? 'ac-desligado' : '' },
      h('th', { scope: 'row' }, h('strong', { text: m.nome }), !m.disponivel ? h('span', { class: 'selo-mini', text: 'em breve' }) : null,
        m.ativo === false ? h('span', { class: 'selo-mini', text: 'desligado' }) : null, h('span', { class: 'meta', text: m.descricao })),
      h('td', {}, h('div', { class: 'ac-acoes' }, ...m.acoes.map((a) => {
        const p = `${m.id}.${a.id}`;
        const difere = base && base.has(p) !== s.has(p);
        return h('label', { class: `ac-acao${difere ? ' ac-excecao' : ''}`, title: `${a.descricao}${difere ? (s.has(p) ? ' · exceção: dada só para esta pessoa' : ' · exceção: tirada só desta pessoa') : ''}` },
          h('input', { type: 'checkbox', checked: s.has(p), disabled: opcoes.desabilitado, onchange: (ev) => aoMudar(acAlternar([...s], p, ev.currentTarget.checked)) }),
          h('span', { text: a.nome }));
      })))));
    return h('div', { class: 'rolagem' }, h('table', { class: 'ac-grade' }, h('tbody', {}, ...linhas)));
  }

  /* ----- bloco de acesso na gaveta do usuário ----- */
  const g = { perfis: [], modulos: [], perfilId: null, escopo: 'todas', marcadas: [], empresas: new Set(), busca: '', desabilitado: false, exibirExcecoes: false };
  const perfilAtualDaGaveta = () => g.perfis.find((p) => p.id === g.perfilId) || { permissoes: [] };

  function acGavetaMontar(u, perfis, modulos) {
    g.perfis = perfis || []; g.modulos = modulos || [];
    g.perfilId = u ? u.perfilId : 'analista_fiscal';
    if (!g.perfis.some((p) => p.id === g.perfilId)) g.perfilId = (g.perfis[0] || {}).id;
    g.escopo = u ? u.escopo || 'todas' : 'todas';
    g.marcadas = u ? acEfetivas(perfilAtualDaGaveta().permissoes, u.permissoesExtra, u.permissoesRemovidas) : [...perfilAtualDaGaveta().permissoes];
    g.empresas = new Set(u ? u.empresas || [] : []);
    g.busca = '';
    g.desabilitado = !!u && u.email === ((typeof sessao !== 'undefined' && sessao && sessao.email) || '');
    g.exibirExcecoes = !!u && ((u.permissoesExtra || []).length + (u.permissoesRemovidas || []).length > 0);
    const sel = $('gu-perfil');
    sel.replaceChildren(...g.perfis.map((p) => h('option', { value: p.id, text: p.nome, selected: p.id === g.perfilId })));
    sel.disabled = g.desabilitado;
    sel.onchange = () => { g.perfilId = sel.value; g.marcadas = [...perfilAtualDaGaveta().permissoes]; acGavetaRender(); };
    if (!empresas.length && typeof carregarEmpresas === 'function') carregarEmpresas().then(acGavetaRender).catch(() => {});
    acGavetaRender();
  }

  function acGavetaRender() {
    const alvo = $('gu-acesso'); if (!alvo) return;
    const perfil = perfilAtualDaGaveta();
    $('gu-perfil-dica').textContent = perfil.descricao || '';
    const dif = acDiferenca(perfil.permissoes, g.marcadas);
    const nExc = dif.extras.length + dif.removidas.length;
    const escopo = h('fieldset', { class: 'ac-escopo' }, h('legend', { text: 'Empresas que vê' }),
      ...Object.entries(AC_ESCOPOS).map(([id, e]) => h('label', { class: 'marcar' },
        h('input', { type: 'radio', name: 'gu-escopo', value: id, checked: g.escopo === id, disabled: g.desabilitado, onchange: () => { g.escopo = id; acGavetaRender(); } }),
        h('span', {}, h('strong', { text: e.nome }), h('span', { class: 'dica', text: ` ${e.dica}` })))));
    let lista = null;
    if (g.escopo === 'lista') {
      const filtradas = acFiltrarEmpresas(empresas, g.busca);
      lista = h('div', { class: 'cl-seletor' },
        h('input', { type: 'search', class: 'cl-busca', placeholder: 'Buscar por CNPJ ou razão social', value: g.busca, 'aria-label': 'Buscar empresa', disabled: g.desabilitado,
          oninput: (ev) => { g.busca = ev.currentTarget.value; acGavetaRender(); const b = $('gu-acesso').querySelector('input[type=search]'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }),
        h('ul', { class: 'cl-empresas', role: 'list' }, ...filtradas.slice(0, 200).map((e) => h('li', {}, h('label', { class: 'cl-empresa' },
          h('input', { type: 'checkbox', checked: g.empresas.has(e.id), disabled: g.desabilitado, onchange: (ev) => { if (ev.currentTarget.checked) g.empresas.add(e.id); else g.empresas.delete(e.id); acGavetaRender(); } }),
          h('span', {}, h('strong', { text: e.razao_social }), h('span', { class: 'meta mono', text: formatarCnpj(e.cnpj) })))))),
        h('p', { class: 'meta', text: `${g.empresas.size} empresa${g.empresas.size === 1 ? '' : 's'} marcada${g.empresas.size === 1 ? '' : 's'}${filtradas.length > 200 ? ` · mostrando 200 de ${filtradas.length}` : ''}` }));
    }
    const excecoes = h('details', { class: 'ac-excecoes', open: g.exibirExcecoes, ontoggle: (ev) => { g.exibirExcecoes = ev.currentTarget.open; } },
      h('summary', {}, h('span', { text: 'Ajustar permissões só desta pessoa' }), nExc ? h('span', { class: 'selo atencao', text: `${nExc} exceç${nExc === 1 ? 'ão' : 'ões'}` }) : null),
      h('p', { class: 'dica', text: 'Começa igual ao perfil. O que você marcar ou desmarcar aqui vale só para esta pessoa (fica destacado).' }),
      acGrade(g.modulos, g.marcadas, (novas) => { g.marcadas = novas; acGavetaRender(); }, { base: perfil.permissoes, desabilitado: g.desabilitado }),
      nExc ? h('button', { type: 'button', class: 'botao pequeno fantasma', disabled: g.desabilitado, onclick: () => { g.marcadas = [...perfil.permissoes]; acGavetaRender(); } }, 'Voltar ao perfil') : null);
    alvo.replaceChildren(escopo, lista, excecoes);
  }

  /** Dados de acesso para gravar (ou null se não deve mexer: o próprio usuário). */
  function acGavetaLer() {
    if (g.desabilitado) return null;
    const dif = acDiferenca(perfilAtualDaGaveta().permissoes, g.marcadas);
    const r = { perfilId: g.perfilId, escopo: g.escopo, permissoesExtra: dif.extras, permissoesRemovidas: dif.removidas };
    if (g.escopo === 'lista') r.empresas = [...g.empresas];
    return r;
  }

  /* ----- Perfis de acesso ----- */
  const pf = { dados: null, erro: null, editando: null, form: null };

  function acPerfisMostrar() {
    $('tela-perfis').hidden = false; window.scrollTo(0, 0);
    pf.editando = null; pf.form = null;
    acPerfisCarregar();
  }
  async function acPerfisCarregar() {
    try { pf.dados = await chamar('/api/acesso/perfis'); pf.erro = null; } catch (e) { pf.erro = e.message; }
    acPerfisRender();
  }

  function acPerfisRender() {
    if ($('tela-perfis').hidden) return;
    const alvo = $('pf-conteudo');
    if (pf.erro && !pf.dados) { alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar os perfis.' }), h('span', { text: pf.erro }))); return; }
    if (!pf.dados) { alvo.replaceChildren(h('div', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }))); return; }
    const { perfis, modulos } = pf.dados;
    const corpo = [];
    corpo.push(h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Como funciona' }),
        h('p', { class: 'meta', text: 'Um login só. Cada pessoa tem um perfil (o que pode fazer em cada módulo), pode ter exceções individuais e vê todas as empresas, a carteira dela (Responsáveis) ou uma lista escolhida. Os perfis prontos não mudam: use "Duplicar" para criar um parecido.' })),
        !pf.form ? h('button', { type: 'button', class: 'botao primario', onclick: () => { pf.form = { nome: '', descricao: '', permissoes: ['captacao.ver', 'fiscal.ver'] }; acPerfisRender(); } }, h('span', { text: 'Novo perfil' })) : null)));
    if (pf.form) corpo.push(acPerfilForm(modulos));
    for (const p of perfis) corpo.push(acPerfilCard(p, modulos));
    corpo.push(acModulosCard(modulos));
    alvo.replaceChildren(...corpo);
  }

  function acPerfilCard(p, modulos) {
    const ativos = modulos.filter((m) => m.ativo !== false);
    return h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: p.nome }),
        h('p', { class: 'meta', text: `${p.descricao || ''}${p.descricao ? ' · ' : ''}${p.usuarios} usuário${p.usuarios === 1 ? '' : 's'}` })),
        h('span', { class: `selo ${p.sistema ? 'neutro' : 'ok'}`, text: p.sistema ? 'Pronto' : 'Do escritório' })),
      h('p', { class: 'ac-resumo', text: acResumoPermissoes(p.permissoes, ativos) || 'Nenhuma permissão nos módulos ligados.' }),
      h('div', { class: 'gu-botoes' },
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => { pf.form = { nome: `${p.nome} (cópia)`, descricao: p.descricao || '', permissoes: [...p.permissoes] }; acPerfisRender(); window.scrollTo(0, 0); } }, h('span', { text: 'Duplicar' })),
        !p.sistema ? h('button', { type: 'button', class: 'botao pequeno', onclick: () => { pf.form = { id: p.id, nome: p.nome, descricao: p.descricao || '', permissoes: [...p.permissoes] }; acPerfisRender(); window.scrollTo(0, 0); } }, h('span', { text: 'Editar' })) : null,
        !p.sistema ? h('button', { type: 'button', class: 'botao pequeno perigo', disabled: p.usuarios > 0, title: p.usuarios ? 'Troque o perfil das pessoas antes de excluir.' : '',
          onclick: (ev) => comOcupado(ev.currentTarget, 'Excluindo…', async () => {
            if (!window.confirm(`Excluir o perfil "${p.nome}"?`)) return;
            try { await chamar(`/api/acesso/perfis/${p.id}`, { method: 'DELETE' }); avisar('Perfil excluído.', { tipo: 'ok' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); }
            await acPerfisCarregar();
          }) }, h('span', { text: 'Excluir' })) : null));
  }

  function acPerfilForm(modulos) {
    const f = pf.form;
    const nome = h('input', { type: 'text', maxlength: '60', value: f.nome, oninput: (ev) => { f.nome = ev.currentTarget.value; } });
    const desc = h('input', { type: 'text', maxlength: '300', value: f.descricao, oninput: (ev) => { f.descricao = ev.currentTarget.value; } });
    const erro = h('p', { class: 'erro', role: 'alert', hidden: true });
    return h('section', { class: 'vg-card ac-form' },
      h('h2', { class: 'vg-card-titulo', text: f.id ? `Editar perfil` : 'Novo perfil' }),
      h('label', { class: 'campo' }, 'Nome', nome),
      h('label', { class: 'campo' }, 'Descrição (opcional)', desc),
      h('p', { class: 'dica', text: 'Marcar uma ação liga o "Ver" do módulo. Módulos "em breve" já podem ser marcados: valem quando as telas chegarem.' }),
      acGrade(modulos, f.permissoes, (novas) => { f.permissoes = novas; acPerfisRender(); }),
      erro,
      h('div', { class: 'gaveta-acoes' },
        h('button', { type: 'button', class: 'botao fantasma', onclick: () => { pf.form = null; acPerfisRender(); } }, 'Cancelar'),
        h('button', { type: 'button', class: 'botao primario', onclick: (ev) => comOcupado(ev.currentTarget, 'Salvando…', async () => {
          erro.hidden = true;
          try {
            await chamar(f.id ? `/api/acesso/perfis/${f.id}` : '/api/acesso/perfis', { method: f.id ? 'PATCH' : 'POST', body: { nome: f.nome, descricao: f.descricao, permissoes: f.permissoes } });
            avisar(f.id ? 'Perfil atualizado. Vale para quem usa este perfil em até 1 minuto.' : 'Perfil criado. Escolha-o em Usuários.', { tipo: 'ok' });
            pf.form = null; await acPerfisCarregar();
          } catch (e) { erro.textContent = e.message; erro.hidden = false; }
        }) }, h('span', { text: 'Salvar perfil' }))));
  }

  function acModulosCard(modulos) {
    return h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Módulos do escritório' }),
        h('p', { class: 'meta', text: 'Módulo desligado some para todos (menu, telas e permissões), sem apagar nada. A Administração não desliga.' }))),
      h('ul', { class: 'sped-envios ia-lista' }, ...modulos.map((m) => h('li', {},
        h('span', { class: `selo ${m.ativo ? 'ok' : 'neutro'}`, text: m.ativo ? 'Ligado' : 'Desligado' }),
        h('div', { class: 'ia-conexao' }, h('strong', { text: m.nome }), h('span', { class: 'meta', text: `${m.descricao}${m.disponivel ? '' : ' · telas em breve'}` })),
        m.id === 'administracao' ? null : h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Salvando…', async () => {
          try { await chamar(`/api/acesso/modulos/${m.id}`, { method: 'PATCH', body: { ativo: !m.ativo } }); avisar(`${m.nome} ${m.ativo ? 'desligado' : 'ligado'}.`, { tipo: 'ok' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); }
          await acPerfisCarregar();
        }) }, h('span', { text: m.ativo ? 'Desligar' : 'Ligar' }))))));
  }

  /* ----- Responsáveis por empresa (carteira) ----- */
  const rp = { dados: null, erro: null, modulo: 'fiscal', marcadas: new Set(), busca: '', escolhidos: new Set(), sug: null, sugMarcadas: new Set(), soSem: false };

  function acRespMostrar() {
    $('tela-responsaveis').hidden = false; window.scrollTo(0, 0);
    rp.marcadas = new Set(); rp.escolhidos = new Set(); rp.sug = null;
    acRespCarregar();
  }
  async function acRespCarregar() {
    try { rp.dados = await chamar('/api/acesso/responsaveis'); rp.erro = null; } catch (e) { rp.erro = e.message; }
    if (rp.dados && !rp.dados.modulos.some((m) => m.id === rp.modulo)) rp.modulo = (rp.dados.modulos[0] || {}).id || 'fiscal';
    acRespRender();
  }

  function acRespRender() {
    if ($('tela-responsaveis').hidden) return;
    const alvo = $('rp-conteudo');
    if (rp.erro && !rp.dados) { alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar os responsáveis.' }), h('span', { text: rp.erro }))); return; }
    if (!rp.dados) { alvo.replaceChildren(h('div', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }))); return; }
    const { modulos, usuarios, empresas: emps } = rp.dados;
    const nome = (email) => { const u = usuarios.find((x) => x.email === email); return u ? u.nome || u.email : email; };
    const resp = (e) => (e.responsaveis[rp.modulo] || []);
    const filtradas = acFiltrarEmpresas(emps, rp.busca).filter((e) => !rp.soSem || !resp(e).length);
    const semResp = emps.filter((e) => e.ativo !== false && !resp(e).length).length;
    const usamCarteira = usuarios.filter((u) => u.escopo === 'carteira');

    const abas = h('div', { class: 'abas-tela', role: 'tablist' }, ...modulos.map((m) => h('button', {
      type: 'button', role: 'tab', class: `aba-tela${m.id === rp.modulo ? ' ativa' : ''}`, 'aria-selected': String(m.id === rp.modulo),
      onclick: () => { rp.modulo = m.id; rp.marcadas = new Set(); rp.escolhidos = new Set(); acRespRender(); },
    }, `${m.nome}${m.disponivel ? '' : ' (em breve)'}`)));

    const topo = h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Carteira de cada pessoa' }),
        h('p', { class: 'meta', text: `Quem cuida de cada empresa em cada módulo. Quem tem o escopo "Carteira" vê só as empresas em que é responsável (em qualquer módulo). ${usamCarteira.length ? `Usam carteira hoje: ${usamCarteira.map((u) => u.nome || u.email).join(', ')}.` : 'Ninguém usa carteira ainda: o escopo de cada pessoa é escolhido em Usuários.'}` })),
        h('span', { class: `selo ${semResp ? 'atencao' : 'ok'}`, text: semResp ? `${semResp} sem responsável` : 'Todas com responsável' })),
      abas);

    const marcadasLista = emps.filter((e) => rp.marcadas.has(e.id));
    const definir = h('section', { class: 'vg-card' },
      h('h2', { class: 'vg-card-titulo', text: `Definir responsáveis${marcadasLista.length ? ` de ${marcadasLista.length} empresa${marcadasLista.length === 1 ? '' : 's'}` : ''}` }),
      marcadasLista.length ? null : h('p', { class: 'meta', text: 'Marque as empresas na lista abaixo e escolha quem cuida delas neste módulo.' }),
      marcadasLista.length ? h('div', { class: 'ac-pessoas' }, ...usuarios.map((u) => h('label', { class: 'marcar' },
        h('input', { type: 'checkbox', checked: rp.escolhidos.has(u.email), onchange: (ev) => { if (ev.currentTarget.checked) rp.escolhidos.add(u.email); else rp.escolhidos.delete(u.email); } }),
        h('span', { text: u.nome || u.email })))) : null,
      marcadasLista.length ? h('div', { class: 'gu-botoes' },
        h('button', { type: 'button', class: 'botao fantasma pequeno', onclick: () => { rp.marcadas = new Set(); rp.escolhidos = new Set(); acRespRender(); } }, 'Limpar seleção'),
        h('button', { type: 'button', class: 'botao primario pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Salvando…', async () => {
          try {
            const r = await chamar('/api/acesso/responsaveis', { method: 'POST', body: { modulo: rp.modulo, empresas: [...rp.marcadas], emails: [...rp.escolhidos] } });
            avisar(rp.escolhidos.size ? `Responsáveis definidos em ${r.empresas} empresa${r.empresas === 1 ? '' : 's'}.` : `Responsáveis removidos de ${r.empresas} empresa${r.empresas === 1 ? '' : 's'}.`, { tipo: 'ok' });
            rp.marcadas = new Set(); rp.escolhidos = new Set(); await acRespCarregar();
          } catch (e) { avisar(e.message, { tipo: 'erro' }); }
        }) }, h('span', { text: rp.escolhidos.size ? 'Salvar responsáveis' : 'Salvar (sem responsável)' }))) : null);

    const todasMarcadas = filtradas.length && filtradas.every((e) => rp.marcadas.has(e.id));
    const tabela = h('section', { class: 'vg-card' },
      h('div', { class: 'ac-filtros' },
        h('input', { type: 'search', class: 'cl-busca', placeholder: 'Buscar por CNPJ ou razão social', value: rp.busca, 'aria-label': 'Buscar empresa',
          oninput: (ev) => { rp.busca = ev.currentTarget.value; acRespRender(); const b = $('rp-conteudo').querySelector('.ac-filtros input[type=search]'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }),
        h('label', { class: 'marcar' }, h('input', { type: 'checkbox', checked: rp.soSem, onchange: (ev) => { rp.soSem = ev.currentTarget.checked; acRespRender(); } }), h('span', { text: 'Só sem responsável' }))),
      h('div', { class: 'rolagem' }, h('table', { class: 'notas' },
        h('thead', {}, h('tr', {},
          h('th', {}, h('input', { type: 'checkbox', 'aria-label': 'Marcar todas', checked: !!todasMarcadas, onchange: (ev) => { for (const e of filtradas) { if (ev.currentTarget.checked) rp.marcadas.add(e.id); else rp.marcadas.delete(e.id); } acRespRender(); } })),
          h('th', { text: 'Empresa' }), h('th', { text: 'CNPJ' }), h('th', { text: 'Responsáveis neste módulo' }))),
        h('tbody', {}, ...filtradas.slice(0, 500).map((e) => h('tr', { class: e.ativo === false ? 'desativado' : '' },
          h('td', {}, h('input', { type: 'checkbox', 'aria-label': `Marcar ${e.razaoSocial}`, checked: rp.marcadas.has(e.id), onchange: (ev) => { if (ev.currentTarget.checked) rp.marcadas.add(e.id); else rp.marcadas.delete(e.id); acRespRender(); } })),
          h('td', { text: e.razaoSocial }), h('td', { class: 'mono', text: formatarCnpj(e.cnpj) }),
          h('td', { text: resp(e).map(nome).join(', ') || '—' })))))),
      filtradas.length > 500 ? h('p', { class: 'meta', text: `Mostrando 500 de ${filtradas.length}. Refine a busca.` }) : null);

    alvo.replaceChildren(topo, definir, acSugestoesCard(), tabela);
  }

  function acSugestoesCard() {
    const nomeMod = (id) => ((rp.dados.modulos.find((m) => m.id === id) || {}).nome || id);
    const corpo = [h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Sugestões do Acessórias' }),
      h('p', { class: 'meta', text: 'Lê o departamento e o responsável das entregas do Acessórias e casa o nome com os usuários do Appura. Nada muda até você aplicar.' })),
      h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Buscando…', async () => {
        try { rp.sug = await chamar('/api/acesso/sugestoes-acessorias'); rp.sugMarcadas = new Set(rp.sug.sugestoes.filter((s) => s.email && !s.jaDefinido).map((s) => `${s.empresaId}|${s.modulo}|${s.email}`)); } catch (e) { avisar(e.message, { tipo: 'erro' }); }
        acRespRender();
      }) }, h('span', { text: rp.sug ? 'Buscar de novo' : 'Buscar sugestões' })))];
    if (rp.sug) {
      const uteis = rp.sug.sugestoes.filter((s) => s.email && !s.jaDefinido);
      if (!rp.sug.sugestoes.length) corpo.push(h('p', { class: 'meta', text: 'Nenhuma entrega do Acessórias com departamento e responsável ainda. Atualize as entregas do mês em Guias → Acessórias e busque de novo.' }));
      else {
        corpo.push(h('p', { class: 'meta', text: `${uteis.length} sugest${uteis.length === 1 ? 'ão nova' : 'ões novas'} · ${rp.sug.sugestoes.length - uteis.length} já definida${rp.sug.sugestoes.length - uteis.length === 1 ? '' : 's'} ou sem usuário.${rp.sug.semUsuario.length ? ` Nomes do Acessórias sem usuário no Appura: ${rp.sug.semUsuario.join(', ')}.` : ''}` }));
        if (uteis.length) {
          corpo.push(h('div', { class: 'rolagem' }, h('table', { class: 'notas' },
            h('thead', {}, h('tr', {}, h('th', {}), h('th', { text: 'Empresa' }), h('th', { text: 'Módulo' }), h('th', { text: 'Responsável no Acessórias' }), h('th', { text: 'Usuário' }))),
            h('tbody', {}, ...uteis.slice(0, 500).map((s) => { const k = `${s.empresaId}|${s.modulo}|${s.email}`; return h('tr', {},
              h('td', {}, h('input', { type: 'checkbox', checked: rp.sugMarcadas.has(k), onchange: (ev) => { if (ev.currentTarget.checked) rp.sugMarcadas.add(k); else rp.sugMarcadas.delete(k); } })),
              h('td', { text: s.razaoSocial }), h('td', { text: nomeMod(s.modulo) }), h('td', { text: s.nomeAcessorias }), h('td', { text: s.email })); })))));
          corpo.push(h('div', { class: 'gu-botoes' }, h('button', { type: 'button', class: 'botao primario pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Aplicando…', async () => {
            const itens = [...rp.sugMarcadas].map((k) => { const [empresaId, modulo, email] = k.split('|'); return { empresaId, modulo, email }; });
            if (!itens.length) { avisar('Marque ao menos uma sugestão.', { tipo: 'erro' }); return; }
            try { const r = await chamar('/api/acesso/sugestoes-acessorias', { method: 'POST', body: { itens } }); avisar(`${r.aplicadas} responsáve${r.aplicadas === 1 ? 'l aplicado' : 'is aplicados'}.`, { tipo: 'ok' }); rp.sug = null; await acRespCarregar(); } catch (e) { avisar(e.message, { tipo: 'erro' }); }
          }) }, h('span', { text: 'Aplicar marcadas' }))));
        }
      }
    }
    return h('section', { class: 'vg-card' }, ...corpo);
  }

  window.acGavetaMontar = acGavetaMontar;
  window.acGavetaLer = acGavetaLer;
  window.acPerfisMostrar = acPerfisMostrar;
  window.acRespMostrar = acRespMostrar;
  window.acResumoEscopo = acResumoEscopo;
}
