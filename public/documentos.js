'use strict';
/*
 * Acessórias, parte 2.
 * - Aba "Documentos" da Empresa 360°: documentos do mês em PDF (recibos do SPED, DARF, DCTFWeb, Reinf, guia de ICMS e o
 *   recibo/declaração do PGDAS-D) com o envio à Acessórias, e as obrigações (entregas) da empresa na Acessórias.
 * - Cartão "Acessórias: cadastro e entregas" em Administração › Escritório.
 * Usa os utilitários globais do app.js (h, $, chamar, icone, comOcupado, avisar, baixarArquivo, enviarArquivo,
 * empresaNotas, mesSelecionado, pode) e do nucleo.js (formatarData, formatarHora, textoCompetencia, formatarCnpj).
 */

/* ---------- funções puras (testadas em test/documentos-tela.test.ts) ---------- */

/** Situação do envio de um documento à Acessórias. `configurada`: a integração tem token. */
function dcSeloEnvio(envio, configurada) {
  if (!envio) return configurada ? { tom: 'neutro', texto: 'Não enviado' } : null;
  if (envio.status === 'enviado') return { tom: 'ok', texto: 'Enviado à Acessórias' };
  return { tom: 'problema', texto: 'Erro no envio' };
}

/** Selo de uma entrega (obrigação) da Acessórias. */
function dcSeloEntrega(situacao) {
  return ({ entregue: { tom: 'ok', texto: 'Entregue' }, atrasada: { tom: 'problema', texto: 'Atrasada' }, pendente: { tom: 'pendente', texto: 'Pendente' }, dispensada: { tom: 'neutro', texto: 'Dispensada' } })[situacao]
    || { tom: 'neutro', texto: situacao || '—' };
}

/** Frase do resumo das entregas: "2 atrasadas · 1 pendente · 5 entregues". */
function dcResumoEntregas(c) {
  if (!c) return '';
  const p = [];
  if (c.atrasada) p.push(`${c.atrasada} atrasada${c.atrasada === 1 ? '' : 's'}`);
  if (c.pendente) p.push(`${c.pendente} pendente${c.pendente === 1 ? '' : 's'}`);
  if (c.entregue) p.push(`${c.entregue} entregue${c.entregue === 1 ? '' : 's'}`);
  if (c.dispensada) p.push(`${c.dispensada} dispensada${c.dispensada === 1 ? '' : 's'}`);
  return p.length ? p.join(' · ') : 'Nenhuma obrigação nesta competência';
}

/** Data AAAA-MM-DD → DD/MM/AAAA (sem passar por Date: não volta um dia no fuso). */
function dcDia(d) { return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—'; }

/** Mês anterior ao informado (AAAA-MM): a competência que o escritório está fechando. */
function dcMesAnterior(mes) {
  const [a, m] = mes.split('-').map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`;
}

/** Tamanho legível. */
function dcTamanho(b) { return b >= 1048576 ? `${(b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`; }

if (typeof module !== 'undefined') module.exports = { dcSeloEnvio, dcSeloEntrega, dcResumoEntregas, dcDia, dcMesAnterior, dcTamanho };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  var dc = { chave: null, dados: null, erro: null, tipo: 'recibo_sped_fiscal', confirmarRemover: null };

  async function dcCarregar() {
    const alvo = $('dc-conteudo');
    if (!alvo || !empresaNotas) return;
    const id = empresaNotas.id; const mes = mesSelecionado(); const chave = `${id}|${mes}`;
    if (dc.chave !== chave) { dc.chave = chave; dc.dados = null; dc.confirmarRemover = null; alvo.replaceChildren(h('section', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }))); }
    try {
      const d = await chamar(`/api/empresas/${id}/documentos?mes=${mes}`);
      if (dc.chave !== chave) return;
      dc.dados = d; dc.erro = null;
    } catch (e) {
      if (dc.chave !== chave) return;
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar os documentos.' }), h('span', { text: e.message })));
      return;
    }
    dcRender();
  }

  function dcRender() {
    const d = dc.dados; if (!d || !$('dc-conteudo')) return;
    $('dc-conteudo').replaceChildren(dcCardDocumentos(d), dcCardEntregas(d));
  }

  /* Documentos do mês */
  function dcCardDocumentos(d) {
    const ac = d.acessorias || {};
    const podeOperar = pode('operar');
    const tipo = h('select', { id: 'dc-tipo', onchange: (ev) => { dc.tipo = ev.target.value; } }, ...d.tipos.map((t) => h('option', { value: t.id, text: t.nome, selected: t.id === dc.tipo })));
    const desc = h('input', { id: 'dc-descricao', type: 'text', maxlength: '120', placeholder: 'Ex.: IRPJ 3º trimestre', autocomplete: 'off' });
    const arquivo = h('input', { id: 'dc-arquivo', type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true, onchange: (ev) => dcEnviarArquivos(ev.target.files) });
    const form = podeOperar ? h('div', { class: 'ap-form-linha dc-form' },
      h('label', { class: 'campo' }, h('span', { text: 'Tipo' }), tipo),
      h('label', { class: 'campo' }, h('span', { text: 'Descrição (opcional)' }), desc),
      h('div', { class: 'dc-form-botao' }, arquivo, h('button', { type: 'button', id: 'dc-escolher', class: 'botao primario', onclick: () => arquivo.click() }, icone('file-check'), h('span', { text: 'Adicionar PDF' })))) : null;

    const itens = d.documentos.map((x) => {
      const selo = dcSeloEnvio(x.envio, ac.configurado);
      const enviar = ac.configurado && podeOperar ? h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Enviando…', async () => {
        let r; try { r = await chamar(`/api/documentos/${x.id}/enviar`, { method: 'POST', body: { forcar: !!x.envio } }); } catch (e) { avisar(e.message, { tipo: 'erro' }); return; }
        avisar(r.status === 'enviado' ? 'Documento aceito pela Acessórias.' : `A Acessórias não aceitou: ${r.mensagem}`, { tipo: r.status === 'enviado' ? 'ok' : 'erro' });
        await dcCarregar();
      }, `dc-env-${x.id}`) }, icone('arrow-right'), h('span', { text: x.envio ? 'Reenviar' : 'Enviar' })) : null;
      const remover = podeOperar && x.origem === 'upload'
        ? (dc.confirmarRemover === x.id
          ? h('span', { class: 'gu-botoes' },
            h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => { dc.confirmarRemover = null; dcRender(); } }, 'Cancelar'),
            h('button', { type: 'button', class: 'botao pequeno perigo', onclick: (ev) => comOcupado(ev.currentTarget, 'Removendo…', async () => {
              try { await chamar(`/api/documentos/${x.id}`, { method: 'DELETE' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); return; }
              dc.confirmarRemover = null; avisar('Documento removido do Appura. Na Acessórias, nada muda.', { tipo: 'ok' }); await dcCarregar();
            }, `dc-rem-${x.id}`) }, 'Remover'))
          : h('button', { type: 'button', class: 'botao pequeno fantasma', 'aria-label': `Remover ${x.nome}`, onclick: () => { dc.confirmarRemover = x.id; dcRender(); } }, icone('x')))
        : null;
      return h('li', { class: 'dc-doc' },
        h('div', { class: 'ia-conexao' },
          h('strong', { text: x.rotulo + (x.descricao ? ` · ${x.descricao}` : '') }),
          h('span', { class: 'meta', text: `${x.nome} · ${dcTamanho(x.tamanho)} · ${x.origem === 'pgdas' ? 'da transmissão do PGDAS-D' : `enviado por ${x.criado_por}`} em ${formatarData(x.criado_em)}` }),
          x.envio && x.envio.status === 'erro' ? h('span', { class: 'meta dc-erro', text: `Acessórias: ${x.envio.mensagem}` }) : null,
          x.envio && x.envio.status === 'erro' && /inexistente/i.test(x.envio.mensagem || '') ? h('span', { class: 'meta', text: 'A Acessórias só aceita o documento quando a obrigação desta competência existe para a empresa lá.' }) : null),
        selo ? h('span', { class: `selo ${selo.tom}`, text: selo.texto }) : null,
        h('span', { class: 'gu-botoes' },
          h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Baixando…', () => baixarArquivo(`/api/documentos/${x.id}/arquivo`, x.nome), `dc-baixar-${x.id}`) }, icone('cloud-download'), h('span', { text: 'Baixar' })),
          enviar, remover));
    });
    const pendentes = d.documentos.filter((x) => !x.envio || x.envio.status !== 'enviado');
    return h('section', { class: 'vg-card dc-card', 'aria-labelledby': 'dc-titulo' },
      h('div', { class: 'vg-card-topo' }, h('div', {},
        h('h2', { id: 'dc-titulo', class: 'vg-card-titulo', text: `Documentos de ${textoCompetencia(d.competencia)}` }),
        h('p', { class: 'meta', text: ac.configurado
          ? `Recibos e guias em PDF que vão para a Acessórias pelo e-Contínuo, que lê o CNPJ, a competência e o tipo do próprio PDF e dá baixa na obrigação. ${ac.envioAutomatico ? 'O envio automático está ligado: o documento vai assim que entra.' : 'O envio automático está desligado: use "Enviar".'} O DAS fica na aba Guias.`
          : 'Recibos e guias do mês em PDF, guardados no Appura. Com a Acessórias configurada (Administração › Escritório), eles vão para lá pelo e-Contínuo.' })),
        ac.configurado && pendentes.length && podeOperar ? h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => comOcupado(ev.currentTarget, 'Enviando…', async () => {
          let r; try { r = await chamar('/api/acessorias/documentos/enviar', { method: 'POST', body: { mes: d.competencia, empresas: [empresaNotas.id] } }); } catch (e) { avisar(e.message, { tipo: 'erro' }); return; }
          const okN = r.resultados.filter((x) => x.ok).length;
          avisar(`${okN} de ${r.resultados.length} documento${r.resultados.length === 1 ? '' : 's'} aceito${okN === 1 ? '' : 's'} pela Acessórias.`, { tipo: okN === r.resultados.length ? 'ok' : 'erro' });
          await dcCarregar();
        }, 'dc-enviar-todos') }, icone('arrow-right'), `Enviar pendentes (${pendentes.length})`) : null),
      form,
      podeOperar ? null : h('p', { class: 'meta', text: 'Seu perfil só consulta: peça a um analista para adicionar documentos.' }),
      itens.length ? h('ul', { class: 'sped-envios dc-lista' }, ...itens)
        : h('div', { class: 'vg-vazio pequeno' }, h('strong', { text: 'Nenhum documento neste mês.' }),
          h('span', { text: 'Adicione o recibo do SPED tirado do PVA, o DARF, a DCTFWeb, o recibo da Reinf ou a guia de ICMS em PDF. O recibo e a declaração do PGDAS-D entram sozinhos na transmissão.' })));
  }

  async function dcEnviarArquivos(lista) {
    const arquivos = [...(lista || [])];
    $('dc-arquivo').value = '';
    if (!arquivos.length || !empresaNotas) return;
    const id = empresaNotas.id; const mes = mesSelecionado();
    const tipo = $('dc-tipo').value; const descricao = $('dc-descricao').value.trim();
    const botao = $('dc-escolher'); botao.disabled = true;
    let ok = 0; let repetidos = 0; let enviados = 0; const erros = [];
    for (const f of arquivos) {
      if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { erros.push(`${f.name}: não é PDF`); continue; }
      try {
        const r = await enviarArquivo(`/api/empresas/${id}/documentos?mes=${mes}&tipo=${encodeURIComponent(tipo)}&nome=${encodeURIComponent(f.name)}${descricao ? `&descricao=${encodeURIComponent(descricao)}` : ''}`, f);
        if (r.repetido) repetidos++; else ok++;
        if (r.envio && r.envio.status === 'enviado') enviados++;
        else if (r.envio && r.envio.status === 'erro') erros.push(`${f.name}: a Acessórias não aceitou (${r.envio.mensagem})`);
      } catch (e) { erros.push(`${f.name}: ${e.message}`); }
    }
    botao.disabled = false;
    const partes = [];
    if (ok) partes.push(`${ok} documento${ok === 1 ? '' : 's'} adicionado${ok === 1 ? '' : 's'}`);
    if (enviados) partes.push(`${enviados} aceito${enviados === 1 ? '' : 's'} pela Acessórias`);
    if (repetidos) partes.push(`${repetidos} já estava${repetidos === 1 ? '' : 'm'} no Appura`);
    if (partes.length) avisar(`${partes.join(', ')}.`, { tipo: erros.length ? 'erro' : 'ok' });
    if (erros.length) avisar(erros.slice(0, 3).join(' · '), { tipo: 'erro' });
    if (empresaNotas && empresaNotas.id === id) await dcCarregar();
  }

  /* Obrigações (entregas) na Acessórias */
  function dcCardEntregas(d) {
    const ac = d.acessorias || {};
    const topo = (selo) => h('div', { class: 'vg-card-topo' }, h('div', {},
      h('h2', { class: 'vg-card-titulo', text: 'Obrigações na Acessórias' }),
      h('p', { class: 'meta', text: `Entregas de ${textoCompetencia(d.competencia)} desta empresa no Sistema Acessórias.` })), selo);
    if (!ac.configurado) {
      return h('section', { class: 'vg-card' }, topo(h('span', { class: 'selo neutro', text: 'Não configurada' })),
        h('p', { class: 'meta', text: 'Configure o API Token da Acessórias em Administração › Escritório para ver as obrigações aqui.' }));
    }
    const e = d.entregas;
    const consultar = h('button', { type: 'button', class: `botao pequeno ${e ? '' : 'primario'}`, onclick: (ev) => comOcupado(ev.currentTarget, 'Consultando…', async () => {
      try { await chamar(`/api/empresas/${empresaNotas.id}/acessorias/entregas?mes=${d.competencia}`, { method: 'POST' }); } catch (err) { avisar(err.message, { tipo: 'erro' }); return; }
      await dcCarregar();
    }, 'dc-consultar') }, icone('refresh-cw'), h('span', { text: e ? 'Consultar de novo' : 'Consultar agora' }));
    const partes = [];
    const cad = d.cadastro;
    if (!cad) partes.push(h('div', { class: 'sped-aviso' }, icone('triangle-alert'), h('span', { text: 'Esta empresa não apareceu na última sincronização do cadastro da Acessórias (Administração › Escritório). Confira se o CNPJ está cadastrado lá.' })));
    else {
      const atrasadas = (cad.obrigacoes || []).filter((o) => o.atrasadas > 0);
      if (atrasadas.length) partes.push(h('div', { class: 'sped-aviso' }, icone('triangle-alert'), h('span', { text: `No cadastro da Acessórias: ${atrasadas.map((o) => `${o.nome} (${o.atrasadas} atrasada${o.atrasadas === 1 ? '' : 's'})`).join(', ')}.` })));
    }
    if (!e) {
      partes.push(h('div', { class: 'vg-vazio pequeno' }, h('strong', { text: 'Ainda não consultado.' }), h('span', { text: 'A consulta não tem custo: o Appura pergunta à Acessórias quais obrigações desta competência estão entregues, pendentes ou atrasadas.' })));
    } else {
      partes.push(h('p', { class: 'meta', text: `${dcResumoEntregas(e.contagem)} · consultado em ${formatarData(e.consultadoEm)} às ${formatarHora(e.consultadoEm)}` }));
      if (e.erro) partes.push(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'A Acessórias respondeu com erro.' }), h('span', { text: e.erro })));
      if (e.entregas.length) {
        partes.push(h('ul', { class: 'ap-alertas dc-entregas' }, ...e.entregas.map((x) => {
          const s = dcSeloEntrega(x.situacao);
          const info = [x.prazo ? `Prazo ${dcDia(x.prazo)}` : null, x.entregue_em ? `entregue em ${dcDia(x.entregue_em)}` : null, x.departamento, x.responsavel ? `resp. ${x.responsavel}` : null, x.guia_lida ? 'guia lida' : null, x.multa ? 'com multa' : null].filter(Boolean).join(' · ');
          return h('li', {}, h('span', { class: `selo ${s.tom}`, text: s.texto }), h('div', {}, h('strong', { text: x.nome }), h('span', { class: 'meta', text: info || '—' })));
        })));
      }
    }
    return h('section', { class: 'vg-card dc-card' }, topo(consultar), ...partes);
  }

  /* ---------- Administração › Escritório: cadastro e entregas do escritório todo ---------- */
  var ae = { mes: null, empresas: null, entregas: null, erro: null, timer: null };

  async function aeCarregar() {
    const alvo = $('ae-conteudo'); if (!alvo) return;
    if (!ae.mes) ae.mes = dcMesAnterior(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7));
    aeRender();
    try {
      const [emp, ent] = await Promise.all([chamar('/api/acessorias/empresas'), chamar(`/api/acessorias/entregas?mes=${ae.mes}`)]);
      ae.empresas = emp; ae.entregas = ent; ae.erro = null;
    } catch (e) { ae.erro = e.message; }
    aeRender();
    clearTimeout(ae.timer);
    const p = ae.entregas && ae.entregas.progresso;
    if (p && !p.terminado_em && $('ae-conteudo') && !$('tela-escritorio').hidden) ae.timer = setTimeout(aeCarregar, 3000);
  }

  function aeRender() {
    const alvo = $('ae-conteudo'); if (!alvo) return;
    if (ae.erro && !ae.empresas) { alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível carregar os dados da Acessórias.' }), h('span', { text: ae.erro }))); return; }
    if (!ae.empresas) { alvo.replaceChildren(h('section', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }))); return; }
    const m = ae.empresas; const en = ae.entregas || {};
    const podeOperar = pode('operar');
    const sincronizar = h('button', { type: 'button', class: `botao pequeno ${m.sincronizadoEm ? '' : 'primario'}`, disabled: !podeOperar, onclick: (ev) => comOcupado(ev.currentTarget, 'Sincronizando…', async () => {
      try { ae.empresas = await chamar('/api/acessorias/empresas/sincronizar', { method: 'POST' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); return; }
      avisar(`${ae.empresas.naAcessorias} empresas lidas da Acessórias.`, { tipo: 'ok' }); aeRender();
    }, 'ae-sinc') }, icone('refresh-cw'), h('span', { text: 'Sincronizar empresas' }));

    const cadastro = m.sincronizadoEm ? [
      h('ul', { class: 'e360-lista-num' },
        h('li', {}, h('span', { text: 'Empresas na Acessórias' }), h('strong', { text: String(m.naAcessorias) })),
        h('li', {}, h('span', { text: 'Do Appura com cadastro lá' }), h('strong', { text: String(m.vinculadas) })),
        h('li', {}, h('span', { text: 'Do Appura sem cadastro lá' }), h('strong', { text: String(m.totalSemCadastro) })),
        h('li', {}, h('span', { text: 'Com obrigação atrasada' }), h('strong', { text: String(m.totalComAtraso) }))),
      m.semCadastro.length ? h('details', { class: 'gu-composicao' }, h('summary', { text: `Empresas do Appura sem cadastro na Acessórias (${m.totalSemCadastro})` }),
        h('ul', { class: 'sped-envios ae-detalhes' }, ...m.semCadastro.map((e) => h('li', {}, h('a', { href: `#/empresas/${e.id}`, text: e.razao_social }), h('span', { class: 'meta mono', text: formatarCnpj(e.cnpj) }))))) : null,
      m.comAtraso.length ? h('details', { class: 'gu-composicao' }, h('summary', { text: `Obrigações atrasadas no cadastro da Acessórias (${m.totalComAtraso})` }),
        h('ul', { class: 'sped-envios ae-detalhes' }, ...m.comAtraso.map((e) => h('li', {}, h('a', { href: `#/empresas/${e.id}/documentos`, text: e.razao_social }),
          h('span', { class: 'meta', text: e.atrasadas.map((o) => `${o.nome} (${o.quantidade})`).join(', ') }))))) : null,
      h('p', { class: 'meta', text: `Última sincronização: ${formatarData(m.sincronizadoEm)} às ${formatarHora(m.sincronizadoEm)}.` }),
    ] : [h('p', { class: 'meta', text: 'Sincronize para o Appura saber quais clientes estão cadastrados na Acessórias e quais têm obrigação atrasada. São cerca de 30 consultas para 600 empresas, sem custo.' })];

    const p = en.progresso;
    const rodando = p && !p.terminado_em && p.competencia === ae.mes;
    const mes = h('input', { type: 'month', id: 'ae-mes', value: ae.mes, onchange: (ev) => { if (/^\d{4}-\d{2}$/.test(ev.target.value)) { ae.mes = ev.target.value; aeCarregar(); } } });
    const consultar = h('button', { type: 'button', class: 'botao pequeno', disabled: !podeOperar || rodando || !m.sincronizadoEm, onclick: (ev) => comOcupado(ev.currentTarget, 'Iniciando…', async () => {
      try { await chamar('/api/acessorias/entregas/atualizar', { method: 'POST', body: { mes: ae.mes } }); } catch (e) { avisar(e.message, { tipo: 'erro' }); return; }
      avisar('Consulta iniciada: o Appura pergunta à Acessórias empresa por empresa (cerca de 100 por minuto).', { tipo: 'ok' }); await aeCarregar();
    }, 'ae-consultar') }, icone('list-checks'), h('span', { text: 'Consultar entregas do mês' }));
    const tot = en.totais || { entregue: 0, atrasada: 0, pendente: 0 };
    const entregas = [
      h('div', { class: 'ae-linha' }, h('label', { class: 'campo' }, h('span', { text: 'Competência' }), mes), consultar),
      rodando ? h('div', { class: 'ae-progresso', role: 'status' }, h('div', { class: 'ae-barra' }, (() => { const b = h('span'); b.style.width = `${p.total ? Math.round((p.feitas / p.total) * 100) : 0}%`; return b; })()),
        h('span', { class: 'meta', text: `Consultando ${p.feitas} de ${p.total} empresas…` })) : null,
      p && p.terminado_em && p.competencia === ae.mes ? h('p', { class: 'meta', text: `Última consulta em lote: ${p.feitas} de ${p.total} empresas, ${p.erros} com erro, terminada às ${formatarHora(p.terminado_em)}.${p.mensagem ? ` Parou: ${p.mensagem}` : ''}` }) : null,
      en.consultadas ? h('p', { class: 'meta', text: `${en.consultadas} empresa${en.consultadas === 1 ? '' : 's'} consultada${en.consultadas === 1 ? '' : 's'}: ${dcResumoEntregas(tot)}.${en.documentosPendentes ? ` ${en.documentosPendentes} documento${en.documentosPendentes === 1 ? '' : 's'} do mês ainda não enviado${en.documentosPendentes === 1 ? '' : 's'}.` : ''}` })
        : h('p', { class: 'meta', text: m.sincronizadoEm ? 'Nenhuma empresa consultada nesta competência.' : 'Sincronize as empresas antes de consultar as entregas.' }),
      en.empresas && en.empresas.length ? h('ul', { class: 'ap-alertas ae-lista' }, ...en.empresas.slice(0, 100).map((e) => {
        const s = e.contagem.atrasada ? dcSeloEntrega('atrasada') : dcSeloEntrega('pendente');
        return h('li', {}, h('span', { class: `selo ${e.erro ? 'neutro' : s.tom}`, text: e.erro ? 'Erro' : `${e.contagem.atrasada || e.contagem.pendente} ${e.contagem.atrasada ? 'atrasada' : 'pendente'}${(e.contagem.atrasada || e.contagem.pendente) === 1 ? '' : 's'}` }),
          h('div', {}, h('a', { href: `#/empresas/${e.empresaId}/documentos`, text: e.razao_social || e.empresaId }),
            h('span', { class: 'meta', text: e.erro || e.entregas.slice(0, 6).map((x) => `${x.nome}${x.prazo ? ` (${dcDia(x.prazo)})` : ''}`).join(' · ') })));
      })) : null,
    ];
    alvo.replaceChildren(h('section', { class: 'vg-card ae-card', 'aria-labelledby': 'ae-titulo' },
      h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { id: 'ae-titulo', class: 'vg-card-titulo', text: 'Acessórias: cadastro e entregas' }),
        h('p', { class: 'meta', text: 'O Appura lê da Acessórias o cadastro das empresas e as entregas de cada competência. Nada é alterado lá.' })), sincronizar),
      ...cadastro,
      h('h3', { class: 'ae-subtitulo', text: 'Entregas da competência' }),
      ...entregas));
  }

  window.dcCarregar = dcCarregar;
  window.aeCarregar = aeCarregar;
}
