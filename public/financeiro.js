'use strict';
/*
 * Financeiro do escritório (#/financeiro/<aba>): resumo do mês (previsto, recebido, em aberto, inadimplência),
 * cobranças (gerar as do mês, avulsa, baixa, cancelar) e contratos de honorários.
 * Não emite boleto/PIX: controla as cobranças e os recebimentos.
 * Usa o kit de escritorio.js (window.esKit) e os utilitários globais do app.js.
 */

/* ---------- funções puras (testadas em test/escritorio-tela.test.ts) ---------- */
const FN_SITUACAO = { aberto: { texto: 'Em aberto', tom: 'info' }, atrasado: { texto: 'Atrasado', tom: 'problema' }, pago: { texto: 'Pago', tom: 'ok' }, cancelado: { texto: 'Cancelado', tom: 'neutro' } };
const FN_FORMA = { pix: 'PIX', boleto: 'Boleto', transferencia: 'Transferência', dinheiro: 'Dinheiro', cartao: 'Cartão', outro: 'Outro' };
/** Percentual recebido do previsto (0 a 100, uma casa). */
const fnPercentual = (recebido, previsto) => (previsto > 0 ? Math.min(100, Math.round((recebido / previsto) * 1000) / 10) : 0);
/** Dias de atraso de um vencimento em relação a hoje (AAAA-MM-DD). */
const fnDiasAtraso = (venc, hoje) => Math.max(0, Math.round((Date.parse(`${hoje}T12:00:00Z`) - Date.parse(`${venc}T12:00:00Z`)) / 86400000));

if (typeof module !== 'undefined') module.exports = { FN_SITUACAO, FN_FORMA, fnPercentual, fnDiasAtraso };

if (typeof window !== 'undefined') {
  const kit = window.esKit;
  const fn = { aba: 'resumo', resumo: null, erro: null, titulos: null, contratos: null, filtro: { status: '', empresa: '' }, form: null, baixa: null };
  const ABAS = [['resumo', 'Resumo do mês'], ['cobrancas', 'Cobranças'], ['contratos', 'Contratos']];
  const podeOp = () => !!(fn.resumo && fn.resumo.pode.operar);
  const podeCfg = () => !!(fn.resumo && fn.resumo.pode.configurar);
  const hoje = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  let lista = [];

  async function fnMostrar(rota) {
    fn.aba = rota.aba || 'resumo'; fn.form = null; fn.baixa = null;
    $('tela-financeiro').hidden = false; window.scrollTo(0, 0);
    kit.abas('fn-abas', ABAS, fn.aba, '#/financeiro');
    lista = await kit.empresas();
    await fnCarregar();
  }
  async function fnCarregar() {
    const mes = kit.mes();
    try {
      fn.resumo = await chamar(`/api/financeiro/resumo?mes=${mes}`); fn.erro = null;
      if (fn.aba === 'cobrancas') fn.titulos = (await chamar(`/api/financeiro/titulos?${fn.filtro.status === 'atrasado' ? '' : `mes=${mes}&`}status=${fn.filtro.status}&empresa=${fn.filtro.empresa}`)).titulos;
      if (fn.aba === 'contratos') fn.contratos = (await chamar('/api/financeiro/contratos')).contratos;
    } catch (e) { fn.erro = e.message; }
    fnRender();
  }

  function fnRender() {
    if ($('tela-financeiro').hidden) return;
    $('fn-acoes').replaceChildren(...[
      podeOp() ? kit.btn(`Gerar cobranças de ${kit.textoMes(kit.mes())}`, async () => {
        const r = await chamar('/api/financeiro/gerar', { method: 'POST', body: { mes: kit.mes() } });
        avisar(r.geradas ? `${esN(r.geradas)} cobrança(s) gerada(s)${r.jaExistiam ? ` · ${esN(r.jaExistiam)} já existiam` : ''}.` : `Nenhuma cobrança nova: ${esN(r.jaExistiam)} já existiam para os contratos vigentes.`, { tipo: 'ok' });
        await fnCarregar();
      }, 'botao primario pequeno') : null,
      podeOp() ? h('button', { type: 'button', class: 'botao pequeno', onclick: () => { fn.form = { tipo: 'avulsa', empresa_id: '', descricao: '', valor: '', vencimento: hoje(), observacao: '' }; if (fn.aba !== 'cobrancas') location.hash = '#/financeiro/cobrancas'; else fnRender(); } }, h('span', { text: 'Cobrança avulsa' })) : null,
    ].filter(Boolean));
    const alvo = $('fn-conteudo');
    if (fn.erro && !fn.resumo) return alvo.replaceChildren(kit.erro('Não foi possível abrir o Financeiro.', fn.erro));
    if (!fn.resumo) return alvo.replaceChildren(kit.carregando());
    const corpo = fn.aba === 'cobrancas' ? fnCobrancas() : fn.aba === 'contratos' ? fnContratos() : fnResumo();
    alvo.replaceChildren(...(fn.erro ? [kit.erro('Algo deu errado.', fn.erro)] : []), ...[].concat(corpo).filter(Boolean));
  }

  /* ----- Resumo ----- */
  function fnResumo() {
    const r = fn.resumo;
    const pct = fnPercentual(r.recebido, r.previsto);
    return [kit.kpis([
      { rotulo: 'Previsto no mês', valor: esMoeda(r.previsto), icone: 'calendar', meta: `${kit.textoMes(r.mes)} · ${esN(r.contratosAtivos)} contrato(s) vigente(s)` },
      { rotulo: 'Recebido', valor: esMoeda(r.recebido), tom: 'ok', icone: 'check', meta: `${pct.toLocaleString('pt-BR')}% do previsto` },
      { rotulo: 'Em aberto no mês', valor: esMoeda(r.emAberto), tom: r.emAberto ? 'atencao' : 'ok', icone: 'clock-alert' },
      { rotulo: 'Atrasado (todos os meses)', valor: esMoeda(r.atrasadoTotal), tom: r.atrasadoTotal ? 'problema' : 'ok', icone: 'triangle-alert', meta: `${esN(r.inadimplentes.length)} cliente(s)` },
    ]),
    kit.cartao(kit.topo('Inadimplência', 'Clientes com cobrança vencida e não paga, do maior valor para o menor.'),
      r.inadimplentes.length ? kit.tabela(['Cliente', { texto: 'Cobranças', classe: 'num' }, { texto: 'Valor', classe: 'num' }, 'Mais antiga', ''], r.inadimplentes.map((c) => h('tr', {},
        h('td', {}, h('strong', { text: c.empresa })), h('td', { class: 'num', text: esN(c.titulos) }), h('td', { class: 'num', text: esMoeda(c.valor) }),
        h('td', {}, esData(c.maisAntigo), h('span', { class: 'sub', text: `${esN(fnDiasAtraso(c.maisAntigo, hoje()))} dia(s) de atraso` })),
        h('td', {}, h('button', { type: 'button', class: 'botao pequeno', onclick: () => { fn.filtro = { status: 'atrasado', empresa: c.empresa_id }; location.hash = '#/financeiro/cobrancas'; } }, 'Ver cobranças'))))) : kit.vazio('Nenhum cliente em atraso.'))];
  }

  /* ----- Cobranças ----- */
  function fnCobrancas() {
    const out = [];
    if (fn.form?.tipo === 'avulsa') out.push(fnFormAvulsa());
    out.push(kit.cartao(kit.linha(
      kit.campo('Situação', fn.filtro, 'status', 'select', { onchange: (ev) => { fn.filtro.status = ev.currentTarget.value; fn.titulos = null; fnRender(); fnCarregar(); } }, [['', 'Todas do mês'], ['aberto', 'Em aberto (mês)'], ['atrasado', 'Atrasadas (todos os meses)'], ['pago', 'Pagas (mês)'], ['cancelado', 'Canceladas (mês)']]),
      kit.campo('Cliente', fn.filtro, 'empresa', 'select', { onchange: (ev) => { fn.filtro.empresa = ev.currentTarget.value; fn.titulos = null; fnRender(); fnCarregar(); } }, kit.opcoesEmpresa(lista, 'Todos'))),
      h('p', { class: 'meta', text: `Vencimentos em ${kit.textoMes(kit.mes())} (o mês do topo), exceto "Atrasadas", que mostra todas as vencidas e não pagas.` })));
    if (!fn.titulos) { out.push(kit.carregando()); return out; }
    if (!fn.titulos.length) { out.push(kit.vazio('Nenhuma cobrança neste filtro.', podeOp() ? 'Use "Gerar cobranças" para criar as do mês a partir dos contratos.' : null)); return out; }
    const total = fn.titulos.reduce((t, x) => t + (x.status === 'cancelado' ? 0 : x.valor), 0);
    out.push(kit.cartao(kit.topo(`${esN(fn.titulos.length)} cobrança(s) · ${esMoeda(total)}`, null),
      kit.tabela(['Cliente', 'Descrição', 'Vencimento', { texto: 'Valor', classe: 'num' }, 'Situação', 'Pagamento', ''], fn.titulos.flatMap((t) => {
        const s = FN_SITUACAO[t.situacao] || FN_SITUACAO.aberto;
        const tr = h('tr', { class: t.status === 'cancelado' ? 'desativado' : '' },
          h('td', {}, h('strong', { text: t.empresa })), h('td', {}, t.descricao, t.contrato_id ? null : h('span', { class: 'sub', text: 'avulsa' })),
          h('td', {}, esData(t.vencimento), t.situacao === 'atrasado' ? h('span', { class: 'sub', text: `${esN(fnDiasAtraso(t.vencimento, hoje()))} dia(s)` }) : null),
          h('td', { class: 'num', text: esMoeda(t.valor) }), h('td', {}, kit.selo(s.texto, s.tom)),
          h('td', { text: t.status === 'pago' ? `${esData(t.pago_em)} · ${esMoeda(t.valor_pago)} · ${FN_FORMA[t.forma] || t.forma || ''}` : '—' }),
          h('td', {}, podeOp() ? kit.botoes(
            t.status === 'aberto' ? h('button', { type: 'button', class: 'botao pequeno primario', onclick: () => { fn.baixa = { id: t.id, pago_em: hoje(), valor_pago: String(t.valor).replace('.', ','), forma: 'pix', observacao: '' }; fnRender(); } }, 'Receber') : null,
            t.status === 'aberto' ? kit.btn('Cancelar', async () => { if (!kit.confirmar(`Cancelar a cobrança "${t.descricao}" de ${t.empresa}?`)) return; await chamar(`/api/financeiro/titulos/${t.id}/status`, { method: 'POST', body: { status: 'cancelado' } }); await fnCarregar(); }, 'botao pequeno perigo') : null,
            t.status !== 'aberto' ? kit.btn('Reabrir', async () => { if (!kit.confirmar(t.status === 'pago' ? 'Reabrir apaga a baixa (data, valor e forma do pagamento). Continuar?' : 'Reabrir esta cobrança?')) return; await chamar(`/api/financeiro/titulos/${t.id}/status`, { method: 'POST', body: { status: 'aberto' } }); await fnCarregar(); }, 'botao pequeno fantasma') : null) : null));
        return fn.baixa?.id === t.id ? [tr, h('tr', {}, h('td', { colspan: '7' }, fnFormBaixa()))] : [tr];
      }))));
    return out;
  }
  function fnFormBaixa() {
    const f = fn.baixa;
    return h('div', { class: 'pilha' },
      kit.linha(kit.campo('Pago em', f, 'pago_em', 'date'), kit.campo('Valor pago', f, 'valor_pago', 'text', { inputmode: 'decimal' }), kit.campo('Forma', f, 'forma', 'select', {}, Object.entries(FN_FORMA)), kit.campo('Observação', f, 'observacao', 'text', { maxlength: '500' })),
      kit.acoesForm(() => { fn.baixa = null; fnRender(); }, async () => {
        const v = esNumero(f.valor_pago);
        if (!(v > 0)) throw new Error('Valor pago inválido.');
        await chamar(`/api/financeiro/titulos/${f.id}/baixa`, { method: 'POST', body: { ...f, valor_pago: v } });
        avisar('Recebimento registrado.', { tipo: 'ok' }); fn.baixa = null; await fnCarregar();
      }, 'Registrar recebimento'));
  }
  function fnFormAvulsa() {
    const f = fn.form;
    return kit.cartao(kit.topo('Cobrança avulsa', 'Serviço fora do contrato: abertura de empresa, IRPF, certidão, alteração contratual…'),
      kit.linha(kit.campo('Cliente', f, 'empresa_id', 'select', {}, kit.opcoesEmpresa(lista)), kit.campo('Descrição', f, 'descricao', 'text', { maxlength: '200' })),
      kit.linha(kit.campo('Valor', f, 'valor', 'text', { inputmode: 'decimal', placeholder: '0,00' }), kit.campo('Vencimento', f, 'vencimento', 'date'), kit.campo('Observação', f, 'observacao', 'text', { maxlength: '500' })),
      kit.acoesForm(() => { fn.form = null; fnRender(); }, async () => {
        await chamar('/api/financeiro/titulos', { method: 'POST', body: { ...f, valor: esNumero(f.valor) } });
        avisar('Cobrança criada.', { tipo: 'ok' }); fn.form = null; await fnCarregar();
      }, 'Criar cobrança'));
  }

  /* ----- Contratos ----- */
  function fnContratos() {
    const out = [kit.cartao(kit.topo('Contratos de honorários', 'Um contrato por serviço mensal do cliente. As cobranças do mês saem dos contratos vigentes (sem duplicar).',
      podeCfg() ? h('button', { type: 'button', class: 'botao primario pequeno', onclick: () => { fn.form = { tipo: 'contrato', empresa_id: '', descricao: 'Honorários mensais', valor_mensal: '', dia_vencimento: 10, inicio: `${kit.mes()}-01`, fim: '', indice_reajuste: '', mes_reajuste: '', ativo: true, observacao: '' }; fnRender(); } }, h('span', { text: 'Novo contrato' })) : null))];
    if (fn.form?.tipo === 'contrato') out.push(fnFormContrato());
    if (!fn.contratos) { out.push(kit.carregando()); return out; }
    if (!fn.contratos.length) { out.push(kit.vazio('Nenhum contrato cadastrado.')); return out; }
    const vigentes = fn.contratos.filter((c) => c.ativo && (!c.fim || c.fim >= hoje()));
    out.push(kit.cartao(kit.topo(`${esN(vigentes.length)} contrato(s) vigente(s) · ${esMoeda(vigentes.reduce((t, c) => t + c.valor_mensal, 0))} por mês`, null),
      kit.tabela(['Cliente', 'Descrição', { texto: 'Valor mensal', classe: 'num' }, 'Vencimento', 'Vigência', 'Reajuste', ''], fn.contratos.map((c) => h('tr', { class: c.ativo ? '' : 'desativado' },
        h('td', {}, h('strong', { text: c.empresa }), h('span', { class: 'sub', text: formatarCnpj(c.cnpj) })), h('td', { text: c.descricao }),
        h('td', { class: 'num', text: esMoeda(c.valor_mensal) }), h('td', { text: `dia ${c.dia_vencimento}` }),
        h('td', { text: `${esData(c.inicio)} a ${c.fim ? esData(c.fim) : 'indeterminado'}` }),
        h('td', { text: c.indice_reajuste ? `${c.indice_reajuste}${c.mes_reajuste ? ` · mês ${c.mes_reajuste}` : ''}` : '—' }),
        h('td', {}, podeCfg() ? h('button', { type: 'button', class: 'botao pequeno', onclick: () => { fn.form = { tipo: 'contrato', ...c, valor_mensal: String(c.valor_mensal).replace('.', ','), fim: c.fim ?? '', indice_reajuste: c.indice_reajuste ?? '', mes_reajuste: c.mes_reajuste ?? '', observacao: c.observacao ?? '' }; fnRender(); window.scrollTo(0, 0); } }, 'Editar') : null))))));
    return out;
  }
  function fnFormContrato() {
    const f = fn.form;
    return kit.cartao(kit.topo(f.id ? 'Editar contrato' : 'Novo contrato', 'Mudar o valor vale para as próximas cobranças geradas; as já geradas não mudam.'),
      kit.linha(kit.campo('Cliente', f, 'empresa_id', 'select', f.id ? { disabled: true } : {}, kit.opcoesEmpresa(lista)), kit.campo('Descrição', f, 'descricao', 'text', { maxlength: '200' })),
      kit.linha(kit.campo('Valor mensal', f, 'valor_mensal', 'text', { inputmode: 'decimal', placeholder: '0,00' }), kit.campo('Dia de vencimento (1 a 28)', f, 'dia_vencimento', 'number', { min: '1', max: '28' }), kit.campo('Início', f, 'inicio', 'date'), kit.campo('Fim (opcional)', f, 'fim', 'date')),
      kit.linha(kit.campo('Índice de reajuste', f, 'indice_reajuste', 'text', { maxlength: '40', placeholder: 'IGP-M, IPCA, salário mínimo…' }), kit.campo('Mês do reajuste', f, 'mes_reajuste', 'select', {}, [['', '—'], ...Array.from({ length: 12 }, (_, i) => [i + 1, MESES[i]])]), kit.marcar('Ativo', f, 'ativo')),
      kit.campo('Observação', f, 'observacao', 'text', { maxlength: '1000' }),
      kit.acoesForm(() => { fn.form = null; fnRender(); }, async () => {
        await chamar('/api/financeiro/contratos', { method: 'POST', body: { ...f, valor_mensal: esNumero(f.valor_mensal), dia_vencimento: Number(f.dia_vencimento), mes_reajuste: f.mes_reajuste ? Number(f.mes_reajuste) : null } });
        avisar('Contrato salvo.', { tipo: 'ok' }); fn.form = null; await fnCarregar();
      }, 'Salvar contrato'));
  }

  kit.aoMudarMes('tela-financeiro', fnCarregar);
  window.fnMostrar = fnMostrar;
}
