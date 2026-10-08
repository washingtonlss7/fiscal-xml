'use strict';
/*
 * Contábil (#/contabil/<aba>): processador de lançamentos pelas regras do Departamento Contábil e livro contábil.
 *   processar · pendencias · lancamentos · regras · empresas · plano · historico
 * Fluxo: fonte (notas do Appura, folha por planilha) → regras DE/PARA → lançamentos → pendências → conferência →
 * arquivo do Domínio. Nenhuma conta é decidida pelo sistema: sem regra, vira pendência.
 * Usa os utilitários globais do app.js (h, $, chamar, buscar, sessao, icone, comOcupado, avisar, pode, mesSelecionado,
 * enviarArquivo, baixarArquivo, mensagemDeErro) e do nucleo.js (formatarCnpj, moeda).
 */

/* ---------- funções puras (testadas em test/contabil-tela.test.ts) ---------- */
const CT_ABAS = { processar: 'Processar', pendencias: 'Pendências', lancamentos: 'Lançamentos', regras: 'Regras', empresas: 'Empresas', plano: 'Plano de contas', historico: 'Histórico' };
const CT_VALOR = { total_nota: 'Total da nota (vNF)', produtos: 'Valor dos produtos', produtos_menos_desconto: 'Produtos menos desconto' };
const CT_REGIME = { simples: 'Simples Nacional', mei: 'MEI', presumido: 'Lucro Presumido', real: 'Lucro Real' };
const ctN = (n) => Number(n || 0).toLocaleString('pt-BR');
const ctMoeda = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const ctData = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '—');

/** Primeiro e último dia de um mês AAAA-MM. */
function ctPeriodoDoMes(mes) {
  const [a, m] = String(mes).split('-').map(Number);
  const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  return { inicio: `${mes}-01`, fim };
}

/** Texto do resultado de um processamento. */
function ctResumoProcessamento(p) {
  if (!p) return '';
  if (p.status === 'processando') return 'Processando…';
  if (p.status === 'erro') return `Erro: ${p.erro || 'falha no processamento'}`;
  const partes = [`${ctN(p.recebidos)} recebido${p.recebidos === 1 ? '' : 's'}`, `${ctN(p.lancamentos)} lançamento${p.lancamentos === 1 ? '' : 's'}`];
  if (p.sem_regra) partes.push(`${ctN(p.sem_regra)} sem regra`);
  if (p.rejeitados) partes.push(`${ctN(p.rejeitados)} com erro`);
  if (p.duplicados) partes.push(`${ctN(p.duplicados)} já processado${p.duplicados === 1 ? '' : 's'} (não duplicados)`);
  return partes.join(' · ');
}

/** Tom do processamento para o selo. */
function ctTom(p) {
  if (!p || p.status === 'processando') return 'neutro';
  if (p.status === 'erro') return 'problema';
  return p.sem_regra || p.rejeitados ? 'atencao' : 'ok';
}

if (typeof module !== 'undefined') module.exports = { CT_ABAS, ctPeriodoDoMes, ctResumoProcessamento, ctTom, ctMoeda, ctData };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  const ct = {
    aba: 'processar', resumo: null, erro: null, dados: {},
    proc: { empresas: new Set(), periodo: null, acompanhando: null, ultimo: null },
    lanc: { empresa: '', periodo: null, pagina: 1, manual: false },
    pend: { empresa: '' },
    regras: { tipo: 'fiscal', form: null },
    emp: { form: null, busca: '' },
    plano: { planoId: '', busca: '', contas: null },
  };
  const podeCfg = () => !!(ct.resumo && ct.resumo.pode.configurar);
  const podeOp = () => !!(ct.resumo && ct.resumo.pode.operar);
  const podeFechar = () => !!(ct.resumo && ct.resumo.pode.fechar);
  const cartao = (...f) => h('section', { class: 'vg-card' }, ...f);
  const topo = (titulo, sub, ...dir) => h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: titulo }), sub ? h('p', { class: 'meta', text: sub }) : null), ...dir);
  const btn = (texto, fn, classe = 'botao pequeno', extra = {}) => h('button', { type: 'button', class: classe, ...extra, onclick: (ev) => comOcupado(ev.currentTarget, null, fn) }, h('span', { text: texto }));
  const erroCaixa = (titulo, msg) => h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: titulo }), h('span', { text: msg }));
  const carregando = () => cartao(h('div', { class: 'vg-skel', 'aria-hidden': 'true' }));
  const empresasCtb = () => (ct.resumo ? ct.resumo.empresas : []);
  const nomeEmp = (id) => { const e = empresasCtb().find((x) => x.id === id); return e ? `${e.codigo_dominio} · ${e.razao_social}` : '—'; };
  const periodoPadrao = () => ctPeriodoDoMes(typeof mesSelecionado === 'function' ? mesSelecionado() : new Date().toISOString().slice(0, 7));

  function ctMostrar(aba) {
    ct.aba = CT_ABAS[aba] ? aba : 'processar';
    $('tela-contabil').hidden = false; window.scrollTo(0, 0);
    if (!ct.proc.periodo) ct.proc.periodo = periodoPadrao();
    if (!ct.lanc.periodo) ct.lanc.periodo = periodoPadrao();
    ctCarregarResumo().then(() => ctCarregarAba());
  }

  async function ctCarregarResumo() {
    try { ct.resumo = await chamar('/api/contabil/resumo'); ct.erro = null; } catch (e) { ct.erro = e.message; }
    ctRender();
  }

  async function ctCarregarAba() {
    const a = ct.aba;
    try {
      if (a === 'pendencias') ct.dados.pendencias = await chamar(`/api/contabil/pendencias${ct.pend.empresa ? `?empresa=${ct.pend.empresa}` : ''}`);
      if (a === 'regras') ct.dados.regras = await chamar(`/api/contabil/regras/${ct.regras.tipo}`);
      if (a === 'historico') { const [p, f] = await Promise.all([chamar('/api/contabil/processamentos'), chamar('/api/contabil/arquivos')]); ct.dados.historico = { processamentos: p.processamentos, arquivos: f.arquivos }; }
      if (a === 'lancamentos' && ct.lanc.empresa) ct.dados.lancamentos = await chamar(`/api/contabil/lancamentos?empresa=${ct.lanc.empresa}&inicio=${ct.lanc.periodo.inicio}&fim=${ct.lanc.periodo.fim}&pagina=${ct.lanc.pagina}`);
      if (a === 'plano' && ct.plano.planoId) ct.plano.contas = (await chamar(`/api/contabil/planos/${ct.plano.planoId}/contas?busca=${encodeURIComponent(ct.plano.busca)}`)).contas;
      ct.dados.erro = null;
    } catch (e) { ct.dados.erro = e.message; }
    ctRender();
  }

  function ctRender() {
    if ($('tela-contabil').hidden) return;
    $('ct-abas').replaceChildren(...Object.entries(CT_ABAS).map(([id, nome]) => h('a', { href: `#/contabil/${id}`, role: 'tab', class: `aba-tela${id === ct.aba ? ' ativa' : ''}`, 'aria-selected': String(id === ct.aba) }, nome)));
    const alvo = $('ct-conteudo');
    if (ct.erro && !ct.resumo) { alvo.replaceChildren(erroCaixa('Não foi possível abrir o Contábil.', ct.erro)); return; }
    if (!ct.resumo) { alvo.replaceChildren(carregando()); return; }
    const corpo = { processar: ctProcessar, pendencias: ctPendencias, lancamentos: ctLancamentos, regras: ctRegras, empresas: ctEmpresas, plano: ctPlano, historico: ctHistorico }[ct.aba]();
    alvo.replaceChildren(...(ct.dados.erro ? [erroCaixa('Algo deu errado.', ct.dados.erro)] : []), ...[].concat(corpo).filter(Boolean));
  }

  /* ----- downloads e envios ----- */
  async function baixarPost(caminho, corpo, nomePadrao) {
    const faz = () => buscar(caminho, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessao.accessToken}` }, body: JSON.stringify(corpo) });
    let resp = await faz();
    if (resp.status === 401) { await chamar('/api/eu').catch(() => {}); resp = await faz(); }
    if (!resp.ok) { let e = null; try { e = (await resp.json()).erro; } catch { /* sem JSON */ } throw new Error(mensagemDeErro(resp.status, e)); }
    const nome = (resp.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || nomePadrao;
    const url = URL.createObjectURL(await resp.blob());
    const a = h('a', { href: url, download: nome }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return nome;
  }
  function escolherArquivo(aceita, fn) {
    const inp = h('input', { type: 'file', accept: aceita, hidden: true, onchange: async () => { const f = inp.files[0]; inp.remove(); if (f) await fn(f); } });
    document.body.append(inp); inp.click();
  }
  function enviarPlanilha(caminho, titulo, depois) {
    escolherArquivo('.csv,.xlsx,.txt', async (f) => {
      try {
        const r = await enviarArquivo(`${caminho}${caminho.includes('?') ? '&' : '?'}nome=${encodeURIComponent(f.name)}`, f);
        const erros = (r.erros || []).length;
        avisar(`${titulo}: ${ctN(r.gravadas ?? r.contas ?? r.lancamentos ?? 0)} gravado(s)${erros ? ` · ${erros} linha(s) com problema (veja abaixo)` : ''}.`, { tipo: erros ? 'erro' : 'ok' });
        ct.dados.ultimoEnvio = { titulo, ...r };
      } catch (e) { avisar(e.message, { tipo: 'erro' }); }
      await ctCarregarResumo(); await ctCarregarAba();
      if (depois) depois();
    });
  }
  const modelo = (tipo, texto = 'Baixar modelo') => h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => baixarArquivo(`/api/contabil/modelos/${tipo}`, `modelo_${tipo}.csv`).catch((e) => avisar(e.message, { tipo: 'erro' })) }, h('span', { text: texto }));
  function relatorioEnvio() {
    const r = ct.dados.ultimoEnvio;
    if (!r || !(r.erros || []).length) return null;
    return cartao(topo(`${r.titulo}: linhas com problema`, 'As demais linhas foram gravadas. Corrija e envie de novo (o envio atualiza o que já existe).'),
      h('ul', { class: 'ct-erros' }, ...r.erros.slice(0, 50).map((x) => h('li', { text: x }))));
  }
  const periodoCampos = (p, aoMudar) => [
    h('label', { class: 'campo' }, 'De', h('input', { type: 'date', value: p.inicio, onchange: (ev) => { p.inicio = ev.currentTarget.value; aoMudar && aoMudar(); } })),
    h('label', { class: 'campo' }, 'Até', h('input', { type: 'date', value: p.fim, onchange: (ev) => { p.fim = ev.currentTarget.value; aoMudar && aoMudar(); } }))];

  /* ----- Processar ----- */
  function ctProcessar() {
    const r = ct.resumo; const cfg = r.config || {};
    const out = [];
    out.push(cartao(topo('Como funciona', 'As notas e a folha viram lançamentos pelas regras do Departamento Contábil (Regras). O que não tem regra vira pendência e não é contabilizado. Processar de novo a mesma fonte não duplica nada. Homologação: comece com poucos registros, depois 1 empresa e 1 competência, depois o resto.')));
    // Campo do valor contábil: decisão do Fiscal (item 18 da especificação)
    out.push(cartao(topo('Valor contábil das notas', cfg.valor_fiscal ? `Definido: ${CT_VALOR[cfg.valor_fiscal]}${cfg.atualizado_por ? ` (por ${cfg.atualizado_por})` : ''}.` : 'Ainda não definido: as notas ficam pendentes até o Fiscal confirmar qual valor contabilizar.',
      h('span', { class: `selo ${cfg.valor_fiscal ? 'ok' : 'atencao'}`, text: cfg.valor_fiscal ? 'Definido' : 'Pendente' })),
      podeCfg() ? h('div', { class: 'ct-linha' },
        h('label', { class: 'campo' }, 'Campo usado como valor', h('select', { onchange: async (ev) => { try { await chamar('/api/contabil/config', { method: 'PATCH', body: { valor_fiscal: ev.currentTarget.value || null } }); avisar('Valor contábil atualizado. Processe de novo o período.', { tipo: 'ok' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); } ctCarregarResumo(); } },
          h('option', { value: '', text: '— escolha (o Fiscal confirma) —' }), ...Object.entries(CT_VALOR).map(([k, v]) => h('option', { value: k, text: v, selected: cfg.valor_fiscal === k })))),
        h('label', { class: 'marcar' }, h('input', { type: 'checkbox', checked: !!cfg.agrupar_nfce_por_dia, onchange: async (ev) => { try { await chamar('/api/contabil/config', { method: 'PATCH', body: { agrupar_nfce_por_dia: ev.currentTarget.checked } }); } catch (e) { avisar(e.message, { tipo: 'erro' }); } ctCarregarResumo(); } }), h('span', { text: 'NFC-e: um lançamento por dia e CFOP (em vez de um por nota)' })))
        : null,
      h('p', { class: 'meta', text: 'Total da nota = produtos − desconto + frete + seguro + outras + ST + IPI (o mesmo vNF da nota). Notas com mais de um CFOP são separadas pelos itens.' })));
    // Fiscal
    const ligadas = r.empresas.filter((e) => e.ativo && e.empresa_id);
    const p = ct.proc;
    out.push(cartao(topo('Notas do Appura (NF-e e NFC-e)', `Entradas e saídas já captadas. ${ligadas.length} empresa${ligadas.length === 1 ? '' : 's'} do Contábil estão na captação.`),
      ligadas.length ? h('div', { class: 'ac-pessoas' }, h('label', { class: 'marcar' }, h('input', { type: 'checkbox', checked: !p.empresas.size, onchange: () => { p.empresas = new Set(); ctRender(); } }), h('strong', { text: 'Todas' })),
        ...ligadas.map((e) => h('label', { class: 'marcar' }, h('input', { type: 'checkbox', checked: p.empresas.has(e.id), onchange: (ev) => { if (ev.currentTarget.checked) p.empresas.add(e.id); else p.empresas.delete(e.id); ctRender(); } }), h('span', { text: `${e.codigo_dominio} · ${e.razao_social}` }))))
        : h('p', { class: 'meta', text: 'Nenhuma empresa do Contábil ligada à captação. Cadastre em Empresas (ou "Trazer da captação").' }),
      h('div', { class: 'ct-linha' }, ...periodoCampos(p.periodo)),
      h('div', { class: 'gu-botoes' }, podeOp() && ligadas.length ? btn('Processar notas', async () => {
        try { const x = await chamar('/api/contabil/processar/fiscal', { method: 'POST', body: { empresas: [...p.empresas], inicio: p.periodo.inicio, fim: p.periodo.fim } }); p.acompanhando = x.processamento; p.ultimo = null; acompanhar(); } catch (e) { avisar(e.message, { tipo: 'erro' }); }
      }, 'botao primario pequeno') : null),
      p.acompanhando || p.ultimo ? h('div', { class: 'ct-resultado' }, h('span', { class: `selo ${ctTom(p.ultimo || { status: 'processando' })}`, text: p.ultimo ? (p.ultimo.status === 'concluido' ? 'Concluído' : p.ultimo.status === 'erro' ? 'Erro' : 'Processando') : 'Processando' }),
        h('span', { text: ctResumoProcessamento(p.ultimo || { status: 'processando' }) }),
        p.ultimo && (p.ultimo.sem_regra || p.ultimo.rejeitados) ? h('a', { href: '#/contabil/pendencias', class: 'botao pequeno' }, 'Ver pendências') : null,
        p.ultimo && (p.ultimo.resumo?.avisos || []).length ? h('ul', { class: 'ct-erros' }, ...p.ultimo.resumo.avisos.map((a) => h('li', { text: a }))) : null) : null));
    // Folha
    out.push(cartao(topo('Folha (planilha)', 'Enquanto a leitura direta do banco do Domínio não fica pronta: uma planilha com código da empresa (ou CNPJ), competência, rubrica, descrição e valor. A linha original fica guardada para auditoria.'),
      h('div', { class: 'gu-botoes' }, modelo('folha'), podeOp() ? btn('Enviar planilha da folha', async () => {
        escolherArquivo('.csv,.xlsx,.txt', async (f) => {
          try { const x = await enviarArquivo(`/api/contabil/processar/folha?nome=${encodeURIComponent(f.name)}`, f); ct.proc.ultimoFolha = x; avisar(`Folha: ${ctResumoProcessamento({ ...x, status: 'concluido' })}.`, { tipo: x.sem_regra || x.rejeitados ? 'erro' : 'ok' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); }
          ctRender();
        });
      }, 'botao primario pequeno') : null),
      ct.proc.ultimoFolha ? h('div', { class: 'ct-resultado' }, h('span', { class: `selo ${ctTom({ ...ct.proc.ultimoFolha, status: 'concluido' })}`, text: 'Último envio' }), h('span', { text: ctResumoProcessamento({ ...ct.proc.ultimoFolha, status: 'concluido' }) })) : null));
    return out;
  }

  async function acompanhar() {
    const id = ct.proc.acompanhando; if (!id) return;
    ctRender();
    for (let i = 0; i < 400 && ct.proc.acompanhando === id; i++) {
      await new Promise((r) => setTimeout(r, i < 5 ? 1500 : 4000));
      try {
        const l = (await chamar('/api/contabil/processamentos')).processamentos;
        const p = l.find((x) => Number(x.id) === Number(id));
        if (p && p.status !== 'processando') { ct.proc.ultimo = p; ct.proc.acompanhando = null; ctCarregarResumo(); return; }
      } catch { /* tenta de novo */ }
    }
  }

  /* ----- Pendências ----- */
  function ctPendencias() {
    const d = ct.dados.pendencias;
    const filtro = cartao(h('div', { class: 'ct-linha' },
      h('label', { class: 'campo' }, 'Empresa', h('select', { onchange: (ev) => { ct.pend.empresa = ev.currentTarget.value; ct.dados.pendencias = null; ctRender(); ctCarregarAba(); } },
        h('option', { value: '', text: 'Todas' }), ...empresasCtb().map((e) => h('option', { value: e.id, text: `${e.codigo_dominio} · ${e.razao_social}`, selected: e.id === ct.pend.empresa })))),
      podeOp() ? h('div', { class: 'gu-botoes' },
        btn('Reprocessar pendências', async () => { try { const r = await chamar('/api/contabil/reprocessar', { method: 'POST', body: { ctb_empresa_id: ct.pend.empresa || null } }); avisar(`Reprocessado: ${ctResumoProcessamento({ ...r, status: 'concluido' })}.`, { tipo: 'ok' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); } ctCarregarAba(); }, 'botao primario pequeno'),
        btn('Regerar tudo que não foi exportado', async () => {
          if (!window.confirm('Regera todos os lançamentos ainda não exportados com as regras atuais. Use depois de mudar uma regra. Continuar?')) return;
          try { const r = await chamar('/api/contabil/reprocessar', { method: 'POST', body: { tudo: true, ctb_empresa_id: ct.pend.empresa || null } }); avisar(`Regerado: ${ctResumoProcessamento({ ...r, status: 'concluido' })}.`, { tipo: 'ok' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); } ctCarregarAba();
        })) : null),
      h('p', { class: 'meta', text: 'Pendência de regra (CFOP, rubrica, conta) volta com "Reprocessar" depois de criar a regra. Pendência da fonte (valor não definido, nota sem itens) volta processando as notas de novo.' }));
    if (!d) return [filtro, carregando()];
    if (!d.total) return [filtro, h('div', { class: 'vg-vazio' }, h('strong', { text: 'Nenhuma pendência.' }), h('span', { text: 'Tudo o que foi processado virou lançamento.' }))];
    const criarRegra = (g) => {
      if (g.codigo === 'CFOP_SEM_REGRA') return () => { ct.regras.tipo = 'fiscal'; ct.regras.form = { cfop: g.detalhe, tipo_movimento: g.detalhe && /^[123]/.test(g.detalhe) ? 'ENTRADA' : 'SAIDA', historico: '' }; location.hash = '#/contabil/regras'; };
      if (g.codigo === 'RUBRICA_SEM_REGRA') return () => { ct.regras.tipo = 'folha'; const [rub, ...desc] = String(g.detalhe || '').split(' '); ct.regras.form = { rubrica: rub, descricao: desc.join(' '), historico: '' }; location.hash = '#/contabil/regras'; };
      return null;
    };
    return [filtro, cartao(topo(`${ctN(d.total)} registro${d.total === 1 ? '' : 's'} pendente${d.total === 1 ? '' : 's'}`, 'Agrupados por motivo. Nada aqui foi contabilizado.'),
      h('div', { class: 'rolagem' }, h('table', { class: 'notas' },
        h('thead', {}, h('tr', {}, ...['Motivo', 'Detalhe', 'Registros', 'Valor', 'Empresas', ''].map((t) => h('th', { text: t })))),
        h('tbody', {}, ...d.grupos.map((g) => { const acao = podeCfg() ? criarRegra(g) : null; return h('tr', {},
          h('td', {}, h('strong', { text: g.titulo })), h('td', { class: 'mono', text: g.detalhe || '—' }), h('td', { text: ctN(g.quantidade) }), h('td', { text: ctMoeda(g.valor) }),
          h('td', { text: `${g.empresas.slice(0, 3).join(', ')}${g.nEmpresas > 3 ? ` e mais ${g.nEmpresas - 3}` : ''}` }),
          h('td', {}, acao ? h('button', { type: 'button', class: 'botao pequeno', onclick: acao }, 'Criar regra') : null)); })))))];
  }

  /* ----- Lançamentos ----- */
  function ctLancamentos() {
    const l = ct.lanc; const d = ct.dados.lancamentos;
    const filtro = cartao(h('div', { class: 'ct-linha' },
      h('label', { class: 'campo' }, 'Empresa', h('select', { onchange: (ev) => { l.empresa = ev.currentTarget.value; l.pagina = 1; ct.dados.lancamentos = null; ctRender(); ctCarregarAba(); } },
        h('option', { value: '', text: '— escolha —' }), ...empresasCtb().map((e) => h('option', { value: e.id, text: `${e.codigo_dominio} · ${e.razao_social}`, selected: e.id === l.empresa })))),
      ...periodoCampos(l.periodo, () => { l.pagina = 1; ctCarregarAba(); })));
    if (!l.empresa) return [filtro, h('div', { class: 'vg-vazio' }, h('strong', { text: 'Escolha a empresa.' }), h('span', { text: 'Os lançamentos ficam guardados no Appura (livro contábil) e saem em planilha de conferência ou no arquivo do Domínio.' }))];
    if (!d) return [filtro, carregando()];
    const corpo = { ctb_empresa_id: l.empresa, inicio: l.periodo.inicio, fim: l.periodo.fim };
    const resumo = cartao(topo(`${ctN(d.quantidade)} lançamento${d.quantidade === 1 ? '' : 's'} · ${ctMoeda(d.total)}`,
      `Débitos ${ctMoeda(d.debitos)} = créditos ${ctMoeda(d.creditos)} · ${Object.entries(d.porOrigem).map(([o, x]) => `${o}: ${ctN(x.quantidade)}`).join(' · ') || 'sem lançamentos'} · ${ctN(d.exportados)} já exportado${d.exportados === 1 ? '' : 's'} ao Domínio`,
      h('span', { class: `selo ${d.pendencias ? 'atencao' : 'ok'}`, text: d.pendencias ? `${ctN(d.pendencias)} pendência${d.pendencias === 1 ? '' : 's'}` : 'Sem pendências' })),
      h('div', { class: 'gu-botoes' },
        btn('Planilha de conferência', async () => { try { await baixarPost('/api/contabil/arquivos', { ...corpo, tipo: 'conferencia_xlsx' }, 'conferencia.xlsx'); } catch (e) { avisar(e.message, { tipo: 'erro' }); } }),
        podeOp() ? btn('Arquivo do Domínio (teste)', async () => { try { await baixarPost('/api/contabil/arquivos', { ...corpo, tipo: 'dominio_txt' }, 'lancamentos_teste.txt'); } catch (e) { avisar(e.message, { tipo: 'erro' }); } }) : null,
        podeFechar() ? btn('Arquivo definitivo', async () => {
          if (!window.confirm('O arquivo definitivo trava os lançamentos exportados (não mudam mais ao reprocessar) e só sai sem pendências no período. Use depois de validar a planilha e o arquivo de teste no Domínio. Gerar?')) return;
          try { await baixarPost('/api/contabil/arquivos', { ...corpo, tipo: 'dominio_txt', definitivo: true }, 'lancamentos.txt'); avisar('Arquivo definitivo gerado. Importe no Domínio em Utilitários → Importação → Lançamentos.', { tipo: 'ok' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); }
          ctCarregarAba();
        }, 'botao primario pequeno') : null,
        podeOp() ? h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => { l.manual = !l.manual; ctRender(); } }, h('span', { text: l.manual ? 'Fechar lançamento manual' : 'Lançamento manual' })) : null));
    const manual = l.manual ? ctFormManual() : null;
    const tabela = cartao(h('div', { class: 'rolagem' }, h('table', { class: 'notas' },
      h('thead', {}, h('tr', {}, ...['Data', 'Débito', 'Crédito', 'Valor', 'Histórico', 'Origem', 'Documento', 'Regra', ''].map((t) => h('th', { text: t })))),
      h('tbody', {}, ...d.lancamentos.map((x) => h('tr', {},
        h('td', { text: ctData(x.data) }), h('td', { class: 'mono', text: x.conta_debito }), h('td', { class: 'mono', text: x.conta_credito }), h('td', { text: ctMoeda(x.valor) }),
        h('td', { text: x.historico }), h('td', { text: x.origem }), h('td', { text: x.documento || '—' }), h('td', { class: 'meta', text: x.regra || 'manual' }),
        h('td', {}, x.arquivo_id ? h('span', { class: 'selo-mini', text: 'exportado' }) : x.origem === 'manual' && podeOp() ? h('button', { type: 'button', class: 'botao pequeno perigo', onclick: async () => { if (!window.confirm('Excluir este lançamento manual?')) return; try { await chamar(`/api/contabil/lancamentos/${x.id}`, { method: 'DELETE' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); } ctCarregarAba(); } }, 'Excluir') : null)))))),
      d.quantidade > d.pagina * 500 || d.pagina > 1 ? h('div', { class: 'gu-botoes' },
        d.pagina > 1 ? h('button', { type: 'button', class: 'botao pequeno', onclick: () => { l.pagina--; ctCarregarAba(); } }, 'Anteriores') : null,
        h('span', { class: 'meta', text: `Página ${d.pagina} de ${Math.ceil(d.quantidade / 500)}` }),
        d.quantidade > d.pagina * 500 ? h('button', { type: 'button', class: 'botao pequeno', onclick: () => { l.pagina++; ctCarregarAba(); } }, 'Próximos') : null) : null);
    return [filtro, resumo, manual, tabela];
  }

  function ctFormManual() {
    const f = { data: ct.lanc.periodo.fim, conta_debito: '', conta_credito: '', valor: '', historico: '', documento: '' };
    const campo = (rot, k, tipo = 'text', extra = {}) => h('label', { class: 'campo' }, rot, h('input', { type: tipo, value: f[k], ...extra, oninput: (ev) => { f[k] = ev.currentTarget.value; } }));
    return cartao(topo('Lançamento manual', 'Vai para o livro desta empresa e sai no arquivo do Domínio como os demais. Conta conferida no plano de contas, se houver plano carregado.'),
      h('div', { class: 'ct-linha' }, campo('Data', 'data', 'date'), campo('Débito (código reduzido)', 'conta_debito', 'text', { inputmode: 'numeric', maxlength: '7' }), campo('Crédito (código reduzido)', 'conta_credito', 'text', { inputmode: 'numeric', maxlength: '7' }), campo('Valor', 'valor', 'text', { inputmode: 'decimal', placeholder: '0,00' })),
      campo('Histórico', 'historico', 'text', { maxlength: '400' }), campo('Documento (opcional)', 'documento', 'text', { maxlength: '60' }),
      h('div', { class: 'gu-botoes' }, btn('Gravar lançamento', async () => {
        try {
          await chamar('/api/contabil/lancamentos', { method: 'POST', body: { ...f, ctb_empresa_id: ct.lanc.empresa, valor: Number(String(f.valor).replace(/\./g, '').replace(',', '.')) } });
          avisar('Lançamento gravado.', { tipo: 'ok' }); ct.lanc.manual = false; ctCarregarAba();
        } catch (e) { avisar(e.message, { tipo: 'erro' }); }
      }, 'botao primario pequeno')));
  }

  /* ----- Regras ----- */
  function ctRegras() {
    const r = ct.regras; const d = ct.dados.regras;
    const fiscal = r.tipo === 'fiscal';
    const abas = h('div', { class: 'abas-tela', role: 'tablist' }, ...[['fiscal', 'Fiscal (por CFOP)'], ['folha', 'Folha (por rubrica)']].map(([id, nome]) => h('button', { type: 'button', role: 'tab', class: `aba-tela${id === r.tipo ? ' ativa' : ''}`, onclick: () => { r.tipo = id; r.form = null; ct.dados.regras = null; ctRender(); ctCarregarAba(); } }, nome)));
    const cab = cartao(topo('Tabela DE/PARA do Contábil', fiscal
      ? 'Para cada CFOP: conta de débito, conta de crédito e histórico. Regra de uma empresa vale antes da regra do regime, que vale antes da geral. Histórico aceita {numero}, {serie}, {participante}, {cfop}, {data}, {competencia}, {modelo} ({participante} vazio vira "Consumidor Final").'
      : 'Para cada rubrica da folha: conta de débito, conta de crédito e histórico. Histórico aceita {rubrica}, {descricao}, {competencia}. A data do lançamento é o último dia da competência.'),
      abas,
      podeCfg() ? h('div', { class: 'gu-botoes' }, h('button', { type: 'button', class: 'botao primario pequeno', onclick: () => { r.form = fiscal ? { cfop: '', tipo_movimento: '', historico: '' } : { rubrica: '', historico: '' }; ctRender(); } }, h('span', { text: 'Nova regra' })),
        btn('Importar planilha', async () => enviarPlanilha(`/api/contabil/regras/${r.tipo}/importar`, 'Regras')), modelo(fiscal ? 'regras_fiscais' : 'regras_folha')) : null);
    const out = [cab];
    if (r.form) out.push(ctFormRegra());
    out.push(relatorioEnvio());
    if (!d) { out.push(carregando()); return out; }
    if (!d.regras.length) { out.push(h('div', { class: 'vg-vazio' }, h('strong', { text: 'Nenhuma regra ainda.' }), h('span', { text: 'O Departamento Contábil preenche a tabela (aqui ou pela planilha modelo). Sem regra, o registro fica em Pendências.' }))); return out; }
    out.push(cartao(h('div', { class: 'rolagem' }, h('table', { class: 'notas' },
      h('thead', {}, h('tr', {}, ...(fiscal ? ['CFOP', 'Tipo', 'Escopo', 'Débito', 'Crédito', 'Histórico', 'Ativa', ''] : ['Rubrica', 'Descrição', 'Escopo', 'Débito', 'Crédito', 'Histórico', 'Ativa', '']).map((t) => h('th', { text: t })))),
      h('tbody', {}, ...d.regras.map((x) => h('tr', { class: x.ativo ? '' : 'desativado' },
        h('td', { class: 'mono', text: fiscal ? x.cfop : x.rubrica }), h('td', { text: fiscal ? x.tipo_movimento : x.descricao || '—' }),
        h('td', { text: x.ctb_empresa_id ? nomeEmp(x.ctb_empresa_id) : x.regime ? CT_REGIME[x.regime] : 'Todas' }),
        h('td', { class: 'mono', text: x.conta_debito }), h('td', { class: 'mono', text: x.conta_credito }), h('td', { text: x.historico }), h('td', { text: x.ativo ? 'Sim' : 'Não' }),
        h('td', {}, podeCfg() ? h('div', { class: 'gu-botoes' },
          h('button', { type: 'button', class: 'botao pequeno', onclick: () => { r.form = { ...x }; ctRender(); window.scrollTo(0, 0); } }, 'Editar'),
          h('button', { type: 'button', class: 'botao pequeno perigo', onclick: async () => { if (!window.confirm('Excluir a regra? Os lançamentos já gerados só mudam ao reprocessar.')) return; try { await chamar(`/api/contabil/regras/${r.tipo}/${x.id}`, { method: 'DELETE' }); } catch (e) { avisar(e.message, { tipo: 'erro' }); } ctCarregarAba(); } }, 'Excluir')) : null))))))));
    return out;
  }

  function ctFormRegra() {
    const r = ct.regras; const f = r.form; const fiscal = r.tipo === 'fiscal';
    const campo = (rot, k, extra = {}) => h('label', { class: 'campo' }, rot, h('input', { type: 'text', value: f[k] ?? '', ...extra, oninput: (ev) => { f[k] = ev.currentTarget.value; } }));
    const escopo = h('label', { class: 'campo' }, 'Vale para', h('select', { onchange: (ev) => { const v = ev.currentTarget.value; f.ctb_empresa_id = v.startsWith('e:') ? v.slice(2) : null; f.regime = v.startsWith('r:') ? v.slice(2) : null; } },
      h('option', { value: '', text: 'Todas as empresas', selected: !f.ctb_empresa_id && !f.regime }),
      ...(fiscal ? Object.entries(CT_REGIME).map(([k, v]) => h('option', { value: `r:${k}`, text: `Regime: ${v}`, selected: f.regime === k && !f.ctb_empresa_id })) : []),
      ...empresasCtb().map((e) => h('option', { value: `e:${e.id}`, text: `Só ${e.codigo_dominio} · ${e.razao_social}`, selected: f.ctb_empresa_id === e.id }))));
    return cartao(topo(f.id ? 'Editar regra' : 'Nova regra', null),
      h('div', { class: 'ct-linha' }, fiscal ? campo('CFOP', 'cfop', { maxlength: '4', inputmode: 'numeric' }) : campo('Rubrica', 'rubrica', { maxlength: '20' }),
        fiscal ? campo('Tipo de movimento', 'tipo_movimento', { placeholder: 'SAIDA, ENTRADA, DEVOLUCAO…' }) : campo('Descrição', 'descricao'), escopo),
      h('div', { class: 'ct-linha' }, campo('Conta de débito (código reduzido)', 'conta_debito', { maxlength: '7', inputmode: 'numeric' }), campo('Conta de crédito (código reduzido)', 'conta_credito', { maxlength: '7', inputmode: 'numeric' }), campo('Código do histórico no Domínio (opcional)', 'historico_codigo', { maxlength: '7', inputmode: 'numeric' })),
      campo('Histórico', 'historico', { placeholder: fiscal ? 'Venda conforme NF {numero} – {participante}' : 'Provisão de salários – competência {competencia}' }),
      h('div', { class: 'ct-linha' },
        fiscal ? h('label', { class: 'marcar' }, h('input', { type: 'checkbox', checked: !!f.regra_inversao, onchange: (ev) => { f.regra_inversao = ev.currentTarget.checked; } }), h('span', { text: 'Regra de inversão (devolução)' })) : null,
        h('label', { class: 'marcar' }, h('input', { type: 'checkbox', checked: f.ativo !== false, onchange: (ev) => { f.ativo = ev.currentTarget.checked; } }), h('span', { text: 'Ativa' }))),
      h('div', { class: 'gaveta-acoes' },
        h('button', { type: 'button', class: 'botao fantasma', onclick: () => { r.form = null; ctRender(); } }, 'Cancelar'),
        btn('Salvar regra', async () => {
          try {
            await chamar(f.id ? `/api/contabil/regras/${r.tipo}/${f.id}` : `/api/contabil/regras/${r.tipo}`, { method: f.id ? 'PATCH' : 'POST', body: f });
            avisar('Regra salva. Use "Reprocessar pendências" para aplicar.', { tipo: 'ok' }); r.form = null; ctCarregarAba();
          } catch (e) { avisar(e.message, { tipo: 'erro' }); }
        }, 'botao primario')));
  }

  /* ----- Empresas ----- */
  function ctEmpresas() {
    const e = ct.emp; const lista = empresasCtb().filter((x) => !e.busca || `${x.codigo_dominio} ${x.cnpj} ${x.razao_social}`.toLowerCase().includes(e.busca.toLowerCase()));
    const out = [cartao(topo('Tabela mestre de empresas', 'Código no Domínio, CNPJ completo (cada filial é uma empresa), regime e os períodos a escriturar. Nenhum lançamento é gerado sem a empresa identificada aqui.'),
      podeCfg() ? h('div', { class: 'gu-botoes' },
        h('button', { type: 'button', class: 'botao primario pequeno', onclick: () => { e.form = { codigo_dominio: '', cnpj: '', razao_social: '', regime: '', ambiente: 'dominio_novo' }; ctRender(); } }, h('span', { text: 'Nova empresa' })),
        btn('Importar relação (planilha)', async () => enviarPlanilha('/api/contabil/empresas/importar', 'Empresas')), modelo('empresas'),
        btn('Trazer da captação', async () => {
          try { const r = await chamar('/api/contabil/empresas/do-appura', { method: 'POST' }); avisar(`${r.criadas} empresa(s) criada(s).${r.semCodigo.length ? ` ${r.semCodigo.length} sem código do Domínio no cadastro (campo "código ERP").` : ''}`, { tipo: 'ok' }); } catch (x) { avisar(x.message, { tipo: 'erro' }); }
          ctCarregarResumo();
        })) : null,
      h('input', { type: 'search', class: 'cl-busca', placeholder: 'Buscar por código, CNPJ ou razão social', value: e.busca, oninput: (ev) => { e.busca = ev.currentTarget.value; ctRender(); const b = $('ct-conteudo').querySelector('input[type=search]'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }))];
    if (e.form) out.push(ctFormEmpresa());
    out.push(relatorioEnvio());
    if (!lista.length) { out.push(h('div', { class: 'vg-vazio' }, h('strong', { text: 'Nenhuma empresa no Contábil.' }), h('span', { text: 'Importe a relação de empresas do Contábil (código do Domínio, CNPJ, períodos) ou traga as da captação.' }))); return out; }
    out.push(cartao(h('div', { class: 'rolagem' }, h('table', { class: 'notas' },
      h('thead', {}, h('tr', {}, ...['Código', 'Empresa', 'CNPJ', 'Regime', 'Ambiente', 'Períodos a escriturar', 'Captação', 'Lançamentos', 'Pendências', ''].map((t) => h('th', { text: t })))),
      h('tbody', {}, ...lista.map((x) => h('tr', { class: x.ativo ? '' : 'desativado' },
        h('td', { class: 'mono', text: x.codigo_dominio }), h('td', { text: x.razao_social }), h('td', { class: 'mono', text: formatarCnpj(x.cnpj) }), h('td', { text: CT_REGIME[x.regime] || '—' }),
        h('td', { text: x.ambiente === 'dominio_antigo' ? 'Domínio antigo' : 'Domínio novo' }),
        h('td', { text: x.periodos.map((p) => `${ctData(p.inicio)} a ${ctData(p.fim)}${p.fonte ? ` (${p.fonte})` : ''}`).join('; ') || '—' }),
        h('td', { text: x.empresa_id ? 'Sim' : 'Não' }), h('td', { text: ctN(x.lancamentos) }), h('td', {}, x.pendencias ? h('a', { href: '#/contabil/pendencias', onclick: () => { ct.pend.empresa = x.id; ct.dados.pendencias = null; } }, ctN(x.pendencias)) : '0'),
        h('td', {}, podeCfg() ? h('button', { type: 'button', class: 'botao pequeno', onclick: () => { e.form = { ...x }; ctRender(); window.scrollTo(0, 0); } }, 'Editar') : null))))))));
    return out;
  }

  function ctFormEmpresa() {
    const f = ct.emp.form;
    const campo = (rot, k, extra = {}) => h('label', { class: 'campo' }, rot, h('input', { type: 'text', value: f[k] ?? '', ...extra, oninput: (ev) => { f[k] = ev.currentTarget.value; } }));
    return cartao(topo(f.id ? 'Editar empresa' : 'Nova empresa', null),
      h('div', { class: 'ct-linha' }, campo('Código no Domínio', 'codigo_dominio', { maxlength: '7', inputmode: 'numeric' }), campo('CNPJ completo', 'cnpj', { maxlength: '18' }), campo('Razão social', 'razao_social')),
      h('div', { class: 'ct-linha' },
        h('label', { class: 'campo' }, 'Regime', h('select', { onchange: (ev) => { f.regime = ev.currentTarget.value; } }, h('option', { value: '', text: '—' }), ...Object.entries(CT_REGIME).map(([k, v]) => h('option', { value: k, text: v, selected: f.regime === k })))),
        h('label', { class: 'campo' }, 'Ambiente', h('select', { onchange: (ev) => { f.ambiente = ev.currentTarget.value; } }, h('option', { value: 'dominio_novo', text: 'Domínio novo', selected: f.ambiente !== 'dominio_antigo' }), h('option', { value: 'dominio_antigo', text: 'Domínio antigo', selected: f.ambiente === 'dominio_antigo' }))),
        h('label', { class: 'campo' }, 'Plano de contas', h('select', { onchange: (ev) => { f.plano_id = ev.currentTarget.value || null; } }, h('option', { value: '', text: 'Plano padrão do escritório' }), ...(ct.resumo.planos || []).map((p) => h('option', { value: p.id, text: p.nome, selected: f.plano_id === p.id })))),
        h('label', { class: 'marcar' }, h('input', { type: 'checkbox', checked: f.ativo !== false, onchange: (ev) => { f.ativo = ev.currentTarget.checked; } }), h('span', { text: 'Ativa' }))),
      h('div', { class: 'gaveta-acoes' },
        h('button', { type: 'button', class: 'botao fantasma', onclick: () => { ct.emp.form = null; ctRender(); } }, 'Cancelar'),
        btn('Salvar empresa', async () => { try { await chamar('/api/contabil/empresas', { method: 'POST', body: f }); avisar('Empresa salva.', { tipo: 'ok' }); ct.emp.form = null; await ctCarregarResumo(); } catch (e) { avisar(e.message, { tipo: 'erro' }); } }, 'botao primario')));
  }

  /* ----- Plano de contas ----- */
  function ctPlano() {
    const pl = ct.plano; const planos = ct.resumo.planos || [];
    if (!pl.planoId && planos.length) { pl.planoId = (planos.find((p) => p.padrao) || planos[0]).id; setTimeout(ctCarregarAba); }
    const out = [cartao(topo('Plano de contas', 'O plano do Domínio novo, guardado no Appura: as regras são conferidas nele (conta precisa existir e ser analítica). Importe a planilha com código reduzido, classificação, descrição e, se tiver, tipo (S/A) e natureza.'),
      podeCfg() ? h('div', { class: 'gu-botoes' }, btn('Importar plano (planilha)', async () => {
        const nome = window.prompt('Nome do plano (importar com o mesmo nome substitui as contas):', (planos.find((p) => p.id === pl.planoId) || {}).nome || 'Plano padrão Domínio novo');
        if (!nome) return;
        const padrao = window.confirm('Marcar como plano padrão do escritório (vale para todas as empresas sem plano próprio)?');
        enviarPlanilha(`/api/contabil/planos/importar?plano=${encodeURIComponent(nome)}&padrao=${padrao ? 1 : 0}`, 'Plano de contas', () => { pl.planoId = ''; });
      }, 'botao primario pequeno'), modelo('plano')) : null)];
    out.push(relatorioEnvio());
    if (!planos.length) { out.push(h('div', { class: 'vg-vazio' }, h('strong', { text: 'Nenhum plano carregado.' }), h('span', { text: 'Sem plano, o Appura não confere as contas das regras (o Domínio confere na importação).' }))); return out; }
    out.push(cartao(h('div', { class: 'ct-linha' },
      h('label', { class: 'campo' }, 'Plano', h('select', { onchange: (ev) => { pl.planoId = ev.currentTarget.value; pl.contas = null; ctCarregarAba(); } }, ...planos.map((p) => h('option', { value: p.id, text: `${p.nome}${p.padrao ? ' (padrão)' : ''} · ${ctN(p.contas)} contas`, selected: p.id === pl.planoId })))),
      h('label', { class: 'campo' }, 'Buscar', h('input', { type: 'search', value: pl.busca, placeholder: 'Código, classificação ou nome', onchange: (ev) => { pl.busca = ev.currentTarget.value; ctCarregarAba(); } }))),
      !pl.contas ? h('div', { class: 'vg-skel', 'aria-hidden': 'true' }) : h('div', { class: 'rolagem' }, h('table', { class: 'notas' },
        h('thead', {}, h('tr', {}, ...['Classificação', 'Código', 'Descrição', 'Tipo', 'Natureza'].map((t) => h('th', { text: t })))),
        h('tbody', {}, ...pl.contas.map((c) => h('tr', {}, h('td', { class: 'mono', text: c.classificacao }), h('td', { class: 'mono', text: c.codigo }),
          h('td', {}, c.tipo === 'S' ? h('strong', { text: c.descricao }) : c.descricao), h('td', { text: c.tipo === 'S' ? 'Sintética' : 'Analítica' }), h('td', { text: c.natureza || '—' })))))),
      pl.contas && pl.contas.length >= 2000 ? h('p', { class: 'meta', text: 'Mostrando 2.000 contas: use a busca.' }) : null));
    return out;
  }

  /* ----- Histórico ----- */
  function ctHistorico() {
    const d = ct.dados.historico;
    if (!d) return [carregando()];
    return [
      cartao(topo('Processamentos', 'Cada execução fica registrada: quem, quando, a fonte, o período e o resultado.'),
        d.processamentos.length ? h('div', { class: 'rolagem' }, h('table', { class: 'notas' },
          h('thead', {}, h('tr', {}, ...['Quando', 'Quem', 'Origem', 'Fonte', 'Período', 'Resultado'].map((t) => h('th', { text: t })))),
          h('tbody', {}, ...d.processamentos.map((p) => h('tr', {},
            h('td', { text: new Date(p.iniciado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) }), h('td', { text: p.usuario }), h('td', { text: p.origem }), h('td', { text: p.fonte }),
            h('td', { text: p.periodo_inicio ? `${ctData(p.periodo_inicio)} a ${ctData(p.periodo_fim)}` : '—' }),
            h('td', {}, h('span', { class: `selo ${ctTom(p)}`, text: p.status === 'concluido' ? 'Concluído' : p.status === 'erro' ? 'Erro' : 'Processando' }), ' ', ctResumoProcessamento(p))))))) : h('p', { class: 'meta', text: 'Nenhum processamento ainda.' })),
      cartao(topo('Arquivos gerados', 'Planilhas de conferência e arquivos do Domínio. O definitivo trava os lançamentos exportados.'),
        d.arquivos.length ? h('div', { class: 'rolagem' }, h('table', { class: 'notas' },
          h('thead', {}, h('tr', {}, ...['Quando', 'Empresa', 'Arquivo', 'Lançamentos', 'Total', 'Tipo', ''].map((t) => h('th', { text: t })))),
          h('tbody', {}, ...d.arquivos.map((a) => h('tr', {},
            h('td', { text: new Date(a.criado_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) }), h('td', { text: nomeEmp(a.ctb_empresa_id) }), h('td', { class: 'mono', text: a.nome }),
            h('td', { text: ctN(a.lancamentos) }), h('td', { text: ctMoeda(a.total) }),
            h('td', {}, h('span', { class: `selo ${a.definitivo ? 'ok' : 'neutro'}`, text: a.tipo === 'conferencia_xlsx' ? 'Conferência' : a.definitivo ? 'Domínio (definitivo)' : 'Domínio (teste)' })),
            h('td', {}, a.tipo === 'dominio_txt' ? h('button', { type: 'button', class: 'botao pequeno', onclick: () => baixarArquivo(`/api/contabil/arquivos/${a.id}/baixar`, a.nome).catch((e) => avisar(e.message, { tipo: 'erro' })) }, 'Baixar') : null)))))) : h('p', { class: 'meta', text: 'Nenhum arquivo gerado ainda.' })),
    ];
  }

  window.ctMostrar = ctMostrar;
}
