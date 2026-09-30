/**
 * Rotas HTTP do MCP do Appura:
 *   /.well-known/oauth-protected-resource[/mcp]   metadados do recurso (RFC 9728)
 *   /.well-known/oauth-authorization-server       metadados do servidor de autorização (RFC 8414)
 *   /oauth/register  /oauth/authorize  /oauth/token  /oauth/revoke
 *   /mcp                                           servidor MCP (Streamable HTTP, sem estado)
 */
import http from 'http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { log } from '../log';
import { ESCOPOS, ErroOAuth, PedidoAutorizacao, redirectLocal, ServicoOAuth, temAcoes } from './oauth';
import { criarServidorMcp, DepsMcp, RegistroFerramenta } from './ferramentas';

export interface OpcoesMcpHttp {
  oauth: ServicoOAuth;
  deps: DepsMcp;
  /** URL pública do Appura (sem barra final). Sem PUBLIC_URL, vem do Host da requisição. */
  base: (req: http.IncomingMessage) => string;
  /** Confere e-mail e senha do Appura; devolve o e-mail autorizado ou lança erro com mensagem para a tela. */
  entrar: (email: string, senha: string, ip: string) => Promise<string>;
  perfilDe: (email: string) => Promise<string | null>;
  /** O perfil pode executar ações (permissão 'operar')? */
  podeOperar: (perfil: string) => boolean;
  registrar: RegistroFerramenta;
  lerTexto: (req: http.IncomingMessage, limite: number) => Promise<string>;
  ip: (req: http.IncomingMessage) => string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version',
  'Access-Control-Max-Age': '600',
};

function json(res: http.ServerResponse, status: number, corpo: unknown, extra: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...CORS, ...extra });
  res.end(JSON.stringify(corpo));
}

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Tela de conexão (login do Appura + consentimento). Sem script nem estilo inline: usa o CSS do painel. */
function paginaConsentimento(p: PedidoAutorizacao, campos: Record<string, string>, erro: string | null, email = '', acoesMarcadas = true): string {
  const pedeAcoes = temAcoes(p.scope);
  let host = '';
  try { host = new URL(p.redirectUri).host; } catch { /* validado antes */ }
  const ocultos = Object.entries(campos).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Conectar ao Appura</title><link rel="stylesheet" href="/app.css"><link rel="icon" href="/favicon.png"></head>
<body><main class="login"><section class="login-cartao mcp-consentimento" aria-labelledby="mcp-titulo">
<div class="marca"><img src="/logo.png" alt="" width="36" height="36"><span class="marca-texto"><span class="marca-nome">appura</span><span class="marca-tag">Plataforma Fiscal</span></span></div>
<h1 id="mcp-titulo">Conectar ${esc(p.cliente.nome)} ao Appura</h1>
${pedeAcoes
    ? `<p class="dica">Este app de IA quer acesso ao Appura em seu nome, com as permissões do seu perfil: consultar empresas, Central de Fechamento, SPED/SINTEGRA, auditoria, notas e guias. Ele não vê certificados, senhas nem chaves.</p>`
    : `<p class="dica">Este app de IA quer acesso <strong>somente de leitura</strong> ao Appura em seu nome: empresas, Central de Fechamento, SPED/SINTEGRA, auditoria, notas e guias, com as permissões do seu perfil. Ele não altera nada, não gera guias e não vê certificados, senhas nem chaves.</p>`}
<p class="contexto">Depois de permitir, o acesso volta para <strong>${esc(host)}</strong>.${redirectLocal(p.redirectUri) ? ' Esse endereço é um app instalado neste computador: só continue se foi você quem iniciou a conexão agora.' : ''}</p>
${erro ? `<p class="erro" role="alert">${esc(erro)}</p>` : ''}
<form method="post" action="/oauth/authorize" class="mcp-form" autocomplete="on">${ocultos}
<label class="campo">E-mail do Appura<input name="email" type="email" required autocomplete="username" value="${esc(email)}"></label>
<label class="campo">Senha<input name="senha" type="password" required autocomplete="current-password"></label>
${pedeAcoes ? `<label class="mcp-permissao"><input type="checkbox" name="acoes" value="sim"${acoesMarcadas ? ' checked' : ''}><span><strong>Permitir também ações</strong> (justificar divergências, verificar procuração, enviar guias já geradas à Acessórias). Cada ação mostra uma prévia e só é feita depois que você confirmar na conversa. Só vale se o seu perfil puder operar.</span></label>` : ''}
<div class="gaveta-acoes mcp-acoes"><button type="submit" name="decisao" value="permitir" class="botao primario">Permitir acesso</button>
<button type="submit" name="decisao" value="negar" class="botao fantasma" formnovalidate>Cancelar</button></div>
</form>
<p class="dica">Você pode desconectar a qualquer momento em Administração › Conexões de IA.</p>
</section></main></body></html>`;
}

function paginaErro(msg: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Appura</title><link rel="stylesheet" href="/app.css"></head>
<body><main class="login"><section class="login-cartao mcp-consentimento"><div class="marca"><img src="/logo.png" alt="" width="36" height="36"><span class="marca-texto"><span class="marca-nome">appura</span><span class="marca-tag">Plataforma Fiscal</span></span></div><h1>Não foi possível conectar</h1><p class="erro" role="alert">${esc(msg)}</p><p class="dica">Volte ao app de IA e tente conectar de novo.</p></section></main></body></html>`;
}

function html(res: http.ServerResponse, status: number, corpo: string, formAction = "'self'") {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'self'; script-src 'none'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action ${formAction}`,
  });
  res.end(corpo);
}

function redirecionar(res: http.ServerResponse, destino: string, params: Record<string, string | null | undefined>) {
  const u = new URL(destino);
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined) u.searchParams.set(k, v);
  res.writeHead(302, { Location: u.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.end();
}

/** Limite por usuário no /mcp (120 chamadas por minuto). */
const usoMcp = new Map<string, { n: number; desde: number }>();
function limitarMcp(email: string): boolean {
  const agora = Date.now(); const u = usoMcp.get(email);
  if (!u || agora - u.desde > 60_000) { usoMcp.set(email, { n: 1, desde: agora }); return true; }
  return ++u.n <= 120;
}

/** Trata as rotas do MCP/OAuth. Devolve false quando a rota não é daqui. */
export async function rotaMcp(req: http.IncomingMessage, res: http.ServerResponse, url: URL, o: OpcoesMcpHttp): Promise<boolean> {
  const p = url.pathname;
  const metodo = req.method ?? 'GET';
  const ehNosso = p === '/mcp' || p.startsWith('/oauth/') || p.startsWith('/.well-known/oauth-') || p === '/.well-known/openid-configuration';
  if (!ehNosso) return false;
  if (metodo === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return true; }
  const base = o.base(req);
  const recurso = `${base}/mcp`;
  const metadadosRecurso = `${base}/.well-known/oauth-protected-resource/mcp`;

  try {
    if (metodo === 'GET' && (p === '/.well-known/oauth-protected-resource' || p === '/.well-known/oauth-protected-resource/mcp')) {
      json(res, 200, { resource: recurso, authorization_servers: [base], scopes_supported: ESCOPOS, bearer_methods_supported: ['header'], resource_name: 'Appura' });
      return true;
    }
    if (metodo === 'GET' && (p === '/.well-known/oauth-authorization-server' || p === '/.well-known/openid-configuration')) {
      json(res, 200, {
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        revocation_endpoint: `${base}/oauth/revoke`,
        scopes_supported: ESCOPOS,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
        revocation_endpoint_auth_methods_supported: ['none'],
        client_id_metadata_document_supported: true,
      });
      return true;
    }
    if (metodo === 'POST' && p === '/oauth/register') {
      const corpo = JSON.parse((await o.lerTexto(req, 20_000)) || '{}');
      json(res, 201, await o.oauth.registrar(corpo));
      return true;
    }
    if (p === '/oauth/authorize') return await autorizar(req, res, url, o, recurso), true;
    if (metodo === 'POST' && p === '/oauth/token') {
      const campos = lerCampos(await o.lerTexto(req, 20_000), req);
      const g = campos.grant_type;
      const t = g === 'authorization_code' ? await o.oauth.trocarCodigo(campos, recurso)
        : g === 'refresh_token' ? await o.oauth.renovar(campos)
          : (() => { throw new ErroOAuth(400, 'unsupported_grant_type', 'Use authorization_code ou refresh_token.'); })();
      json(res, 200, t, { Pragma: 'no-cache' });
      return true;
    }
    if (metodo === 'POST' && p === '/oauth/revoke') {
      const campos = lerCampos(await o.lerTexto(req, 20_000), req);
      if (campos.token) await o.oauth.revogarToken(campos.token);
      json(res, 200, {});
      return true;
    }
    if (p === '/mcp') return await servirMcp(req, res, o, recurso, metadadosRecurso), true;
    json(res, 404, { error: 'not_found' });
    return true;
  } catch (e) {
    if (e instanceof ErroOAuth) { json(res, e.status, { error: e.codigo, error_description: e.message }); return true; }
    if (e instanceof SyntaxError) { json(res, 400, { error: 'invalid_request', error_description: 'Corpo inválido.' }); return true; }
    const st = Number((e as { status?: number }).status);
    if (st >= 400 && st < 500) { json(res, st, { error: 'invalid_request', error_description: (e as Error).message }); return true; }
    log.error('erro no MCP/OAuth', { rota: p, erro: (e as Error).message });
    json(res, 500, { error: 'server_error', error_description: 'Erro inesperado no servidor.' });
    return true;
  }
}

function lerCampos(texto: string, req: http.IncomingMessage): Record<string, string> {
  if (/application\/json/i.test(String(req.headers['content-type'] ?? ''))) {
    const j = JSON.parse(texto || '{}');
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v)]));
  }
  return Object.fromEntries(new URLSearchParams(texto));
}

const CAMPOS_PEDIDO = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'resource', 'scope', 'state'];

async function autorizar(req: http.IncomingMessage, res: http.ServerResponse, url: URL, o: OpcoesMcpHttp, recurso: string) {
  const metodo = req.method ?? 'GET';
  const campos: Record<string, string> = metodo === 'POST' ? lerCampos(await o.lerTexto(req, 20_000), req) : Object.fromEntries(url.searchParams);
  let pedido: PedidoAutorizacao;
  try {
    pedido = await o.oauth.validarPedido(campos, recurso);
  } catch (e) {
    const x = e as ErroOAuth & { voltarAoCliente?: boolean; redirectUri?: string; state?: string | null };
    if (x.voltarAoCliente && x.redirectUri) return redirecionar(res, x.redirectUri, { error: x.codigo, error_description: x.message, state: x.state, iss: recurso.replace(/\/mcp$/, '') });
    return html(res, 400, paginaErro(x instanceof ErroOAuth ? x.message : 'Pedido de autorização inválido.'));
  }
  const ocultos = Object.fromEntries(CAMPOS_PEDIDO.filter((k) => campos[k] !== undefined).map((k) => [k, campos[k]]));
  let destino = "'self'";
  try { destino = `'self' ${new URL(pedido.redirectUri).origin}`; } catch { /* validado */ }
  if (metodo === 'GET') return html(res, 200, paginaConsentimento(pedido, ocultos, null), destino);

  const iss = recurso.replace(/\/mcp$/, '');
  if (campos.decisao !== 'permitir') return redirecionar(res, pedido.redirectUri, { error: 'access_denied', error_description: 'O usuário não autorizou.', state: pedido.state, iss });
  let email: string;
  try {
    email = await o.entrar(String(campos.email ?? ''), String(campos.senha ?? ''), o.ip(req));
  } catch (e) {
    return html(res, 401, paginaConsentimento(pedido, ocultos, (e as Error).message, String(campos.email ?? ''), campos.acoes === 'sim'), destino);
  }
  const semAcoes = campos.acoes !== 'sim';
  const code = await o.oauth.emitirCodigo(pedido, email, semAcoes);
  log.info('MCP: app autorizado', { cliente: pedido.cliente.nome, clientId: pedido.cliente.client_id, email, acoes: temAcoes(pedido.scope) && !semAcoes });
  return redirecionar(res, pedido.redirectUri, { code, state: pedido.state, iss });
}

async function servirMcp(req: http.IncomingMessage, res: http.ServerResponse, o: OpcoesMcpHttp, recurso: string, metadados: string) {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  const desafio = (erro?: string) => `Bearer resource_metadata="${metadados}", scope="${ESCOPOS.join(' ')}"${erro ? `, error="${erro}"` : ''}`;
  const acesso = token ? await o.oauth.validarAcesso(token, recurso) : null;
  if (!acesso) {
    json(res, 401, { error: token ? 'invalid_token' : 'unauthorized', error_description: token ? 'Token inválido, expirado ou revogado.' : 'Conecte-se ao Appura (OAuth) ou use um token pessoal.' },
      { 'WWW-Authenticate': desafio(token ? 'invalid_token' : undefined) });
    return;
  }
  const perfil = await o.perfilDe(acesso.email);
  if (!perfil) { json(res, 403, { error: 'forbidden', error_description: 'Este usuário não tem mais acesso ao Appura.' }); return; }
  if (!limitarMcp(acesso.email)) { json(res, 429, { error: 'rate_limited', error_description: 'Limite de 120 chamadas por minuto.' }, { 'Retry-After': '60' }); return; }
  const metodo = req.method ?? 'GET';
  if (metodo !== 'POST') {
    // Servidor sem estado: não há fluxo SSE aberto pelo cliente nem sessão para encerrar
    json(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'Método não permitido.' }, id: null }, { Allow: 'POST' });
    return;
  }
  let corpo: unknown;
  try { corpo = JSON.parse(await o.lerTexto(req, 1_000_000)); } catch {
    json(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'JSON inválido.' }, id: null });
    return;
  }
  const acoes = temAcoes(acesso.scope) && o.podeOperar(perfil);
  const server = criarServidorMcp(o.deps, { email: acesso.email, perfil, clientId: acesso.clientId, acoes }, o.registrar);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  await server.connect(transport);
  await transport.handleRequest(req, res, corpo);
}
