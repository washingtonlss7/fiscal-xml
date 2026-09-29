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

const formatarCnpj = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
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
  ok:                   { grupo: 'ok',       tom: 'ok',       texto: () => 'Em dia' },
  aguardando:           { grupo: 'ok',       tom: 'neutro',   texto: () => 'Aguardando 1ª sincronização' },
  atrasada:             { grupo: 'atencao',  tom: 'atencao',  texto: () => 'Sincronização atrasada' },
  certificado_vencendo: { grupo: 'atencao',  tom: 'atencao',  texto: (e) => `Certificado vence em ${e.dias_para_vencer} dia${e.dias_para_vencer === 1 ? '' : 's'}` },
  erro:                 { grupo: 'problema', tom: 'problema', texto: () => 'Erro na consulta' },
  certificado_vencido:  { grupo: 'problema', tom: 'problema', texto: () => 'Certificado vencido' },
  sem_certificado:      { grupo: 'problema', tom: 'problema', texto: () => 'Sem certificado' },
  pausada:              { grupo: 'pausada',  tom: 'neutro',   texto: () => 'Pausada' },
};

const FILTROS = [
  { id: 'todas',    rotulo: 'Todas',     ponto: '' },
  { id: 'ok',       rotulo: 'Em dia',    ponto: 'ok' },
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

async function chamar(caminho, opcoes = {}, tentouRenovar = false) {
  const cab = { 'Content-Type': 'application/json' };
  if (sessao) cab.Authorization = `Bearer ${sessao.accessToken}`;
  const resp = await fetch(caminho, {
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
  if (!resp.ok) throw new Error(dados.erro || `Erro ${resp.status}`);
  return dados;
}

/* ---------- aviso ---------- */
let timerAviso;
function avisar(texto) {
  const el = $('aviso');
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(timerAviso);
  timerAviso = setTimeout(() => { el.hidden = true; }, 4000);
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
  if (mensagem) {
    $('login-erro').textContent = mensagem;
    $('login-erro').hidden = false;
  }
}

/* ---------- lista de empresas ---------- */
let empresas = [];
let filtro = 'todas';
let termo = '';
let timerAtualizacao;
const confirmando = new Set();

function grupoDe(e) { return (STATUS[e.status] || STATUS.aguardando).grupo; }

function renderResumo() {
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
    ? h('button', { type: 'button', class: 'botao pequeno perigo', onclick: () => alternarAtivo(e) }, e.ativo ? 'Confirmar pausa' : 'Confirmar')
    : h('button', { type: 'button', class: 'botao fantasma pequeno', onclick: () => { confirmando.add(e.id); renderLista(); setTimeout(() => { confirmando.delete(e.id); renderLista(); }, 5000); } }, e.ativo ? 'Pausar' : 'Reativar');

  return h('div', { class: `empresa${e.ativo ? '' : ' pausada'}` },
    celula('Empresa',
      h('span', { class: 'nome', text: e.razao_social }),
      h('span', { class: 'cnpj' }, formatarCnpj(e.cnpj), ` · ${e.uf}`, e.regime ? ` · ${REGIMES[e.regime] || e.regime}` : '', e.codigo_erp ? ` · cód. ${e.codigo_erp}` : ''),
    ),
    celula('Situação',
      h('span', { class: `selo ${st.tom}` }, st.texto(e)),
      e.status === 'erro' && e.ultimo_motivo ? h('span', { class: 'motivo', text: `${e.ultimo_cstat ? e.ultimo_cstat + ' · ' : ''}${e.ultimo_motivo}` }) : null,
    ),
    celula('Certificado', ...certificado),
    celula('Última sincronização', ...sincronizacao,
      h('span', { class: 'meta', text: `${e.documentos_30d} nota${Number(e.documentos_30d) === 1 ? '' : 's'} em 30 dias` })),
    h('div', { class: 'acoes' },
      h('button', {
        type: 'button', class: 'botao pequeno', disabled: !e.ativo || e.sincronizacao_pedida || !e.certificado_valido_ate,
        onclick: () => sincronizar(e),
      }, 'Sincronizar'),
      h('button', { type: 'button', class: 'botao fantasma pequeno', onclick: () => abrirGaveta(e) }, 'Trocar certificado'),
      botaoPausa,
    ),
  );
}

function renderLista() {
  const t = termo.toLowerCase();
  const td = soDigitos(termo);
  const visiveis = empresas.filter((e) =>
    (filtro === 'todas' || grupoDe(e) === filtro) &&
    (!t || e.razao_social.toLowerCase().includes(t) || (td && e.cnpj.includes(td)) || (e.codigo_erp || '').toLowerCase().includes(t)));

  const lista = $('lista');
  const vazio = $('vazio');
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
      h('span', { text: 'Última sincronização' }), h('span', { text: '' })),
    ...visiveis.map(linhaEmpresa),
  );
}

async function carregarEmpresas() {
  try {
    const r = await chamar('/api/empresas');
    empresas = r.empresas || [];
    $('atualizado').textContent = `Atualizado às ${new Date(r.atualizadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    renderResumo();
    renderLista();
  } catch (e) {
    if (sessao) avisar(e.message);
  }
}

function iniciarAtualizacao() {
  pararAtualizacao();
  timerAtualizacao = setInterval(() => { if (!document.hidden) carregarEmpresas(); }, 60000);
}
function pararAtualizacao() { clearInterval(timerAtualizacao); }

async function sincronizar(e) {
  try {
    const r = await chamar(`/api/empresas/${e.id}/sincronizar`, { method: 'POST' });
    e.sincronizacao_pedida = true;
    renderLista();
    avisar(r.mensagem);
  } catch (err) { avisar(err.message); }
}

async function alternarAtivo(e) {
  confirmando.delete(e.id);
  try {
    await chamar(`/api/empresas/${e.id}/ativo`, { method: 'POST', body: { ativo: !e.ativo } });
    avisar(e.ativo ? 'Empresa pausada. O coletor deixa de consultá-la.' : 'Empresa reativada.');
    await carregarEmpresas();
  } catch (err) { avisar(err.message); }
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
  $('form-erro').hidden = true;
  $('form-sucesso').hidden = true;
  $('form-enviar').disabled = false;
}

function abrirGaveta(empresa) {
  limparFormulario();
  empresaEmEdicao = empresa || null;
  $('gaveta-titulo').textContent = empresa ? 'Trocar certificado' : 'Adicionar empresa';
  const ctx = $('gaveta-contexto');
  if (empresa) {
    ctx.textContent = `${empresa.razao_social} · ${formatarCnpj(empresa.cnpj)}`;
    ctx.hidden = false;
    $('uf').value = empresa.uf;
    $('regime').value = empresa.regime || '';
    $('codigo-erp').value = empresa.codigo_erp || '';
    $('cnpj').value = empresa.cnpj;
  } else {
    ctx.hidden = true;
    $('uf').value = 'ES';
    $('regime').value = '';
  }
  $('gaveta-fundo').hidden = false;
  $('gaveta').hidden = false;
  $('area-arquivo').focus();
}

function fecharGaveta() {
  $('gaveta-fundo').hidden = true;
  $('gaveta').hidden = true;
  limparFormulario();
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
  } catch (e) {
    erro.textContent = e.message;
    erro.hidden = false;
  } finally {
    botao.disabled = false;
    botao.textContent = 'Salvar certificado';
  }
}

/* ---------- início ---------- */
async function abrirApp() {
  $('tela-login').hidden = true;
  $('tela-app').hidden = false;
  $('usuario-email').textContent = sessao.email || '';
  await carregarEmpresas();
  iniciarAtualizacao();
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('gaveta').hidden) fecharGaveta(); });
  $('form-empresa').addEventListener('submit', enviarEmpresa);
  $('busca').addEventListener('input', (e) => { termo = e.target.value.trim(); renderLista(); });

  const area = $('area-arquivo');
  area.addEventListener('click', () => $('arquivo').click());
  area.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('arquivo').click(); } });
  $('arquivo').addEventListener('change', (e) => escolherArquivo(e.target.files[0]));
  area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('arrastando'); });
  area.addEventListener('dragleave', () => area.classList.remove('arrastando'));
  area.addEventListener('drop', (e) => { e.preventDefault(); area.classList.remove('arrastando'); escolherArquivo(e.dataTransfer.files[0]); });

  $('mostrar-senha').addEventListener('click', () => {
    const campo = $('senha');
    const mostrar = campo.type === 'password';
    campo.type = mostrar ? 'text' : 'password';
    $('mostrar-senha').textContent = mostrar ? 'Ocultar' : 'Mostrar';
    $('mostrar-senha').setAttribute('aria-pressed', String(mostrar));
  });
}

ligarEventos();
preencherUfs();
sessao = lerSessao();
if (sessao) {
  chamar('/api/eu').then(abrirApp).catch(() => sair());
} else {
  $('tela-login').hidden = false;
}
