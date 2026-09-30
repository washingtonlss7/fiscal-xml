'use strict';
/*
 * Aba "Apuração" da Empresa 360° (Simples Nacional, etapa B): prévia da receita do mês segregada
 * como vai para o PGDAS-D (atividade + ICMS-ST + PIS/COFINS monofásico), alertas e ajustes manuais.
 * Nada vai para a Receita nesta etapa. Usa os utilitários globais do app.js (h, $, chamar, icone,
 * comOcupado, avisar, empresaNotas, mesSelecionado, pode) e do nucleo.js (moeda, formatarCnpj...).
 */

/* ---------- funções puras (testadas em test/apuracao-tela.test.ts) ---------- */

/** Grupos de receita na ordem do PGDAS-D (espelha GRUPOS de src/fiscal/simples.ts). */
const AP_GRUPOS = [
  { chave: 'a1', atividade: 1, st: false, monofasico: false, titulo: 'Revenda tributada normalmente', curto: 'Tributada' },
  { chave: 'a2_st', atividade: 2, st: true, monofasico: false, titulo: 'Revenda com ICMS-ST', curto: 'ICMS-ST' },
  { chave: 'a2_mono', atividade: 2, st: false, monofasico: true, titulo: 'Revenda com PIS/COFINS monofásico', curto: 'Monofásico' },
  { chave: 'a2_st_mono', atividade: 2, st: true, monofasico: true, titulo: 'Revenda com ICMS-ST e PIS/COFINS monofásico', curto: 'ICMS-ST + monofásico' },
  { chave: 'a3', atividade: 3, st: false, monofasico: false, titulo: 'Revenda para exportação', curto: 'Exportação' },
];

/** Participação de um valor na receita (texto). */
function apParticipacao(valor, total) {
  if (!total) return '—';
  const p = (valor / total) * 100;
  return `${p.toLocaleString('pt-BR', { maximumFractionDigits: p < 10 ? 1 : 0 })}%`;
}

/** Variação da receita apurada contra a soma das notas de outro mês. */
function apVariacao(atual, outro) {
  if (!outro) return null;
  const p = ((atual - outro) / outro) * 100;
  const txt = `${p > 0 ? '+' : ''}${p.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}%`;
  return { texto: txt, fora: Math.abs(p) >= 40 };
}

/** O que impede a apuração de seguir (erros) e o que pede conferência (alertas). */
function apSituacao(d) {
  const todos = (d.estabelecimentos || []).flatMap((e) => e.alertas || []);
  const erros = todos.filter((a) => a.nivel === 'erro').length;
  const alertas = todos.filter((a) => a.nivel === 'alerta').length;
  if (erros) return { tom: 'problema', texto: `${erros} bloqueio${erros === 1 ? '' : 's'}` };
  if (alertas) return { tom: 'atencao', texto: `${alertas} ponto${alertas === 1 ? '' : 's'} para conferir` };
  return { tom: 'ok', texto: 'Pronta para conferência' };
}

/** Grupo escolhido no formulário de ajuste → corpo da API. */
function apCorpoAjuste(chave, valor, justificativa, mes) {
  const g = AP_GRUPOS.find((x) => x.chave === chave) || AP_GRUPOS[0];
  const v = Number(String(valor).replace(/\./g, '').replace(',', '.'));
  return { mes, valor: v, atividade: g.atividade, st: g.st, monofasico: g.monofasico, justificativa: String(justificativa || '').trim() };
}

const AP_TRIBUTOS = { 1001: 'IRPJ', 1002: 'CSLL', 1004: 'COFINS', 1005: 'PIS/PASEP', 1006: 'CPP (INSS)', 1007: 'ICMS', 1008: 'IPI', 1010: 'ISS' };
const AP_ORDEM_TRIBUTOS = [1001, 1002, 1004, 1005, 1006, 1007, 1008, 1010];

/** Valores calculados pela Receita, na ordem do extrato do PGDAS-D. */
function apTributos(valores) {
  const pos = (c) => { const i = AP_ORDEM_TRIBUTOS.indexOf(c); return i < 0 ? 99 : i; };
  return (valores || []).slice().sort((a, b) => pos(a.codigoTributo) - pos(b.codigoTributo))
    .map((v) => ({ nome: AP_TRIBUTOS[v.codigoTributo] || `Tributo ${v.codigoTributo}`, valor: Number(v.valor) }));
}

/** Data sem hora (AAAA-MM-DD) → DD/MM/AAAA, sem passar por fuso (evita mostrar o dia anterior). */
const apDia = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10).split('-').reverse().join('/') : '—');

/** Alíquota efetiva (total do DAS ÷ receita), em texto. */
function apAliquota(total, receita) {
  if (!receita) return '—';
  return `${((Number(total) / Number(receita)) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/**
 * Situação do PGDAS-D do mês para o cartão da Receita:
 * 'transmitida' (e a simulação de retificadora, se houver), 'simulada', ou 'nenhuma'.
 */
function apEstadoReceita(apuracoes) {
  const l = apuracoes || [];
  const simulada = l.find((a) => a.status === 'simulada') || null;
  const transmitida = l.find((a) => a.status === 'transmitida') || null;
  return { estado: simulada ? 'simulada' : transmitida ? 'transmitida' : 'nenhuma', simulada, transmitida };
}

if (typeof module !== 'undefined') module.exports = { apDia, AP_GRUPOS, apParticipacao, apVariacao, apSituacao, apCorpoAjuste, apTributos, apAliquota, apEstadoReceita };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  var ap = { chave: null, dados: null, erro: null, removendo: null, confirmo: false, gerarDas: true };
  const apTituloGrupo = (c) => (AP_GRUPOS.find((g) => g.chave === c) || { titulo: c }).titulo;
  const apSkel = () => h('div', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }), h('div', { class: 'vg-skel', 'aria-hidden': 'true' }), h('div', { class: 'vg-skel', 'aria-hidden': 'true' }));

  async function apCarregar() {
    if (!empresaNotas) return;
    const id = empresaNotas.id; const mes = mesSelecionado();
    const alvo = $('ap-conteudo');
    if (empresaNotas.regime !== 'simples') {
      alvo.replaceChildren(h('div', { class: 'e360-breve' }, icone('calculator'), h('div', {},
        h('strong', { text: empresaNotas.regime === 'mei' ? 'MEI não tem apuração' : 'Apuração do Simples Nacional' }),
        h('p', { text: empresaNotas.regime === 'mei' ? 'O DAS-MEI tem valor fixo: gere na aba Guias.' : empresaNotas.regime ? 'Esta apuração é do PGDAS-D (Simples Nacional). Lucro Presumido e Real ainda não estão no Appura.' : 'Informe o regime da empresa no cadastro.' }))));
      return;
    }
    const chave = `${id}|${mes}`;
    if (ap.chave !== chave) { ap.chave = chave; ap.dados = null; alvo.replaceChildren(apSkel()); }
    try {
      const d = await chamar(`/api/empresas/${id}/apuracao?mes=${mes}`);
      if (ap.chave !== chave) return;
      ap.dados = d; ap.erro = null;
    } catch (e) {
      if (ap.chave !== chave) return;
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível montar a apuração.' }), h('span', { text: e.message }),
        h('button', { type: 'button', class: 'botao pequeno', onclick: apCarregar }, icone('refresh-cw'), 'Tentar de novo')));
      return;
    }
    apRender();
  }

  function apRender() {
    const d = ap.dados; if (!d) return;
    const sit = apSituacao(d);
    const varAnt = apVariacao(d.receita, d.comparacao.mesAnterior.notas);
    const varAno = apVariacao(d.receita, d.comparacao.mesmoMesAnoPassado.notas);
    const linhaComp = (rotulo, c, v) => h('div', { class: 'ap-comp' }, h('span', { class: 'meta', text: `${rotulo} (${textoCompetencia(c.competencia)})` }),
      h('strong', { text: c.notas ? moeda(c.notas) : 'Sem notas' }), v ? h('span', { class: `selo ${v.fora ? 'atencao' : 'neutro'}`, text: v.texto }) : null);

    const topo = h('section', { class: 'vg-card ap-topo' },
      h('div', { class: 'vg-card-topo' },
        h('div', {}, h('h2', { class: 'vg-card-titulo', text: `Receita de ${textoCompetencia(d.competencia)} para o PGDAS-D` }),
          h('p', { class: 'meta', text: `Montada das notas de venda${d.estabelecimentos.length > 1 ? ` de ${d.estabelecimentos.length} estabelecimentos (matriz e filiais)` : ''}.` })),
        h('span', { class: `selo ${sit.tom}`, text: sit.texto })),
      h('div', { class: 'ap-receita' }, h('strong', { class: 'ap-total', text: moeda(d.receita) }),
        h('div', { class: 'ap-comps' }, linhaComp('Notas do mês anterior', d.comparacao.mesAnterior, varAnt), linhaComp('Mesmo mês do ano passado', d.comparacao.mesmoMesAnoPassado, varAno))),
      h('p', { class: 'dica ap-dica', text: 'O imposto não é calculado pelo Appura: a própria Receita calcula a partir desta receita segregada (botão "Calcular na Receita"), e o supervisor transmite.' }));

    const grupos = h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Receita por grupo' }),
        h('p', { class: 'meta', text: 'ICMS-ST pelo CSOSN 500 (ou CST 60) da nota; monofásico pelo NCM (lista de farmacêuticos, perfumaria e higiene, bebidas frias…).' }))),
      d.grupos.length ? h('ul', { class: 'ap-grupos' }, ...d.grupos.map((g) => h('li', {},
        h('div', { class: 'ap-grupo-topo' },
          h('div', {}, h('strong', { text: g.titulo }), h('span', { class: 'meta', text: `Atividade ${g.atividade} no PGDAS-D${g.st || g.monofasico ? ` · ${[g.st ? 'ICMS-ST' : null, g.monofasico ? 'PIS/COFINS monofásico' : null].filter(Boolean).join(' + ')}` : ''}` })),
          h('div', { class: 'ap-grupo-valor' }, h('strong', { text: moeda(g.valor) }), h('span', { class: 'meta', text: apParticipacao(g.valor, d.receita) }))),
        h('div', { class: 'ap-barra', 'aria-hidden': 'true' }, h('span', { class: `ap-barra-${g.chave}` })),
        h('div', { class: 'ap-grupo-detalhe meta', text: [`Vendas ${moeda(g.vendas)}`, g.devolucoes ? `devoluções −${moeda(g.devolucoes)}` : null, g.ajustes ? `ajustes ${g.ajustes > 0 ? '+' : '−'}${moeda(Math.abs(g.ajustes))}` : null, `${g.itens} ite${g.itens === 1 ? 'm' : 'ns'}`].filter(Boolean).join(' · ') }),
        g.ncms.length ? h('details', { class: 'gu-composicao' }, h('summary', { text: 'NCMs que mais pesam' }),
          h('ul', { class: 'ap-ncms' }, ...g.ncms.map((n) => h('li', {}, h('span', { class: 'mono', text: n.ncm }), h('span', { class: 'ap-ncm-produto', text: n.produto || '' }), h('strong', { text: moeda(n.valor) }))))) : null)))
        : h('div', { class: 'vg-vazio pequeno' }, h('strong', { text: 'Nenhuma receita no mês.' }), h('span', { text: 'Importe as notas de venda (NFC-e/NF-e) na aba Notas Fiscais.' })));
    // Largura das barras via propriedade (sem estilo inline no HTML por causa da CSP)
    for (const [i, g] of d.grupos.entries()) {
      const barra = grupos.querySelectorAll('.ap-barra span')[i];
      if (barra) barra.style.width = `${d.receita > 0 ? Math.max(0, Math.min(100, (g.valor / d.receita) * 100)) : 0}%`;
    }

    alvoRender([topo, apCardReceita(d, sit), apCardAlertas(d), grupos, apCardFora(d), apCardAjustes(d), apCardDeclaracao(d)].filter(Boolean));
  }
  const alvoRender = (filhos) => $('ap-conteudo').replaceChildren(...filhos);

  /* ----- Receita Federal: calcular (simulação), transmitir (supervisor/admin), recibo e DAS ----- */
  function apCardReceita(d, sit) {
    const { estado, simulada, transmitida } = apEstadoReceita(d.apuracoes);
    const bloqueado = sit.tom === 'problema';
    const podeOperar = pode('operar'); const podeTransmitir = pode('transmitir');
    const calcular = (retificar) => h('button', { type: 'button', class: `botao ${retificar ? '' : 'primario'}`, disabled: bloqueado || !podeOperar, onclick: (ev) => comOcupado(ev.currentTarget, 'Calculando na Receita…', async () => {
      try { await chamar(`/api/empresas/${empresaNotas.id}/apuracao/simular`, { method: 'POST', body: { mes: d.competencia, retificar } }); }
      catch (e) { avisar(e.message, { tipo: 'erro' }); return; }
      ap.confirmo = false; avisar('A Receita calculou o PGDAS-D. Confira os valores.', { tipo: 'ok' }); await apCarregar();
    }, 'ap-simular') }, icone('calculator'), h('span', { text: retificar ? 'Calcular retificadora' : 'Calcular na Receita' }));
    const custo = h('p', { class: 'meta', text: 'Uma chamada ao Integra Contador (cobrada pelo SERPRO). Nada é transmitido: a Receita só calcula.' });
    const tabelaValores = (a) => h('ul', { class: 'ap-tributos' },
      ...apTributos(a.valores_devidos).map((v) => h('li', {}, h('span', { text: v.nome }), h('strong', { text: moeda(v.valor) }))),
      h('li', { class: 'ap-tributos-total' }, h('span', { text: `Total do DAS · alíquota efetiva ${apAliquota(a.total_devido, a.receita)}` }), h('strong', { text: moeda(a.total_devido) })));
    const baixar = (a, qual, texto) => h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Baixando…',
      () => baixarArquivo(`/api/apuracao/${a.id}/${qual}`, `PGDAS-D-${d.competencia}-${qual}.pdf`), `ap-pdf-${a.id}-${qual}`) }, icone('file-text'), h('span', { text: texto }));
    const topoCard = (titulo, selo, tom) => h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: titulo }), selo ? h('span', { class: `selo ${tom}`, text: selo }) : null);

    const blocoTransmitida = transmitida ? h('div', { class: 'ap-bloco' },
      h('p', { class: 'meta', text: `Declaração ${transmitida.id_declaracao || '—'} · transmitida em ${formatarData(transmitida.transmitido_em)} às ${formatarHora(transmitida.transmitido_em)} por ${transmitida.transmitido_por}${transmitida.tipo === 2 ? ' · retificadora' : ''}` }),
      tabelaValores(transmitida),
      transmitida.maed ? h('p', { class: 'erro', text: `Entrega em atraso: a Receita emitiu multa (MAED)${transmitida.maed.total ? ` de ${moeda(transmitida.maed.total)}` : ''}${transmitida.maed.vencimento ? `, vencimento ${apDia(transmitida.maed.vencimento)}` : ''}.` }) : null,
      transmitida.das ? (transmitida.das.ok
        ? h('p', { class: 'meta', text: `DAS gerado: ${moeda(transmitida.das.total)}, vence em ${apDia(transmitida.das.vencimento)}${transmitida.das.envio ? ` · Acessórias: ${transmitida.das.envio === 'enviado' ? 'enviado' : 'erro no envio'}` : ''}. Veja na aba Guias.` })
        : h('p', { class: 'erro', text: `O DAS não foi gerado: ${transmitida.das.mensagem} Gere pela aba Guias.` })) : null,
      h('div', { class: 'gu-botoes' },
        transmitida.recibo_caminho ? baixar(transmitida, 'recibo', 'Recibo') : null,
        transmitida.declaracao_caminho ? baixar(transmitida, 'declaracao', 'Declaração') : null,
        transmitida.maed && transmitida.maed.darf ? baixar(transmitida, 'maed-darf', 'DARF da multa') : null)) : null;

    if (estado === 'nenhuma') {
      return h('section', { class: 'vg-card' }, topoCard('Receita Federal · PGDAS-D', 'Não calculado', 'neutro'),
        h('p', { class: 'meta', text: bloqueado ? 'Resolva os bloqueios da apuração antes de calcular.' : 'Confira a receita e os pontos de atenção abaixo. Depois, peça o cálculo à Receita.' }),
        podeOperar ? h('div', { class: 'gu-botoes' }, calcular(false)) : null, podeOperar ? custo : null);
    }
    if (estado === 'transmitida') {
      return h('section', { class: 'vg-card' }, topoCard('Receita Federal · PGDAS-D', 'Transmitido', 'ok'), blocoTransmitida,
        podeOperar ? h('details', { class: 'gu-composicao' }, h('summary', { text: 'Precisa corrigir? Calcular retificadora' }),
          h('p', { class: 'meta', text: 'A retificadora substitui a declaração transmitida. Ajuste as notas ou os ajustes, calcule e peça ao supervisor para transmitir. Se o DAS já foi pago, a diferença é tratada pela Receita.' }),
          h('div', { class: 'gu-botoes' }, calcular(true)), custo) : null);
    }
    // Simulada (original ou retificadora)
    const a = simulada;
    const invalida = !a.atual || a.vencida;
    const cab = topoCard(a.tipo === 2 ? 'Receita Federal · Retificadora calculada' : 'Receita Federal · PGDAS-D calculado', invalida ? 'Calcular de novo' : 'Aguardando transmissão', invalida ? 'atencao' : 'pendente');
    const info = h('p', { class: 'meta', text: `Calculado pela Receita em ${formatarData(a.simulado_em)} às ${formatarHora(a.simulado_em)} por ${a.simulado_por} · receita ${moeda(a.receita)}` });
    const partes = [cab, info, tabelaValores(a)];
    if (invalida) {
      partes.push(h('p', { class: 'erro', text: a.vencida ? 'O cálculo tem mais de 24 horas.' : 'As notas ou os ajustes mudaram depois do cálculo.' }), podeOperar ? h('div', { class: 'gu-botoes' }, calcular(a.tipo === 2)) : null);
    } else if (!podeTransmitir) {
      partes.push(h('p', { class: 'dica', text: 'Conferido? A transmissão é feita pelo supervisor ou administrador do escritório.' }));
    } else {
      const chkConf = h('input', { type: 'checkbox', checked: ap.confirmo, onchange: (ev) => { ap.confirmo = ev.currentTarget.checked; botao.disabled = !ap.confirmo; } });
      const chkDas = h('input', { type: 'checkbox', checked: ap.gerarDas, onchange: (ev) => { ap.gerarDas = ev.currentTarget.checked; } });
      const botao = h('button', { type: 'button', class: 'botao primario', disabled: !ap.confirmo, onclick: (ev) => comOcupado(ev.currentTarget, 'Transmitindo…', async () => {
        try { await chamar(`/api/apuracao/${a.id}/transmitir`, { method: 'POST', body: { confirmo: true, gerarDas: ap.gerarDas } }); }
        catch (e) { avisar(e.message, { tipo: 'erro' }); await apCarregar(); return; }
        ap.confirmo = false; avisar('PGDAS-D transmitido. O recibo está guardado no Appura.', { tipo: 'ok' }); await apCarregar();
      }, 'ap-transmitir') }, h('span', { text: a.tipo === 2 ? 'Transmitir retificadora' : 'Transmitir PGDAS-D' }));
      partes.push(
        h('label', { class: 'mcp-permissao' }, chkConf, h('span', {}, h('strong', { text: 'Conferi a receita e os valores. ' }), `Entendo que esta é a declaração oficial do PGDAS-D de ${formatarCnpj(d.declarante.cnpj)} para ${textoCompetencia(d.competencia)}${a.tipo === 2 ? ', substituindo a transmitida' : ''}.`)),
        h('label', { class: 'mcp-permissao' }, chkDas, h('span', {}, h('strong', { text: 'Gerar o DAS logo depois' }), ' (e enviar à Acessórias, se o envio automático estiver ligado).')),
        h('div', { class: 'gu-botoes' }, botao));
    }
    if (transmitida) partes.push(h('details', { class: 'gu-composicao' }, h('summary', { text: 'Declaração transmitida antes' }), blocoTransmitida));
    return h('section', { class: 'vg-card' }, ...partes.filter(Boolean));
  }

  function apCardAlertas(d) {
    const varios = d.estabelecimentos.length > 1;
    const itens = d.estabelecimentos.flatMap((e) => (e.alertas || []).map((a) => ({ ...a, estab: varios ? formatarCnpj(e.cnpj) : null })));
    const sint = (d.sintegra || []).filter((s) => s.divergencias > 0);
    if (!itens.length && !sint.length) return h('section', { class: 'vg-card' }, h('div', { class: 'ap-tudo-ok' }, icone('check'), h('strong', { text: 'Nenhum ponto de atenção nas notas do mês.' })));
    const tom = { erro: 'problema', alerta: 'atencao', info: 'neutro' };
    const rot = { erro: 'Bloqueia', alerta: 'Conferir', info: 'Informativo' };
    return h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('h2', { class: 'vg-card-titulo', text: 'Pontos de atenção' })),
      h('ul', { class: 'ap-alertas' },
        ...sint.map((s) => h('li', {}, h('span', { class: 'selo atencao', text: 'Conferir' }), h('div', {}, h('strong', { text: `SINTEGRA do mês com ${s.divergencias} divergência${s.divergencias === 1 ? '' : 's'} em aberto` }),
          h('span', { class: 'meta', text: 'Nota no SINTEGRA que não está nos XMLs pode ser receita faltando. Veja na aba SPED.' })))),
        ...itens.map((a) => h('li', {},
          h('span', { class: `selo ${tom[a.nivel]}`, text: rot[a.nivel] }),
          h('div', {},
            h('strong', { text: `${a.titulo}${a.estab ? ` · ${a.estab}` : ''}` }),
            h('span', { class: 'meta', text: `${a.detalhe}${a.quantidade > 1 || a.valor ? ` (${a.quantidade} ocorrência${a.quantidade === 1 ? '' : 's'}${a.valor ? `, ${moeda(a.valor)}` : ''})` : ''}` }),
            a.exemplos && a.exemplos.length ? h('details', { class: 'gu-composicao' }, h('summary', { text: 'Ver exemplos' }),
              h('ul', { class: 'ap-exemplos' }, ...a.exemplos.map((x) => h('li', {}, x.chave
                ? h('span', { text: `Nota ${x.numero ?? '—'}${x.n_item ? ` · item ${x.n_item}` : ''}${x.produto ? ` · ${x.produto}` : ''}${x.ncm ? ` · NCM ${x.ncm}` : ''}${x.cfop ? ` · CFOP ${x.cfop}` : ''}` })
                : h('span', { text: x.numero }), x.valor ? h('strong', { text: moeda(x.valor) }) : null)))) : null)))));
  }

  function apCardFora(d) {
    const fora = d.estabelecimentos.flatMap((e) => e.fora || []);
    if (!fora.length) return null;
    return h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Fora da receita' }),
        h('p', { class: 'meta', text: 'Saídas que não são venda (pelo CFOP). Não entram no PGDAS-D.' }))),
      h('ul', { class: 'ap-fora' }, ...fora.map((f) => h('li', {}, h('div', {}, h('strong', { text: f.motivo }), h('span', { class: 'meta', text: `CFOP ${f.cfops.join(', ')} · ${f.notas} nota${f.notas === 1 ? '' : 's'}` })), h('strong', { text: moeda(f.valor) })))));
  }

  function apCardAjustes(d) {
    const varios = d.estabelecimentos.length > 1;
    const lista = d.estabelecimentos.flatMap((e) => (e.ajustes || []).map((a) => ({ ...a, estab: e })));
    const podeOperar = pode('operar');
    const linha = (a) => {
      const g = AP_GRUPOS.find((x) => x.atividade === a.atividade && x.st === !!a.st && x.monofasico === !!a.monofasico);
      const acoes = !podeOperar ? null : ap.removendo === a.id
        ? h('span', { class: 'gu-botoes' },
          h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => { ap.removendo = null; apRender(); } }, 'Cancelar'),
          h('button', { type: 'button', class: 'botao pequeno perigo-cheio', onclick: (ev) => comOcupado(ev.currentTarget, 'Removendo…', async () => {
            await chamar(`/api/apuracao/ajustes/${a.id}`, { method: 'DELETE' }); ap.removendo = null; avisar('Ajuste removido.', { tipo: 'ok' }); await apCarregar();
          }, `ap-rem-${a.id}`) }, 'Remover'))
        : h('button', { type: 'button', class: 'botao pequeno perigo', onclick: () => { ap.removendo = a.id; apRender(); } }, 'Remover');
      return h('li', {},
        h('div', { class: 'ia-conexao' }, h('strong', { text: `${a.valor > 0 ? '+' : '−'}${moeda(Math.abs(a.valor))} · ${g ? g.curto : 'Grupo'}` }),
          h('span', { class: 'meta', text: `${a.justificativa}` }),
          h('span', { class: 'meta', text: `${varios ? `${formatarCnpj(a.estab.cnpj)} · ` : ''}${a.por || ''}${a.em ? ` em ${formatarData(a.em)}` : ''}` })),
        acoes);
    };
    const form = podeOperar ? apFormAjuste(d) : null;
    return h('section', { class: 'vg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: 'Ajustes manuais' }),
        h('p', { class: 'meta', text: 'Receita que não está nas notas (ex.: venda com nota emitida depois) ou correção de uma classificação. Justificativa obrigatória: fica no histórico da apuração.' }))),
      lista.length ? h('ul', { class: 'sped-envios ia-lista' }, ...lista.map(linha)) : h('p', { class: 'meta', text: 'Nenhum ajuste neste mês.' }),
      form);
  }

  function apFormAjuste(d) {
    const varios = d.estabelecimentos.length > 1;
    const erro = h('p', { class: 'erro', role: 'alert', hidden: true });
    const campos = {
      valor: h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Ex.: 1.250,00 ou -300,00', autocomplete: 'off' }),
      grupo: h('select', {}, ...AP_GRUPOS.map((g) => h('option', { value: g.chave, text: g.titulo }))),
      estab: varios ? h('select', {}, ...d.estabelecimentos.map((e) => h('option', { value: e.id, text: `${formatarCnpj(e.cnpj)}${e.cnpj.slice(8, 12) === '0001' ? ' (matriz)' : ''}` }))) : null,
      just: h('textarea', { rows: '2', maxlength: '1000', placeholder: 'Por que este ajuste? (ex.: NFS-e 123 de serviço farmacêutico)' }),
    };
    const form = h('form', { class: 'es-chaves ap-form', novalidate: true, onsubmit: (ev) => {
      ev.preventDefault();
      const corpo = apCorpoAjuste(campos.grupo.value, campos.valor.value, campos.just.value, d.competencia);
      erro.hidden = true;
      const falha = !Number.isFinite(corpo.valor) || corpo.valor === 0 ? 'Informe o valor (negativo diminui a receita).' : corpo.justificativa.length < 5 ? 'Escreva a justificativa.' : null;
      if (falha) { erro.textContent = falha; erro.hidden = false; return; }
      const alvoId = campos.estab ? campos.estab.value : d.estabelecimentos[0].id;
      comOcupado(form.querySelector('button[type=submit]'), 'Lançando…', async () => {
        try { await chamar(`/api/empresas/${alvoId}/apuracao/ajustes`, { method: 'POST', body: corpo }); } catch (e) { erro.textContent = e.message; erro.hidden = false; return; }
        avisar('Ajuste lançado.', { tipo: 'ok' }); await apCarregar();
      }, 'ap-ajuste');
    } },
      h('div', { class: 'ap-form-linha' },
        h('label', { class: 'campo' }, h('span', { text: 'Valor (R$)' }), campos.valor),
        h('label', { class: 'campo' }, h('span', { text: 'Grupo' }), campos.grupo),
        campos.estab ? h('label', { class: 'campo' }, h('span', { text: 'Estabelecimento' }), campos.estab) : null),
      h('label', { class: 'campo' }, h('span', { text: 'Justificativa' }), campos.just),
      erro,
      h('div', { class: 'gu-botoes' }, h('button', { type: 'submit', class: 'botao' }, h('span', { text: 'Lançar ajuste' }))));
    return h('details', { class: 'gu-composicao ap-novo-ajuste' }, h('summary', { text: 'Lançar ajuste' }), form);
  }

  function apCardDeclaracao(d) {
    const json = JSON.stringify(d.declaracao, null, 2);
    return h('section', { class: 'vg-card' },
      h('details', { class: 'gu-composicao' }, h('summary', { text: 'Como esta receita vai para o PGDAS-D (dados técnicos)' }),
        h('p', { class: 'meta', text: 'Corpo da declaração no formato do Integra Contador (PGDASD / TRANSDECLARACAO11). Qualificação 8 = substituição tributária; 9 = tributação monofásica.' }),
        h('pre', { class: 'mono ia-json', text: json })));
  }

  window.apCarregar = apCarregar;
}
