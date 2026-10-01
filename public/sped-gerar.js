'use strict';
/*
 * "Gerar SPED" na aba SPED da Empresa 360°: o Appura gera o SPED Fiscal (EFD ICMS/IPI) e o SPED Contribuições
 * (EFD PIS/COFINS, Lucro Real não cumulativo) a partir dos XMLs do mês e do SPED do mês anterior; mostra o resumo,
 * as pendências da geração e a validação do leitor; baixa o arquivo e "audita" (envia pela auditoria do mês).
 * Usa os utilitários globais do app.js (h, $, chamar, icone, comOcupado, avisar, baixarArquivo, empresaNotas,
 * mesSelecionado, pode) e do nucleo.js (moeda, formatarData, formatarHora, textoCompetencia).
 */

/* ---------- funções puras (testadas em test/sped-gerar-tela.test.ts) ---------- */

/** Selo da versão: o PVA vai recusar (erros), conferir (alertas) ou pronto. */
function sgSelo(g) {
  if (!g) return { tom: 'neutro', texto: 'Não gerado' };
  if (g.erros) return { tom: 'problema', texto: `${g.erros} pendência${g.erros === 1 ? '' : 's'} que impede${g.erros === 1 ? '' : 'm'} a transmissão` };
  if (g.alertas) return { tom: 'atencao', texto: `Pronto, com ${g.alertas} ponto${g.alertas === 1 ? '' : 's'} para conferir` };
  return { tom: 'ok', texto: 'Pronto para validar no PVA' };
}

/** Números do resumo para a tela. */
function sgNumeros(g) {
  const r = (g && g.resumo) || {};
  if (g && g.tipo === 'efd_icms_ipi') {
    const d = r.documentos || {}; const i = r.icms || {};
    return [
      ['Entradas (NF-e)', String(d.entradas || 0)], ['Saídas (NF-e)', String(d.saidasNfe || 0)], ['NFC-e', String(d.nfce || 0)], ['CT-e', String(d.cte || 0)],
      ['Débitos de ICMS', moeda(i.debitos)], ['Créditos de ICMS', moeda(i.creditos)], ['Saldo credor anterior', moeda(i.saldoCredorAnterior)],
      [i.aRecolher > 0 ? 'ICMS a recolher' : 'Saldo credor a transportar', moeda(i.aRecolher > 0 ? i.aRecolher : i.saldoCredorTransportar)],
    ];
  }
  const d = r.documentos || {}; const p = r.pis || {}; const c = r.cofins || {};
  return [
    ['Entradas com crédito', String(d.entradas || 0)], ['Saídas (NF-e)', String(d.saidasNfe || 0)], ['NFC-e', String(d.nfce || 0)], ['Estabelecimentos', String(r.estabelecimentos || 1)],
    ['PIS a recolher', moeda(p.aRecolher)], ['COFINS a recolher', moeda(c.aRecolher)], ['Créditos (PIS + COFINS)', moeda((p.credito || 0) + (c.credito || 0))],
    ['Saldo credor (PIS + COFINS)', moeda((p.saldoCredor || 0) + (c.saldoCredor || 0))],
  ];
}

/** Pendências da geração + ocorrências do validador, numa lista só, na ordem erro → alerta → info. */
function sgPontos(g) {
  const o = { erro: 0, alerta: 1, info: 2 };
  const pend = (g.pendencias || []).map((p) => ({ nivel: p.nivel, texto: p.texto, quantidade: p.quantidade, exemplos: p.exemplos || [], origem: 'Geração' }));
  const val = (g.validacao || []).map((v) => ({ nivel: v.nivel, texto: v.mensagem, quantidade: v.quantidade, exemplos: [], origem: 'Validação' }));
  return [...pend, ...val].sort((a, b) => o[a.nivel] - o[b.nivel]);
}

if (typeof module !== 'undefined') module.exports = { sgSelo, sgNumeros, sgPontos };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  var sg = { chave: null, dados: null, confirmarAuditoria: null };
  const NOMES = { efd_icms_ipi: 'SPED Fiscal (EFD ICMS/IPI)', efd_contribuicoes: 'SPED Contribuições (EFD PIS/COFINS)' };

  async function sgCarregar() {
    const alvo = $('sg-conteudo');
    if (!alvo || !empresaNotas) return;
    if (!['real', 'presumido'].includes(empresaNotas.regime)) { alvo.replaceChildren(); return; }
    const id = empresaNotas.id; const mes = mesSelecionado(); const chave = `${id}|${mes}`;
    if (sg.chave !== chave) { sg.chave = chave; sg.dados = null; sg.confirmarAuditoria = null; alvo.replaceChildren(h('section', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }))); }
    try {
      const d = await chamar(`/api/empresas/${id}/sped-gerado?mes=${mes}`);
      if (sg.chave !== chave) return;
      sg.dados = d;
    } catch (e) {
      if (sg.chave !== chave) return;
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar os SPEDs gerados.' }), h('span', { text: e.message })));
      return;
    }
    sgRender();
  }

  function sgRender() {
    const d = sg.dados; if (!d) return;
    const mes = mesSelecionado();
    const linhas = [sgLinha('efd_icms_ipi', d.fiscal, mes, null)];
    linhas.push(sgLinha('efd_contribuicoes', d.contribuicoes, mes,
      d.regime === 'presumido' ? 'Lucro Presumido (regime cumulativo): geração em breve. Por enquanto, só o Lucro Real (não cumulativo).' : null));
    $('sg-conteudo').replaceChildren(h('section', { class: 'vg-card sg-card' },
      h('div', { class: 'vg-card-topo' }, h('div', {},
        h('h2', { class: 'vg-card-titulo', text: `Gerar SPED de ${textoCompetencia(mes)}` }),
        h('p', { class: 'meta', text: 'O Appura monta o arquivo a partir dos XMLs do mês e aproveita do SPED do mês anterior o cadastro, os códigos dos produtos, as contas e os saldos. Confira as pendências, baixe, valide no PVA e transmita. "Auditar" coloca o arquivo como SPED do mês e roda todas as comparações abaixo.' }))),
      ...linhas));
  }

  function sgLinha(tipo, versoes, mes, indisponivel) {
    const g = (versoes || [])[0] || null;
    const selo = sgSelo(g);
    const podeOperar = pode('operar');
    const topo = h('div', { class: 'sg-topo' },
      h('div', {}, h('strong', { text: NOMES[tipo] }),
        h('span', { class: 'meta', text: g ? `Versão ${g.versao} · gerada em ${formatarData(g.gerado_em)} às ${formatarHora(g.gerado_em)} por ${g.gerado_por}${empresaNotas && g.empresa_id !== empresaNotas.id ? ' · pela matriz' : ''}` : indisponivel || 'Ainda não gerado neste mês.' })),
      h('span', { class: `selo ${selo.tom}`, text: g ? selo.texto : indisponivel ? 'Em breve' : 'Não gerado' }));
    if (indisponivel) return h('div', { class: 'sg-linha' }, topo);
    const gerar = h('button', { type: 'button', class: `botao ${g ? '' : 'primario'}`, disabled: !podeOperar, onclick: (ev) => comOcupado(ev.currentTarget, 'Gerando…', async () => {
      try { await chamar(`/api/empresas/${empresaNotas.id}/sped-gerado`, { method: 'POST', body: { mes, tipo } }); }
      catch (e) { avisar(e.message, { tipo: 'erro' }); return; }
      avisar('Arquivo gerado. Confira as pendências antes de transmitir.', { tipo: 'ok' }); sg.chave = null; await sgCarregar();
    }, `sg-gerar-${tipo}`) }, icone('file-spreadsheet'), h('span', { text: g ? 'Gerar de novo' : 'Gerar' }));
    const partes = [topo];
    if (g) {
      partes.push(h('dl', { class: 'sg-numeros' }, ...sgNumeros(g).map(([k, v]) => h('div', {}, h('dt', { text: k }), h('dd', { text: v })))));
      const pontos = sgPontos(g);
      if (pontos.length) {
        const tom = { erro: 'problema', alerta: 'atencao', info: 'neutro' }; const rot = { erro: 'Impede', alerta: 'Conferir', info: 'Como foi feito' };
        partes.push(h('details', { class: 'gu-composicao', open: g.erros > 0 }, h('summary', { text: `Pendências e validação (${pontos.length})` }),
          h('ul', { class: 'ap-alertas' }, ...pontos.map((p) => h('li', {}, h('span', { class: `selo ${tom[p.nivel]}`, text: rot[p.nivel] }),
            h('div', {}, h('strong', { text: p.texto }), h('span', { class: 'meta', text: `${p.origem}${p.quantidade > 1 ? ` · ${p.quantidade} ocorrências` : ''}` }),
              p.exemplos.length ? h('span', { class: 'meta sg-exemplos', text: `Ex.: ${p.exemplos.join(' · ')}` }) : null))))));
      }
      const auditar = sg.confirmarAuditoria === g.id
        ? h('span', { class: 'gu-botoes' },
          h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => { sg.confirmarAuditoria = null; sgRender(); } }, 'Cancelar'),
          h('button', { type: 'button', class: 'botao pequeno primario', onclick: (ev) => comOcupado(ev.currentTarget, 'Auditando…', async () => {
            try { await chamar(`/api/sped-gerado/${g.id}/auditar`, { method: 'POST' }); }
            catch (e) { avisar(e.message, { tipo: 'erro' }); return; }
            sg.confirmarAuditoria = null; avisar('Arquivo enviado para a auditoria do mês: veja o resultado abaixo.', { tipo: 'ok' });
            sg.chave = null; await sgCarregar(); if (window.spedCarregar) window.spedCarregar(true);
          }, `sg-aud-${g.id}`) }, 'Confirmar'))
        : h('button', { type: 'button', class: 'botao', disabled: !podeOperar, onclick: () => { sg.confirmarAuditoria = g.id; sgRender(); } }, icone('shield-check'), h('span', { text: g.auditado_arquivo_id ? 'Auditar de novo' : 'Auditar no Appura' }));
      partes.push(h('div', { class: 'gu-botoes sg-botoes' },
        h('button', { type: 'button', class: 'botao', onclick: (ev) => comOcupado(ev.currentTarget, 'Baixando…', () => baixarArquivo(`/api/sped-gerado/${g.id}/arquivo`, g.nome), `sg-baixar-${g.id}`) }, icone('cloud-download'), h('span', { text: 'Baixar .txt' })),
        auditar, gerar));
      if (sg.confirmarAuditoria === g.id) partes.push(h('p', { class: 'dica', text: 'O arquivo passa a ser o SPED do mês no Appura (substitui o enviado antes) e entra nas comparações e na Central de Fechamento.' }));
      if (versoes.length > 1) {
        partes.push(h('details', { class: 'gu-composicao' }, h('summary', { text: `Versões anteriores (${versoes.length - 1})` }),
          h('ul', { class: 'sped-envios ia-lista' }, ...versoes.slice(1).map((v) => h('li', {},
            h('div', { class: 'ia-conexao' }, h('strong', { text: `Versão ${v.versao}` }), h('span', { class: 'meta', text: `${formatarData(v.gerado_em)} ${formatarHora(v.gerado_em)} · ${v.gerado_por} · ${sgSelo(v).texto}` })),
            h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Baixando…', () => baixarArquivo(`/api/sped-gerado/${v.id}/arquivo`, v.nome), `sg-baixar-${v.id}`) }, 'Baixar'))))));
      }
    } else {
      partes.push(h('div', { class: 'gu-botoes' }, gerar));
    }
    return h('div', { class: 'sg-linha' }, ...partes);
  }

  window.sgCarregar = sgCarregar;
}
