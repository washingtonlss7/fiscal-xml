'use strict';
/*
 * Tela SPED (#/sped): envio de SPED Fiscal, Contribuições ou SINTEGRA de qualquer cliente (identifica pelo CNPJ)
 * e pré-cadastro: o escritório confere e aprova os dados que o arquivo trouxe.
 * Usa os utilitários globais do app.js (h, $, chamar, icone, enviarArquivo...).
 */

/* ---------- funções puras (testadas em test/sped-tela.test.ts) ---------- */

/** Campos marcados por padrão: tudo o que o cadastro ainda não tem; o que muda um valor existente fica para o escritório marcar. */
function spPadraoMarcados(diferencas, clienteNovo) {
  return diferencas.filter((d) => clienteNovo || !d.atual).map((d) => d.campo);
}

/** Texto curto do resultado de um envio (SPED Fiscal, SPED Contribuições ou SINTEGRA). */
function spResumoEnvio(r) {
  if (!r.valido) {
    const erro = (r.ocorrencias || []).find((o) => o.nivel === 'erro');
    return { tom: 'problema', texto: erro ? erro.mensagem : 'Não é um SPED nem um SINTEGRA' };
  }
  const partes = [];
  const erros = (r.ocorrencias || []).filter((o) => o.nivel === 'erro').length;
  partes.push(erros ? `${erros} erro${erros === 1 ? '' : 's'} no arquivo` : 'arquivo sem erros');
  const contrib = r.tipo === 'efd_contribuicoes';
  const sintegra = r.tipo === 'sintegra';
  if (contrib) partes.unshift('SPED Contribuições');
  if (sintegra) partes.unshift('SINTEGRA');
  const c = r.comparacao;
  const abertas = c ? c.divergencias.filter((d) => d.nivel !== 'info' && !d.justificativa).length : 0;
  if (c && !(contrib && c.fiscal === false)) {
    partes.push(abertas ? `${abertas} divergência${abertas === 1 ? '' : 's'} com ${contrib ? 'o SPED Fiscal' : 'os XMLs'}`
      : contrib ? 'vendas conferem com o SPED Fiscal' : sintegra ? 'XML e SINTEGRA conferem' : 'XML e SPED conferem');
  } else if (contrib && !r.clienteNovo) {
    partes.push('sem SPED Fiscal do mês para cruzar');
    if (abertas) partes.push(`${abertas} nota${abertas === 1 ? '' : 's'} monofásico × tributado a revisar`);
  }
  if (r.clienteNovo) partes.push('cliente novo: aguardando aprovação do cadastro');
  else if (r.sugestao) partes.push('dados de cadastro para conferir');
  return { tom: erros ? 'pendente' : r.clienteNovo || r.sugestao ? 'info' : 'ok', texto: partes.join(' · ') };
}

if (typeof module !== 'undefined') module.exports = { spPadraoMarcados, spResumoEnvio };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  var sp = { dados: null, erro: null, foco: null, marcados: new Map(), regime: new Map(), ocupado: new Set() };

  function spMostrar(consulta) {
    const q = new URLSearchParams(consulta || '');
    sp.foco = q.get('cadastro') ? Number(q.get('cadastro')) : null;
    for (const id of ['tela-visao', 'tela-fechamento', 'tela-empresas', 'tela-notas', 'tela-usuarios', 'tela-guias']) $(id).hidden = true;
    $('tela-sped').hidden = false;
    $('sp-enviar').hidden = !pode('operar');
    $('sp-sem-permissao').hidden = pode('operar');
    $('sp-cad-permissao').hidden = pode('certificados');
    window.scrollTo(0, 0);
    spCarregar();
  }

  async function spCarregar() {
    try {
      sp.dados = await chamar('/api/cadastros');
      sp.erro = null;
    } catch (e) {
      sp.erro = e.message;
    }
    spRender();
  }

  function spRender() {
    if ($('tela-sped').hidden) return;
    const alvo = $('sp-cadastros');
    if (sp.erro && !sp.dados) {
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar os cadastros.' }), h('span', { text: sp.erro }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: spCarregar }, icone('refresh-cw'), 'Tentar de novo')));
      return;
    }
    if (!sp.dados) { alvo.replaceChildren(h('div', { class: 'vg-skel', 'aria-hidden': 'true' }), h('div', { class: 'vg-skel', 'aria-hidden': 'true' })); return; }
    const lista = sp.dados.pendentes;
    $('sp-cad-n').className = `selo ${lista.length ? 'info' : 'ok'}`;
    $('sp-cad-n').textContent = lista.length ? `${lista.length} pendente${lista.length === 1 ? '' : 's'}` : 'Nada pendente';
    alvo.replaceChildren(...(lista.length ? lista.map(spCartao) : [h('div', { class: 'e360-tudo-ok' }, h('span', { class: 'vg-simbolo ok', 'aria-hidden': 'true', text: '✓' }), 'Nenhum dado de cadastro aguardando conferência.')]));
    const dec = sp.dados.decididas || [];
    $('sp-decididas').replaceChildren(...(dec.length ? dec.map((x) => h('li', {},
      h('strong', { text: x.razao_social || formatarCnpj(x.cnpj) }),
      x.status === 'aprovado' ? ` · ${(x.campos_aprovados || []).length} campo${(x.campos_aprovados || []).length === 1 ? '' : 's'} aprovado${(x.campos_aprovados || []).length === 1 ? '' : 's'}` : ' · recusado',
      ` por ${x.decidido_por} · ${quandoRelativo(x.decidido_em)}`)) : [h('li', { class: 'vazio-hist', text: 'Nenhuma decisão ainda.' })]));
    if (sp.foco) {
      const el = document.getElementById(`sp-cad-${sp.foco}`);
      if (el) { el.scrollIntoView({ block: 'start', behavior: 'smooth' }); el.classList.add('foco'); }
      sp.foco = null;
    }
  }

  function spCartao(s) {
    if (!sp.marcados.has(s.id)) sp.marcados.set(s.id, new Set(spPadraoMarcados(s.diferencas, s.clienteNovo)));
    const marcados = sp.marcados.get(s.id);
    const podeAprovar = pode('certificados');
    const ocupado = sp.ocupado.has(s.id);
    const nome = s.empresa ? s.empresa.razao_social : s.dados.razao_social || formatarCnpj(s.cnpj);
    const comp = s.competencia ? textoCompetencia(String(s.competencia).slice(0, 7)) : '—';
    const valor = (d, v) => (v ? (d.campo === 'cod_municipio' ? `${s.dados.municipio && v === s.dados.cod_municipio ? `${s.dados.municipio} · ` : ''}${v}` : v) : null);
    const linhas = s.diferencas.map((d) => {
      const caixa = h('input', { type: 'checkbox', checked: marcados.has(d.campo), disabled: !podeAprovar || ocupado, 'aria-label': `Aprovar ${d.rotulo}`,
        onchange: (ev) => { if (ev.target.checked) marcados.add(d.campo); else marcados.delete(d.campo); } });
      return h('tr', { class: d.atual ? 'muda' : 'novo' },
        h('td', { class: 'sp-check' }, caixa),
        h('th', { scope: 'row', text: d.rotulo }),
        s.clienteNovo ? null : h('td', { class: d.atual ? '' : 'meta', text: d.atual ? valor(d, d.atual) : 'vazio' }),
        h('td', {}, h('strong', { text: valor(d, d.proposto) }), d.atual ? h('span', { class: 'selo pendente sp-muda', text: 'muda' }) : null));
    });
    const regime = h('select', { class: 'vg-select', disabled: !podeAprovar || ocupado, onchange: (ev) => sp.regime.set(s.id, ev.target.value) },
      h('option', { value: '', text: 'Não informado' }),
      ...Object.entries(REGIMES).map(([k, v]) => h('option', { value: k, text: v, selected: sp.regime.get(s.id) === k })));
    return h('article', { id: `sp-cad-${s.id}`, class: `sp-cartao${s.clienteNovo ? ' novo' : ''}` },
      h('div', { class: 'sp-cartao-topo' },
        h('div', {},
          h('div', { class: 'sp-cartao-nome' }, h('strong', { text: nome }), s.clienteNovo ? h('span', { class: 'selo info', text: 'Cliente novo' }) : null),
          h('span', { class: 'meta' }, h('span', { class: 'mono', text: formatarCnpj(s.cnpj) }), ` · ${s.dados.uf || ''} · ${s.origem === 'sintegra' ? 'SINTEGRA' : 'SPED'} de ${comp} · enviado por ${s.criado_por || '—'} ${quandoRelativo(s.criado_em)}`)),
        s.empresa ? h('a', { class: 'botao pequeno', href: `#/empresas/${s.empresa.id}` }, 'Abrir empresa') : null),
      s.clienteNovo ? h('p', { class: 'meta', text: 'Este CNPJ ainda não é cliente. Ao aprovar, a empresa é criada e fica aguardando o certificado A1 para começar a captar os XMLs.' }) : null,
      h('div', { class: 'vg-tabela-caixa' }, h('table', { class: 'vg-tabela sp-tabela' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col', class: 'sp-check' }, h('span', { class: 'visualmente-oculto', text: 'Aprovar' })), h('th', { scope: 'col', text: 'Campo' }),
          s.clienteNovo ? null : h('th', { scope: 'col', text: 'No cadastro' }), h('th', { scope: 'col', text: 'No SPED' }))),
        h('tbody', {}, ...linhas))),
      podeAprovar ? h('div', { class: 'sp-cartao-acoes' },
        s.clienteNovo ? h('label', { class: 'fc-campo sp-regime' }, h('span', { text: 'Regime tributário' }), regime) : null,
        h('button', { type: 'button', class: 'botao', disabled: ocupado, onclick: () => spMarcarTodos(s) }, 'Marcar todos'),
        h('button', { type: 'button', class: 'botao fantasma', disabled: ocupado, onclick: () => spDecidir(s, 'rejeitar') }, 'Recusar'),
        h('button', { type: 'button', class: 'botao primario', disabled: ocupado, onclick: () => spDecidir(s, 'aprovar') },
          ocupado ? 'Gravando…' : s.clienteNovo ? 'Aprovar e cadastrar cliente' : 'Aprovar selecionados')) : null);
  }

  function spMarcarTodos(s) {
    sp.marcados.set(s.id, new Set(s.diferencas.map((d) => d.campo)));
    spRender();
  }

  async function spDecidir(s, acao) {
    const campos = [...(sp.marcados.get(s.id) || [])];
    if (acao === 'aprovar' && !campos.length && !s.clienteNovo) { avisar('Marque ao menos um campo, ou use "Recusar".'); return; }
    if (acao === 'aprovar' && s.clienteNovo && !campos.includes('razao_social')) campos.push('razao_social');
    sp.ocupado.add(s.id);
    spRender();
    try {
      const r = await chamar(`/api/cadastros/${s.id}/${acao}`, { method: 'POST', body: { campos, regime: sp.regime.get(s.id) || null } });
      sp.marcados.delete(s.id);
      if (acao === 'rejeitar') avisar('Dados do SPED recusados. O cadastro não mudou.');
      else if (r.criada) avisar('Cliente cadastrado. Envie o certificado A1 para começar a captação.');
      else avisar(`Cadastro atualizado (${campos.length} campo${campos.length === 1 ? '' : 's'}).`);
      window.e360Chave = null;
      if (r && r.criada) await carregarEmpresas();
    } catch (e) {
      avisar(e.message);
    } finally {
      sp.ocupado.delete(s.id);
      spCarregar();
    }
  }

  async function spEnviar(arquivos) {
    const lista = [...arquivos].filter((f) => f.size);
    if (!lista.length) return;
    const ul = $('sp-envios');
    $('sp-enviar').disabled = true;
    for (const f of lista) {
      const li = h('li', { class: 'sp-envio' }, h('span', { class: 'vg-simbolo info', 'aria-hidden': 'true', text: '●' }), h('strong', { text: f.name }), h('span', { class: 'meta', text: 'Lendo…' }));
      ul.prepend(li);
      try {
        const r = await enviarArquivo(`/api/sped?nome=${encodeURIComponent(f.name)}`, f);
        const res = spResumoEnvio(r);
        const nome = r.resumo && r.resumo.empresa ? r.resumo.empresa.nome : f.name;
        li.replaceChildren(
          h('span', { class: `vg-simbolo ${res.tom}`, 'aria-hidden': 'true', text: res.tom === 'ok' ? '✓' : res.tom === 'problema' ? '✕' : '!' }),
          h('div', { class: 'sp-envio-corpo' },
            h('strong', { text: `${nome}${r.competencia ? ` · ${textoCompetencia(r.competencia)}` : ''}` }),
            h('span', { class: 'meta', text: `${f.name} · ${res.texto}` })),
          r.empresaId ? h('a', { class: 'botao pequeno', href: `#/empresas/${r.empresaId}/sped`, onclick: (ev) => { ev.preventDefault(); window.spedAbrir(r); } }, 'Ver resultado')
            : r.sugestao ? h('a', { class: 'botao pequeno', href: `#/sped?cadastro=${r.sugestao.id}`, onclick: (ev) => { ev.preventDefault(); sp.foco = r.sugestao.id; spRender(); } }, 'Conferir cadastro') : null);
      } catch (e) {
        li.replaceChildren(h('span', { class: 'vg-simbolo problema', 'aria-hidden': 'true', text: '✕' }),
          h('div', { class: 'sp-envio-corpo' }, h('strong', { text: f.name }), h('span', { class: 'meta', text: e.message })));
      }
    }
    $('sp-enviar').disabled = false;
    $('sp-arquivos').value = '';
    spCarregar();
  }

  /**
   * Atalho da Visão Geral: um arquivo vai direto para a empresa dona do CNPJ, no mês e no tipo do arquivo
   * (ou para o pré-cadastro, se o CNPJ ainda não for cliente). Vários arquivos vão para a tela SPED.
   */
  async function spEnviarDaHome(arquivos) {
    const lista = [...arquivos].filter((f) => f.size);
    if (!lista.length || !pode('operar')) return;
    if (lista.length > 1) {
      irPara('#/sped');
      spEnviar(lista);
      return;
    }
    const f = lista[0];
    const botao = $('vg-enviar-sped');
    const rotulo = botao.querySelector('span');
    botao.disabled = true;
    rotulo.textContent = `Lendo ${f.name.length > 24 ? `${f.name.slice(0, 22)}…` : f.name}`;
    try {
      const r = await enviarArquivo(`/api/sped?nome=${encodeURIComponent(f.name)}`, f);
      if (!r.valido) {
        const erro = (r.ocorrencias || []).find((o) => o.nivel === 'erro');
        avisar(erro ? erro.mensagem : 'O arquivo não parece ser um SPED Fiscal, um SPED Contribuições nem um SINTEGRA.');
      } else if (r.empresaId) {
        window.spedAbrir(r);
      } else {
        avisar('CNPJ ainda não é cliente: confira o pré-cadastro.');
        irPara(r.sugestao ? `#/sped?cadastro=${r.sugestao.id}` : '#/sped');
      }
    } catch (e) {
      avisar(e.message);
    } finally {
      botao.disabled = false;
      rotulo.textContent = 'Enviar SPED ou SINTEGRA';
      $('vg-sped-arquivos').value = '';
    }
  }

  function spLigar() {
    $('vg-enviar-sped').addEventListener('click', () => $('vg-sped-arquivos').click());
    $('vg-sped-arquivos').addEventListener('change', (ev) => spEnviarDaHome(ev.target.files));
    const home = $('tela-visao');
    home.addEventListener('dragover', (ev) => { if (pode('operar') && ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) { ev.preventDefault(); home.classList.add('arrastando'); } });
    home.addEventListener('dragleave', (ev) => { if (ev.target === home) home.classList.remove('arrastando'); });
    home.addEventListener('drop', (ev) => { if (!ev.dataTransfer || !ev.dataTransfer.files.length) return; ev.preventDefault(); home.classList.remove('arrastando'); spEnviarDaHome(ev.dataTransfer.files); });
    $('sp-enviar').addEventListener('click', () => $('sp-arquivos').click());
    $('sp-arquivos').addEventListener('change', (ev) => spEnviar(ev.target.files));
    const tela = $('tela-sped');
    tela.addEventListener('dragover', (ev) => { ev.preventDefault(); tela.classList.add('arrastando'); });
    tela.addEventListener('dragleave', (ev) => { if (ev.target === tela) tela.classList.remove('arrastando'); });
    tela.addEventListener('drop', (ev) => { ev.preventDefault(); tela.classList.remove('arrastando'); if (pode('operar')) spEnviar(ev.dataTransfer.files); });
  }
  spLigar();
  window.spMostrar = spMostrar;
}
