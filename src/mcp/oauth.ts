/**
 * Servidor de autorização OAuth 2.1 do MCP do Appura (especificação MCP 2025-11-25, "Authorization").
 *
 * - Clientes públicos com PKCE S256 obrigatório; `resource` (RFC 8707) amarra o token ao endpoint /mcp.
 * - Registro de cliente: Client ID Metadata Document (client_id = URL https) e registro dinâmico (RFC 7591).
 * - Token de acesso curto (1 h) e refresh rotativo (30 dias) com detecção de reuso (revoga a família).
 * - Tokens pessoais (criados no painel) para clientes que usam cabeçalho fixo (n8n, Claude Code, Cursor...).
 * - O banco guarda só o hash SHA-256 de códigos e tokens.
 */
import crypto from 'crypto';
import dns from 'dns';
import net from 'net';
import { Db, ok } from '../db';

export const ESCOPO = 'appura.leitura';
/** Ações com confirmação (justificar divergências, verificar procuração, enviar guias). */
export const ESCOPO_ACOES = 'appura.acoes';
export const ESCOPOS = [ESCOPO, ESCOPO_ACOES];
export const temAcoes = (scope: string | null | undefined) => String(scope ?? '').split(/\s+/).includes(ESCOPO_ACOES);
const VIDA_CODIGO_MS = 5 * 60_000;
const VIDA_ACESSO_S = 3600;
const VIDA_REFRESH_MS = 30 * 86400_000;

export class ErroOAuth extends Error {
  /** `codigo`: erro OAuth (invalid_request, invalid_client, invalid_grant, invalid_target...). */
  constructor(public readonly status: number, public readonly codigo: string, msg: string) { super(msg); }
}

export const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const aleatorio = (n = 32) => crypto.randomBytes(n).toString('base64url');

/** Redirect aceito: https, ou http só em localhost/127.0.0.1/[::1] (clientes de desktop). Sem fragmento. */
export function redirectValido(u: string): boolean {
  let x: URL;
  try { x = new URL(u); } catch { return false; }
  if (x.hash) return false;
  if (x.protocol === 'https:') return true;
  return x.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(x.hostname);
}
export const redirectLocal = (u: string) => { try { return new URL(u).protocol === 'http:'; } catch { return false; } };

/** Mesmo recurso, ignorando barra final e caixa do esquema/host (RFC 8707). */
export function mesmoRecurso(a: string, b: string): boolean {
  const n = (s: string) => { try { const u = new URL(s); return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase(); } catch { return s; } };
  return n(a) === n(b);
}

/** Endereço privado/reservado (proteção contra SSRF ao buscar metadados de cliente). */
export function ipPrivado(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const i = ip.toLowerCase();
    if (i.startsWith('::ffff:')) return ipPrivado(i.slice(7));
    return i === '::1' || i === '::' || i.startsWith('fc') || i.startsWith('fd') || i.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

export type BuscadorMetadados = (url: string) => Promise<unknown>;

/** Busca o Client ID Metadata Document: só https com caminho, host público, sem redirecionar, até 10 KB, 5 s. */
export const buscarMetadadosCliente: BuscadorMetadados = async (url) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.pathname === '/' || u.username || u.password) throw new ErroOAuth(400, 'invalid_client', 'client_id precisa ser uma URL https com caminho.');
  const ips = await dns.promises.lookup(u.hostname, { all: true }).catch(() => []);
  if (!ips.length || ips.some((x) => ipPrivado(x.address))) throw new ErroOAuth(400, 'invalid_client', 'O endereço do client_id não é público.');
  const r = await fetch(url, { redirect: 'manual', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (r.status !== 200) throw new ErroOAuth(400, 'invalid_client', `Metadados do cliente indisponíveis (HTTP ${r.status}).`);
  const texto = await r.text();
  if (texto.length > 10_240) throw new ErroOAuth(400, 'invalid_client', 'Metadados do cliente grandes demais.');
  try { return JSON.parse(texto); } catch { throw new ErroOAuth(400, 'invalid_client', 'Metadados do cliente não são JSON.'); }
};

export interface Cliente { client_id: string; nome: string; redirect_uris: string[]; origem: 'dcr' | 'cimd' }

export interface PedidoAutorizacao {
  cliente: Cliente;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  state: string | null;
}

export interface Tokens { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string }

export class ServicoOAuth {
  private usoGravado = new Map<string, number>();

  constructor(
    private readonly db: Db,
    private readonly buscar: BuscadorMetadados = buscarMetadadosCliente,
    private readonly agora: () => number = Date.now,
  ) {}

  /* ---------- clientes ---------- */

  /** Registro dinâmico (RFC 7591): só clientes públicos (sem segredo), com redirects válidos. */
  async registrar(corpo: any) {
    const redirects = Array.isArray(corpo?.redirect_uris) ? corpo.redirect_uris.map(String) : [];
    if (!redirects.length || redirects.length > 10 || !redirects.every(redirectValido)) {
      throw new ErroOAuth(400, 'invalid_redirect_uri', 'redirect_uris deve ter de 1 a 10 endereços https (ou http em localhost).');
    }
    const metodo = corpo?.token_endpoint_auth_method ?? 'none';
    if (metodo !== 'none') throw new ErroOAuth(400, 'invalid_client_metadata', 'Só clientes públicos (token_endpoint_auth_method "none") com PKCE.');
    const nome = String(corpo?.client_name ?? 'Cliente MCP').trim().slice(0, 100) || 'Cliente MCP';
    const client_id = `appura_${aleatorio(18)}`;
    ok(await this.db.from('mcp_clientes').insert({ client_id, nome, redirect_uris: redirects, origem: 'dcr', criado_em: new Date(this.agora()).toISOString() }), 'registrar cliente');
    return {
      client_id, client_id_issued_at: Math.floor(this.agora() / 1000), client_name: nome, redirect_uris: redirects,
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none',
    };
  }

  /** Cliente pelo client_id: registrado (DCR) ou URL de metadados (CIMD, em cache por 1 hora). */
  async cliente(clientId: string): Promise<Cliente> {
    if (!clientId || clientId.length > 500) throw new ErroOAuth(400, 'invalid_client', 'client_id ausente.');
    const salvo = ok(await this.db.from('mcp_clientes').select('client_id,nome,redirect_uris,origem,criado_em').eq('client_id', clientId).maybeSingle(), 'cliente') as (Cliente & { criado_em: string }) | null;
    if (!/^https:\/\//i.test(clientId)) {
      if (!salvo) throw new ErroOAuth(400, 'invalid_client', 'Cliente não registrado.');
      return salvo;
    }
    if (salvo && this.agora() - Date.parse(salvo.criado_em) < 3600_000) return salvo;
    const doc: any = await this.buscar(clientId);
    if (!doc || doc.client_id !== clientId) throw new ErroOAuth(400, 'invalid_client', 'O client_id do documento de metadados não confere com a URL.');
    const redirects = Array.isArray(doc.redirect_uris) ? doc.redirect_uris.map(String).filter(redirectValido) : [];
    if (!redirects.length || !doc.client_name) throw new ErroOAuth(400, 'invalid_client', 'Metadados do cliente sem client_name ou redirect_uris válidos.');
    const c: Cliente = { client_id: clientId, nome: String(doc.client_name).slice(0, 100), redirect_uris: redirects.slice(0, 20), origem: 'cimd' };
    ok(await this.db.from('mcp_clientes').upsert({ ...c, criado_em: new Date(this.agora()).toISOString() }, { onConflict: 'client_id' }), 'guardar cliente');
    return c;
  }

  /**
   * Valida o pedido de autorização. Erro de cliente ou de redirect NÃO volta ao redirect (vai para a tela);
   * os demais voltam ao cliente com ?error=... (quem chama decide pelo campo `voltarAoCliente`).
   */
  async validarPedido(q: Record<string, string | undefined>, recurso: string): Promise<PedidoAutorizacao> {
    const cliente = await this.cliente(String(q.client_id ?? ''));
    const redirectUri = String(q.redirect_uri ?? '');
    if (!redirectUri || !cliente.redirect_uris.includes(redirectUri)) throw new ErroOAuth(400, 'invalid_request', 'redirect_uri não cadastrado para este cliente.');
    const voltar = (codigo: string, msg: string) => Object.assign(new ErroOAuth(400, codigo, msg), { voltarAoCliente: true, redirectUri, state: q.state ?? null });
    if (q.response_type !== 'code') throw voltar('unsupported_response_type', 'Só response_type=code.');
    if (!q.code_challenge || q.code_challenge_method !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) throw voltar('invalid_request', 'PKCE com S256 é obrigatório.');
    const resource = q.resource ? String(q.resource) : recurso;
    if (!mesmoRecurso(resource, recurso)) throw voltar('invalid_target', 'O resource pedido não é este servidor MCP.');
    const pedidos = String(q.scope ?? ESCOPOS.join(' ')).split(/\s+/).filter(Boolean);
    if (pedidos.some((s) => !ESCOPOS.includes(s))) throw voltar('invalid_scope', `Escopos disponíveis: ${ESCOPOS.join(', ')}.`);
    // Leitura sempre acompanha; ações só se pedidas (e o usuário ainda pode recusar na tela)
    const scope = [ESCOPO, ...(pedidos.includes(ESCOPO_ACOES) ? [ESCOPO_ACOES] : [])].join(' ');
    return { cliente, redirectUri, codeChallenge: q.code_challenge, resource: recurso, scope, state: q.state ?? null };
  }

  /** `semAcoes`: o usuário desmarcou as ações na tela de consentimento (fica só leitura). */
  async emitirCodigo(p: PedidoAutorizacao, email: string, semAcoes = false): Promise<string> {
    const codigo = aleatorio(32);
    const scope = semAcoes ? ESCOPO : p.scope;
    ok(await this.db.from('mcp_codigos').insert({
      codigo_hash: hash(codigo), client_id: p.cliente.client_id, email, redirect_uri: p.redirectUri, code_challenge: p.codeChallenge,
      resource: p.resource, scope, expira_em: new Date(this.agora() + VIDA_CODIGO_MS).toISOString(),
    }), 'emitir código');
    return codigo;
  }

  private async emitirTokens(email: string, clientId: string, resource: string, scope: string, familia: string): Promise<Tokens> {
    const acesso = `appura_at_${aleatorio(32)}`; const refresh = `appura_rt_${aleatorio(32)}`;
    const agora = this.agora();
    ok(await this.db.from('mcp_tokens').insert([
      { token_hash: hash(acesso), tipo: 'acesso', email, client_id: clientId, resource, scope, familia, criado_em: new Date(agora).toISOString(), expira_em: new Date(agora + VIDA_ACESSO_S * 1000).toISOString() },
      { token_hash: hash(refresh), tipo: 'refresh', email, client_id: clientId, resource, scope, familia, criado_em: new Date(agora).toISOString(), expira_em: new Date(agora + VIDA_REFRESH_MS).toISOString() },
    ]), 'emitir tokens');
    return { access_token: acesso, token_type: 'Bearer', expires_in: VIDA_ACESSO_S, refresh_token: refresh, scope };
  }

  /** Troca do código (uso único) com verificação do PKCE, do redirect, do cliente e do resource. */
  async trocarCodigo(p: Record<string, string | undefined>, recurso: string): Promise<Tokens> {
    const code = String(p.code ?? '');
    const c = ok(await this.db.from('mcp_codigos').select('*').eq('codigo_hash', hash(code)).maybeSingle(), 'código') as any;
    if (!c || c.usado_em || Date.parse(c.expira_em) < this.agora()) throw new ErroOAuth(400, 'invalid_grant', 'Código inválido, expirado ou já usado.');
    ok(await this.db.from('mcp_codigos').update({ usado_em: new Date(this.agora()).toISOString() }).eq('codigo_hash', c.codigo_hash), 'usar código');
    if (p.client_id !== c.client_id) throw new ErroOAuth(400, 'invalid_grant', 'O código foi emitido para outro cliente.');
    if (p.redirect_uri !== c.redirect_uri) throw new ErroOAuth(400, 'invalid_grant', 'redirect_uri diferente do pedido de autorização.');
    const verifier = String(p.code_verifier ?? '');
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || crypto.createHash('sha256').update(verifier).digest('base64url') !== c.code_challenge) {
      throw new ErroOAuth(400, 'invalid_grant', 'code_verifier não confere (PKCE).');
    }
    if (p.resource && !mesmoRecurso(p.resource, c.resource)) throw new ErroOAuth(400, 'invalid_target', 'resource diferente do autorizado.');
    ok(await this.db.from('mcp_clientes').update({ ultimo_uso_em: new Date(this.agora()).toISOString() }).eq('client_id', c.client_id), 'uso do cliente');
    return this.emitirTokens(c.email, c.client_id, c.resource || recurso, c.scope || ESCOPO, aleatorio(12));
  }

  /** Refresh rotativo: o antigo deixa de valer; reuso de um refresh já trocado revoga a família inteira. */
  async renovar(p: Record<string, string | undefined>): Promise<Tokens> {
    const t = ok(await this.db.from('mcp_tokens').select('*').eq('token_hash', hash(String(p.refresh_token ?? ''))).eq('tipo', 'refresh').maybeSingle(), 'refresh') as any;
    if (!t || Date.parse(t.expira_em) < this.agora()) throw new ErroOAuth(400, 'invalid_grant', 'Refresh token inválido ou expirado.');
    if (t.revogado_em) {
      ok(await this.db.from('mcp_tokens').update({ revogado_em: new Date(this.agora()).toISOString() }).eq('familia', t.familia), 'revogar família');
      throw new ErroOAuth(400, 'invalid_grant', 'Refresh token já usado: a conexão foi revogada por segurança. Conecte de novo.');
    }
    if (p.client_id && p.client_id !== t.client_id) throw new ErroOAuth(400, 'invalid_grant', 'Refresh token de outro cliente.');
    if (p.resource && !mesmoRecurso(p.resource, t.resource)) throw new ErroOAuth(400, 'invalid_target', 'resource diferente do autorizado.');
    ok(await this.db.from('mcp_tokens').update({ revogado_em: new Date(this.agora()).toISOString() }).eq('token_hash', t.token_hash), 'girar refresh');
    return this.emitirTokens(t.email, t.client_id, t.resource, t.scope || ESCOPO, t.familia);
  }

  /** Revogação (RFC 7009): refresh revoga a família; acesso/pessoal revoga o próprio. Sempre responde 200. */
  async revogarToken(token: string) {
    const t = ok(await this.db.from('mcp_tokens').select('token_hash,tipo,familia').eq('token_hash', hash(token)).maybeSingle(), 'revogar') as any;
    if (!t) return;
    const quando = new Date(this.agora()).toISOString();
    if (t.familia) ok(await this.db.from('mcp_tokens').update({ revogado_em: quando }).eq('familia', t.familia), 'revogar família');
    else ok(await this.db.from('mcp_tokens').update({ revogado_em: quando }).eq('token_hash', t.token_hash), 'revogar token');
  }

  /** Token de acesso ou pessoal válido para este recurso → e-mail do usuário. */
  async validarAcesso(token: string, recurso: string): Promise<{ email: string; clientId: string | null; tipo: string; nome: string | null; scope: string } | null> {
    if (!/^appura_(at|pt)_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
    const h = hash(token);
    const t = ok(await this.db.from('mcp_tokens').select('token_hash,tipo,email,client_id,nome,resource,scope,expira_em,revogado_em').eq('token_hash', h).maybeSingle(), 'validar token') as any;
    if (!t || t.revogado_em || Date.parse(t.expira_em) < this.agora() || (t.tipo !== 'acesso' && t.tipo !== 'pessoal')) return null;
    if (!mesmoRecurso(t.resource, recurso)) return null;
    const ultimo = this.usoGravado.get(h) ?? 0;
    if (this.agora() - ultimo > 5 * 60_000) {
      this.usoGravado.set(h, this.agora());
      await this.db.from('mcp_tokens').update({ ultimo_uso_em: new Date(this.agora()).toISOString() }).eq('token_hash', h);
    }
    return { email: t.email, clientId: t.client_id, tipo: t.tipo, nome: t.nome, scope: t.scope || ESCOPO };
  }

  /* ---------- painel: tokens pessoais e conexões ---------- */

  async criarPessoal(email: string, nome: string, dias: number, recurso: string, acoes = false) {
    const n = String(nome ?? '').trim().slice(0, 60);
    if (n.length < 2) throw new ErroOAuth(400, 'invalid_request', 'Dê um nome para o token (ex.: "n8n do escritório").');
    const d = [30, 90, 180, 365].includes(Number(dias)) ? Number(dias) : 90;
    const ativos = ok(await this.db.from('mcp_tokens').select('token_hash').eq('email', email).eq('tipo', 'pessoal').is('revogado_em', null).gte('expira_em', new Date(this.agora()).toISOString()).limit(50), 'tokens pessoais') as unknown[];
    if (ativos.length >= 10) throw new ErroOAuth(400, 'invalid_request', 'Limite de 10 tokens ativos por usuário: revogue um antes de criar outro.');
    const token = `appura_pt_${aleatorio(32)}`;
    const expira = new Date(this.agora() + d * 86400_000).toISOString();
    ok(await this.db.from('mcp_tokens').insert({ token_hash: hash(token), tipo: 'pessoal', email, nome: n, resource: recurso, scope: acoes ? ESCOPOS.join(' ') : ESCOPO, final_token: token.slice(-4), criado_em: new Date(this.agora()).toISOString(), expira_em: expira }), 'criar token pessoal');
    return { token, nome: n, expiraEm: expira, acoes };
  }

  /** Conexões do usuário: tokens pessoais ativos e apps conectados por OAuth (sem nunca devolver o token). */
  async conexoes(email: string) {
    const agoraIso = new Date(this.agora()).toISOString();
    const tokens = ok(await this.db.from('mcp_tokens').select('token_hash,tipo,client_id,nome,final_token,scope,criado_em,expira_em,ultimo_uso_em')
      .eq('email', email).is('revogado_em', null).gte('expira_em', agoraIso).order('criado_em', { ascending: false }).limit(500), 'conexões') as any[];
    const pessoais = tokens.filter((t) => t.tipo === 'pessoal').map((t) => ({ id: `t_${t.token_hash.slice(0, 16)}`, tipo: 'pessoal', nome: t.nome, final: t.final_token, acoes: temAcoes(t.scope), criadoEm: t.criado_em, expiraEm: t.expira_em, ultimoUsoEm: t.ultimo_uso_em }));
    const porCliente = new Map<string, any>();
    for (const t of tokens.filter((x) => x.tipo !== 'pessoal' && x.client_id)) {
      const c = porCliente.get(t.client_id) ?? { id: `c_${hash(t.client_id).slice(0, 16)}`, clientId: t.client_id, tipo: 'app', criadoEm: t.criado_em, ultimoUsoEm: t.ultimo_uso_em, acoes: false };
      if (temAcoes(t.scope)) c.acoes = true;
      if (t.ultimo_uso_em && (!c.ultimoUsoEm || t.ultimo_uso_em > c.ultimoUsoEm)) c.ultimoUsoEm = t.ultimo_uso_em;
      if (t.criado_em < c.criadoEm) c.criadoEm = t.criado_em;
      porCliente.set(t.client_id, c);
    }
    const ids = [...porCliente.keys()];
    const nomes = ids.length ? ok(await this.db.from('mcp_clientes').select('client_id,nome').in('client_id', ids), 'nomes dos clientes') as any[] : [];
    const apps = [...porCliente.values()].map((c) => {
      const n = nomes.find((x) => x.client_id === c.clientId);
      let host = '';
      try { host = /^https:/.test(c.clientId) ? new URL(c.clientId).host : ''; } catch { /* ok */ }
      return { id: c.id, tipo: 'app', nome: n ? n.nome : 'App conectado', origem: host, acoes: c.acoes, criadoEm: c.criadoEm, ultimoUsoEm: c.ultimoUsoEm };
    });
    return { apps, pessoais };
  }

  async revogarConexao(email: string, id: string) {
    const quando = new Date(this.agora()).toISOString();
    const tokens = ok(await this.db.from('mcp_tokens').select('token_hash,tipo,client_id').eq('email', email).is('revogado_em', null).limit(2000), 'tokens do usuário') as any[];
    const alvo = id.startsWith('t_')
      ? tokens.filter((t) => t.tipo === 'pessoal' && `t_${t.token_hash.slice(0, 16)}` === id)
      : tokens.filter((t) => t.tipo !== 'pessoal' && t.client_id && `c_${hash(t.client_id).slice(0, 16)}` === id);
    if (!alvo.length) throw new ErroOAuth(404, 'invalid_request', 'Conexão não encontrada.');
    for (const t of alvo) ok(await this.db.from('mcp_tokens').update({ revogado_em: quando }).eq('token_hash', t.token_hash), 'revogar conexão');
    return { revogados: alvo.length };
  }
}
