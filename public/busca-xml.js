'use strict';
/*
 * Busca de XML em dois níveis, com o mesmo componente:
 * - Escritório (#/notas): escolhe "Todas as empresas" ou um cliente.
 * - Empresa (aba Notas Fiscais): a busca fica presa àquela empresa.
 * Filtros: período (até 12 meses), UF do emitente, direção, documento, situação e "buscar por" número/faixa, chaves,
 * CNPJ/CPF ou nome. Marca notas (várias páginas), baixa ZIP (até 5.000 XMLs) e exporta Excel.
 * Usa os utilitários globais do app.js (h, $, chamar, icone, comOcupado, avisar, baixarArquivo, buscar, sessao,
 * mensagemDeErro, cartao, situacaoNota, dataCurta, TIPO_DOC) e do nucleo.js (moeda, formatarCnpj, textoCompetencia).
 */

/* ---------- funções puras (testadas em test/busca-xml-tela.test.ts) ---------- */

const BX_UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
const BX_MAX_ZIP = 5000;

/** Primeiro e último dia da competência (AAAA-MM). */
function bxPeriodoDoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  const ult = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { de: `${mes}-01`, ate: `${mes}-${String(ult).padStart(2, '0')}` };
}

/** Dias do período, contando o primeiro e o último. */
function bxDias(de, ate) { return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000) + 1; }

/** Erro do período para mostrar antes de chamar o servidor (ou null). */
function bxErroPeriodo(de, ate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(de || '') || !/^\d{4}-\d{2}-\d{2}$/.test(ate || '')) return 'Informe a data inicial e a final.';
  if (ate < de) return 'A data final é anterior à inicial.';
  if (bxDias(de, ate) > 366) return 'O período pode ter no máximo 12 meses.';
  return null;
}

/** Parâmetros da busca (query string e corpo do ZIP/Excel). */
function bxParametros(f) {
  const p = { de: f.de, ate: f.ate };
  for (const k of ['empresa', 'uf', 'modelo', 'direcao', 'situacao']) if (f[k]) p[k] = f[k];
  if (f.termo && f.termo.trim()) { p.por = f.por; p.termo = f.termo.trim(); }
  return p;
}

/** Texto de ajuda do campo de busca. */
function bxDica(por) {
  return ({ numero: 'Ex.: 10001 ou 10001, 10002 ou 10001-10050', chave: 'Cole uma ou várias chaves (uma por linha)', documento: 'CNPJ ou CPF do emitente ou do destinatário', nome: 'Parte do nome do emitente ou do destinatário' })[por] || '';
}

/** O que os botões de download vão pegar: as marcadas ou tudo o que a busca achou. */
function bxAlvoDownload(marcadas, total) {
  if (marcadas > 0) return { qtd: marcadas, texto: `${marcadas.toLocaleString('pt-BR')} marcada${marcadas === 1 ? '' : 's'}`, excede: marcadas > BX_MAX_ZIP };
  return { qtd: total, texto: `${total.toLocaleString('pt-BR')} da busca`, excede: total > BX_MAX_ZIP };
}

/** Páginas a mostrar na paginação: primeira, última e vizinhas da atual, com "…" nos buracos. */
function bxPaginas(atual, total) {
  const set = new Set([1, total, atual - 1, atual, atual + 1].filter((p) => p >= 1 && p <= total));
  const lista = [...set].sort((a, b) => a - b);
  const out = [];
  lista.forEach((p, i) => { if (i && p - lista[i - 1] > 1) out.push('…'); out.push(p); });
  return out;
}

if (typeof module !== 'undefined') module.exports = { bxPeriodoDoMes, bxDias, bxErroPeriodo, bxParametros, bxDica, bxAlvoDownload, bxPaginas, BX_UFS };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  /** Cria uma busca num contêiner. `empresaFixa`: a busca fica presa a essa empresa (aba da empresa). */
  function bxCriar(alvoId, empresaFixa) {
    const st = {
      f: { empresa: empresaFixa ? empresaFixa.id : '', de: '', ate: '', uf: '', modelo: '', direcao: '', situacao: '', por: 'numero', termo: '' },
      pagina: 1, dados: null, erro: null, carregando: false, marcadas: new Map(), seq: 0, empresas: null,
    };

    async function carregar(pagina = 1) {
      const erroP = bxErroPeriodo(st.f.de, st.f.ate);
      if (erroP) { st.erro = erroP; st.dados = null; render(); return; }
      st.pagina = pagina; st.carregando = true; st.erro = null; render();
      const seq = ++st.seq;
      try {
        const q = new URLSearchParams({ ...bxParametros(st.f), pagina: String(pagina) });
        // Na empresa: as vendas cuja nota a SEFAZ rejeitou (e que não têm nota boa no mesmo número), no mesmo período
        const [d, rej] = await Promise.all([chamar(`/api/xml/busca?${q}`),
          empresaFixa && pagina === 1 ? chamar(`/api/empresas/${empresaFixa.id}/rejeitadas?de=${st.f.de}&ate=${st.f.ate}`).catch(() => null) : Promise.resolve(st.rejeitadas)]);
        if (seq !== st.seq) return;
        st.dados = d; st.rejeitadas = rej;
      } catch (e) {
        if (seq !== st.seq) return;
        st.erro = e.message; st.dados = null;
      }
      st.carregando = false; render();
    }

    async function baixarPost(caminho, corpo, nome) {
      const faz = () => buscar(caminho, { method: 'POST', headers: { Authorization: `Bearer ${sessao.accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
      let resp = await faz();
      if (resp.status === 401) { await chamar('/api/eu').catch(() => {}); resp = await faz(); }
      if (!resp.ok) { let erro = null; try { erro = (await resp.json()).erro; } catch { /* não é JSON */ } throw new Error(mensagemDeErro(resp.status, erro)); }
      const n = (resp.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || nome;
      const url = URL.createObjectURL(await resp.blob());
      const a = h('a', { href: url, download: n }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    function baixar(tipo, botao) {
      const total = st.dados ? st.dados.total : 0;
      const alvo = bxAlvoDownload(st.marcadas.size, total);
      if (!alvo.qtd) { avisar('Nenhuma nota para baixar.'); return; }
      if (tipo === 'zip' && alvo.excede) { avisar(`O ZIP tem limite de ${BX_MAX_ZIP.toLocaleString('pt-BR')} XMLs. Diminua o período, use mais filtros ou marque as notas.`, { tipo: 'erro' }); return; }
      const corpo = { filtros: bxParametros(st.f), chaves: st.marcadas.size ? [...st.marcadas.keys()] : undefined };
      if (tipo === 'zip') avisar(`Preparando o ZIP com ${alvo.texto}…`);
      comOcupado(botao, tipo === 'zip' ? 'Preparando ZIP…' : 'Gerando planilha…', async () => {
        try { await baixarPost(tipo === 'zip' ? '/api/xml/zip' : '/api/xml/excel', corpo, tipo === 'zip' ? 'xmls.zip' : 'notas.xlsx'); } catch (e) { avisar(e.message, { tipo: 'erro' }); }
      }, `bx-${tipo}-${alvoId}`);
    }

    function marcar(n, sim) { if (sim) st.marcadas.set(n.chave, n.empresa_id); else st.marcadas.delete(n.chave); }

    function filtros() {
      const f = st.f;
      const sel = (id, rotulo, valor, opcoes, onchange) => h('label', { class: 'fc-campo' }, h('span', { text: rotulo }),
        h('select', { id, class: 'vg-select', onchange }, ...opcoes.map(([v, t]) => h('option', { value: v, text: t, selected: v === valor }))));
      const muda = (k) => (ev) => { f[k] = ev.target.value; };
      const empresaSel = !empresaFixa ? sel(`${alvoId}-empresa`, 'Empresa', f.empresa,
        [['', 'Todas as empresas'], ...((st.empresas || []).map((e) => [e.id, `${e.razao_social} · ${formatarCnpj(e.cnpj)}`]))], muda('empresa')) : null;
      if (empresaSel) empresaSel.classList.add('bx-empresa-campo');
      const de = h('input', { type: 'date', id: `${alvoId}-de`, value: f.de, onchange: muda('de') });
      const ate = h('input', { type: 'date', id: `${alvoId}-ate`, value: f.ate, onchange: muda('ate') });
      const termo = f.por === 'chave'
        ? h('textarea', { id: `${alvoId}-termo`, rows: '2', placeholder: bxDica('chave'), oninput: muda('termo'), spellcheck: 'false' }, f.termo)
        : h('input', { type: 'search', id: `${alvoId}-termo`, value: f.termo, placeholder: bxDica(f.por), autocomplete: 'off', oninput: muda('termo'),
          onkeydown: (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); aplicar(); } } });
      if (f.por === 'chave') termo.value = f.termo;
      const por = h('select', { id: `${alvoId}-por`, class: 'vg-select', 'aria-label': 'Buscar por', onchange: (ev) => { f.por = ev.target.value; render(); $(`${alvoId}-termo`).focus(); } },
        ...[['numero', 'Número'], ['chave', 'Chave'], ['documento', 'CNPJ/CPF'], ['nome', 'Nome']].map(([v, t]) => h('option', { value: v, text: t, selected: v === f.por })));
      const aplicar = () => { st.marcadas.clear(); carregar(1); };
      return h('form', { class: 'bx-filtros', onsubmit: (ev) => { ev.preventDefault(); aplicar(); } },
        h('div', { class: 'bx-linha' },
          empresaSel,
          h('label', { class: 'fc-campo bx-periodo' }, h('span', { text: 'Período' }), h('span', { class: 'bx-datas' }, de, h('span', { class: 'meta', text: 'a' }), ate)),
          sel(`${alvoId}-uf`, 'UF do emitente', f.uf, [['', 'Todas'], ...BX_UFS.map((u) => [u, u])], muda('uf')),
          sel(`${alvoId}-direcao`, 'Direção', f.direcao, [['', 'Entradas e saídas'], ['entrada', 'Entradas'], ['saida', 'Saídas']], muda('direcao')),
          sel(`${alvoId}-modelo`, 'Documento', f.modelo, [['', 'Todos'], ['55', 'NF-e'], ['65', 'NFC-e'], ['57', 'CT-e']], muda('modelo')),
          sel(`${alvoId}-situacao`, 'Situação', f.situacao, [['', 'Todas'], ['autorizada', 'Autorizadas'], ['cancelada', 'Canceladas'], ['resumo', 'Só resumo']], muda('situacao'))),
        h('div', { class: 'bx-linha bx-busca' },
          h('div', { class: 'bx-por' }, h('span', { class: 'fc-campo' }, h('span', { text: 'Buscar por' }), por), h('label', { class: 'bx-termo' }, h('span', { class: 'visualmente-oculto', text: 'Termo da busca' }), termo)),
          h('div', { class: 'bx-acoes-filtro' },
            h('button', { type: 'submit', class: 'botao primario' }, icone('search'), h('span', { text: 'Filtrar' })),
            h('button', { type: 'button', class: 'botao fantasma', onclick: () => { const p = st.periodoPadrao; Object.assign(f, { uf: '', modelo: '', direcao: '', situacao: '', termo: '', de: p.de, ate: p.ate }); if (!empresaFixa) f.empresa = ''; st.marcadas.clear(); carregar(1); } }, 'Limpar filtros'))));
    }

    function render() {
      const alvo = $(alvoId); if (!alvo) return;
      const d = st.dados;
      const partes = [filtros()];
      if (st.erro) partes.push(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível buscar.' }), h('span', { text: st.erro })));
      if (!d && st.carregando) partes.push(h('div', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }), h('div', { class: 'vg-skel', 'aria-hidden': 'true' })));
      if (empresaFixa && st.rejeitadas && st.rejeitadas.total) partes.push(cartaoRejeitadas(st.rejeitadas));
      if (d) {
        const s = d.resumo || {};
        partes.push(h('div', { class: 'numeros' },
          cartao('Notas', (s.quantidade || 0).toLocaleString('pt-BR'), [!empresaFixa && !st.f.empresa ? `${s.empresas} empresa${s.empresas === 1 ? '' : 's'}` : '', s.canceladas ? `${s.canceladas} canceladas` : '', s.soResumo ? `${s.soResumo} só resumo` : ''].filter(Boolean).join(' · ')),
          cartao('Entradas', moeda(s.entradas)), cartao('Saídas', moeda(s.saidas)), cartao('ICMS', moeda(s.icms)),
          ...(empresaFixa ? [cartao('ICMS-ST', moeda(s.st)), cartao('IPI', moeda(s.ipi)), cartao('PIS + COFINS', moeda((s.pis || 0) + (s.cofins || 0))), cartao('IBS + CBS', moeda((s.ibs || 0) + (s.cbs || 0)))] : [])));
        const alvoDl = bxAlvoDownload(st.marcadas.size, d.total);
        partes.push(h('div', { class: 'bx-barra' },
          h('span', { class: 'bx-marcadas', text: st.marcadas.size ? `${st.marcadas.size.toLocaleString('pt-BR')} nota${st.marcadas.size === 1 ? '' : 's'} marcada${st.marcadas.size === 1 ? '' : 's'}` : 'Nenhuma nota marcada: os botões pegam tudo o que a busca achou' }),
          h('span', { class: 'gu-botoes' },
            st.marcadas.size ? h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => { st.marcadas.clear(); render(); } }, 'Limpar marcadas') : null,
            h('button', { type: 'button', class: 'botao pequeno', disabled: !alvoDl.qtd, onclick: (ev) => baixar('excel', ev.currentTarget) }, icone('file-spreadsheet'), h('span', { text: `Exportar Excel (${alvoDl.texto})` })),
            h('button', { type: 'button', class: 'botao pequeno primario', disabled: !alvoDl.qtd || alvoDl.excede, title: alvoDl.excede ? `Limite de ${BX_MAX_ZIP.toLocaleString('pt-BR')} XMLs por ZIP` : '', onclick: (ev) => baixar('zip', ev.currentTarget) }, icone('cloud-download'), h('span', { text: `Baixar XML (${alvoDl.texto})` })))));
        if (alvoDl.excede && !st.marcadas.size) partes.push(h('p', { class: 'meta', text: `A busca achou mais de ${BX_MAX_ZIP.toLocaleString('pt-BR')} notas: para o ZIP, diminua o período, use mais filtros ou marque as notas. A planilha aceita até 20.000.` }));
        partes.push(tabela(d));
      }
      alvo.replaceChildren(...partes);
    }

    /** Aviso das vendas sem nota autorizada, com motivos e a lista para baixar. */
    function cartaoRejeitadas(r) {
      const dia = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
      const baixar = () => {
        const linhas = r.vendas.map((v) => [TIPO_DOC[v.modelo] || v.modelo, v.serie || '', v.numero || '', dia(v.emitida_em), v.valor != null ? String(v.valor).replace('.', ',') : '', v.cstat, (v.motivo || '').replace(/;/g, ','), v.tentativas, v.chaves.join(' ')].join(';'));
        const csv = ['documento;serie;numero;emissao;valor;cstat;motivo;tentativas;chaves', ...linhas].join('\r\n');
        const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
        const a = h('a', { href: url, download: `vendas-sem-nota-${st.f.de}_${st.f.ate}.csv` }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      };
      return h('section', { class: 'vg-card bx-rejeitadas', role: 'alert' },
        h('div', { class: 'vg-card-topo' }, h('div', {},
          h('h2', { class: 'vg-card-titulo', text: `${r.total.toLocaleString('pt-BR')} venda${r.total === 1 ? '' : 's'} sem nota autorizada` }),
          h('p', { class: 'meta', text: `O sistema de venda gerou XMLs que a SEFAZ rejeitou, e não há nota autorizada com o mesmo número no Appura. Somam ${moeda(r.valor)}. O cliente precisa corrigir e reemitir, ou inutilizar a numeração.` })),
          h('button', { type: 'button', class: 'botao pequeno', onclick: baixar }, icone('cloud-download'), h('span', { text: 'Baixar a lista' }))),
        h('ul', { class: 'bx-motivos' }, ...r.porMotivo.slice(0, 5).map((m) => h('li', {}, h('strong', { text: `${m.quantidade.toLocaleString('pt-BR')}× ` }), m.motivo))));
    }

    function tabela(d) {
      if (!d.notas.length) return h('div', { class: 'vg-vazio' }, h('strong', { text: 'Nenhuma nota com esses filtros.' }), h('span', { text: 'Confira o período e a busca.' }));
      const todas = !empresaFixa && !st.f.empresa;
      const marcadasPag = d.notas.filter((n) => st.marcadas.has(n.chave)).length;
      const cab = h('input', { type: 'checkbox', 'aria-label': 'Marcar as notas desta página', onchange: (ev) => { for (const n of d.notas) marcar(n, ev.target.checked); render(); } });
      cab.checked = marcadasPag === d.notas.length; cab.indeterminate = marcadasPag > 0 && marcadasPag < d.notas.length;
      const caixa = (n) => { const c = h('input', { type: 'checkbox', 'aria-label': `Marcar ${TIPO_DOC[n.modelo] || ''} ${n.numero || n.chave}`, onchange: (ev) => { marcar(n, ev.target.checked); render(); } }); c.checked = st.marcadas.has(n.chave); return c; };
      const outra = (n) => (n.direcao === 'entrada' ? [n.emit_nome || '—', n.emit_cnpj ? formatarCnpj(n.emit_cnpj) : ''] : [n.dest_nome || 'Consumidor', n.dest_doc ? formatarCnpj(n.dest_doc) : '']);
      const xml = (n) => h('button', { type: 'button', class: 'botao fantasma pequeno', onclick: async () => {
        try { await baixarArquivo(`/api/empresas/${n.empresa_id}/xml?chave=${n.chave}`, `${n.chave}.xml`); } catch (e) { avisar(e.message, { tipo: 'erro' }); }
      } }, 'XML');
      const linhas = d.notas.map((n) => {
        const op = outra(n);
        return h('tr', { class: `${n.situacao === 'cancelada' ? 'cancelada' : ''}${st.marcadas.has(n.chave) ? ' bx-marcada' : ''}` },
          h('td', { class: 'bx-caixa' }, caixa(n)),
          todas ? h('td', {}, h('a', { href: `#/empresas/${n.empresa_id}/notas`, class: 'bx-empresa', text: n.empresa_nome }), h('span', { class: 'sub mono', text: formatarCnpj(n.empresa_cnpj) })) : null,
          h('td', {}, dataCurta(n.emitida_em), h('span', { class: 'sub', text: new Date(n.emitida_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) })),
          h('td', {}, `${TIPO_DOC[n.modelo] || n.modelo} ${n.numero || ''}`, h('span', { class: 'sub', text: `${n.direcao === 'entrada' ? 'Entrada' : 'Saída'}${n.serie ? ` · série ${n.serie}` : ''}` })),
          h('td', {}, op[0], h('span', { class: 'sub mono', text: [op[1], n.uf_emitente && n.direcao === 'entrada' ? n.uf_emitente : ''].filter(Boolean).join(' · ') })),
          h('td', {}, h('span', { class: 'mono bx-chave', text: n.chave })),
          h('td', { class: 'num' }, moeda(n.valor)),
          h('td', {}, situacaoNota(n)),
          h('td', {}, n.tem_xml || n.completo ? xml(n) : null));
      });
      const cartoes = h('ul', { class: 'notas-cartoes bx-cartoes' }, ...d.notas.map((n) => {
        const op = outra(n);
        return h('li', { class: `nota-cartao${n.situacao === 'cancelada' ? ' cancelada' : ''}` },
          h('div', { class: 'nota-cartao-topo' }, h('label', { class: 'bx-cartao-marca' }, caixa(n), h('strong', { text: `${TIPO_DOC[n.modelo] || n.modelo} ${n.numero || ''}` })), h('span', { class: 'valor-nota', text: moeda(n.valor) })),
          todas ? h('span', { class: 'meta', text: n.empresa_nome }) : null,
          h('span', { class: 'nota-cartao-parte', text: op[0] }),
          h('div', { class: 'nota-cartao-rodape' }, h('span', { class: 'meta', text: `${dataCurta(n.emitida_em)} · ${n.direcao === 'entrada' ? 'Entrada' : 'Saída'}` }), situacaoNota(n), n.tem_xml || n.completo ? xml(n) : null));
      }));
      const pags = d.paginas > 1 ? h('nav', { class: 'bx-paginacao', 'aria-label': 'Páginas' },
        h('button', { type: 'button', class: 'botao pequeno fantasma', disabled: d.pagina <= 1, onclick: () => carregar(d.pagina - 1) }, '‹ Anterior'),
        ...bxPaginas(d.pagina, d.paginas).map((p) => (p === '…' ? h('span', { class: 'meta', text: '…' })
          : h('button', { type: 'button', class: `botao pequeno ${p === d.pagina ? 'primario' : 'fantasma'}`, 'aria-current': p === d.pagina ? 'page' : null, onclick: () => carregar(p) }, String(p)))),
        h('button', { type: 'button', class: 'botao pequeno fantasma', disabled: d.pagina >= d.paginas, onclick: () => carregar(d.pagina + 1) }, 'Próxima ›')) : null;
      return h('div', { class: 'pilha-pequena' },
        h('div', { class: 'rolagem bx-tabela' }, h('table', { class: 'notas' },
          h('thead', {}, h('tr', {}, h('th', { class: 'bx-caixa' }, cab), todas ? h('th', { text: 'Empresa' }) : null, h('th', { text: 'Emissão' }), h('th', { text: 'Documento' }),
            h('th', { text: 'Emitente / destinatário' }), h('th', { text: 'Chave' }), h('th', { class: 'num', text: 'Valor' }), h('th', { text: 'Situação' }), h('th', { text: '' }))),
          h('tbody', {}, ...linhas))),
        cartoes,
        h('p', { class: 'meta', text: `Mostrando ${((d.pagina - 1) * d.porPagina + 1).toLocaleString('pt-BR')}–${Math.min(d.total, d.pagina * d.porPagina).toLocaleString('pt-BR')} de ${d.total.toLocaleString('pt-BR')} notas.` }),
        pags);
    }

    return {
      st, carregar, render,
      /** Período padrão: a competência (muda junto com o topo na aba da empresa). */
      definirPeriodo(mes) { const p = bxPeriodoDoMes(mes); st.periodoPadrao = p; st.f.de = p.de; st.f.ate = p.ate; },
      resetar() { Object.assign(st.f, { uf: '', modelo: '', direcao: '', situacao: '', por: 'numero', termo: '' }); st.marcadas.clear(); st.dados = null; st.erro = null; },
    };
  }

  /* Escritório: #/notas[?empresa=<id>] */
  let bxEsc = null;
  async function bxMostrar(consulta) {
    $('tela-xml').hidden = false; window.scrollTo(0, 0);
    // Período padrão: a competência escolhida no topo (o escritório trabalha o mês que está fechando)
    const mes = mesSelecionado();
    if (!bxEsc) bxEsc = bxCriar('bx-escritorio', null);
    if (bxEsc.st.mes !== mes) { bxEsc.definirPeriodo(mes); bxEsc.st.mes = mes; }
    const emp = new URLSearchParams(consulta || '').get('empresa');
    if (emp && /^[0-9a-f-]{36}$/.test(emp)) bxEsc.st.f.empresa = emp;
    bxEsc.render();
    try {
      const r = await chamar('/api/empresas');
      bxEsc.st.empresas = (r.empresas || []).filter((e) => e.ativo !== false).sort((a, b) => a.razao_social.localeCompare(b.razao_social));
    } catch { bxEsc.st.empresas = []; }
    bxEsc.carregar(1);
  }

  /* Empresa: aba Notas Fiscais, presa à empresa aberta */
  let bxEmp = null;
  let bxPendente = null;
  function bxEmpresaCarregar(empresa, mes) {
    if (!bxEmp || bxEmp.st.f.empresa !== empresa.id) { bxEmp = bxCriar('bx-empresa', empresa); bxEmp.definirPeriodo(mes); }
    else if (bxEmp.st.mes !== mes) bxEmp.definirPeriodo(mes);
    bxEmp.st.mes = mes;
    if (bxPendente) { bxEmp.st.f.situacao = bxPendente; bxPendente = null; }
    bxEmp.carregar(1);
  }
  window.bxEmpresaCarregar = bxEmpresaCarregar;
  window.bxEmpresaResetar = () => { bxEmp = null; };
  /** Atalhos da Empresa 360° ("Só resumo"...): a situação vale na próxima carga da aba. */
  window.bxEmpresaSituacao = (situacao) => { bxPendente = situacao; };
  window.bxMostrar = bxMostrar;
  // Troca da competência no topo: o período da busca do escritório acompanha
  window.addEventListener('appura:competencia', () => { if (bxEsc && !$('tela-xml').hidden) { const m = mesSelecionado(); bxEsc.definirPeriodo(m); bxEsc.st.mes = m; bxEsc.st.marcadas.clear(); bxEsc.carregar(1); } });
}
