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

/** Envio da guia ao Sistema Acessórias. `configurada`: a integração tem token. */
function guEnvio(envio, configurada) {
  if (!envio) return configurada ? { tom: 'neutro', simbolo: '–', texto: 'Não enviada à Acessórias' } : null;
  if (envio.status === 'enviado') return { tom: 'ok', simbolo: '✓', texto: 'Enviada à Acessórias' };
  return { tom: 'pendente', simbolo: '!', texto: 'Erro no envio à Acessórias' };
}

/** Guias vigentes da lista ainda não aceitas pela Acessórias (com PDF). */
function guPendentesEnvio(empresas) {
  return empresas.filter((e) => e.guia && e.guia.id && (!e.guia.envio || e.guia.envio.status !== 'enviado'));
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

if (typeof module !== 'undefined') module.exports = { guProcuracao, guDeclaracao, guDas, guEnvio, guPendentesEnvio, guResumo, guFiltrar };

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
        ? `Chaves cadastradas${s.chaves && s.chaves.origem === 'servidor' ? ' nas variáveis do servidor' : ' no Appura'}${s.ambiente === 'trial' ? ' (ambiente de teste do SERPRO)' : ''}.`
        : 'Contratar o Integra Contador na loja do SERPRO e cadastrar a Consumer Key e a Consumer Secret em Administração › Escritório. Nunca envie as chaves por chat ou e-mail.',
        !s.configurado && pode('configuracoes') && location.hash !== '#/escritorio' ? h('a', { class: 'botao pequeno gu-passo-acao', href: '#/escritorio' }, 'Cadastrar chaves') : null),
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
    for (const id of ['tela-visao', 'tela-fechamento', 'tela-empresas', 'tela-notas', 'tela-usuarios', 'tela-sped', 'tela-escritorio', 'tela-ia', 'tela-xml']) $(id).hidden = true;
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
    const ac = d.acessorias && d.acessorias.configurado;
    const pendEnvio = ac ? guPendentesEnvio(lista) : [];
    const acoes = pronto ? h('div', { class: 'gu-acoes' },
      h('span', { class: 'meta', text: sel.length ? `${sel.length} selecionada${sel.length === 1 ? '' : 's'}` : 'Selecione empresas para agir em lote' }),
      h('button', { type: 'button', class: 'botao pequeno', disabled: !sel.length, onclick: () => { gu.confirmar = { acao: 'procuracao', ids: sel }; guRender(); } }, icone('key-round'), `Verificar procuração${sel.length ? ` (${sel.length})` : ''}`),
      h('button', { type: 'button', class: 'botao pequeno primario', disabled: !sel.length, onclick: () => { gu.confirmar = { acao: 'das', ids: sel }; guRender(); } }, icone('receipt'), `Gerar DAS${sel.length ? ` (${sel.length})` : ''}`),
      ac ? h('button', { type: 'button', class: 'botao pequeno', disabled: !pendEnvio.length, title: 'Envia o PDF das guias desta lista que ainda não foram aceitas pela Acessórias', onclick: () => { gu.confirmar = { acao: 'enviar', ids: pendEnvio.map((e) => e.id) }; guRender(); } }, icone('arrow-right'), `Enviar à Acessórias${pendEnvio.length ? ` (${pendEnvio.length})` : ''}`) : null) : null;
    const conf = gu.confirmar ? h('div', { class: 'sped-aviso gu-confirmar', role: 'alertdialog', 'aria-label': 'Confirmar ação em lote' }, icone('triangle-alert'),
      h('span', { text: gu.confirmar.acao === 'enviar'
        ? `Enviar à Acessórias o PDF de ${gu.confirmar.ids.length} guia${gu.confirmar.ids.length === 1 ? '' : 's'} (a mais recente de cada empresa). O que já foi aceito não é enviado de novo.`
        : `${gu.confirmar.acao === 'das' ? 'Gerar o DAS de' : 'Verificar a procuração de'} ${gu.confirmar.ids.length} empresa${gu.confirmar.ids.length === 1 ? '' : 's'}: são ${gu.confirmar.ids.length} chamada${gu.confirmar.ids.length === 1 ? '' : 's'} ao SERPRO, cobradas no contrato do escritório.${gu.confirmar.acao === 'das' ? ' Quem já tem DAS da competência dentro do vencimento fica de fora.' : ''}${gu.confirmar.ids.length > 100 ? ' Máximo de 100 por vez.' : ''}` }),
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
        h('td', {}, guCelula(guDas(e.guia, e.regime, hoje)), e.guia && guEnvio(e.guia.envio, ac) ? h('div', { class: 'gu-envio' }, guCelula(guEnvio(e.guia.envio, ac))) : null, resultado(e)),
        h('td', { class: 'vg-acoes' }, abrir(e)))))));
    const cartoes = h('ul', { class: 'fc-cartoes gu-cartoes' }, ...lista.map((e) => h('li', { class: 'fc-cartao' },
      h('div', { class: 'fc-cartao-topo' },
        h('div', { class: 'fc-cartao-id' }, h('strong', { text: e.razao_social }), h('span', { class: 'fc-cartao-sub' }, h('span', { class: 'mono', text: formatarCnpj(e.cnpj) }), ` · ${GU_REGIME_TEXTO[e.regime] || 'Regime não informado'}`)),
        marcar(e)),
      h('ul', { class: 'fc-cartao-pend' },
        h('li', {}, h('span', { class: 'meta gu-rotulo', text: 'Procuração' }), guCelula(guProcuracao(e.procuracao))),
        e.regime === 'simples' ? h('li', {}, h('span', { class: 'meta gu-rotulo', text: 'PGDAS-D' }), guCelula(guDeclaracao(e.declaracao, e.regime))) : null,
        h('li', {}, h('span', { class: 'meta gu-rotulo', text: 'DAS' }), guCelula(guDas(e.guia, e.regime, hoje))),
        e.guia && guEnvio(e.guia.envio, ac) ? h('li', {}, h('span', { class: 'meta gu-rotulo', text: 'Acessórias' }), guCelula(guEnvio(e.guia.envio, ac))) : null),
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
    if (acao === 'enviar') {
      await comOcupado(botao, 'Enviando…', async () => {
        const r = await chamar('/api/guias/enviar-pendentes', { method: 'POST', body: { mes: competencia, ids } });
        const okN = r.resultados.filter((x) => x.ok).length;
        gu.confirmar = null;
        avisar(`${okN} de ${r.resultados.length} guia${r.resultados.length === 1 ? '' : 's'} aceita${okN === 1 ? '' : 's'} pela Acessórias.${okN < r.resultados.length ? ' Veja os erros na aba Guias de cada empresa.' : ''}`, { tipo: okN === r.resultados.length ? 'ok' : 'erro' });
        await guCarregar();
      }, 'gu-enviar');
      return;
    }
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
      guiaMes ? guLinhaEnvio(guiaMes, d.acessorias) : null,
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
        h('span', { class: 'meta', text: `${guQuando(g.gerado_em)} · ${g.gerado_por}${g.numero_documento ? ` · nº ${g.numero_documento}` : ''}${g.envio ? ` · ${g.envio.status === 'enviado' ? 'enviada à Acessórias' : 'erro no envio à Acessórias'}` : ''}` }),
        g.caminho ? h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => guBaixar(g.id, ev.currentTarget) }, h('span', { text: 'Baixar' })) : null)))) : null;
    const semPermissao = pronto && !pode('operar') ? h('p', { class: 'meta', text: 'Seu perfil só consulta: peça a um analista para verificar procurações e gerar guias.' }) : null;
    alvo.replaceChildren(...[guIntegraCard(d.integra, true), semPermissao, h('div', { class: 'sped-cards' }, cardProc, cardDecl, cardDas), historico].filter(Boolean));
  }

  /** Situação do envio à Acessórias de uma guia, com Enviar/Reenviar. */
  function guLinhaEnvio(g, ac) {
    const configurada = ac && ac.configurado;
    const info = guEnvio(g.envio, configurada);
    if (!info) return null;
    const podeEnviar = configurada && pode('operar') && g.caminho;
    const enviar = (forcar) => async () => {
      const r = await chamar(`/api/guias/${g.id}/enviar`, { method: 'POST', body: { forcar } });
      avisar(r.status === 'enviado' ? 'Guia aceita pela Acessórias.' : `A Acessórias não aceitou: ${r.mensagem}`, { tipo: r.status === 'enviado' ? 'ok' : 'erro' });
      await guEmpresaCarregar();
    };
    const e = g.envio;
    return h('div', { class: 'gu-envio-caixa' },
      guCelula(info),
      e ? h('span', { class: 'meta', text: `${guQuando(e.enviado_em)} · ${e.enviado_por}${e.status === 'enviado' && e.caminho_destino ? ` · ${e.caminho_destino}` : ''}` }) : null,
      e && e.status === 'erro' ? h('p', { class: 'meta gu-envio-erro', text: e.mensagem }) : null,
      e && e.status === 'erro' && /inexistente/i.test(e.mensagem || '') ? h('p', { class: 'meta', text: 'A Acessórias só aceita a guia quando a obrigação (entrega) desta competência existe para a empresa lá. Confira a obrigação do DAS no cadastro da empresa na Acessórias e reenvie.' }) : null,
      podeEnviar ? h('div', { class: 'gu-botoes' }, !e
        ? h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Enviando…', enviar(false), `gu-env-${g.id}`) }, icone('arrow-right'), h('span', { text: 'Enviar à Acessórias' }))
        : h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Enviando…', enviar(true), `gu-env-${g.id}`) }, icone('refresh-cw'), h('span', { text: e.status === 'enviado' ? 'Enviar de novo' : 'Reenviar' }))) : null);
  }

  /* ----- Administração › Escritório (#/escritorio) ----- */
  var es = { dados: null, acessorias: null, erro: null, editandoChaves: false, confirmarRemover: false, editandoAcessorias: false, confirmarRemoverAc: false };
  function esMostrar() {
    for (const id of ['tela-visao', 'tela-fechamento', 'tela-empresas', 'tela-notas', 'tela-usuarios', 'tela-sped', 'tela-guias', 'tela-ia', 'tela-xml']) $(id).hidden = true;
    $('tela-escritorio').hidden = false;
    window.scrollTo(0, 0);
    esCarregar();
  }

  async function esCarregar() {
    try {
      const [sit, ac] = await Promise.all([chamar('/api/guias/situacao'), chamar('/api/acessorias')]);
      es.dados = sit; es.acessorias = ac; es.erro = null;
    } catch (e) { es.erro = e.message; }
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
          h('li', {}, h('span', { text: 'Certificado válido até' }), h('strong', { text: venc ? guData(esc.certificadoValidoAte) : '—' }))),
        esc.outros && esc.outros.length ? h('div', { class: 'sped-aviso' }, icone('triangle-alert'),
          h('span', { text: `Também marcada${esc.outros.length === 1 ? '' : 's'} como escritório: ${esc.outros.join(', ')}. O Integra Contador usa ${esc.razao_social}.` })) : null,
        h('p', { class: 'meta', text: 'Para que serve:' }), usos,
        h('div', { class: 'gu-botoes' },
          h('button', { type: 'button', class: 'botao primario', onclick: () => abrirGaveta(empresa, 'escritorio') }, icone('key-round'), 'Trocar certificado'),
          h('a', { class: 'botao', href: `#/empresas/${esc.id}` }, 'Abrir empresa')));
    }
    const ae = es.acessorias && es.acessorias.configurado ? h('div', { id: 'ae-conteudo', class: 'pilha', 'aria-live': 'polite' }) : null;
    alvo.replaceChildren(card, esCardChaves(s), guIntegraCard(s, false), esCardAcessorias(es.acessorias), ...(ae ? [ae] : []));
    if (ae && window.aeCarregar) window.aeCarregar();
  }

  /** Sistema Acessórias: API Token (cifrado) e envio automático das guias pelo e-Contínuo. */
  function esCardAcessorias(a) {
    if (!a) return null;
    const podeEditar = pode('configuracoes');
    const aberto = es.editandoAcessorias || (!a.configurado && podeEditar);
    const topo = h('div', { class: 'vg-card-topo' },
      h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Sistema Acessórias' }),
        h('p', { class: 'meta', text: 'As guias em PDF vão para a Acessórias pelo e-Contínuo: ela lê CNPJ, competência, vencimento e valor do PDF e baixa a entrega da obrigação da empresa.' })),
      h('span', { class: `selo ${a.configurado ? 'ok' : 'neutro'}`, text: a.configurado ? 'Conectado' : 'Não configurado' }));
    const partes = [topo];
    if (a.configurado) {
      partes.push(h('ul', { class: 'e360-lista-num' },
        h('li', {}, h('span', { text: 'API Token' }), h('strong', { text: `••••${a.finalToken || ''}` })),
        h('li', {}, h('span', { text: 'Envio automático do DAS' }), h('span', { class: `selo ${a.envioAutomatico ? 'ok' : 'neutro'}`, text: a.envioAutomatico ? 'Ligado' : 'Desligado' })),
        h('li', {}, h('span', { text: 'Envios nos últimos 30 dias' }), h('strong', { text: `${a.envios30d.total}${a.envios30d.erros ? ` (${a.envios30d.erros} com erro)` : ''}` })),
        h('li', {}, h('span', { text: 'Cadastrado' }), h('strong', { text: `${guQuando(a.atualizadoEm)} · ${a.atualizadoPor}` }))));
    }
    if (!podeEditar) {
      partes.push(h('p', { class: 'meta', text: 'Só um administrador configura a integração.' }));
    } else if (!aberto) {
      partes.push(h('div', { class: 'gu-botoes' },
        h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Testando…', async () => { const r = await chamar('/api/acessorias/testar', { method: 'POST' }); avisar(r.mensagem, { tipo: r.ok ? 'ok' : 'erro' }); }, 'es-ac-testar') }, icone('refresh-cw'), h('span', { text: 'Testar token' })),
        h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Salvando…', async () => {
          es.acessorias = await chamar('/api/acessorias', { method: 'POST', body: { envioAutomatico: !a.envioAutomatico } }); esRender();
        }, 'es-ac-auto') }, h('span', { text: a.envioAutomatico ? 'Desligar envio automático' : 'Ligar envio automático' })),
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => { es.editandoAcessorias = true; esRender(); } }, icone('key-round'), 'Trocar token'),
        es.confirmarRemoverAc
          ? h('span', { class: 'gu-botoes' }, h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => { es.confirmarRemoverAc = false; esRender(); } }, 'Cancelar'),
            h('button', { type: 'button', class: 'botao pequeno perigo-cheio', onclick: (ev) => comOcupado(ev.currentTarget, 'Removendo…', async () => {
              es.acessorias = await chamar('/api/acessorias', { method: 'DELETE' }); es.confirmarRemoverAc = false; avisar('Integração com a Acessórias removida.', { tipo: 'ok' }); esRender();
            }, 'es-ac-remover') }, h('span', { text: 'Confirmar remoção' })))
          : h('button', { type: 'button', class: 'botao pequeno perigo', onclick: () => { es.confirmarRemoverAc = true; esRender(); } }, 'Remover')));
    } else {
      const form = h('form', { class: 'es-chaves', autocomplete: 'off', novalidate: true, onsubmit: (ev) => { ev.preventDefault(); esSalvarAcessorias(form); } },
        h('p', { class: 'meta', text: 'Na Acessórias: ícone de engrenagem (canto superior direito) › API Token. O envio usa as permissões desse usuário.' }),
        h('label', { class: 'campo' }, h('span', { text: 'API Token' }),
          h('div', { class: 'senha' }, h('input', { id: 'es-ac-token', type: 'password', required: true, autocomplete: 'new-password', spellcheck: 'false', maxlength: '500' }),
            h('button', { type: 'button', class: 'botao fantasma pequeno', 'aria-pressed': 'false', onclick: (ev) => { const i = $('es-ac-token'); const m = i.type === 'password'; i.type = m ? 'text' : 'password'; ev.currentTarget.textContent = m ? 'Ocultar' : 'Mostrar'; ev.currentTarget.setAttribute('aria-pressed', String(m)); } }, 'Mostrar'))),
        h('label', { class: 'checar' }, h('input', { id: 'es-ac-auto', type: 'checkbox', checked: a.configurado ? a.envioAutomatico : true }),
          h('span', {}, h('strong', { text: 'Enviar cada DAS assim que for gerado' }), h('small', { text: 'Sem isso, o envio é pelo botão na guia ou em lote na tela Guias.' }))),
        h('p', { id: 'es-ac-erro', class: 'erro', role: 'alert', hidden: true }),
        h('div', { class: 'gu-botoes' },
          a.configurado ? h('button', { type: 'button', class: 'botao fantasma', onclick: () => { es.editandoAcessorias = false; esRender(); } }, 'Cancelar') : null,
          h('button', { type: 'submit', class: 'botao primario' }, h('span', { text: 'Salvar token' }))));
      partes.push(form);
    }
    return h('section', { class: 'vg-card' }, ...partes);
  }

  async function esSalvarAcessorias(form) {
    const erro = $('es-ac-erro');
    const token = $('es-ac-token').value.trim();
    erro.hidden = true;
    if (!token) { erro.textContent = 'Cole o API Token da Acessórias.'; erro.hidden = false; $('es-ac-token').setAttribute('aria-invalid', 'true'); return; }
    await comOcupado(form.querySelector('button[type=submit]'), 'Salvando…', async () => {
      try {
        es.acessorias = await chamar('/api/acessorias', { method: 'POST', body: { token, envioAutomatico: $('es-ac-auto').checked } });
      } catch (e) { erro.textContent = e.message; erro.hidden = false; return; }
      es.editandoAcessorias = false;
      avisar('Token da Acessórias salvo. Use "Testar token" para conferir.', { tipo: 'ok' });
      esRender();
    }, 'es-ac-salvar');
  }

  /** Consumer Key e Secret do contrato do SERPRO: só o administrador cadastra; ninguém vê o valor depois de salvo. */
  function esCardChaves(s) {
    const c = s.chaves || {};
    const selo = c.origem === 'painel' ? { tom: 'ok', texto: 'Cadastradas' } : c.origem === 'servidor' ? { tom: 'info', texto: 'No servidor' } : { tom: 'neutro', texto: 'Não cadastradas' };
    const info = c.origem === 'painel'
      ? `${s.ambiente === 'trial' ? 'Ambiente de teste do SERPRO' : `Consumer Key terminando em ••••${c.finalChave || ''}`} · cadastradas ${guQuando(c.atualizadoEm)} por ${c.atualizadoPor}`
      : c.origem === 'servidor' ? 'O Appura está usando as chaves das variáveis do servidor. Se cadastrar aqui, estas passam a valer.' : 'Copie as duas chaves da área do cliente do SERPRO e cole aqui.';
    const podeEditar = pode('configuracoes');
    const aberto = es.editandoChaves || (!c.origem && podeEditar);
    const topo = h('div', { class: 'vg-card-topo' },
      h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Chaves do Integra Contador' }),
        h('p', { class: 'meta', text: 'Ficam cifradas no servidor (como os certificados). Depois de salvas, ninguém vê o valor, nem o administrador.' })),
      h('span', { class: `selo ${selo.tom}`, text: selo.texto }));
    const partes = [topo, h('p', { class: 'meta', text: info })];
    if (!podeEditar) {
      partes.push(h('p', { class: 'meta', text: 'Só um administrador cadastra ou troca as chaves.' }));
    } else if (!aberto) {
      partes.push(h('div', { class: 'gu-botoes' },
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => { es.editandoChaves = true; esRender(); } }, icone('key-round'), c.origem === 'painel' ? 'Trocar chaves' : 'Cadastrar chaves no Appura'),
        c.origem === 'painel' ? (es.confirmarRemover
          ? h('span', { class: 'gu-botoes' }, h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => { es.confirmarRemover = false; esRender(); } }, 'Cancelar'),
            h('button', { type: 'button', class: 'botao pequeno perigo-cheio', onclick: (ev) => comOcupado(ev.currentTarget, 'Removendo…', async () => {
              es.dados = await chamar('/api/guias/chaves', { method: 'DELETE' }); es.confirmarRemover = false; avisar('Chaves removidas.', { tipo: 'ok' }); esRender();
            }, 'es-remover') }, h('span', { text: 'Confirmar remoção' })))
          : h('button', { type: 'button', class: 'botao pequeno perigo', onclick: () => { es.confirmarRemover = true; esRender(); } }, 'Remover chaves')) : null));
    } else {
      const form = h('form', { class: 'es-chaves', autocomplete: 'off', novalidate: true, onsubmit: (ev) => { ev.preventDefault(); esSalvarChaves(form); } },
        h('label', { class: 'campo' }, h('span', { text: 'Ambiente' }),
          h('select', { id: 'es-ambiente', onchange: () => { const t = $('es-ambiente').value === 'trial'; $('es-key').required = !t; $('es-secret').required = !t; } },
            h('option', { value: 'producao', text: 'Produção (contrato do escritório)' }),
            h('option', { value: 'trial', text: 'Teste do SERPRO (dados fictícios, nada é gravado)' }))),
        h('label', { class: 'campo' }, h('span', { text: 'Consumer Key' }),
          h('input', { id: 'es-key', type: 'text', required: true, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', maxlength: '200' })),
        h('label', { class: 'campo' }, h('span', { text: 'Consumer Secret' }),
          h('div', { class: 'senha' }, h('input', { id: 'es-secret', type: 'password', required: true, autocomplete: 'new-password', spellcheck: 'false', maxlength: '200' }),
            h('button', { type: 'button', class: 'botao fantasma pequeno', 'aria-pressed': 'false', onclick: (ev) => { const i = $('es-secret'); const mostrar = i.type === 'password'; i.type = mostrar ? 'text' : 'password'; ev.currentTarget.textContent = mostrar ? 'Ocultar' : 'Mostrar'; ev.currentTarget.setAttribute('aria-pressed', String(mostrar)); } }, 'Mostrar'))),
        h('p', { id: 'es-erro', class: 'erro', role: 'alert', hidden: true }),
        h('div', { class: 'gu-botoes' },
          c.origem ? h('button', { type: 'button', class: 'botao fantasma', onclick: () => { es.editandoChaves = false; esRender(); } }, 'Cancelar') : null,
          h('button', { type: 'submit', class: 'botao primario' }, h('span', { text: 'Salvar chaves' }))));
      partes.push(form);
    }
    return h('section', { class: 'vg-card' }, ...partes);
  }

  async function esSalvarChaves(form) {
    const erro = $('es-erro');
    const ambiente = $('es-ambiente').value;
    const consumerKey = $('es-key').value.trim(); const consumerSecret = $('es-secret').value.trim();
    erro.hidden = true;
    if (ambiente !== 'trial' && (!consumerKey || !consumerSecret)) {
      erro.textContent = 'Informe a Consumer Key e a Consumer Secret.'; erro.hidden = false;
      (consumerKey ? $('es-secret') : $('es-key')).setAttribute('aria-invalid', 'true');
      return;
    }
    await comOcupado(form.querySelector('button[type=submit]'), 'Salvando…', async () => {
      try {
        es.dados = await chamar('/api/guias/chaves', { method: 'POST', body: { ambiente, consumerKey, consumerSecret } });
      } catch (e) { erro.textContent = e.message; erro.hidden = false; return; }
      es.editandoChaves = false;
      avisar('Chaves salvas. Use "Testar conexão" para conferir com o SERPRO.', { tipo: 'ok' });
      esRender();
    }, 'es-chaves');
  }

  window.esMostrar = esMostrar;
  window.esCarregar = esCarregar;
  window.addEventListener('appura:competencia', () => { if (!$('tela-guias').hidden) { gu.selecionados.clear(); gu.confirmar = null; guCarregar(); } });
  window.guMostrar = guMostrar;
  window.guEmpresaCarregar = guEmpresaCarregar;
  window.guBaixar = guBaixar;
}
