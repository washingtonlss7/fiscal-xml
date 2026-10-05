'use strict';
/*
 * Captação (#/captacao/monitor | lacunas | importacoes | historico): como as notas estão chegando ao Appura.
 * Monitor = situação de cada empresa agora; Lacunas/NSU = o que a SEFAZ ainda deve e a numeração das saídas;
 * Importações = envios manuais e do Appura Coletor; Histórico = capturas por dia e consultas à SEFAZ.
 * Usa os utilitários globais do app.js (h, $, chamar, icone, empresas, carregarEmpresas, mesSelecionado, enderecoEmpresa)
 * e do nucleo.js (formatarCnpj, formatarData, formatarHora, textoCompetencia).
 */

/* ---------- funções puras (testadas em test/captacao-tela.test.ts) ---------- */
const CP_ABAS = { monitor: 'Monitor', lacunas: 'Lacunas / NSU', importacoes: 'Importações', historico: 'Histórico' };
const CP_TOM = { ok: 'Em dia', atencao: 'Atenção', problema: 'Problema', neutro: '—' };
const CP_MAQ = { ok: ['ok', 'Enviando'], atrasada: ['atencao', 'Sem sinal há horas'], sem_sinal: ['problema', 'Sem sinal > 24 h'], aguardando: ['neutro', 'Não instalado'], revogada: ['neutro', 'Revogado'] };
const cpN = (n) => Number(n || 0).toLocaleString('pt-BR');

/** "há 5 min", "há 3 h", "em 01/10 às 02:00". */
function cpQuando(iso, agora = Date.now()) {
  if (!iso) return 'nunca';
  const min = Math.floor((agora - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  if (min < 48 * 60) return `há ${Math.floor(min / 60)} h`;
  const d = new Date(iso);
  return `em ${d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })} às ${d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}`;
}

/** Filtro do Monitor: situação e busca por nome ou CNPJ. */
function cpFiltrar(linhas, tom, termo) {
  const t = String(termo || '').trim().toLowerCase(); const d = t.replace(/\D/g, '');
  return linhas.filter((l) => (!tom || tom === 'todas' || l.tom === tom)
    && (!t || l.razaoSocial.toLowerCase().includes(t) || (d.length >= 3 && l.cnpj.includes(d))));
}

/** Resumo de uma linha de estado da SEFAZ (NF-e ou CT-e) para a tabela do Monitor. */
function cpResumoSefaz(s, agora = Date.now()) {
  if (!s) return { texto: 'Nunca consultado', tom: 'neutro' };
  const partes = [`consulta ok ${cpQuando(s.ultimaSyncOkEm, agora)}`];
  if (s.restantes > 0) partes.push(`${cpN(s.restantes)} na fila`);
  const tom = s.erros >= 3 ? 'problema' : s.restantes > 0 || (s.erros > 0 && s.cstat !== '656') ? 'atencao' : 'ok';
  return { texto: partes.join(' · '), tom, detalhe: s.cstat ? `${s.cstat} · ${s.motivo || ''}` : '' };
}

/** Largura (%) da barra de um dia no histórico, proporcional ao maior dia. */
const cpLargura = (v, max) => (max > 0 ? Math.max(v > 0 ? 2 : 0, Math.round((v / max) * 100)) : 0);

if (typeof module !== 'undefined') module.exports = { cpQuando, cpFiltrar, cpResumoSefaz, cpLargura, CP_ABAS };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  const cp = { aba: 'monitor', dados: {}, erro: {}, carregando: {}, filtroTom: 'todas', busca: '', imp: { dias: 30, origem: '', empresa: '' }, hist: { dias: 14, empresa: '', erros: false }, timer: null };

  function cpMostrar(aba) {
    cp.aba = CP_ABAS[aba] ? aba : 'monitor';
    $('tela-captacao').hidden = false;
    window.scrollTo(0, 0);
    if (!empresas.length) carregarEmpresas().then(() => cpRender());
    clearInterval(cp.timer);
    // O Monitor se atualiza sozinho a cada minuto enquanto está aberto
    if (cp.aba === 'monitor') cp.timer = setInterval(() => { if (!$('tela-captacao').hidden && cp.aba === 'monitor') cpCarregar(true); else clearInterval(cp.timer); }, 60_000);
    cpCarregar();
  }

  function cpUrl() {
    if (cp.aba === 'monitor') return '/api/captacao/monitor';
    if (cp.aba === 'lacunas') return `/api/captacao/lacunas?mes=${mesSelecionado()}`;
    if (cp.aba === 'importacoes') return `/api/captacao/importacoes?dias=${cp.imp.dias}${cp.imp.origem ? `&origem=${cp.imp.origem}` : ''}${cp.imp.empresa ? `&empresa=${cp.imp.empresa}` : ''}`;
    return `/api/captacao/historico?dias=${cp.hist.dias}${cp.hist.empresa ? `&empresa=${cp.hist.empresa}` : ''}${cp.hist.erros ? '&erros=1' : ''}`;
  }

  async function cpCarregar(silencioso) {
    const aba = cp.aba; const url = cpUrl();
    if (!silencioso) { cp.carregando[aba] = url; cpRender(); }
    try { const d = await chamar(url); if (cp.aba !== aba || (!silencioso && cp.carregando[aba] !== url)) return; cp.dados[aba] = d; cp.erro[aba] = null; }
    catch (e) { if (cp.aba !== aba) return; cp.erro[aba] = e.message; }
    cp.carregando[aba] = null;
    cpRender();
  }

  const selo = (tom, texto) => h('span', { class: `selo ${tom}`, text: texto });
  const tabela = (cabecalho, linhas, classe = '') => h('div', { class: 'rolagem cp-rolagem' }, h('table', { class: `notas cp-tabela ${classe}` },
    h('thead', {}, h('tr', {}, ...cabecalho.map((c) => h('th', typeof c === 'string' ? { text: c } : c)))), h('tbody', {}, ...linhas)));
  const numero = (valor, rotulo, tom) => h('div', { class: `cp-numero${tom ? ` ${tom}` : ''}` }, h('strong', { text: valor }), h('span', { text: rotulo }));
  const linkEmpresa = (id, nome, cnpj) => h('a', { href: enderecoEmpresa(id), class: 'cp-empresa' }, h('strong', { text: nome }), cnpj ? h('span', { class: 'meta mono', text: formatarCnpj(cnpj) }) : null);
  const seletorEmpresa = (valor, aoMudar) => h('select', { 'aria-label': 'Empresa', onchange: (ev) => aoMudar(ev.currentTarget.value) },
    h('option', { value: '', text: 'Todas as empresas' }), ...empresas.map((e) => h('option', { value: e.id, text: e.razao_social, selected: e.id === valor })));

  function cpRender() {
    if ($('tela-captacao').hidden) return;
    $('cp-titulo').textContent = CP_ABAS[cp.aba];
    $('cp-abas').replaceChildren(...Object.entries(CP_ABAS).map(([id, rotulo]) => h('a', { href: `#/captacao/${id}`, class: `aba-tela${cp.aba === id ? ' ativa' : ''}`, role: 'tab', 'aria-selected': String(cp.aba === id), text: rotulo })));
    const alvo = $('cp-conteudo');
    const d = cp.dados[cp.aba];
    if (cp.erro[cp.aba] && !d) {
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar.' }), h('span', { text: cp.erro[cp.aba] }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => cpCarregar() }, icone('refresh-cw'), 'Tentar de novo')));
      return;
    }
    if (!d) { alvo.replaceChildren(h('section', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }), h('div', { class: 'vg-skel', 'aria-hidden': 'true' }))); return; }
    const carregando = cp.carregando[cp.aba] ? h('p', { class: 'meta', role: 'status', text: 'Atualizando…' }) : null;
    const corpo = cp.aba === 'monitor' ? cpMonitor(d) : cp.aba === 'lacunas' ? cpLacunas(d) : cp.aba === 'importacoes' ? cpImportacoes(d) : cpHistorico(d);
    alvo.replaceChildren(...[carregando, ...corpo].filter(Boolean));
  }

  /* ---------- Monitor ---------- */
  function cpMonitor(d) {
    const r = d.resumo; const agora = new Date(d.agora).getTime();
    const numeros = h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Situação da captação agora' }),
        h('p', { class: 'meta', text: `Coletor da SEFAZ: última consulta ${cpQuando(d.servicos.coletorSefaz.ultimaConsultaEm, agora)}${d.servicos.coletorSefaz.horario ? ` (consulta automática das ${d.servicos.coletorSefaz.horario})` : ''}. Atualiza sozinho a cada minuto.` })),
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => cpCarregar() }, icone('refresh-cw'), h('span', { text: 'Atualizar' }))),
      h('div', { class: 'cp-numeros' },
        numero(cpN(r.empresas), 'empresas monitoradas'),
        numero(cpN(r.problema), 'com problema', r.problema ? 'problema' : ''),
        numero(cpN(r.atencao), 'pedem atenção', r.atencao ? 'atencao' : ''),
        numero(cpN(r.capturas24h), 'documentos nas últimas 24 h'),
        numero(cpN(r.naFilaSefaz), 'ainda na fila da SEFAZ', r.naFilaSefaz ? 'atencao' : ''),
        numero(`${cpN(r.coletoresAtivos)} / ${cpN(r.coletores)}`, 'Appura Coletor enviando'),
        ...(r.sincronizando ? [numero(cpN(r.sincronizando), 'sincronizações manuais em andamento', 'info')] : [])));
    const filtros = h('div', { class: 'cp-filtros' },
      h('div', { class: 'segmentos', role: 'tablist', 'aria-label': 'Situação' }, ...[['todas', 'Todas'], ['problema', `Problema (${r.problema})`], ['atencao', `Atenção (${r.atencao})`], ['ok', 'Em dia']].map(([v, t]) =>
        h('button', { type: 'button', class: `segmento${cp.filtroTom === v ? ' ativo' : ''}`, 'aria-pressed': String(cp.filtroTom === v), onclick: () => { cp.filtroTom = v; cpRender(); } }, t))),
      h('input', { type: 'search', class: 'cp-busca', placeholder: 'Buscar empresa ou CNPJ', value: cp.busca, 'aria-label': 'Buscar empresa', oninput: (ev) => { cp.busca = ev.currentTarget.value; const p = ev.currentTarget.selectionStart; cpRender(); const b = document.querySelector('.cp-busca'); if (b) { b.focus(); b.setSelectionRange(p, p); } } }));
    const linhas = cpFiltrar(d.empresas, cp.filtroTom, cp.busca);
    const celSefaz = (s) => { if (!s) return h('td', { class: 'meta', text: '—' }); const x = cpResumoSefaz(s, agora); return h('td', { title: x.detalhe || '' }, selo(x.tom, x.tom === 'ok' ? 'Em dia' : x.tom === 'problema' ? 'Erro' : 'Atenção'), h('span', { class: 'meta cp-bloco', text: x.texto })); };
    const corpo = linhas.length ? tabela(['Empresa', 'Situação', 'NF-e (SEFAZ)', 'CT-e (SEFAZ)', 'Appura Coletor', 'Última captura'], linhas.map((l) => h('tr', {},
      h('td', {}, linkEmpresa(l.id, l.razaoSocial, l.cnpj), l.sincronizando ? h('span', { class: 'selo info', text: 'Sincronizando' }) : null),
      h('td', {}, selo(l.tom, CP_TOM[l.tom]), l.motivos.length ? h('ul', { class: 'cp-motivos' }, ...l.motivos.slice(0, 4).map((m) => h('li', { text: m }))) : null),
      celSefaz(l.sefaz.find((s) => s.modelo === 'nfe')), celSefaz(l.sefaz.find((s) => s.modelo === 'cte')),
      h('td', {}, ...(l.maquinas.length ? l.maquinas.map((m) => h('div', { class: 'cp-maq' }, selo((CP_MAQ[m.situacao] || CP_MAQ.aguardando)[0], (CP_MAQ[m.situacao] || CP_MAQ.aguardando)[1]),
        h('span', { class: 'meta', text: `${m.nome} · envio ${cpQuando(m.ultimoEnvioEm, agora)}${m.pendentes ? ` · ${cpN(m.pendentes)} na fila` : ''}` }))) : [h('span', { class: 'meta', text: 'Não usa' })])),
      h('td', {}, h('span', { text: cpQuando(l.ultimaCaptura, agora) }), h('span', { class: 'meta cp-bloco', text: `${cpN(l.capturas24h)} em 24 h` }))))) :
      h('div', { class: 'vg-vazio pequeno' }, h('strong', { text: 'Nenhuma empresa neste filtro.' }));
    return [numeros, h('section', { class: 'vg-card' }, filtros, corpo)];
  }

  /* ---------- Lacunas / NSU ---------- */
  function cpLacunas(d) {
    const t = d.totais;
    const nsu = h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'NSU na SEFAZ (distribuição de NF-e e CT-e)' }),
        h('p', { class: 'meta', text: 'Cada documento que a SEFAZ distribui tem um número sequencial (NSU). "Na fila" é o que a SEFAZ já tem e o Appura ainda não baixou (o coletor busca de madrugada, respeitando o limite de 1 hora da SEFAZ). "Lacunas" são números pulados nos últimos 20.000 NSUs: o coletor recupera até 15 por hora, um a um.' })),
        selo(t.lacunasNsu || t.naFila ? 'atencao' : 'ok', t.lacunasNsu || t.naFila ? `${cpN(t.naFila)} na fila · ${cpN(t.lacunasNsu)} lacunas` : 'Nada pendente')),
      d.sefaz.length ? tabela(['Empresa', 'Modelo', { class: 'num', text: 'Último NSU lido' }, { class: 'num', text: 'Maior NSU na SEFAZ' }, { class: 'num', text: 'Na fila' }, { class: 'num', text: 'Lacunas' }, ''],
        d.sefaz.map((l) => h('tr', {}, h('td', {}, linkEmpresa(l.empresaId, l.razaoSocial, l.cnpj)), h('td', { text: l.modelo === 'cte' ? 'CT-e' : 'NF-e' }),
          h('td', { class: 'num mono', text: cpN(l.ultNsu) }), h('td', { class: 'num mono', text: cpN(l.maxNsu) }), h('td', { class: 'num', text: cpN(l.naFila) }), h('td', { class: 'num', text: cpN(l.lacunas) }),
          h('td', {}, selo(l.naFila || l.lacunas ? 'atencao' : 'ok', l.naFila || l.lacunas ? 'Pendente' : 'Em dia'))))) :
        h('p', { class: 'meta', text: 'Nenhuma empresa consultou a SEFAZ ainda.' }));
    const num = h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: `Numeração das notas de saída em ${textoCompetencia(d.mes)}` }),
        h('p', { class: 'meta', text: 'Do menor ao maior número emitido no mês, por série. "Faltam" são números sem nota autorizada ou cancelada no Appura. Se a SEFAZ rejeitou aquele número, é venda sem nota válida; se não há nem rejeição, pode ser nota que ainda não chegou (confira o Appura Coletor ou importe o XML). A competência é a escolhida no topo.' })),
        selo(t.numerosFaltando ? 'atencao' : 'ok', t.numerosFaltando ? `${cpN(t.numerosFaltando)} números faltando` : 'Sequência completa')),
      d.numeracao.length ? tabela(['Empresa', 'Modelo', 'Série', 'Números', { class: 'num', text: 'Emitidas' }, { class: 'num', text: 'Faltam' }, { class: 'num', text: 'Rejeitadas pela SEFAZ' }, { class: 'num', text: 'Sem explicação' }],
        d.numeracao.map((l) => h('tr', {}, h('td', {}, linkEmpresa(l.empresaId, l.razaoSocial, l.cnpj)), h('td', { text: l.modelo === '65' ? 'NFC-e' : 'NF-e' }), h('td', { text: l.serie || '—' }),
          h('td', { class: 'mono', text: `${cpN(l.menor)} a ${cpN(l.maior)}` }), h('td', { class: 'num', text: cpN(l.emitidas) }),
          h('td', { class: 'num' }, l.faltam ? selo('atencao', cpN(l.faltam)) : selo('ok', '0')), h('td', { class: 'num', text: cpN(l.rejeitadas) }),
          h('td', { class: 'num' }, l.semExplicacao ? selo('problema', cpN(l.semExplicacao)) : h('span', { class: 'meta', text: '0' }))))) :
        h('p', { class: 'meta', text: 'Nenhuma nota de saída neste mês.' }));
    return [nsu, num];
  }

  /* ---------- Importações ---------- */
  function cpImportacoes(d) {
    const t = d.totais; const f = cp.imp;
    const filtros = h('div', { class: 'cp-filtros' },
      h('select', { 'aria-label': 'Período', onchange: (ev) => { f.dias = Number(ev.currentTarget.value); cpCarregar(); } }, ...[7, 30, 90].map((n) => h('option', { value: String(n), text: `Últimos ${n} dias`, selected: f.dias === n }))),
      h('select', { 'aria-label': 'Origem', onchange: (ev) => { f.origem = ev.currentTarget.value; cpCarregar(); } }, ...[['', 'Todas as origens'], ['manual', 'Importação manual'], ['coletor', 'Appura Coletor']].map(([v, tx]) => h('option', { value: v, text: tx, selected: f.origem === v }))),
      seletorEmpresa(f.empresa, (v) => { f.empresa = v; cpCarregar(); }));
    const numeros = h('div', { class: 'cp-numeros' }, numero(cpN(t.envios), 'envios'), numero(cpN(t.arquivos), 'arquivos'), numero(cpN(t.novas), 'notas novas'),
      numero(cpN(t.jaExistiam), 'já existiam'), numero(cpN(t.rejeitadasSefaz), 'rejeitadas pela SEFAZ'), numero(cpN(t.rejeitadas), 'recusadas', t.rejeitadas ? 'atencao' : ''), numero(cpN(t.comErro), 'com erro', t.comErro ? 'problema' : ''));
    const linhas = d.itens.map((i) => h('tr', {},
      h('td', { text: `${formatarData(i.em)} ${formatarHora(i.em)}` }),
      h('td', {}, selo(i.origem === 'coletor' ? 'info' : 'neutro', i.origem === 'coletor' ? 'Appura Coletor' : 'Manual')),
      h('td', {}, ...(i.empresas.length ? i.empresas.slice(0, 3).map((e) => h('div', {}, linkEmpresa(e.id, e.razaoSocial))) : [h('span', { class: 'meta', text: '—' })])),
      h('td', {}, h('span', { text: i.quem || '—' }), i.arquivo ? h('span', { class: 'meta cp-bloco mono', text: i.arquivo }) : null),
      h('td', { class: 'num', text: cpN(i.arquivos) }), h('td', { class: 'num', text: cpN(i.novas) }), h('td', { class: 'num', text: cpN(i.jaExistiam) }),
      h('td', { class: 'num', text: i.rejeitadasSefaz == null ? '—' : cpN(i.rejeitadasSefaz) }),
      h('td', { class: 'num' }, i.rejeitadas ? h('details', { class: 'cp-detalhes' }, h('summary', { text: cpN(i.rejeitadas) }),
        h('ul', { class: 'cp-motivos' }, ...(i.motivos || []).slice(0, 5).map((m) => h('li', { text: `${m.quantidade}× ${m.motivo}` })))) : h('span', { text: '0' })),
      h('td', {}, i.erro ? selo('problema', 'Erro') : selo('ok', 'Ok'), i.erro ? h('span', { class: 'meta cp-bloco', text: i.erro }) : h('span', { class: 'meta cp-bloco', text: i.duracaoMs ? `${(i.duracaoMs / 1000).toFixed(1)} s` : '' }))));
    return [h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Envios de XML' }),
        h('p', { class: 'meta', text: 'Tudo o que entrou por importação manual (tela da empresa) ou pelo Appura Coletor instalado no cliente. "Rejeitadas pela SEFAZ" vão para o alerta de vendas sem nota autorizada; "recusadas" são arquivos que não são nota válida (sem protocolo, de outro CNPJ, ilegíveis).' }))),
      filtros, numeros,
      d.itens.length ? tabela(['Quando', 'Origem', 'Empresa', 'Quem / arquivo', { class: 'num', text: 'Arquivos' }, { class: 'num', text: 'Novas' }, { class: 'num', text: 'Já existiam' }, { class: 'num', text: 'Rejeitadas SEFAZ' }, { class: 'num', text: 'Recusadas' }, 'Resultado'], linhas)
        : h('div', { class: 'vg-vazio pequeno' }, h('strong', { text: 'Nenhum envio no período.' })),
      d.limitado ? h('p', { class: 'meta', text: 'Mostrando os 1.500 envios mais recentes. Reduza o período para ver menos.' }) : null)];
  }

  /* ---------- Histórico ---------- */
  function cpHistorico(d) {
    const f = cp.hist; const t = d.totais;
    const filtros = h('div', { class: 'cp-filtros' },
      h('select', { 'aria-label': 'Período', onchange: (ev) => { f.dias = Number(ev.currentTarget.value); cpCarregar(); } }, ...[7, 14, 30, 90].map((n) => h('option', { value: String(n), text: `Últimos ${n} dias`, selected: f.dias === n }))),
      seletorEmpresa(f.empresa, (v) => { f.empresa = v; cpCarregar(); }),
      h('label', { class: 'cp-check' }, h('input', { type: 'checkbox', checked: f.erros, onchange: (ev) => { f.erros = ev.currentTarget.checked; cpCarregar(); } }), h('span', { text: 'Só consultas com problema' })));
    const max = Math.max(0, ...d.dias.map((x) => x.total));
    const barra = (x) => { const s = h('span', { class: 'cp-barra-valor' }); s.style.width = `${cpLargura(x.total, max)}%`; return h('div', { class: 'cp-barra' }, s); };
    const dias = h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Documentos capturados por dia' }),
        h('p', { class: 'meta', text: '"SEFAZ" é o que o coletor baixou pela distribuição (entradas, CT-e e notas em que o escritório é autorizado). "Importação" inclui o Appura Coletor e as importações manuais. A data é a da chegada ao Appura, não a de emissão.' })),
        selo('info', `${cpN(t.capturados)} no período`)),
      d.dias.length ? tabela(['Dia', '', { class: 'num', text: 'Total' }, { class: 'num', text: 'SEFAZ' }, { class: 'num', text: 'Importação' }, { class: 'num', text: 'NF-e' }, { class: 'num', text: 'NFC-e' }, { class: 'num', text: 'CT-e' }],
        d.dias.map((x) => h('tr', {}, h('td', { text: new Date(`${x.dia}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }) }), h('td', { class: 'cp-col-barra' }, barra(x)),
          h('td', { class: 'num', text: cpN(x.total) }), h('td', { class: 'num', text: cpN(x.sefaz + x.autxml) }), h('td', { class: 'num', text: cpN(x.importacao) }),
          h('td', { class: 'num', text: cpN(x.nfe) }), h('td', { class: 'num', text: cpN(x.nfce) }), h('td', { class: 'num', text: cpN(x.cte) }))))
        : h('p', { class: 'meta', text: 'Nenhum documento capturado no período.' }));
    const consultas = h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Consultas à SEFAZ' }),
        h('p', { class: 'meta', text: '137/138 = consulta normal (sem documentos novos / com documentos). 656 = a SEFAZ pediu para esperar 1 hora (consumo indevido): o coletor respeita e tenta depois. Outros códigos ou erro de conexão aparecem como problema. Mostra as 500 mais recentes.' })),
        selo(t.comErro ? 'atencao' : 'ok', `${cpN(t.consultas)} consultas · ${cpN(t.comErro)} com problema`)),
      d.consultas.length ? tabela(['Quando', 'Empresa', 'Modelo', 'Retorno', { class: 'num', text: 'Documentos' }, { class: 'num', text: 'NSU' }, { class: 'num', text: 'Tempo' }],
        d.consultas.map((c) => h('tr', {}, h('td', { text: `${formatarData(c.em)} ${formatarHora(c.em)}` }), h('td', {}, linkEmpresa(c.empresaId, c.razaoSocial)), h('td', { text: c.modelo === 'cte' ? 'CT-e' : 'NF-e' }),
          h('td', {}, selo(c.tom, c.erro ? 'Erro' : c.cstat || '—'), h('span', { class: 'meta cp-bloco', text: c.erro || c.motivo || '' })),
          h('td', { class: 'num', text: cpN(c.documentos) }), h('td', { class: 'num mono', text: c.maxNsu ? `${cpN(c.ultNsu)} / ${cpN(c.maxNsu)}` : '—' }),
          h('td', { class: 'num', text: c.duracaoMs ? `${(c.duracaoMs / 1000).toFixed(1)} s` : '—' }))))
        : h('p', { class: 'meta', text: 'Nenhuma consulta no período.' }));
    const ST = { pendente: ['neutro', 'Na fila'], processando: ['info', 'Em andamento'], concluido: ['ok', 'Concluída'], erro: ['problema', 'Erro'] };
    const manuais = d.manuais.length ? h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Sincronizações pedidas no painel' })),
      tabela(['Pedida em', 'Empresa', 'Situação', 'Mensagem'], d.manuais.map((p) => h('tr', {}, h('td', { text: `${formatarData(p.solicitado_em)} ${formatarHora(p.solicitado_em)}` }),
        h('td', {}, linkEmpresa(p.empresa_id, p.razaoSocial)), h('td', {}, selo(...(ST[p.status] || ['neutro', p.status]))), h('td', { class: 'meta', text: p.mensagem || '' })))))
      : null;
    return [h('section', { class: 'vg-card cp-so-filtros' }, filtros), dias, consultas, manuais];
  }

  window.addEventListener('appura:competencia', () => { if (!$('tela-captacao').hidden && cp.aba === 'lacunas') cpCarregar(); });
  window.cpMostrar = cpMostrar;
}
