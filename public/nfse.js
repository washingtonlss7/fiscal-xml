'use strict';
/*
 * NFS-e Nacional (#/nfse/<aba>): notas de serviço captadas no Ambiente de Dados Nacional (ADN) com o certificado de
 * cada empresa — emitidas (prestador), recebidas (tomador) e como intermediário — e a captação por empresa.
 *   notas · captacao
 * Usa o kit de escritorio.js (window.esKit) e os utilitários globais do app.js.
 */

/* ---------- funções puras (testadas em test/nfse.test.ts) ---------- */
const NF_PAPEL = { prestador: 'Emitida', tomador: 'Recebida', intermediario: 'Intermediário' };
const NF_SITUACAO = { autorizada: { texto: 'Autorizada', tom: 'ok' }, cancelada: { texto: 'Cancelada', tom: 'problema' }, substituida: { texto: 'Substituída', tom: 'neutro' } };
/** Monta a consulta (?mes=…&papel=…) só com os filtros preenchidos. */
function nfConsulta(f) {
  return Object.entries(f).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}
/** CPF ou CNPJ formatado. */
const nfDoc = (d) => (!d ? '—' : d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d);

if (typeof module !== 'undefined') module.exports = { NF_PAPEL, NF_SITUACAO, nfConsulta, nfDoc };

if (typeof window !== 'undefined') {
  const kit = window.esKit;
  const nf = { aba: 'notas', filtro: { empresa: '', papel: '', situacao: '', busca: '' }, dados: null, erro: null, cap: null, capBusca: '', capFiltro: 'todas', marcadas: new Set() };
  const ABAS = [['notas', 'Notas'], ['captacao', 'Captação por empresa']];
  let lista = [];

  async function nfMostrar(rota) {
    nf.aba = rota.aba || 'notas';
    $('tela-nfse').hidden = false; window.scrollTo(0, 0);
    kit.abas('nf-abas', ABAS, nf.aba, '#/nfse');
    lista = await kit.empresas();
    await nfCarregar();
  }
  const consulta = () => nfConsulta({ mes: kit.mes(), ...nf.filtro });
  async function nfCarregar() {
    try {
      if (nf.aba === 'captacao') { nf.cap = await chamar('/api/nfse/captacao'); nf.marcadas = new Set(); }
      else nf.dados = await chamar(`/api/nfse/notas?${consulta()}`);
      nf.erro = null;
    } catch (e) { nf.erro = e.message; }
    nfRender();
  }

  function nfRender() {
    if ($('tela-nfse').hidden) return;
    const alvo = $('nf-conteudo');
    $('nf-acoes').replaceChildren(nf.aba === 'notas' && nf.dados && nf.dados.total ? h('div', { class: 'gu-botoes' },
      kit.btn('Baixar ZIP', () => baixarArquivo(`/api/nfse/zip?${consulta()}`, 'nfse.zip')),
      kit.btn('Planilha', () => baixarArquivo(`/api/nfse/excel?${consulta()}`, 'nfse.xlsx'))) : '');
    if (nf.erro) return alvo.replaceChildren(kit.erro('Não foi possível abrir as NFS-e.', nf.erro));
    alvo.replaceChildren(...[].concat(nf.aba === 'captacao' ? nfCaptacao() : nfNotas()).filter(Boolean));
  }

  /* ----- Notas ----- */
  function nfNotas() {
    const f = nf.filtro;
    const muda = (k) => (ev) => { f[k] = ev.currentTarget.value; nf.dados = null; nfRender(); nfCarregar(); };
    const filtros = kit.cartao(kit.linha(
      kit.campo('Empresa', f, 'empresa', 'select', { onchange: muda('empresa') }, kit.opcoesEmpresa(lista, 'Todas')),
      kit.campo('Notas', f, 'papel', 'select', { onchange: muda('papel') }, [['', 'Emitidas e recebidas'], ['prestador', 'Emitidas (prestador)'], ['tomador', 'Recebidas (tomador)'], ['intermediario', 'Como intermediário']]),
      kit.campo('Situação', f, 'situacao', 'select', { onchange: muda('situacao') }, [['', 'Todas'], ['autorizada', 'Autorizadas'], ['cancelada', 'Canceladas'], ['substituida', 'Substituídas']])),
      h('input', { type: 'search', class: 'cl-busca', placeholder: 'Buscar por prestador, tomador, CNPJ, número ou descrição (Enter)', value: f.busca, onchange: muda('busca') }),
      h('p', { class: 'meta', text: `Emissões em ${kit.textoMes(kit.mes())} (o mês do topo). As notas vêm do Ambiente de Dados Nacional, só dos municípios que enviam ao padrão nacional.` }));
    if (!nf.dados) return [filtros, kit.carregando()];
    const d = nf.dados;
    const t = (p) => d.totais[p] || { quantidade: 0, valor: 0, iss: 0 };
    const out = [kit.kpis([
      { rotulo: 'Emitidas', valor: esN(t('prestador').quantidade), icone: 'file-text', meta: `${esMoeda(t('prestador').valor)} · ISS ${esMoeda(t('prestador').iss)}` },
      { rotulo: 'Recebidas', valor: esN(t('tomador').quantidade), icone: 'file-check', meta: `${esMoeda(t('tomador').valor)} · ISS ${esMoeda(t('tomador').iss)}` },
      { rotulo: 'Como intermediário', valor: esN(t('intermediario').quantidade), tom: 'neutro', icone: 'briefcase' },
      { rotulo: 'Canceladas ou substituídas', valor: esN(d.notas.filter((n) => n.situacao !== 'autorizada').length), tom: 'neutro', icone: 'file-warning' },
    ]), filtros];
    if (!d.total) { out.push(kit.vazio('Nenhuma NFS-e com esses filtros.', 'Confira se a captação de NFS-e está ligada para a empresa (aba "Captação por empresa").')); return out; }
    if (d.limitado) out.push(h('p', { class: 'meta', role: 'status', text: 'Mostrando as 2.000 mais recentes: filtre por empresa ou tipo de nota.' }));
    out.push(kit.cartao(kit.tabela(['Número', 'Emissão', 'Empresa', 'Prestador', 'Tomador', 'Serviço', { texto: 'Valor', classe: 'num' }, { texto: 'ISS', classe: 'num' }, 'Situação', ''], d.notas.map((n) => h('tr', { class: n.situacao === 'autorizada' ? '' : 'desativado' },
      h('td', {}, h('strong', { text: n.numero || '—' }), h('span', { class: 'sub', text: NF_PAPEL[n.papel] })),
      h('td', {}, esData(n.emitida_em ? String(n.emitida_em).slice(0, 10) : null), n.competencia ? h('span', { class: 'sub', text: `comp. ${String(n.competencia).slice(5, 7)}/${String(n.competencia).slice(0, 4)}` }) : null),
      h('td', { text: n.empresa }),
      h('td', {}, n.prestador_nome || '—', h('span', { class: 'sub', text: nfDoc(n.prestador_doc) })),
      h('td', {}, n.tomador_nome || '—', h('span', { class: 'sub', text: nfDoc(n.tomador_doc) })),
      h('td', {}, n.cod_trib_nac ? h('span', { class: 'mono', text: n.cod_trib_nac }) : null, n.descricao ? h('span', { class: 'sub', text: n.descricao.length > 90 ? `${n.descricao.slice(0, 90)}…` : n.descricao }) : null),
      h('td', { class: 'num', text: esMoeda(n.valor_servico) }),
      h('td', { class: 'num' }, esMoeda(n.valor_iss), n.iss_retido ? h('span', { class: 'sub', text: 'retido' }) : null),
      h('td', {}, kit.selo((NF_SITUACAO[n.situacao] || {}).texto || n.situacao, (NF_SITUACAO[n.situacao] || {}).tom)),
      h('td', {}, kit.btn('XML', () => baixarArquivo(`/api/nfse/notas/${n.id}/xml`, `NFSe_${n.chave}.xml`), 'botao pequeno fantasma')))))));
    return out;
  }

  /* ----- Captação por empresa ----- */
  function nfCaptacao() {
    if (!nf.cap) return [kit.carregando()];
    const c = nf.cap; const podeLigar = c.pode.ligar;
    const b = nf.capBusca.trim().toLowerCase();
    const filtradas = c.empresas.filter((e) => (nf.capFiltro === 'ligadas' ? e.ativo : nf.capFiltro === 'desligadas' ? !e.ativo : nf.capFiltro === 'erro' ? e.ativo && e.situacao.tom === 'problema' : true)
      && (!b || `${e.razao_social} ${e.cnpj}`.toLowerCase().includes(b)));
    const definir = async (ids, ativo) => {
      if (!ids.length) throw new Error('Marque ao menos uma empresa.');
      const r = await chamar('/api/nfse/captacao', { method: 'POST', body: { empresas: ids, ativo } });
      avisar(`${esN(r.alteradas)} empresa(s) ${ativo ? 'com a captação de NFS-e ligada. A primeira consulta sai na próxima rodada do coletor.' : 'com a captação de NFS-e desligada.'}`, { tipo: 'ok' });
      await nfCarregar();
    };
    const filtroBtn = (id, rot) => h('button', { type: 'button', class: `aba-tela${nf.capFiltro === id ? ' ativa' : ''}`, onclick: () => { nf.capFiltro = id; nfRender(); } }, rot);
    return [
      kit.kpis([
        { rotulo: 'Empresas com NFS-e ligada', valor: esN(c.totais.ligadas), icone: 'cloud-download' },
        { rotulo: 'Em dia', valor: esN(c.totais.emDia), tom: 'ok', icone: 'check' },
        { rotulo: 'Com erro', valor: esN(c.totais.comErro), tom: c.totais.comErro ? 'problema' : 'ok', icone: 'circle-alert' },
        { rotulo: 'Empresas no total', valor: esN(c.empresas.length), tom: 'neutro', icone: 'building-2' },
      ]),
      kit.cartao(kit.topo('Captação no Ambiente de Dados Nacional', 'Usa o certificado de cada empresa (o mesmo da NF-e). Traz as notas em que a empresa é prestadora, tomadora ou intermediária, nos municípios que enviam ao padrão nacional. A consulta segue o mesmo horário e intervalo do coletor.'),
        h('div', { class: 'abas-tela', role: 'tablist' }, filtroBtn('todas', 'Todas'), filtroBtn('ligadas', 'Ligadas'), filtroBtn('desligadas', 'Desligadas'), filtroBtn('erro', 'Com erro')),
        h('input', { type: 'search', class: 'cl-busca', placeholder: 'Buscar empresa', value: nf.capBusca, oninput: (ev) => { nf.capBusca = ev.currentTarget.value; nfRender(); const x = $('nf-conteudo').querySelector('input[type=search]'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }),
        podeLigar ? kit.botoes(
          kit.btn(`Ligar as marcadas (${nf.marcadas.size})`, () => definir([...nf.marcadas], true), 'botao primario pequeno'),
          kit.btn(`Desligar as marcadas (${nf.marcadas.size})`, () => definir([...nf.marcadas], false)),
          kit.btn('Ligar todas com certificado', () => { const ids = c.empresas.filter((e) => e.certificado && !e.ativo && e.empresa_ativa).map((e) => e.empresa_id); if (!kit.confirmar(`Ligar a captação de NFS-e de ${ids.length} empresa(s) com certificado válido?`)) return null; return definir(ids, true); }, 'botao pequeno fantasma')) : null,
        filtradas.length ? kit.tabela([...(podeLigar ? [''] : []), 'Empresa', 'Captação', 'Situação', 'Última consulta', { texto: 'NFS-e captadas', classe: 'num' }, 'NSU'], filtradas.map((e) => h('tr', { class: e.empresa_ativa ? '' : 'desativado' },
          ...(podeLigar ? [h('td', {}, h('input', { type: 'checkbox', checked: nf.marcadas.has(e.empresa_id), 'aria-label': `Marcar ${e.razao_social}`, onchange: (ev) => { if (ev.currentTarget.checked) nf.marcadas.add(e.empresa_id); else nf.marcadas.delete(e.empresa_id); nfRender(); } }))] : []),
          h('td', {}, h('strong', { text: e.razao_social }), h('span', { class: 'sub', text: formatarCnpj(e.cnpj) })),
          h('td', {}, kit.selo(e.ativo ? 'Ligada' : 'Desligada', e.ativo ? 'info' : 'neutro')),
          h('td', {}, kit.selo(e.situacao.texto, e.situacao.tom), e.ativo && e.ultimo_motivo && e.situacao.tom !== 'ok' ? h('span', { class: 'sub', text: e.ultimo_motivo }) : null),
          h('td', {}, esDataHora(e.ultima_consulta_em), e.ativo && e.proxima_consulta_em ? h('span', { class: 'sub', text: `próxima: ${esDataHora(e.proxima_consulta_em)}` }) : null),
          h('td', { class: 'num', text: esN(e.documentos_total) }), h('td', { class: 'mono', text: e.ult_nsu ? String(e.ult_nsu) : '—' })))) : kit.vazio('Nenhuma empresa neste filtro.')),
    ];
  }

  kit.aoMudarMes('tela-nfse', () => { if (nf.aba === 'notas') { nf.dados = null; nfRender(); nfCarregar(); } });
  window.nfMostrar = nfMostrar;
}
