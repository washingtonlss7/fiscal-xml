'use strict';
/*
 * Folha (#/folha): acompanhamento do mês por empresa (etapas: folha fechada, eSocial, DCTFWeb, FGTS Digital, guias ao
 * cliente, contabilizada) e as rubricas que vieram para o Contábil. O cálculo da folha continua no sistema de folha.
 * Usa o kit de escritorio.js (window.esKit) e os utilitários globais do app.js.
 */

/* ---------- funções puras (testadas em test/escritorio-tela.test.ts) ---------- */
const FO_STATUS = { pendente: { texto: 'Pendente', tom: 'pendente', marca: '○' }, feito: { texto: 'Feito', tom: 'ok', marca: '✓' }, nao_se_aplica: { texto: 'Não se aplica', tom: 'neutro', marca: '—' } };
/** Próxima situação ao clicar: pendente → feito → não se aplica → pendente. */
const foProximo = (s) => ({ pendente: 'feito', feito: 'nao_se_aplica', nao_se_aplica: 'pendente' }[s] || 'feito');
/** Filtra as linhas do painel: todas, pendentes (falta etapa) ou concluídas. */
function foFiltrar(linhas, filtro, busca = '') {
  const b = busca.trim().toLowerCase();
  return linhas.filter((l) => (filtro === 'pendentes' ? l.feitas < l.total : filtro === 'concluidas' ? l.feitas === l.total : true)
    && (!b || `${l.empresa.razao_social} ${l.empresa.cnpj}`.toLowerCase().includes(b)));
}

if (typeof module !== 'undefined') module.exports = { FO_STATUS, foProximo, foFiltrar };

if (typeof window !== 'undefined') {
  const kit = window.esKit;
  const fo = { dados: null, erro: null, filtro: 'todas', busca: '', config: false, empresasCfg: null, etapasCfg: null, rubricas: {}, aberta: null, formEtapa: null };
  const podeOp = () => !!(fo.dados && fo.dados.pode.operar);
  const podeCfg = () => !!(fo.dados && fo.dados.pode.configurar);

  async function foMostrar() {
    $('tela-folha').hidden = false; window.scrollTo(0, 0);
    fo.rubricas = {}; fo.aberta = null;
    await foCarregar();
  }
  async function foCarregar() {
    try { fo.dados = await chamar(`/api/folha/painel?mes=${kit.mes()}`); fo.erro = null; } catch (e) { fo.erro = e.message; }
    if (fo.config) await foCarregarConfig();
    foRender();
  }
  async function foCarregarConfig() {
    try { const [e, t] = await Promise.all([chamar('/api/folha/empresas'), chamar('/api/folha/etapas')]); fo.empresasCfg = e.empresas; fo.etapasCfg = t.etapas; } catch (e) { avisar(e.message, { tipo: 'erro' }); }
  }

  function foRender() {
    if ($('tela-folha').hidden) return;
    $('fo-acoes').replaceChildren(h('button', { type: 'button', class: 'botao pequeno', onclick: async () => { fo.config = !fo.config; if (fo.config) await foCarregarConfig(); foRender(); } }, h('span', { text: fo.config ? 'Voltar ao mês' : 'Empresas e etapas' })));
    const alvo = $('fo-conteudo');
    if (fo.erro) return alvo.replaceChildren(kit.erro('Não foi possível abrir a folha.', fo.erro));
    if (!fo.dados) return alvo.replaceChildren(kit.carregando());
    alvo.replaceChildren(...(fo.config ? foConfig() : foPainel()).filter(Boolean));
  }

  /* ----- painel do mês ----- */
  function foPainel() {
    const d = fo.dados; const t = d.totais;
    const out = [kit.kpis([
      { rotulo: 'Empresas com folha', valor: esN(t.empresas), icone: 'users', meta: kit.textoMes(d.competencia) },
      { rotulo: 'Concluídas', valor: esN(t.concluidas), tom: 'ok', icone: 'check' },
      { rotulo: 'Em andamento', valor: esN(t.emAndamento), tom: t.emAndamento ? 'atencao' : 'ok', icone: 'clock-alert' },
      { rotulo: 'Sem configuração', valor: esN(t.semConfiguracao), tom: 'neutro', icone: 'building-2', meta: 'Empresas não marcadas como "tem folha"' },
    ])];
    if (!d.empresas.length) {
      out.push(kit.vazio('Nenhuma empresa marcada com folha.', podeOp() ? 'Abra "Empresas e etapas" e marque as empresas que têm funcionários.' : 'Peça a quem opera a folha para marcar as empresas que têm funcionários.'));
      return out;
    }
    const filtros = h('div', { class: 'abas-tela', role: 'tablist' }, ...[['todas', 'Todas'], ['pendentes', 'Com etapa pendente'], ['concluidas', 'Concluídas']].map(([id, n]) => h('button', { type: 'button', class: `aba-tela${fo.filtro === id ? ' ativa' : ''}`, onclick: () => { fo.filtro = id; foRender(); } }, n)));
    const busca = h('input', { type: 'search', class: 'cl-busca', placeholder: 'Buscar empresa', value: fo.busca, oninput: (ev) => { fo.busca = ev.currentTarget.value; foRender(); const b = $('fo-conteudo').querySelector('input[type=search]'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); } });
    const linhas = foFiltrar(d.empresas, fo.filtro, fo.busca);
    const celula = (l, e) => {
      const st = l.etapas[e.id] || { status: 'pendente' };
      const s = FO_STATUS[st.status] || FO_STATUS.pendente;
      const dica = `${e.nome}: ${s.texto}${st.automatico ? ' (automático: o Contábil já gerou os lançamentos)' : ''}${st.feito_por ? ` · ${st.feito_por} em ${esDataHora(st.feito_em)}` : ''}${st.observacao ? ` · ${st.observacao}` : ''}`;
      if (!podeOp() || st.automatico) return h('td', { class: 'fo-celula' }, h('span', { class: `selo ${s.tom}`, title: dica, 'aria-label': dica, text: s.marca }));
      return h('td', { class: 'fo-celula' }, h('button', { type: 'button', class: `selo ${s.tom} fo-marca`, title: `${dica}. Clique para mudar.`, 'aria-label': `${dica}. Mudar para ${FO_STATUS[foProximo(st.status)].texto}`,
        onclick: (ev) => comOcupado(ev.currentTarget, null, async () => {
          try { await chamar('/api/folha/marcar', { method: 'POST', body: { empresa_id: l.empresa.id, mes: d.competencia, etapa_id: e.id, status: foProximo(st.status) } }); await foCarregar(); } catch (x) { avisar(x.message, { tipo: 'erro' }); }
        }) }, s.marca));
    };
    out.push(kit.cartao(kit.topo('Etapas do mês', podeOp() ? 'Clique na etapa para mudar: pendente → feito → não se aplica. "Contabilizada" fica feita sozinha quando o Contábil gera os lançamentos da folha.' : 'Situação de cada etapa por empresa.'),
      filtros, busca,
      linhas.length ? kit.tabela(['Empresa', ...d.etapas.map((e) => ({ texto: e.nome, classe: 'fo-celula' })), 'Progresso', 'Rubricas', ''], linhas.flatMap((l) => {
        const aberta = fo.aberta === l.empresa.id;
        const tr = h('tr', {},
          h('td', {}, h('strong', { text: l.empresa.razao_social }), h('span', { class: 'sub', text: `${formatarCnpj(l.empresa.cnpj)}${l.funcionarios ? ` · ${esN(l.funcionarios)} funcionário${l.funcionarios === 1 ? '' : 's'}` : ''}` })),
          ...d.etapas.map((e) => celula(l, e)),
          h('td', {}, kit.selo(`${l.feitas}/${l.total}`, l.feitas === l.total ? 'ok' : 'atencao')),
          h('td', { text: l.rubricas ? `${esN(l.rubricas.quantidade)} · ${esMoeda(l.rubricas.valor)}${l.rubricas.pendentes ? ` · ${esN(l.rubricas.pendentes)} pendente(s)` : ''}` : 'sem empresa no Contábil' }),
          h('td', {}, l.rubricas ? h('button', { type: 'button', class: 'botao pequeno fantasma', 'aria-expanded': String(aberta), onclick: () => foAbrirRubricas(l.empresa.id) }, aberta ? 'Fechar' : 'Rubricas') : null));
        return aberta ? [tr, h('tr', {}, h('td', { colspan: String(d.etapas.length + 4) }, foRubricas(l.empresa.id)))] : [tr];
      })) : kit.vazio('Nenhuma empresa neste filtro.')));
    return out;
  }

  async function foAbrirRubricas(id) {
    fo.aberta = fo.aberta === id ? null : id;
    foRender();
    if (fo.aberta && !fo.rubricas[id]) {
      try { fo.rubricas[id] = await chamar(`/api/folha/rubricas/${id}?mes=${fo.dados.competencia}`); } catch (e) { fo.rubricas[id] = { erro: e.message }; }
      foRender();
    }
  }
  function foRubricas(id) {
    const r = fo.rubricas[id];
    if (!r) return h('div', { class: 'vg-skel', 'aria-hidden': 'true' });
    if (r.erro) return kit.erro('Não foi possível ler as rubricas.', r.erro);
    if (!r.rubricas.length) return h('p', { class: 'meta', text: 'Nenhuma rubrica desta empresa no mês. Envie a planilha da folha em Contábil → Processar.' });
    return h('div', { class: 'pilha' }, h('p', { class: 'meta', text: `Código no Domínio ${r.codigoDominio} · total ${esMoeda(r.total)}. Rubrica sem regra fica pendente no Contábil.` }),
      kit.tabela(['Rubrica', 'Descrição', { texto: 'Valor', classe: 'num' }, 'Situação'], r.rubricas.map((x) => h('tr', {},
        h('td', { class: 'mono', text: x.rubrica || '—' }), h('td', { text: x.descricao || '—' }), h('td', { class: 'num', text: esMoeda(x.valor) }),
        h('td', {}, x.status === 'ok' ? kit.selo('Contabilizada', 'ok') : kit.selo(x.erro_codigo === 'RUBRICA_SEM_REGRA' ? 'Sem regra' : (x.erro_codigo || 'Pendente'), 'atencao'), x.erro_detalhe ? h('span', { class: 'sub', text: x.erro_detalhe }) : null)))));
  }

  /* ----- configuração: empresas com folha e etapas ----- */
  function foConfig() {
    const out = [];
    const emps = fo.empresasCfg;
    out.push(kit.cartao(kit.topo('Empresas com folha', 'Marque as empresas que têm funcionários (ou pró-labore). Só elas entram no controle do mês.'),
      !emps ? h('div', { class: 'vg-skel', 'aria-hidden': 'true' }) : kit.tabela(['Empresa', 'Tem folha', 'Funcionários', 'Observação', ''], emps.map((e) => {
        const f = { empresa_id: e.id, tem_folha: e.tem_folha, funcionarios: e.funcionarios ?? '', observacao: e.observacao ?? '' };
        return h('tr', {},
          h('td', {}, h('strong', { text: e.razao_social }), h('span', { class: 'sub', text: formatarCnpj(e.cnpj) })),
          h('td', {}, h('input', { type: 'checkbox', checked: e.tem_folha, disabled: !podeOp(), 'aria-label': `${e.razao_social} tem folha`, onchange: (ev) => { f.tem_folha = ev.currentTarget.checked; } })),
          h('td', {}, h('input', { type: 'number', min: '0', class: 'fo-num', value: f.funcionarios, disabled: !podeOp(), 'aria-label': 'Funcionários', oninput: (ev) => { f.funcionarios = ev.currentTarget.value; } })),
          h('td', {}, h('input', { type: 'text', maxlength: '300', value: f.observacao, disabled: !podeOp(), 'aria-label': 'Observação', oninput: (ev) => { f.observacao = ev.currentTarget.value; } })),
          h('td', {}, podeOp() ? kit.btn('Salvar', async () => { await chamar('/api/folha/empresas', { method: 'POST', body: { ...f, funcionarios: f.funcionarios === '' ? null : Number(f.funcionarios) } }); avisar('Empresa atualizada.', { tipo: 'ok' }); await foCarregar(); }) : null));
      }))));
    const etapas = fo.etapasCfg;
    out.push(kit.cartao(kit.topo('Etapas do mês', 'A ordem e os nomes das colunas do controle. Etapa desativada some do controle (o histórico fica).',
      podeCfg() ? h('button', { type: 'button', class: 'botao primario pequeno', onclick: () => { fo.formEtapa = { nome: '', descricao: '', ordem: ((etapas || []).length + 1) * 10, ativa: true }; foRender(); } }, h('span', { text: 'Nova etapa' })) : null),
      fo.formEtapa ? foFormEtapa() : null,
      !etapas ? h('div', { class: 'vg-skel', 'aria-hidden': 'true' }) : kit.tabela(['Ordem', 'Etapa', 'Descrição', 'Ativa', ''], etapas.map((e) => h('tr', { class: e.ativa ? '' : 'desativado' },
        h('td', { text: e.ordem }), h('td', {}, h('strong', { text: e.nome })), h('td', { text: e.descricao || '—' }), h('td', { text: e.ativa ? 'Sim' : 'Não' }),
        h('td', {}, podeCfg() ? h('button', { type: 'button', class: 'botao pequeno', onclick: () => { fo.formEtapa = { ...e }; foRender(); } }, 'Editar') : null))))));
    return out;
  }
  function foFormEtapa() {
    const f = fo.formEtapa;
    return h('div', { class: 'pilha' },
      kit.linha(kit.campo('Nome', f, 'nome', 'text', { maxlength: '80' }), kit.campo('Ordem', f, 'ordem', 'number', { min: '1' }), kit.marcar('Ativa', f, 'ativa')),
      kit.campo('Descrição', f, 'descricao', 'text', { maxlength: '300' }),
      kit.acoesForm(() => { fo.formEtapa = null; foRender(); }, async () => { await chamar('/api/folha/etapas', { method: 'POST', body: f }); avisar('Etapa salva.', { tipo: 'ok' }); fo.formEtapa = null; await foCarregarConfig(); await foCarregar(); }, 'Salvar etapa'));
  }

  kit.aoMudarMes('tela-folha', foCarregar);
  window.foMostrar = foMostrar;
}
