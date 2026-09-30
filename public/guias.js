'use strict';
/*
 * Guias (#/guias e aba Guias da empresa): DAS do Simples Nacional e do MEI pelo Integra Contador
 * (API oficial da Receita, via SERPRO). Procuração de cada cliente, declaração do PGDAS-D e o DAS com PDF.
 * Usa os utilitários globais do app.js (h, $, chamar, icone, comOcupado, avisar, baixarArquivo...).
 * Regra: sem as chaves do SERPRO, nada é simulado; a tela mostra o que falta para ligar.
 */

/* ---------- funções puras (testadas em test/guias-tela.test.ts) ---------- */
const GU_REGIMES = ['simples', 'mei'];
const guData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const guMoeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Situação da procuração do cliente para o escritório (e-CAC). */
function guProcuracao(p) {
  if (!p) return { tom: 'neutro', simbolo: '–', texto: 'Não verificada' };
  if (p.situacao === 'ativa') return { tom: 'ok', simbolo: '✓', texto: p.expira_em ? `Ativa até ${guData(p.expira_em)}` : 'Ativa' };
  if (p.situacao === 'vencida') return { tom: 'pendente', simbolo: '!', texto: `Vencida${p.expira_em ? ` em ${guData(p.expira_em)}` : ''}` };
  if (p.situacao === 'ausente') return { tom: 'pendente', simbolo: '!', texto: 'Sem procuração' };
  return { tom: 'atencao', simbolo: '!', texto: 'Erro na consulta' };
}

/** Declaração do PGDAS-D da competência (só Simples Nacional). */
function guDeclaracao(d, regime) {
  if (regime !== 'simples') return { tom: 'neutro', simbolo: '–', texto: regime === 'mei' ? 'Não se aplica (MEI)' : '—' };
  if (!d) return { tom: 'neutro', simbolo: '–', texto: 'Não consultada' };
  if (d.situacao === 'transmitida') return { tom: 'ok', simbolo: '✓', texto: 'Transmitida' };
  return { tom: 'pendente', simbolo: '!', texto: 'Não transmitida' };
}

/** DAS da competência. `hoje` em AAAA-MM-DD. */
function guDas(g, regime, hoje) {
  if (!GU_REGIMES.includes(regime)) return { tom: 'neutro', simbolo: '–', texto: 'DCTFWeb · em breve' };
  if (!g) return { tom: 'neutro', simbolo: '–', texto: 'Não gerado' };
  const venc = g.vencimento ? String(g.vencimento).slice(0, 10) : null;
  if (venc && hoje && venc < hoje) return { tom: 'atencao', simbolo: '!', texto: `${guMoeda(g.total)} · venceu ${guData(venc)}` };
  return { tom: 'ok', simbolo: '✓', texto: `${guMoeda(g.total)}${venc ? ` · vence ${guData(venc)}` : ''}` };
}

/** Números da tela: só empresas do Simples e MEI (as que têm DAS nesta etapa). */
function guResumo(empresas) {
  const alvo = empresas.filter((e) => GU_REGIMES.includes(e.regime));
  const sit = (e) => (e.procuracao ? e.procuracao.situacao : null);
  return {
    total: alvo.length,
    procuracaoAtiva: alvo.filter((e) => sit(e) === 'ativa').length,
    semProcuracao: alvo.filter((e) => sit(e) === 'ausente' || sit(e) === 'vencida').length,
    naoVerificada: alvo.filter((e) => !sit(e)).length,
    comDas: alvo.filter((e) => e.guia).length,
    totalDas: Math.round(alvo.reduce((t, e) => t + (e.guia ? Number(e.guia.total) || 0 : 0), 0) * 100) / 100,
    outrosRegimes: empresas.length - alvo.length,
  };
}

/** Filtro da lista: grupo das (Simples+MEI, padrão) | simples | mei | sem_procuracao | sem_das | outros | todas; termo por nome ou CNPJ. */
function guFiltrar(empresas, f = {}) {
  const t = (f.termo || '').trim().toLowerCase();
  const td = t.replace(/\D/g, '');
  const grupo = f.grupo || 'das';
  return empresas.filter((e) => {
    const das = GU_REGIMES.includes(e.regime);
    const sit = e.procuracao ? e.procuracao.situacao : null;
    if (grupo === 'das' && !das) return false;
    if ((grupo === 'simples' || grupo === 'mei') && e.regime !== grupo) return false;
    if (grupo === 'sem_procuracao' && !(das && (sit === 'ausente' || sit === 'vencida' || !sit))) return false;
    if (grupo === 'sem_das' && !(das && !e.guia)) return false;
    if (grupo === 'outros' && das) return false;
    if (t && !(e.razao_social.toLowerCase().includes(t) || (td && e.cnpj.includes(td)))) return false;
    return true;
  });
}

if (typeof module !== 'undefined') module.exports = { guProcuracao, guDeclaracao, guDas, guResumo, guFiltrar };

/* ---------- telas ---------- */
if (typeof window !== 'undefined') {
  var gu = { dados: null, erro: null, filtro: { termo: '', grupo: 'das' }, selecionados: new Set(), confirmar: null, resultados: new Map(), empresa: null, confirmarDas: false };
  var guQuando = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const hoje = new Date(); const ontem = new Date(Date.now() - 86400000);
    if (d.toDateString() === hoje.toDateString()) return `Hoje, ${hora}`;
    if (d.toDateString() === ontem.toDateString()) return `Ontem, ${hora}`;
    return `${d.toLocaleDateString('pt-BR')} ${hora}`;
  };
  var guHoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  var GU_REGIME_TEXTO = { simples: 'Simples', mei: 'MEI', presumido: 'Presumido', real: 'Real' };

  function guCelula(info) {
    return h('span', { class: 'vg-celula', title: info.texto }, h('span', { class: `vg-simbolo ${info.tom}`, 'aria-hidden': 'true', text: info.simbolo }), h('span', { class: 'vg-celula-texto', text: info.texto }));
  }

  /** Estado do Integra Contador: o que falta para ligar ou a conexão (com teste). */
  function guIntegraCard(s, compacto) {
    const esc = s.escritorio;
    const certOk = !!(esc && esc.certificadoValidoAte && new Date(esc.certificadoValidoAte) > new Date());
    const passo = (feito, titulo, texto, acao) => h('li', { class: feito ? 'feito' : '' },
      h('span', { class: `vg-simbolo ${feito ? 'ok' : 'neutro'}`, 'aria-hidden': 'true', text: feito ? '✓' : '–' }),
      h('div', {}, h('strong', { text: titulo }), h('span', { class: 'meta', text: texto }), acao || null));
    const selo = !s.configurado ? { tom: 'neutro', texto: 'Não configurado' }
      : s.ambiente === 'trial' ? { tom: 'info', texto: 'Ambiente de teste do SERPRO' }
        : s.pronto ? { tom: 'ok', texto: 'Pronto' } : { tom: 'pendente', texto: 'Falta configurar' };
    const topo = h('div', { class: 'vg-card-topo' },
      h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Integra Contador (SERPRO)' }),
        h('p', { class: 'meta', text: 'API oficial da Receita Federal: o Appura consulta a procuração de cada cliente e gera o DAS em nome do escritório. O SERPRO cobra por chamada.' })),
      h('span', { class: `selo ${selo.tom}`, text: selo.texto }));
    if (compacto && s.pronto) return null;
    if (compacto) {
      return h('div', { class: 'e360-breve pequeno' }, icone('receipt'), h('div', {},
        h('strong', { text: s.configurado ? 'Integra Contador: falta configurar' : 'Integra Contador não configurado' }),
        h('p', { text: s.ambiente === 'trial' ? 'O Appura está no ambiente de teste do SERPRO (dados fictícios): nada é gerado para os clientes.' : (s.pendencias[0] || 'Faltam as chaves do SERPRO no servidor.') }),
        h('a', { class: 'botao pequeno', href: '#/guias' }, 'Ver o que falta')));
    }
    const passos = h('ol', { class: 'gu-passos' },
      passo(s.configurado, 'Contrato e chaves do SERPRO', s.configurado
        ? `Chaves configuradas no servidor${s.ambiente === 'trial' ? ' (ambiente de teste)' : ''}.`
        : 'Contratar o Integra Contador na loja do SERPRO e colocar a Consumer Key e a Consumer Secret nas variáveis do servidor (SERPRO_CONSUMER_KEY e SERPRO_CONSUMER_SECRET, no Easypanel). Nunca envie as chaves por chat ou e-mail.'),
      passo(certOk, 'e-CNPJ do escritório no Appura', esc
        ? (certOk ? `${esc.razao_social} · ${formatarCnpj(esc.cnpj)} · certificado válido até ${guData(esc.certificadoValidoAte)}.` : `${esc.razao_social}: ${esc.certificadoValidoAte ? 'certificado vencido' : 'sem certificado'}. Cadastre o mesmo e-CNPJ do contrato.`)
        : 'Cadastrar o escritório (CNPJ do contrato) com o certificado e-CNPJ.',
        !certOk && pode('certificados') && location.hash !== '#/escritorio' ? h('a', { class: 'botao pequeno gu-passo-acao', href: '#/escritorio' }, esc ? 'Trocar certificado do escritório' : 'Cadastrar escritório') : null),
      passo(false, 'Procuração de cada cliente', 'Cada cliente outorga procuração eletrônica ao CNPJ do escritório no e-CAC (serviços do Simples Nacional e do MEI). O Appura verifica e mostra quem falta.'));
    const conexao = s.configurado ? h('div', { class: 'gu-conexao' },
      h('span', { class: 'meta', text: `Chamadas ao SERPRO neste mês: ${Number(s.chamadasMes.total).toLocaleString('pt-BR')}${s.chamadasMes.comErro ? ` (${s.chamadasMes.comErro} com erro)` : ''}` }),
      pode('configuracoes') ? h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => guTestar(ev.currentTarget) }, icone('refresh-cw'), h('span', { text: 'Testar conexão' })) : null) : null;
    return h('section', { class: 'vg-card gu-integra' }, topo, passos, conexao);
  }

  async function guTestar(botao) {
    await comOcupado(botao, 'Testando…', async () => {
      const r = await chamar('/api/guias/testar', { method: 'POST' });
      avisar(r.mensagem, { tipo: r.ok ? 'ok' : 'erro' });
    }, 'gu-testar');
  }

  async function guBaixar(id, botao) {
    await comOcupado(botao, 'Baixando…', () => baixarArquivo(`/api/guias/${id}/pdf`, `DAS-${id}.pdf`), `gu-pdf-${id}`);
  }

  /* ----- tela #/guias ----- */
  function guMostrar() {
    for (const id of ['tela-visao', 'tela-fechamento', 'tela-empresas', 'tela-notas', 'tela-usuarios', 'tela-sped', 'tela-escritorio']) $(id).hidden = true;
    $('tela-guias').hidden = false;
    window.scrollTo(0, 0);
    gu.selecionados.clear(); gu.confirmar = null;
    guCarregar();
  }

  async function guCarregar() {
    const mes = competencia;
    if (!gu.dados || gu.dados.competencia !== mes) { gu.dados = null; guRender(); }
    try {
      const d = await chamar(`/api/guias?mes=${mes}`);
      if (mes !== competencia) return;
      gu.dados = d; gu.erro = null;
    } catch (e) { gu.erro = e.message; }
    guRender();
  }

  function guRender() {
    if ($('tela-guias').hidden) return;
    $('gu-subtitulo').textContent = `DAS do Simples Nacional e do MEI de ${textoCompetencia(competencia)}, pelo Integra Contador. DCTFWeb e DARF (Presumido e Real) vêm na próxima etapa.`;
    const alvo = $('gu-conteudo');
    if (gu.erro && !gu.dados) {
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar as guias.' }), h('span', { text: gu.erro }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: guCarregar }, icone('refresh-cw'), 'Tentar de novo')));
      return;
    }
    if (!gu.dados) { alvo.replaceChildren(h('div', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }), h('div', { class: 'vg-skel', 'aria-hidden': 'true' }))); return; }
    const d = gu.dados;
    const r = guResumo(d.empresas);
    const kpi = (ic, tom, valor, rotulo, meta) => h('div', { class: 'vg-kpi' }, h('span', { class: `vg-kpi-icone ${tom}` }, icone(ic)),
      h('div', { class: 'vg-kpi-corpo' }, h('span', { class: 'vg-kpi-valor', text: valor }), h('span', { class: 'vg-kpi-rotulo', text: rotulo }), h('span', { class: 'vg-kpi-meta', text: meta })));
    const n = (x) => Number(x).toLocaleString('pt-BR');
    const kpis = h('div', { class: 'vg-kpis gu-kpis' },
      kpi('building-2', 'info', n(r.total), 'Simples e MEI ativas', r.outrosRegimes ? `${n(r.outrosRegimes)} de outros regimes (DCTFWeb em breve)` : 'Todas as empresas ativas'),
      kpi('key-round', r.semProcuracao ? 'pendente' : 'ok', n(r.procuracaoAtiva), 'Procuração ativa', r.naoVerificada ? `${n(r.naoVerificada)} ainda não verificada${r.naoVerificada === 1 ? '' : 's'}` : `${n(r.semProcuracao)} sem procuração`),
      kpi('receipt', r.comDas ? 'ok' : 'neutro', n(r.comDas), 'DAS gerado', `de ${n(r.total)} · ${guMoeda(r.totalDas)}`));
    alvo.replaceChildren(...[guIntegraCard(d.integra, false), kpis, guLista(d)].filter(Boolean));
  }

  function guLista(d) {
    const lista = guFiltrar(d.empresas, gu.filtro);
    const pronto = d.integra.pronto && pode('operar');
    const podeSel = (e) => pronto && GU_REGIMES.includes(e.regime);
    for (const id of [...gu.selecionados]) if (!lista.some((e) => e.id === id && podeSel(e))) gu.selecionados.delete(id);
    const sel = [...gu.selecionados];
    const hoje = guHoje();
    const grupos = [['das', 'Simples e MEI'], ['sem_procuracao', 'Procuração pendente'], ['sem_das', 'Sem DAS'], ['outros', 'Outros regimes'], ['todas', 'Todas']];
    const barra = h('div', { class: 'gu-barra' },
      h('label', { class: 'vg-busca' }, icone('search'), h('span', { class: 'visualmente-oculto', text: 'Buscar empresa' }),
        h('input', { type: 'search', id: 'gu-busca', placeholder: 'Buscar por nome ou CNPJ', value: gu.filtro.termo, oninput: (ev) => { gu.filtro.termo = ev.target.value; guRenderLista(); } })),
      h('div', { class: 'sped-filtros', role: 'group', 'aria-label': 'Filtrar empresas' }, ...grupos.map(([k, t]) => h('button', {
        type: 'button', class: `vg-chip-f${gu.filtro.grupo === k ? ' ativo' : ''}`, 'aria-pressed': String(gu.filtro.grupo === k),
        onclick: () => { gu.filtro.grupo = k; guRender(); },
      }, t))));
    const acoes = pronto ? h('div', { class: 'gu-acoes' },
      h('span', { class: 'meta', text: sel.length ? `${sel.length} selecionada${sel.length === 1 ? '' : 's'}` : 'Selecione empresas para agir em lote' }),
      h('button', { type: 'button', class: 'botao pequeno', disabled: !sel.length, onclick: () => { gu.confirmar = { acao: 'procuracao', ids: sel }; guRender(); } }, icone('key-round'), `Verificar procuração${sel.length ? ` (${sel.length})` : ''}`),
      h('button', { type: 'button', class: 'botao pequeno primario', disabled: !sel.length, onclick: () => { gu.confirmar = { acao: 'das', ids: sel }; guRender(); } }, icone('receipt'), `Gerar DAS${sel.length ? ` (${sel.length})` : ''}`)) : null;
    const conf = gu.confirmar ? h('div', { class: 'sped-aviso gu-confirmar', role: 'alertdialog', 'aria-label': 'Confirmar ação em lote' }, icone('triangle-alert'),
      h('span', { text: `${gu.confirmar.acao === 'das' ? 'Gerar o DAS de' : 'Verificar a procuração de'} ${gu.confirmar.ids.length} empresa${gu.confirmar.ids.length === 1 ? '' : 's'}: são ${gu.confirmar.ids.length} chamada${gu.confirmar.ids.length === 1 ? '' : 's'} ao SERPRO, cobradas no contrato do escritório.${gu.confirmar.acao === 'das' ? ' Quem já tem DAS da competência dentro do vencimento fica de fora.' : ''}${gu.confirmar.ids.length > 100 ? ' Máximo de 100 por vez.' : ''}` }),
      h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => { gu.confirmar = null; guRender(); } }, 'Cancelar'),
      h('button', { type: 'button', class: 'botao pequeno primario', onclick: (ev) => guLote(ev.currentTarget) }, h('span', { text: 'Confirmar' }))) : null;
    const marcarTodos = h('input', { type: 'checkbox', 'aria-label': 'Selecionar todas as empresas da lista', checked: lista.filter(podeSel).length > 0 && lista.filter(podeSel).every((e) => gu.selecionados.has(e.id)),
      onchange: (ev) => { for (const e of lista.filter(podeSel)) { if (ev.target.checked) gu.selecionados.add(e.id); else gu.selecionados.delete(e.id); } guRender(); } });
    const marcar = (e) => (podeSel(e) ? h('label', { class: 'gu-sel' }, h('input', { type: 'checkbox', 'aria-label': `Selecionar ${e.razao_social}`, checked: gu.selecionados.has(e.id),
      onchange: (ev) => { if (ev.target.checked) gu.selecionados.add(e.id); else gu.selecionados.delete(e.id); guRender(); } })) : null);
    const resultado = (e) => { const x = gu.resultados.get(e.id); return x ? h('span', { class: `selo ${x.ok ? 'ok' : 'pendente'} gu-resultado`, title: x.mensagem, text: x.mensagem }) : null; };
    const abrir = (e) => h('a', { class: 'botao pequeno', href: `#/empresas/${e.id}/guias` }, 'Abrir');
    const vazio = h('div', { class: 'vg-vazio pequeno' }, h('strong', { text: d.empresas.length ? 'Nenhuma empresa com esses filtros.' : 'Nenhuma empresa ativa.' }));
    const tabela = h('div', { class: 'vg-tabela-caixa gu-tabela-caixa' }, h('table', { class: 'vg-tabela gu-tabela' },
      h('thead', {}, h('tr', {}, pronto ? h('th', { scope: 'col', class: 'gu-marcar' }, marcarTodos) : null,
        ...['Empresa', 'Regime', 'Procuração', 'Declaração PGDAS-D', `DAS ${textoCompetencia(competencia)}`, ''].map((t) => h('th', { scope: 'col', text: t })))),
      h('tbody', {}, ...lista.map((e) => h('tr', {},
        pronto ? h('td', { class: 'gu-marcar' }, marcar(e)) : null,
        h('td', { class: 'vg-emp' }, h('div', { class: 'gu-emp' }, h('a', { href: `#/empresas/${e.id}/guias`, text: e.razao_social }), h('span', { class: 'meta mono', text: formatarCnpj(e.cnpj) }))),
        h('td', { text: GU_REGIME_TEXTO[e.regime] || 'Não informado' }),
        h('td', {}, guCelula(guProcuracao(e.procuracao))),
        h('td', {}, guCelula(guDeclaracao(e.declaracao, e.regime))),
        h('td', {}, guCelula(guDas(e.guia, e.regime, hoje)), resultado(e)),
        h('td', { class: 'vg-acoes' }, abrir(e)))))));
    const cartoes = h('ul', { class: 'fc-cartoes gu-cartoes' }, ...lista.map((e) => h('li', { class: 'fc-cartao' },
      h('div', { class: 'fc-cartao-topo' },
        h('div', { class: 'fc-cartao-id' }, h('strong', { text: e.razao_social }), h('span', { class: 'fc-cartao-sub' }, h('span', { class: 'mono', text: formatarCnpj(e.cnpj) }), ` · ${GU_REGIME_TEXTO[e.regime] || 'Regime não informado'}`)),
        marcar(e)),
      h('ul', { class: 'fc-cartao-pend' },
        h('li', {}, h('span', { class: 'meta gu-rotulo', text: 'Procuração' }), guCelula(guProcuracao(e.procuracao))),
        e.regime === 'simples' ? h('li', {}, h('span', { class: 'meta gu-rotulo', text: 'PGDAS-D' }), guCelula(guDeclaracao(e.declaracao, e.regime))) : null,
        h('li', {}, h('span', { class: 'meta gu-rotulo', text: 'DAS' }), guCelula(guDas(e.guia, e.regime, hoje)))),
      resultado(e),
      h('div', { class: 'fc-cartao-rodape' }, h('span'), abrir(e)))));
    return h('section', { class: 'vg-card gu-lista', 'aria-labelledby': 'gu-lista-titulo' },
      h('div', { class: 'vg-card-topo' }, h('h2', { id: 'gu-lista-titulo', class: 'vg-card-titulo', text: 'Empresas' }), h('span', { class: 'meta', id: 'gu-contagem', text: `${lista.length} de ${d.empresas.length}` })),
      barra, acoes, conf, h('div', { id: 'gu-lista-corpo' }, ...(lista.length ? [tabela, cartoes] : [vazio])));
  }

  /** Busca digitada: redesenha só a lista, sem perder o foco do campo. */
  function guRenderLista() {
    const campo = $('gu-busca');
    const pos = campo ? campo.selectionStart : null;
    guRender();
    const novo = $('gu-busca');
    if (novo) { novo.focus(); if (pos !== null) novo.setSelectionRange(pos, pos); }
  }

  async function guLote(botao) {
    const { acao, ids } = gu.confirmar;
    await comOcupado(botao, acao === 'das' ? 'Gerando…' : 'Verificando…', async () => {
      const r = await chamar('/api/guias/lote', { method: 'POST', body: { acao, ids, mes: competencia } });
      for (const x of r.resultados) gu.resultados.set(x.id, x);
      const okN = r.resultados.filter((x) => x.ok).length;
      gu.confirmar = null; gu.selecionados.clear();
      avisar(`${okN} de ${r.resultados.length} ${acao === 'das' ? 'DAS gerado' : 'procuração ativa'}${okN === 1 ? '' : 's'}.${r.resultados.length < ids.length ? ' O lote parou: veja a mensagem na lista.' : ''}`, { tipo: okN ? 'ok' : 'info' });
      await guCarregar();
    }, 'gu-lote');
  }

  /* ----- aba Guias da empresa ----- */
  async function guEmpresaCarregar() {
    if (!empresaNotas) return;
    const id = empresaNotas.id; const mes = mesSelecionado();
    const alvo = $('gu-empresa');
    if (!gu.empresa || gu.empresa.id !== id || gu.empresa.mes !== mes) {
      gu.empresa = { id, mes, dados: null }; gu.confirmarDas = false;
      alvo.replaceChildren(h('div', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }), h('div', { class: 'vg-skel', 'aria-hidden': 'true' }), h('div', { class: 'vg-skel', 'aria-hidden': 'true' })));
    }
    try {
      const d = await chamar(`/api/empresas/${id}/guias?mes=${mes}`);
      if (!empresaNotas || empresaNotas.id !== id || mesSelecionado() !== mes) return;
      gu.empresa = { id, mes, dados: d };
    } catch (e) {
      if (!empresaNotas || empresaNotas.id !== id) return;
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar as guias.' }), h('span', { text: e.message }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: guEmpresaCarregar }, icone('refresh-cw'), 'Tentar de novo')));
      return;
    }
    guEmpresaRender();
  }

  function guEmpresaRender() {
    const alvo = $('gu-empresa');
    const est = gu.empresa;
    if (!est || !est.dados || !empresaNotas || est.id !== empresaNotas.id) return;
    const d = est.dados; const e = empresaNotas; const mes = est.mes;
    const regime = e.regime;
    if (!GU_REGIMES.includes(regime)) {
      alvo.replaceChildren(h('div', { class: 'e360-breve' }, icone('receipt'), h('div', {},
        h('strong', { text: regime ? 'DCTFWeb e DARF · Em breve' : 'Regime não informado' }),
        h('p', { text: regime
          ? 'Para Lucro Presumido e Real, as guias federais saem da DCTFWeb. Esta etapa do Integra Contador gera o DAS do Simples Nacional e do MEI; a DCTFWeb entra na próxima.'
          : 'O Appura precisa saber se a empresa é do Simples Nacional ou MEI para gerar o DAS. Informe o regime no cadastro da empresa.' }))));
      return;
    }
    const pronto = d.integra.pronto; const podeAgir = pronto && pode('operar');
    const hoje = guHoje();
    const guiaMes = (d.guias || []).find((g) => String(g.competencia).slice(0, 7) === mes) || null;
    const p = d.procuracao; const pi = guProcuracao(p);
    const semProc = !!p && (p.situacao === 'ausente' || p.situacao === 'vencida');
    const DURANTE = { 'Verificar procuração': 'Verificando…', 'Consultar declaração': 'Consultando…', 'Gerar DAS': 'Gerando…' };
    const acaoBotao = (texto, ic, fn, primario, chave) => (podeAgir ? h('button', { type: 'button', class: `botao pequeno${primario ? ' primario' : ''}`, onclick: (ev) => comOcupado(ev.currentTarget, DURANTE[texto], fn, chave) }, icone(ic), h('span', { text: texto })) : null);
    const cardProc = h('section', { class: 'vg-card' },
      h('div', { class: 'e360-card-topo' }, h('span', { class: `vg-kpi-icone ${pi.tom === 'ok' ? 'ok' : pi.tom === 'neutro' ? 'info' : 'pendente'}` }, icone('key-round')), h('h3', { text: 'Procuração no e-CAC' })),
      h('div', { class: 'e360-card-valor' }, h('strong', { text: pi.texto }), h('span', { text: `${formatarCnpj(e.cnpj)} → escritório` })),
      h('ul', { class: 'e360-lista-num' },
        h('li', {}, h('span', { text: 'Serviços' }), h('strong', { text: p && p.sistemas && p.sistemas.length ? p.sistemas.join(', ') : '—' })),
        h('li', {}, h('span', { text: 'Verificada' }), h('strong', { text: p ? `${guQuando(p.verificado_em)} · ${p.verificado_por}` : 'Ainda não' }))),
      p && p.situacao !== 'ativa' && p.mensagem ? h('p', { class: 'meta', text: p.mensagem }) : null,
      p && (p.situacao === 'ausente' || p.situacao === 'vencida') ? h('p', { class: 'meta', text: 'O cliente (ou o contador com o certificado dele) outorga no e-CAC: Senhas e Procurações › Cadastro de procuração, para o CNPJ do escritório, com os serviços do Simples Nacional/MEI.' }) : null,
      h('div', { class: 'gu-botoes' }, acaoBotao('Verificar procuração', 'refresh-cw', async () => {
        await chamar(`/api/empresas/${e.id}/guias/procuracao`, { method: 'POST', body: {} });
        avisar('Procuração verificada no SERPRO.', { tipo: 'ok' });
        await guEmpresaCarregar(); window.e360Chave = null; window.e360Carregar();
      }, false, `gu-proc-${e.id}`)));
    const decl = d.declaracao; const di = guDeclaracao(decl, regime);
    const cardDecl = regime === 'simples' ? h('section', { class: 'vg-card' },
      h('div', { class: 'e360-card-topo' }, h('span', { class: `vg-kpi-icone ${di.tom === 'ok' ? 'ok' : di.tom === 'neutro' ? 'info' : 'pendente'}` }, icone('file-check')), h('h3', { text: `Declaração PGDAS-D · ${textoCompetencia(mes)}` })),
      h('div', { class: 'e360-card-valor' }, h('strong', { text: di.texto }), h('span', { text: decl && decl.numero ? `Nº ${decl.numero}` : 'Última declaração transmitida do período' })),
      h('ul', { class: 'e360-lista-num' }, h('li', {}, h('span', { text: 'Consultada' }), h('strong', { text: decl ? `${guQuando(decl.consultado_em)} · ${decl.consultado_por}` : 'Ainda não' }))),
      decl && decl.situacao !== 'transmitida' && decl.mensagem ? h('p', { class: 'meta', text: decl.mensagem }) : null,
      h('p', { class: 'meta', text: 'O DAS do Simples só sai depois que a declaração do mês é transmitida.' }),
      h('div', { class: 'gu-botoes' }, acaoBotao('Consultar declaração', 'refresh-cw', async () => {
        await chamar(`/api/empresas/${e.id}/guias/declaracao`, { method: 'POST', body: { mes } });
        avisar('Declaração consultada no SERPRO.', { tipo: 'ok' });
        await guEmpresaCarregar();
      }, false, `gu-decl-${e.id}`)))
      : h('section', { class: 'vg-card' },
        h('div', { class: 'e360-card-topo' }, h('span', { class: 'vg-kpi-icone info' }, icone('file-check')), h('h3', { text: 'MEI' })),
        h('div', { class: 'e360-card-valor' }, h('strong', { text: 'DAS mensal (PGMEI)' }), h('span', { text: 'Valor fixo do MEI, sem declaração mensal' })),
        h('p', { class: 'meta', text: 'A declaração anual do MEI (DASN-SIMEI) não faz parte desta etapa.' }));
    const gerar = async (forcar) => {
      const r = await chamar(`/api/empresas/${e.id}/guias/das`, { method: 'POST', body: { mes, forcar } });
      gu.confirmarDas = false;
      avisar(`DAS gerado${r.avisos && r.avisos.length ? `: ${r.avisos[0]}` : '.'}`, { tipo: 'ok' });
      await guEmpresaCarregar(); window.e360Chave = null; window.e360Carregar();
    };
    const di2 = guDas(guiaMes, regime, hoje);
    const cardDas = h('section', { class: 'vg-card' },
      h('div', { class: 'e360-card-topo' }, h('span', { class: `vg-kpi-icone ${guiaMes ? (di2.tom === 'ok' ? 'ok' : 'pendente') : 'info'}` }, icone('receipt')), h('h3', { text: `${regime === 'mei' ? 'DAS do MEI' : 'DAS do Simples'} · ${textoCompetencia(mes)}` })),
      guiaMes ? h('div', { class: 'e360-card-valor' }, h('strong', { text: guMoeda(guiaMes.total) }), h('span', { text: guiaMes.vencimento ? `${String(guiaMes.vencimento).slice(0, 10) < hoje ? 'venceu' : 'vence'} em ${guData(guiaMes.vencimento)}` : 'sem vencimento informado' }))
        : h('div', { class: 'e360-card-valor' }, h('strong', { text: 'Não gerado' }), h('span', { text: `Nenhum DAS de ${textoCompetencia(mes)} gerado pelo Appura.` })),
      guiaMes ? h('ul', { class: 'e360-lista-num' },
        h('li', {}, h('span', { text: 'Principal' }), h('strong', { text: guMoeda(guiaMes.principal) })),
        Number(guiaMes.multa) || Number(guiaMes.juros) ? h('li', {}, h('span', { text: 'Multa / juros' }), h('strong', { text: `${guMoeda(guiaMes.multa)} / ${guMoeda(guiaMes.juros)}` })) : null,
        guiaMes.numero_documento ? h('li', {}, h('span', { text: 'Nº do documento' }), h('strong', { class: 'mono', text: guiaMes.numero_documento })) : null,
        h('li', {}, h('span', { text: 'Gerado' }), h('strong', { text: `${guQuando(guiaMes.gerado_em)} · ${guiaMes.gerado_por}` }))) : null,
      guiaMes && Array.isArray(guiaMes.composicao) && guiaMes.composicao.length ? h('details', { class: 'gu-composicao' }, h('summary', { text: 'Composição por tributo' }),
        h('ul', { class: 'e360-lista-num' }, ...guiaMes.composicao.map((c) => h('li', {}, h('span', { text: c.denominacao || c.codigo }), h('strong', { text: guMoeda(c.total) }))))) : null,
      h('div', { class: 'gu-botoes' },
        guiaMes && guiaMes.caminho ? h('button', { type: 'button', class: 'botao pequeno primario', onclick: (ev) => guBaixar(guiaMes.id, ev.currentTarget) }, icone('file-text'), h('span', { text: 'Baixar PDF' })) : null,
        !guiaMes && semProc ? h('p', { class: 'meta', text: 'Para gerar o DAS, o cliente precisa de procuração ativa para o escritório no e-CAC.' })
          : !guiaMes ? acaoBotao('Gerar DAS', 'receipt', () => gerar(false), true, `gu-das-${e.id}`)
          : podeAgir && !gu.confirmarDas ? h('button', { type: 'button', class: 'botao pequeno', onclick: () => { gu.confirmarDas = true; guEmpresaRender(); } }, icone('refresh-cw'), 'Gerar de novo') : null),
      gu.confirmarDas ? h('div', { class: 'sped-aviso gu-confirmar', role: 'alertdialog', 'aria-label': 'Confirmar nova geração do DAS' }, icone('triangle-alert'),
        h('span', { text: 'Gerar de novo faz outra chamada cobrada pelo SERPRO. Use quando o vencimento passou ou a declaração foi retificada.' }),
        h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => { gu.confirmarDas = false; guEmpresaRender(); } }, 'Cancelar'),
        h('button', { type: 'button', class: 'botao pequeno primario', onclick: (ev) => comOcupado(ev.currentTarget, 'Gerando…', () => gerar(true), `gu-das-${e.id}`) }, h('span', { text: 'Gerar de novo' }))) : null);
    const outras = (d.guias || []).filter((g) => g !== guiaMes);
    const historico = outras.length ? h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Guias geradas' }), h('span', { class: 'meta', text: 'PDFs guardados criptografados' })),
      h('ul', { class: 'sped-envios' }, ...outras.map((g) => h('li', {},
        h('span', { class: 'selo neutro', text: textoCompetencia(String(g.competencia).slice(0, 7)) }),
        h('strong', { text: `${guMoeda(g.total)}${g.vencimento ? ` · vence ${guData(g.vencimento)}` : ''}` }),
        h('span', { class: 'meta', text: `${guQuando(g.gerado_em)} · ${g.gerado_por}${g.numero_documento ? ` · nº ${g.numero_documento}` : ''}` }),
        g.caminho ? h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => guBaixar(g.id, ev.currentTarget) }, h('span', { text: 'Baixar' })) : null)))) : null;
    const semPermissao = pronto && !pode('operar') ? h('p', { class: 'meta', text: 'Seu perfil só consulta: peça a um analista para verificar procurações e gerar guias.' }) : null;
    alvo.replaceChildren(...[guIntegraCard(d.integra, true), semPermissao, h('div', { class: 'sped-cards' }, cardProc, cardDecl, cardDas), historico].filter(Boolean));
  }

  /* ----- Administração › Escritório (#/escritorio) ----- */
  var es = { dados: null, erro: null };
  function esMostrar() {
    for (const id of ['tela-visao', 'tela-fechamento', 'tela-empresas', 'tela-notas', 'tela-usuarios', 'tela-sped', 'tela-guias']) $(id).hidden = true;
    $('tela-escritorio').hidden = false;
    window.scrollTo(0, 0);
    esCarregar();
  }

  async function esCarregar() {
    try { es.dados = await chamar('/api/guias/situacao'); es.erro = null; } catch (e) { es.erro = e.message; }
    esRender();
  }

  function esRender() {
    if ($('tela-escritorio').hidden) return;
    const alvo = $('es-conteudo');
    if (es.erro && !es.dados) {
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar os dados do escritório.' }), h('span', { text: es.erro }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: esCarregar }, icone('refresh-cw'), 'Tentar de novo')));
      return;
    }
    if (!es.dados) { alvo.replaceChildren(h('div', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }), h('div', { class: 'vg-skel', 'aria-hidden': 'true' }))); return; }
    const s = es.dados; const esc = s.escritorio;
    const usos = h('ul', { class: 'gu-passos' },
      h('li', {}, h('span', { class: 'vg-simbolo info', 'aria-hidden': 'true', text: '1' }), h('div', {}, h('strong', { text: 'Integra Contador (SERPRO)' }),
        h('span', { class: 'meta', text: 'O certificado autentica o Appura no SERPRO junto com a Consumer Key e a Consumer Secret. Precisa ser o mesmo e-CNPJ do contrato.' }))),
      h('li', {}, h('span', { class: 'vg-simbolo info', 'aria-hidden': 'true', text: '2' }), h('div', {}, h('strong', { text: 'Notas dos clientes pelo escritório' }),
        h('span', { class: 'meta', text: 'O Appura consulta a SEFAZ com o CNPJ do escritório e distribui para cada cliente as notas em que o escritório aparece como autorizado a baixar o XML (autXML).' }))));
    let card;
    if (!esc) {
      card = h('section', { class: 'vg-card' },
        h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Escritório' }), h('span', { class: 'selo neutro', text: 'Não cadastrado' })),
        h('div', { class: 'vg-vazio pequeno' }, h('strong', { text: 'Nenhum escritório cadastrado ainda.' }),
          h('span', { text: 'Cadastre o CNPJ do escritório com o certificado e-CNPJ (A1, arquivo .pfx ou .p12) e a senha. Tudo é criptografado no servidor.' })),
        h('p', { class: 'meta', text: 'Para que serve:' }), usos,
        h('div', { class: 'gu-botoes' }, h('button', { type: 'button', class: 'botao primario', onclick: () => abrirGaveta(null, 'escritorio') }, icone('key-round'), 'Cadastrar escritório')));
    } else {
      const venc = esc.certificadoValidoAte ? new Date(esc.certificadoValidoAte) : null;
      const dias = venc ? Math.floor((venc.getTime() - Date.now()) / 86400000) : null;
      const selo = !venc ? { tom: 'problema', texto: 'Sem certificado' } : dias < 0 ? { tom: 'problema', texto: 'Certificado vencido' } : dias <= 30 ? { tom: 'pendente', texto: `Vence em ${dias} dia${dias === 1 ? '' : 's'}` } : { tom: 'ok', texto: 'Certificado válido' };
      const empresa = (typeof empresas !== 'undefined' ? empresas : []).find((x) => x.id === esc.id) || { id: esc.id, razao_social: esc.razao_social, cnpj: esc.cnpj, uf: esc.uf, escritorio: true };
      card = h('section', { class: 'vg-card' },
        h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Escritório' }), h('span', { class: `selo ${selo.tom}`, text: selo.texto })),
        h('div', { class: 'e360-card-valor' }, h('strong', { text: esc.razao_social }), h('span', { class: 'mono', text: formatarCnpj(esc.cnpj) })),
        h('ul', { class: 'e360-lista-num' },
          h('li', {}, h('span', { text: 'UF' }), h('strong', { text: esc.uf || '—' })),
          h('li', {}, h('span', { text: 'Titular do certificado' }), h('strong', { text: esc.titular || '—' })),
          h('li', {}, h('span', { text: 'Certificado válido até' }), h('strong', { text: venc ? venc.toLocaleDateString('pt-BR') : '—' }))),
        esc.outros && esc.outros.length ? h('div', { class: 'sped-aviso' }, icone('triangle-alert'),
          h('span', { text: `Também marcada${esc.outros.length === 1 ? '' : 's'} como escritório: ${esc.outros.join(', ')}. O Integra Contador usa ${esc.razao_social}.` })) : null,
        h('p', { class: 'meta', text: 'Para que serve:' }), usos,
        h('div', { class: 'gu-botoes' },
          h('button', { type: 'button', class: 'botao primario', onclick: () => abrirGaveta(empresa, 'escritorio') }, icone('key-round'), 'Trocar certificado'),
          h('a', { class: 'botao', href: `#/empresas/${esc.id}` }, 'Abrir empresa')));
    }
    alvo.replaceChildren(card, guIntegraCard(s, false));
  }

  window.esMostrar = esMostrar;
  window.esCarregar = esCarregar;
  window.addEventListener('appura:competencia', () => { if (!$('tela-guias').hidden) { gu.selecionados.clear(); gu.confirmar = null; guCarregar(); } });
  window.guMostrar = guMostrar;
  window.guEmpresaCarregar = guEmpresaCarregar;
  window.guBaixar = guBaixar;
}
