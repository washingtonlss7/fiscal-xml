'use strict';
/*
 * Societário (#/societario/<aba>[/<empresa>]): clientes (ficha com cadastro, sócios, documentos e processos),
 * vencimentos de documentos (alvarás, licenças, certidões) e processos (abertura, alteração, baixa).
 * Usa o kit de escritorio.js (window.esKit) e os utilitários globais do app.js.
 */

/* ---------- funções puras (testadas em test/escritorio-tela.test.ts) ---------- */
/** Progresso de um processo pelas etapas: { feitas, total, pct }. */
function soProgresso(etapas) {
  const l = Array.isArray(etapas) ? etapas : [];
  const feitas = l.filter((e) => e.feito).length;
  return { feitas, total: l.length, pct: l.length ? Math.round((feitas / l.length) * 100) : 0 };
}
/** Soma das participações dos sócios ativos (sem data de saída). */
const soSomaParticipacao = (socios) => Math.round((socios || []).filter((s) => !s.saida).reduce((t, s) => t + Number(s.participacao || 0), 0) * 100) / 100;
const SO_TOM_PROCESSO = { aberto: 'info', em_andamento: 'progresso', aguardando_cliente: 'atencao', aguardando_orgao: 'pendente', concluido: 'ok', cancelado: 'neutro' };

if (typeof module !== 'undefined') module.exports = { soProgresso, soSomaParticipacao, SO_TOM_PROCESSO };

if (typeof window !== 'undefined') {
  const kit = window.esKit;
  const so = { aba: 'clientes', id: null, base: null, erro: null, ficha: null, fichaErro: null, venc: null, dias: 60, procs: null, todos: false, busca: '', form: null, novo: null };
  const ABAS = [['clientes', 'Clientes'], ['vencimentos', 'Vencimentos'], ['processos', 'Processos']];
  const tipos = () => so.base.tipos;
  const podeOp = () => !!(so.base && so.base.pode.operar);
  const opc = (obj) => Object.entries(obj);

  async function soMostrar(rota) {
    so.aba = rota.aba || 'clientes'; so.id = rota.id || null; so.form = null;
    $('tela-societario').hidden = false; window.scrollTo(0, 0);
    kit.abas('so-abas', ABAS, so.aba, '#/societario');
    if (!so.base || !so.id) await soCarregarBase();
    if (so.aba === 'clientes' && so.id) await soCarregarFicha();
    if (so.aba === 'vencimentos') await soCarregarVenc();
    if (so.aba === 'processos') await soCarregarProcs();
    soRender();
  }
  async function soCarregarBase() { try { so.base = await chamar('/api/societario/clientes'); so.erro = null; } catch (e) { so.erro = e.message; } }
  async function soCarregarFicha() { so.ficha = null; soRender(); try { so.ficha = await chamar(`/api/societario/clientes/${so.id}`); so.fichaErro = null; } catch (e) { so.fichaErro = e.message; } }
  async function soCarregarVenc() { try { so.venc = (await chamar(`/api/societario/vencimentos?dias=${so.dias}`)).documentos; } catch (e) { so.erro = e.message; } }
  async function soCarregarProcs() { try { so.procs = (await chamar(`/api/societario/processos${so.todos ? '?todos=1' : ''}`)).processos; } catch (e) { so.erro = e.message; } }

  function soRender() {
    if ($('tela-societario').hidden) return;
    $('so-acoes').replaceChildren(so.base && so.base.pode.novoCliente ? h('button', { type: 'button', class: 'botao primario pequeno', onclick: () => { so.novo = { cnpj: '', razao_social: '', uf: 'ES', regime: '' }; if (so.aba !== 'clientes' || so.id) location.hash = '#/societario/clientes'; else soRender(); } }, h('span', { text: 'Novo cliente' })) : '');
    const alvo = $('so-conteudo');
    if (so.erro && !so.base) return alvo.replaceChildren(kit.erro('Não foi possível abrir o Societário.', so.erro));
    if (!so.base) return alvo.replaceChildren(kit.carregando());
    const corpo = so.aba === 'vencimentos' ? soVencimentos() : so.aba === 'processos' ? soProcessos() : so.id ? soFicha() : soClientes();
    alvo.replaceChildren(...[].concat(corpo).filter(Boolean));
  }

  /* ----- Clientes ----- */
  function soClientes() {
    const out = [];
    if (so.novo) out.push(soFormNovo());
    const b = so.busca.trim().toLowerCase();
    const lista = so.base.clientes.filter((c) => !b || `${c.razao_social} ${c.cnpj}`.toLowerCase().includes(b));
    const venc = so.base.clientes.reduce((t, c) => t + c.documentosVencidos, 0);
    const vencendo = so.base.clientes.reduce((t, c) => t + c.documentosVencendo, 0);
    out.push(kit.kpis([
      { rotulo: 'Clientes', valor: esN(so.base.clientes.length), icone: 'building-2' },
      { rotulo: 'Documentos vencidos', valor: esN(venc), tom: venc ? 'problema' : 'ok', icone: 'file-warning' },
      { rotulo: 'Vencem em até 30 dias', valor: esN(vencendo), tom: vencendo ? 'atencao' : 'ok', icone: 'clock-alert' },
      { rotulo: 'Processos abertos', valor: esN(so.base.clientes.reduce((t, c) => t + c.processosAbertos, 0)), icone: 'list-checks' },
    ]));
    out.push(kit.cartao(
      h('input', { type: 'search', class: 'cl-busca', placeholder: 'Buscar por razão social ou CNPJ', value: so.busca, oninput: (ev) => { so.busca = ev.currentTarget.value; soRender(); const x = $('so-conteudo').querySelector('input[type=search]'); x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }),
      lista.length ? kit.tabela(['Cliente', 'Natureza jurídica', 'CNAE principal', { texto: 'Sócios', classe: 'num' }, 'Documentos', { texto: 'Processos', classe: 'num' }, ''], lista.map((c) => h('tr', { class: c.ativo ? '' : 'desativado' },
        h('td', {}, h('strong', { text: c.razao_social }), h('span', { class: 'sub', text: formatarCnpj(c.cnpj) })),
        h('td', { text: c.cadastro?.natureza_juridica || '—' }), h('td', { class: 'mono', text: c.cadastro?.cnae_principal || '—' }), h('td', { class: 'num', text: esN(c.socios) }),
        h('td', {}, c.documentosVencidos ? kit.selo(`${esN(c.documentosVencidos)} vencido(s)`, 'problema') : null, c.documentosVencendo ? kit.selo(`${esN(c.documentosVencendo)} vencendo`, 'atencao') : null, !c.documentosVencidos && !c.documentosVencendo ? '—' : null),
        h('td', { class: 'num', text: esN(c.processosAbertos) }),
        h('td', {}, h('a', { class: 'botao pequeno', href: `#/societario/clientes/${c.id}` }, 'Ficha'))))) : kit.vazio('Nenhum cliente encontrado.')));
    return out;
  }

  function soFormNovo() {
    const f = so.novo;
    return kit.cartao(kit.topo('Novo cliente (sem certificado)', 'Para abrir a ficha societária, o financeiro e o atendimento de um cliente que ainda não tem certificado no Appura. A captação de notas fica desligada até o certificado ser cadastrado no cadastro da empresa.'),
      kit.linha(kit.campo('CNPJ ou CPF', f, 'cnpj', 'text', { maxlength: '18', inputmode: 'numeric' }), kit.campo('Razão social', f, 'razao_social', 'text', { maxlength: '200' })),
      kit.linha(kit.campo('UF', f, 'uf', 'text', { maxlength: '2' }), kit.campo('Regime', f, 'regime', 'select', {}, [['', '—'], ['simples', 'Simples Nacional'], ['mei', 'MEI'], ['presumido', 'Lucro Presumido'], ['real', 'Lucro Real']])),
      kit.acoesForm(() => { so.novo = null; soRender(); }, async () => {
        const r = await chamar('/api/empresas/simples', { method: 'POST', body: f });
        avisar('Cliente cadastrado.', { tipo: 'ok' }); so.novo = null;
        await carregarEmpresas(); await soCarregarBase();
        location.hash = `#/societario/clientes/${r.id}`;
      }, 'Cadastrar cliente'));
  }

  /* ----- Ficha ----- */
  function soFicha() {
    if (so.fichaErro) return [h('a', { class: 'botao pequeno fantasma', href: '#/societario/clientes' }, '← Clientes'), kit.erro('Não foi possível abrir a ficha.', so.fichaErro)];
    if (!so.ficha) return [kit.carregando()];
    const { empresa: e, cadastro: c, socios, documentos, processos } = so.ficha;
    const t = tipos();
    const out = [h('div', { class: 'gu-botoes' }, h('a', { class: 'botao pequeno fantasma', href: '#/societario/clientes' }, '← Clientes'), h('a', { class: 'botao pequeno fantasma', href: enderecoEmpresa(e.id) }, 'Empresa 360°'))];
    out.push(kit.cartao(kit.topo(e.razao_social, `${formatarCnpj(e.cnpj)}${e.nome_fantasia ? ` · ${e.nome_fantasia}` : ''} · ${e.municipio ? `${e.municipio}/` : ''}${e.uf}${e.ie ? ` · IE ${e.ie}` : ''}${e.im ? ` · IM ${e.im}` : ''}`,
      podeOp() && so.form?.tipo !== 'cadastro' ? h('button', { type: 'button', class: 'botao pequeno', onclick: () => { so.form = { tipo: 'cadastro', ...(c || {}), cnaes_secundarios: (c?.cnaes_secundarios || []).join(', ') }; soRender(); } }, 'Editar cadastro') : null),
      so.form?.tipo === 'cadastro' ? soFormCadastro() : h('dl', { class: 'so-dados' },
        ...[['Natureza jurídica', c?.natureza_juridica], ['Capital social', c?.capital_social != null ? esMoeda(c.capital_social) : null], ['Abertura', c?.data_abertura ? esData(c.data_abertura) : null], ['NIRE', c?.nire],
          ['CNAE principal', c?.cnae_principal], ['CNAEs secundários', (c?.cnaes_secundarios || []).join(', ')], ['Objeto social', c?.objeto_social]].flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v || '—' })]))));
    // Sócios
    const soma = soSomaParticipacao(socios);
    out.push(kit.cartao(kit.topo('Sócios e administradores', socios.length ? `Participação somada dos sócios ativos: ${soma.toLocaleString('pt-BR')}%` : null,
      podeOp() ? h('button', { type: 'button', class: 'botao primario pequeno', onclick: () => { so.form = { tipo: 'socio', empresa_id: e.id, nome: '', documento: '', qualificacao: 'socio', participacao: '', entrada: '', saida: '' }; soRender(); } }, h('span', { text: 'Incluir' })) : null),
      soma > 100 ? h('p', { class: 'meta', role: 'alert', text: 'A soma passa de 100%: confira as participações ou marque a saída de quem deixou a sociedade.' }) : null,
      so.form?.tipo === 'socio' ? soFormSocio() : null,
      socios.length ? kit.tabela(['Nome', 'CPF/CNPJ', 'Qualificação', { texto: 'Participação', classe: 'num' }, 'Entrada', 'Saída', ''], socios.map((s) => h('tr', { class: s.saida ? 'desativado' : '' },
        h('td', {}, h('strong', { text: s.nome })), h('td', { class: 'mono', text: s.documento ? (s.documento.length === 14 ? formatarCnpj(s.documento) : s.documento.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')) : '—' }),
        h('td', { text: t.qualificacoes[s.qualificacao] || s.qualificacao }), h('td', { class: 'num', text: s.participacao != null ? `${Number(s.participacao).toLocaleString('pt-BR')}%` : '—' }),
        h('td', { text: esData(s.entrada) }), h('td', { text: esData(s.saida) }),
        h('td', {}, podeOp() ? kit.botoes(h('button', { type: 'button', class: 'botao pequeno', onclick: () => { so.form = { tipo: 'socio', ...s, participacao: s.participacao ?? '', entrada: s.entrada ?? '', saida: s.saida ?? '' }; soRender(); } }, 'Editar'),
          kit.btn('Excluir', async () => { if (!kit.confirmar(`Excluir ${s.nome} da ficha? (Para quem saiu da sociedade, prefira informar a data de saída.)`)) return; await chamar(`/api/societario/socios/${s.id}`, { method: 'DELETE' }); await soCarregarFicha(); soRender(); }, 'botao pequeno perigo')) : null)))) : kit.vazio('Nenhum sócio cadastrado.')));
    // Documentos
    out.push(kit.cartao(kit.topo('Documentos com validade', 'Contrato social, alvarás, licenças, certidões, AVCB… O arquivo é guardado cifrado.',
      podeOp() ? h('button', { type: 'button', class: 'botao primario pequeno', onclick: () => { so.form = { tipo: 'documento', empresa_id: e.id, doc_tipo: 'alvara', descricao: '', numero: '', emissao: '', validade: '', arquivo: null }; soRender(); } }, h('span', { text: 'Incluir' })) : null),
      so.form?.tipo === 'documento' ? soFormDocumento() : null,
      documentos.length ? kit.tabela(['Documento', 'Número', 'Emissão', 'Validade', 'Situação', ''], documentos.map((d) => h('tr', {},
        h('td', {}, h('strong', { text: t.documentos[d.tipo] || d.tipo }), d.descricao ? h('span', { class: 'sub', text: d.descricao }) : null), h('td', { text: d.numero || '—' }),
        h('td', { text: esData(d.emissao) }), h('td', { text: esData(d.validade) }), h('td', {}, kit.selo(ES_SITUACAO[d.situacao].texto, ES_SITUACAO[d.situacao].tom)),
        h('td', {}, kit.botoes(
          d.arquivo_nome ? kit.btn('Baixar', () => baixarArquivo(`/api/societario/documentos/${d.id}/arquivo`, d.arquivo_nome)) : null,
          podeOp() ? h('button', { type: 'button', class: 'botao pequeno', onclick: () => { so.form = { tipo: 'documento', id: d.id, empresa_id: e.id, doc_tipo: d.tipo, descricao: d.descricao ?? '', numero: d.numero ?? '', emissao: d.emissao ?? '', validade: d.validade ?? '', arquivo: null }; soRender(); } }, 'Editar') : null,
          podeOp() ? kit.btn('Excluir', async () => { if (!kit.confirmar('Excluir este documento?')) return; await chamar(`/api/societario/documentos/${d.id}`, { method: 'DELETE' }); await soCarregarFicha(); soRender(); }, 'botao pequeno perigo') : null))))) : kit.vazio('Nenhum documento cadastrado.')));
    // Processos
    out.push(kit.cartao(kit.topo('Processos', null,
      podeOp() ? h('button', { type: 'button', class: 'botao primario pequeno', onclick: () => { so.form = { tipo: 'processo', empresa_id: e.id, proc_tipo: 'alteracao', titulo: '', status: 'aberto', responsavel: '', prazo: '', observacao: '' }; soRender(); } }, h('span', { text: 'Novo processo' })) : null),
      so.form?.tipo === 'processo' ? soFormProcesso() : null,
      processos.length ? soListaProcessos(processos) : kit.vazio('Nenhum processo.')));
    return out;
  }

  const salvarEFechar = async (fn, msg) => { const r = await fn(); if (r && r.aviso) avisar(r.aviso, { tipo: 'erro' }); else avisar(msg, { tipo: 'ok' }); so.form = null; if (so.id) await soCarregarFicha(); if (so.aba === 'processos') await soCarregarProcs(); await soCarregarBase(); soRender(); };
  const cancelar = () => { so.form = null; soRender(); };

  function soFormCadastro() {
    const f = so.form;
    return h('div', { class: 'pilha' },
      kit.linha(kit.campo('Natureza jurídica', f, 'natureza_juridica', 'text', { maxlength: '120', placeholder: 'Ex.: 206-2 Sociedade Empresária Limitada' }), kit.campo('Capital social (R$)', f, 'capital_social', 'text', { inputmode: 'decimal' }), kit.campo('Data de abertura', f, 'data_abertura', 'date'), kit.campo('NIRE', f, 'nire', 'text', { maxlength: '30' })),
      kit.linha(kit.campo('CNAE principal', f, 'cnae_principal', 'text', { maxlength: '20' }), kit.campo('CNAEs secundários (separados por vírgula)', f, 'cnaes_secundarios', 'text')),
      kit.campo('Objeto social', f, 'objeto_social', 'textarea', { maxlength: '4000' }),
      kit.acoesForm(cancelar, () => salvarEFechar(() => chamar(`/api/societario/clientes/${so.id}/cadastro`, { method: 'PUT', body: { ...f, capital_social: f.capital_social === '' || f.capital_social == null ? null : esNumero(f.capital_social) } }), 'Cadastro salvo.')));
  }
  function soFormSocio() {
    const f = so.form;
    return h('div', { class: 'pilha so-form' },
      kit.linha(kit.campo('Nome', f, 'nome', 'text', { maxlength: '200' }), kit.campo('CPF ou CNPJ', f, 'documento', 'text', { maxlength: '18', inputmode: 'numeric' }), kit.campo('Qualificação', f, 'qualificacao', 'select', {}, opc(tipos().qualificacoes))),
      kit.linha(kit.campo('Participação (%)', f, 'participacao', 'text', { inputmode: 'decimal' }), kit.campo('Entrada', f, 'entrada', 'date'), kit.campo('Saída', f, 'saida', 'date')),
      kit.acoesForm(cancelar, () => salvarEFechar(() => chamar('/api/societario/socios', { method: 'POST', body: { ...f, participacao: f.participacao === '' ? null : esNumero(f.participacao) } }), 'Sócio salvo.')));
  }
  function soFormDocumento() {
    const f = so.form;
    return h('div', { class: 'pilha so-form' },
      kit.linha(kit.campo('Tipo', f, 'doc_tipo', 'select', {}, opc(tipos().documentos)), kit.campo('Descrição', f, 'descricao', 'text', { maxlength: '200' }), kit.campo('Número', f, 'numero', 'text', { maxlength: '60' })),
      kit.linha(kit.campo('Emissão', f, 'emissao', 'date'), kit.campo('Validade', f, 'validade', 'date'),
        h('label', { class: 'campo' }, f.id ? 'Trocar arquivo (PDF, JPG ou PNG até 15 MB)' : 'Arquivo (PDF, JPG ou PNG até 15 MB)', h('input', { type: 'file', accept: '.pdf,.jpg,.jpeg,.png', onchange: (ev) => { f.arquivo = ev.currentTarget.files[0] || null; } }))),
      kit.acoesForm(cancelar, () => salvarEFechar(async () => {
        const dados = { id: f.id, empresa_id: f.empresa_id, tipo: f.doc_tipo, descricao: f.descricao, numero: f.numero, emissao: f.emissao, validade: f.validade };
        if (f.arquivo && f.arquivo.size > 15 * 1024 * 1024) throw new Error('Arquivo maior que 15 MB.');
        const url = `/api/societario/documentos?dados=${encodeURIComponent(JSON.stringify(dados))}${f.arquivo ? `&nome=${encodeURIComponent(f.arquivo.name)}` : ''}`;
        return enviarArquivo(url, f.arquivo || new Blob([]));
      }, 'Documento salvo.')));
  }
  function soFormProcesso() {
    const f = so.form; const t = tipos();
    const etapas = f.etapas || null;
    return h('div', { class: 'pilha so-form' },
      !f.empresa_id && !f.id ? kit.campo('Cliente (abertura de empresa que ainda não existe)', f, 'cliente_nome', 'text', { maxlength: '200' }) : null,
      kit.linha(kit.campo('Tipo', f, 'proc_tipo', 'select', f.id ? { disabled: true } : {}, opc(t.processos)), kit.campo('Título', f, 'titulo', 'text', { maxlength: '200', placeholder: 'Ex.: Alteração de endereço' }), kit.campo('Situação', f, 'status', 'select', {}, opc(t.status))),
      kit.linha(kit.campo('Responsável (e-mail)', f, 'responsavel', 'text', { maxlength: '200' }), kit.campo('Prazo', f, 'prazo', 'date')),
      kit.campo('Observação', f, 'observacao', 'textarea', { maxlength: '4000' }),
      etapas ? h('fieldset', { class: 'so-etapas' }, h('legend', { text: 'Etapas' }), ...etapas.map((e) => h('label', { class: 'marcar' }, h('input', { type: 'checkbox', checked: e.feito, onchange: (ev) => { e.feito = ev.currentTarget.checked; if (!e.feito) { e.feito_em = null; e.feito_por = null; } } }), h('span', { text: `${e.nome}${e.feito && e.feito_por ? ` (${e.feito_por})` : ''}` }))))
        : h('p', { class: 'meta', text: `Etapas padrão de "${t.processos[f.proc_tipo]}": ${(t.etapas[f.proc_tipo] || []).join(' → ') || '—'}` }),
      kit.acoesForm(cancelar, () => salvarEFechar(() => chamar('/api/societario/processos', { method: 'POST', body: { id: f.id, empresa_id: f.empresa_id || null, cliente_nome: f.cliente_nome, tipo: f.proc_tipo, titulo: f.titulo, status: f.status, responsavel: f.responsavel, prazo: f.prazo, observacao: f.observacao, etapas: etapas || undefined } }), 'Processo salvo.')));
  }
  function soListaProcessos(lista, comEmpresa = false) {
    const t = tipos();
    return kit.tabela([...(comEmpresa ? ['Cliente'] : []), 'Processo', 'Situação', 'Etapas', 'Responsável', 'Prazo', ''], lista.map((p) => {
      const pr = soProgresso(p.etapas);
      const atrasado = p.prazo && p.prazo < new Date().toISOString().slice(0, 10) && !['concluido', 'cancelado'].includes(p.status);
      return h('tr', {},
        ...(comEmpresa ? [h('td', {}, p.empresa_id ? h('a', { href: `#/societario/clientes/${p.empresa_id}`, text: p.empresa || '—' }) : h('span', { text: `${p.empresa || p.cliente_nome || '—'} (sem empresa)` }))] : []),
        h('td', {}, h('strong', { text: p.titulo }), h('span', { class: 'sub', text: t.processos[p.tipo] })),
        h('td', {}, kit.selo(t.status[p.status] || p.status, SO_TOM_PROCESSO[p.status])),
        h('td', {}, pr.total ? (() => { const b = h('span', { class: 'vg-barra ok', role: 'progressbar', 'aria-valuenow': String(pr.pct), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': `${pr.feitas} de ${pr.total} etapas` }, h('span')); b.firstChild.style.width = `${pr.pct}%`; return b; })() : '—', pr.total ? h('span', { class: 'sub', text: `${pr.feitas} de ${pr.total}` }) : null),
        h('td', { text: p.responsavel || '—' }),
        h('td', {}, esData(p.prazo), atrasado ? kit.selo('Atrasado', 'problema') : null),
        h('td', {}, podeOp() ? h('button', { type: 'button', class: 'botao pequeno', onclick: () => { so.form = { tipo: 'processo', id: p.id, empresa_id: p.empresa_id, cliente_nome: p.cliente_nome, proc_tipo: p.tipo, titulo: p.titulo, status: p.status, responsavel: p.responsavel ?? '', prazo: p.prazo ?? '', observacao: p.observacao ?? '', etapas: (p.etapas || []).map((e) => ({ ...e })) }; soRender(); window.scrollTo(0, 0); } }, 'Abrir') : null));
    }));
  }

  /* ----- Vencimentos ----- */
  function soVencimentos() {
    const filtro = kit.cartao(kit.linha(kit.campo('Mostrar o que vence em até', so, 'dias', 'select', { onchange: async (ev) => { so.dias = Number(ev.currentTarget.value); so.venc = null; soRender(); await soCarregarVenc(); soRender(); } }, [[30, '30 dias'], [60, '60 dias'], [90, '90 dias'], [180, '180 dias'], [365, '1 ano']])),
      h('p', { class: 'meta', text: 'Inclui os já vencidos. Renove e atualize a validade na ficha do cliente.' }));
    if (!so.venc) return [filtro, kit.carregando()];
    if (!so.venc.length) return [filtro, kit.vazio('Nada vencendo no período.')];
    const t = tipos();
    return [filtro, kit.cartao(kit.tabela(['Cliente', 'Documento', 'Número', 'Validade', 'Situação', ''], so.venc.map((d) => h('tr', {},
      h('td', {}, h('strong', { text: d.empresa }), h('span', { class: 'sub', text: formatarCnpj(d.cnpj) })),
      h('td', {}, h('strong', { text: t.documentos[d.tipo] || d.tipo }), d.descricao ? h('span', { class: 'sub', text: d.descricao }) : null), h('td', { text: d.numero || '—' }),
      h('td', { text: esData(d.validade) }), h('td', {}, kit.selo(d.situacao === 'em_dia' ? 'A vencer' : ES_SITUACAO[d.situacao].texto, d.situacao === 'em_dia' ? 'info' : ES_SITUACAO[d.situacao].tom)),
      h('td', {}, h('a', { class: 'botao pequeno', href: `#/societario/clientes/${d.empresa_id}` }, 'Ficha'))))))];
  }

  /* ----- Processos ----- */
  function soProcessos() {
    const topo = kit.cartao(kit.topo('Processos', 'Abertura, alteração contratual, baixa e transformação, com etapas e prazo.',
      podeOp() ? h('button', { type: 'button', class: 'botao primario pequeno', onclick: () => { so.form = { tipo: 'processo', empresa_id: '', proc_tipo: 'abertura', titulo: '', status: 'aberto', responsavel: '', prazo: '', observacao: '', cliente_nome: '' }; soRender(); } }, h('span', { text: 'Novo processo' })) : null),
      h('label', { class: 'marcar' }, h('input', { type: 'checkbox', checked: so.todos, onchange: async (ev) => { so.todos = ev.currentTarget.checked; so.procs = null; soRender(); await soCarregarProcs(); soRender(); } }), h('span', { text: 'Mostrar também concluídos e cancelados' })));
    const form = so.form?.tipo === 'processo' ? kit.cartao(
      !so.form.id ? kit.campo('Empresa (deixe em branco para abertura de empresa nova)', so.form, 'empresa_id', 'select', {}, kit.opcoesEmpresa(so.base.clientes, '— empresa nova (informe o nome) —')) : null,
      soFormProcesso()) : null;
    if (!so.procs) return [topo, form, kit.carregando()];
    return [topo, form, so.procs.length ? kit.cartao(soListaProcessos(so.procs, true)) : kit.vazio('Nenhum processo em aberto.')];
  }

  window.soMostrar = soMostrar;
}
