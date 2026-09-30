'use strict';
/*
 * Empresa 360°: visão única de uma empresa na competência selecionada.
 * Dados: /api/empresas/:id/360 (uma chamada) + /st (cálculo do ICMS-ST, só para empresas do ES).
 * Regra: só dado real. O que o sistema não registra não aparece como se existisse.
 */

/* ---------- cálculo (funções puras, testadas em test/empresa-360.test.ts) ---------- */
const E360_BLOQUEIO = ['sem_certificado', 'certificado_vencido'];
const E360_ATENCAO = ['erro', 'atrasada', 'conflito_nsu'];
const E360_MODELO = { '55': 'NF-e', '65': 'NFC-e', '57': 'CT-e' };

/** Quantidades de documentos da competência por tipo. */
function e360Documentos(d) {
  const r = { total: 0, nfeEntrada: 0, nfeSaida: 0, nfce: 0, cte: 0, canceladas: 0, soResumo: 0, naoAuditadas: 0 };
  for (const x of d.documentos || []) {
    const n = Number(x.n);
    r.total += n;
    r.canceladas += Number(x.canceladas);
    r.soResumo += Number(x.so_resumo);
    r.naoAuditadas += Number(x.nao_auditadas);
    if (x.modelo === '55') r[x.direcao === 'saida' ? 'nfeSaida' : 'nfeEntrada'] += n;
    else if (x.modelo === '65') r.nfce += n;
    else if (x.modelo === '57') r.cte += n;
  }
  return r;
}

/** Apontamentos da competência por situação e pela severidade que o sistema já grava (erro, alerta, info). */
function e360Auditoria(d) {
  const r = { total: 0, abertos: 0, erro: 0, alerta: 0, info: 0, tratados: 0, ignorados: 0 };
  for (const x of d.auditoria || []) {
    const n = Number(x.n);
    r.total += n;
    if (x.status === 'aberto') {
      r.abertos += n;
      if (x.severidade in r) r[x.severidade] += n;
    } else if (x.status === 'ignorado') r.ignorados += n;
    else r.tratados += n;
  }
  return r;
}

/** Situação do certificado A1 ativo. */
function e360Certificado(d, hoje = new Date()) {
  const c = d.certificado;
  if (!c) return { situacao: 'ausente', tom: 'problema', texto: 'Sem certificado', dias: null };
  const dias = Math.floor((new Date(c.valido_ate).getTime() - hoje.getTime()) / 86400000);
  if (dias < 0) return { situacao: 'vencido', tom: 'problema', texto: 'Vencido', dias };
  if (dias <= 30) return { situacao: 'vencendo', tom: 'pendente', texto: `Vence em ${dias} dia${dias === 1 ? '' : 's'}`, dias };
  return { situacao: 'valido', tom: 'ok', texto: 'Válido', dias };
}

/** Linha usada pelo status geral da Central (mesma regra: vgGeral). */
function e360LinhaCentral(d) {
  const e = d.empresa || {};
  const a = e360Auditoria(d);
  const docs = e360Documentos(d);
  return { ...e, notas_mes: docs.total, nao_auditadas: docs.naoAuditadas, apont_abertos: a.erro + a.alerta, apont_total: a.total };
}

/**
 * Etapas do fechamento. Estados: concluido | andamento | pendencia | bloqueado | nao_iniciado | indisponivel.
 * Captação nunca vira "concluído": a SEFAZ pode entregar notas até o fim do prazo.
 */
function e360Etapas(d) {
  const e = d.empresa || {};
  const docs = e360Documentos(d);
  const a = e360Auditoria(d);
  let xml;
  if (!e.ativo) xml = { estado: 'nao_iniciado', texto: 'Empresa pausada' };
  else if (E360_BLOQUEIO.includes(e.status)) xml = { estado: 'bloqueado', texto: e.status === 'sem_certificado' ? 'Sem certificado' : 'Certificado vencido' };
  else if (E360_ATENCAO.includes(e.status)) xml = { estado: 'pendencia', texto: e.status === 'atrasada' ? 'Captação atrasada' : e.status === 'conflito_nsu' ? 'Outro sistema consultou' : 'Erro na consulta' };
  else if (e.status === 'aguardando') xml = { estado: 'nao_iniciado', texto: 'Aguardando 1ª captação' };
  else xml = { estado: 'andamento', texto: `${docs.total} documento${docs.total === 1 ? '' : 's'} · captação regular` };

  let aud;
  if (!docs.total) aud = { estado: 'nao_iniciado', texto: 'Sem notas na competência' };
  else if (docs.naoAuditadas) aud = { estado: 'andamento', texto: `${docs.naoAuditadas} nota${docs.naoAuditadas === 1 ? '' : 's'} aguardando auditoria` };
  else if (a.erro + a.alerta) aud = { estado: 'pendencia', texto: `${a.erro + a.alerta} pendência${a.erro + a.alerta === 1 ? '' : 's'} aberta${a.erro + a.alerta === 1 ? '' : 's'}` };
  else aud = { estado: 'concluido', texto: 'Auditada' };

  const st = e.uf === 'ES'
    ? { estado: 'nao_iniciado', texto: 'Calculado sob demanda' }
    : { estado: 'indisponivel', texto: 'Não se aplica (fora do ES)' };

  return [
    { id: 'xml', nome: 'Captação', aba: 'notas', ...xml },
    { id: 'auditoria', nome: 'Auditoria', aba: 'auditoria', ...aud },
    { id: 'st', nome: 'ICMS-ST', aba: e.uf === 'ES' ? 'st' : null, ...st },
    { id: 'sped', nome: 'SPED', aba: 'sped', estado: 'indisponivel', texto: 'Em breve' },
    { id: 'validacao', nome: 'Validação', aba: null, estado: 'indisponivel', texto: 'Em breve' },
    { id: 'guias', nome: 'Guias', aba: 'guias', estado: 'indisponivel', texto: 'Em breve' },
  ];
}

/** O que precisa de ação agora, do mais grave para o mais leve. `st` é o resultado do cálculo de ICMS-ST (opcional). */
function e360Atencao(d, st, hoje = new Date()) {
  const e = d.empresa || {};
  const itens = [];
  if (!e.ativo) return itens;
  const cert = e360Certificado(d, hoje);
  if (cert.situacao === 'ausente') itens.push({ id: 'cert', tom: 'problema', icone: 'key-round', texto: 'Empresa sem certificado A1', acao: 'certificado' });
  if (cert.situacao === 'vencido') itens.push({ id: 'cert', tom: 'problema', icone: 'shield-x', texto: 'Certificado vencido: a captação está parada', acao: 'certificado' });
  if (E360_ATENCAO.includes(e.status)) {
    const t = e.status === 'atrasada' ? 'Captação atrasada (mais de 36 h sem consulta concluída)' : e.status === 'conflito_nsu' ? 'Outro sistema consultou a SEFAZ por este CNPJ' : `Erro na consulta à SEFAZ${e.ultimo_cstat ? ` (${e.ultimo_cstat})` : ''}`;
    itens.push({ id: 'captacao', tom: 'atencao', icone: 'clock-alert', texto: t, aba: 'historico' });
  }
  const a = e360Auditoria(d);
  if (a.erro + a.alerta) {
    const n = a.erro + a.alerta;
    itens.push({ id: 'auditoria', tom: a.erro ? 'atencao' : 'pendente', icone: 'shield-alert', texto: `${n} pendência${n === 1 ? '' : 's'} na auditoria${a.erro ? ` (${a.erro} erro${a.erro === 1 ? '' : 's'})` : ''}`, aba: 'auditoria' });
  }
  if (cert.situacao === 'vencendo') itens.push({ id: 'cert', tom: 'pendente', icone: 'triangle-alert', texto: `Certificado vence em ${cert.dias} dia${cert.dias === 1 ? '' : 's'}`, acao: 'certificado' });
  if (st && st.uf === 'ES' && st.total > 0) {
    itens.push({ id: 'st', tom: 'pendente', icone: 'calculator', texto: `ICMS-ST a recolher nas entradas: ${st.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, aba: 'st' });
  }
  const docs = e360Documentos(d);
  if (docs.soResumo) itens.push({ id: 'resumo', tom: 'info', icone: 'file-warning', texto: `${docs.soResumo} nota${docs.soResumo === 1 ? '' : 's'} só com resumo (XML completo ainda não chegou)`, aba: 'notas', filtroSituacao: 'resumo' });
  return itens;
}

/** Converte os registros reais do banco em linhas legíveis do histórico. */
function e360Historico(d) {
  const mod = (m) => (m === 'cte' ? 'CT-e' : m === 'nfe' ? 'NF-e' : String(m || '').toUpperCase());
  return (d.historico || []).map((x) => {
    const v = x.dados || {};
    switch (x.tipo) {
      case 'sefaz': {
        if (v.erro) return { em: x.em, tom: 'problema', icone: 'circle-alert', titulo: `Consulta SEFAZ (${mod(v.modelo)}) com erro`, detalhe: v.erro, por: 'Coletor automático' };
        if (Number(v.qtd) > 0) return { em: x.em, tom: 'ok', icone: 'cloud-download', titulo: `Consulta SEFAZ (${mod(v.modelo)}): ${v.qtd} documento${Number(v.qtd) === 1 ? '' : 's'} recebido${Number(v.qtd) === 1 ? '' : 's'}`, detalhe: v.cstat ? `${v.cstat} · ${v.motivo || ''}` : '', por: 'Coletor automático' };
        return { em: x.em, tom: v.cstat === '656' ? 'atencao' : 'neutro', icone: 'cloud-download', titulo: `Consulta SEFAZ (${mod(v.modelo)})`, detalhe: `${v.cstat || ''} · ${v.motivo || ''}`, por: 'Coletor automático' };
      }
      case 'pedido': {
        const st = { pendente: 'aguardando a janela', processando: 'em andamento', concluido: 'concluída', erro: 'com erro' }[v.status] || v.status;
        return { em: x.em, tom: v.status === 'erro' ? 'problema' : 'info', icone: 'refresh-cw', titulo: `Sincronização pedida pelo painel (${st})`, detalhe: v.mensagem || '', por: null };
      }
      case 'auditoria': {
        const n = Number(v.n);
        const acao = v.status === 'ignorado' ? `ignorado${n === 1 ? '' : 's'}` : `tratado${n === 1 ? '' : 's'}`;
        const comp = v.competencia ? String(v.competencia).slice(0, 7).split('-').reverse().join('/') : '';
        return { em: x.em, tom: v.status === 'ignorado' ? 'neutro' : 'ok', icone: 'shield-check', titulo: `${n} apontamento${n === 1 ? '' : 's'} da auditoria ${acao}`, detalhe: comp ? `Competência ${comp}` : '', por: x.por };
      }
      case 'importacao': {
        const n = Number(v.n);
        return { em: x.em, tom: 'info', icone: 'cloud-download', titulo: `${n} documento${n === 1 ? '' : 's'} importado${n === 1 ? '' : 's'} (XML/ZIP)`, detalhe: 'Importação pelo painel', por: null };
      }
      case 'certificado':
        return { em: x.em, tom: 'info', icone: 'key-round', titulo: `Certificado A1 cadastrado${v.titular ? `: ${v.titular}` : ''}`, detalhe: v.valido_ate ? `Válido até ${new Date(v.valido_ate).toLocaleDateString('pt-BR')}${v.ativo ? '' : ' · substituído'}` : '', por: null };
      default:
        return { em: x.em, tom: 'neutro', icone: 'clock-alert', titulo: x.tipo, detalhe: '', por: x.por };
    }
  });
}

if (typeof module !== 'undefined') module.exports = { e360Documentos, e360Auditoria, e360Certificado, e360Etapas, e360Atencao, e360Historico, e360LinhaCentral };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  var e3 = { dados: null, st: null, pedido: 0, erro: null, confirmarPausa: false, sped: null };

  var E360_ESTADO = {
    concluido: { tom: 'ok', simbolo: '✓', texto: 'Concluído' },
    andamento: { tom: 'info', simbolo: '●', texto: 'Em andamento' },
    pendencia: { tom: 'pendente', simbolo: '!', texto: 'Com pendência' },
    bloqueado: { tom: 'problema', simbolo: '✕', texto: 'Bloqueado' },
    nao_iniciado: { tom: 'neutro', simbolo: '–', texto: 'Não iniciado' },
    indisponivel: { tom: 'neutro', simbolo: '–', texto: 'Indisponível' },
  };

  var e3Quando = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const hoje = new Date();
    const ontem = new Date(Date.now() - 86400000);
    const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === hoje.toDateString()) return `Hoje, ${hora}`;
    if (d.toDateString() === ontem.toDateString()) return `Ontem, ${hora}`;
    return `${d.toLocaleDateString('pt-BR')} ${hora}`;
  };
  var e3Num = (n) => Number(n || 0).toLocaleString('pt-BR');

  /** Chamado ao abrir a empresa: limpa a tela anterior (sem mostrar dados de outra empresa) e carrega. */
  function e360Resetar(e) {
    e3.dados = null; e3.st = null; e3.erro = null; e3.confirmarPausa = false;
    if (e3.sped && e3.sped.id !== e.id) e3.sped = null;
    spedRender();
    $('e360-status').className = 'selo neutro';
    $('e360-status').textContent = '—';
    $('e360-selos').replaceChildren(...e360SelosBase(e));
    e360RenderVisao();
    e360AtualizarAcoes();
  }

  function e360SelosBase(e) {
    const matriz = e.cnpj && e.cnpj.length === 14 ? (e.cnpj.slice(8, 12) === '0001' ? 'Matriz' : 'Filial') : null;
    return [
      e.regime ? h('span', { class: 'e360-selo', text: REGIMES[e.regime] || e.regime }) : h('span', { class: 'e360-selo neutro', text: 'Regime não informado' }),
      h('span', { class: 'e360-selo', text: e.uf }),
      h('span', { class: `e360-selo ${e.ativo ? 'ok' : 'neutro'}`, text: e.ativo ? 'Ativa' : 'Pausada' }),
      matriz ? h('span', { class: 'e360-selo', title: 'Pela ordem do CNPJ (0001 = matriz)', text: matriz }) : null,
      e.codigo_erp ? h('span', { class: 'e360-selo', text: `Cód. ERP ${e.codigo_erp}` }) : null,
      e.escritorio ? h('span', { class: 'e360-selo info', text: 'Certificado do escritório' }) : null,
    ].filter(Boolean);
  }

  async function e360Carregar() {
    if (!empresaNotas) return;
    const id = empresaNotas.id;
    const pedido = ++e3.pedido;
    try {
      const d = await chamar(`/api/empresas/${id}/360?mes=${mesSelecionado()}`);
      if (pedido !== e3.pedido || !empresaNotas || empresaNotas.id !== id) return;
      e3.dados = d; e3.erro = null;
    } catch (err) {
      if (pedido !== e3.pedido) return;
      e3.erro = err.message;
    }
    e360RenderTudo();
    // ICMS-ST: cálculo do servidor (só ES); entra no card e em "Precisa de atenção"
    if (e3.dados && e3.dados.empresa && e3.dados.empresa.uf === 'ES') {
      try {
        const st = await chamar(`/api/empresas/${id}/st?mes=${mesSelecionado()}`);
        if (pedido !== e3.pedido) return;
        e3.st = st;
      } catch { e3.st = { erro: true }; }
      e360RenderTudo();
    }
  }

  function e360RenderTudo() {
    e360RenderCabecalho();
    e360RenderVisao();
    if (abaAtual === 'arquivos') e360RenderArquivos();
    if (abaAtual === 'historico') e360RenderHistorico();
    e360AtualizarAcoes();
  }

  function e360RenderCabecalho() {
    const d = e3.dados;
    if (!d || !d.empresa) return;
    const e = d.empresa;
    const g = vgGeral(e360LinhaCentral(d));
    $('e360-status').className = `selo ${g.tom}`;
    $('e360-status').textContent = g.texto;
    $('e360-selos').replaceChildren(...e360SelosBase(e));
  }

  function e360Esqueleto(n) { return Array.from({ length: n }, () => h('div', { class: 'vg-skel', 'aria-hidden': 'true' })); }

  function e360RenderVisao() {
    $('e360-etapas-mes').textContent = textoCompetencia(mesSelecionado()).replace(' / ', '/');
    const d = e3.dados;
    if (e3.erro && !d) {
      const erro = h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar os dados da empresa.' }), h('span', { text: e3.erro }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: e360Carregar }, icone('refresh-cw'), 'Tentar de novo'));
      $('e360-etapas').replaceChildren(h('li', {}, erro));
      for (const id of ['e360-atencao', 'e360-cards', 'e360-atividade', 'e360-dados']) $(id).replaceChildren();
      return;
    }
    if (!d) {
      $('e360-etapas').replaceChildren(...e360Esqueleto(1));
      $('e360-atencao').replaceChildren(...e360Esqueleto(2));
      $('e360-cards').replaceChildren(...Array.from({ length: 4 }, () => h('div', { class: 'vg-card e360-card' }, ...e360Esqueleto(2))));
      $('e360-atividade').replaceChildren(...e360Esqueleto(3));
      $('e360-dados').replaceChildren(...e360Esqueleto(4));
      return;
    }
    // Etapas
    $('e360-etapas').replaceChildren(...e360Etapas(d).map((et) => {
      const est = E360_ESTADO[et.estado];
      const conteudo = [
        h('span', { class: `vg-simbolo ${est.tom}`, 'aria-hidden': 'true', text: est.simbolo }),
        h('span', { class: 'e360-etapa-nome', text: et.nome }),
        h('span', { class: `e360-etapa-estado ${est.tom}`, text: est.texto }),
        h('span', { class: 'e360-etapa-texto', text: et.texto }),
      ];
      return h('li', { class: `e360-etapa ${et.estado}` }, et.aba
        ? h('button', { type: 'button', class: 'e360-etapa-botao', onclick: () => trocarAba(et.aba) }, ...conteudo)
        : h('div', { class: 'e360-etapa-botao' }, ...conteudo));
    }));
    // Precisa de atenção
    const at = e360Atencao(d, e3.st && !e3.st.erro ? e3.st : null);
    $('e360-atencao').replaceChildren(...(at.length ? at.map((a) => {
      const corpo = [h('span', { class: `vg-atencao-icone ${a.tom}` }, icone(a.icone)), h('span', { class: 'vg-atencao-texto', text: a.texto })];
      const destino = a.aba ? () => { if (a.filtroSituacao) $('notas-situacao').value = a.filtroSituacao; trocarAba(a.aba); }
        : a.acao === 'certificado' && pode('certificados') ? () => abrirGaveta(empresaNotas) : null;
      return h('li', {}, destino
        ? h('button', { type: 'button', class: 'vg-atencao-item', onclick: destino }, ...corpo, icone('chevron-right', 'icone-svg vg-seta'))
        : h('div', { class: 'vg-atencao-item' }, ...corpo));
    }) : [h('li', {}, h('div', { class: 'e360-tudo-ok' }, h('span', { class: 'vg-simbolo ok', 'aria-hidden': 'true', text: '✓' }), 'Nenhuma pendência que exija ação no momento.'))]));
    // Cards operacionais
    const docs = e360Documentos(d);
    const aud = e360Auditoria(d);
    const cert = e360Certificado(d);
    const capOk = (d.captacao || []).map((c) => c.ultima_sync_ok_em).filter(Boolean).sort().pop();
    const linhaNum = (rotulo, valor) => h('li', {}, h('span', { text: rotulo }), h('strong', { text: e3Num(valor) }));
    const card = (titulo, icone_, tom, valor, legenda, corpo, botao) => h('section', { class: 'vg-card e360-card' },
      h('div', { class: 'e360-card-topo' }, h('span', { class: `vg-kpi-icone ${tom}` }, icone(icone_)), h('h3', { text: titulo })),
      h('div', { class: 'e360-card-valor' }, h('strong', { text: valor }), h('span', { text: legenda })),
      corpo, botao);
    const cards = [
      card('XML / Notas', 'file-text', 'info', e3Num(docs.total), `documento${docs.total === 1 ? '' : 's'} na competência`,
        h('ul', { class: 'e360-lista-num' }, linhaNum('NF-e entrada', docs.nfeEntrada), linhaNum('NF-e saída', docs.nfeSaida), linhaNum('NFC-e', docs.nfce), linhaNum('CT-e', docs.cte),
          h('li', { class: 'meta' }, h('span', { text: 'Última captação' }), h('strong', { text: e3Quando(capOk) }))),
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => trocarAba('notas') }, 'Ver notas')),
      card('Auditoria', 'shield-check', aud.erro ? 'atencao' : aud.alerta ? 'pendente' : 'ok', e3Num(aud.erro + aud.alerta), 'pendências abertas',
        h('ul', { class: 'e360-lista-num' }, linhaNum('Erros', aud.erro), linhaNum('Alertas', aud.alerta), linhaNum('Informativos abertos', aud.info), linhaNum('Tratados', aud.tratados), linhaNum('Ignorados', aud.ignorados)),
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => trocarAba('auditoria') }, 'Revisar auditoria')),
    ];
    if (d.empresa.uf === 'ES') {
      const st = e3.st;
      cards.push(card('ICMS-ST (entradas)', 'calculator', 'progresso',
        !st ? '…' : st.erro ? '—' : moeda(st.total), !st ? 'calculando…' : st.erro ? 'não foi possível calcular' : 'a recolher (estimado pela tabela do ES)',
        st && !st.erro ? h('ul', { class: 'e360-lista-num' }, linhaNum('Notas de fora do ES', st.notasForaDoEstado), linhaNum('Itens com ST calculado', st.itensCalculados), linhaNum('Já com ST retido', st.jaRetidos), linhaNum('Fora da tabela do ES', st.itensSemRegra)) : h('ul', { class: 'e360-lista-num' }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => trocarAba('st') }, 'Abrir ICMS-ST')));
    }
    cards.push(card('Certificado A1', 'key-round', cert.tom, d.certificado ? new Date(d.certificado.valido_ate).toLocaleDateString('pt-BR') : '—', d.certificado ? 'válido até' : 'nenhum certificado ativo',
      h('ul', { class: 'e360-lista-num' },
        h('li', {}, h('span', { text: 'Situação' }), h('span', { class: `selo ${cert.tom}`, text: cert.texto })),
        cert.dias !== null ? h('li', {}, h('span', { text: cert.dias >= 0 ? 'Dias restantes' : 'Vencido há' }), h('strong', { text: `${e3Num(Math.abs(cert.dias))} dia${Math.abs(cert.dias) === 1 ? '' : 's'}` })) : null,
        d.certificado ? h('li', {}, h('span', { text: 'Titular' }), h('strong', { class: 'e360-texto-longo', text: d.certificado.titular || '—' })) : null),
      pode('certificados') ? h('button', { type: 'button', class: 'botao pequeno', onclick: () => abrirGaveta(empresaNotas) }, d.certificado ? 'Trocar certificado' : 'Enviar certificado') : null));
    $('e360-cards').replaceChildren(...cards);
    // Atividade recente
    const hist = e360Historico(d).slice(0, 6);
    $('e360-atividade').replaceChildren(...(hist.length ? hist.map(e360ItemTempo) : [h('li', { class: 'meta', text: 'Nenhuma atividade registrada ainda.' })]));
    // Dados da empresa
    const e = d.empresa;
    const campo = (rotulo, valor) => [h('dt', { text: rotulo }), h('dd', { text: valor || '—' })];
    const porModelo = (d.captacao || []).map((c) => `${c.modelo === 'cte' ? 'CT-e' : 'NF-e'}: ${c.ultimo_cstat ? `${c.ultimo_cstat} ${c.ultimo_motivo || ''}` : 'sem consulta'}`).join(' · ');
    const ultConsulta = (d.captacao || []).map((c) => c.ultima_consulta_em).filter(Boolean).sort().pop();
    const proxima = (d.captacao || []).map((c) => c.proxima_consulta_em).filter(Boolean).sort()[0];
    $('e360-dados').replaceChildren(
      h('h2', { class: 'vg-card-titulo', text: 'Dados da empresa' }),
      h('dl', { class: 'e360-dl' }, ...campo('CNPJ', formatarCnpj(e.cnpj)), ...campo('Regime', e.regime ? REGIMES[e.regime] || e.regime : 'Não informado'),
        ...campo('UF', e.uf), ...campo('Código ERP', e.codigo_erp), ...campo('Situação', e.ativo ? 'Ativa' : 'Pausada')),
      h('h2', { class: 'vg-card-titulo', text: 'Certificado' }),
      h('dl', { class: 'e360-dl' }, ...campo('Tipo', d.certificado ? 'A1' : '—'),
        ...campo('Validade', d.certificado ? new Date(d.certificado.valido_ate).toLocaleDateString('pt-BR') : null), ...campo('Situação', cert.texto)),
      h('h2', { class: 'vg-card-titulo', text: 'Captação' }),
      h('dl', { class: 'e360-dl' }, ...campo('Última consulta', ultConsulta ? e3Quando(ultConsulta) : null), ...campo('Próxima consulta', proxima ? e3Quando(proxima) : null),
        ...campo('Situação SEFAZ', porModelo), ...campo('Janela', 'Das 23h às 6h')),
      h('p', { class: 'meta', text: 'IE e município ainda não fazem parte do cadastro; entram com o pré-cadastro pelo SPED/SINTEGRA.' }),
    );
  }

  function e360ItemTempo(x) {
    return h('li', { class: `e360-tempo ${x.tom}` },
      h('span', { class: `e360-tempo-icone ${x.tom}` }, icone(x.icone)),
      h('div', { class: 'e360-tempo-corpo' },
        h('strong', { text: x.titulo }),
        x.detalhe ? h('span', { class: 'meta', text: x.detalhe }) : null,
        h('span', { class: 'meta', text: [e3Quando(x.em), x.por].filter(Boolean).join(' · ') })));
  }

  function e360RenderHistorico() {
    const alvo = $('painel-historico');
    const d = e3.dados;
    if (!d) { alvo.replaceChildren(...e360Esqueleto(4)); return; }
    const itens = e360Historico(d);
    alvo.replaceChildren(h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Histórico' }),
        h('p', { class: 'meta', text: 'Consultas à SEFAZ, pedidos de sincronização, tratamentos da auditoria (com quem fez), importações e certificados. Últimos 80 registros.' }))),
      itens.length ? h('ol', { class: 'e360-linha-tempo' }, ...itens.map(e360ItemTempo)) : h('p', { class: 'meta', text: 'Nenhum registro ainda.' })));
  }

  function e360RenderArquivos() {
    const alvo = $('painel-arquivos');
    const d = e3.dados;
    if (!d) { alvo.replaceChildren(...e360Esqueleto(4)); return; }
    const docs = e360Documentos(d);
    const comp = textoCompetencia(mesSelecionado());
    const importacoes = (d.historico || []).filter((x) => x.tipo === 'importacao');
    const linha = (nome, tipo, competencia_, data, origem, usuario, acao) => h('tr', {},
      h('td', { class: 'vg-emp', text: nome }), h('td', { text: tipo }), h('td', { text: competencia_ }), h('td', { class: 'vg-data', text: data }),
      h('td', { text: origem }), h('td', { text: usuario }), h('td', { class: 'vg-acoes' }, acao || h('span', { class: 'meta', text: '—' })));
    const linhas = [
      linha(`XMLs da competência (${e3Num(docs.total)})`, 'XML (NF-e, NFC-e, CT-e)', comp, 'Atualizado continuamente', 'SEFAZ e importações', '—',
        docs.total ? h('button', { type: 'button', class: 'botao pequeno', onclick: () => baixarZip() }, 'Baixar ZIP') : null),
      ...importacoes.map((x) => linha(`Importação de ${e3Num(x.dados.n)} documento${Number(x.dados.n) === 1 ? '' : 's'}`, 'XML/ZIP importado', '—', e3Quando(x.em), 'Importação pelo painel', 'Não registrado', null)),
    ];
    if (d.empresa.uf === 'ES') {
      linhas.push(linha(`Planilha de ICMS-ST · ${comp}`, 'Excel (.xlsx)', comp, 'Gerada na hora', 'Cálculo do Appura', '—',
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => baixarPlanilhaST() }, 'Gerar e baixar')));
    }
    alvo.replaceChildren(h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Arquivos' }),
        h('p', { class: 'meta', text: 'Somente o que está armazenado. O Appura ainda não registra qual usuário fez cada importação.' }))),
      h('div', { class: 'vg-tabela-caixa' }, h('table', { class: 'vg-tabela e360-arquivos' },
        h('thead', {}, h('tr', {}, ...['Nome', 'Tipo', 'Competência', 'Data', 'Origem', 'Usuário', 'Ação'].map((t) => h('th', { scope: 'col', text: t })))),
        h('tbody', {}, ...linhas))),
      h('div', { class: 'e360-breve pequeno' }, icone('file-spreadsheet'), h('div', {}, h('strong', { text: 'SPED, SINTEGRA e guias' }), h('p', { text: 'Os arquivos entram nesta lista quando esses módulos existirem.' })))));
  }


  /* ---------- SPED Fiscal: envio, validação e comparação ---------- */
  var SPED_TIPOS = {
    xml_sem_escrituracao: 'XML sem escrituração',
    escriturada_sem_xml: 'Escriturada sem XML',
    valor: 'Valor diferente',
    situacao: 'Situação diferente',
    cte_sem_d100: 'CT-e tomado sem D100',
    saida_sem_escrituracao: 'Saída fora do SPED',
  };
  var NIVEL = { erro: { tom: 'problema', texto: 'Erro' }, alerta: { tom: 'pendente', texto: 'Alerta' }, info: { tom: 'neutro', texto: 'Informação' } };

  async function spedEnviar(arquivo) {
    if (!arquivo || !empresaNotas) return;
    const id = empresaNotas.id;
    const alvo = $('sped-resultado');
    $('sped-enviar').disabled = true;
    alvo.replaceChildren(h('div', { class: 'vg-card' }, h('strong', { text: `Lendo ${arquivo.name}…` }), h('span', { class: 'meta', text: `${(arquivo.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` }), h('div', { class: 'vg-skel', 'aria-hidden': 'true' })));
    try {
      const r = await enviarArquivo(`/api/empresas/${id}/sped?nome=${encodeURIComponent(arquivo.name)}`, arquivo);
      if (!empresaNotas || empresaNotas.id !== id) return;
      e3.sped = { id, r, filtro: '' };
      spedRender();
    } catch (err) {
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível ler o arquivo.' }), h('span', { text: err.message })));
    } finally {
      $('sped-enviar').disabled = false;
      $('sped-arquivo').value = '';
    }
  }

  function spedRender() {
    const alvo = $('sped-resultado');
    $('sped-enviar').hidden = !pode('operar');
    $('sped-sem-permissao').hidden = pode('operar');
    const est = e3.sped;
    if (!est || !empresaNotas || est.id !== empresaNotas.id) { alvo.replaceChildren(); return; }
    const { r } = est;
    const res = r.resumo;
    const fmt = (v) => moeda(v);
    const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
    const oc = r.ocorrencias || [];
    const nErros = oc.filter((o) => o.nivel === 'erro').length;
    const nAlertas = oc.filter((o) => o.nivel === 'alerta').length;
    const blocos = [];
    if (!res.empresa) {
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Este arquivo não parece ser um SPED Fiscal.' }), ...oc.map((o) => h('span', { text: o.mensagem }))));
      return;
    }
    // Período × competência
    if (res.periodo && res.periodo !== competencia) {
      blocos.push(h('div', { class: 'sped-aviso' }, icone('calendar'),
        h('span', { text: `O arquivo é de ${textoCompetencia(res.periodo)}, e a competência selecionada é ${textoCompetencia(competencia)}.` }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => definirCompetencia(res.periodo) }, `Mudar para ${textoCompetencia(res.periodo)}`)));
    }
    // Cabeçalho do resultado
    const situacao = nErros ? { tom: 'problema', texto: `${nErros} erro${nErros === 1 ? '' : 's'} a corrigir` }
      : nAlertas ? { tom: 'pendente', texto: `Sem erros · ${nAlertas} alerta${nAlertas === 1 ? '' : 's'}` } : { tom: 'ok', texto: 'Sem erros nem alertas' };
    const ap = res.apuracao; const calc = res.apuracaoCalculada;
    const confere = ap && Math.abs(ap.debitos - calc.debitos) <= 0.05 && Math.abs(ap.creditos - calc.creditos) <= 0.05;
    blocos.push(h('div', { class: 'sped-cards' },
      h('section', { class: 'vg-card' },
        h('div', { class: 'e360-card-topo' }, h('span', { class: 'vg-kpi-icone info' }, icone('file-spreadsheet')), h('h3', { text: 'Arquivo' })),
        h('div', { class: 'e360-card-valor' }, h('strong', { text: textoCompetencia(res.periodo) }), h('span', { text: r.arquivo.nome })),
        h('ul', { class: 'e360-lista-num' },
          h('li', {}, h('span', { text: 'Situação' }), h('span', { class: `selo ${situacao.tom}`, text: situacao.texto })),
          h('li', {}, h('span', { text: 'Leiaute / perfil' }), h('strong', { text: `${res.codVer} / ${res.empresa.perfil}` })),
          h('li', {}, h('span', { text: 'Finalidade' }), h('strong', { text: res.finalidade === 'substituto' ? 'Substituto' : 'Original' })),
          h('li', {}, h('span', { text: 'Linhas' }), h('strong', { text: e3Num(res.linhas) })),
          h('li', {}, h('span', { text: 'Participantes / itens' }), h('strong', { text: `${e3Num(res.participantes)} / ${e3Num(res.itens)}` })),
          h('li', {}, h('span', { text: 'Inventário (bloco H)' }), h('strong', { text: res.inventario ? 'Sim' : 'Não' })))),
      h('section', { class: 'vg-card' },
        h('div', { class: 'e360-card-topo' }, h('span', { class: `vg-kpi-icone ${confere ? 'ok' : 'pendente'}` }, icone('calculator')), h('h3', { text: 'Apuração do ICMS (E110)' })),
        ap ? h('div', { class: 'e360-card-valor' }, h('strong', { text: ap.recolher ? fmt(ap.recolher) : fmt(ap.saldoCredorTransportar) }), h('span', { text: ap.recolher ? 'ICMS a recolher' : 'saldo credor a transportar' })) : h('p', { class: 'meta', text: 'Sem E110.' }),
        ap ? h('ul', { class: 'e360-lista-num' },
          h('li', {}, h('span', { text: 'Débitos' }), h('strong', { text: fmt(ap.debitos) })),
          h('li', {}, h('span', { text: 'Créditos' }), h('strong', { text: fmt(ap.creditos) })),
          h('li', {}, h('span', { text: 'Saldo credor anterior' }), h('strong', { text: fmt(ap.saldoCredorAnterior) })),
          h('li', {}, h('span', { text: 'Confere com os documentos' }), h('span', { class: `selo ${confere ? 'ok' : 'pendente'}`, text: confere ? 'Sim, ao centavo' : 'Não: veja os alertas' }))) : null),
      h('section', { class: 'vg-card' },
        h('div', { class: 'e360-card-topo' }, h('span', { class: 'vg-kpi-icone progresso' }, icone('file-text')), h('h3', { text: 'Documentos escriturados' })),
        h('ul', { class: 'e360-lista-num' }, ...res.documentos.map((d) => h('li', {}, h('span', { text: d.rotulo }),
          h('strong', { text: `${e3Num(d.qtd)}${d.canceladas ? ` (${e3Num(d.canceladas)} canc.)` : ''} · ${fmt(d.valor)}` })))))));
    // Ocorrências
    blocos.push(h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Validação do arquivo' }),
        h('span', { class: 'meta', text: 'Estrutura (9900, 9999, blocos), chaves de acesso, datas, C190 × C100 e E110 × documentos.' })),
      oc.length ? h('ul', { class: 'sped-ocorrencias' }, ...oc.map((o) => h('li', { class: o.nivel },
        h('span', { class: `selo ${NIVEL[o.nivel].tom}`, text: NIVEL[o.nivel].texto }),
        h('div', {}, h('p', { text: o.mensagem }), o.linhas ? h('span', { class: 'meta', text: `Linha${o.linhas.length > 1 ? 's' : ''} ${o.linhas.join(', ')}${o.quantidade > o.linhas.length ? ` e mais ${o.quantidade - o.linhas.length}` : ''}` }) : null))))
        : h('div', { class: 'e360-tudo-ok' }, h('span', { class: 'vg-simbolo ok', 'aria-hidden': 'true', text: '✓' }), 'Nenhum problema encontrado na estrutura e na apuração.')));
    // Comparação
    const c = r.comparacao;
    if (c) {
      const t = c.totais;
      const tipos = Object.entries(c.contagem).filter(([, n]) => n);
      const filtro = est.filtro;
      const lista = c.divergencias.filter((d) => !filtro || d.tipo === filtro);
      blocos.push(h('section', { class: 'vg-card' },
        h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Comparação XML × SPED' }),
          c.cobertura.desde ? h('span', { class: 'meta', text: `XMLs no Appura desde ${dataBR(c.cobertura.desde)}` }) : null),
        h('div', { class: 'sped-totais' },
          h('div', {}, h('span', { class: 'meta', text: 'NF-e de entrada com XML no período' }), h('strong', { text: e3Num(t.entradasXml) })),
          h('div', {}, h('span', { class: 'meta', text: 'Conferidas no SPED' }), h('strong', { text: `${e3Num(t.entradasConferidas)}${t.entradasXml ? ` (${Math.round((t.entradasConferidas / t.entradasXml) * 100)}%)` : ''}` })),
          h('div', {}, h('span', { class: 'meta', text: 'NF-e de entrada no SPED' }), h('strong', { text: e3Num(t.entradasSped) })),
          h('div', {}, h('span', { class: 'meta', text: 'Saídas conferidas' }), h('strong', { text: c.cobertura.saidas ? `${e3Num(t.saidasConferidas)} de ${e3Num(t.saidasXml)}` : 'Sem XML de saída' }))),
        c.observacoes.length ? h('ul', { class: 'sped-obs' }, ...c.observacoes.map((o) => h('li', { text: o }))) : null,
        tipos.length ? h('div', { class: 'sped-filtros', role: 'group', 'aria-label': 'Filtrar divergências' },
          h('button', { type: 'button', class: `vg-chip-f${!filtro ? ' ativo' : ''}`, 'aria-pressed': String(!filtro), onclick: () => { est.filtro = ''; spedRender(); } }, `Todas ${e3Num(c.divergencias.length)}`),
          ...tipos.map(([k, n]) => h('button', { type: 'button', class: `vg-chip-f${filtro === k ? ' ativo' : ''}`, 'aria-pressed': String(filtro === k), onclick: () => { est.filtro = k; spedRender(); } }, `${SPED_TIPOS[k]} ${e3Num(n)}`)))
          : h('div', { class: 'e360-tudo-ok' }, h('span', { class: 'vg-simbolo ok', 'aria-hidden': 'true', text: '✓' }), 'Nenhuma divergência entre os XMLs e o SPED.'),
        lista.length ? h('ul', { class: 'sped-div' }, ...lista.slice(0, 300).map((d) => h('li', { class: d.nivel },
          h('div', { class: 'sped-div-topo' },
            h('span', { class: `selo ${NIVEL[d.nivel].tom}`, text: SPED_TIPOS[d.tipo] }),
            h('strong', { text: `${({ '55': 'NF-e', '65': 'NFC-e', '57': 'CT-e' })[d.modelo] || d.modelo} ${d.numero}` }),
            h('span', { class: 'meta', text: `${dataBR(d.data)}${d.participante ? ` · ${d.participante}` : ''}` }),
            h('span', { class: 'sped-div-valores' }, d.valorXml !== null ? `XML ${fmt(d.valorXml)}` : '', d.valorXml !== null && d.valorSped !== null ? ' · ' : '', d.valorSped !== null ? `SPED ${fmt(d.valorSped)}` : '')),
          h('span', { class: 'meta', text: d.detalhe }),
          h('span', { class: 'mono sped-chave', text: d.chave })))) : null,
        lista.length > 300 ? h('p', { class: 'meta', text: `Mostrando 300 de ${e3Num(lista.length)}.` }) : null));
    }
    alvo.replaceChildren(...blocos);
  }

  /* Ações (menu do computador e folha do celular), só as que o perfil permite */
  function e360ListaAcoes() {
    const e = empresaNotas;
    if (!e) return [];
    const lista = [];
    if (pode('operar')) {
      lista.push({ id: 'sincronizar', texto: e.sincronizacao_pedida ? 'Sincronização já pedida' : 'Sincronizar XML', icone: 'refresh-cw', desabilitado: !e.ativo || e.sincronizacao_pedida || !e.certificado_valido_ate, fn: () => sincronizar(e).then(e360AtualizarAcoes), celular: true });
      lista.push({ id: 'importar', texto: 'Importar arquivos', icone: 'cloud-download', fn: () => $('notas-importar-arquivos').click(), celular: true });
    }
    lista.push({ id: 'zip', texto: 'Baixar XMLs do mês (ZIP)', icone: 'file-text', fn: () => baixarZip(), menu: true, celular: true });
    if (pode('certificados')) {
      lista.push({ id: 'certificado', texto: 'Trocar certificado', icone: 'key-round', fn: () => abrirGaveta(e), menu: true, celular: true });
      lista.push({ id: 'pausar', texto: e3.confirmarPausa ? (e.ativo ? 'Confirmar pausa' : 'Confirmar reativação') : (e.ativo ? 'Pausar empresa' : 'Reativar empresa'), icone: 'clock-alert', perigo: e.ativo, menu: true, manterAberto: !e3.confirmarPausa, fn: e360Pausar });
    }
    lista.push({ id: 'historico', texto: 'Histórico', icone: 'list-checks', fn: () => trocarAba('historico'), menu: true });
    return lista;
  }

  async function e360Pausar() {
    if (!e3.confirmarPausa) { e3.confirmarPausa = true; e360AtualizarAcoes(); setTimeout(() => { e3.confirmarPausa = false; e360AtualizarAcoes(); }, 6000); return; }
    e3.confirmarPausa = false;
    const id = empresaNotas.id;
    await alternarAtivo(empresaNotas);
    empresaNotas = empresas.find((x) => x.id === id) || empresaNotas;
    e360Carregar();
  }

  function e360AtualizarAcoes() {
    const acoes = e360ListaAcoes();
    const sinc = acoes.find((a) => a.id === 'sincronizar');
    $('e360-sincronizar').hidden = !sinc;
    if (sinc) { $('e360-sincronizar').disabled = !!sinc.desabilitado; $('e360-sincronizar').lastChild.textContent = sinc.texto; }
    $('notas-importar').hidden = !acoes.some((a) => a.id === 'importar');
    const itemMenu = (a, fechar) => h('button', {
      type: 'button', role: 'menuitem', class: a.perigo && e3.confirmarPausa && a.id === 'pausar' ? 'perigo' : '', disabled: a.desabilitado,
      onclick: async (ev) => { ev.stopPropagation(); if (!a.manterAberto) fechar(); await a.fn(); },
    }, icone(a.icone), a.texto);
    $('e360-menu').replaceChildren(...acoes.filter((a) => a.menu).map((a) => itemMenu(a, () => e360Menu(false))));
    $('e360-folha-itens').replaceChildren(...acoes.filter((a) => a.celular).map((a) => itemMenu(a, () => e360Folha(false))));
  }

  function e360Menu(abrir) {
    const menu = $('e360-menu');
    const ab = abrir ?? menu.hidden;
    menu.hidden = !ab;
    $('e360-mais').setAttribute('aria-expanded', String(ab));
  }
  function e360Folha(abrir) {
    $('e360-folha').hidden = !abrir;
    $('e360-folha-fundo').hidden = !abrir;
    if (abrir) { const b = $('e360-folha-itens').querySelector('button:not([disabled])'); if (b) b.focus(); }
  }

  function e360Ligar() {
    $('e360-sincronizar').addEventListener('click', () => { const a = e360ListaAcoes().find((x) => x.id === 'sincronizar'); if (a) a.fn(); });
    $('e360-mais').addEventListener('click', (ev) => { ev.stopPropagation(); e360Menu(); });
    document.addEventListener('click', (ev) => { if (!ev.target.closest('.menu-acoes')) e360Menu(false); });
    $('e360-acoes-celular').addEventListener('click', () => e360Folha(true));
    $('e360-folha-fechar').addEventListener('click', () => e360Folha(false));
    $('e360-folha-fundo').addEventListener('click', () => e360Folha(false));
    $('e360-ver-historico').addEventListener('click', () => trocarAba('historico'));
    $('sped-enviar').addEventListener('click', () => $('sped-arquivo').click());
    $('sped-arquivo').addEventListener('change', (ev) => spedEnviar(ev.target.files[0]));
    const painel = $('painel-sped');
    painel.addEventListener('dragover', (ev) => { ev.preventDefault(); painel.classList.add('arrastando'); });
    painel.addEventListener('dragleave', () => painel.classList.remove('arrastando'));
    painel.addEventListener('drop', (ev) => { ev.preventDefault(); painel.classList.remove('arrastando'); if (pode('operar')) spedEnviar(ev.dataTransfer.files[0]); });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { e360Menu(false); e360Folha(false); } });
  }
  e360Ligar();
  window.e360Resetar = e360Resetar;
  window.e360Carregar = e360Carregar;
  window.e360RenderArquivos = e360RenderArquivos;
  window.e360RenderHistorico = e360RenderHistorico;
  window.e360Folha = e360Folha;
  window.spedRender = spedRender;
}
