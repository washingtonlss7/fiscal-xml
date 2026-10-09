'use strict';
/*
 * Telas do escritório inteiro e o "kit" de componentes usado também por folha.js, societario.js, financeiro.js
 * e atendimento.js:
 *   #/auditoria (Auditoria de todas as empresas) · #/icms-st (ICMS-ST de todas as empresas) · #/relatorios
 *   #/certificados · #/configuracoes
 * O mês de trabalho é a competência do topo (mesSelecionado). Usa os utilitários globais do app.js e do nucleo.js.
 */

/* ---------- funções puras (testadas em test/escritorio-tela.test.ts) ---------- */
const esN = (n) => Number(n || 0).toLocaleString('pt-BR');
const esMoeda = (v) => (v === null || v === undefined || v === '' ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const esData = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '—');
const esDataHora = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—');
/** "1.234,56" ou "1234.56" → 1234.56 (null se vazio). */
function esNumero(txt) {
  const s = String(txt ?? '').trim();
  if (!s) return null;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : NaN;
}
/** Texto e tom da situação de uma validade (documento ou certificado). */
const ES_SITUACAO = {
  vencido: { texto: 'Vencido', tom: 'problema' }, vencendo: { texto: 'Vence em até 30 dias', tom: 'atencao' },
  sem_certificado: { texto: 'Sem certificado', tom: 'pendente' }, sem_validade: { texto: 'Sem validade', tom: 'neutro' }, em_dia: { texto: 'Em dia', tom: 'ok' },
};
/** "vence em 12 dias" / "venceu há 3 dias" / "vence hoje". */
function esDias(dias) {
  if (dias === null || dias === undefined) return '';
  if (dias === 0) return 'vence hoje';
  return dias > 0 ? `vence em ${esN(dias)} dia${dias === 1 ? '' : 's'}` : `venceu há ${esN(-dias)} dia${dias === -1 ? '' : 's'}`;
}
const ES_SEVERIDADE = { erro: { texto: 'Erro', tom: 'problema' }, alerta: { texto: 'Alerta', tom: 'atencao' }, info: { texto: 'Informação', tom: 'info' } };

if (typeof module !== 'undefined') module.exports = { esN, esMoeda, esData, esNumero, esDias, ES_SITUACAO, ES_SEVERIDADE };

/* ---------- kit de tela ---------- */
if (typeof window !== 'undefined') {
  const kit = {
    cartao: (...f) => h('section', { class: 'vg-card' }, ...f),
    topo: (titulo, sub, ...dir) => h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: titulo }), sub ? h('p', { class: 'meta', text: sub }) : null), ...dir),
    btn: (texto, fn, classe = 'botao pequeno', extra = {}) => h('button', { type: 'button', class: classe, ...extra, onclick: (ev) => comOcupado(ev.currentTarget, null, async () => { try { await fn(); } catch (e) { avisar(e.message, { tipo: 'erro' }); } }) }, h('span', { text: texto })),
    erro: (titulo, msg) => h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: titulo }), h('span', { text: msg })),
    carregando: () => h('section', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' })),
    vazio: (titulo, texto) => h('div', { class: 'vg-vazio' }, h('strong', { text: titulo }), texto ? h('span', { text: texto }) : null),
    selo: (texto, tom = 'neutro') => h('span', { class: `selo ${tom}`, text: texto }),
    tabela: (cabecalhos, linhas, classe = '') => h('div', { class: 'rolagem' }, h('table', { class: `notas ${classe}` },
      h('thead', {}, h('tr', {}, ...cabecalhos.map((t) => (typeof t === 'string' ? h('th', { text: t }) : h('th', { class: t.classe || '', text: t.texto }))))),
      h('tbody', {}, ...linhas))),
    kpis: (lista) => h('div', { class: 'es-kpis' }, ...lista.map((k) => h('div', { class: 'vg-kpi' },
      h('span', { class: `vg-kpi-icone ${k.tom || 'info'}` }, icone(k.icone || 'gauge')),
      h('div', { class: 'vg-kpi-corpo' }, h('span', { class: `vg-kpi-valor${k.tom === 'problema' || k.tom === 'atencao' ? ` ${k.tom}` : ''}`, text: k.valor }), h('span', { class: 'vg-kpi-rotulo', text: k.rotulo }), k.meta ? h('span', { class: 'vg-kpi-meta', text: k.meta }) : null)))),
    /** Campo de formulário ligado a f[k]. tipo: text, date, number, textarea, select (opcoes = [[valor, texto]]). */
    campo: (rot, f, k, tipo = 'text', extra = {}, opcoes = []) => {
      const muda = (ev) => { f[k] = ev.currentTarget.type === 'checkbox' ? ev.currentTarget.checked : ev.currentTarget.value; };
      let el;
      // "extra" pode trazer onchange próprio (filtros que recarregam): ele substitui o padrão
      if (tipo === 'select') el = h('select', { onchange: muda, ...extra }, ...opcoes.map(([v, t]) => h('option', { value: v, text: t, selected: String(f[k] ?? '') === String(v) })));
      else if (tipo === 'textarea') { el = h('textarea', { rows: 3, oninput: muda, ...extra }); el.value = f[k] ?? ''; }
      else el = h('input', { type: tipo, value: f[k] ?? '', oninput: muda, onchange: muda, ...extra });
      return h('label', { class: 'campo' }, rot, el);
    },
    marcar: (rot, f, k) => h('label', { class: 'marcar' }, h('input', { type: 'checkbox', checked: !!f[k], onchange: (ev) => { f[k] = ev.currentTarget.checked; } }), h('span', { text: rot })),
    linha: (...c) => h('div', { class: 'ct-linha' }, ...c),
    botoes: (...c) => h('div', { class: 'gu-botoes' }, ...c),
    acoesForm: (cancelar, salvar, textoSalvar = 'Salvar') => h('div', { class: 'gaveta-acoes' },
      h('button', { type: 'button', class: 'botao fantasma', onclick: cancelar }, 'Cancelar'), kit.btn(textoSalvar, salvar, 'botao primario')),
    abas: (alvo, lista, atual, base) => $(alvo).replaceChildren(...lista.map(([id, nome]) => h('a', { href: `${base}/${id}`, role: 'tab', class: `aba-tela${id === atual ? ' ativa' : ''}`, 'aria-selected': String(id === atual) }, nome))),
    mes: () => (typeof mesSelecionado === 'function' ? mesSelecionado() : new Date().toISOString().slice(0, 7)),
    textoMes: (m) => (typeof textoCompetencia === 'function' ? textoCompetencia(m) : m),
    /** Empresas do escopo (lista do painel), carregando se ainda não veio. */
    empresas: async () => { if (!empresas.length) await carregarEmpresas(); return empresas; },
    opcoesEmpresa: (lista, vazio = '— escolha a empresa —') => [['', vazio], ...lista.slice().sort((a, b) => a.razao_social.localeCompare(b.razao_social)).map((e) => [e.id, `${e.razao_social} · ${formatarCnpj(e.cnpj)}`])],
    /** Recarrega a tela quando a competência do topo muda (se estiver aberta). */
    aoMudarMes: (tela, fn) => window.addEventListener('appura:competencia', () => { if (!$(tela).hidden) fn(); }),
    confirmar: (msg) => window.confirm(msg),
  };
  window.esKit = kit;

  /* ===== Auditoria do escritório ===== */
  const au = { dados: null, erro: null, mes: null };
  async function auMostrar() {
    $('tela-auditoria-esc').hidden = false; window.scrollTo(0, 0);
    au.mes = kit.mes(); au.dados = null; auRender();
    try { au.dados = await chamar(`/api/auditoria/resumo?mes=${au.mes}`); au.erro = null; } catch (e) { au.erro = e.message; }
    auRender();
  }
  function auRender() {
    const alvo = $('au-conteudo');
    if (au.erro) return alvo.replaceChildren(kit.erro('Não foi possível abrir a auditoria.', au.erro));
    if (!au.dados) return alvo.replaceChildren(kit.carregando());
    const d = au.dados; const t = d.totais;
    const out = [kit.kpis([
      { rotulo: 'Apontamentos abertos', valor: esN(t.abertos), tom: t.abertos ? 'atencao' : 'ok', icone: 'shield-alert', meta: kit.textoMes(d.mes) },
      { rotulo: 'Empresas com erro', valor: esN(t.empresasComErro), tom: t.empresasComErro ? 'problema' : 'ok', icone: 'shield-x' },
      { rotulo: 'Já tratados', valor: esN(t.tratados), tom: 'ok', icone: 'shield-check' },
      { rotulo: 'Notas aguardando auditoria', valor: esN(t.aguardando), tom: t.aguardando ? 'pendente' : 'neutro', icone: 'clock-alert' },
    ])];
    if (!d.empresas.length) { out.push(kit.vazio('Nada para auditar neste mês.', 'Nenhum apontamento e nenhuma nota aguardando nas empresas do seu acesso.')); return alvo.replaceChildren(...out); }
    out.push(kit.cartao(kit.topo('Por empresa', 'Ordenado por erros. Abra a empresa para ver cada apontamento e tratar.'),
      kit.tabela(['Empresa', { texto: 'Erros', classe: 'num' }, { texto: 'Alertas', classe: 'num' }, { texto: 'Info', classe: 'num' }, { texto: 'Tratados', classe: 'num' }, { texto: 'Notas aguardando', classe: 'num' }, ''],
        d.empresas.map((e) => h('tr', {},
          h('td', {}, h('strong', { text: e.razao_social }), h('span', { class: 'sub', text: formatarCnpj(e.cnpj) })),
          h('td', { class: 'num' }, e.erros ? kit.selo(esN(e.erros), 'problema') : '0'), h('td', { class: 'num' }, e.alertas ? kit.selo(esN(e.alertas), 'atencao') : '0'),
          h('td', { class: 'num', text: esN(e.info) }), h('td', { class: 'num', text: esN(e.tratados) }), h('td', { class: 'num', text: esN(e.aguardando) }),
          h('td', {}, h('a', { class: 'botao pequeno', href: enderecoEmpresa(e.id, 'auditoria') }, 'Abrir')))))));
    out.push(kit.cartao(kit.topo('Por regra', 'Quais verificações mais aparecem no mês. Ajuda a achar erro de cadastro que se repete em várias empresas.'),
      kit.tabela(['Regra', 'Severidade', { texto: 'Abertos', classe: 'num' }, { texto: 'Tratados', classe: 'num' }, { texto: 'Empresas', classe: 'num' }],
        d.regras.map((r) => h('tr', {},
          h('td', {}, h('strong', { text: r.titulo }), r.explicacao ? h('span', { class: 'sub', text: r.explicacao }) : null),
          h('td', {}, kit.selo((ES_SEVERIDADE[r.severidade] || { texto: r.severidade }).texto, (ES_SEVERIDADE[r.severidade] || {}).tom)),
          h('td', { class: 'num', text: esN(r.abertos) }), h('td', { class: 'num', text: esN(r.tratados) }), h('td', { class: 'num', text: esN(r.empresas) }))))));
    alvo.replaceChildren(...out);
  }
  kit.aoMudarMes('tela-auditoria-esc', auMostrar);
  window.auMostrar = auMostrar;

  /* ===== ICMS-ST do escritório ===== */
  const se = { dados: null, erro: null };
  async function seMostrar() {
    $('tela-st-esc').hidden = false; window.scrollTo(0, 0);
    se.dados = null; seRender();
    try { se.dados = await chamar(`/api/st/resumo?mes=${kit.mes()}`); se.erro = null; } catch (e) { se.erro = e.message; }
    seRender();
  }
  function seRender() {
    const alvo = $('se-conteudo');
    if (se.erro) return alvo.replaceChildren(kit.erro('Não foi possível abrir o ICMS-ST.', se.erro));
    if (!se.dados) return alvo.replaceChildren(kit.carregando());
    const d = se.dados; const t = d.totais;
    const out = [kit.kpis([
      { rotulo: 'Entradas de fora do estado', valor: esN(t.foraDoEstado), icone: 'file-text', meta: kit.textoMes(d.mes) },
      { rotulo: 'Sem ST destacado', valor: esN(t.semStDestacado), tom: t.semStDestacado ? 'atencao' : 'ok', icone: 'triangle-alert', meta: 'Conferir se o produto tem ST na entrada' },
      { rotulo: 'Valor das entradas de fora', valor: esMoeda(t.valor), icone: 'calculator' },
      { rotulo: 'Regras na tabela de ST (ES)', valor: esN(d.regrasCadastradas), tom: d.regrasCadastradas ? 'ok' : 'problema', icone: 'list-checks' },
    ])];
    out.push(kit.cartao(kit.topo('Tabela de ST do ES', 'NCM/CEST, MVA e alíquotas usadas no cálculo por item (Portaria SEFAZ-ES 16-R/2019). Baixe, ajuste na planilha e envie de novo para substituir.'),
      kit.botoes(
        kit.btn('Baixar tabela (CSV)', () => baixarArquivo('/api/st-es/tabela', 'tabela_st_es.csv')),
        d.podeConfigurar ? kit.btn('Substituir tabela', () => new Promise((ok) => {
          const inp = h('input', { type: 'file', accept: '.csv,.txt', hidden: true, onchange: async () => {
            const f = inp.files[0]; inp.remove();
            if (f) {
              try { const r = await chamar('/api/st-es/tabela', { method: 'POST', body: { csv: await f.text() } }); avisar(`Tabela de ST substituída: ${esN(r.regras ?? r.gravadas ?? 0)} regras.`, { tipo: 'ok' }); seMostrar(); } catch (e) { avisar(e.message, { tipo: 'erro' }); }
            }
            ok();
          } });
          document.body.append(inp); inp.click();
        }), 'botao pequeno') : null)));
    if (!d.empresas.length) { out.push(kit.vazio('Nenhuma NF-e de entrada no mês.', 'As entradas aparecem aqui conforme a captação traz as notas.')); return alvo.replaceChildren(...out); }
    out.push(kit.cartao(kit.topo('Por empresa', 'Primeiro as que têm entradas de fora do estado sem ST destacado na nota: nelas pode haver ST a recolher na entrada.'),
      kit.tabela(['Empresa', 'UF', { texto: 'Entradas', classe: 'num' }, { texto: 'De fora', classe: 'num' }, { texto: 'Valor de fora', classe: 'num' }, { texto: 'ST destacado', classe: 'num' }, { texto: 'Sem ST', classe: 'num' }, ''],
        d.empresas.map((e) => h('tr', {},
          h('td', {}, h('strong', { text: e.razao_social }), h('span', { class: 'sub', text: formatarCnpj(e.cnpj) })), h('td', { text: e.uf }),
          h('td', { class: 'num', text: esN(e.entradas) }), h('td', { class: 'num', text: esN(e.foraDoEstado) }), h('td', { class: 'num', text: esMoeda(e.valorForaDoEstado) }),
          h('td', { class: 'num', text: esMoeda(e.stDestacado) }), h('td', { class: 'num' }, e.semStDestacado ? kit.selo(esN(e.semStDestacado), 'atencao') : '0'),
          h('td', {}, h('a', { class: 'botao pequeno', href: enderecoEmpresa(e.id, 'st') }, 'Calcular')))))));
    alvo.replaceChildren(...out);
  }
  kit.aoMudarMes('tela-st-esc', seMostrar);
  window.seMostrar = seMostrar;

  /* ===== Relatórios ===== */
  const re = { lista: null, erro: null, mes: null };
  async function reMostrar() {
    $('tela-relatorios').hidden = false; window.scrollTo(0, 0);
    if (!re.mes) re.mes = kit.mes();
    try { re.lista = (await chamar('/api/relatorios')).relatorios; re.erro = null; } catch (e) { re.erro = e.message; }
    reRender();
  }
  function reRender() {
    const alvo = $('re-conteudo');
    if (re.erro) return alvo.replaceChildren(kit.erro('Não foi possível abrir os relatórios.', re.erro));
    if (!re.lista) return alvo.replaceChildren(kit.carregando());
    if (!re.lista.length) return alvo.replaceChildren(kit.vazio('Nenhum relatório disponível para o seu perfil.'));
    const f = { mes: re.mes };
    alvo.replaceChildren(
      kit.cartao(kit.linha(h('label', { class: 'campo' }, 'Mês dos relatórios mensais', h('input', { type: 'month', value: re.mes, onchange: (ev) => { re.mes = ev.currentTarget.value || kit.mes(); } }))),
        h('p', { class: 'meta', text: 'As planilhas saem só com as empresas do seu acesso.' })),
      h('div', { class: 'es-grade' }, ...re.lista.map((r) => kit.cartao(
        kit.topo(r.titulo, r.descricao, r.porMes ? kit.selo('Mensal', 'info') : null),
        kit.botoes(kit.btn('Baixar planilha', async () => { await baixarArquivo(`/api/relatorios/${r.id}${r.porMes ? `?mes=${re.mes || f.mes}` : ''}`, `${r.id}.xlsx`); }, 'botao primario pequeno'))))));
  }
  window.reMostrar = reMostrar;

  /* ===== Certificados ===== */
  const ce = { dados: null, erro: null, filtro: 'todos', busca: '' };
  async function ceMostrar() {
    $('tela-certificados').hidden = false; window.scrollTo(0, 0);
    try { ce.dados = await chamar('/api/certificados'); ce.erro = null; } catch (e) { ce.erro = e.message; }
    ceRender();
  }
  function ceRender() {
    const alvo = $('ce-conteudo');
    if (ce.erro) return alvo.replaceChildren(kit.erro('Não foi possível abrir os certificados.', ce.erro));
    if (!ce.dados) return alvo.replaceChildren(kit.carregando());
    const t = ce.dados.totais;
    const lista = ce.dados.certificados.filter((c) => (ce.filtro === 'todos' || c.situacao === ce.filtro) && (!ce.busca || `${c.razao_social} ${c.cnpj} ${c.titular || ''}`.toLowerCase().includes(ce.busca.toLowerCase())));
    const filtroBtn = (id, rot, n) => h('button', { type: 'button', class: `aba-tela${ce.filtro === id ? ' ativa' : ''}`, onclick: () => { ce.filtro = id; ceRender(); } }, `${rot}${n !== undefined ? ` (${esN(n)})` : ''}`);
    alvo.replaceChildren(
      kit.kpis([
        { rotulo: 'Vencidos', valor: esN(t.vencidos), tom: t.vencidos ? 'problema' : 'ok', icone: 'shield-x' },
        { rotulo: 'Vencem em até 30 dias', valor: esN(t.vencendo), tom: t.vencendo ? 'atencao' : 'ok', icone: 'clock-alert' },
        { rotulo: 'Sem certificado', valor: esN(t.sem), tom: t.sem ? 'pendente' : 'ok', icone: 'key-round', meta: 'Captação de notas desligada' },
        { rotulo: 'Em dia', valor: esN(t.emDia), tom: 'ok', icone: 'shield-check' },
      ]),
      kit.cartao(
        h('div', { class: 'abas-tela', role: 'tablist' }, filtroBtn('todos', 'Todos'), filtroBtn('vencido', 'Vencidos', t.vencidos), filtroBtn('vencendo', 'Vencendo', t.vencendo), filtroBtn('sem_certificado', 'Sem certificado', t.sem), filtroBtn('em_dia', 'Em dia', t.emDia)),
        h('input', { type: 'search', class: 'cl-busca', placeholder: 'Buscar por empresa, CNPJ ou titular', value: ce.busca, oninput: (ev) => { ce.busca = ev.currentTarget.value; ceRender(); const b = $('ce-conteudo').querySelector('input[type=search]'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }),
        h('p', { class: 'meta', text: 'Para trocar o certificado, abra a empresa e envie o novo arquivo pelo cadastro (o arquivo e a senha vão direto para o servidor, cifrados).' }),
        lista.length ? kit.tabela(['Empresa', 'Titular', 'Válido até', 'Situação', ''], lista.map((c) => h('tr', { class: c.ativo ? '' : 'desativado' },
          h('td', {}, h('strong', { text: c.razao_social }), h('span', { class: 'sub', text: formatarCnpj(c.cnpj) })), h('td', { text: c.titular || '—' }),
          h('td', {}, esData(c.valido_ate), c.dias !== null ? h('span', { class: 'sub', text: esDias(c.dias) }) : null),
          h('td', {}, kit.selo(ES_SITUACAO[c.situacao].texto, ES_SITUACAO[c.situacao].tom)),
          h('td', {}, h('a', { class: 'botao pequeno', href: enderecoEmpresa(c.id) }, 'Abrir empresa'))))) : kit.vazio('Nenhuma empresa neste filtro.')));
  }
  window.ceMostrar = ceMostrar;

  /* ===== Configurações ===== */
  const cf = { dados: null, erro: null };
  async function cfMostrar() {
    $('tela-configuracoes').hidden = false; window.scrollTo(0, 0);
    try { cf.dados = await chamar('/api/configuracoes/resumo'); cf.erro = null; } catch (e) { cf.erro = e.message; }
    cfRender();
  }
  function cfRender() {
    const alvo = $('cf-conteudo');
    if (cf.erro) return alvo.replaceChildren(kit.erro('Não foi possível abrir as configurações.', cf.erro));
    if (!cf.dados) return alvo.replaceChildren(kit.carregando());
    const d = cf.dados;
    const item = (titulo, situacao, tom, texto, link, rotLink) => kit.cartao(kit.topo(titulo, texto, kit.selo(situacao, tom)), link ? kit.botoes(h('a', { class: 'botao pequeno', href: link }, rotLink || 'Ajustar')) : null);
    const falhou = (x) => x && x.erro;
    const blocos = [];
    blocos.push(falhou(d.integra) ? item('Integra Contador (SERPRO)', 'Erro', 'problema', d.integra.erro, '#/escritorio')
      : item('Integra Contador (SERPRO)', d.integra.configurado && !d.integra.pendencias.length ? 'Configurado' : 'Pendente', d.integra.configurado && !d.integra.pendencias.length ? 'ok' : 'atencao',
        d.integra.pendencias.length ? d.integra.pendencias.join(' ') : `Ambiente: ${d.integra.ambiente || '—'}${d.integra.escritorio ? ` · ${d.integra.escritorio.razao_social} · certificado até ${esData(d.integra.escritorio.certificadoValidoAte)}` : ''}. Usado para guias, DCTFWeb, PGDAS-D e caixa postal.`, '#/escritorio'));
    blocos.push(falhou(d.acessorias) ? item('Acessórias', 'Erro', 'problema', d.acessorias.erro, '#/escritorio')
      : item('Acessórias', d.acessorias.configurado ? 'Configurado' : 'Não configurado', d.acessorias.configurado ? 'ok' : 'neutro',
        d.acessorias.configurado ? `Envio automático ${d.acessorias.envioAutomatico ? 'ligado' : 'desligado'} · ${esN(d.acessorias.envios30d.total)} envios em 30 dias (${esN(d.acessorias.envios30d.erros)} com erro).` : 'Entrega de guias e documentos aos clientes pela Acessórias.', '#/escritorio'));
    blocos.push(item('Tabela de ICMS-ST (ES)', d.st.regras ? `${esN(d.st.regras)} regras` : 'Vazia', d.st.regras ? 'ok' : 'problema', 'NCM/CEST e MVA usados no cálculo de ST na entrada.', '#/icms-st', 'Abrir ICMS-ST'));
    blocos.push(falhou(d.contabil) ? item('Contábil', 'Erro', 'problema', d.contabil.erro, '#/contabil/processar')
      : item('Contábil', d.contabil && d.contabil.valor_fiscal ? 'Configurado' : 'Pendente', d.contabil && d.contabil.valor_fiscal ? 'ok' : 'atencao',
        d.contabil && d.contabil.valor_fiscal ? 'Valor contábil das notas definido. Regras, plano e empresas ficam no Contábil.' : 'Falta o Fiscal definir qual valor da nota contabilizar (as notas ficam pendentes até lá).', '#/contabil/processar', 'Abrir Contábil'));
    blocos.push(falhou(d.integracoes) ? item('Integrações por API', 'Erro', 'problema', d.integracoes.erro, '#/integracoes')
      : item('Integrações por API', `${esN(d.integracoes.ativas)} ativa${d.integracoes.ativas === 1 ? '' : 's'}`, d.integracoes.ativas ? 'ok' : 'neutro', 'Sistemas que leem as notas pelo Appura (token por integração e webhook).', '#/integracoes'));
    blocos.push(item('Appura Coletor', d.coletores ? `${esN(d.coletores)} instalaç${d.coletores === 1 ? 'ão' : 'ões'}` : 'Nenhuma', d.coletores ? 'ok' : 'neutro', 'Programa que envia os XML das máquinas dos clientes.', '#/coletores'));
    blocos.push(item('Usuários', `${esN(d.usuarios)} ativo${d.usuarios === 1 ? '' : 's'}`, 'info', 'Perfis de acesso por módulo e ação, com escopo de empresas.', '#/usuarios'));
    alvo.replaceChildren(h('div', { class: 'es-grade' }, ...blocos),
      kit.cartao(kit.topo('Módulos do escritório', 'Módulo desligado some do menu de todos. Ligar e desligar fica em Perfis de acesso.'),
        kit.tabela(['Módulo', 'Situação'], (d.modulos || []).map((m) => h('tr', {}, h('td', { text: m.nome }), h('td', {}, kit.selo(m.ativo ? 'Ligado' : 'Desligado', m.ativo ? 'ok' : 'neutro'))))),
        kit.botoes(h('a', { class: 'botao pequeno', href: '#/perfis' }, 'Perfis de acesso'))));
  }
  window.cfMostrar = cfMostrar;
}
