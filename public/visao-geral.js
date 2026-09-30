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

/** Status geral do fechamento da empresa (sem "Concluído" enquanto SPED e guias não existirem). */
function vgGeral(e) {
  if (!e.ativo) return { tom: 'neutro', chave: 'pausada', texto: 'Pausada' };
  const x = vgXml(e);
  if (x.tom === 'problema') return { tom: 'problema', chave: 'bloqueado', texto: 'Bloqueado' };
  if (x.tom === 'atencao' || e.apont_abertos > 0) return { tom: 'pendente', chave: 'pendencias', texto: 'Com pendências' };
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
    { id: 'sped', nome: 'SPED (geração)', icone: 'file-spreadsheet', indisponivel: 'Não disponível' },
    { id: 'validacao', nome: 'Validação XML × SPED', icone: 'file-check', indisponivel: 'Não disponível' },
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
    { id: 'sped', texto: 'Divergências SPED × XML', icone: 'file-spreadsheet', breve: true },
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

if (typeof module !== 'undefined') module.exports = { vgXml, vgAuditoria, vgGeral, vgCalcular, vgFiltrarCentral };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  var vg = { dados: null, carregando: false, erro: null, regime: '', termo: '', status: '', foco: '', pagina: 1, pedido: 0 };

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

  async function vgCarregar() {
    const pedido = ++vg.pedido;
    const primeira = !vg.dados || vg.dados.competencia.slice(0, 7) !== competencia;
    vg.carregando = true;
    vg.erro = null;
    if (primeira) { vg.dados = null; vgRender(); }
    try {
      const d = await chamar(`/api/visao-geral?mes=${competencia}`);
      if (pedido !== vg.pedido) return;
      vg.dados = d;
    } catch (e) {
      if (pedido !== vg.pedido) return;
      vg.erro = e.message;
    } finally {
      if (pedido === vg.pedido) { vg.carregando = false; vgRender(); }
    }
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
    if (vg.rolarCentral) { vg.rolarCentral = false; vgRolarCentral(); }
  }

  function vgRolarCentral() {
    $('vg-central-secao').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  /** Atalho "Pendências" da navegação do celular: Central filtrada por empresas com pendências. */
  function vgFocarPendencias() {
    vg.status = 'pendencias'; vg.foco = ''; vg.pagina = 1;
    $('vg-central-status').value = 'pendencias';
    vg.rolarCentral = true;
    if (vg.dados && !$('tela-visao').hidden) vgRender();
  }

  function vgKpi(icone_, tom, valor, rotulo, meta, extra) {
    return h('div', { class: 'vg-kpi' },
      h('span', { class: `vg-kpi-icone ${tom}` }, icone(icone_)),
      h('div', { class: 'vg-kpi-corpo' },
        h('span', { class: `vg-kpi-valor${tom === 'problema' || tom === 'atencao' ? ` ${tom}` : ''}`, text: valor }),
        h('span', { class: 'vg-kpi-rotulo', text: rotulo }),
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
      vgKpi('cloud-download', 'ok', vgNum(k.xmlEmDia), 'Captação em dia', `${vgPctTexto(vgPct(k.xmlEmDia, b))} da base · situação atual`),
      vgKpi('triangle-alert', k.comPendencias ? 'atencao' : 'ok', vgNum(k.comPendencias), 'Com pendências', `${vgPctTexto(vgPct(k.comPendencias, b))} da base`),
      vgKpi('shield-x', k.certVencidos ? 'problema' : 'ok', vgNum(k.certVencidos), 'Certificados vencidos', k.certVencendo ? `${k.certVencendo} vence${k.certVencendo === 1 ? '' : 'm'} em 30 dias` : 'Nenhum vencendo em 30 dias'),
      h('div', { class: 'vg-kpi vg-kpi-fechamento' },
        h('span', { class: 'vg-kpi-icone progresso' }, icone('gauge')),
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
        h('li', { class: 'vg-legenda-breve', text: 'ICMS-ST, SPED e Guias: em breve' })));
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
    if (destino.central) {
      vg.foco = destino.central; vg.status = ''; vg.pagina = 1;
      $('vg-central-status').value = '';
      vgRender();
      vgRolarCentral();
      return;
    }
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
      xml: () => vgCelula(vgXml(e), base, 'XML'),
      aud: () => vgCelula(vgAuditoria(e), e.notas_mes ? `${base}/auditoria` : null, 'Auditoria'),
      st: () => vgCelula(st, e.uf === 'ES' ? `${base}/auditoria` : null, 'ICMS-ST'),
      stTabela: () => vgCelula(stTabela, e.uf === 'ES' ? `${base}/auditoria` : null, 'ICMS-ST'),
      sped: () => vgCelula(na, null, 'SPED'), val: () => vgCelula(na, null, 'Validação'), guias: () => vgCelula(na, null, 'Guias'),
    };
    return { e, g, ult, cel };
  }

  function vgRenderCentral(c) {
    const VG_POR_PAGINA = window.matchMedia('(max-width: 760px)').matches ? VG_POR_PAGINA_CELULAR : 20;
    const filtradas = vgFiltrarCentral(c.lista, { termo: vg.termo, status: vg.status, foco: vg.foco });
    const paginas = Math.max(1, Math.ceil(filtradas.length / VG_POR_PAGINA));
    if (vg.pagina > paginas) vg.pagina = paginas;
    const pag = filtradas.slice((vg.pagina - 1) * VG_POR_PAGINA, vg.pagina * VG_POR_PAGINA).map(vgLinhaCentral);
    const alvo = $('vg-central');
    const chip = vg.foco === 'auditoria'
      ? h('button', { type: 'button', class: 'vg-chip', onclick: () => { vg.foco = ''; vgRender(); } }, 'Só com auditoria pendente', icone('x'))
      : null;
    if (!filtradas.length) {
      alvo.replaceChildren(chip || '', h('div', { class: 'vg-vazio pequeno' },
        h('strong', { text: c.lista.length ? 'Nenhuma empresa com esses filtros.' : 'Nenhuma empresa para acompanhar.' }),
        c.lista.length ? h('span', { text: 'Limpe a busca ou escolha outro status.' }) : null));
      return;
    }
    const regimeTexto = (r) => (r ? REGIMES[r] || r : 'Não informado');
    const regimeCurto = (r) => ({ simples: 'Simples', presumido: 'Presumido', real: 'Real', mei: 'MEI' }[r] || (r ? r : 'Não inf.'));
    const tabela = h('div', { class: 'vg-tabela-caixa' }, h('table', { class: 'vg-tabela' },
      h('thead', {}, h('tr', {}, ...['Empresa', 'CNPJ', 'Regime', 'XML', 'Auditoria', 'ICMS-ST', 'SPED', 'Validação', 'Guias', 'Status', 'Atualizado', 'Ações'].map((t) => h('th', { scope: 'col', class: t === 'CNPJ' ? 'vg-col-cnpj' : null, text: t })))),
      h('tbody', {}, ...pag.map((l) => h('tr', {},
        h('td', { class: 'vg-emp' }, h('a', { href: `#/empresas/${l.e.id}`, text: l.e.razao_social }), h('span', { class: 'mono vg-cnpj-sub', text: formatarCnpj(l.e.cnpj) })),
        h('td', { class: 'mono vg-col-cnpj', text: formatarCnpj(l.e.cnpj) }),
        h('td', {}, h('span', { class: `vg-regime ${l.e.regime || 'nao-informado'}`, title: regimeTexto(l.e.regime), text: regimeCurto(l.e.regime) })),
        h('td', {}, l.cel.xml()), h('td', {}, l.cel.aud()), h('td', {}, l.cel.stTabela()), h('td', {}, l.cel.sped()), h('td', {}, l.cel.val()), h('td', {}, l.cel.guias()),
        h('td', {}, h('span', { class: `selo ${l.g.tom}`, text: l.g.texto })),
        h('td', { class: 'vg-data', text: l.ult ? quandoRelativo(l.ult) : '—' }),
        h('td', { class: 'vg-acoes' }, h('a', { class: 'botao-icone', href: `#/empresas/${l.e.id}`, 'aria-label': `Abrir ${l.e.razao_social}`, title: 'Abrir empresa' }, icone('arrow-right'))),
      )))));
    const cartoes = h('ul', { class: 'vg-cartoes' }, ...pag.map((l) => h('li', { class: 'vg-cartao' },
      h('div', { class: 'vg-cartao-topo' },
        h('div', {}, h('strong', { text: l.e.razao_social }), h('span', { class: 'mono', text: formatarCnpj(l.e.cnpj) }),
          h('span', { class: `vg-regime ${l.e.regime || 'nao-informado'}`, text: regimeTexto(l.e.regime) })),
        h('span', { class: `selo ${l.g.tom}`, text: l.g.texto })),
      h('dl', { class: 'vg-cartao-itens' },
        ...[['XML', l.cel.xml], ['Auditoria', l.cel.aud], ['ICMS-ST', l.cel.st]]
          .flatMap(([k, f]) => [h('dt', { text: k }), h('dd', {}, f())]),
        h('dt', { text: 'SPED, validação e guias' }),
        h('dd', {}, h('span', { class: 'vg-celula' }, h('span', { class: 'vg-simbolo neutro', 'aria-hidden': 'true', text: '–' }), h('span', { text: 'Em breve' })))),
      h('div', { class: 'vg-cartao-rodape' },
        h('span', { class: 'meta', text: l.ult ? `Atualizado ${quandoRelativo(l.ult)}` : 'Sem atualização' }),
        h('a', { class: 'botao primario', href: `#/empresas/${l.e.id}` }, 'Abrir empresa')))));
    const paginacao = paginas > 1 ? h('nav', { class: 'vg-paginacao', 'aria-label': 'Páginas' },
      h('span', { class: 'meta', text: `Mostrando ${(vg.pagina - 1) * VG_POR_PAGINA + 1} a ${Math.min(vg.pagina * VG_POR_PAGINA, filtradas.length)} de ${vgNum(filtradas.length)} empresas` }),
      h('div', { class: 'vg-paginas' },
        h('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Página anterior', disabled: vg.pagina === 1, onclick: () => { vg.pagina--; vgRender(); } }, icone('chevron-left')),
        h('span', { text: `${vg.pagina} / ${paginas}` }),
        h('button', { type: 'button', class: 'botao-icone', 'aria-label': 'Próxima página', disabled: vg.pagina === paginas, onclick: () => { vg.pagina++; vgRender(); } }, icone('chevron-right'))))
      : h('p', { class: 'meta vg-total', text: `${vgNum(filtradas.length)} empresa${filtradas.length === 1 ? '' : 's'}` });
    alvo.replaceChildren(...[chip, tabela, cartoes, paginacao].filter(Boolean));
  }

  function vgLigar() {
    $('vg-regime').addEventListener('change', (e) => { vg.regime = e.target.value; $('vg-central-regime').value = vg.regime; vg.pagina = 1; vgRender(); });
    $('vg-central-regime').addEventListener('change', (e) => { vg.regime = e.target.value; $('vg-regime').value = vg.regime; vg.pagina = 1; vgRender(); });
    $('vg-central-status').addEventListener('change', (e) => { vg.status = e.target.value; vg.pagina = 1; vgRender(); });
    let t;
    $('vg-central-busca').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { vg.termo = e.target.value; vg.pagina = 1; vgRender(); }, 200); });
    window.addEventListener('appura:competencia', () => { if (!$('tela-visao').hidden) vgCarregar(); });
    let tr;
    window.addEventListener('resize', () => { clearTimeout(tr); tr = setTimeout(() => { if (!$('tela-visao').hidden && vg.dados) vgRender(); }, 200); });
  }
  vgLigar();
  window.vgMostrar = vgMostrar;
  window.vgCarregar = vgCarregar;
  window.vgFocarPendencias = vgFocarPendencias;
}
