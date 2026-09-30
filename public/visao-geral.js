'use strict';
/*
 * Visão Geral (home) e Central de Fechamento.
 * Usa os utilitários globais do app.js (h, $, chamar, icone, competencia, grupoDe...).
 * Regra: só números que vêm do banco. O que ainda não existe aparece como "Não disponível".
 */

/* ---------- cálculo (funções puras, testadas em test/visao-geral.test.ts) ---------- */
const VG_STATUS_BLOQUEIO = ['sem_certificado', 'certificado_vencido'];
const VG_STATUS_ATENCAO = ['erro', 'atrasada', 'conflito_nsu'];
const VG_POR_PAGINA = 20;
const VG_POR_PAGINA_CELULAR = 8;

/** Situação da captação (XML) de uma empresa: tom + texto curto. */
function vgXml(e) {
  if (!e.ativo) return { tom: 'neutro', simbolo: '–', texto: 'Pausada' };
  if (VG_STATUS_BLOQUEIO.includes(e.status)) return { tom: 'problema', simbolo: '✕', texto: e.status === 'sem_certificado' ? 'Sem certificado' : 'Certificado vencido' };
  if (VG_STATUS_ATENCAO.includes(e.status)) return { tom: 'atencao', simbolo: '!', texto: e.status === 'atrasada' ? 'Captação atrasada' : e.status === 'conflito_nsu' ? 'Outro sistema consultou' : 'Erro na consulta' };
  if (e.status === 'aguardando') return { tom: 'neutro', simbolo: '–', texto: 'Aguardando 1ª captação' };
  return { tom: 'ok', simbolo: '✓', texto: `${e.notas_mes} nota${e.notas_mes === 1 ? '' : 's'}` };
}

/** Situação da auditoria da competência. */
function vgAuditoria(e) {
  if (!e.notas_mes) return { tom: 'neutro', simbolo: '–', texto: 'Sem notas' };
  if (e.nao_auditadas > 0) return { tom: 'info', simbolo: '●', texto: 'Auditando' };
  if (e.apont_abertos > 0) return { tom: 'pendente', simbolo: '!', texto: `${e.apont_abertos} pendência${e.apont_abertos === 1 ? '' : 's'}` };
  return { tom: 'ok', simbolo: '✓', texto: 'Auditada' };
}

const vgPlural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

/** Arquivos SPED da competência (Fiscal e Contribuições): não enviado, com erros ou recebido. */
function vgSped(e) {
  const f = e.sped; const c = e.contrib;
  if (!f && !c) return { tom: 'neutro', simbolo: '–', texto: 'Não enviado' };
  const erros = (f ? f.erros : 0) + (c ? c.erros : 0);
  if (erros > 0) return { tom: 'pendente', simbolo: '!', texto: vgPlural(erros, 'erro no arquivo', 'erros no arquivo') };
  const quais = f && c ? 'Fiscal e Contrib.' : f ? 'Fiscal recebido' : 'Contrib. recebido';
  const alertas = (f ? f.alertas : 0) + (c ? c.alertas : 0);
  return { tom: 'ok', simbolo: '✓', texto: alertas ? `${quais} · ${vgPlural(alertas, 'alerta', 'alertas')}` : quais };
}

/** Validação: XML × SPED Fiscal e SPED Fiscal × Contribuições (nota a nota). */
function vgValidacao(e) {
  const f = e.sped; const c = e.contrib;
  if (!f && !c) return { tom: 'neutro', simbolo: '–', texto: 'Aguardando SPED' };
  const n = [f && f.divergencias, c && c.divergencias].filter((x) => x !== null && x !== undefined && x !== false);
  if (!n.length) return { tom: 'neutro', simbolo: '–', texto: 'Sem comparação' };
  const total = n.reduce((t, x) => t + x, 0);
  if (total > 0) return { tom: 'pendente', simbolo: '!', texto: vgPlural(total, 'divergência', 'divergências') };
  return { tom: 'ok', simbolo: '✓', texto: f ? 'XML e SPED conferem' : 'Conferido' };
}

/** Status geral do fechamento da empresa (sem "Concluído" enquanto as guias não existirem). */
function vgGeral(e) {
  if (!e.ativo) return { tom: 'neutro', chave: 'pausada', texto: 'Pausada' };
  const x = vgXml(e);
  if (x.tom === 'problema') return { tom: 'problema', chave: 'bloqueado', texto: 'Bloqueado' };
  if (vgPendencias(e).length) return { tom: 'pendente', chave: 'pendencias', texto: 'Com pendências' };
  return { tom: 'info', chave: 'andamento', texto: 'Em andamento' };
}

function vgNoMes(iso, comp) { return !!iso && String(iso).slice(0, 7) === comp; }
function vgDiasDoMes(comp) { const [a, m] = comp.split('-').map(Number); return new Date(a, m, 0).getDate(); }

/** Calcula tudo o que a tela mostra a partir da resposta de /api/visao-geral. */
function vgCalcular(dados, regime, hojeISO) {
  const comp = String(dados.competencia).slice(0, 7);
  const casaRegime = (e) => !regime || (regime === 'nao_informado' ? !e.regime : e.regime === regime);
  const lista = dados.empresas.filter(casaRegime);
  const ativas = lista.filter((e) => e.ativo);
  const base = ativas.length;
  const ids = new Set(ativas.map((e) => e.id));
  const conta = (f) => ativas.filter(f).length;

  const xmlEmDia = conta((e) => vgXml(e).tom === 'ok');
  const comNotas = ativas.filter((e) => e.notas_mes > 0);
  const auditadas = comNotas.filter((e) => vgAuditoria(e).tom === 'ok').length;
  const comPendencias = conta((e) => vgGeral(e).chave === 'bloqueado' || vgGeral(e).chave === 'pendencias');
  const certVencidos = conta((e) => e.status === 'certificado_vencido');
  const comSped = ativas.filter((e) => e.sped || e.contrib);

  const kpis = {
    empresas: base,
    novas: conta((e) => vgNoMes(e.criado_em, comp)),
    xmlEmDia,
    comPendencias,
    certVencidos,
    certVencendo: conta((e) => e.status === 'certificado_vencendo'),
  };

  const etapas = [
    { id: 'xml', nome: 'Captação de XML', icone: 'cloud-download', tom: 'info', feito: xmlEmDia, total: base },
    { id: 'auditoria', nome: 'Auditoria das notas', icone: 'shield-check', tom: 'ok', feito: auditadas, total: comNotas.length, semTotal: 'Nenhuma empresa com notas na competência' },
    { id: 'st', nome: 'ICMS-ST (entradas)', icone: 'calculator', indisponivel: 'Sob demanda' },
    { id: 'sped', nome: 'SPED recebido sem erros', icone: 'file-spreadsheet', tom: 'progresso', feito: comSped.filter((e) => vgSped(e).tom === 'ok').length, total: base },
    { id: 'validacao', nome: 'Validação XML × SPED', icone: 'file-check', tom: 'ok', feito: comSped.filter((e) => vgValidacao(e).tom === 'ok').length, total: base },
    { id: 'guias', nome: 'Guias (DUA, DAS etc.)', icone: 'receipt', indisponivel: 'Não disponível' },
  ];

  // Evolução: do dia 1 até o fim do mês (ou até hoje, se for o mês corrente)
  const ultimoDia = vgDiasDoMes(comp);
  const hoje = String(hojeISO).slice(0, 10);
  const limite = hoje.slice(0, 7) === comp ? Number(hoje.slice(8, 10)) : hoje < `${comp}-01` ? 0 : ultimoDia;
  const dias = Array.from({ length: limite }, (_, i) => i + 1);
  const acumular = (porDia, total) => {
    let soma = 0;
    return dias.map((d) => { soma += porDia.get(d) || 0; return total ? Math.min(100, Math.round((soma / total) * 1000) / 10) : 0; });
  };
  const series = [];
  const capt = dados.captacao.filter((c) => ids.has(c.empresa_id) && String(c.dia).slice(0, 7) === comp);
  if (base && capt.length) {
    const porDia = new Map();
    for (const c of capt) { const d = Number(String(c.dia).slice(8, 10)); porDia.set(d, (porDia.get(d) || 0) + 1); }
    series.push({ id: 'xml', nome: 'XML', cor: 'info', valores: acumular(porDia, base), descricao: 'Empresas com notas da competência recebidas' });
  }
  const totalApont = ativas.reduce((t, e) => t + e.apont_total, 0);
  const trat = dados.auditoria.filter((a) => ids.has(a.empresa_id) && String(a.dia).slice(0, 7) === comp);
  if (totalApont) {
    const porDia = new Map();
    for (const a of trat) { const d = Number(String(a.dia).slice(8, 10)); porDia.set(d, (porDia.get(d) || 0) + a.n); }
    series.push({ id: 'auditoria', nome: 'Auditoria', cor: 'ok', valores: acumular(porDia, totalApont), descricao: 'Apontamentos da competência já tratados' });
  }

  const porStatus = (lst) => conta((e) => lst.includes(e.status));
  const atencao = [
    { id: 'cert-vencido', texto: 'Certificados vencidos', tom: 'problema', icone: 'shield-x', n: certVencidos, destino: { empresasStatus: ['certificado_vencido'] } },
    { id: 'sem-cert', texto: 'Empresas sem certificado', tom: 'problema', icone: 'key-round', n: porStatus(['sem_certificado']), destino: { empresasStatus: ['sem_certificado'] } },
    { id: 'captacao', texto: 'Captação com erro ou atrasada', tom: 'atencao', icone: 'clock-alert', n: porStatus(VG_STATUS_ATENCAO), destino: { empresasStatus: VG_STATUS_ATENCAO } },
    { id: 'auditoria', texto: 'Auditorias pendentes', tom: 'pendente', icone: 'shield-alert', n: conta((e) => e.apont_abertos > 0), destino: { central: 'auditoria' } },
    { id: 'cert-vencendo', texto: 'Certificados vencendo em 30 dias', tom: 'pendente', icone: 'triangle-alert', n: kpis.certVencendo, destino: { empresasStatus: ['certificado_vencendo'] } },
    { id: 'lacunas', texto: 'Empresas com notas faltantes (NSU)', icone: 'file-warning', breve: true },
    { id: 'sped', texto: 'Divergências SPED × XML', tom: 'pendente', icone: 'file-spreadsheet', n: conta((e) => vgPendencias(e).some((p) => p.etapa === 'validacao')), destino: { central: 'validacao' } },
    { id: 'sped-erros', texto: 'SPED com erros no arquivo', tom: 'pendente', icone: 'file-warning', n: conta((e) => vgPendencias(e).some((p) => p.etapa === 'sped')), destino: { central: 'sped' } },
    { id: 'cadastros', texto: 'Cadastros do SPED para conferir', tom: 'info', icone: 'building-2', n: Number(dados.cadastrosPendentes || 0), destino: { rota: '#/sped' } },
    { id: 'st', texto: 'Empresas sem ST calculado', icone: 'calculator', breve: true },
    { id: 'guias', texto: 'Guias não geradas', icone: 'receipt', breve: true },
  ];

  return { comp, lista, ativas, kpis, etapas, dias, series, atencao };
}

/** Filtra as linhas da Central. */
function vgFiltrarCentral(lista, { termo = '', status = '', foco = '' } = {}) {
  const t = termo.trim().toLowerCase();
  const td = t.replace(/\D/g, '');
  return lista.filter((e) =>
    (!t || e.razao_social.toLowerCase().includes(t) || (td && e.cnpj.includes(td))) &&
    (!status || vgGeral(e).chave === status) &&
    (foco !== 'auditoria' || e.apont_abertos > 0));
}

/* ---------- Central de Fechamento: prioridade, pendências, filtros e ordenação ---------- */
const FC_ORDEM_STATUS = { bloqueado: 0, pendencias: 1, andamento: 2, concluido: 3, pausada: 4 };

/** Pendências que pedem ação na empresa (texto curto + tom), da mais grave para a mais leve. */
function vgPendencias(e) {
  const lista = [];
  if (!e.ativo) return lista;
  const x = vgXml(e);
  if (x.tom === 'problema' || x.tom === 'atencao') lista.push({ etapa: 'xml', tom: x.tom, texto: x.texto, n: 1 });
  if (e.apont_abertos > 0) lista.push({ etapa: 'auditoria', tom: 'pendente', texto: `${e.apont_abertos} na auditoria`, n: e.apont_abertos });
  if (e.sped && e.sped.erros > 0) lista.push({ etapa: 'sped', tom: 'pendente', texto: `SPED: ${vgPlural(e.sped.erros, 'erro', 'erros')} no arquivo`, n: e.sped.erros });
  if (e.sped && e.sped.divergencias > 0) lista.push({ etapa: 'validacao', tom: 'pendente', texto: vgPlural(e.sped.divergencias, 'divergência SPED × XML', 'divergências SPED × XML'), n: e.sped.divergencias });
  if (e.contrib && e.contrib.erros > 0) lista.push({ etapa: 'sped', tom: 'pendente', texto: `SPED Contribuições: ${vgPlural(e.contrib.erros, 'erro', 'erros')}`, n: e.contrib.erros });
  if (e.contrib && e.contrib.divergencias > 0) lista.push({ etapa: 'validacao', tom: 'pendente', texto: vgPlural(e.contrib.divergencias, 'divergência Fiscal × Contribuições', 'divergências Fiscal × Contribuições'), n: e.contrib.divergencias });
  return lista;
}
function vgQtdPendencias(e) { return vgPendencias(e).reduce((t, p) => t + p.n, 0); }

/** Precisa de atenção = bloqueada ou com pendências (o que o analista precisa tratar). */
function vgPrecisaAtencao(e) { const k = vgGeral(e).chave; return k === 'bloqueado' || k === 'pendencias'; }

function fcContadores(lista) {
  const ativas = lista.filter((e) => e.ativo);
  const c = { total: ativas.length, bloqueado: 0, pendencias: 0, andamento: 0, concluido: 0, pausada: lista.length - ativas.length };
  for (const e of ativas) c[vgGeral(e).chave]++;
  return c;
}

/**
 * Filtros da Central. status: bloqueado | pendencias | andamento | concluido | pausada ('' = todas as ativas).
 * etapa: xml | auditoria (só empresas com pendência nessa etapa).
 */
function fcFiltrar(lista, f = {}) {
  const t = (f.termo || '').trim().toLowerCase();
  const td = t.replace(/\D/g, '');
  const regime = f.regime || '';
  return lista.filter((e) => {
    const g = vgGeral(e).chave;
    if (f.status ? g !== f.status : g === 'pausada') return false;
    if (regime && (regime === 'nao_informado' ? e.regime : e.regime !== regime)) return false;
    if (f.responsavel && e.responsavel !== f.responsavel) return false;
    if (f.soBloqueados && g !== 'bloqueado') return false;
    if (f.atencao && !vgPrecisaAtencao(e)) return false;
    if (f.etapa && !vgPendencias(e).some((p) => p.etapa === f.etapa)) return false;
    if (t && !(e.razao_social.toLowerCase().includes(t) || (td && e.cnpj.includes(td)))) return false;
    return true;
  });
}

const vgUltimaAtualizacao = (e) => [e.ultima_sync_ok_em, e.ultima_nota_em].filter(Boolean).sort().pop() || '';

/** Ordenação: criticidade (padrão), empresa, atualização (mais antiga primeiro) ou pendências. */
function fcOrdenar(lista, ordem = 'criticidade') {
  const nome = (a, b) => a.razao_social.localeCompare(b.razao_social, 'pt-BR');
  const crit = (a, b) => (FC_ORDEM_STATUS[vgGeral(a).chave] - FC_ORDEM_STATUS[vgGeral(b).chave]) || (vgQtdPendencias(b) - vgQtdPendencias(a)) || nome(a, b);
  const cmp = {
    criticidade: crit,
    empresa: nome,
    atualizacao: (a, b) => (vgUltimaAtualizacao(a) || '0').localeCompare(vgUltimaAtualizacao(b) || '0') || nome(a, b),
    pendencias: (a, b) => (vgQtdPendencias(b) - vgQtdPendencias(a)) || crit(a, b),
  }[ordem] || crit;
  return [...lista].sort(cmp);
}

if (typeof module !== 'undefined') module.exports = { vgXml, vgAuditoria, vgSped, vgValidacao, vgGeral, vgCalcular, vgFiltrarCentral, vgPendencias, vgQtdPendencias, vgPrecisaAtencao, fcContadores, fcFiltrar, fcOrdenar };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  var vg = { dados: null, carregando: false, erro: null, regime: '', pedido: 0 };

  var vgTitulo = (texto, extra) => h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: texto }), extra || null);
  var vgPct = (feito, total) => (total ? Math.round((feito / total) * 1000) / 10 : 0);
  var vgNum = (n) => Number(n).toLocaleString('pt-BR');
  var vgPctTexto = (v) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  var vgMesCurto = (comp) => { const [a, m] = comp.split('-').map(Number); return `${MESES[m - 1]}/${a}`; };

  var vgSkeleton = () => h('div', { class: 'vg-skel', 'aria-hidden': 'true' });

  function vgMostrar() {
    $('tela-empresas').hidden = true;
    $('tela-notas').hidden = true;
    $('tela-usuarios').hidden = true;
    $('tela-visao').hidden = false;
    window.scrollTo(0, 0);
    iniciarAtualizacao();
    vgCarregar();
  }

  /** Carrega /api/visao-geral (mesma resposta para a Visão Geral e a Central) e redesenha a tela aberta. */
  async function vgCarregar() {
    const pedido = ++vg.pedido;
    const primeira = !vg.dados || vg.dados.competencia.slice(0, 7) !== competencia;
    vg.carregando = true;
    vg.erro = null;
    if (primeira) { vg.dados = null; vgRenderTudo(); }
    try {
      const d = await chamar(`/api/visao-geral?mes=${competencia}`);
      if (pedido !== vg.pedido) return;
      vg.dados = d;
    } catch (e) {
      if (pedido !== vg.pedido) return;
      vg.erro = e.message;
    } finally {
      if (pedido === vg.pedido) { vg.carregando = false; vgRenderTudo(); }
    }
  }

  function vgRenderTudo() {
    if (!$('tela-visao').hidden) vgRender();
    if (!$('tela-fechamento').hidden) fcRender();
  }

  function vgRender() {
    if ($('tela-visao').hidden) return;
    const comp = competencia;
    $('vg-etapas-titulo-mes').textContent = vgMesCurto(comp);
    if (vg.erro && !vg.dados) {
      const erro = h('div', { class: 'vg-erro', role: 'alert' },
        h('strong', { text: 'Não foi possível carregar a Visão Geral.' }), h('span', { text: vg.erro }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: vgCarregar }, icone('refresh-cw'), 'Tentar de novo'));
      for (const id of ['vg-kpis', 'vg-evolucao', 'vg-etapas', 'vg-atencao', 'vg-central']) $(id).replaceChildren(id === 'vg-kpis' ? erro : '');
      return;
    }
    if (!vg.dados) {
      $('vg-kpis').replaceChildren(...Array.from({ length: 5 }, () => h('div', { class: 'vg-kpi carregando' }, vgSkeleton(), vgSkeleton())));
      for (const id of ['vg-evolucao', 'vg-etapas', 'vg-atencao', 'vg-central']) $(id).replaceChildren(vgSkeleton(), vgSkeleton(), vgSkeleton());
      $('vg-atualizado').textContent = 'Carregando…';
      return;
    }
    const c = vgCalcular(vg.dados, vg.regime, new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }));
    const gerado = new Date(vg.dados.geradoEm);
    $('vg-atualizado').textContent = `Última atualização: ${gerado.toLocaleDateString('pt-BR')} ${gerado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    vgRenderKpis(c);
    vgRenderEvolucao(c);
    vgRenderEtapas(c);
    vgRenderAtencao(c);
    vgRenderCentral(c);
  }

  /** Atalho "Pendências" da navegação do celular: Central filtrada por empresas com pendências. */
  function vgFocarPendencias() { irPara('#/fechamento?atencao=1'); }

  /** Ícone "?" com explicação curta: aparece ao passar o mouse, ao focar com o teclado ou ao tocar. */
  var vgAjudaSeq = 0;
  function vgAjuda(texto) {
    const id = `ajuda-${++vgAjudaSeq}`;
    const caixa = h('span', { class: 'ajuda-texto', role: 'tooltip', id, text: texto });
    const botao = h('button', {
      type: 'button', class: 'ajuda', 'aria-label': 'O que significa?', 'aria-describedby': id, 'aria-expanded': 'false',
      onclick: (ev) => { ev.stopPropagation(); const ab = botao.getAttribute('aria-expanded') !== 'true'; fecharAjudas(); botao.setAttribute('aria-expanded', String(ab)); },
    }, '?');
    return h('span', { class: 'ajuda-caixa' }, botao, caixa);
  }
  function fecharAjudas() { for (const b of document.querySelectorAll('.ajuda[aria-expanded="true"]')) b.setAttribute('aria-expanded', 'false'); }

  function vgKpi(icone_, tom, valor, rotulo, meta, extra, ajuda) {
    return h('div', { class: 'vg-kpi' },
      h('span', { class: `vg-kpi-icone ${tom}` }, icone(icone_)),
      h('div', { class: 'vg-kpi-corpo' },
        h('span', { class: `vg-kpi-valor${tom === 'problema' || tom === 'atencao' ? ` ${tom}` : ''}`, text: valor }),
        h('span', { class: 'vg-kpi-rotulo' }, rotulo, ajuda ? vgAjuda(ajuda) : null),
        meta ? h('span', { class: 'vg-kpi-meta', text: meta }) : null,
        extra || null));
  }

  function vgRenderKpis(c) {
    const k = c.kpis;
    const b = k.empresas;
    if (!c.lista.length) {
      $('vg-kpis').replaceChildren(h('div', { class: 'vg-vazio' },
        h('strong', { text: vg.regime ? 'Nenhuma empresa nesse regime.' : 'Nenhuma empresa cadastrada ainda.' }),
        h('span', { text: vg.regime ? 'Escolha outro regime no filtro acima.' : 'Cadastre a primeira empresa com o certificado A1 para começar.' }),
        vg.regime ? null : h('a', { class: 'botao pequeno primario', href: '#/empresas' }, 'Ir para Empresas')));
      return;
    }
    $('vg-kpis').replaceChildren(
      vgKpi('building-2', 'info', vgNum(b), 'Empresas ativas', k.novas ? `+${k.novas} cadastrada${k.novas === 1 ? '' : 's'} na competência` : 'Nenhuma nova na competência'),
      vgKpi('cloud-download', 'ok', vgNum(k.xmlEmDia), 'Captação regular', `${vgPctTexto(vgPct(k.xmlEmDia, b))} da base · situação atual`, null,
        'Empresas ativas com certificado válido cuja consulta à SEFAZ está funcionando: sem erro, sem atraso e já com a primeira captação feita. Mostra a situação de agora, não se todas as notas da competência já chegaram.'),
      vgKpi('triangle-alert', k.comPendencias ? 'atencao' : 'ok', vgNum(k.comPendencias), 'Com pendências', `${vgPctTexto(vgPct(k.comPendencias, b))} da base`, null,
        'Empresas ativas com pelo menos uma destas situações: sem certificado ou certificado vencido; erro, atraso ou conflito na consulta à SEFAZ; apontamentos abertos na auditoria; ou SPED da competência com erro no arquivo ou divergência com os XMLs.'),
      vgKpi('shield-x', k.certVencidos ? 'problema' : 'ok', vgNum(k.certVencidos), 'Certificados vencidos', k.certVencendo ? `${k.certVencendo} vence${k.certVencendo === 1 ? '' : 'm'} em 30 dias` : 'Nenhum vencendo em 30 dias'),
      h('div', { class: 'vg-kpi vg-kpi-fechamento secundario', 'aria-disabled': 'true' },
        h('span', { class: 'vg-kpi-icone neutro' }, icone('gauge')),
        h('div', { class: 'vg-kpi-corpo' },
          h('span', { class: 'vg-kpi-valor indisponivel', text: 'Em breve' }),
          h('span', { class: 'vg-kpi-rotulo', text: 'Fechamento do mês' }),
          h('span', { class: 'vg-kpi-meta', text: 'Depende de SPED, validação e guias' }),
          h('span', { class: 'vg-barra vazia', role: 'img', 'aria-label': 'Fechamento do mês ainda não disponível' }, h('span')))),
    );
  }

  function vgRenderEvolucao(c) {
    const alvo = $('vg-evolucao');
    const topo = vgTitulo('Evolução do fechamento');
    if (!c.series.length || !c.dias.length) {
      alvo.replaceChildren(topo, h('div', { class: 'vg-vazio pequeno' },
        h('strong', { text: 'Sem histórico nesta competência.' }),
        h('span', { text: 'A curva aparece quando chegarem notas ou forem tratados apontamentos da auditoria. SPED, ICMS-ST e guias entram quando esses módulos existirem.' })));
      return;
    }
    // Largura real do card: o texto dos eixos fica sempre no mesmo tamanho
    const W = Math.max(300, Math.round((alvo.clientWidth || 560) - 36)); const H = W < 420 ? 200 : 240; const m = { t: 12, r: 12, b: 28, l: 40 };
    const iw = W - m.l - m.r; const ih = H - m.t - m.b;
    const nDias = vgDiasDoMes(c.comp);
    const x = (d) => m.l + ((d - 1) / Math.max(1, nDias - 1)) * iw;
    const y = (v) => m.t + ih - (v / 100) * ih;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'vg-grafico');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Evolução percentual em ${vgMesCurto(c.comp)}: ${c.series.map((s) => `${s.nome} ${vgPctTexto(s.valores[s.valores.length - 1])}`).join(', ')}`);
    const el = (tag, attrs, texto) => {
      const n = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
      if (texto !== undefined) n.textContent = texto;
      svg.append(n);
      return n;
    };
    for (const v of [0, 25, 50, 75, 100]) {
      el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: 'vg-grade' });
      el('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'vg-eixo' }, `${v}%`);
    }
    const marcas = (W < 420 ? [1, 10, 20, nDias] : [1, 5, 10, 15, 20, 25, nDias]).filter((d, i, a) => d <= nDias && a.indexOf(d) === i);
    const mm = c.comp.slice(5, 7);
    for (const d of marcas) el('text', { x: x(d), y: H - 8, 'text-anchor': d === 1 ? 'start' : d === nDias ? 'end' : 'middle', class: 'vg-eixo' }, `${String(d).padStart(2, '0')}/${mm}`);
    for (const s of c.series) {
      const pts = s.valores.map((v, i) => `${x(c.dias[i]).toFixed(1)},${y(v).toFixed(1)}`);
      el('polyline', { points: pts.join(' '), class: `vg-linha ${s.cor}` });
      const ult = s.valores.length - 1;
      el('circle', { cx: x(c.dias[ult]), cy: y(s.valores[ult]), r: 4, class: `vg-ponto ${s.cor}` });
    }
    alvo.replaceChildren(topo,
      h('div', { class: 'vg-grafico-caixa' }, svg),
      h('ul', { class: 'vg-legenda' }, ...c.series.map((s) => h('li', { title: s.descricao },
        h('span', { class: `vg-legenda-ponto ${s.cor}` }), `${s.nome} `, h('strong', { text: vgPctTexto(s.valores[s.valores.length - 1]) }))),
        h('li', { class: 'vg-legenda-breve', text: 'SPED: veja nas etapas · ICMS-ST e Guias: em breve' })));
  }

  function vgRenderEtapas(c) {
    $('vg-etapas').replaceChildren(...c.etapas.map((e) => {
      const cab = [h('span', { class: `vg-etapa-icone ${e.indisponivel ? 'neutro' : e.tom}` }, icone(e.icone)), h('span', { class: 'vg-etapa-nome', text: e.nome })];
      if (e.indisponivel) {
        return h('li', { class: 'vg-etapa indisponivel' }, ...cab, h('span', { class: 'vg-etapa-na', text: e.indisponivel }));
      }
      if (!e.total) {
        return h('li', { class: 'vg-etapa indisponivel' }, ...cab, h('span', { class: 'vg-etapa-na', text: e.semTotal || 'Sem dados' }));
      }
      const p = vgPct(e.feito, e.total);
      const barra = h('span', { class: `vg-barra ${e.tom}`, role: 'progressbar', 'aria-valuenow': String(Math.round(p)), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': e.nome }, h('span'));
      barra.firstChild.style.width = `${p}%`;
      return h('li', { class: 'vg-etapa' }, ...cab, barra,
        h('span', { class: 'vg-etapa-pct', text: vgPctTexto(p) }),
        h('span', { class: 'vg-etapa-qtd', text: `${vgNum(e.feito)} de ${vgNum(e.total)}` }));
    }));
  }

  function vgIrDestino(destino) {
    if (destino.central) { irPara(`#/fechamento?etapa=${destino.central}`); return; }
    if (destino.rota) { irPara(destino.rota); return; }
    if (destino.empresasStatus) {
      filtro = `status:${destino.empresasStatus.join(',')}`;
      irPara('#/empresas');
      renderResumo();
      renderLista();
    }
  }

  function vgRenderAtencao(c) {
    $('vg-atencao').replaceChildren(...c.atencao.map((a) => {
      const corpo = [h('span', { class: `vg-atencao-icone ${a.breve ? 'neutro' : a.n ? a.tom : 'ok'}` }, icone(a.icone)), h('span', { class: 'vg-atencao-texto', text: a.texto })];
      if (a.breve) return h('li', {}, h('div', { class: 'vg-atencao-item breve' }, ...corpo, h('span', { class: 'vg-breve', text: 'Em breve' })));
      return h('li', {}, h('button', {
        type: 'button', class: 'vg-atencao-item', onclick: () => vgIrDestino(a.destino),
        'aria-label': `${a.texto}: ${a.n}. Abrir lista`,
      }, ...corpo, h('span', { class: `vg-atencao-n ${a.n ? a.tom : 'zero'}`, text: vgNum(a.n) }), icone('chevron-right', 'icone-svg vg-seta')));
    }));
  }

  function vgCelula(info, destino, rotulo) {
    const conteudo = [h('span', { class: `vg-simbolo ${info.tom}`, 'aria-hidden': 'true', text: info.simbolo }), h('span', { class: `vg-celula-texto${info.compacto ? ' compacto' : ''}`, text: info.texto })];
    if (!destino) return h('span', { class: 'vg-celula', title: `${rotulo}: ${info.texto}` }, ...conteudo);
    return h('a', { class: 'vg-celula link', href: destino, title: `${rotulo}: ${info.texto}` }, ...conteudo);
  }

  function vgLinhaCentral(e) {
    const na = { tom: 'neutro', simbolo: '–', texto: 'Não disponível', compacto: true };
    const st = e.uf === 'ES' ? { tom: 'neutro', simbolo: '–', texto: 'Sob demanda' } : { tom: 'neutro', simbolo: '–', texto: 'Não se aplica' };
    const stTabela = { ...st, compacto: true };
    const g = vgGeral(e);
    const ult = [e.ultima_sync_ok_em, e.ultima_nota_em].filter(Boolean).sort().pop();
    const base = `#/empresas/${e.id}`;
    // Cada chamada cria um elemento novo (a mesma linha aparece na tabela e no cartão do celular)
    const cel = {
      xml: () => vgCelula(vgXml(e), `${base}/notas`, 'XML'),
      aud: () => vgCelula(vgAuditoria(e), e.notas_mes ? `${base}/auditoria` : null, 'Auditoria'),
      st: () => vgCelula(st, e.uf === 'ES' ? `${base}/icms-st` : null, 'ICMS-ST'),
      stTabela: () => vgCelula(stTabela, e.uf === 'ES' ? `${base}/icms-st` : null, 'ICMS-ST'),
      sped: () => vgCelula({ ...vgSped(e), compacto: true }, `${base}/sped`, 'SPED'), val: () => vgCelula({ ...vgValidacao(e), compacto: true }, e.sped || e.contrib ? `${base}/sped` : null, 'Validação'),
      guias: () => vgCelula(na, null, 'Guias'),
    };
    return { e, g, ult, cel };
  }

  var regimeTexto = (r) => (r ? REGIMES[r] || r : 'Não informado');
  var regimeCurto = (r) => ({ simples: 'Simples', presumido: 'Presumido', real: 'Real', mei: 'MEI' }[r] || (r ? r : 'Não inf.'));
  var ehCelularVg = () => window.matchMedia('(max-width: 760px)').matches;

  /** Tabela da Central (usada na prévia da Visão Geral e na página completa). */
  function fcTabela(linhas, { completa = false, comResponsavel = false } = {}) {
    const cols = ['Empresa', 'CNPJ', ...(comResponsavel ? ['Responsável'] : []), 'Regime', 'XML', 'Auditoria', 'ICMS-ST', 'SPED', 'Validação', 'Guias',
      ...(completa ? ['Pendências'] : []), 'Status', 'Atualização', 'Ações'];
    return h('div', { class: 'vg-tabela-caixa' }, h('table', { class: `vg-tabela${completa ? ' completa' : ''}` },
      h('thead', {}, h('tr', {}, ...cols.map((t) => h('th', { scope: 'col', class: { CNPJ: 'vg-col-cnpj', Regime: 'vg-col-regime', 'Pendências': 'num' }[t] || null, text: t })))),
      h('tbody', {}, ...linhas.map((l) => {
        const pend = vgQtdPendencias(l.e);
        return h('tr', { class: `linha-${l.g.chave}` },
          h('td', { class: 'vg-emp' }, h('a', { href: `#/empresas/${l.e.id}`, text: l.e.razao_social }),
            h('span', { class: 'vg-cnpj-sub' }, h('span', { class: 'mono', text: formatarCnpj(l.e.cnpj) }), h('span', { class: 'vg-regime-sub', text: ` · ${regimeCurto(l.e.regime)}` }))),
          h('td', { class: 'mono vg-col-cnpj', text: formatarCnpj(l.e.cnpj) }),
          comResponsavel ? h('td', { text: l.e.responsavel || '—' }) : null,
          h('td', { class: 'vg-col-regime' }, h('span', { class: `vg-regime ${l.e.regime || 'nao-informado'}`, title: regimeTexto(l.e.regime), text: regimeCurto(l.e.regime) })),
          h('td', {}, l.cel.xml()), h('td', {}, l.cel.aud()), h('td', {}, l.cel.stTabela()), h('td', {}, l.cel.sped()), h('td', {}, l.cel.val()), h('td', {}, l.cel.guias()),
          completa ? h('td', { class: 'num' }, pend ? h('span', { class: `fc-pend ${l.g.chave === 'bloqueado' ? 'problema' : 'pendente'}`, title: vgPendencias(l.e).map((p) => p.texto).join(' · '), text: vgNum(pend) }) : h('span', { class: 'fc-pend zero', text: '—' })) : null,
          h('td', {}, h('span', { class: `selo ${l.g.tom}`, text: l.g.texto })),
          h('td', { class: 'vg-data', text: l.ult ? quandoRelativo(l.ult) : '—' }),
          h('td', { class: 'vg-acoes' }, h('a', { class: 'botao-icone', href: `#/empresas/${l.e.id}`, 'aria-label': `Abrir ${l.e.razao_social}`, title: 'Abrir empresa' }, icone('arrow-right'))),
        );
      }))));
  }

  /** Cartões compactos do celular: status geral, principais pendências e "Abrir empresa". */
  function fcCartoes(linhas) {
    return h('ul', { class: 'fc-cartoes' }, ...linhas.map((l) => {
      const pend = vgPendencias(l.e);
      return h('li', { class: `fc-cartao linha-${l.g.chave}` },
        h('div', { class: 'fc-cartao-topo' },
          h('div', { class: 'fc-cartao-id' }, h('strong', { text: l.e.razao_social }),
            h('span', { class: 'fc-cartao-sub' }, h('span', { class: 'mono', text: formatarCnpj(l.e.cnpj) }), ' · ', regimeCurto(l.e.regime))),
          h('span', { class: `selo ${l.g.tom}`, text: l.g.texto })),
        pend.length
          ? h('ul', { class: 'fc-cartao-pend', 'aria-label': 'Pendências' }, ...pend.map((p) => h('li', { class: p.tom },
            h('span', { class: `vg-simbolo ${p.tom}`, 'aria-hidden': 'true', text: p.tom === 'problema' ? '✕' : '!' }), p.texto)))
          : h('p', { class: 'fc-cartao-ok' }, h('span', { class: 'vg-simbolo ok', 'aria-hidden': 'true', text: '✓' }),
            l.e.ativo ? `Sem pendências · ${vgXml(l.e).texto}` : 'Pausada'),
        h('div', { class: 'fc-cartao-rodape' },
          h('span', { class: 'meta', text: l.ult ? `Atualizado ${quandoRelativo(l.ult)}` : 'Sem atualização' }),
          h('a', { class: 'botao primario', href: `#/empresas/${l.e.id}` }, 'Abrir empresa')));
    }));
  }

  /** Prévia na Visão Geral: só as empresas mais críticas (5 no celular, 10 no computador). */
  function vgRenderCentral(c) {
    const alvo = $('vg-central');
    const cont = fcContadores(c.lista);
    const priorizadas = fcOrdenar(fcFiltrar(c.lista, {}), 'criticidade');
    if (!priorizadas.length) {
      alvo.replaceChildren(h('div', { class: 'vg-vazio pequeno' }, h('strong', { text: 'Nenhuma empresa ativa para acompanhar.' })));
      return;
    }
    const celular = ehCelularVg();
    const linhas = priorizadas.slice(0, celular ? 5 : 10).map(vgLinhaCentral);
    $('vg-central-resumo').textContent = `${vgNum(cont.bloqueado)} bloqueada${cont.bloqueado === 1 ? '' : 's'} · ${vgNum(cont.pendencias)} com pendências · ${vgNum(cont.andamento)} em andamento`;
    alvo.replaceChildren(
      celular ? fcCartoes(linhas) : fcTabela(linhas),
      h('div', { class: 'vg-central-rodape' },
        h('span', { class: 'meta', text: `Mostrando as ${linhas.length} mais críticas de ${vgNum(priorizadas.length)} empresas` }),
        h('a', { class: 'botao', href: '#/fechamento' }, 'Ver Central completa', icone('arrow-right'))));
  }

  /* ---------- página da Central de Fechamento (#/fechamento) ---------- */
  var fc = { termo: '', status: '', regime: '', responsavel: '', etapa: '', soBloqueados: false, atencao: false, ordem: 'criticidade', pagina: 1, maisCelular: 1 };
  var FC_POR_PAGINA = 50;
  var FC_POR_LOTE_CELULAR = 20;

  /** Abre a Central; aceita filtros no endereço: #/fechamento?status=bloqueado&etapa=auditoria&atencao=1 */
  function fcMostrar(consulta) {
    const q = new URLSearchParams(consulta || '');
    Object.assign(fc, {
      termo: '', status: q.get('status') || '', regime: q.get('regime') || '', responsavel: '', etapa: q.get('etapa') || '',
      soBloqueados: q.get('bloqueados') === '1', atencao: q.get('atencao') === '1', ordem: q.get('ordem') || 'criticidade', pagina: 1, maisCelular: 1,
    });
    $('fc-busca').value = '';
    $('fc-status').value = fc.status; $('fc-regime').value = fc.regime; $('fc-etapa').value = fc.etapa; $('fc-ordem').value = fc.ordem;
    $('fc-atencao').checked = fc.atencao; $('fc-bloqueados').checked = fc.soBloqueados;
    for (const id of ['tela-visao', 'tela-empresas', 'tela-notas', 'tela-usuarios', 'tela-sped']) $(id).hidden = true;
    $('tela-fechamento').hidden = false;
    window.scrollTo(0, 0);
    iniciarAtualizacao();
    if (vg.dados && vg.dados.competencia.slice(0, 7) === competencia) fcRender();
    vgCarregar();
  }

  function fcContador(chave, rotulo, n, tom, desabilitado, ajuda) {
    const ativo = chave === 'total' ? !fc.status : fc.status === chave;
    return h('div', { class: `fc-contador ${tom}${ativo ? ' ativo' : ''}${desabilitado ? ' desabilitado' : ''}` },
      h('button', {
        type: 'button', 'aria-pressed': String(ativo), disabled: desabilitado,
        onclick: () => { fc.status = chave === 'total' ? '' : chave; $('fc-status').value = fc.status; fc.pagina = 1; fc.maisCelular = 1; fcRender(); },
      }, h('span', { class: 'fc-contador-rotulo' }, tom !== 'total' ? h('span', { class: `ponto ${tom}`, 'aria-hidden': 'true' }) : null, rotulo),
      h('span', { class: 'fc-contador-n', text: desabilitado ? '—' : vgNum(n) })),
      ajuda ? vgAjuda(ajuda) : null);
  }

  function fcRender() {
    if ($('tela-fechamento').hidden) return;
    $('fc-sub').textContent = `Competência ${vgMesCurto(competencia)} · empresas priorizadas pelo que precisa de ação.`;
    const alvo = $('fc-resultado');
    if (vg.erro && !vg.dados) {
      $('fc-contadores').replaceChildren();
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar a Central.' }), h('span', { text: vg.erro }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: vgCarregar }, icone('refresh-cw'), 'Tentar de novo')));
      return;
    }
    if (!vg.dados) {
      $('fc-contadores').replaceChildren(...Array.from({ length: 5 }, () => h('div', { class: 'fc-contador carregando' }, vgSkeleton())));
      alvo.replaceChildren(vgSkeleton(), vgSkeleton(), vgSkeleton(), vgSkeleton());
      $('fc-atualizado').textContent = 'Carregando…';
      return;
    }
    const gerado = new Date(vg.dados.geradoEm);
    $('fc-atualizado').textContent = `Última atualização: ${gerado.toLocaleDateString('pt-BR')} ${gerado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const todas = vg.dados.empresas;
    // Carteira/responsável: só aparece quando a relação existir no banco
    const comResponsavel = todas.some((e) => e.responsavel);
    $('fc-responsavel-campo').hidden = !comResponsavel;
    const baseRegime = fcFiltrar(todas, { regime: fc.regime, status: '' }).concat(fcFiltrar(todas, { regime: fc.regime, status: 'pausada' }));
    const cont = fcContadores(baseRegime);
    $('fc-contadores').replaceChildren(
      fcContador('total', 'Total', cont.total, 'total'),
      fcContador('bloqueado', 'Bloqueadas', cont.bloqueado, 'problema'),
      fcContador('pendencias', 'Com pendências', cont.pendencias, 'pendente'),
      fcContador('andamento', 'Em andamento', cont.andamento, 'info'),
      fcContador('concluido', 'Concluídas', 0, 'ok', true, 'Uma empresa só fica concluída quando SPED, validação e guias da competência estiverem prontos. O módulo de guias ainda não existe, então ninguém aparece como concluído.'),
    );
    const filtradas = fcOrdenar(fcFiltrar(todas, fc), fc.ordem);
    const celular = ehCelularVg();
    const filtrosAtivos = [fc.termo, fc.status, fc.regime, fc.etapa, fc.responsavel].filter(Boolean).length + (fc.atencao ? 1 : 0) + (fc.soBloqueados ? 1 : 0);
    const nCampos = [fc.status, fc.regime, fc.etapa, fc.responsavel].filter(Boolean).length + (fc.ordem !== 'criticidade' ? 1 : 0) + (fc.soBloqueados ? 1 : 0);
    $('fc-filtros-botao-n').textContent = nCampos ? String(nCampos) : '';
    $('fc-filtros-botao-n').hidden = !nCampos;
    const limpar = filtrosAtivos ? h('button', { type: 'button', class: 'botao fantasma pequeno', onclick: fcLimpar }, icone('x'), 'Limpar filtros') : null;
    if (!filtradas.length) {
      alvo.replaceChildren(h('div', { class: 'fc-barra-resultado' }, h('span', { class: 'meta', text: '0 empresas' }), limpar),
        h('div', { class: 'vg-vazio pequeno' },
          h('strong', { text: todas.length ? 'Nenhuma empresa com esses filtros.' : 'Nenhuma empresa cadastrada ainda.' }),
          h('span', { text: fc.atencao || fc.soBloqueados ? 'Ótimo sinal: nada precisa de ação com esses critérios.' : 'Ajuste a busca ou limpe os filtros.' })));
      return;
    }
    const ORDENS = { criticidade: 'criticidade', empresa: 'empresa (A–Z)', atualizacao: 'atualização mais antiga', pendencias: 'mais pendências' };
    const resumo = h('div', { class: 'fc-barra-resultado' },
      h('span', { class: 'meta', text: `${vgNum(filtradas.length)} empresa${filtradas.length === 1 ? '' : 's'} · ordenadas por ${ORDENS[fc.ordem]}` }), limpar);
    if (celular) {
      const qtd = fc.maisCelular * FC_POR_LOTE_CELULAR;
      const linhas = filtradas.slice(0, qtd).map(vgLinhaCentral);
      alvo.replaceChildren(...[resumo, fcCartoes(linhas),
        filtradas.length > qtd
          ? h('button', { type: 'button', class: 'botao largo fc-mais', onclick: () => { fc.maisCelular++; fcRender(); } }, `Mostrar mais ${Math.min(FC_POR_LOTE_CELULAR, filtradas.length - qtd)} de ${vgNum(filtradas.length - qtd)} restantes`)
          : null].filter(Boolean));
      return;
    }
    const paginas = Math.max(1, Math.ceil(filtradas.length / FC_POR_PAGINA));
    if (fc.pagina > paginas) fc.pagina = paginas;
    const linhas = filtradas.slice((fc.pagina - 1) * FC_POR_PAGINA, fc.pagina * FC_POR_PAGINA).map(vgLinhaCentral);
    alvo.replaceChildren(...[resumo, fcTabela(linhas, { completa: true, comResponsavel }),
      paginas > 1 ? h('nav', { class: 'vg-paginacao', 'aria-label': 'Páginas' },
        h('span', { class: 'meta', text: `Mostrando ${(fc.pagina - 1) * FC_POR_PAGINA + 1} a ${Math.min(fc.pagina * FC_POR_PAGINA, filtradas.length)} de ${vgNum(filtradas.length)}` }),
        h('div', { class: 'vg-paginas' },
          h('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Página anterior', disabled: fc.pagina === 1, onclick: () => { fc.pagina--; fcRender(); } }, icone('chevron-left')),
          h('span', { text: `${fc.pagina} / ${paginas}` }),
          h('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Próxima página', disabled: fc.pagina === paginas, onclick: () => { fc.pagina++; fcRender(); } }, icone('chevron-right')))) : null].filter(Boolean));
  }

  function fcLimpar() {
    Object.assign(fc, { termo: '', status: '', regime: '', responsavel: '', etapa: '', soBloqueados: false, atencao: false, pagina: 1, maisCelular: 1 });
    $('fc-busca').value = ''; $('fc-status').value = ''; $('fc-regime').value = ''; $('fc-etapa').value = '';
    $('fc-atencao').checked = false; $('fc-bloqueados').checked = false;
    fcRender();
  }

  function vgLigar() {
    $('vg-regime').addEventListener('change', (e) => { vg.regime = e.target.value; vgRender(); });
    const mudar = (campo, valor) => { fc[campo] = valor; fc.pagina = 1; fc.maisCelular = 1; fcRender(); };
    let t;
    $('fc-busca').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => mudar('termo', e.target.value), 200); });
    $('fc-status').addEventListener('change', (e) => mudar('status', e.target.value));
    $('fc-regime').addEventListener('change', (e) => mudar('regime', e.target.value));
    $('fc-responsavel').addEventListener('change', (e) => mudar('responsavel', e.target.value));
    $('fc-etapa').addEventListener('change', (e) => mudar('etapa', e.target.value));
    $('fc-ordem').addEventListener('change', (e) => mudar('ordem', e.target.value));
    $('fc-atencao').addEventListener('change', (e) => mudar('atencao', e.target.checked));
    $('fc-filtros-botao').addEventListener('click', () => {
      const card = document.querySelector('.fc-card');
      const aberto = card.classList.toggle('filtros-abertos');
      $('fc-filtros-botao').setAttribute('aria-expanded', String(aberto));
    });
    $('fc-bloqueados').addEventListener('change', (e) => mudar('soBloqueados', e.target.checked));
    document.addEventListener('click', (e) => { if (!e.target.closest('.ajuda-caixa')) fecharAjudas(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharAjudas(); });
    window.addEventListener('appura:competencia', () => { if (!$('tela-visao').hidden || !$('tela-fechamento').hidden) vgCarregar(); });
    let tr;
    let eraCelular = ehCelularVg();
    window.addEventListener('resize', () => {
      clearTimeout(tr);
      tr = setTimeout(() => {
        if (!vg.dados) return;
        if (!$('tela-visao').hidden) vgRender();
        if (!$('tela-fechamento').hidden && ehCelularVg() !== eraCelular) fcRender();
        eraCelular = ehCelularVg();
      }, 200);
    });
  }
  vgLigar();
  window.vgMostrar = vgMostrar;
  window.vgCarregar = vgCarregar;
  window.vgFocarPendencias = vgFocarPendencias;
  window.fcMostrar = fcMostrar;
}
