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
  const resumo = (x) => (x ? { erros: x.erros, alertas: x.alertas, divergencias: x.divergencias, enviado_em: x.enviado_em } : null);
  return { ...e, notas_mes: docs.total, nao_auditadas: docs.naoAuditadas, apont_abertos: a.erro + a.alerta, apont_total: a.total, sped: resumo(d.sped), contrib: resumo(d.contrib), sintegra: resumo(d.sintegra) };
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

  const p = (n, s1, sn) => `${n} ${n === 1 ? s1 : sn}`;
  const sp = d.sped; const ct = d.contrib; const si = d.sintegra;
  let sped;
  let val;
  // Simples Nacional e MEI (ou empresa que já mandou SINTEGRA): o arquivo do mês é o SINTEGRA, a não ser que já exista SPED
  const sintegra = (['simples', 'mei'].includes(e.regime) || !!si) && !sp && !ct;
  if (sintegra && !si) {
    sped = { estado: 'nao_iniciado', texto: 'Nenhum SINTEGRA enviado' };
    val = { estado: 'nao_iniciado', texto: 'Aguardando o SINTEGRA' };
  } else if (sintegra) {
    sped = si.erros ? { estado: 'pendencia', texto: `SINTEGRA · ${p(si.erros, 'erro no arquivo', 'erros no arquivo')}` }
      : { estado: 'concluido', texto: `SINTEGRA recebido${si.alertas ? ` · ${p(si.alertas, 'alerta', 'alertas')}` : ''}` };
    val = si.divergencias ? { estado: 'pendencia', texto: p(si.divergencias, 'divergência com os XMLs', 'divergências com os XMLs') }
      : si.divergencias === null || si.divergencias === undefined ? { estado: 'nao_iniciado', texto: 'Sem comparação' }
        : { estado: 'concluido', texto: 'XML e SINTEGRA conferem' };
  } else if (!sp && !ct) {
    sped = { estado: 'nao_iniciado', texto: 'Nenhum SPED enviado' };
    val = { estado: 'nao_iniciado', texto: 'Aguardando o SPED' };
  } else {
    const erros = (sp ? sp.erros : 0) + (ct ? ct.erros : 0);
    const alertas = (sp ? sp.alertas : 0) + (ct ? ct.alertas : 0);
    const quais = sp && ct ? 'Fiscal e Contribuições' : sp ? 'SPED Fiscal' : 'SPED Contribuições';
    sped = erros ? { estado: 'pendencia', texto: `${quais} · ${p(erros, 'erro no arquivo', 'erros no arquivo')}` }
      : { estado: 'concluido', texto: `${quais} recebido${sp && ct ? 's' : ''}${alertas ? ` · ${p(alertas, 'alerta', 'alertas')}` : ''}` };
    const partes = [];
    if (sp && sp.divergencias) partes.push(p(sp.divergencias, 'divergência com os XMLs', 'divergências com os XMLs'));
    if (ct && ct.divergencias) partes.push(p(ct.divergencias, 'divergência Fiscal × Contribuições', 'divergências Fiscal × Contribuições'));
    const comparou = (sp && sp.divergencias !== null && sp.divergencias !== undefined) || (ct && ct.divergencias !== null && ct.divergencias !== undefined);
    val = partes.length ? { estado: 'pendencia', texto: partes.join(' · ') }
      : !comparou ? { estado: 'nao_iniciado', texto: 'Sem comparação' }
        : { estado: 'concluido', texto: sp ? 'XML e SPED conferem' : 'Conferido' };
  }

  return [
    { id: 'xml', nome: 'Captação', aba: 'notas', ...xml },
    { id: 'auditoria', nome: 'Auditoria', aba: 'auditoria', ...aud },
    { id: 'st', nome: 'ICMS-ST', aba: e.uf === 'ES' ? 'st' : null, ...st },
    { id: 'sped', nome: sintegra ? 'SINTEGRA' : 'SPED', aba: 'sped', ...sped },
    { id: 'validacao', nome: 'Validação', aba: 'sped', ...val },
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
  const sp = d.sped;
  if (sp && sp.erros) itens.push({ id: 'sped-erros', tom: 'pendente', icone: 'file-warning', texto: `SPED Fiscal com ${sp.erros} erro${sp.erros === 1 ? '' : 's'} no arquivo`, aba: 'sped' });
  if (sp && sp.divergencias) itens.push({ id: 'sped', tom: 'pendente', icone: 'file-spreadsheet', texto: `${sp.divergencias} divergência${sp.divergencias === 1 ? '' : 's'} entre SPED e XML`, aba: 'sped' });
  const ct = d.contrib;
  if (ct && ct.erros) itens.push({ id: 'contrib-erros', tom: 'pendente', icone: 'file-warning', texto: `SPED Contribuições com ${ct.erros} erro${ct.erros === 1 ? '' : 's'} (ex.: venda fora da receita do PIS/COFINS)`, aba: 'sped', spedAba: 'contrib' });
  if (ct && ct.divergencias) itens.push({ id: 'contrib', tom: 'pendente', icone: 'file-spreadsheet', texto: `${ct.divergencias} divergência${ct.divergencias === 1 ? '' : 's'} entre SPED Fiscal e Contribuições`, aba: 'sped', spedAba: 'contrib' });
  const si = d.sintegra;
  if (si && si.erros) itens.push({ id: 'sintegra-erros', tom: 'pendente', icone: 'file-warning', texto: `SINTEGRA com ${si.erros} erro${si.erros === 1 ? '' : 's'} no arquivo`, aba: 'sped' });
  if (si && si.divergencias) itens.push({ id: 'sintegra', tom: 'pendente', icone: 'file-spreadsheet', texto: `${si.divergencias} divergência${si.divergencias === 1 ? '' : 's'} entre SINTEGRA e XML`, aba: 'sped' });
  if (d.sugestao) itens.push({ id: 'cadastro', tom: 'info', icone: 'building-2', texto: 'Dados do arquivo fiscal para conferir no cadastro', acao: 'cadastro' });
  if (cert.situacao === 'vencendo') itens.push({ id: 'cert', tom: 'pendente', icone: 'triangle-alert', texto: `Certificado vence em ${cert.dias} dia${cert.dias === 1 ? '' : 's'}`, acao: 'certificado' });
  if (st && st.uf === 'ES' && st.total > 0) {
    itens.push({ id: 'st', tom: 'pendente', icone: 'calculator', texto: `ICMS-ST a recolher nas entradas: ${st.total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, aba: 'st' });
  }
  const docs = e360Documentos(d);
  if (docs.soResumo) itens.push({ id: 'resumo', tom: 'info', icone: 'file-warning', texto: `${docs.soResumo} nota${docs.soResumo === 1 ? '' : 's'} só com resumo (XML completo ainda não chegou)`, aba: 'notas', filtroSituacao: 'resumo' });
  return itens;
}

var E360_ARQUIVO = { efd_icms_ipi: 'SPED Fiscal', efd_contribuicoes: 'SPED Contribuições', sintegra: 'SINTEGRA' };

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
      case 'sped': {
        const comp = v.competencia ? String(v.competencia).slice(0, 7).split('-').reverse().join('/') : '';
        const partes = [comp ? `Competência ${comp}` : '', v.erros ? `${v.erros} erro${v.erros === 1 ? '' : 's'}` : 'sem erros', v.divergencias ? `${v.divergencias} divergência${v.divergencias === 1 ? '' : 's'}` : ''];
        const tipo = E360_ARQUIVO[v.tipo] || 'SPED Fiscal';
        return { em: x.em, tom: v.erros || v.divergencias ? 'pendente' : 'ok', icone: 'file-spreadsheet', titulo: `${tipo} enviado${v.nome ? `: ${v.nome}` : ''}`, detalhe: partes.filter(Boolean).join(' · '), por: x.por };
      }
      case 'cadastro': {
        const n = (v.campos || []).length;
        return v.status === 'aprovado'
          ? { em: x.em, tom: 'ok', icone: 'building-2', titulo: `Cadastro atualizado pelo arquivo fiscal (${n} campo${n === 1 ? '' : 's'})`, detalhe: '', por: x.por }
          : { em: x.em, tom: 'neutro', icone: 'building-2', titulo: 'Dados do arquivo fiscal recusados no cadastro', detalhe: '', por: x.por };
      }
      case 'justificativa': {
        const n = Number(v.n);
        const comp = v.competencia ? String(v.competencia).slice(0, 7).split('-').reverse().join('/') : '';
        const partes = [E360_ARQUIVO[v.tipo_arquivo] || '', comp ? `Competência ${comp}` : '', v.observacao ? `"${v.observacao}"` : ''];
        return { em: x.em, tom: 'ok', icone: 'file-check', titulo: `${n} divergência${n === 1 ? '' : 's'} justificada${n === 1 ? '' : 's'}`, detalhe: partes.filter(Boolean).join(' · '), por: x.por };
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
    if (e3.sped && e3.sped.id !== e.id) { e3.sped = null; e3.spedAba = null; }
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
    spedAjustarAba();
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
      const destino = a.aba ? () => { if (a.filtroSituacao) $('notas-situacao').value = a.filtroSituacao; if (a.spedAba) e3.spedAba = a.spedAba; trocarAba(a.aba); }
        : a.acao === 'certificado' && pode('certificados') ? () => abrirGaveta(empresaNotas)
          : a.acao === 'cadastro' ? () => irPara(`#/sped?cadastro=${d.sugestao.id}`) : null;
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
    const k = d.cadastro || {};
    const endereco = [k.logradouro, k.numero, k.complemento].filter(Boolean).join(', ');
    const cep = k.cep ? `${k.cep.slice(0, 5)}-${k.cep.slice(5)}` : null;
    const municipio = k.cod_municipio ? `${k.municipio || 'Código IBGE'} · ${k.cod_municipio}` : null;
    $('e360-dados').replaceChildren(...[
      d.sugestao ? h('div', { class: 'e360-sugestao' }, icone('building-2'),
        h('div', {}, h('strong', { text: 'Dados do arquivo fiscal para conferir' }),
          h('span', { class: 'meta', text: `O arquivo de ${textoCompetencia(String(d.sugestao.competencia).slice(0, 7))} traz dados diferentes do cadastro.` }),
          h('a', { class: 'botao pequeno', href: `#/sped?cadastro=${d.sugestao.id}` }, 'Conferir e aprovar'))) : null,
      h('h2', { class: 'vg-card-titulo', text: 'Dados da empresa' }),
      h('dl', { class: 'e360-dl' }, ...campo('CNPJ', formatarCnpj(e.cnpj)), ...campo('Nome fantasia', k.nome_fantasia), ...campo('IE', k.ie),
        ...campo('Regime', e.regime ? REGIMES[e.regime] || e.regime : 'Não informado'),
        ...campo('UF', e.uf), ...campo('Município', municipio), ...campo('Código ERP', e.codigo_erp), ...campo('Situação', e.ativo ? 'Ativa' : 'Pausada')),
      h('h2', { class: 'vg-card-titulo', text: 'Endereço e contato' }),
      h('dl', { class: 'e360-dl' }, ...campo('Endereço', endereco), ...campo('Bairro', k.bairro), ...campo('CEP', cep), ...campo('Telefone', k.fone), ...campo('E-mail', k.email)),
      h('h2', { class: 'vg-card-titulo', text: 'Contador (SPED)' }),
      h('dl', { class: 'e360-dl' }, ...campo('Nome', k.contador_nome), ...campo('CRC', k.contador_crc), ...campo('E-mail', k.contador_email), ...campo('Telefone', k.contador_fone)),
      h('h2', { class: 'vg-card-titulo', text: 'Certificado' }),
      h('dl', { class: 'e360-dl' }, ...campo('Tipo', d.certificado ? 'A1' : '—'),
        ...campo('Validade', d.certificado ? new Date(d.certificado.valido_ate).toLocaleDateString('pt-BR') : null), ...campo('Situação', cert.texto)),
      h('h2', { class: 'vg-card-titulo', text: 'Captação' }),
      h('dl', { class: 'e360-dl' }, ...campo('Última consulta', ultConsulta ? e3Quando(ultConsulta) : null), ...campo('Próxima consulta', proxima ? e3Quando(proxima) : null),
        ...campo('Situação SEFAZ', porModelo), ...campo('Janela', 'Das 23h às 6h')),
      h('p', { class: 'meta', text: k.cadastro_atualizado_em
        ? `Cadastro conferido pelo SPED ${e3Quando(k.cadastro_atualizado_em)}${k.cadastro_atualizado_por ? ` por ${k.cadastro_atualizado_por}` : ''}.`
        : 'IE, município, endereço e contador entram quando o escritório aprovar os dados de um SPED ou SINTEGRA enviado.' }),
    ].filter(Boolean));
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
        docs.total ? h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => baixarZip(ev.currentTarget) }, 'Baixar ZIP') : null),
      ...importacoes.map((x) => linha(`Importação de ${e3Num(x.dados.n)} documento${Number(x.dados.n) === 1 ? '' : 's'}`, 'XML/ZIP importado', '—', e3Quando(x.em), 'Importação pelo painel', 'Não registrado', null)),
    ];
    for (const a of d.spedArquivos || []) {
      linhas.push(linha(a.nome, ({ efd_contribuicoes: 'SPED Contribuições (EFD PIS/COFINS)', sintegra: 'SINTEGRA (Convênio 57/95)' })[a.tipo] || 'SPED Fiscal (EFD ICMS/IPI)', textoCompetencia(String(a.competencia).slice(0, 7)), e3Quando(a.enviado_em), 'Envio pelo painel', a.enviado_por,
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => spedBaixar(a.id, a.nome) }, 'Baixar')));
    }
    if (d.empresa.uf === 'ES') {
      linhas.push(linha(`Planilha de ICMS-ST · ${comp}`, 'Excel (.xlsx)', comp, 'Gerada na hora', 'Cálculo do Appura', '—',
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => baixarPlanilhaST() }, 'Gerar e baixar')));
    }
    alvo.replaceChildren(h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Arquivos' }),
        h('p', { class: 'meta', text: 'Somente o que está armazenado. O Appura ainda não registra qual usuário fez cada importação de XML; o envio de SPED e SINTEGRA fica registrado.' }))),
      h('div', { class: 'vg-tabela-caixa' }, h('table', { class: 'vg-tabela e360-arquivos' },
        h('thead', {}, h('tr', {}, ...['Nome', 'Tipo', 'Competência', 'Data', 'Origem', 'Usuário', 'Ação'].map((t) => h('th', { scope: 'col', text: t })))),
        h('tbody', {}, ...linhas))),
      h('div', { class: 'e360-breve pequeno' }, icone('file-spreadsheet'), h('div', {}, h('strong', { text: 'Guias' }), h('p', { text: 'As guias entram nesta lista quando o módulo existir.' })))));
  }


  /* ---------- SPED Fiscal, SPED Contribuições e SINTEGRA: envio, validação, comparação e justificativas ---------- */
  var SPED_TIPOS = {
    xml_sem_escrituracao: 'XML sem escrituração',
    escriturada_sem_xml: 'Escriturada sem XML',
    valor: 'Valor diferente',
    situacao: 'Situação diferente',
    cte_sem_d100: 'CT-e tomado sem D100',
    saida_sem_escrituracao: 'Saída fora do SPED',
  };
  var CRUZ_TIPOS = {
    fiscal_sem_contribuicoes: 'Venda fora do Contribuições',
    contribuicoes_sem_fiscal: 'Fora do SPED Fiscal',
    valor: 'Valor diferente',
    situacao: 'Situação diferente',
    receita_tributavel_sem_pis: 'Tributável sem PIS/COFINS',
    monofasico_tributado: 'Monofásico tributado',
  };
  var SINTEGRA_TIPOS = {
    xml_sem_registro: 'XML sem registro 50',
    registro_sem_xml: 'Registro 50 sem XML',
    valor: 'Valor diferente',
    situacao: 'Situação diferente',
    saida_sem_registro: 'Saída fora do SINTEGRA',
    nfce_fora_das_faixas: 'NFC-e fora das faixas do 61',
    nfce_valor_dia: 'NFC-e: total do dia',
  };
  var NIVEL = { erro: { tom: 'problema', texto: 'Erro' }, alerta: { tom: 'pendente', texto: 'Alerta' }, info: { tom: 'neutro', texto: 'Informação' } };
  var MODELO = { '55': 'NF-e', '65': 'NFC-e', '57': 'CT-e' };
  var spedData = (iso) => (iso ? iso.split('-').reverse().join('/') : '—');
  var spedParteDoTipo = (t) => (t === 'efd_contribuicoes' ? 'contrib' : t === 'sintegra' ? 'sintegra' : 'fiscal');

  /** Carrega os arquivos guardados da competência (o vigente e os envios anteriores de cada tipo). */
  async function spedCarregar(forcar) {
    if (!empresaNotas) return;
    const id = empresaNotas.id;
    const mes = mesSelecionado();
    // Mesma empresa e competência: mostra o que já tem e atualiza em segundo plano (ex.: cadastro aprovado em outra tela)
    const temCache = e3.sped && e3.sped.id === id && e3.sped.mes === mes && !e3.sped.erro && !e3.sped.carregando;
    if (!temCache || forcar === 'limpar') {
      e3.sped = { id, mes, fiscal: spedParte(), contrib: spedParte(), sintegra: spedParte(), carregando: true };
    }
    spedRender();
    try {
      const d = await chamar(`/api/empresas/${id}/sped?mes=${mes}`);
      if (!empresaNotas || empresaNotas.id !== id || mesSelecionado() !== mes) return;
      const c = d.contribuicoes || {};
      const si = d.sintegra || {};
      const antes = e3.sped && e3.sped.id === id && e3.sped.mes === mes ? e3.sped : null;
      e3.sped = { id, mes, carregando: false, sugestao: d.sugestao || null,
        fiscal: spedParte(d.vigente, d.arquivos), contrib: spedParte(c.vigente, c.arquivos), sintegra: spedParte(si.vigente, si.arquivos) };
      // Mantém os filtros escolhidos na lista de divergências
      for (const k of ['fiscal', 'contrib', 'sintegra']) {
        if (antes && antes[k]) { e3.sped[k].filtro = antes[k].filtro; e3.sped[k].situacao = antes[k].situacao; }
      }
      // Abre no que existe: se só o Contribuições foi enviado, mostra ele
      if (!e3.spedAba && !d.vigente) e3.spedAba = c.vigente ? 'contrib' : si.vigente ? 'sintegra' : null;
    } catch (err) {
      if (!empresaNotas || empresaNotas.id !== id) return;
      e3.sped = { id, mes, fiscal: spedParte(), contrib: spedParte(), sintegra: spedParte(), carregando: false, erro: err.message };
    }
    spedRender();
  }

  function spedParte(r = null, arquivos = []) { return { r: r || null, arquivos: arquivos || [], filtro: '', situacao: 'abertas' }; }

  async function spedEnviar(arquivo) {
    if (!arquivo || !empresaNotas) return;
    const id = empresaNotas.id;
    const alvo = $('sped-resultado');
    $('sped-enviar').disabled = true;
    alvo.replaceChildren(h('div', { class: 'vg-card' }, h('strong', { text: `Lendo ${arquivo.name}…` }), h('span', { class: 'meta', text: `${(arquivo.size / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` }), h('div', { class: 'vg-skel', 'aria-hidden': 'true' })));
    try {
      const r = await enviarArquivo(`/api/empresas/${id}/sped?nome=${encodeURIComponent(arquivo.name)}`, arquivo);
      if (!empresaNotas || empresaNotas.id !== id) return;
      if (!r.valido) {
        alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Este arquivo não parece ser um SPED Fiscal, um SPED Contribuições nem um SINTEGRA.' }), ...(r.ocorrencias || []).filter((o) => o.nivel === 'erro').map((o) => h('span', { text: o.mensagem }))));
        return;
      }
      const parte = spedParteDoTipo(r.tipo);
      e3.spedAba = parte;
      e3.sped = { id, mes: r.competencia, fiscal: spedParte(), contrib: spedParte(), sintegra: spedParte(), sugestao: r.sugestao || null };
      e3.sped[parte] = spedParte(r, []);
      spedRender();
      // O Appura vai para o mês do arquivo (a troca de competência recarrega a aba)
      if (r.competencia !== mesSelecionado()) definirCompetencia(r.competencia);
      else spedCarregar(true);
      // Cabeçalho, etapas e "Precisa de atenção" passam a contar o arquivo novo
      window.e360Chave = null;
      e360Carregar();
    } catch (err) {
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível ler o arquivo.' }), h('span', { text: err.message })));
    } finally {
      $('sped-enviar').disabled = false;
      $('sped-arquivo').value = '';
    }
  }

  async function spedRefazer(ev) {
    const est = e3.sped && e3.sped[spedParteAtual(spedModoSintegra())];
    if (!est || !est.r) return;
    await comOcupado(ev && ev.currentTarget, 'Comparando…', async () => {
      est.r = await chamar(`/api/sped/${est.r.id}/refazer`, { method: 'POST' });
      spedRender();
      e360Carregar();
    }, `refazer-${est.r.id}`);
  }

  var SPED_ABAS = { fiscal: 'SPED Fiscal', contrib: 'SPED Contribuições', sintegra: 'SINTEGRA' };

  /**
   * Simples Nacional e MEI (ou empresa que já enviou SINTEGRA): a aba é do SINTEGRA,
   * a não ser que já exista SPED enviado para a empresa no mês.
   */
  function spedModoSintegra() {
    if (!empresaNotas) return false;
    const d = e3.dados && e3.dados.empresa && e3.dados.empresa.id === empresaNotas.id ? e3.dados : null;
    const est = e3.sped && e3.sped.id === empresaNotas.id ? e3.sped : null;
    const temSped = (d && (d.sped || d.contrib)) || (est && ((est.fiscal && est.fiscal.r) || (est.contrib && est.contrib.r)));
    if (temSped) return false;
    const temSintegra = (d && d.sintegra) || (est && est.sintegra && est.sintegra.r);
    return !!temSintegra || ['simples', 'mei'].includes(empresaNotas.regime);
  }

  /** Parte mostrada: no modo SINTEGRA só existe ela; no modo SPED, o SINTEGRA aparece como terceira opção quando foi enviado. */
  function spedParteAtual(sintegra) {
    if (sintegra) return 'sintegra';
    const est = e3.sped;
    if (e3.spedAba === 'contrib') return 'contrib';
    if (e3.spedAba === 'sintegra' && est && est.sintegra && est.sintegra.r) return 'sintegra';
    return 'fiscal';
  }

  function spedAjustarAba() {
    const sintegra = spedModoSintegra();
    $('aba-sped').textContent = sintegra ? 'SINTEGRA' : 'SPED';
    $('sped-titulo').textContent = sintegra ? 'SINTEGRA' : 'SPED Fiscal e SPED Contribuições';
    $('sped-descricao').textContent = sintegra
      ? 'Empresa do Simples Nacional: o arquivo do mês é o SINTEGRA (Convênio 57/95). Envie o .txt: o Appura guarda o arquivo (criptografado), confere a estrutura, os totalizadores e a numeração das NFC-e e compara as notas com os XMLs. O resultado entra na Central de Fechamento.'
      : 'Envie o .txt do SPED Fiscal (EFD ICMS/IPI) ou do SPED Contribuições (EFD PIS/COFINS): o Appura reconhece o tipo, guarda o arquivo (criptografado), confere a estrutura e a apuração e compara com os XMLs e entre os dois SPEDs. O resultado entra na Central de Fechamento.';
    $('sped-enviar-rotulo').textContent = sintegra ? 'Enviar SINTEGRA (.txt)' : 'Enviar SPED (.txt)';
    return sintegra;
  }

  function spedRender() {
    const alvo = $('sped-resultado');
    $('sped-enviar').hidden = !pode('operar');
    $('sped-sem-permissao').hidden = pode('operar');
    const est = e3.sped;
    const sintegra = spedAjustarAba();
    if (!est || !empresaNotas || est.id !== empresaNotas.id) { alvo.replaceChildren(); return; }
    if (est.carregando) { alvo.replaceChildren(h('div', { class: 'vg-card' }, ...e360Esqueleto(3))); return; }
    if (est.erro) {
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar os arquivos guardados.' }), h('span', { text: est.erro }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => spedCarregar(true) }, icone('refresh-cw'), 'Tentar de novo')));
      return;
    }
    const aba = spedParteAtual(sintegra);
    const selo = (parte) => {
      const r = parte.r;
      if (!r) return h('span', { class: 'selo neutro', text: 'Não enviado' });
      const erros = (r.ocorrencias || []).filter((o) => o.nivel === 'erro').length;
      const div = r.comparacao ? r.comparacao.divergencias.filter((d) => d.nivel !== 'info' && !d.justificativa).length : 0;
      return erros ? h('span', { class: 'selo problema', text: `${erros} erro${erros === 1 ? '' : 's'}` })
        : div ? h('span', { class: 'selo pendente', text: `${div} diverg.` }) : h('span', { class: 'selo ok', text: 'OK' });
    };
    const abas = sintegra ? [] : Object.keys(SPED_ABAS).filter((k) => k !== 'sintegra' || (est.sintegra && est.sintegra.r));
    const troca = abas.length ? h('div', { class: 'segmentos sped-segmentos', role: 'tablist', 'aria-label': 'Tipo de arquivo' },
      ...abas.map((k) => h('button', {
        type: 'button', role: 'tab', class: `segmento${aba === k ? ' ativo' : ''}`, 'aria-selected': String(aba === k),
        onclick: () => { e3.spedAba = k; spedRender(); },
      }, SPED_ABAS[k], ' ', selo(est[k])))) : null;
    const parte = est[aba];
    parte.mes = est.mes;
    const semRegime = !empresaNotas.regime && !sintegra
      ? h('p', { class: 'meta', text: 'Regime não informado. Se a empresa for do Simples Nacional, o arquivo do mês é o SINTEGRA: pode enviá-lo pelo mesmo botão.' }) : null;
    if (!parte.r) {
      const texto = {
        fiscal: 'Quando o arquivo for enviado, a validação e a comparação com os XMLs ficam guardadas aqui e entram na Central de Fechamento.',
        contrib: 'Quando o arquivo for enviado, o Appura confere a estrutura, a classificação das receitas (CST) e a apuração do PIS/COFINS, cruza as vendas com o SPED Fiscal do mês e confere monofásico × tributado pelo NCM dos XMLs.',
        sintegra: 'Quando o arquivo for enviado, o Appura confere os registros 10 a 90, os totalizadores, a numeração das NFC-e (61) e as declarações (88), e compara as notas com os XMLs.',
      }[aba];
      alvo.replaceChildren(...[troca, semRegime, h('div', { class: 'vg-vazio pequeno' }, h('strong', { text: `Nenhum ${SPED_ABAS[aba]} de ${textoCompetencia(est.mes)} enviado ainda.` }),
        h('span', { text: texto }))].filter(Boolean));
      return;
    }
    const blocos = aba === 'fiscal' ? spedBlocosFiscal(parte) : aba === 'contrib' ? spedBlocosContrib(parte) : spedBlocosSintegra(parte);
    alvo.replaceChildren(...[troca, semRegime, ...blocos].filter(Boolean));
  }

  /** Quem enviou, ações (refazer/baixar), cadastro a conferir e aviso de competência. */
  function spedTopo(est, dicaRefazer) {
    const { r } = est;
    const res = r.resumo;
    const blocos = [];
    // Envio: quem, quando e ações sobre o arquivo guardado
    const arq = r.arquivo;
    blocos.push(h('div', { class: 'sped-envio-info' },
      h('span', { class: 'meta', text: `Enviado ${e3Quando(arq.enviadoEm)} por ${arq.enviadoPor}${arq.processadoEm && arq.processadoEm !== arq.enviadoEm ? ` · comparação refeita ${e3Quando(arq.processadoEm)}` : ''}` }),
      h('div', { class: 'sped-envio-acoes' },
        pode('operar') ? h('button', { type: 'button', id: 'sped-refazer', class: 'botao pequeno', title: dicaRefazer, onclick: spedRefazer }, icone('refresh-cw'), h('span', { text: 'Refazer comparação' })) : null,
        h('a', { class: 'botao pequeno', href: '#', onclick: (ev) => { ev.preventDefault(); spedBaixar(r.id, arq.nome); } }, icone('file-text'), 'Baixar arquivo'))));
    const sug = e3.sped && e3.sped.sugestao;
    if (sug) {
      blocos.push(h('div', { class: 'sped-aviso' }, icone('building-2'),
        h('span', { text: 'O arquivo trouxe dados de cadastro diferentes do que está no Appura (IE, endereço, contador…). Confira antes de gravar.' }),
        h('a', { class: 'botao pequeno', href: `#/sped?cadastro=${sug.id}` }, 'Conferir cadastro')));
    }
    // Período × competência
    if (res.periodo && res.periodo !== competencia) {
      blocos.push(h('div', { class: 'sped-aviso' }, icone('calendar'),
        h('span', { text: `O arquivo é de ${textoCompetencia(res.periodo)}, e a competência selecionada é ${textoCompetencia(competencia)}.` }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: () => definirCompetencia(res.periodo) }, `Mudar para ${textoCompetencia(res.periodo)}`)));
    }
    return blocos;
  }

  function spedOcorrencias(oc, descricao) {
    return (h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Validação do arquivo' }),
        h('span', { class: 'meta', text: descricao })),
      oc.length ? h('ul', { class: 'sped-ocorrencias' }, ...oc.map((o) => h('li', { class: o.nivel },
        h('span', { class: `selo ${NIVEL[o.nivel].tom}`, text: NIVEL[o.nivel].texto }),
        h('div', {}, h('p', { text: o.mensagem }), o.linhas ? h('span', { class: 'meta', text: `Linha${o.linhas.length > 1 ? 's' : ''} ${o.linhas.join(', ')}${o.quantidade > o.linhas.length ? ` e mais ${o.quantidade - o.linhas.length}` : ''}` }) : null))))
        : h('div', { class: 'e360-tudo-ok' }, h('span', { class: 'vg-simbolo ok', 'aria-hidden': 'true', text: '✓' }), 'Nenhum problema encontrado na estrutura e na apuração.')));
  }

  function spedEnvios(est) {
    if (!est.arquivos || est.arquivos.length < 2) return null;
    return (h('section', { class: 'vg-card' },
        h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: `Envios de ${textoCompetencia(est.mes)}` }),
          h('span', { class: 'meta', text: 'Vale o mais recente (retificador substitui o anterior; as justificativas continuam valendo).' })),
        h('ul', { class: 'sped-envios' }, ...est.arquivos.map((a, i) => h('li', {},
          h('span', { class: `selo ${i === 0 ? 'ok' : 'neutro'}`, text: i === 0 ? 'Vigente' : 'Substituído' }),
          h('strong', { text: a.nome }),
          h('span', { class: 'meta', text: `${e3Quando(a.enviado_em)} · ${a.enviado_por} · ${a.erros ? `${a.erros} erro${a.erros === 1 ? '' : 's'}` : 'sem erros'}${a.divergencias ? ` · ${a.divergencias} divergência${a.divergencias === 1 ? '' : 's'}` : ''}` }),
          h('a', { class: 'botao pequeno', href: '#', onclick: (ev) => { ev.preventDefault(); spedBaixar(a.id, a.nome); } }, 'Baixar'))))));
  }

  function spedSituacao(oc) {
    const nErros = oc.filter((o) => o.nivel === 'erro').length;
    const nAlertas = oc.filter((o) => o.nivel === 'alerta').length;
    return nErros ? { tom: 'problema', texto: `${nErros} erro${nErros === 1 ? '' : 's'} a corrigir` }
      : nAlertas ? { tom: 'pendente', texto: `Sem erros · ${nAlertas} alerta${nAlertas === 1 ? '' : 's'}` } : { tom: 'ok', texto: 'Sem erros nem alertas' };
  }

  /**
   * Lista de divergências de qualquer comparação, com filtro por tipo e por situação (abertas / justificadas)
   * e justificativa individual ou em lote. cfg: { tipos, titulo(d), valores(d), vazio }.
   */
  function spedListaDiv(est, c, cfg) {
    const todas = c.divergencias;
    if (!todas.length) return [h('div', { class: 'e360-tudo-ok' }, h('span', { class: 'vg-simbolo ok', 'aria-hidden': 'true', text: '✓' }), cfg.vazio)];
    const nJust = todas.filter((d) => d.justificativa).length;
    const sit = nJust ? (est.situacao || 'abertas') : 'todas';
    const porSit = todas.filter((d) => sit === 'todas' || (sit === 'justificadas' ? !!d.justificativa : !d.justificativa));
    const contagem = {};
    for (const d of porSit) contagem[d.tipo] = (contagem[d.tipo] || 0) + 1;
    const filtro = est.filtro && contagem[est.filtro] ? est.filtro : '';
    const lista = porSit.filter((d) => !filtro || d.tipo === filtro);
    const abertas = lista.filter((d) => !d.justificativa);
    const podeJ = pode('operar');
    const chip = (ativo, texto, fn) => h('button', { type: 'button', class: `vg-chip-f${ativo ? ' ativo' : ''}`, 'aria-pressed': String(ativo), onclick: fn }, texto);
    const blocos = [];
    const barra = [];
    if (nJust) {
      barra.push(h('div', { class: 'segmentos sped-situacao', role: 'group', 'aria-label': 'Situação das divergências' },
        ...[['abertas', 'Abertas', todas.length - nJust], ['justificadas', 'Justificadas', nJust], ['todas', 'Todas', todas.length]].map(([k, t, n]) => h('button', {
          type: 'button', class: `segmento${sit === k ? ' ativo' : ''}`, 'aria-pressed': String(sit === k),
          onclick: () => { est.situacao = k; est.filtro = ''; spedRender(); },
        }, `${t} ${e3Num(n)}`))));
    }
    if (podeJ && abertas.length > 1) {
      barra.push(h('button', { type: 'button', class: 'botao pequeno sped-lote', onclick: () => spedAbrirJustificar(est, abertas, cfg) },
        icone('file-check'), `Justificar ${filtro ? 'as' : 'todas as'} ${e3Num(abertas.length)} ${filtro ? 'deste filtro' : 'abertas'}`));
    }
    if (barra.length) blocos.push(h('div', { class: 'sped-div-barra' }, ...barra));
    const tipos = Object.keys(contagem);
    if (tipos.length) {
      blocos.push(h('div', { class: 'sped-filtros', role: 'group', 'aria-label': 'Filtrar divergências por tipo' },
        chip(!filtro, `Todas ${e3Num(porSit.length)}`, () => { est.filtro = ''; spedRender(); }),
        ...tipos.map((k) => chip(filtro === k, `${cfg.tipos[k] || k} ${e3Num(contagem[k])}`, () => { est.filtro = k; spedRender(); }))));
    }
    if (!lista.length) {
      blocos.push(h('div', { class: 'e360-tudo-ok' }, h('span', { class: 'vg-simbolo ok', 'aria-hidden': 'true', text: '✓' }),
        sit === 'abertas' ? 'Todas as divergências foram justificadas.' : 'Nenhuma divergência nesta situação.'));
      return blocos;
    }
    blocos.push(h('ul', { class: 'sped-div' }, ...lista.slice(0, 300).map((d) => {
      const j = d.justificativa;
      return h('li', { class: j ? 'justificada' : d.nivel },
        h('div', { class: 'sped-div-topo' },
          h('span', { class: `selo ${NIVEL[d.nivel].tom}`, text: cfg.tipos[d.tipo] || d.tipo }),
          j ? h('span', { class: 'selo ok', text: '✓ Justificada' }) : null,
          h('strong', { text: cfg.titulo(d) }),
          h('span', { class: 'meta', text: `${spedData(d.data)}${d.participante ? ` · ${/^\d{14}$/.test(d.participante) ? formatarCnpj(d.participante) : d.participante}` : ''}` }),
          h('span', { class: 'sped-div-valores', text: cfg.valores(d) })),
        h('span', { class: 'meta', text: d.detalhe }),
        /^\d{44}$/.test(d.chave) ? h('span', { class: 'mono sped-chave', text: d.chave }) : null,
        j ? h('div', { class: 'sped-just' },
          h('div', {}, h('p', { text: j.observacao }), h('span', { class: 'meta', text: `Justificada por ${j.por} · ${e3Quando(j.em)}` })),
          podeJ ? h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: (ev) => spedReabrir(est, [d], ev.currentTarget) }, h('span', { text: 'Reabrir' })) : null)
          : podeJ ? h('div', { class: 'sped-div-acoes' }, h('button', { type: 'button', class: 'botao pequeno', onclick: () => spedAbrirJustificar(est, [d], cfg) }, 'Justificar')) : null);
    })));
    if (lista.length > 300) blocos.push(h('p', { class: 'meta', text: `Mostrando 300 de ${e3Num(lista.length)}. O lote vale para todas as ${e3Num(abertas.length)} abertas do filtro.` }));
    return blocos;
  }

  /* Gaveta de justificativa (uma ou várias divergências) */
  var gjEstado = null;
  function spedAbrirJustificar(est, itens, cfg) {
    if (!est.r || !itens.length) return;
    gjEstado = { est, itens };
    const n = itens.length;
    $('gj-titulo').textContent = n === 1 ? 'Justificar divergência' : `Justificar ${e3Num(n)} divergências`;
    const tipos = [...new Set(itens.map((d) => cfg.tipos[d.tipo] || d.tipo))];
    $('gj-contexto').textContent = `${SPED_ABAS[spedParteDoTipo(est.r.tipo)]} de ${textoCompetencia(est.r.competencia || est.mes)} · ${tipos.join(', ')}`;
    $('gj-itens').replaceChildren(...itens.slice(0, 5).map((d) => h('li', {}, h('strong', { text: `${cfg.titulo(d)} · ${spedData(d.data)}` }), h('span', { class: 'meta', text: d.detalhe }))),
      ...(n > 5 ? [h('li', { class: 'meta', text: `e mais ${e3Num(n - 5)}` })] : []));
    $('gj-observacao').value = '';
    $('gj-observacao').removeAttribute('aria-invalid');
    $('gj-erro').hidden = true;
    abrirDialogo($('gj'));
    $('gj-fundo').hidden = false;
    $('gj').hidden = false;
    $('gj-observacao').focus();
  }

  function spedFecharJustificar() {
    const aberta = !$('gj').hidden;
    $('gj-fundo').hidden = true;
    $('gj').hidden = true;
    gjEstado = null;
    if (aberta) fecharDialogo($('gj'));
  }

  async function spedSalvarJustificativa(ev) {
    ev.preventDefault();
    if (!gjEstado) return;
    const obs = $('gj-observacao').value.trim();
    if (obs.length < 5) {
      $('gj-observacao').setAttribute('aria-invalid', 'true');
      $('gj-erro').textContent = 'Escreva a justificativa (pelo menos 5 caracteres).';
      $('gj-erro').hidden = false;
      $('gj-observacao').focus();
      return;
    }
    const { est, itens } = gjEstado;
    await comOcupado($('gj-salvar'), 'Justificando…', async () => {
      est.r = await chamar(`/api/sped/${est.r.id}/justificar`, { method: 'POST', body: { itens: itens.map((d) => ({ tipo: d.tipo, chave: d.chave })), observacao: obs } });
      spedFecharJustificar();
      avisar(itens.length === 1 ? 'Divergência justificada.' : `${e3Num(itens.length)} divergências justificadas.`, { tipo: 'ok' });
      spedRender();
      window.e360Chave = null;
      e360Carregar();
    }, 'sped-justificar');
  }

  async function spedReabrir(est, itens, botao) {
    await comOcupado(botao, 'Reabrindo…', async () => {
      est.r = await chamar(`/api/sped/${est.r.id}/reabrir`, { method: 'POST', body: { itens: itens.map((d) => ({ tipo: d.tipo, chave: d.chave })) } });
      avisar('Divergência reaberta: volta a contar na Central.', { tipo: 'ok' });
      spedRender();
      window.e360Chave = null;
      e360Carregar();
    }, `sped-reabrir-${itens[0].tipo}-${itens[0].chave}`);
  }

  function spedBlocosFiscal(est) {
    const { r } = est;
    const res = r.resumo;
    const fmt = (v) => moeda(v);
    const oc = r.ocorrencias || [];
    const blocos = [];
    blocos.push(...spedTopo(est, 'Compara de novo com os XMLs que estão no Appura agora'));
    const situacao = spedSituacao(oc);
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
    blocos.push(spedOcorrencias(oc, 'Estrutura (9900, 9999, blocos), chaves de acesso, datas, C190 × C100 e E110 × documentos.'));
    const c = r.comparacao;
    if (c) {
      const t = c.totais;
      blocos.push(h('section', { class: 'vg-card' },
        h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Comparação XML × SPED' }),
          c.cobertura.desde ? h('span', { class: 'meta', text: `XMLs no Appura desde ${spedData(c.cobertura.desde)}` }) : null),
        h('div', { class: 'sped-totais' },
          h('div', {}, h('span', { class: 'meta', text: 'NF-e de entrada com XML no período' }), h('strong', { text: e3Num(t.entradasXml) })),
          h('div', {}, h('span', { class: 'meta', text: 'Conferidas no SPED' }), h('strong', { text: `${e3Num(t.entradasConferidas)}${t.entradasXml ? ` (${Math.round((t.entradasConferidas / t.entradasXml) * 100)}%)` : ''}` })),
          h('div', {}, h('span', { class: 'meta', text: 'NF-e de entrada no SPED' }), h('strong', { text: e3Num(t.entradasSped) })),
          h('div', {}, h('span', { class: 'meta', text: 'Saídas conferidas' }), h('strong', { text: c.cobertura.saidas ? `${e3Num(t.saidasConferidas)} de ${e3Num(t.saidasXml)}` : 'Sem XML de saída' }))),
        c.observacoes.length ? h('ul', { class: 'sped-obs' }, ...c.observacoes.map((o) => h('li', { text: o }))) : null,
        ...spedListaDiv(est, c, {
          tipos: SPED_TIPOS,
          vazio: 'Nenhuma divergência entre os XMLs e o SPED.',
          titulo: (d) => `${MODELO[d.modelo] || d.modelo} ${d.numero}`,
          valores: (d) => [d.valorXml !== null ? `XML ${fmt(d.valorXml)}` : '', d.valorSped !== null ? `SPED ${fmt(d.valorSped)}` : ''].filter(Boolean).join(' · '),
        })));
    }
    const envios = spedEnvios(est);
    if (envios) blocos.push(envios);
    return blocos;
  }

  var spedPct = (x) => `${(Number(x || 0) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;

  /** PIS/COFINS pelo NCM dos XMLs de saída: receita monofásica × tributável e a estimativa do imposto. */
  function spedMonofasico(c) {
    const m = c && c.monofasico;
    const fmt = (v) => moeda(v);
    const importar = pode('operar') ? h('button', { type: 'button', class: 'botao pequeno sped-importar', onclick: () => $('notas-importar-arquivos').click() }, icone('cloud-download'), 'Importar XMLs de saída') : null;
    if (!m || !m.notasComXml) {
      return h('div', { class: 'e360-breve pequeno' }, icone('calculator'), h('div', {}, h('strong', { text: 'Monofásico × tributado pelo NCM' }),
        h('p', { text: m && m.notasSaida
          ? `O Contribuições tem ${e3Num(m.notasSaida)} nota${m.notasSaida === 1 ? '' : 's'} de saída, mas o Appura não tem os XMLs delas. Importe os XMLs (ou o ZIP do sistema da loja) para separar a receita monofásica da tributável pelo NCM de cada item.`
          : 'Importe os XMLs de saída do mês para separar a receita monofásica da tributável pelo NCM de cada item.' }),
        importar));
    }
    const diff = (est, dec) => (dec === null ? 'Não informado' : `${fmt(dec)}${Math.abs(dec - est) > 1 ? ` (dif. ${fmt(dec - est)})` : ''}`);
    return h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' },
        h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'PIS/COFINS pelo NCM dos XMLs' }),
          h('span', { class: 'meta', text: `${e3Num(m.notasComXml)} de ${e3Num(m.notasSaida)} notas de saída do Contribuições com XML no Appura.` })),
        h('span', { class: 'selo info', text: 'Estimativa' })),
      h('div', { class: 'sped-totais' },
        h('div', {}, h('span', { class: 'meta', text: 'Receita monofásica (NCM na lista)' }), h('strong', { text: fmt(m.receitaMonofasica) })),
        h('div', {}, h('span', { class: 'meta', text: 'Receita tributável' }), h('strong', { text: fmt(m.receitaTributavel) })),
        h('div', {}, h('span', { class: 'meta', text: `PIS estimado (${spedPct(m.aliquotas.pis)})` }), h('strong', { text: fmt(m.pisEstimado) })),
        h('div', {}, h('span', { class: 'meta', text: `COFINS estimada (${spedPct(m.aliquotas.cofins)})` }), h('strong', { text: fmt(m.cofinsEstimado) }))),
      h('ul', { class: 'e360-lista-num' },
        h('li', {}, h('span', { text: 'PIS declarado (M200)' }), h('strong', { text: diff(m.pisEstimado, m.pisDeclarado) })),
        h('li', {}, h('span', { text: 'COFINS declarada (M600)' }), h('strong', { text: diff(m.cofinsEstimado, m.cofinsDeclarado) })),
        m.semNcm ? h('li', {}, h('span', { text: 'Itens sem NCM no XML' }), h('strong', { text: e3Num(m.semNcm) })) : null),
      h('p', { class: 'meta', text: `Regime ${m.aliquotas.regime}. Estimativa sobre os itens dos XMLs, sem créditos, exclusões nem notas sem XML: o valor oficial é o apurado no M200/M600. Serve para apontar notas a revisar.` }),
      m.notasComXml < m.notasSaida ? importar : null);
  }

  /** SPED Contribuições: regime, receitas por CST, apuração do PIS/COFINS, monofásico pelo NCM, validação e cruzamento com o SPED Fiscal. */
  function spedBlocosContrib(est) {
    const { r } = est;
    const res = r.resumo;
    const fmt = (v) => moeda(v);
    const oc = r.ocorrencias || [];
    const blocos = [...spedTopo(est, 'Cruza de novo com o SPED Fiscal do mês e com os XMLs de saída guardados no Appura')];
    const situacao = spedSituacao(oc);
    const ap = res.apuracao || {}; const calc = res.calculada || { pis: 0, cofins: 0 };
    const pis = ap.pis || { contribuicao: 0, creditos: 0, recolher: 0 };
    const cof = ap.cofins || { contribuicao: 0, creditos: 0, recolher: 0 };
    const confere = Math.abs(pis.contribuicao - calc.pis) <= 1 && Math.abs(cof.contribuicao - calc.cofins) <= 1;
    blocos.push(h('div', { class: 'sped-cards' },
      h('section', { class: 'vg-card' },
        h('div', { class: 'e360-card-topo' }, h('span', { class: 'vg-kpi-icone info' }, icone('file-spreadsheet')), h('h3', { text: 'Arquivo' })),
        h('div', { class: 'e360-card-valor' }, h('strong', { text: textoCompetencia(res.periodo) }), h('span', { text: r.arquivo.nome })),
        h('ul', { class: 'e360-lista-num' },
          h('li', {}, h('span', { text: 'Situação' }), h('span', { class: `selo ${situacao.tom}`, text: situacao.texto })),
          h('li', {}, h('span', { text: 'Regime' }), h('strong', { text: res.regime ? res.regime.texto : '—' })),
          h('li', {}, h('span', { text: 'Critério (cumulativo)' }), h('strong', { text: res.regime && res.regime.criterio ? res.regime.criterio : '—' })),
          h('li', {}, h('span', { text: 'Leiaute / finalidade' }), h('strong', { text: `${res.codVer} / ${res.finalidade === 'retificadora' ? 'Retificadora' : 'Original'}` })),
          h('li', {}, h('span', { text: 'Estabelecimentos' }), h('strong', { text: e3Num(res.estabelecimentos) })),
          h('li', {}, h('span', { text: 'Linhas' }), h('strong', { text: e3Num(res.linhas) })))),
      h('section', { class: 'vg-card' },
        h('div', { class: 'e360-card-topo' }, h('span', { class: `vg-kpi-icone ${confere ? 'ok' : 'pendente'}` }, icone('calculator')), h('h3', { text: 'Apuração PIS/COFINS (M200/M600)' })),
        h('div', { class: 'e360-card-valor' }, h('strong', { text: fmt(pis.recolher + cof.recolher) }), h('span', { text: 'PIS + COFINS a recolher' })),
        h('ul', { class: 'e360-lista-num' },
          h('li', {}, h('span', { text: 'PIS apurado' }), h('strong', { text: fmt(pis.contribuicao) })),
          h('li', {}, h('span', { text: 'COFINS apurada' }), h('strong', { text: fmt(cof.contribuicao) })),
          pis.creditos || cof.creditos ? h('li', {}, h('span', { text: 'Créditos descontados' }), h('strong', { text: `${fmt(pis.creditos)} / ${fmt(cof.creditos)}` })) : null,
          h('li', {}, h('span', { text: 'Confere com os documentos' }), h('span', { class: `selo ${confere ? 'ok' : 'pendente'}`, text: confere ? 'Sim' : 'Não: veja os alertas' })))),
      h('section', { class: 'vg-card' },
        h('div', { class: 'e360-card-topo' }, h('span', { class: 'vg-kpi-icone progresso' }, icone('file-text')), h('h3', { text: 'Saídas por CST' })),
        h('div', { class: 'e360-card-valor' }, h('strong', { text: fmt(res.receitaBruta) }), h('span', { text: 'saídas nos documentos (líquidas de desconto)' })),
        h('ul', { class: 'e360-lista-num' }, ...(res.receitas.length ? res.receitas.map((c) => h('li', { class: c.cst === '49' || c.cst === '99' ? 'destaque-pendente' : '' },
          h('span', { text: `${c.cst} · ${c.descricao}` }), h('strong', { text: `${fmt(c.valor)}${c.pis || c.cofins ? ` · PIS ${fmt(c.pis)} · COFINS ${fmt(c.cofins)}` : ''}` })))
          : [h('li', { class: 'meta', text: 'Nenhuma receita nos documentos.' })])))));
    if (res.porCfop && res.porCfop.length) {
      blocos.push(h('section', { class: 'vg-card' },
        h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Saídas por CFOP e CST' }),
          h('span', { class: 'meta', text: 'Venda é receita: CST 49 e 99 ("outras operações") ficam fora do PIS/COFINS.' })),
        h('div', { class: 'vg-tabela-caixa sped-tabela-caixa' }, h('table', { class: 'vg-tabela sped-tabela' },
          h('thead', {}, h('tr', {}, ...['CFOP', 'CST PIS/COFINS', 'Valor'].map((t) => h('th', { scope: 'col', class: t === 'Valor' ? 'num' : null, text: t })))),
          h('tbody', {}, ...res.porCfop.map((x) => h('tr', {},
            h('td', { class: 'mono', text: x.cfop }), h('td', {}, h('span', { class: `selo ${['49', '99'].includes(x.cst) && /^[567]1|^[56]40[1235]$/.test(x.cfop) ? 'problema' : 'neutro'}`, text: x.cst }), ` ${({ '01': 'Tributada', '04': 'Monofásica', '05': 'ST', '06': 'Alíquota zero', '07': 'Isenta', '08': 'Sem incidência', '09': 'Suspensão', '49': 'Outras saídas', '99': 'Outras' })[x.cst] || ''}`),
            h('td', { class: 'num', text: fmt(x.valor) }))))))));
    }
    const c = r.comparacao;
    blocos.push(spedMonofasico(c));
    blocos.push(spedOcorrencias(oc, 'Estrutura (9900, 9999, blocos), regime (0110), chaves, CST das receitas, M200/M600 e M400/M800 × documentos.'));
    const cfg = {
      tipos: CRUZ_TIPOS,
      titulo: (d) => `${MODELO[d.modelo] || d.modelo} ${d.numero}`,
      valores: (d) => (['receita_tributavel_sem_pis', 'monofasico_tributado'].includes(d.tipo)
        ? `Itens no XML ${fmt(d.valorFiscal)}`
        : [d.valorFiscal !== null ? `Fiscal ${fmt(d.valorFiscal)}` : '', d.valorContrib !== null ? `Contrib. ${fmt(d.valorContrib)}` : ''].filter(Boolean).join(' · ')),
    };
    if (!c || !c.fiscal) {
      blocos.push(h('div', { class: 'e360-breve pequeno' }, icone('file-check'), h('div', {}, h('strong', { text: 'Cruzamento com o SPED Fiscal' }),
        h('p', { text: `Envie o SPED Fiscal de ${textoCompetencia(res.periodo)} para conferir, nota a nota, se todas as vendas estão no Contribuições.` }))));
      if (c && c.divergencias.length) {
        blocos.push(h('section', { class: 'vg-card' },
          h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Monofásico × tributado (XML × Contribuições)' }),
            h('span', { class: 'meta', text: 'Pelo NCM de cada item do XML e o CST escriturado na nota.' })),
          ...spedListaDiv(est, c, { ...cfg, vazio: '' })));
      }
    } else {
      const t = c.totais;
      blocos.push(h('section', { class: 'vg-card' },
        h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Cruzamento SPED Fiscal × Contribuições' }),
          h('span', { class: 'meta', text: 'Por chave de acesso: toda venda do SPED Fiscal precisa estar no Contribuições. Inclui monofásico × tributado pelo NCM dos XMLs.' })),
        h('div', { class: 'sped-totais' },
          h('div', {}, h('span', { class: 'meta', text: 'Vendas no SPED Fiscal' }), h('strong', { text: `${e3Num(t.vendasFiscal)} · ${fmt(t.valorFiscal)}` })),
          h('div', {}, h('span', { class: 'meta', text: 'Conferidas no Contribuições' }), h('strong', { text: `${e3Num(t.conferidas)}${t.vendasFiscal ? ` (${Math.round((t.conferidas / t.vendasFiscal) * 100)}%)` : ''}` })),
          h('div', {}, h('span', { class: 'meta', text: 'Saídas no Contribuições' }), h('strong', { text: `${e3Num(t.saidasContrib)} · ${fmt(t.valorContrib)}` })),
          h('div', {}, h('span', { class: 'meta', text: 'Fiscal sem CFOP de venda' }), h('strong', { text: e3Num(t.ignoradasFiscal) }))),
        c.observacoes.length ? h('ul', { class: 'sped-obs' }, ...c.observacoes.map((o) => h('li', { text: o }))) : null,
        ...spedListaDiv(est, c, { ...cfg, vazio: 'Todas as vendas do SPED Fiscal estão no Contribuições, com o mesmo valor.' })));
    }
    const envios = spedEnvios(est);
    if (envios) blocos.push(envios);
    return blocos;
  }

  /** SINTEGRA: arquivo, movimento (50, 61, 60M, 53, 74), declarações 88, validação e comparação com os XMLs. */
  function spedBlocosSintegra(est) {
    const { r } = est;
    const res = r.resumo;
    const fmt = (v) => moeda(v);
    const oc = r.ocorrencias || [];
    const blocos = [...spedTopo(est, 'Compara de novo com os XMLs que estão no Appura agora')];
    const situacao = spedSituacao(oc);
    const nfce = res.nfce || { registros: 0, notas: 0, valor: 0, series: [] };
    blocos.push(h('div', { class: 'sped-cards' },
      h('section', { class: 'vg-card' },
        h('div', { class: 'e360-card-topo' }, h('span', { class: 'vg-kpi-icone info' }, icone('file-spreadsheet')), h('h3', { text: 'Arquivo' })),
        h('div', { class: 'e360-card-valor' }, h('strong', { text: textoCompetencia(res.periodo) }), h('span', { text: r.arquivo.nome })),
        h('ul', { class: 'e360-lista-num' },
          h('li', {}, h('span', { text: 'Situação' }), h('span', { class: `selo ${situacao.tom}`, text: situacao.texto })),
          h('li', {}, h('span', { text: 'Finalidade' }), h('strong', { text: res.finalidade ? res.finalidade.texto : '—' })),
          h('li', {}, h('span', { text: 'Convênio / natureza' }), h('strong', { text: `${res.convenio || '—'} / ${res.natureza || '—'}` })),
          h('li', {}, h('span', { text: 'Linhas' }), h('strong', { text: e3Num(res.linhas) })),
          h('li', {}, h('span', { text: 'Produtos (75)' }), h('strong', { text: e3Num(res.produtos) })),
          h('li', {}, h('span', { text: 'Inventário (74)' }), h('strong', { text: res.inventario ? `${e3Num(res.inventario.itens)} itens · ${fmt(res.inventario.valor)}` : 'Não' })))),
      h('section', { class: 'vg-card' },
        h('div', { class: 'e360-card-topo' }, h('span', { class: 'vg-kpi-icone ok' }, icone('receipt')), h('h3', { text: 'Vendas ao consumidor' })),
        h('div', { class: 'e360-card-valor' }, h('strong', { text: fmt(nfce.valor) }), h('span', { text: `${e3Num(nfce.notas)} NFC-e em ${e3Num(nfce.registros)} registro${nfce.registros === 1 ? '' : 's'} 61` })),
        h('ul', { class: 'e360-lista-num' },
          h('li', {}, h('span', { text: 'Séries' }), h('strong', { text: nfce.series.length ? nfce.series.join(', ') : '—' })),
          h('li', {}, h('span', { text: 'Cupom fiscal (60M)' }), h('strong', { text: res.ecf && res.ecf.reducoes ? `${e3Num(res.ecf.reducoes)} reduções · ${fmt(res.ecf.vendaBruta)}` : 'Não' })),
          h('li', {}, h('span', { text: 'Substituição tributária (53)' }), h('strong', { text: res.st && res.st.notas ? `${e3Num(res.st.notas)} nota${res.st.notas === 1 ? '' : 's'} · ICMS retido ${fmt(res.st.icmsRetido)}` : 'Não' })))),
      h('section', { class: 'vg-card' },
        h('div', { class: 'e360-card-topo' }, h('span', { class: 'vg-kpi-icone progresso' }, icone('file-text')), h('h3', { text: 'Notas (registro 50)' })),
        h('ul', { class: 'e360-lista-num' }, ...(res.documentos.length ? res.documentos.map((d) => h('li', {}, h('span', { text: d.rotulo }),
          h('strong', { text: `${e3Num(d.qtd)}${d.canceladas ? ` (${e3Num(d.canceladas)} canc.)` : ''} · ${fmt(d.valor)}` })))
          : [h('li', { class: 'meta', text: 'Nenhuma nota no registro 50.' })])))));
    if (res.declaracoes && res.declaracoes.length) {
      blocos.push(h('section', { class: 'vg-card' },
        h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Declarações (registro 88)' }),
          h('span', { class: 'meta', text: 'O que a empresa declarou no arquivo (ex.: sem movimento de entradas ou de saídas).' })),
        h('ul', { class: 'sped-ocorrencias' }, ...res.declaracoes.map((x) => h('li', { class: 'info' },
          h('span', { class: 'selo neutro', text: `88${x.subtipo}` }), h('div', {}, h('p', { text: x.texto })))))));
    }
    blocos.push(spedOcorrencias(oc, 'Tamanho das linhas (126), registros 10, 11 e 90, totalizadores, datas, composição dos valores (50 e 61), numeração das NFC-e e declarações 88.'));
    const c = r.comparacao;
    if (!c) {
      blocos.push(h('div', { class: 'e360-breve pequeno' }, icone('file-check'), h('div', {}, h('strong', { text: 'Comparação XML × SINTEGRA' }),
        h('p', { text: 'Fica disponível quando a empresa do CNPJ estiver cadastrada no Appura. Use "Refazer comparação" depois de aprovar o cadastro.' }))));
    } else {
      const t = c.totais;
      blocos.push(h('section', { class: 'vg-card' },
        h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Comparação XML × SINTEGRA' }),
          h('span', { class: 'meta', text: c.cobertura.desde ? `XMLs no Appura desde ${spedData(c.cobertura.desde)}` : 'Notas casadas por CNPJ do emitente, série e número; NFC-e pelas faixas do 61 e pelo total do dia.' })),
        h('div', { class: 'sped-totais' },
          h('div', {}, h('span', { class: 'meta', text: 'NF-e de entrada com XML' }), h('strong', { text: e3Num(t.entradasXml) })),
          h('div', {}, h('span', { class: 'meta', text: 'Conferidas no SINTEGRA' }), h('strong', { text: `${e3Num(t.entradasConferidas)}${t.entradasXml ? ` (${Math.round((t.entradasConferidas / t.entradasXml) * 100)}%)` : ''}` })),
          h('div', {}, h('span', { class: 'meta', text: 'NF-e de entrada no SINTEGRA' }), h('strong', { text: e3Num(t.entradasSintegra) })),
          h('div', {}, h('span', { class: 'meta', text: 'NFC-e: XML × registro 61' }), h('strong', { text: c.cobertura.nfce ? `${e3Num(t.nfceXml)} de ${e3Num(t.nfceSintegra)}` : 'Sem XML de NFC-e' }))),
        c.observacoes.length ? h('ul', { class: 'sped-obs' }, ...c.observacoes.map((o) => h('li', { text: o }))) : null,
        ...spedListaDiv(est, c, {
          tipos: SINTEGRA_TIPOS,
          vazio: 'Nenhuma divergência entre os XMLs e o SINTEGRA.',
          titulo: (d) => (d.tipo === 'nfce_valor_dia' ? `NFC-e de ${spedData(d.data)}` : `${MODELO[d.modelo] || d.modelo} ${d.numero}`),
          valores: (d) => [d.valorXml !== null ? `XML ${fmt(d.valorXml)}` : '', d.valorSintegra !== null ? `SINTEGRA ${fmt(d.valorSintegra)}` : ''].filter(Boolean).join(' · '),
        })));
    }
    const envios = spedEnvios(est);
    if (envios) blocos.push(envios);
    return blocos;
  }

  /** Baixa o SPED guardado (o servidor descriptografa; o arquivo sai igual ao enviado). */
  async function spedBaixar(id, nome) {
    try { await baixarArquivo(`/api/sped/${id}/arquivo`, nome || `sped-${id}.txt`); } catch (err) { avisar(err.message); }
  }

  /* Ações (menu do computador e folha do celular), só as que o perfil permite */
  function e360ListaAcoes() {
    const e = empresaNotas;
    if (!e) return [];
    const lista = [];
    if (pode('operar')) {
      lista.push({ id: 'sincronizar', texto: e.sincronizacao_pedida ? 'Sincronização já pedida' : 'Sincronizar XML', icone: 'refresh-cw', desabilitado: !e.ativo || e.sincronizacao_pedida || !e.certificado_valido_ate, fn: (b) => sincronizar(e, b).then(e360AtualizarAcoes), celular: true });
      lista.push({ id: 'importar', texto: 'Importar arquivos', icone: 'cloud-download', fn: () => $('notas-importar-arquivos').click(), celular: true });
    }
    lista.push({ id: 'zip', texto: 'Baixar XMLs do mês (ZIP)', icone: 'file-text', fn: (b) => baixarZip(b), menu: true, celular: true });
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
      onclick: async (ev) => { ev.stopPropagation(); if (!a.manterAberto) fechar(); await a.fn(a.id === 'sincronizar' ? $('e360-sincronizar') : null); },
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
    const estavaAberta = !$('e360-folha').hidden;
    if (abrir) abrirDialogo($('e360-folha'));
    $('e360-folha').hidden = !abrir;
    $('e360-folha-fundo').hidden = !abrir;
    $('e360-acoes-celular').setAttribute('aria-expanded', String(!!abrir));
    if (abrir) { const b = $('e360-folha-itens').querySelector('button:not([disabled])'); if (b) b.focus(); }
    else if (estavaAberta) fecharDialogo($('e360-folha'));
  }

  function e360Ligar() {
    $('e360-sincronizar').addEventListener('click', (ev) => { const a = e360ListaAcoes().find((x) => x.id === 'sincronizar'); if (a) a.fn(ev.currentTarget); });
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
    $('gj-form').addEventListener('submit', spedSalvarJustificativa);
    $('gj-fechar').addEventListener('click', spedFecharJustificar);
    $('gj-cancelar').addEventListener('click', spedFecharJustificar);
    $('gj-fundo').addEventListener('click', spedFecharJustificar);
    $('gj-observacao').addEventListener('input', () => { $('gj-observacao').removeAttribute('aria-invalid'); $('gj-erro').hidden = true; });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { e360Menu(false); e360Folha(false); spedFecharJustificar(); } });
  }
  e360Ligar();
  window.e360Resetar = e360Resetar;
  window.e360Carregar = e360Carregar;
  window.e360RenderArquivos = e360RenderArquivos;
  window.e360RenderHistorico = e360RenderHistorico;
  window.e360Folha = e360Folha;
  window.spedRender = spedRender;
  window.spedCarregar = spedCarregar;
  /** Abre o resultado de um SPED enviado fora da empresa (atalho da Visão Geral): vai para a empresa, o mês e o tipo do arquivo. */
  window.spedAbrir = (r) => {
    e3.spedAba = spedParteDoTipo(r.tipo);
    e3.sped = null;
    if (r.competencia) definirCompetencia(r.competencia, false);
    irPara(`#/empresas/${r.empresaId}/sped`);
  };
  window.spedBaixar = spedBaixar;
}
