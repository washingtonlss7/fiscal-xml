'use strict';
/*
 * Appura Coletor (#/coletores): o programa instalado no PC do cliente, onde o sistema de vendas grava os XMLs.
 * Aqui o escritório cria a instalação (cliente ou grupo, com um ou mais CNPJs), gera um token por máquina
 * (aparece uma vez só), acompanha cada máquina (último sinal, pastas, envios) e revoga quando precisar.
 * Usa os utilitários globais do app.js (h, $, chamar, icone, comOcupado, avisar, pode, empresas, carregarEmpresas)
 * e do nucleo.js (formatarCnpj).
 */

/* ---------- funções puras (testadas em test/coletores-tela.test.ts) ---------- */
const CL_SITUACAO = {
  ok: { texto: 'Enviando', classe: 'ok' },
  atrasada: { texto: 'Sem sinal há algumas horas', classe: 'atencao' },
  sem_sinal: { texto: 'Sem sinal há mais de 24 h', classe: 'problema' },
  aguardando: { texto: 'Aguardando instalação', classe: 'neutro' },
  revogada: { texto: 'Revogada', classe: 'neutro' },
};
const clSituacao = (s) => CL_SITUACAO[s] || CL_SITUACAO.aguardando;

/** "há 5 min", "há 3 h", "em 01/10/2026". */
function clQuando(iso, agora = Date.now()) {
  if (!iso) return 'nunca';
  const min = Math.floor((agora - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  if (min < 1440) return `há ${Math.floor(min / 60)} h`;
  return `em ${new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`;
}

/** Linha de detalhe de uma máquina: último sinal, versão, envios das últimas 24 h e pendentes. */
function clResumoMaquina(m, agora = Date.now()) {
  if (m.situacao === 'revogada') return `Token ${m.prefixo}… revogado${m.revogadoEm ? ` ${clQuando(m.revogadoEm, agora)}` : ''}`;
  if (!m.pareadoEm) return `Token ${m.prefixo}… gerado ${clQuando(m.criadoEm, agora)} · ainda não instalado`;
  const u = m.ultimas24h || {};
  return [`Último sinal ${clQuando(m.ultimoContatoEm, agora)}`, m.hostname, m.versao ? `versão ${m.versao}` : '',
    `${(u.novas || 0).toLocaleString('pt-BR')} nota${u.novas === 1 ? '' : 's'} nova${u.novas === 1 ? '' : 's'} em 24 h`,
    m.pendentes ? `${m.pendentes.toLocaleString('pt-BR')} na fila` : ''].filter(Boolean).join(' · ');
}

/** Filtra empresas por CNPJ (com ou sem pontuação) ou razão social. */
function clFiltrar(lista, termo) {
  const t = String(termo || '').trim().toLowerCase();
  if (!t) return lista;
  const d = t.replace(/\D/g, '');
  return lista.filter((e) => (d.length >= 3 && e.cnpj.includes(d)) || String(e.razao_social || e.razaoSocial || '').toLowerCase().includes(t));
}

/** Empresas do mesmo grupo (mesma raiz de CNPJ, os 8 primeiros dígitos) das já marcadas. */
function clMesmoGrupo(lista, marcados) {
  const raizes = new Set(lista.filter((e) => marcados.has(e.id)).map((e) => e.cnpj.slice(0, 8)));
  return lista.filter((e) => raizes.has(e.cnpj.slice(0, 8))).map((e) => e.id);
}

/** Nomes sugeridos para N máquinas. */
const clNomesMaquinas = (n) => (n <= 1 ? ['Servidor de notas'] : Array.from({ length: n }, (_, i) => (i === 0 ? 'Servidor de notas' : `Máquina ${i + 1}`)));

if (typeof module !== 'undefined') module.exports = { clSituacao, clQuando, clResumoMaquina, clFiltrar, clMesmoGrupo, clNomesMaquinas };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  var cl = { dados: null, erro: null, novos: null, formAberto: false, marcados: new Set(), busca: '', qtd: 1, nomes: ['Servidor de notas'], confirmar: null, editando: null };

  function clMostrar() {
    $('tela-coletores').hidden = false;
    window.scrollTo(0, 0);
    cl.novos = null; cl.confirmar = null; cl.editando = null;
    if (!empresas.length) carregarEmpresas().then(clRender);
    clCarregar();
  }

  async function clCarregar() {
    try { cl.dados = await chamar('/api/coletores'); cl.erro = null; } catch (e) { cl.erro = e.message; }
    clRender();
  }

  const clPodeEditar = () => typeof pode === 'function' && pode('certificados');

  async function clCopiar(texto, botao) {
    try {
      await navigator.clipboard.writeText(texto);
      const antes = botao.lastChild.textContent; botao.lastChild.textContent = 'Copiado';
      setTimeout(() => { if (botao.isConnected) botao.lastChild.textContent = antes; }, 1600);
    } catch { avisar('Não foi possível copiar: selecione o texto e copie manualmente.', { tipo: 'erro' }); }
  }

  function clRender() {
    if ($('tela-coletores').hidden) return;
    const alvo = $('cl-conteudo');
    if (cl.erro && !cl.dados) {
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar os coletores.' }), h('span', { text: cl.erro }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: clCarregar }, icone('refresh-cw'), 'Tentar de novo')));
      return;
    }
    if (!cl.dados) { alvo.replaceChildren(h('div', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }), h('div', { class: 'vg-skel', 'aria-hidden': 'true' }))); return; }
    const inst = cl.dados.instalacoes;
    const topo = h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Como funciona' }),
        h('p', { class: 'meta', text: 'O Appura Coletor é instalado na máquina onde o sistema de vendas do cliente grava os XMLs (normalmente o servidor de notas). Ele envia as NF-e e NFC-e emitidas assim que aparecem na pasta, lembra o que já mandou e o Appura descarta repetidas pela chave. Cada máquina tem o seu token, que só envia XML dos CNPJs da instalação e pode ser revogado a qualquer momento.' })),
        clPodeEditar() && !cl.formAberto && !cl.novos ? h('button', { type: 'button', class: 'botao primario', onclick: () => { cl.formAberto = true; cl.marcados = new Set(); cl.busca = ''; cl.qtd = 1; cl.nomes = clNomesMaquinas(1); clRender(); } }, icone('key-round'), h('span', { text: 'Nova instalação' })) : null));
    const corpo = [topo];
    if (cl.novos) corpo.push(clCardTokens());
    else if (cl.formAberto) corpo.push(clCardForm());
    if (!inst.length && !cl.formAberto && !cl.novos) corpo.push(h('div', { class: 'vg-vazio' }, h('strong', { text: 'Nenhuma instalação ainda.' }), h('span', { text: clPodeEditar() ? 'Crie a primeira em "Nova instalação" e gere os tokens das máquinas do cliente.' : 'Peça a quem cadastra empresas para criar a instalação do cliente.' })));
    for (const i of inst) corpo.push(clCardInstalacao(i));
    alvo.replaceChildren(...corpo);
  }

  /** Lista de empresas com busca e caixas de marcar (usada na criação e na edição de CNPJs). */
  function clSeletorEmpresas(aoMudar) {
    const lista = clFiltrar(empresas.filter((e) => e.ativo !== false), cl.busca);
    const caixa = h('ul', { class: 'cl-empresas', role: 'list' }, ...lista.slice(0, 200).map((e) => h('li', {},
      h('label', { class: 'cl-empresa' }, h('input', { type: 'checkbox', checked: cl.marcados.has(e.id), onchange: (ev) => { if (ev.currentTarget.checked) cl.marcados.add(e.id); else cl.marcados.delete(e.id); aoMudar(); } }),
        h('span', {}, h('strong', { text: e.razao_social }), h('span', { class: 'meta mono', text: formatarCnpj(e.cnpj) }))))));
    const busca = h('input', { type: 'search', class: 'cl-busca', placeholder: 'Buscar por CNPJ ou razão social', value: cl.busca, 'aria-label': 'Buscar empresa',
      oninput: (ev) => { cl.busca = ev.currentTarget.value; const novo = clSeletorEmpresas(aoMudar); bloco.replaceWith(novo); const b = novo.querySelector('input[type=search]'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); } });
    const marcadas = empresas.filter((e) => cl.marcados.has(e.id));
    const bloco = h('div', { class: 'cl-seletor' },
      h('span', { class: 'cl-rotulo', text: 'CNPJs atendidos por esta instalação' }), busca,
      lista.length ? caixa : h('p', { class: 'meta', text: 'Nenhuma empresa encontrada.' }),
      lista.length > 200 ? h('p', { class: 'meta', text: `Mostrando 200 de ${lista.length}. Refine a busca.` }) : null,
      h('div', { class: 'cl-marcadas' }, h('span', { class: 'meta', text: marcadas.length ? `${marcadas.length} marcada${marcadas.length === 1 ? '' : 's'}: ${marcadas.map((e) => e.razao_social).slice(0, 4).join(', ')}${marcadas.length > 4 ? '…' : ''}` : 'Nenhuma marcada.' }),
        marcadas.length ? h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => { for (const id of clMesmoGrupo(empresas, cl.marcados)) cl.marcados.add(id); aoMudar(); } }, 'Marcar filiais do mesmo grupo') : null));
    return bloco;
  }

  function clCardForm() {
    const card = h('section', { class: 'vg-card' });
    const montar = () => {
      const nomes = h('div', { class: 'cl-nomes' }, ...cl.nomes.map((n, i) => h('label', { class: 'campo' }, h('span', { text: `Máquina ${i + 1}` }),
        h('input', { type: 'text', maxlength: '80', value: n, oninput: (ev) => { cl.nomes[i] = ev.currentTarget.value; } }))));
      card.replaceChildren(
        h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Nova instalação' }),
          h('p', { class: 'meta', text: 'Uma instalação é um cliente ou grupo. Marque todos os CNPJs que o sistema de vendas dele emite e diga em quantas máquinas o coletor vai ser instalado. Se o sistema tem um único serviço de notas para todas as máquinas, basta 1.' }))),
        h('label', { class: 'campo' }, h('span', { text: 'Nome da instalação' }), h('input', { id: 'cl-nome', type: 'text', maxlength: '120', placeholder: 'Ex.: Grupo Farma Digital', autocomplete: 'off' })),
        clSeletorEmpresas(montar),
        h('label', { class: 'campo cl-qtd' }, h('span', { text: 'Quantas máquinas?' }), h('input', { type: 'number', min: '1', max: '50', value: String(cl.qtd),
          onchange: (ev) => { const n = Math.max(1, Math.min(50, Math.floor(Number(ev.currentTarget.value) || 1))); cl.qtd = n; cl.nomes = [...cl.nomes.slice(0, n), ...clNomesMaquinas(n).slice(cl.nomes.length)].slice(0, n); montar(); } })),
        nomes,
        h('p', { id: 'cl-erro', class: 'erro', role: 'alert', hidden: true }),
        h('div', { class: 'gu-botoes' },
          h('button', { type: 'button', class: 'botao fantasma', onclick: () => { cl.formAberto = false; clRender(); } }, 'Cancelar'),
          h('button', { type: 'button', class: 'botao primario', onclick: (ev) => clCriar(ev.currentTarget) }, icone('key-round'), h('span', { text: 'Criar e gerar tokens' }))));
    };
    montar();
    return card;
  }

  async function clCriar(botao) {
    const erro = $('cl-erro'); erro.hidden = true;
    const nome = $('cl-nome').value.trim();
    const falha = (t) => { erro.textContent = t; erro.hidden = false; };
    if (nome.length < 2) return falha('Dê um nome para a instalação.');
    if (!cl.marcados.size) return falha('Marque pelo menos um CNPJ.');
    const maquinas = cl.nomes.map((n) => n.trim()).filter(Boolean);
    if (maquinas.length !== cl.qtd) return falha('Dê um nome para cada máquina.');
    await comOcupado(botao, 'Gerando…', async () => {
      try { const r = await chamar('/api/coletores', { method: 'POST', body: { nome, empresas: [...cl.marcados], maquinas } }); cl.novos = { titulo: nome, maquinas: r.maquinas }; cl.formAberto = false; }
      catch (e) { return falha(e.message); }
      await clCarregar();
    }, 'cl-criar');
  }

  function clCardTokens() {
    const n = cl.novos;
    const todos = n.maquinas.map((m) => `${m.nome}: ${m.token}`).join('\n');
    return h('section', { class: 'vg-card ia-novo' },
      h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: `Tokens de "${n.titulo}"` }), h('span', { class: 'selo pendente', text: 'Copie agora' })),
      h('p', { class: 'meta', text: 'Cada token aparece só agora. Na instalação do Appura Coletor, cole o token da máquina correspondente. Envie ao cliente por um canal seguro, nunca em grupo de WhatsApp ou e-mail aberto. Se perder, revogue e gere outro.' }),
      h('ul', { class: 'sped-envios ia-lista' }, ...n.maquinas.map((m) => h('li', {}, h('strong', { class: 'cl-maq-nome', text: m.nome }),
        h('div', { class: 'ia-url cl-token' }, h('code', { class: 'mono ia-token', text: m.token }),
          h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => clCopiar(m.token, ev.currentTarget) }, icone('file-text'), h('span', { text: 'Copiar' })))))),
      h('div', { class: 'gu-botoes' },
        n.maquinas.length > 1 ? h('button', { type: 'button', class: 'botao', onclick: (ev) => clCopiar(todos, ev.currentTarget) }, icone('file-text'), h('span', { text: 'Copiar todos' })) : null,
        h('button', { type: 'button', class: 'botao primario', onclick: () => { cl.novos = null; clRender(); } }, 'Já copiei')));
  }

  function clCardInstalacao(i) {
    const editar = clPodeEditar();
    const sits = i.maquinas.filter((m) => m.situacao !== 'revogada').map((m) => m.situacao);
    const pior = ['sem_sinal', 'atrasada', 'aguardando', 'ok'].find((s) => sits.includes(s));
    const selo = !i.ativo ? { texto: 'Desativada', classe: 'neutro' } : pior ? clSituacao(pior) : { texto: 'Sem máquinas', classe: 'neutro' };
    const maquina = (m) => h('li', {},
      h('span', { class: `selo ${clSituacao(m.situacao).classe}`, text: clSituacao(m.situacao).texto }),
      h('div', { class: 'ia-conexao' }, h('strong', { text: m.nome }), h('span', { class: 'meta', text: clResumoMaquina(m) }),
        m.pastas && m.pastas.length ? h('span', { class: 'meta mono cl-pastas', text: m.pastas.map((p) => `${p.tipo ? `${p.tipo.toUpperCase()}: ` : ''}${p.caminho}${p.ok === false ? ' (inacessível)' : ''}`).join(' · ') }) : null,
        m.ultimoErro ? h('span', { class: 'meta erro', text: `Último erro: ${m.ultimoErro}` }) : null),
      editar && m.situacao !== 'revogada' ? clBotaoRevogar(m) : null);
    const empresasTxt = i.empresas.map((e) => `${e.razaoSocial} (${formatarCnpj(e.cnpj)})`).join(' · ');
    const acoes = editar ? h('div', { class: 'gu-botoes' },
      i.ativo ? h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Gerando…', async () => {
        const nome = `Máquina ${i.maquinas.length + 1}`;
        try { const r = await chamar(`/api/coletores/${i.id}/maquinas`, { method: 'POST', body: { maquinas: [nome] } }); cl.novos = { titulo: i.nome, maquinas: r.maquinas }; } catch (e) { avisar(e.message, { tipo: 'erro' }); return; }
        await clCarregar(); window.scrollTo(0, 0);
      }, `cl-add-${i.id}`) }, icone('key-round'), h('span', { text: 'Adicionar máquina' })) : null,
      h('button', { type: 'button', class: 'botao pequeno', onclick: () => { cl.editando = cl.editando === i.id ? null : i.id; cl.marcados = new Set(i.empresas.map((e) => e.id)); cl.busca = ''; clRender(); } }, h('span', { text: 'Trocar CNPJs' })),
      h('button', { type: 'button', class: `botao pequeno ${i.ativo ? 'perigo' : ''}`, onclick: (ev) => comOcupado(ev.currentTarget, i.ativo ? 'Desativando…' : 'Reativando…', async () => {
        try { await chamar(`/api/coletores/${i.id}`, { method: 'PATCH', body: { ativo: !i.ativo } }); } catch (e) { avisar(e.message, { tipo: 'erro' }); return; }
        avisar(i.ativo ? 'Instalação desativada: os coletores dela param de enviar na hora.' : 'Instalação reativada.', { tipo: 'ok' }); await clCarregar();
      }, `cl-at-${i.id}`) }, h('span', { text: i.ativo ? 'Desativar' : 'Reativar' }))) : null;
    const edicao = cl.editando === i.id ? h('div', { class: 'cl-edicao' }) : null;
    if (edicao) {
      const montar = () => edicao.replaceChildren(clSeletorEmpresas(montar), h('div', { class: 'gu-botoes' },
        h('button', { type: 'button', class: 'botao fantasma pequeno', onclick: () => { cl.editando = null; clRender(); } }, 'Cancelar'),
        h('button', { type: 'button', class: 'botao primario pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Salvando…', async () => {
          if (!cl.marcados.size) { avisar('Marque pelo menos um CNPJ.', { tipo: 'erro' }); return; }
          try { await chamar(`/api/coletores/${i.id}`, { method: 'PATCH', body: { empresas: [...cl.marcados] } }); } catch (e) { avisar(e.message, { tipo: 'erro' }); return; }
          cl.editando = null; avisar('CNPJs atualizados. Vale para os próximos envios.', { tipo: 'ok' }); await clCarregar();
        }, `cl-ed-${i.id}`) }, 'Salvar CNPJs')));
      montar();
    }
    return h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: i.nome }), h('p', { class: 'meta', text: empresasTxt || 'Nenhum CNPJ' })),
        h('span', { class: `selo ${selo.classe}`, text: selo.texto })),
      i.maquinas.length ? h('ul', { class: 'sped-envios ia-lista' }, ...i.maquinas.map(maquina)) : h('p', { class: 'meta', text: 'Nenhuma máquina.' }),
      edicao, acoes);
  }

  function clBotaoRevogar(m) {
    if (cl.confirmar === m.id) {
      return h('span', { class: 'gu-botoes' },
        h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => { cl.confirmar = null; clRender(); } }, 'Cancelar'),
        h('button', { type: 'button', class: 'botao pequeno perigo-cheio', onclick: (ev) => comOcupado(ev.currentTarget, 'Revogando…', async () => {
          try { await chamar(`/api/coletores/maquinas/${m.id}/revogar`, { method: 'POST' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); return; }
          cl.confirmar = null; avisar('Token revogado: essa máquina parou de enviar na hora.', { tipo: 'ok' }); await clCarregar();
        }, `cl-rev-${m.id}`) }, h('span', { text: 'Confirmar' })));
    }
    return h('button', { type: 'button', class: 'botao pequeno perigo', onclick: () => { cl.confirmar = m.id; clRender(); } }, 'Revogar');
  }

  window.clMostrar = clMostrar;
}
