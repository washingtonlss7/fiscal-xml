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

if (typeof module !== 'undefined') module.exports = { AP_GRUPOS, apParticipacao, apVariacao, apSituacao, apCorpoAjuste };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  var ap = { chave: null, dados: null, erro: null, removendo: null };
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
          h('p', { class: 'meta', text: `Prévia montada das notas de venda${d.estabelecimentos.length > 1 ? ` de ${d.estabelecimentos.length} estabelecimentos (matriz e filiais)` : ''}. Nada é enviado à Receita nesta etapa.` })),
        h('span', { class: `selo ${sit.tom}`, text: sit.texto })),
      h('div', { class: 'ap-receita' }, h('strong', { class: 'ap-total', text: moeda(d.receita) }),
        h('div', { class: 'ap-comps' }, linhaComp('Notas do mês anterior', d.comparacao.mesAnterior, varAnt), linhaComp('Mesmo mês do ano passado', d.comparacao.mesmoMesAnoPassado, varAno))),
      h('p', { class: 'dica ap-dica', text: 'O imposto não é calculado aqui: na próxima etapa a própria Receita calcula (simulação do PGDAS-D) a partir desta receita segregada, e o supervisor transmite.' }));

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

    alvoRender([topo, apCardAlertas(d), grupos, apCardFora(d), apCardAjustes(d), apCardDeclaracao(d)].filter(Boolean));
  }
  const alvoRender = (filhos) => $('ap-conteudo').replaceChildren(...filhos);

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
