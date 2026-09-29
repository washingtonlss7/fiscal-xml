import 'dotenv/config';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { buscarTodos, criarDb, ok } from '../db';
import { ErroValidacao, salvarEmpresaComCertificado } from '../empresas';
import { log } from '../log';

function exigir(nome: string): string {
  const v = process.env[nome]?.trim();
  if (!v) throw new Error(`Variável de ambiente ${nome} não definida.`);
  return v;
}

const cfg = {
  porta: Number(process.env.PORT ?? 3000),
  supabaseUrl: exigir('SUPABASE_URL'),
  serviceKey: exigir('SUPABASE_SERVICE_ROLE_KEY'),
  masterKey: exigir('MASTER_KEY'),
  emails: new Set(
    exigir('PAINEL_EMAILS')
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  ),
};

const db = criarDb(cfg.supabaseUrl, cfg.serviceKey);
/** Cliente descartável para login: nunca reaproveitar o cliente de serviço para sessões de usuário. */
const clienteAuth = () => createClient(cfg.supabaseUrl, cfg.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const PASTA_PUBLICA = path.resolve(__dirname, '../../public');
const ARQUIVOS: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/icone.svg': ['icone.svg', 'image/svg+xml'],
};

const CABECALHOS_SEGURANCA = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

class ErroHttp extends Error {
  constructor(public readonly status: number, msg: string) {
    super(msg);
  }
}

function responder(res: http.ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(corpo));
}

function lerCorpo(req: http.IncomingMessage, limite = 1_000_000): Promise<any> {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes: Buffer[] = [];
    req.on('data', (p: Buffer) => {
      tamanho += p.length;
      if (tamanho > limite) {
        reject(new ErroHttp(413, 'Envio grande demais.'));
        req.destroy();
      } else partes.push(p);
    });
    req.on('end', () => {
      try {
        resolve(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {});
      } catch {
        reject(new ErroHttp(400, 'Dados inválidos.'));
      }
    });
    req.on('error', reject);
  });
}

// Limite simples de tentativas de login por IP (10 por 5 minutos).
const tentativas = new Map<string, { n: number; desde: number }>();
function limitarTentativas(ip: string) {
  const agora = Date.now();
  const t = tentativas.get(ip);
  if (!t || agora - t.desde > 5 * 60_000) {
    tentativas.set(ip, { n: 1, desde: agora });
    return;
  }
  t.n++;
  if (t.n > 10) throw new ErroHttp(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.');
}

const ipDe = (req: http.IncomingMessage) =>
  String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '';

// Cache curto de tokens válidos para não consultar o Auth a cada requisição.
const cacheTokens = new Map<string, { email: string; ate: number }>();
async function usuarioAutenticado(req: http.IncomingMessage): Promise<string> {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new ErroHttp(401, 'Faça login para continuar.');
  const c = cacheTokens.get(token);
  if (c && c.ate > Date.now()) return c.email;
  const { data, error } = await db.auth.getUser(token);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) throw new ErroHttp(401, 'Sessão expirada. Entre de novo.');
  if (!cfg.emails.has(email)) throw new ErroHttp(403, 'Este e-mail não tem acesso ao painel.');
  cacheTokens.set(token, { email, ate: Date.now() + 60_000 });
  return email;
}

function sessao(s: { access_token: string; refresh_token: string; expires_at?: number } | null | undefined, email: string) {
  if (!s) throw new ErroHttp(401, 'Não foi possível iniciar a sessão.');
  return { accessToken: s.access_token, refreshToken: s.refresh_token, expiraEm: s.expires_at, email };
}

async function rotaApi(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const metodo = req.method ?? 'GET';
  const rota = url.pathname;

  if (metodo === 'POST' && rota === '/api/entrar') {
    limitarTentativas(ipDe(req));
    const { email, senha } = await lerCorpo(req);
    const e = String(email ?? '').trim().toLowerCase();
    if (!cfg.emails.has(e)) throw new ErroHttp(403, 'Este e-mail não tem acesso ao painel.');
    const { data, error } = await clienteAuth().auth.signInWithPassword({ email: e, password: String(senha ?? '') });
    if (error) throw new ErroHttp(401, 'E-mail ou senha incorretos.');
    return responder(res, 200, sessao(data.session, e));
  }

  if (metodo === 'POST' && rota === '/api/primeiro-acesso') {
    limitarTentativas(ipDe(req));
    const { email, senha } = await lerCorpo(req);
    const e = String(email ?? '').trim().toLowerCase();
    const s = String(senha ?? '');
    if (!cfg.emails.has(e)) throw new ErroHttp(403, 'Este e-mail não tem acesso ao painel.');
    if (s.length < 10) throw new ErroHttp(400, 'A senha precisa ter pelo menos 10 caracteres.');
    const criado = await db.auth.admin.createUser({ email: e, password: s, email_confirm: true });
    if (criado.error) {
      if (/already|registered|exists/i.test(criado.error.message)) {
        throw new ErroHttp(409, 'Já existe acesso para este e-mail. Use "Entrar".');
      }
      throw new ErroHttp(400, criado.error.message);
    }
    const { data, error } = await clienteAuth().auth.signInWithPassword({ email: e, password: s });
    if (error) throw new ErroHttp(500, 'Acesso criado, mas o login falhou. Tente entrar.');
    return responder(res, 200, sessao(data.session, e));
  }

  if (metodo === 'POST' && rota === '/api/renovar') {
    const { refreshToken } = await lerCorpo(req);
    const { data, error } = await clienteAuth().auth.refreshSession({ refresh_token: String(refreshToken ?? '') });
    const email = data?.user?.email?.toLowerCase() ?? '';
    if (error || !cfg.emails.has(email)) throw new ErroHttp(401, 'Sessão expirada. Entre de novo.');
    return responder(res, 200, sessao(data.session, email));
  }

  // Daqui para baixo, só usuários autorizados.
  const email = await usuarioAutenticado(req);

  if (metodo === 'GET' && rota === '/api/eu') return responder(res, 200, { email });

  if (metodo === 'GET' && rota === '/api/empresas') {
    const linhas = await buscarTodos(
      (de, ate) => db.from('vw_painel_empresas').select('*').order('razao_social').range(de, ate),
      'listar empresas',
    );
    return responder(res, 200, { empresas: linhas, atualizadoEm: new Date().toISOString() });
  }

  if (metodo === 'POST' && rota === '/api/empresas') {
    const c = await lerCorpo(req, 200_000);
    try {
      const r = await salvarEmpresaComCertificado(db, cfg.masterKey, {
        pfx: Buffer.from(String(c.arquivoBase64 ?? ''), 'base64'),
        senha: String(c.senha ?? ''),
        uf: String(c.uf ?? ''),
        cnpj: c.cnpj ? String(c.cnpj) : undefined,
        razaoSocial: c.razaoSocial ? String(c.razaoSocial) : undefined,
        regime: c.regime ? String(c.regime) : null,
        codigoErp: c.codigoErp ? String(c.codigoErp) : null,
      });
      log.info('certificado cadastrado pelo painel', { cnpj: r.cnpj, por: email, novo: r.novoCadastro });
      return responder(res, 200, r);
    } catch (e) {
      if (e instanceof ErroValidacao) throw new ErroHttp(422, e.message);
      throw e;
    }
  }

  const acao = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/(sincronizar|ativo)$/);
  if (metodo === 'POST' && acao) {
    const [, id, tipo] = acao;
    if (tipo === 'sincronizar') {
      const pendentes = ok(
        await db.from('sync_requests').select('id').eq('empresa_id', id).in('status', ['pendente', 'processando']).limit(1),
        'consultar pedidos',
      ) as unknown[];
      if (!pendentes.length) {
        ok(await db.from('sync_requests').insert({ empresa_id: id }), 'criar pedido');
      }
      return responder(res, 200, { mensagem: 'Sincronização pedida. O coletor começa em até 1 minuto.' });
    }
    const { ativo } = await lerCorpo(req);
    ok(await db.from('empresas').update({ ativo: !!ativo }).eq('id', id), 'atualizar empresa');
    log.info('empresa ativada/pausada pelo painel', { id, ativo: !!ativo, por: email });
    return responder(res, 200, { ativo: !!ativo });
  }

  throw new ErroHttp(404, 'Rota não encontrada.');
}

function arquivoEstatico(res: http.ServerResponse, url: URL): boolean {
  const alvo = ARQUIVOS[url.pathname];
  if (!alvo) return false;
  const [nome, tipo] = alvo;
  res.writeHead(200, {
    ...CABECALHOS_SEGURANCA,
    'Content-Type': tipo,
    'Cache-Control': nome === 'index.html' ? 'no-cache' : 'public, max-age=300',
  });
  res.end(fs.readFileSync(path.join(PASTA_PUBLICA, nome)));
  return true;
}

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/saude') return responder(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) return await rotaApi(req, res, url);
    if (req.method === 'GET' && arquivoEstatico(res, url)) return;
    responder(res, 404, { erro: 'Página não encontrada.' });
  } catch (e) {
    if (e instanceof ErroHttp) return responder(res, e.status, { erro: e.message });
    log.error('erro no painel', { rota: url.pathname, erro: (e as Error).message });
    responder(res, 500, { erro: 'Erro inesperado no servidor. Tente de novo.' });
  }
});

servidor.listen(cfg.porta, () => log.info('painel no ar', { porta: cfg.porta, emailsAutorizados: cfg.emails.size }));

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sinal, () => servidor.close(() => process.exit(0)));
}
