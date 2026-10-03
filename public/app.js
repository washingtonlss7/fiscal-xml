'use strict';

/* ---------- utilidades ---------- */
const $ = (id) => document.getElementById(id);

function h(tag, props, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'text') el.textContent = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const f of filhos.flat()) {
    if (f === null || f === undefined || f === false) continue;
    el.append(f instanceof Node ? f : document.createTextNode(String(f)));
  }
  return el;
}

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

function dataCurta(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR');
}

function quandoRelativo(iso) {
  if (!iso) return 'nunca';
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const horas = Math.round(min / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias < 7) return `há ${dias} dia${dias > 1 ? 's' : ''}`;
  return d.toLocaleDateString('pt-BR');
}

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
const REGIMES = { simples: 'Simples Nacional', presumido: 'Lucro Presumido', real: 'Lucro Real', mei: 'MEI' };

const STATUS = {
  ok:                   { grupo: 'ok',       tom: 'ok',       texto: () => 'Captação regular' },
  aguardando:           { grupo: 'ok',       tom: 'neutro',   texto: () => 'Aguardando 1ª captação' },
  atrasada:             { grupo: 'atencao',  tom: 'atencao',  texto: () => 'Captação atrasada' },
  certificado_vencendo: { grupo: 'atencao',  tom: 'atencao',  texto: (e) => `Certificado vence em ${e.dias_para_vencer} dia${e.dias_para_vencer === 1 ? '' : 's'}` },
  conflito_nsu:         { grupo: 'atencao',  tom: 'atencao',  texto: () => 'Outro sistema consultou a SEFAZ' },
  erro:                 { grupo: 'problema', tom: 'problema', texto: () => 'Erro na consulta' },
  certificado_vencido:  { grupo: 'problema', tom: 'problema', texto: () => 'Certificado vencido' },
  sem_certificado:      { grupo: 'problema', tom: 'problema', texto: () => 'Sem certificado' },
  pausada:              { grupo: 'pausada',  tom: 'neutro',   texto: () => 'Pausada' },
};

const FILTROS = [
  { id: 'todas',    rotulo: 'Todas',     ponto: '' },
  { id: 'ok',       rotulo: 'Captação regular', ponto: 'ok' },
  { id: 'atencao',  rotulo: 'Atenção',   ponto: 'atencao' },
  { id: 'problema', rotulo: 'Problemas', ponto: 'problema' },
  { id: 'pausada',  rotulo: 'Pausadas',  ponto: '' },
];

/* ---------- sessão ---------- */
let sessao = null;
function lerSessao() {
  try { return JSON.parse(sessionStorage.getItem('cofre-sessao') || 'null'); } catch { return null; }
}
function gravarSessao(s) {
  sessao = s;
  try {
    if (s) sessionStorage.setItem('cofre-sessao', JSON.stringify(s));
    else sessionStorage.removeItem('cofre-sessao');
  } catch { /* sem armazenamento: a sessão fica só em memória */ }
}

/** Falha de rede vira mensagem compreensível (nunca "Failed to fetch"). */
const SEM_CONEXAO = 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
async function buscar(caminho, opcoes) {
  try { return await fetch(caminho, opcoes); } catch { throw new Error(SEM_CONEXAO); }
}

async function chamar(caminho, opcoes = {}, tentouRenovar = false) {
  const cab = { 'Content-Type': 'application/json' };
  if (sessao) cab.Authorization = `Bearer ${sessao.accessToken}`;
  const resp = await buscar(caminho, {
    method: opcoes.method || 'GET',
    headers: cab,
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined,
  });
  let dados = {};
  try { dados = await resp.json(); } catch { /* resposta vazia */ }

  if (resp.status === 401 && sessao && !tentouRenovar && !caminho.startsWith('/api/entrar')) {
    const renovada = await fetch('/api/renovar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: sessao.refreshToken }),
    });
    if (renovada.ok) {
      gravarSessao(await renovada.json());
      return chamar(caminho, opcoes, true);
    }
    sair('Sua sessão expirou. Entre de novo.');
    throw new Error('Sessão expirada.');
  }
  if (!resp.ok) throw new Error(mensagemDeErro(resp.status, dados.erro));
  return dados;
}

/** Mensagem para o usuário a partir da resposta (sem detalhe técnico). */
function mensagemDeErro(status, erro) {
  if (erro) return erro;
  if (status === 403) return 'Seu perfil não permite esta ação.';
  if (status === 404) return 'Não encontrado.';
  if (status >= 500) return 'O servidor não conseguiu concluir. Tente de novo em instantes.';
  return 'Não foi possível concluir a ação.';
}

/* ---------- aviso ---------- */
/**
 * Aviso flutuante. tipo: 'info' (padrão), 'ok' ou 'erro' (ícone + texto, não só cor).
 * acao: { texto, fn } mostra um botão (ex.: "Tentar de novo").
 */
let timerAviso;
function avisar(texto, opcoes = {}) {
  const el = $('aviso');
  const tipo = opcoes.tipo || 'info';
  const iconeTipo = { ok: 'check', erro: 'circle-alert', info: null }[tipo];
  el.className = `aviso${tipo === 'erro' ? ' erro-aviso' : tipo === 'ok' ? ' ok-aviso' : ''}`;
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  el.replaceChildren(...[
    iconeTipo ? icone(iconeTipo) : null,
    h('span', { text: texto }),
    opcoes.acao ? h('button', { type: 'button', onclick: () => { el.hidden = true; opcoes.acao.fn(); } }, opcoes.acao.texto) : null,
  ].filter(Boolean));
  el.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => { el.hidden = true; }, opcoes.acao || tipo === 'erro' ? 8000 : 4000);
}

/**
 * Executa uma ação assíncrona com o botão ocupado: desabilita (evita duplo clique), mostra o giro e o texto
 * "durante" e devolve o rótulo no fim. Em erro, avisa com "Tentar de novo".
 */
const emAndamento = new Set();
async function comOcupado(botao, durante, fn, chave) {
  const k = chave || botao;
  if (k && emAndamento.has(k)) return undefined;
  if (k) emAndamento.add(k);
  // O rótulo é o <span> do botão ou o último texto dele (o ícone <svg> fica intacto)
  const rotulo = !botao ? null : botao.querySelector('span:not(.contagem)')
    || [...botao.childNodes].reverse().find((n) => n.nodeType === 3 && n.nodeValue.trim())
    || botao;
  const ler = () => (rotulo ? (rotulo.nodeType === 3 ? rotulo.nodeValue : rotulo.textContent) : '');
  const escrever = (t) => { if (!rotulo) return; if (rotulo.nodeType === 3) rotulo.nodeValue = t; else rotulo.textContent = t; };
  const textoAntes = ler();
  if (botao) { botao.disabled = true; botao.setAttribute('aria-busy', 'true'); if (durante) escrever(durante); }
  try {
    return await fn();
  } catch (err) {
    avisar(err.message, { tipo: 'erro', acao: { texto: 'Tentar de novo', fn: () => comOcupado(botao && botao.isConnected ? botao : null, durante, fn, chave) } });
    return undefined;
  } finally {
    if (k) emAndamento.delete(k);
    if (botao) { botao.disabled = false; botao.removeAttribute('aria-busy'); if (durante && ler() === durante) escrever(textoAntes); }
  }
}

/* ---------- login ---------- */
let modoLogin = 'entrar';
function trocarModo(modo) {
  modoLogin = modo;
  $('aba-entrar').classList.toggle('ativa', modo === 'entrar');
  $('aba-primeiro').classList.toggle('ativa', modo === 'primeiro');
  $('aba-entrar').setAttribute('aria-selected', String(modo === 'entrar'));
  $('aba-primeiro').setAttribute('aria-selected', String(modo === 'primeiro'));
  $('login-dica').hidden = modo !== 'primeiro';
  $('login-botao').textContent = modo === 'entrar' ? 'Entrar' : 'Criar acesso';
  $('login-senha').autocomplete = modo === 'entrar' ? 'current-password' : 'new-password';
  $('login-erro').hidden = true;
}

async function enviarLogin(ev) {
  ev.preventDefault();
  const erro = $('login-erro');
  erro.hidden = true;
  const email = $('login-email').value.trim();
  const senha = $('login-senha').value;
  if (!email || !senha) {
    erro.textContent = 'Preencha e-mail e senha.';
    erro.hidden = false;
    return;
  }
  const botao = $('login-botao');
  botao.disabled = true;
  try {
    const rota = modoLogin === 'entrar' ? '/api/entrar' : '/api/primeiro-acesso';
    const s = await chamar(rota, { method: 'POST', body: { email, senha } });
    gravarSessao(s);
    $('login-senha').value = '';
    abrirApp();
  } catch (e) {
    erro.textContent = e.message;
    erro.hidden = false;
  } finally {
    botao.disabled = false;
  }
}

function sair(mensagem) {
  gravarSessao(null);
  pararAtualizacao();
  $('tela-app').hidden = true;
  $('tela-login').hidden = false;
  fecharGaveta();
  fecharGavetaUsuario();
  perfilAtual = null;
  permissoes = [];
  if (mensagem) {
    $('login-erro').textContent = mensagem;
    $('login-erro').hidden = false;
  }
}

/* ---------- usuários ---------- */
let perfilAtual = null;
let permissoes = [];
const pode = (p) => permissoes.includes(p);
let perfis = [];
let usuarios = [];
let usuarioEmEdicao = null;
const SITUACAO_USUARIO = {
  ativo: { tom: 'ok', texto: 'Ativo' },
  aguardando: { tom: 'atencao', texto: 'Aguardando primeiro acesso' },
  desativado: { tom: 'neutro', texto: 'Desativado' },
};
const ACOES_USUARIO = {
  criar: 'cadastrou', editar: 'editou', desativar: 'desativou', reativar: 'reativou',
  redefinir_senha: 'redefiniu a senha de', excluir: 'excluiu',
};
const nomePerfil = (id) => (perfis.find((p) => p.id === id) || {}).nome || id;

function abrirUsuarios() {
  pararAtualizacao();
  $('tela-empresas').hidden = true;
  $('tela-notas').hidden = true;
  $('tela-usuarios').hidden = false;
  window.scrollTo(0, 0);
  carregarUsuarios();
}

function fecharUsuarios() {
  fecharGavetaUsuario();
  $('tela-usuarios').hidden = true;
  $('tela-empresas').hidden = false;
  carregarEmpresas();
  iniciarAtualizacao();
}

async function carregarUsuarios() {
  try {
    const r = await chamar('/api/usuarios');
    usuarios = r.usuarios;
    perfis = r.perfis;
    renderUsuarios();
    renderHistorico(r.historico);
  } catch (e) {
    $('usuarios-lista').replaceChildren(h('p', { class: 'erro', text: e.message }));
  }
}

function renderUsuarios() {
  const eu = (sessao && sessao.email) || '';
  const linhas = usuarios.map((u) => {
    const sit = SITUACAO_USUARIO[u.situacao] || SITUACAO_USUARIO.ativo;
    return h('tr', { class: u.situacao === 'desativado' ? 'desativado' : '' },
      h('td', {}, h('strong', { text: u.nome || u.email }), u.email === eu ? h('span', { class: 'selo-mini', text: 'você' }) : null,
        u.nome ? h('span', { class: 'sub', text: u.email }) : null),
      h('td', {}, nomePerfil(u.perfil), u.fixo ? h('span', { class: 'sub', text: 'Fixo no servidor' }) : null),
      h('td', {}, h('span', { class: `selo ${sit.tom}`, text: sit.texto })),
      h('td', {}, u.ultimoAcesso ? quandoRelativo(u.ultimoAcesso) : '—'),
      h('td', { class: 'acoes-u' }, u.fixo ? null : h('button', { type: 'button', class: 'botao pequeno', onclick: () => abrirGavetaUsuario(u), text: 'Editar' })),
    );
  });
  $('usuarios-lista').replaceChildren(h('table', { class: 'usuarios' },
    h('thead', {}, h('tr', {}, ...['Usuário', 'Perfil', 'Situação', 'Último acesso', ''].map((t) => h('th', { scope: 'col', text: t })))),
    h('tbody', {}, ...linhas)));
}

function renderHistorico(hist) {
  const itens = (hist || []).map((x) => {
    const quem = usuarios.find((u) => u.email === x.por);
    const alvo = usuarios.find((u) => u.email === x.alvo);
    return h('li', {}, h('strong', { text: (quem && quem.nome) || x.por }), ` ${ACOES_USUARIO[x.acao] || x.acao} `,
      h('strong', { text: (alvo && alvo.nome) || x.alvo }), ` · ${quandoRelativo(x.em)}`);
  });
  $('usuarios-historico').replaceChildren(...(itens.length ? itens : [h('li', { class: 'vazio-hist', text: 'Nenhuma alteração registrada ainda.' })]));
}

function preencherPerfis(atual) {
  $('gu-perfil').replaceChildren(...perfis.map((p) => h('option', { value: p.id, text: p.nome, selected: p.id === atual })));
  mostrarDicaPerfil();
}
function mostrarDicaPerfil() {
  const p = perfis.find((x) => x.id === $('gu-perfil').value);
  $('gu-perfil-dica').textContent = p ? p.descricao : '';
}

function abrirGavetaUsuario(u) {
  usuarioEmEdicao = u;
  const eu = (sessao && sessao.email) || '';
  const proprio = !!u && u.email === eu;
  $('gu-titulo').textContent = u ? 'Editar usuário' : 'Novo usuário';
  $('gu-nome').value = u ? (u.nome || '') : '';
  $('gu-email').value = u ? u.email : '';
  $('gu-email').disabled = !!u;
  preencherPerfis(u ? u.perfil : 'analista');
  $('gu-perfil').disabled = proprio;
  $('gu-ativo-campo').hidden = !u;
  $('gu-ativo').checked = u ? u.ativo : true;
  $('gu-ativo').disabled = proprio;
  $('gu-situacao').hidden = !(u && (proprio || u.situacao === 'aguardando'));
  $('gu-situacao').textContent = proprio
    ? 'Este é o seu usuário: você pode mudar o nome, mas perfil e acesso só outro administrador altera.'
    : 'Esta pessoa ainda não criou a senha. Peça para ela abrir o painel e usar "Primeiro acesso" com este e-mail.';
  $('gu-perigo').hidden = !u || proprio;
  $('gu-redefinir').disabled = !!u && u.situacao === 'aguardando';
  $('gu-confirmar').hidden = true;
  $('gu-confirmacao').value = '';
  $('gu-erro').hidden = true;
  abrirDialogo($('gu'));
  $('gu-fundo').hidden = false;
  $('gu').hidden = false;
  $('gu-nome').focus();
}

function fecharGavetaUsuario() {
  const estavaAberta = !$('gu').hidden;
  $('gu-fundo').hidden = true;
  $('gu').hidden = true;
  usuarioEmEdicao = null;
  if (estavaAberta) fecharDialogo($('gu'));
}

/* ---------- diálogos (gaveta e folha inferior): foco preso dentro, rolagem travada e foco devolvido ao fechar ---------- */
const focoAnterior = new Map();
function abrirDialogo(el) {
  if (!focoAnterior.has(el)) focoAnterior.set(el, document.activeElement);
  document.body.classList.add('com-dialogo');
}
function fecharDialogo(el) {
  document.body.classList.toggle('com-dialogo', [...document.querySelectorAll('[aria-modal="true"]')].some((d) => !d.hidden));
  const antes = focoAnterior.get(el);
  focoAnterior.delete(el);
  if (antes && antes.isConnected && typeof antes.focus === 'function') antes.focus();
}
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Tab') return;
  const d = [...document.querySelectorAll('[aria-modal="true"]')].find((x) => !x.hidden);
  if (!d) return;
  const focaveis = [...d.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])')]
    .filter((x) => x.offsetParent !== null);
  if (!focaveis.length) return;
  const primeiro = focaveis[0]; const ultimo = focaveis[focaveis.length - 1];
  if (!d.contains(document.activeElement)) { ev.preventDefault(); primeiro.focus(); return; }
  if (ev.shiftKey && document.activeElement === primeiro) { ev.preventDefault(); ultimo.focus(); }
  else if (!ev.shiftKey && document.activeElement === ultimo) { ev.preventDefault(); primeiro.focus(); }
});

function erroUsuario(msg) {
  $('gu-erro').textContent = msg;
  $('gu-erro').hidden = false;
}

async function acaoUsuario(botao, fn, mensagem) {
  $('gu-erro').hidden = true;
  botao.disabled = true;
  try {
    await fn();
    fecharGavetaUsuario();
    avisar(mensagem);
    await carregarUsuarios();
  } catch (e) {
    erroUsuario(e.message);
  } finally {
    botao.disabled = false;
  }
}

function salvarUsuario(ev) {
  ev.preventDefault();
  const nome = $('gu-nome').value.trim();
  const email = $('gu-email').value.trim().toLowerCase();
  const perfil = $('gu-perfil').value;
  if (nome.length < 2) return erroUsuario('Informe o nome da pessoa.');
  const u = usuarioEmEdicao;
  if (!u) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return erroUsuario('Informe um e-mail válido.');
    return acaoUsuario($('gu-salvar'), () => chamar('/api/usuarios', { method: 'POST', body: { nome, email, perfil } }),
      `${nome} cadastrado. Peça para usar "Primeiro acesso" com ${email}.`);
  }
  const corpo = { nome };
  if (!$('gu-perfil').disabled) corpo.perfil = perfil;
  if (!$('gu-ativo').disabled) corpo.ativo = $('gu-ativo').checked;
  return acaoUsuario($('gu-salvar'), () => chamar(`/api/usuarios/${encodeURIComponent(u.email)}`, { method: 'PATCH', body: corpo }), 'Usuário atualizado.');
}

function redefinirSenhaUsuario() {
  const u = usuarioEmEdicao;
  if (!u) return;
  if (!window.confirm(`Apagar a senha de ${u.nome || u.email}? A pessoa vai precisar criar outra em "Primeiro acesso".`)) return;
  acaoUsuario($('gu-redefinir'), () => chamar(`/api/usuarios/${encodeURIComponent(u.email)}/redefinir-senha`, { method: 'POST' }),
    'Senha apagada. A pessoa cria outra em "Primeiro acesso".');
}

function excluirUsuario() {
  const u = usuarioEmEdicao;
  if (!u) return;
  const confirmacao = $('gu-confirmacao').value.trim().toLowerCase();
  if (confirmacao !== u.email) return erroUsuario('O e-mail digitado não confere.');
  acaoUsuario($('gu-excluir-ok'), () => chamar(`/api/usuarios/${encodeURIComponent(u.email)}`, { method: 'DELETE', body: { confirmacao } }),
    'Usuário excluído.');
}

/* ---------- shell: sidebar, header, competência e rotas ---------- */
const SVG_NS = 'http://www.w3.org/2000/svg';
function icone(nome, classe = 'icone-svg') {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', classe);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `/icones.svg#i-${nome}`);
  svg.append(use);
  return svg;
}
function trocarIcone(svg, nome) { svg.querySelector('use').setAttribute('href', `/icones.svg#i-${nome}`); }

/*
 * Itens do menu. Só tem "rota" o que já existe; o resto aparece como "Em breve" e não navega.
 * "permissao" esconde o item de quem não pode usar (o servidor confere de novo em cada chamada).
 */
const NAV = [
  { id: 'visao-geral', rotulo: 'Visão Geral', icone: 'layout-dashboard', rota: '#/visao-geral' },
  { id: 'empresas', rotulo: 'Empresas', icone: 'building-2', rota: '#/empresas' },
  { id: 'captacao', rotulo: 'Captação', icone: 'cloud-download', filhos: [
    { id: 'coletores', rotulo: 'Appura Coletor', rota: '#/coletores' }, { rotulo: 'Monitor' }, { rotulo: 'Lacunas / NSU' }, { rotulo: 'Importações' }, { rotulo: 'Histórico' },
  ] },
  { id: 'notas', rotulo: 'Notas Fiscais', icone: 'file-text', rota: '#/notas' },
  { id: 'auditoria', rotulo: 'Auditoria', icone: 'shield-check' },
  { id: 'icms-st', rotulo: 'ICMS-ST', icone: 'calculator' },
  { id: 'sped', rotulo: 'SPED e cadastro', icone: 'file-spreadsheet', rota: '#/sped' },
  { id: 'guias', rotulo: 'Guias', icone: 'receipt', rota: '#/guias' },
  { id: 'fechamento', rotulo: 'Fechamento', icone: 'clipboard-check', rota: '#/fechamento' },
  { id: 'atendimento', rotulo: 'Atendimento', icone: 'message-circle' },
  { id: 'relatorios', rotulo: 'Relatórios', icone: 'chart-column' },
  { id: 'administracao', rotulo: 'Administração', icone: 'settings', filhos: [
    { id: 'usuarios', rotulo: 'Usuários', rota: '#/usuarios', permissao: 'usuarios' },
    { id: 'escritorio', rotulo: 'Escritório', rota: '#/escritorio', permissao: 'certificados' },
    { id: 'ia', rotulo: 'Conexões de IA', rota: '#/ia' },
    { rotulo: 'Certificados' }, { rotulo: 'Configurações' },
  ] },
];
const NAV_RODAPE = [{ id: 'ajuda', rotulo: 'Ajuda', icone: 'circle-help' }];
const PERFIL_NOME = { admin: 'Administrador', supervisor: 'Supervisor', analista: 'Analista', consulta: 'Consulta' };

let gruposAbertos = new Set(['administracao']);
try { gruposAbertos = new Set(JSON.parse(localStorage.getItem('appura-grupos') || '["administracao"]')); } catch { /* sem armazenamento */ }
/** Item com permissão só para quem pode; grupo com itens restritos só aparece se algum deles estiver liberado. */
const visivel = (item) => (!item.permissao || pode(item.permissao))
  && (!item.filhos || !item.filhos.some((f) => f.permissao) || item.filhos.some((f) => f.rota && visivel(f)));
const ehCelular = () => window.matchMedia('(max-width: 760px)').matches;

function itemNav(item, sub = false) {
  const conteudo = [sub ? null : icone(item.icone), h('span', { class: 'nav-rotulo', text: item.rotulo })];
  if (item.rota) {
    return h('li', {}, h('a', { class: 'nav-item', href: item.rota, 'data-rota': item.rota, 'data-rotulo': item.rotulo }, ...conteudo));
  }
  if (item.filhos) {
    const filhos = item.filhos.filter(visivel);
    const aberto = gruposAbertos.has(item.id);
    const lista = h('ul', { class: 'nav-sub', id: `sub-${item.id}`, hidden: !aberto }, ...filhos.map((f) => itemNav(f, true)));
    const botao = h('button', {
      type: 'button', class: 'nav-item', 'aria-expanded': String(aberto), 'aria-controls': `sub-${item.id}`, 'data-rotulo': item.rotulo,
      onclick: () => {
        if ($('tela-app').classList.contains('recolhida') && !ehCelular()) { alternarLateral(); if (gruposAbertos.has(item.id)) return; }
        const abrir = lista.hidden;
        lista.hidden = !abrir;
        botao.setAttribute('aria-expanded', String(abrir));
        if (abrir) gruposAbertos.add(item.id); else gruposAbertos.delete(item.id);
        try { localStorage.setItem('appura-grupos', JSON.stringify([...gruposAbertos])); } catch { /* ok */ }
      },
    }, ...conteudo, icone('chevron-down', 'icone-svg nav-seta'));
    return h('li', {}, botao, lista);
  }
  return h('li', {}, h('span', {
    class: 'nav-item em-breve', 'aria-disabled': 'true', 'data-rotulo': `${item.rotulo} (em breve)`,
  }, ...conteudo, h('span', { class: 'nav-breve', text: 'Em breve' })));
}

function renderNav() {
  $('nav-principal').replaceChildren(
    h('ul', { class: 'nav' }, ...NAV.filter(visivel).map((i) => itemNav(i))),
    h('div', { class: 'nav-divisor' }),
    h('ul', { class: 'nav sidebar-rodape' }, ...NAV_RODAPE.map((i) => itemNav(i))),
  );
  marcarNav();
}

function rotaBase() {
  return resolverRota(location.hash, pode).base || '#/visao-geral';
}
function marcarNav() {
  const r = rotaBase();
  for (const a of document.querySelectorAll('#nav-principal a.nav-item, #nav-inferior a[data-rota]')) {
    if (a.dataset.rota === r) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
}

/* Sidebar recolhida (desktop/tablet) ou gaveta (celular) */
function lerPreferenciaLateral() {
  try { const v = localStorage.getItem('appura-lateral'); if (v) return v === 'recolhida'; } catch { /* ok */ }
  return window.matchMedia('(max-width: 1100px)').matches;
}
function atualizarBotaoLateral() {
  const shell = $('tela-app');
  const botao = $('botao-lateral');
  const svg = botao.querySelector('svg');
  if (ehCelular()) {
    trocarIcone(svg, shell.classList.contains('menu-aberto') ? 'x' : 'menu');
    botao.setAttribute('aria-label', shell.classList.contains('menu-aberto') ? 'Fechar menu' : 'Abrir menu');
    botao.setAttribute('aria-expanded', String(shell.classList.contains('menu-aberto')));
  } else {
    const rec = shell.classList.contains('recolhida');
    trocarIcone(svg, rec ? 'panel-left-open' : 'panel-left-close');
    botao.setAttribute('aria-label', rec ? 'Expandir menu' : 'Recolher menu');
    botao.removeAttribute('aria-expanded');
  }
}
function alternarLateral() {
  const shell = $('tela-app');
  if (ehCelular()) {
    shell.classList.toggle('menu-aberto');
  } else {
    const rec = shell.classList.toggle('recolhida');
    try { localStorage.setItem('appura-lateral', rec ? 'recolhida' : 'aberta'); } catch { /* ok */ }
    esconderDica();
  }
  atualizarBotaoLateral();
}
function fecharMenuCelular() {
  $('tela-app').classList.remove('menu-aberto');
  atualizarBotaoLateral();
}

/* Dica com o nome do item quando a sidebar está recolhida */
let dicaEl = null;
function mostrarDica(ev) {
  const alvo = ev.target.closest('.nav-item');
  if (!alvo || !$('tela-app').classList.contains('recolhida') || ehCelular()) return;
  esconderDica();
  const r = alvo.getBoundingClientRect();
  dicaEl = h('div', { class: 'dica-lateral', role: 'tooltip', text: alvo.dataset.rotulo || '' });
  document.body.append(dicaEl);
  dicaEl.style.left = `${r.right + 10}px`;
  dicaEl.style.top = `${r.top + r.height / 2 - dicaEl.offsetHeight / 2}px`;
}
function esconderDica() { if (dicaEl) { dicaEl.remove(); dicaEl = null; } }

/* Competência (mês de trabalho). Controla o mês das notas, auditoria e ST da empresa. */
let competencia = null;
function somarMes(v, n) {
  const [a, m] = v.split('-').map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function definirCompetencia(v, recarregar = true) {
  if (!/^\d{4}-\d{2}$/.test(v || '')) return;
  const mudou = v !== competencia;
  competencia = v;
  $('comp-texto').textContent = textoCompetencia(v);
  $('comp-mes').value = v;
  $('comp-seguinte').disabled = v >= mesAtual();
  try { sessionStorage.setItem('appura-competencia', v); } catch { /* ok */ }
  if ($('notas-mes').value !== v) $('notas-mes').value = v;
  if (mudou && recarregar && !$('tela-notas').hidden) recarregarAba();
  if (mudou) window.dispatchEvent(new CustomEvent('appura:competencia', { detail: v }));
}

/* Busca global: filtra a lista de empresas */
let timerBuscaGlobal;
function buscarGlobal(imediato) {
  clearTimeout(timerBuscaGlobal);
  const aplicar = () => {
    termo = $('busca-global').value.trim();
    $('busca').value = termo;
    if (location.hash !== '#/empresas') irPara('#/empresas'); else renderLista();
  };
  if (imediato) aplicar(); else timerBuscaGlobal = setTimeout(aplicar, 250);
}

/* Sino: empresas com problema (certificado vencido, sem certificado, erro na consulta) */
function atualizarSino() {
  const n = empresas.filter((e) => grupoDe(e) === 'problema').length;
  const c = $('sino-contador');
  c.hidden = n === 0;
  c.textContent = n > 99 ? '99+' : String(n);
  $('botao-sino').setAttribute('aria-label', n ? `Notificações: ${n} empresa${n === 1 ? '' : 's'} com problema` : 'Notificações: nada pendente');
  $('botao-sino').title = n ? `${n} empresa${n === 1 ? '' : 's'} com problema` : 'Nada pendente';
}
function abrirSino() {
  filtro = 'problema';
  termo = ''; $('busca').value = '';
  irPara('#/empresas');
  renderResumo();
  renderLista();
}

/* Menu do usuário */
function alternarMenuUsuario(abrir) {
  const menu = $('usuario-menu');
  const aberto = abrir ?? menu.hidden;
  menu.hidden = !aberto;
  $('usuario-botao').setAttribute('aria-expanded', String(aberto));
}
function preencherUsuario(eu) {
  const nome = (eu && eu.nome) || (sessao && sessao.email) || '';
  const partes = nome.replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
  const iniciais = ((partes[0] || '?')[0] + (partes.length > 1 ? partes[partes.length - 1][0] : (partes[0] || '')[1] || '')).toUpperCase();
  $('usuario-avatar').textContent = iniciais;
  $('usuario-nome').textContent = eu && eu.nome ? eu.nome : nome.replace(/@.*/, '');
  $('usuario-perfil').textContent = PERFIL_NOME[perfilAtual] || '';
  $('usuario-email').textContent = (sessao && sessao.email) || '';
}

/* Rotas por endereço: #/empresas, #/empresas/<id>, #/usuarios */
function irPara(rota) {
  if (location.hash === rota) aplicarRota(); else location.hash = rota;
}
async function aplicarRota() {
  if (!sessao || $('tela-app').hidden) return;
  fecharMenuCelular();
  alternarMenuUsuario(false);
  const rota = resolverRota(location.hash, pode);
  if (rota.redirecionar) {
    if (rota.semPermissao) avisar(`Seu perfil não tem acesso a ${rota.semPermissao}. Fale com um administrador.`, { tipo: 'erro' });
    location.replace(rota.redirecionar);
    return;
  }
  const esconderTudo = (menos) => {
    for (const id of ['tela-visao', 'tela-fechamento', 'tela-empresas', 'tela-notas', 'tela-usuarios', 'tela-sped', 'tela-guias', 'tela-escritorio', 'tela-ia', 'tela-xml', 'tela-coletores']) if (id !== menos) $(id).hidden = true;
  };
  if (rota.tela !== 'empresa') { empresaNotas = null; fecharGavetaUsuario(); }
  if (rota.tela === 'fechamento') {
    esconderTudo('tela-fechamento');
    window.fcMostrar(rota.consulta);
  } else if (rota.tela === 'sped') {
    esconderTudo('tela-sped');
    window.spMostrar(rota.consulta);
  } else if (rota.tela === 'guias') {
    esconderTudo('tela-guias');
    window.guMostrar();
  } else if (rota.tela === 'escritorio') {
    esconderTudo('tela-escritorio');
    window.esMostrar();
  } else if (rota.tela === 'ia') {
    esconderTudo('tela-ia');
    window.iaMostrar();
  } else if (rota.tela === 'coletores') {
    esconderTudo('tela-coletores');
    window.clMostrar();
  } else if (rota.tela === 'xml') {
    esconderTudo('tela-xml');
    window.bxMostrar(rota.consulta);
  } else if (rota.tela === 'visao') {
    esconderTudo('tela-visao');
    window.vgMostrar();
  } else if (rota.tela === 'usuarios') {
    if ($('tela-usuarios').hidden) { esconderTudo('tela-usuarios'); abrirUsuarios(); }
  } else if (rota.tela === 'empresa') {
    let e = empresas.find((x) => x.id === rota.id);
    if (!e) { await carregarEmpresas(); e = empresas.find((x) => x.id === rota.id); }
    if (!e) { avisar('Empresa não encontrada.', { tipo: 'erro' }); location.replace('#/empresas'); return; }
    if (!empresaNotas || empresaNotas.id !== e.id || $('tela-notas').hidden) {
      esconderTudo('tela-notas');
      fecharGavetaUsuario();
      abrirNotas(e, rota.aba);
    } else if (abaAtual !== rota.aba) trocarAba(rota.aba, false);
  } else if (rota.tela === 'empresas') {
    const vindoDeOutra = $('tela-empresas').hidden;
    esconderTudo('tela-empresas');
    $('tela-empresas').hidden = false;
    if (vindoDeOutra) { window.scrollTo(0, 0); carregarEmpresas(); iniciarAtualizacao(); }
  }
  marcarNav();
}

function ligarShell() {
  $('botao-lateral').addEventListener('click', alternarLateral);
  $('lateral-fundo').addEventListener('click', fecharMenuCelular);
  $('nav-principal').addEventListener('mouseover', mostrarDica);
  $('nav-principal').addEventListener('focusin', mostrarDica);
  $('nav-principal').addEventListener('mouseout', esconderDica);
  $('nav-principal').addEventListener('focusout', esconderDica);
  $('nav-principal').addEventListener('click', (ev) => { if (ev.target.closest('a.nav-item') && ehCelular()) fecharMenuCelular(); });
  window.matchMedia('(max-width: 760px)').addEventListener('change', () => { $('tela-app').classList.remove('menu-aberto'); atualizarBotaoLateral(); });
  window.addEventListener('hashchange', aplicarRota);

  $('comp-anterior').addEventListener('click', () => definirCompetencia(somarMes(competencia, -1)));
  $('comp-seguinte').addEventListener('click', () => definirCompetencia(somarMes(competencia, 1)));
  $('comp-mes').addEventListener('change', (e) => definirCompetencia(e.target.value));
  $('comp-mes').addEventListener('click', (e) => { try { e.target.showPicker(); } catch { /* navegador sem seletor de mês: use as setas */ } });

  $('busca-global-form').addEventListener('submit', (e) => { e.preventDefault(); buscarGlobal(true); });
  $('busca-global').addEventListener('input', () => buscarGlobal(false));
  $('botao-sino').addEventListener('click', abrirSino);
  $('filtro-status-limpar').addEventListener('click', () => { filtro = 'todas'; renderResumo(); renderLista(); });
  $('nav-inf-notificacoes').addEventListener('click', abrirSino);
  $('nav-inf-mais').addEventListener('click', () => { $('tela-app').classList.add('menu-aberto'); atualizarBotaoLateral(); });

  $('usuario-botao').addEventListener('click', (e) => { e.stopPropagation(); alternarMenuUsuario(); });
  for (const b of document.querySelectorAll('.menu-tema [data-tema]')) {
    b.addEventListener('click', (ev) => { ev.stopPropagation(); aplicarTema(b.dataset.tema); });
  }
  try { aplicarTema(localStorage.getItem('appura-tema') || 'auto'); } catch { aplicarTema('auto'); }
  document.addEventListener('click', (e) => { if (!e.target.closest('.usuario-menu')) alternarMenuUsuario(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    alternarMenuUsuario(false);
    if ($('tela-app').classList.contains('menu-aberto')) fecharMenuCelular();
  });
}

/* ---------- lista de empresas ---------- */
let empresas = [];
let filtro = 'todas';
let termo = '';
let timerAtualizacao;
const confirmando = new Set();

function grupoDe(e) { return (STATUS[e.status] || STATUS.aguardando).grupo; }

function renderResumo() {
  atualizarSino();
  const cont = { todas: empresas.length, ok: 0, atencao: 0, problema: 0, pausada: 0 };
  for (const e of empresas) cont[grupoDe(e)]++;
  const nav = $('resumo');
  nav.replaceChildren(...FILTROS.map((f) =>
    h('button', {
      type: 'button', class: 'filtro', 'aria-pressed': String(filtro === f.id),
      onclick: () => { filtro = f.id; renderResumo(); renderLista(); },
    },
    h('span', { class: 'rotulo' }, f.ponto ? h('span', { class: `ponto ${f.ponto}` }) : null, f.rotulo),
    h('span', { class: 'numero', text: String(cont[f.id]) })),
  ));
}

function celula(rotulo, ...conteudo) {
  return h('div', { class: 'celula' }, h('span', { class: 'rotulo-movel', text: rotulo }), ...conteudo);
}

function linhaEmpresa(e) {
  const st = STATUS[e.status] || STATUS.aguardando;
  const certificado = e.certificado_valido_ate
    ? [h('span', { class: 'valor', text: `até ${dataCurta(e.certificado_valido_ate)}` }),
       h('span', { class: 'meta', text: e.titular || '' })]
    : [h('span', { class: 'meta', text: 'Nenhum certificado ativo' })];

  const sincronizacao = [
    h('span', { class: 'valor', text: quandoRelativo(e.ultima_sync_ok_em) }),
    e.sincronizacao_pedida ? h('span', { class: 'meta', text: 'Sincronização pedida' }) : null,
  ];

  const botaoPausa = confirmando.has(e.id)
    ? h('button', { type: 'button', class: 'botao pequeno perigo', onclick: (ev) => alternarAtivo(e, ev.currentTarget) }, e.ativo ? 'Confirmar pausa' : 'Confirmar')
    : h('button', { type: 'button', class: 'botao fantasma pequeno', onclick: () => { confirmando.add(e.id); renderLista(); setTimeout(() => { confirmando.delete(e.id); renderLista(); }, 5000); } }, e.ativo ? 'Pausar' : 'Reativar');

  return h('div', { class: `empresa${e.ativo ? '' : ' pausada'}` },
    celula('Empresa',
      h('span', { class: 'nome' }, e.razao_social, e.escritorio ? h('span', { class: 'selo-mini', text: 'Escritório' }) : null),
      h('span', { class: 'cnpj' }, formatarCnpj(e.cnpj), ` · ${e.uf}`, e.regime ? ` · ${REGIMES[e.regime] || e.regime}` : '', e.codigo_erp ? ` · cód. ${e.codigo_erp}` : ''),
    ),
    celula('Situação',
      h('span', { class: `selo ${st.tom}` }, st.texto(e)),
      e.status === 'erro' && e.ultimo_motivo ? h('span', { class: 'motivo', text: `${e.ultimo_cstat ? e.ultimo_cstat + ' · ' : ''}${e.ultimo_motivo}` }) : null,
      e.status === 'conflito_nsu' ? h('span', { class: 'meta', text: 'Outro programa (ex.: Sieg) baixou notas deste CNPJ. O Appura já corrigiu e busca as notas na próxima janela.' }) : null,
      Number(e.pendencias_auditoria) ? h('span', { class: 'meta', text: `${e.pendencias_auditoria} pendência${Number(e.pendencias_auditoria) === 1 ? '' : 's'} na auditoria` }) : null,
    ),
    celula('Certificado', ...certificado),
    celula('Última captação', ...sincronizacao,
      h('span', { class: 'meta', text: `${e.documentos_30d} nota${Number(e.documentos_30d) === 1 ? '' : 's'} em 30 dias` })),
    h('div', { class: 'acoes' },
      h('button', { type: 'button', class: 'botao pequeno primario', onclick: () => irPara(`#/empresas/${e.id}`) }, 'Abrir'),
      pode('operar') ? h('button', {
        type: 'button', class: 'botao pequeno', disabled: !e.ativo || e.sincronizacao_pedida || !e.certificado_valido_ate,
        onclick: (ev) => sincronizar(e, ev.currentTarget),
      }, 'Sincronizar') : null,
      pode('certificados') ? h('button', { type: 'button', class: 'botao fantasma pequeno', onclick: () => abrirGaveta(e) }, 'Trocar certificado') : null,
      pode('certificados') ? botaoPausa : null,
    ),
  );
}

function renderLista() {
  const t = termo.toLowerCase();
  const td = soDigitos(termo);
  const visiveis = empresas.filter((e) =>
    (filtro === 'todas' || grupoDe(e) === filtro || (filtro.startsWith('status:') && filtro.slice(7).split(',').includes(e.status))) &&
    (!t || e.razao_social.toLowerCase().includes(t) || (td && e.cnpj.includes(td)) || (e.codigo_erp || '').toLowerCase().includes(t)));

  const lista = $('lista');
  const vazio = $('vazio');
  const chip = $('filtro-status');
  chip.hidden = !filtro.startsWith('status:');
  if (!chip.hidden) {
    const nomes = filtro.slice(7).split(',').map((st) => (STATUS[st] ? STATUS[st].texto({ dias_para_vencer: 30 }) : st));
    $('filtro-status-texto').textContent = `Mostrando: ${nomes.join(', ')}`;
  }
  if (!empresas.length) {
    lista.replaceChildren();
    vazio.textContent = 'Nenhuma empresa cadastrada ainda. Use "Adicionar empresa" para enviar o primeiro certificado.';
    vazio.hidden = false;
    return;
  }
  if (!visiveis.length) {
    lista.replaceChildren();
    vazio.textContent = 'Nenhuma empresa encontrada com esse filtro.';
    vazio.hidden = false;
    return;
  }
  vazio.hidden = true;
  lista.replaceChildren(
    h('div', { class: 'cabecalho-lista', 'aria-hidden': 'true' },
      h('span', { text: 'Empresa' }), h('span', { text: 'Situação' }), h('span', { text: 'Certificado' }),
      h('span', { text: 'Última captação' }), h('span', { text: '' })),
    ...visiveis.map(linhaEmpresa),
  );
}

async function carregarEmpresas() {
  try {
    const r = await chamar('/api/empresas');
    empresas = r.empresas || [];
    $('atualizado').textContent = `${aoVivo ? 'Ao vivo · ' : ''}Atualizado às ${new Date(r.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    renderResumo();
    renderLista();
  } catch (e) {
    if (sessao) avisar(e.message);
  }
}

/* Tempo real: o servidor avisa quando algo muda (Supabase Realtime) e a tela recarrega sozinha.
   Se a conexão cair, reconecta; como garantia, também recarrega a cada 5 minutos. */
let eventosAbortar = null;
let aoVivo = false;
let recargaPendente = null;

function marcarAoVivo(ativo) {
  aoVivo = ativo;
  $('atualizado').classList.toggle('ao-vivo', ativo);
  $('atualizado').title = ativo ? 'Atualiza sozinho quando algo muda' : 'Reconectando…';
}

function recarregarPorEvento() {
  clearTimeout(recargaPendente);
  recargaPendente = setTimeout(() => {
    if (document.hidden) return;
    if (!$('tela-empresas').hidden) carregarEmpresas();
    else if (!$('tela-visao').hidden || !$('tela-fechamento').hidden) { carregarEmpresas(); window.vgCarregar(); }
    else if (empresaNotas && !$('tela-notas').hidden) {
      if (abaAtual === 'auditoria') carregarAuditoria();
      if (['visao', 'arquivos', 'historico'].includes(abaAtual)) window.e360Carregar();
    }
  }, 400);
}

async function conectarEventos(tentativa = 0) {
  if (!sessao) return;
  const controle = new AbortController();
  eventosAbortar = controle;
  try {
    let resp = await fetch('/api/eventos', { headers: { Authorization: `Bearer ${sessao.accessToken}` }, signal: controle.signal });
    if (resp.status === 401) {
      await chamar('/api/eu').catch(() => {});
      resp = await fetch('/api/eventos', { headers: { Authorization: `Bearer ${sessao.accessToken}` }, signal: controle.signal });
    }
    if (!resp.ok || !resp.body) throw new Error(`eventos ${resp.status}`);
    marcarAoVivo(true);
    tentativa = 0;
    const leitor = resp.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      buffer += value;
      let fim;
      while ((fim = buffer.indexOf('\n\n')) >= 0) {
        const bloco = buffer.slice(0, fim);
        buffer = buffer.slice(fim + 2);
        if (/^event: mudou/m.test(bloco)) recarregarPorEvento();
      }
    }
  } catch (e) {
    if (controle.signal.aborted) return;
  }
  if (controle.signal.aborted || !sessao) return;
  marcarAoVivo(false);
  // Reconecta com espera crescente (2 s, 4 s, 8 s... até 60 s)
  setTimeout(() => conectarEventos(tentativa + 1), Math.min(60000, 2000 * 2 ** tentativa));
}

function iniciarAtualizacao() {
  pararAtualizacao();
  timerAtualizacao = setInterval(() => { if (!document.hidden) carregarEmpresas(); }, 300000);
  conectarEventos();
}
function pararAtualizacao() {
  clearInterval(timerAtualizacao);
  if (eventosAbortar) eventosAbortar.abort();
  eventosAbortar = null;
  marcarAoVivo(false);
}
// Ao voltar para a aba, atualiza na hora (o navegador pode ter pausado a conexão)
document.addEventListener('visibilitychange', () => { if (!document.hidden && sessao && !$('tela-app').hidden) recarregarPorEvento(); });

async function sincronizar(e, botao) {
  return comOcupado(botao, 'Sincronizando…', async () => {
    const r = await chamar(`/api/empresas/${e.id}/sincronizar`, { method: 'POST' });
    e.sincronizacao_pedida = true;
    renderLista();
    avisar(r.mensagem, { tipo: 'ok' });
    if (window.scAcompanhar) window.scAcompanhar(e);
  }, `sincronizar:${e.id}`);
}

async function alternarAtivo(e, botao) {
  confirmando.delete(e.id);
  return comOcupado(botao, e.ativo ? 'Pausando…' : 'Reativando…', async () => {
    await chamar(`/api/empresas/${e.id}/ativo`, { method: 'POST', body: { ativo: !e.ativo } });
    avisar(e.ativo ? 'Empresa pausada. O coletor deixa de consultá-la.' : 'Empresa reativada.', { tipo: 'ok' });
    await carregarEmpresas();
  }, `ativo:${e.id}`);
}

/* ---------- gaveta de cadastro ---------- */
let arquivoEscolhido = null;
let empresaEmEdicao = null;

function preencherUfs() {
  $('uf').replaceChildren(...UFS.map((u) => h('option', { value: u, text: u })));
  $('uf').value = 'ES';
}

function limparFormulario() {
  arquivoEscolhido = null;
  $('arquivo').value = '';
  $('arquivo-nome').textContent = 'Selecione o certificado A1';
  $('arquivo-detalhe').textContent = 'Arquivo .pfx ou .p12. Clique ou arraste aqui.';
  $('area-arquivo').classList.remove('escolhido');
  $('senha').value = '';
  $('senha').type = 'password';
  $('mostrar-senha').textContent = 'Mostrar';
  $('mostrar-senha').setAttribute('aria-pressed', 'false');
  $('razao').value = '';
  $('codigo-erp').value = '';
  $('cnpj').value = '';
  $('escritorio').checked = false;
  $('form-erro').hidden = true;
  $('form-sucesso').hidden = true;
  $('form-enviar').disabled = false;
}

function abrirGaveta(empresa, modo) {
  limparFormulario();
  empresaEmEdicao = empresa || null;
  gavetaModo = modo || null;
  $('gaveta-titulo').textContent = modo === 'escritorio' ? (empresa ? 'Trocar certificado do escritório' : 'Cadastrar escritório') : empresa ? 'Trocar certificado' : 'Adicionar empresa';
  const ctx = $('gaveta-contexto');
  if (empresa) {
    ctx.textContent = `${empresa.razao_social} · ${formatarCnpj(empresa.cnpj)}`;
    ctx.hidden = false;
    $('uf').value = empresa.uf;
    $('regime').value = empresa.regime || '';
    $('codigo-erp').value = empresa.codigo_erp || '';
    $('cnpj').value = empresa.cnpj;
    $('escritorio').checked = !!empresa.escritorio;
  } else {
    ctx.hidden = true;
    $('uf').value = 'ES';
    $('regime').value = '';
  }
  if (modo === 'escritorio') {
    $('escritorio').checked = true;
    if (!empresa) {
      ctx.textContent = 'Use o certificado e-CNPJ (A1) do escritório: o mesmo CNPJ do contrato do Integra Contador no SERPRO. Se o escritório já está cadastrado como empresa, o certificado é atualizado e ela passa a ser o escritório.';
      ctx.hidden = false;
    }
  }
  abrirDialogo($('gaveta'));
  $('gaveta-fundo').hidden = false;
  $('gaveta').hidden = false;
  $('area-arquivo').focus();
}

let gavetaModo = null;
function fecharGaveta() {
  const estavaAberta = !$('gaveta').hidden;
  $('gaveta-fundo').hidden = true;
  $('gaveta').hidden = true;
  limparFormulario();
  if (estavaAberta) fecharDialogo($('gaveta'));
}

function escolherArquivo(f) {
  if (!f) return;
  if (!/\.(pfx|p12)$/i.test(f.name)) {
    $('form-erro').textContent = 'Escolha um arquivo .pfx ou .p12.';
    $('form-erro').hidden = false;
    return;
  }
  if (f.size > 50000) {
    $('form-erro').textContent = 'Esse arquivo é grande demais para um certificado A1.';
    $('form-erro').hidden = false;
    return;
  }
  arquivoEscolhido = f;
  $('form-erro').hidden = true;
  $('arquivo-nome').textContent = f.name;
  $('arquivo-detalhe').textContent = `${(f.size / 1024).toFixed(1)} KB · clique para trocar`;
  $('area-arquivo').classList.add('escolhido');
  $('senha').focus();
}

function lerBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result).split(',')[1] || '');
    leitor.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

async function enviarEmpresa(ev) {
  ev.preventDefault();
  const erro = $('form-erro');
  const sucesso = $('form-sucesso');
  erro.hidden = true;
  sucesso.hidden = true;
  if (!arquivoEscolhido) { erro.textContent = 'Selecione o arquivo do certificado.'; erro.hidden = false; return; }
  if (!$('senha').value) { erro.textContent = 'Informe a senha do certificado.'; erro.hidden = false; $('senha').focus(); return; }

  const botao = $('form-enviar');
  botao.disabled = true;
  botao.textContent = 'Validando certificado…';
  try {
    const r = await chamar('/api/empresas', {
      method: 'POST',
      body: {
        arquivoBase64: await lerBase64(arquivoEscolhido),
        senha: $('senha').value,
        uf: $('uf').value,
        regime: $('regime').value || null,
        razaoSocial: $('razao').value.trim() || null,
        codigoErp: $('codigo-erp').value.trim() || null,
        cnpj: soDigitos($('cnpj').value) || null,
        escritorio: $('escritorio').checked,
      },
    });
    const titulo = r.novoCadastro ? 'Empresa cadastrada' : 'Certificado atualizado';
    limparFormulario();
    sucesso.replaceChildren(
      h('strong', { text: `${titulo}: ${r.razaoSocial}` }),
      h('span', { text: `CNPJ ${formatarCnpj(r.cnpj)} · certificado válido até ${dataCurta(r.validoAte)}` }),
      h('span', { text: 'Ela entra na próxima rodada. Para buscar agora, use "Sincronizar" na lista.' }),
    );
    sucesso.hidden = false;
    if (empresaEmEdicao) { $('gaveta-titulo').textContent = 'Adicionar empresa'; $('gaveta-contexto').hidden = true; empresaEmEdicao = null; }
    carregarEmpresas();
    if (gavetaModo === 'escritorio' && window.esCarregar) window.esCarregar();
  } catch (e) {
    erro.textContent = e.message;
    erro.hidden = false;
  } finally {
    botao.disabled = false;
    botao.textContent = 'Salvar certificado';
  }
}


/* ---------- notas de uma empresa ---------- */
const TIPO_DOC = { '55': 'NF-e', '57': 'CT-e', '65': 'NFC-e' };
let empresaNotas = null;

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function filtroQuery() {
  const p = new URLSearchParams({ mes: $('notas-mes').value || mesAtual() });
  return p.toString();
}

function abrirNotas(e, aba = 'visao') {
  empresaNotas = e;
  pararAtualizacao();
  $('tela-empresas').hidden = true;
  $('tela-usuarios').hidden = true;
  $('tela-notas').hidden = false;
  $('notas-titulo').textContent = e.razao_social;
  $('notas-sub').textContent = `CNPJ ${formatarCnpj(e.cnpj)}`;
  $('importacao').hidden = !(importacaoAtual && importacaoAtual.empresaId === e.id);
  window.bxEmpresaResetar();
  if (window.scVerificar) window.scVerificar(e);
  audDados = null;
  window.e360Chave = null;
  window.e360Resetar(e);
  $('notas-mes').value = competencia || mesAtual();
  window.scrollTo(0, 0);
  trocarAba(aba, false);
}

function fecharNotas() {
  empresaNotas = null;
  $('tela-notas').hidden = true;
  $('tela-empresas').hidden = false;
  carregarEmpresas();
  iniciarAtualizacao();
}

function cartao(rotulo, valor, meta) {
  return h('div', { class: 'numero-cartao' },
    h('span', { class: 'rotulo', text: rotulo }),
    h('span', { class: 'valor', text: valor }),
    meta ? h('span', { class: 'meta', text: meta }) : null);
}

function situacaoNota(n) {
  if (n.situacao === 'cancelada') return h('span', { class: 'selo problema' }, 'Cancelada');
  if (n.situacao === 'denegada') return h('span', { class: 'selo problema' }, 'Denegada');
  if (!n.completo) {
    const txt = n.manifestacao_status === 'ciencia' ? 'Ciência dada, aguardando XML'
      : n.manifestacao_status === 'rejeitada' ? 'Ciência rejeitada' : 'Só resumo';
    return h('span', { class: `selo ${n.manifestacao_status === 'rejeitada' ? 'problema' : 'atencao'}`, title: n.manifestacao_motivo || '' }, txt);
  }
  return h('span', { class: 'selo ok' }, 'Autorizada');
}


async function carregarNotas() {
  if (!empresaNotas) return;
  window.bxEmpresaCarregar(empresaNotas, mesSelecionado());
}

async function baixarArquivo(caminho, nomePadrao) {
  const cab = sessao ? { Authorization: `Bearer ${sessao.accessToken}` } : {};
  let resp = await buscar(caminho, { headers: cab });
  if (resp.status === 401 && sessao) {
    await chamar('/api/eu').catch(() => {}); // renova a sessão se preciso
    resp = await buscar(caminho, { headers: { Authorization: `Bearer ${sessao.accessToken}` } });
  }
  if (!resp.ok) {
    let erro = null;
    try { erro = (await resp.json()).erro; } catch { /* corpo não é JSON */ }
    throw new Error(mensagemDeErro(resp.status, erro));
  }
  const nome = (resp.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || nomePadrao;
  const url = URL.createObjectURL(await resp.blob());
  const a = h('a', { href: url, download: nome });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function baixarXml(n) {
  try { await baixarArquivo(`/api/empresas/${empresaNotas.id}/xml?chave=${n.chave}`, `${n.chave}.xml`); }
  catch (e) { avisar(e.message); }
}

/* ---------- importação de XML/ZIP ---------- */
async function enviarArquivo(caminho, arquivo) {
  const faz = () => buscar(caminho, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sessao.accessToken}`, 'Content-Type': 'application/octet-stream' },
    body: arquivo,
  });
  let resp = await faz();
  if (resp.status === 401) { await chamar('/api/eu').catch(() => {}); resp = await faz(); }
  let dados = {};
  try { dados = await resp.json(); } catch { /* sem corpo */ }
  if (!resp.ok) throw new Error(mensagemDeErro(resp.status, dados.erro));
  return dados;
}

/** Canto inferior direito onde ficam os avisos de tarefas em andamento (importação, sincronização), um sobre o outro. */
function areaFlutuante() {
  let a = document.getElementById('area-flutuante');
  if (!a) { a = h('div', { id: 'area-flutuante', class: 'area-flutuante', 'aria-live': 'polite' }); document.body.append(a); }
  return a;
}

/** Importação em andamento (só uma por vez). Continua se o usuário sair da empresa: o aviso flutuante mostra o progresso. */
let importacaoAtual = null;
window.addEventListener('beforeunload', (ev) => { if (importacaoAtual) { ev.preventDefault(); ev.returnValue = ''; } });

async function importarArquivos(lista, destino = null) {
  const arquivos = [...lista].filter((f) => /\.(xml|zip)$/i.test(f.name));
  $('notas-importar-arquivos').value = '';
  if (!arquivos.length) { avisar('Escolha arquivos .xml ou .zip.'); return; }
  if (importacaoAtual) { avisar(`Já há uma importação em andamento (${importacaoAtual.nome}). Espere terminar para começar outra.`, { tipo: 'erro' }); return; }
  // A empresa fica guardada aqui: trocar de tela não muda para onde os XMLs vão
  const emp = destino || { id: empresaNotas.id, nome: empresaNotas.razao_social };
  importacaoAtual = { empresaId: emp.id, nome: emp.nome };
  const caixa = $('importacao');
  const botao = $('notas-importar');
  botao.disabled = true;
  const total = { importadas: 0, completouResumo: 0, jaExistiam: 0, rejeitadas: 0, rejeitadasSefaz: 0, porModelo: {} };
  const rejeitadas = [];
  const falhasConexao = [];
  const barra = h('span');
  barra.style.width = '0%';
  const status = h('span', { class: 'meta', text: '' });
  caixa.replaceChildren(h('h3', { text: 'Importando XMLs…' }), h('div', { class: 'barra' }, barra), status,
    h('span', { class: 'meta', text: 'Você pode usar outras telas do Appura enquanto importa. Só não feche nem recarregue esta aba.' }));
  caixa.hidden = false;
  // Aviso flutuante: aparece quando o usuário sai da empresa
  const barraF = h('span'); barraF.style.width = '0%';
  const statusF = h('span', { class: 'meta', text: '' });
  const flut = h('div', { class: 'imp-flutuante', role: 'status', hidden: true },
    h('div', { class: 'imp-flutuante-topo' }, h('strong', { text: `Importando XMLs · ${emp.nome}` })),
    h('div', { class: 'barra' }, barraF), statusF,
    h('a', { href: `#/empresas/${emp.id}/notas`, class: 'imp-flutuante-link', text: 'Abrir a empresa' }));
  areaFlutuante().append(flut);
  const naEmpresa = () => !!empresaNotas && empresaNotas.id === emp.id && !$('tela-notas').hidden;

  // XMLs soltos vão em lotes (um ZIP sem compressão com até 50 arquivos), 3 lotes por vez: milhares de XMLs em minutos
  const lotes = lotesImportacao(arquivos);
  const inicio = Date.now();
  let feitos = 0;
  const atualizar = () => {
    const seg = (Date.now() - inicio) / 1000;
    const resta = feitos ? Math.round(((arquivos.length - feitos) * seg) / feitos) : null;
    const texto = `${feitos.toLocaleString('pt-BR')} de ${arquivos.length.toLocaleString('pt-BR')} arquivos${resta != null && feitos < arquivos.length ? ` · cerca de ${resta >= 90 ? `${Math.ceil(resta / 60)} min` : `${Math.max(1, resta)} s`} para terminar` : ''}`;
    const pct = `${Math.round((feitos / arquivos.length) * 100)}%`;
    status.textContent = texto; statusF.textContent = texto;
    barra.style.width = pct; barraF.style.width = pct;
    flut.hidden = naEmpresa();
    caixa.hidden = !naEmpresa();
  };
  const vigia = setInterval(atualizar, 1000);
  const enviarLote = async (lote) => {
    let corpo; let nome;
    if (lote.length === 1) { corpo = lote[0]; nome = lote[0].name; }
    else {
      const itens = await Promise.all(lote.map(async (f) => ({ nome: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      corpo = new Blob([zipSimples(itens)], { type: 'application/zip' }); nome = `lote-${lote.length}.zip`;
    }
    for (let tentativa = 1; ; tentativa++) {
      try {
        const r = await enviarArquivo(`/api/empresas/${emp.id}/importar?nome=${encodeURIComponent(nome)}`, corpo);
        total.importadas += r.importadas; total.completouResumo += r.completouResumo;
        total.jaExistiam += r.jaExistiam; total.rejeitadas += r.rejeitadas; total.rejeitadasSefaz += r.rejeitadasSefaz || 0;
        for (const [k, v] of Object.entries(r.porModelo || {})) total.porModelo[k] = (total.porModelo[k] || 0) + v;
        for (const x of r.resultados || []) rejeitadas.push({ arquivo: x.arquivo, motivo: x.motivo || '' });
        break;
      } catch (e) {
        // Falha de rede ou servidor reiniciando: tenta de novo (o que já entrou é reconhecido e pulado)
        // Servidor reiniciando (publicação) leva 1 a 2 minutos: espera até ~2,5 min antes de desistir do lote
        const transitorio = e.message === SEM_CONEXAO || /servidor não conseguiu|Erro inesperado|Failed to fetch|NetworkError/i.test(e.message);
        if (transitorio && tentativa < 8) { await new Promise((ok) => setTimeout(ok, [3, 6, 12, 20, 30, 30, 30][tentativa - 1] * 1000)); continue; }
        if (transitorio) falhasConexao.push(...lote);
        else {
          total.rejeitadas += lote.length;
          for (const f of lote) rejeitadas.push({ arquivo: f.name, motivo: e.message });
        }
        break;
      }
    }
    feitos += lote.length; atualizar();
  };
  atualizar();
  let proximo = 0;
  try {
    await Promise.all(Array.from({ length: Math.min(3, lotes.length) }, async () => {
      while (proximo < lotes.length) await enviarLote(lotes[proximo++]);
    }));
  } finally {
    clearInterval(vigia);
    importacaoAtual = null;
  }

  const novas = total.importadas + total.completouResumo;
  const detalhe = Object.entries(total.porModelo).map(([k, v]) => `${v} ${k}`).join(' · ');
  const titulo = novas ? `${novas.toLocaleString('pt-BR')} documento${novas === 1 ? '' : 's'} importado${novas === 1 ? '' : 's'}` : 'Nenhum documento novo';
  const extra = [
    total.completouResumo ? `${total.completouResumo} completaram notas que só tinham resumo` : '',
    total.jaExistiam ? `${total.jaExistiam.toLocaleString('pt-BR')} já estavam no sistema` : '',
    total.rejeitadasSefaz ? `${total.rejeitadasSefaz.toLocaleString('pt-BR')} XML${total.rejeitadasSefaz === 1 ? '' : 's'} de nota rejeitada pela SEFAZ (não é documento válido: ficou guardado em "Vendas sem nota autorizada", na aba Notas Fiscais)` : '',
    total.rejeitadas ? `${total.rejeitadas} recusado${total.rejeitadas === 1 ? '' : 's'}` : '',
    falhasConexao.length ? `${falhasConexao.length.toLocaleString('pt-BR')} não enviado${falhasConexao.length === 1 ? '' : 's'} por falha de conexão` : '',
  ].filter(Boolean).join(' · ');
  // Os que não foram por falha de conexão não são "recusados": dá para mandar de novo com um clique
  const reenviar = () => (falhasConexao.length ? h('button', { type: 'button', class: 'botao primario pequeno', onclick: () => { flut.remove(); importarArquivos(falhasConexao, emp); } },
    icone('refresh-cw'), h('span', { text: `Reenviar ${falhasConexao.length.toLocaleString('pt-BR')} que falharam` })) : '');
  caixa.replaceChildren(
    h('div', { class: 'linha-imp' },
      h('h3', { text: titulo }),
      h('button', { type: 'button', class: 'botao fantasma pequeno', onclick: () => { caixa.hidden = true; } }, 'Fechar')),
    detalhe ? h('span', { class: 'meta', text: detalhe }) : '',
    h('span', { class: 'meta', text: extra || 'Itens e impostos já foram extraídos para a auditoria.' }),
    reenviar(),
    rejeitadas.length ? h('div', { class: 'imp-recusados' },
      h('strong', { text: 'Por que foram recusados' }),
      h('ul', {}, ...motivosImportacao(rejeitadas).slice(0, 12).map((m) => h('li', {}, h('strong', { text: `${m.quantidade.toLocaleString('pt-BR')}× ` }), m.motivo, h('span', { class: 'meta', text: ` (ex.: ${m.exemplos.join(', ')})` })))),
      h('button', { type: 'button', class: 'botao pequeno', onclick: () => {
        const csv = ['arquivo;motivo', ...rejeitadas.map((x) => `"${x.arquivo.replace(/"/g, '""')}";"${x.motivo.replace(/"/g, '""')}"`)].join('\r\n');
        const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
        const a = h('a', { href: url, download: `recusados-${emp.nome.replace(/[^\w]+/g, '_').slice(0, 40)}.csv` }); document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      } }, icone('cloud-download'), h('span', { text: `Baixar a lista dos ${rejeitadas.length.toLocaleString('pt-BR')} recusados` }))) : '',
  );
  botao.disabled = false;
  if (naEmpresa()) {
    flut.remove(); caixa.hidden = false;
    if (novas) { window.e360Chave = null; recarregarAba(); }
  } else {
    // Fora da empresa: o aviso flutuante vira o resumo, com link para conferir
    caixa.hidden = true;
    flut.replaceChildren(
      h('div', { class: 'imp-flutuante-topo' }, h('strong', { text: `Importação concluída · ${emp.nome}` }),
        h('button', { type: 'button', class: 'botao fantasma pequeno', 'aria-label': 'Fechar', onclick: () => flut.remove() }, icone('x'))),
      h('span', { text: titulo }), extra ? h('span', { class: 'meta', text: extra }) : '', reenviar(),
      h('a', { href: `#/empresas/${emp.id}/notas`, class: 'imp-flutuante-link', text: 'Ver as notas', onclick: () => { flut.remove(); caixa.hidden = false; } }));
    flut.hidden = false;
  }
}

async function baixarZip(botao) {
  if (!emAndamento.has('zip')) avisar('Preparando o ZIP dos XMLs da competência…');
  return comOcupado(botao, 'Preparando ZIP…', () => baixarArquivo(`/api/empresas/${empresaNotas.id}/zip?mes=${mesSelecionado()}`, 'xmls.zip'), 'zip');
}


/* ---------- auditoria ---------- */
let abaAtual = 'notas';
let audMostrar = 'abertos';
let audDados = null;
const confirmandoLote = new Set();
const ORDEM_SEV = { erro: 0, alerta: 1, info: 2 };
const SEV_TEXTO = { erro: 'Erro', alerta: 'Alerta', info: 'Informativo' };
const SEV_TOM = { erro: 'problema', alerta: 'atencao', info: 'neutro' };

const ABAS_EMPRESA = ['visao', 'notas', 'auditoria', 'st', 'sped', 'apuracao', 'guias', 'documentos', 'arquivos', 'historico'];

function trocarAba(aba, atualizarEndereco = true) {
  if (!ABAS_EMPRESA.includes(aba)) aba = 'visao';
  abaAtual = aba;
  if (atualizarEndereco && empresaNotas) {
    history.replaceState(null, '', `#/empresas/${empresaNotas.id}${ABA_NO_ENDERECO[aba]}`);
  }
  for (const id of ABAS_EMPRESA) {
    const botao = $(`aba-${id}`);
    botao.classList.toggle('ativa', id === aba);
    botao.setAttribute('aria-selected', String(id === aba));
    botao.tabIndex = id === aba ? 0 : -1;
    $(`painel-${id}`).hidden = id !== aba;
  }
  const ativo = $(`aba-${aba}`);
  if (ativo.scrollIntoView && window.matchMedia('(max-width: 760px)').matches) ativo.scrollIntoView({ block: 'nearest', inline: 'center' });
  recarregarAba();
}

function recarregarAba() {
  if (!empresaNotas) return;
  if (abaAtual === 'notas') carregarNotas();
  carregarAuditoria();
  if (abaAtual === 'st') carregarST();
  if (abaAtual === 'sped') { window.spedCarregar(); window.sgCarregar(); }
  if (abaAtual === 'apuracao') window.apCarregar();
  if (abaAtual === 'guias') window.guEmpresaCarregar();
  if (abaAtual === 'documentos') window.dcCarregar();
  // Dados da Empresa 360° (cabeçalho, visão geral, arquivos e histórico): uma chamada por empresa/competência
  const chave = `${empresaNotas.id}|${mesSelecionado()}`;
  if (window.e360Chave !== chave || ['visao', 'arquivos', 'historico'].includes(abaAtual)) { window.e360Chave = chave; window.e360Carregar(); }
}

/* ---------- ICMS-ST nas entradas de outros estados ---------- */
function stQuery() {
  return `mes=${mesSelecionado()}${$('st-ajustada').checked ? '&mva=ajustada' : ''}`;
}

async function carregarST() {
  if (!empresaNotas) return;
  const numeros = $('st-numeros');
  const aviso = $('st-aviso');
  numeros.replaceChildren(cartao('ST a recolher', '…'));
  try {
    const d = await chamar(`/api/empresas/${empresaNotas.id}/st?${stQuery()}`);
    if (d.uf !== 'ES') {
      numeros.replaceChildren();
      aviso.className = 'st-aviso neutro';
      aviso.textContent = `Esta empresa está cadastrada em ${d.uf}. O cálculo considera destinatário no ES.`;
      aviso.hidden = false;
      $('st-planilha').disabled = true;
      return;
    }
    $('st-planilha').disabled = false;
    numeros.replaceChildren(
      cartao('ST a recolher', moeda(d.total), `${d.itensCalculados} ite${d.itensCalculados === 1 ? 'm' : 'ns'} calculado${d.itensCalculados === 1 ? '' : 's'}`),
      cartao('Notas de fora do ES', String(d.notasForaDoEstado), `${d.notasComST} com ST a recolher`),
      cartao('Fora da tabela do ES', String(d.itensSemRegra), d.itensSemRegra ? `${moeda(d.valorSemRegra)} com CEST, sem ST no ES?` : 'nenhum item'),
      cartao('Já com ST retido', String(d.jaRetidos), 'itens cobrados pelo fornecedor'),
    );
    if (!d.regrasCadastradas) {
      aviso.className = 'st-aviso';
      aviso.textContent = 'A tabela de ST do ES está vazia. Baixe o modelo, preencha CEST ou NCM com a MVA (ou o PMPF) e a alíquota interna, salve como CSV e envie.';
      aviso.hidden = false;
    } else if (d.itensSemRegra) {
      aviso.className = 'st-aviso';
      aviso.className = 'st-aviso neutro';
      aviso.textContent = `${d.itensSemRegra} item(ns) têm CEST mas não estão na tabela de ST do ES (${d.regrasCadastradas} regras). Em geral não têm ST no ES; confira na aba "Fora da tabela do ES" da planilha.`;
      aviso.hidden = false;
    } else {
      aviso.hidden = true;
    }
  } catch (e) {
    numeros.replaceChildren();
    aviso.className = 'st-aviso';
    aviso.textContent = e.message;
    aviso.hidden = false;
  }
}

async function baixarPlanilhaST() {
  return comOcupado($('st-planilha'), 'Gerando planilha…', () => baixarArquivo(`/api/empresas/${empresaNotas.id}/st?${stQuery()}&formato=xlsx`, 'st.xlsx'), 'planilha-st');
}

async function enviarTabelaST(arquivo) {
  if (!arquivo) return;
  const botao = $('st-tabela-enviar');
  botao.disabled = true;
  botao.textContent = 'Enviando…';
  try {
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    // O Excel costuma salvar CSV em Windows-1252; se não for UTF-8 válido, lê nesse formato.
    let texto;
    try { texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { texto = new TextDecoder('windows-1252').decode(bytes); }
    const r = await chamar('/api/st-es/tabela', { method: 'POST', body: { csv: texto } });
    avisar(`Tabela de ST do ES atualizada: ${r.regras} regra(s).`);
    carregarST();
  } catch (e) {
    avisar(e.message);
  } finally {
    botao.disabled = false;
    botao.textContent = 'Enviar tabela (CSV)';
    $('st-tabela-arquivo').value = '';
  }
}

function mesSelecionado() { return $('notas-mes').value || mesAtual(); }

async function carregarAuditoria() {
  if (!empresaNotas) return;
  try {
    audDados = await chamar(`/api/empresas/${empresaNotas.id}/auditoria?mes=${mesSelecionado()}`);
    const abertos = audDados.apontamentos.filter((a) => a.status === 'aberto' && a.severidade !== 'info').length;
    const cont = $('aba-auditoria-qtd');
    cont.textContent = String(abertos);
    cont.classList.toggle('zero', abertos === 0);
    cont.hidden = false;
    if (abaAtual === 'auditoria') renderAuditoria();
  } catch (e) {
    if (abaAtual === 'auditoria') { $('aud-vazio').textContent = e.message; $('aud-vazio').hidden = false; }
  }
}

function pct(parte, total) { return total > 0 ? `${Math.round((parte / total) * 100)}%` : '—'; }

function renderAuditoria() {
  const d = audDados;
  if (!d) return;
  const ap = d.apontamentos;
  const conta = (f) => ap.filter(f).length;
  const mono = Object.fromEntries((d.monofasico || []).map((m) => [m.direcao, m]));
  const ent = mono.entrada || { total: 0, monofasico: 0 };
  const sai = mono.saida || { total: 0, monofasico: 0 };
  $('aud-resumo').replaceChildren(
    cartao('Erros abertos', String(conta((a) => a.status === 'aberto' && a.severidade === 'erro'))),
    cartao('Alertas abertos', String(conta((a) => a.status === 'aberto' && a.severidade === 'alerta'))),
    cartao('Resolvidos', String(conta((a) => a.status !== 'aberto')), `${conta((a) => a.status === 'ignorado')} ignorados`),
    cartao('Informativos', String(conta((a) => a.severidade === 'info'))),
    cartao('Compras monofásicas', moeda(ent.monofasico), `${pct(Number(ent.monofasico), Number(ent.total))} das compras`),
    cartao('Vendas monofásicas', moeda(sai.monofasico), Number(sai.total) ? `${pct(Number(sai.monofasico), Number(sai.total))} das vendas em NF-e` : 'sem NF-e de saída no mês'),
  );

  const n = { todos: ap.length, abertos: conta((a) => a.status === 'aberto'), tratados: conta((a) => a.status !== 'aberto' && a.status !== 'ignorado'), ignorados: conta((a) => a.status === 'ignorado') };
  for (const k of Object.keys(n)) $(`aud-n-${k}`).textContent = String(n[k]);
  const visiveis = ap.filter((a) => audMostrar === 'todos' || (audMostrar === 'abertos' ? a.status === 'aberto'
    : audMostrar === 'ignorados' ? a.status === 'ignorado' : a.status !== 'aberto' && a.status !== 'ignorado'));
  const grupos = new Map();
  for (const a of visiveis) {
    if (!grupos.has(a.regra)) grupos.set(a.regra, []);
    grupos.get(a.regra).push(a);
  }
  const ordenados = [...grupos.entries()].sort((x, y) =>
    (ORDEM_SEV[x[1][0].severidade] - ORDEM_SEV[y[1][0].severidade]) || (y[1].length - x[1].length));

  const vazio = $('aud-vazio');
  if (!ordenados.length) {
    $('aud-lista').replaceChildren();
    vazio.textContent = d.aguardandoAuditoria
      ? `${d.aguardandoAuditoria} nota(s) deste mês ainda aguardando auditoria. Ela roda sozinha em até 1 minuto, ou use "Refazer auditoria do mês".`
      : { abertos: 'Nenhum apontamento pendente nesta competência.', tratados: 'Nenhum apontamento tratado nesta competência.', ignorados: 'Nenhum apontamento ignorado nesta competência.' }[audMostrar] || 'Nenhum apontamento nesta competência.';
    vazio.hidden = false;
    return;
  }
  vazio.hidden = true;
  $('aud-lista').replaceChildren(...ordenados.map(([regra, lista]) => grupoRegra(regra, lista, d.regras[regra] || { titulo: regra, explicacao: '' })));
}

function grupoRegra(regra, lista, info) {
  const sev = lista[0].severidade;
  const abertos = lista.filter((a) => a.status === 'aberto');
  const temSugestao = abertos.some((a) => a.sugestao);
  const total = lista.reduce((t, a) => t + (a.quantidade || 1), 0);
  const acoes = [];
  if (pode('operar') && abertos.length && regra !== 'CFOP_ENTRADA_INDEFINIDO') {
    const chaveR = `${regra}:resolver`;
    acoes.push(h('button', {
      type: 'button', class: `botao pequeno${confirmandoLote.has(chaveR) ? ' perigo' : ''}`,
      onclick: () => loteConfirmar(chaveR, regra, 'resolver'),
    }, confirmandoLote.has(chaveR) ? `Confirmar (${abertos.length})` : temSugestao ? `Aplicar sugestão em todos (${abertos.length})` : `Marcar todos como tratados (${abertos.length})`));
  }
  if (pode('operar') && abertos.length) {
    const chaveI = `${regra}:ignorar`;
    acoes.push(h('button', {
      type: 'button', class: `botao fantasma pequeno${confirmandoLote.has(chaveI) ? ' perigo' : ''}`,
      onclick: () => loteConfirmar(chaveI, regra, 'ignorar'),
    }, confirmandoLote.has(chaveI) ? `Confirmar (${abertos.length})` : 'Ignorar todos'));
  }
  const limite = 60;
  return h('section', { class: `grupo-regra ${sev}` },
    h('div', { class: 'grupo-topo' },
      h('div', {},
        h('h3', {}, info.titulo, h('span', { class: `selo ${SEV_TOM[sev]}`, text: SEV_TEXTO[sev] }),
          h('span', { class: 'meta', text: `${total} ocorrência${total === 1 ? '' : 's'}` })),
        h('p', { text: info.explicacao })),
      acoes.length ? h('div', { class: 'grupo-acoes' }, ...acoes) : null),
    ...lista.slice(0, limite).map(linhaApontamento),
    ...(lista.length > limite ? [h('div', { class: 'mais-itens', text: `e mais ${lista.length - limite}. As ações em lote valem para todos.` })] : []),
  );
}

function linhaApontamento(a) {
  const resolvido = a.status !== 'aberto';
  let acoes;
  if (resolvido) {
    acoes = [h('button', { type: 'button', class: 'botao fantasma pequeno', onclick: (ev) => resolver(a, 'reabrir', null, ev.currentTarget) }, 'Reabrir')];
  } else if (a.regra === 'CFOP_ENTRADA_INDEFINIDO') {
    const campo = h('input', { class: 'cfop', type: 'text', inputmode: 'numeric', maxlength: '4', placeholder: 'CFOP', 'aria-label': 'CFOP de entrada' });
    acoes = [
      campo,
      h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => resolver(a, 'resolver', campo.value.trim(), ev.currentTarget) }, 'Salvar'),
      h('button', { type: 'button', class: 'botao fantasma pequeno', onclick: (ev) => resolver(a, 'ignorar', null, ev.currentTarget) }, 'Ignorar'),
    ];
  } else {
    acoes = [
      h('button', { type: 'button', class: 'botao pequeno', onclick: (ev) => resolver(a, 'resolver', null, ev.currentTarget) },
        a.sugestao ? `Aplicar CST ${a.sugestao.valor}` : 'Tratado'),
      h('button', { type: 'button', class: 'botao fantasma pequeno', onclick: (ev) => resolver(a, 'ignorar', null, ev.currentTarget) }, 'Ignorar'),
    ];
  }
  if (!pode('operar')) acoes = [];
  const decisao = resolvido
    ? `${a.status === 'ajustado' ? 'Tratado' : 'Ignorado'} por ${a.resolvido_por || '—'} em ${dataCurta(a.resolvido_em)}${a.observacao ? ` · ${a.observacao}` : ''}`
    : null;
  return h('div', { class: `apontamento${resolvido ? ' resolvido' : ''}` },
    h('div', { class: 'texto' }, a.mensagem, decisao ? h('span', { class: 'decisao', text: decisao }) : null),
    h('div', { class: 'acoes-ap' }, ...acoes));
}

async function resolver(a, acao, valor, botao) {
  return comOcupado(botao, null, async () => {
    await chamar(`/api/apontamentos/${a.id}`, { method: 'POST', body: { acao, valor: valor || null } });
    await carregarAuditoria();
  }, `apontamento:${a.id}`);
}

async function loteConfirmar(chave, regra, acao) {
  if (!confirmandoLote.has(chave)) {
    confirmandoLote.add(chave);
    renderAuditoria();
    setTimeout(() => { confirmandoLote.delete(chave); renderAuditoria(); }, 5000);
    return;
  }
  confirmandoLote.delete(chave);
  return comOcupado(null, null, async () => {
    const r = await chamar(`/api/empresas/${empresaNotas.id}/auditoria/lote`, { method: 'POST', body: { mes: mesSelecionado(), regra, acao } });
    avisar(`${r.quantidade} apontamento(s) ${acao === 'ignorar' ? 'ignorados' : 'tratados'}.`, { tipo: 'ok' });
    await carregarAuditoria();
  }, `lote:${chave}`);
}

async function refazerAuditoria() {
  return comOcupado($('aud-refazer'), 'Auditando…', async () => {
    const r = await chamar(`/api/empresas/${empresaNotas.id}/auditoria/refazer`, { method: 'POST', body: { mes: mesSelecionado() } });
    avisar(`Auditoria refeita: ${r.apontamentos} apontamento(s).`, { tipo: 'ok' });
    await carregarAuditoria();
  }, 'refazer-auditoria');
}

function marcarSegmento() {
  for (const k of ['todos', 'abertos', 'tratados', 'ignorados']) {
    $(`aud-${k}`).classList.toggle('ativo', audMostrar === k);
    $(`aud-${k}`).setAttribute('aria-pressed', String(audMostrar === k));
  }
}

/* ---------- início ---------- */
async function abrirApp() {
  $('tela-login').hidden = true;
  $('tela-app').hidden = false;
  $('tela-notas').hidden = true;
  $('tela-empresas').hidden = true;
  empresaNotas = null;
  $('tela-usuarios').hidden = true;
  $('tela-app').classList.toggle('recolhida', lerPreferenciaLateral());
  let eu = null;
  try {
    eu = await chamar('/api/eu');
    perfilAtual = eu.perfil;
    permissoes = eu.permissoes || [];
  } catch { perfilAtual = null; permissoes = []; }
  preencherUsuario(eu);
  renderNav();
  atualizarBotaoLateral();
  let comp = null;
  try { comp = sessionStorage.getItem('appura-competencia'); } catch { /* ok */ }
  definirCompetencia(comp || mesAtual(), false);
  $('botao-adicionar').hidden = !pode('certificados');
  $('notas-importar').hidden = !pode('operar');
  $('aud-refazer').hidden = !pode('operar');
  $('st-tabela-enviar').hidden = !pode('configuracoes');
  await carregarEmpresas();
  if (!location.hash) history.replaceState(null, '', '#/visao-geral');
  aplicarRota();
}

function ligarEventos() {
  $('aba-entrar').addEventListener('click', () => trocarModo('entrar'));
  $('aba-primeiro').addEventListener('click', () => trocarModo('primeiro'));
  $('form-login').addEventListener('submit', enviarLogin);
  $('botao-sair').addEventListener('click', () => sair());
  $('botao-adicionar').addEventListener('click', () => abrirGaveta(null));
  $('gaveta-fechar').addEventListener('click', fecharGaveta);
  $('form-cancelar').addEventListener('click', fecharGaveta);
  $('gaveta-fundo').addEventListener('click', fecharGaveta);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('gaveta').hidden) fecharGaveta();
    if (!$('gu').hidden) fecharGavetaUsuario();
  });
  $('usuarios-voltar').addEventListener('click', () => irPara('#/empresas'));
  $('usuarios-novo').addEventListener('click', () => abrirGavetaUsuario(null));
  $('gu-fechar').addEventListener('click', fecharGavetaUsuario);
  $('gu-cancelar').addEventListener('click', fecharGavetaUsuario);
  $('gu-fundo').addEventListener('click', fecharGavetaUsuario);
  $('gu-form').addEventListener('submit', salvarUsuario);
  $('gu-perfil').addEventListener('change', mostrarDicaPerfil);
  $('gu-redefinir').addEventListener('click', redefinirSenhaUsuario);
  $('gu-excluir').addEventListener('click', () => { $('gu-confirmar').hidden = false; $('gu-confirmacao').focus(); });
  $('gu-excluir-cancelar').addEventListener('click', () => { $('gu-confirmar').hidden = true; $('gu-confirmacao').value = ''; });
  $('gu-excluir-ok').addEventListener('click', excluirUsuario);
  $('form-empresa').addEventListener('submit', enviarEmpresa);
  $('busca').addEventListener('input', (e) => { termo = e.target.value.trim(); renderLista(); });

  const area = $('area-arquivo');
  area.addEventListener('click', () => $('arquivo').click());
  area.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('arquivo').click(); } });
  $('arquivo').addEventListener('change', (e) => escolherArquivo(e.target.files[0]));
  area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('arrastando'); });
  area.addEventListener('dragleave', () => area.classList.remove('arrastando'));
  area.addEventListener('drop', (e) => { e.preventDefault(); area.classList.remove('arrastando'); escolherArquivo(e.dataTransfer.files[0]); });

  $('notas-voltar').addEventListener('click', () => irPara('#/empresas'));
  $('notas-importar').addEventListener('click', () => $('notas-importar-arquivos').click());
  $('notas-importar-arquivos').addEventListener('change', (e) => importarArquivos(e.target.files));
  $('notas-mes').addEventListener('change', (e) => { definirCompetencia(e.target.value, false); recarregarAba(); });
  for (const id of ABAS_EMPRESA) $(`aba-${id}`).addEventListener('click', () => trocarAba(id));
  $('aud-refazer').addEventListener('click', refazerAuditoria);
  $('st-planilha').addEventListener('click', baixarPlanilhaST);
  $('st-ajustada').addEventListener('change', carregarST);
  $('st-tabela-baixar').addEventListener('click', () => baixarArquivo('/api/st-es/tabela', 'tabela_st_es.csv').catch((e) => avisar(e.message)));
  $('st-tabela-enviar').addEventListener('click', () => $('st-tabela-arquivo').click());
  $('st-tabela-arquivo').addEventListener('change', (e) => enviarTabelaST(e.target.files[0]));
  for (const k of ['todos', 'abertos', 'tratados', 'ignorados']) {
    $(`aud-${k}`).addEventListener('click', () => { audMostrar = k; marcarSegmento(); renderAuditoria(); });
  }

  $('mostrar-senha').addEventListener('click', () => {
    const campo = $('senha');
    const mostrar = campo.type === 'password';
    campo.type = mostrar ? 'text' : 'password';
    $('mostrar-senha').textContent = mostrar ? 'Ocultar' : 'Mostrar';
    $('mostrar-senha').setAttribute('aria-pressed', String(mostrar));
  });
}

ligarEventos();
ligarShell();
preencherUfs();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
sessao = lerSessao();
if (sessao) {
  chamar('/api/eu').then(abrirApp).catch(() => sair());
} else {
  $('tela-login').hidden = false;
}
