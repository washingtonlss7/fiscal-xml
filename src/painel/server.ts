import 'dotenv/config';
import crypto from 'crypto';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { buscarTodos, criarDb, ok } from '../db';
import { ErroValidacao, salvarEmpresaComCertificado } from '../empresas';
import { log } from '../log';
import { Zip } from './zip';
import { registrarStatus } from '../status';
import { abrirEnvio, agruparMotivos, importarXmls } from '../importacao/importar';
import { Aba, Coluna, escreverXlsx } from './xlsx';
import { buscar as buscarXml, caminhoNoZip, ErroBusca, FiltroBusca, lerFiltro as lerFiltroBusca, listaChaves, MAX_ZIP, NotaBusca, notasParaExcel, notasParaZip, registrarDownload, UF_DA_CHAVE } from './buscaXml';
import { abasST, lerRegrasST, relatorioST } from '../fiscal/relatorioST';
import { lerTabelaCsv, tabelaParaCsv } from '../fiscal/st';
import { Armazenamento, configArmazenamento } from '../armazenamento';
import { auditarMes } from '../auditoria/motor';
import { REGRAS } from '../auditoria/regras';
import { ErroSped, ServicoSped } from './sped';
import { ServicoGuias } from './guias';
import { configIntegra, ErroIntegra, IntegraContador, transporteHttps } from '../integra/cliente';
import { ErroAcessorias, MAX_PDF, ServicoAcessorias, TIPOS_DOCUMENTO, TIPOS_UPLOAD } from '../integra/acessorias';
import { ErroDocumento, ServicoDocumentosEntrega } from './documentosEntrega';
import { listarVendasSemNota } from './rejeitadas';
import { apuracaoReal } from './apuracaoReal';
import { historico as historicoCaptacao, importacoes as importacoesCaptacao, lacunas as lacunasCaptacao, lerPeriodo, monitor as monitorCaptacao } from './captacao';
import { CAMPOS as CAMPOS_CADASTRO, editarCadastro, ErroCadastro, lerCadastro, REGIMES as REGIMES_CADASTRO } from './cadastroEmpresa';
import { ErroOAuth, ServicoOAuth } from '../mcp/oauth';
import { rotaMcp, OpcoesMcpHttp } from '../mcp/http';
import { Confirmacoes } from '../mcp/acoes';
import { usoMcp } from '../mcp/uso';
import { ErroApontamento, resolverApontamento } from './apontamentos';
import { ErroApuracao, ServicoApuracao } from './apuracao';
import { ErroGerarSped, ServicoGerarSped } from './gerarSped';
import { ErroColetor, LOTE_MAX_BYTES, ServicoColetor } from '../coletor/servico';
import { ErroIntegracao, ServicoIntegracao } from '../integracao/servico';
import { ErroContabil, ServicoContabil } from '../contabil/servico';
import { ErroPlanilha } from '../contabil/planilha';
import { authDoSupabase, ErroUsuario, GestaoUsuarios } from './usuarios';
import { Acesso, algumVer, empresaDaRota, exigenciaDaRota, idsDoEscopo, MODULOS, noEscopo, pode, podeEmpresa } from './acesso';

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
  '/visao-geral.js': ['visao-geral.js', 'text/javascript; charset=utf-8'],
  '/empresa-360.js': ['empresa-360.js', 'text/javascript; charset=utf-8'],
  '/sped.js': ['sped.js', 'text/javascript; charset=utf-8'],
  '/documentos.js': ['documentos.js', 'text/javascript; charset=utf-8'],
  '/busca-xml.js': ['busca-xml.js', 'text/javascript; charset=utf-8'],
  '/cadastro.js': ['cadastro.js', 'text/javascript; charset=utf-8'],
  '/apuracao-real.js': ['apuracao-real.js', 'text/javascript; charset=utf-8'],
  '/sincronizacao.js': ['sincronizacao.js', 'text/javascript; charset=utf-8'],
  '/guias.js': ['guias.js', 'text/javascript; charset=utf-8'],
  '/apuracao.js': ['apuracao.js', 'text/javascript; charset=utf-8'],
  '/sped-gerar.js': ['sped-gerar.js', 'text/javascript; charset=utf-8'],
  '/ia.js': ['ia.js', 'text/javascript; charset=utf-8'],
  '/coletores.js': ['coletores.js', 'text/javascript; charset=utf-8'],
  '/captacao.js': ['captacao.js', 'text/javascript; charset=utf-8'],
  '/integracoes.js': ['integracoes.js', 'text/javascript; charset=utf-8'],
  '/acesso.js': ['acesso.js', 'text/javascript; charset=utf-8'],
  '/contabil.js': ['contabil.js', 'text/javascript; charset=utf-8'],
  '/nucleo.js': ['nucleo.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8'],
  '/icone-192.png': ['icone-192.png', 'image/png'],
  '/icone-512.png': ['icone-512.png', 'image/png'],
  '/icone-maskable-512.png': ['icone-maskable-512.png', 'image/png'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png'],
  '/icones.svg': ['icones.svg', 'image/svg+xml'],
  '/logo.png': ['logo.png', 'image/png'],
  '/favicon.png': ['favicon.png', 'image/png'],
  '/fonts/inter.woff2': ['fonts/inter.woff2', 'font/woff2'],
  '/fonts/poppins-500.woff2': ['fonts/poppins-500.woff2', 'font/woff2'],
  '/fonts/poppins-600.woff2': ['fonts/poppins-600.woff2', 'font/woff2'],
};

const CABECALHOS_SEGURANCA = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
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

/** Lê o corpo bruto (upload de arquivo), com limite de tamanho. */
function lerBruto(req: http.IncomingMessage, limite: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let tamanho = 0;
    const partes: Buffer[] = [];
    req.on('data', (p: Buffer) => {
      tamanho += p.length;
      if (tamanho > limite) {
        reject(new ErroHttp(413, `Arquivo grande demais (máximo ${Math.round(limite / 1024 / 1024)} MB). Divida em partes menores.`));
        req.destroy();
      } else partes.push(p);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
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

/** Usuários: fixos de PAINEL_EMAILS (administradores) + ativos da tabela painel_usuarios (lida a cada 1 min). */
const usuarios = new GestaoUsuarios(db, authDoSupabase(db), cfg.emails, (email) => {
  for (const [t, c] of cacheTokens) if (c.email === email) cacheTokens.delete(t);
});
const autorizado = async (email: string) => (await usuarios.acessoDe(email)) !== null;

/** A empresa (ou o registro de uma empresa) que a rota acessa está no escopo do usuário? */
async function conferirEscopo(acesso: Acesso, rota: string) {
  if (acesso.empresas === null) return;
  const alvo = empresaDaRota(rota);
  if (!alvo) return;
  let empresa: string | null = null;
  if ('empresa' in alvo) empresa = alvo.empresa;
  else {
    const r = ok(await db.from(alvo.tabela).select('empresa_id').eq('id', alvo.id).maybeSingle(), 'empresa do registro') as { empresa_id: string | null } | null;
    empresa = r?.empresa_id ?? null;
  }
  if (empresa && !podeEmpresa(acesso, empresa)) throw new ErroHttp(403, 'Esta empresa não está no seu acesso. Fale com um administrador.');
}

/**
 * Empresas para uma ação em lote: as pedidas (ou todas, se nenhuma) dentro do escopo do usuário.
 * undefined = sem restrição (todas). Com escopo e nada sobrando, recusa (lista vazia significaria "todas").
 */
function idsPermitidos(acesso: Acesso, pedidas?: string[]): string[] | undefined {
  if (acesso.empresas === null) return pedidas && pedidas.length ? pedidas : undefined;
  const r = (pedidas && pedidas.length ? pedidas : [...acesso.empresas]).filter((id) => acesso.empresas!.has(id));
  if (!r.length) throw new ErroHttp(403, 'Nenhuma das empresas está no seu acesso.');
  return r;
}

async function usuarioAutenticado(req: http.IncomingMessage): Promise<string> {
  const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token) throw new ErroHttp(401, 'Faça login para continuar.');
  const c = cacheTokens.get(token);
  if (c && c.ate > Date.now()) return c.email;
  const { data, error } = await db.auth.getUser(token);
  const email = data?.user?.email?.toLowerCase();
  if (error || !email) throw new ErroHttp(401, 'Sessão expirada. Entre de novo.');
  if (!(await autorizado(email))) throw new ErroHttp(403, 'Este e-mail não tem acesso ao painel.');
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
    if (!(await autorizado(e))) throw new ErroHttp(403, 'Este e-mail não tem acesso ao painel.');
    const { data, error } = await clienteAuth().auth.signInWithPassword({ email: e, password: String(senha ?? '') });
    if (error) throw new ErroHttp(401, 'E-mail ou senha incorretos.');
    return responder(res, 200, sessao(data.session, e));
  }

  if (metodo === 'POST' && rota === '/api/primeiro-acesso') {
    limitarTentativas(ipDe(req));
    const { email, senha } = await lerCorpo(req);
    const e = String(email ?? '').trim().toLowerCase();
    const s = String(senha ?? '');
    if (!(await autorizado(e))) throw new ErroHttp(403, 'Este e-mail não tem acesso ao painel.');
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
    if (error || !(await autorizado(email))) throw new ErroHttp(401, 'Sessão expirada. Entre de novo.');
    return responder(res, 200, sessao(data.session, email));
  }

  // API do Appura Coletor (programa no PC do cliente): autenticada pelo token da máquina, não pelo login do painel
  if (rota.startsWith('/api/coletor/v1/')) {
    const ctx = await servicoColetor.autenticar(req.headers.authorization);
    servicoColetor.limitar(ctx);
    if (metodo === 'GET' && rota === '/api/coletor/v1/config') return responder(res, 200, await servicoColetor.configuracao(ctx));
    if (metodo === 'POST' && rota === '/api/coletor/v1/existentes') return responder(res, 200, await servicoColetor.existentes(ctx, await lerCorpo(req, 200_000)));
    if (metodo === 'POST' && rota === '/api/coletor/v1/sinal') return responder(res, 200, await servicoColetor.sinal(ctx, await lerCorpo(req, 50_000)));
    if (metodo === 'POST' && rota === '/api/coletor/v1/xml') {
      const corpo = await lerBruto(req, LOTE_MAX_BYTES);
      if (!corpo.length) throw new ErroHttp(400, 'Lote vazio.');
      return responder(res, 200, await servicoColetor.receber(ctx, (url.searchParams.get('nome') || 'lote.zip').slice(0, 200), corpo));
    }
    throw new ErroHttp(404, 'Rota do coletor não encontrada.');
  }

  // API de integração (ex.: OnnePharma): autenticada pelo token da integração, só leitura de NF-e e NFC-e
  if (rota.startsWith('/api/integracao/v1/')) {
    const ctx = await servicoIntegracao.autenticar(req.headers.authorization);
    servicoIntegracao.limitar(ctx);
    const reg = (status: number, itens: number | null) => servicoIntegracao.registrar(ctx, `${metodo} ${rota}`, status, itens, ipDe(req)).catch(() => {});
    try {
      const cnpj = url.searchParams.get('cnpj');
      if (metodo === 'GET' && rota === '/api/integracao/v1/empresas') { const r = servicoIntegracao.empresas(ctx); await reg(200, r.empresas.length); return responder(res, 200, r); }
      if (metodo === 'GET' && rota === '/api/integracao/v1/documentos') {
        const r = await servicoIntegracao.documentos(ctx, { cursor: url.searchParams.get('cursor'), cnpj, modelo: url.searchParams.get('modelo'), direcao: url.searchParams.get('direcao'), limite: Number(url.searchParams.get('limite') ?? 100) });
        await reg(200, r.documentos.length);
        return responder(res, 200, r);
      }
      const ix = rota.match(/^\/api\/integracao\/v1\/documentos\/(\d{44})\/xml$/);
      if (metodo === 'GET' && ix) {
        const r = await servicoIntegracao.xml(ctx, ix[1], cnpj);
        await reg(200, 1);
        res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="${ix[1]}${r.completo ? '' : '-resumo'}.xml"`, 'X-Appura-Completo': String(r.completo), 'Cache-Control': 'no-store' });
        return void res.end(r.xml);
      }
      if (metodo === 'POST' && rota === '/api/integracao/v1/xml/zip') {
        const c = await lerCorpo(req, 100_000);
        const n = await servicoIntegracao.zip(ctx, c.chaves, c.cnpj ?? cnpj, res, () => res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="xmls.zip"', 'Cache-Control': 'no-store' }));
        await reg(200, n);
        return void res.end();
      }
      throw new ErroHttp(404, 'Rota da API não encontrada.');
    } catch (e) {
      await reg((e as any).status ?? 500, null);
      throw e;
    }
  }

  // Daqui para baixo, só usuários autorizados.
  const email = await usuarioAutenticado(req);
  const acesso = await usuarios.acessoDe(email);
  if (!acesso) throw new ErroHttp(403, 'Este e-mail não tem acesso ao painel.');
  const exigida = exigenciaDaRota(metodo, rota);
  if (exigida === 'algum.ver' ? !algumVer(acesso) : exigida !== null && !pode(acesso, exigida)) {
    throw new ErroHttp(403, 'Seu perfil não permite esta ação. Fale com um administrador.');
  }
  await conferirEscopo(acesso, rota);
  const escopo = idsDoEscopo(acesso);
  const escopoSet = acesso.empresas;
  // Filtro de empresa na consulta (?empresa=) também precisa estar no escopo
  const empresaPedida = url.searchParams.get('empresa');
  if (empresaPedida && /^[0-9a-f-]{36}$/.test(empresaPedida) && !podeEmpresa(acesso, empresaPedida)) {
    throw new ErroHttp(403, 'Esta empresa não está no seu acesso. Fale com um administrador.');
  }

  if (metodo === 'GET' && rota === '/api/eu') {
    const ativos = await usuarios.modulosAtivos();
    return responder(res, 200, {
      email, nome: acesso.nome, perfil: acesso.perfilId, perfilNome: acesso.perfilNome, fixo: acesso.fixo,
      permissoes: [...acesso.permissoes].sort(), escopo: acesso.escopo, empresasNoEscopo: acesso.empresas ? acesso.empresas.size : null,
      modulos: MODULOS.map((m) => ({ id: m.id, nome: m.nome, disponivel: m.disponivel, ativo: ativos.has(m.id) })),
    });
  }

  // Gestão de usuários e do acesso (as regras ficam em GestaoUsuarios)
  if (rota === '/api/usuarios') {
    if (metodo === 'GET') {
      return responder(res, 200, { usuarios: await usuarios.listar(), historico: await usuarios.historico(30), perfis: await usuarios.perfis(), modulos: await usuarios.modulos() });
    }
    if (metodo === 'POST') {
      await usuarios.criar(email, await lerCorpo(req));
      return responder(res, 200, { ok: true });
    }
  }
  const rotaUsuario = rota.match(/^\/api\/usuarios\/([^/]+)(\/redefinir-senha)?$/);
  if (rotaUsuario) {
    const alvo = decodeURIComponent(rotaUsuario[1]);
    if (metodo === 'PATCH' && !rotaUsuario[2]) {
      await usuarios.editar(email, alvo, await lerCorpo(req));
      return responder(res, 200, { ok: true });
    }
    if (metodo === 'POST' && rotaUsuario[2]) {
      await usuarios.redefinirSenha(email, alvo);
      return responder(res, 200, { ok: true });
    }
    if (metodo === 'DELETE' && !rotaUsuario[2]) {
      await usuarios.excluir(email, alvo, (await lerCorpo(req)).confirmacao);
      return responder(res, 200, { ok: true });
    }
  }

  // Perfis, módulos contratados e responsáveis por empresa (carteira)
  if (rota.startsWith('/api/acesso/')) {
    if (rota === '/api/acesso/perfis' && metodo === 'GET') return responder(res, 200, { perfis: await usuarios.perfis(), modulos: await usuarios.modulos() });
    if (rota === '/api/acesso/perfis' && metodo === 'POST') return responder(res, 200, await usuarios.salvarPerfil(email, await lerCorpo(req, 50_000)));
    const pf = rota.match(/^\/api\/acesso\/perfis\/([a-z][a-z0-9_]{1,40})$/);
    if (pf && metodo === 'PATCH') return responder(res, 200, await usuarios.salvarPerfil(email, { ...(await lerCorpo(req, 50_000)), id: pf[1] }));
    if (pf && metodo === 'DELETE') { await usuarios.excluirPerfil(email, pf[1]); return responder(res, 200, { ok: true }); }
    const md = rota.match(/^\/api\/acesso\/modulos\/([a-z]{2,20})$/);
    if (rota === '/api/acesso/modulos' && metodo === 'GET') return responder(res, 200, { modulos: await usuarios.modulos() });
    if (md && metodo === 'PATCH') { await usuarios.definirModulo(email, md[1], (await lerCorpo(req)).ativo === true); return responder(res, 200, { ok: true }); }
    if (rota === '/api/acesso/responsaveis' && metodo === 'GET') return responder(res, 200, await usuarios.responsaveis());
    if (rota === '/api/acesso/responsaveis' && metodo === 'POST') return responder(res, 200, await usuarios.definirResponsaveis(email, await lerCorpo(req, 500_000)));
    if (rota === '/api/acesso/sugestoes-acessorias' && metodo === 'GET') return responder(res, 200, await usuarios.sugestoesAcessorias());
    if (rota === '/api/acesso/sugestoes-acessorias' && metodo === 'POST') return responder(res, 200, await usuarios.aplicarSugestoes(email, (await lerCorpo(req, 2_000_000)).itens));
    throw new ErroHttp(404, 'Rota não encontrada.');
  }

  // Contábil: processador de lançamentos (regras do Contábil) e livro
  if (rota.startsWith('/api/contabil/')) return rotaContabil(req, res, url, metodo, rota, email, acesso);

  // Avisos em tempo real para a tela (stream de texto). O navegador recarrega a lista quando chega "mudou".
  if (metodo === 'GET' && rota === '/api/eventos') return abrirEventos(req, res);

  // Visão Geral: tudo agregado numa chamada só ao banco (painel_visao_geral)
  if (metodo === 'GET' && rota === '/api/visao-geral') {
    const mes = url.searchParams.get('mes') ?? '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ErroHttp(400, 'Competência inválida. Use AAAA-MM.');
    const { data, error } = await db.rpc('painel_visao_geral', { p_competencia: `${mes}-01` });
    if (error) throw new Error(`visão geral: ${error.message}`);
    if (escopoSet && data) {
      data.empresas = noEscopo(acesso, data.empresas ?? [], (e: any) => e.id);
      data.captacao = noEscopo(acesso, data.captacao ?? [], (e: any) => e.empresa_id);
      data.auditoria = noEscopo(acesso, data.auditoria ?? [], (e: any) => e.empresa_id);
    }
    return responder(res, 200, data);
  }

  if (metodo === 'GET' && rota === '/api/empresas') {
    const linhas = await buscarTodos(
      (de, ate) => db.from('vw_painel_empresas').select('*').order('razao_social').range(de, ate),
      'listar empresas',
    );
    return responder(res, 200, { empresas: noEscopo(acesso, linhas, (e: any) => e.id), atualizadoEm: new Date().toISOString() });
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
        escritorio: typeof c.escritorio === 'boolean' ? c.escritorio : undefined,
      });
      log.info('certificado cadastrado pelo painel', { cnpj: r.cnpj, por: email, novo: r.novoCadastro });
      return responder(res, 200, r);
    } catch (e) {
      if (e instanceof ErroValidacao) throw new ErroHttp(422, e.message);
      throw e;
    }
  }

  // Cadastro da empresa (regime, IE, endereço, contador, captação): leitura livre; edição com permissão de cadastro
  // Vendas sem nota autorizada (XMLs importados que a SEFAZ rejeitou, sem nota boa no mesmo número)
  // Apuração do Lucro Real/Presumido: ICMS e PIS/COFINS do SPED gerado pelo Appura × SPED enviado do mês
  const apReal = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/apuracao-real$/);
  if (apReal && metodo === 'GET') {
    const mes = url.searchParams.get('mes') ?? '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ErroHttp(400, 'Informe o mês no formato AAAA-MM.');
    return responder(res, 200, await apuracaoReal(db, apReal[1], mes));
  }

  const rejEmp = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/rejeitadas$/);
  if (rejEmp && metodo === 'GET') {
    const de = url.searchParams.get('de') ?? ''; const ate = url.searchParams.get('ate') ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}$/.test(ate)) throw new ErroHttp(400, 'Informe o período.');
    const fim = new Date(Date.parse(`${ate}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    return responder(res, 200, await listarVendasSemNota(db, rejEmp[1], `${de}T00:00:00-03:00`, `${fim}T00:00:00-03:00`));
  }

  const cadEmp = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/cadastro$/);
  if (cadEmp && metodo === 'GET') return responder(res, 200, { cadastro: await lerCadastro(db, cadEmp[1]), campos: CAMPOS_CADASTRO, regimes: REGIMES_CADASTRO });
  if (cadEmp && metodo === 'PATCH') {
    try { return responder(res, 200, await editarCadastro(db, cadEmp[1], await lerCorpo(req, 50_000), email)); } catch (e) {
      if (e instanceof ErroCadastro) return responder(res, e.status, { erro: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) });
      throw e;
    }
  }

  // Andamento do último pedido de sincronização (barra de status do botão "Sincronizar")
  const sincSt = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/sincronizacao$/);
  if (sincSt && metodo === 'GET') {
    const p = ok(await db.from('sync_requests').select('id,status,mensagem,solicitado_em,iniciado_em,processado_em,progresso')
      .eq('empresa_id', sincSt[1]).order('solicitado_em', { ascending: false }).order('id', { ascending: false }).limit(1), 'pedido de sincronização') as any[];
    return responder(res, 200, { pedido: p[0] ?? null });
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
      // Pedido manual vale a qualquer horário (a busca automática é que fica na janela da noite)
      return responder(res, 200, { mensagem: 'Sincronização iniciada: a busca na SEFAZ começa em alguns segundos.' });
    }
    const { ativo } = await lerCorpo(req);
    ok(await db.from('empresas').update({ ativo: !!ativo }).eq('id', id), 'atualizar empresa');
    log.info('empresa ativada/pausada pelo painel', { id, ativo: !!ativo, por: email });
    return responder(res, 200, { ativo: !!ativo });
  }

  const aud = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/auditoria(\/lote|\/refazer)?$/);
  if (aud) {
    const [, id, sub] = aud;
    if (metodo === 'GET' && !sub) return listarAuditoria(res, id, filtroNotas(url));
    if (metodo === 'POST' && sub === '/refazer') {
      const { mes } = await lerCorpo(req);
      const f = filtroNotas(new URL(`http://x/?mes=${encodeURIComponent(String(mes ?? ''))}`));
      const r = await auditarMes(db, id, f.de.slice(0, 10));
      return responder(res, 200, { apontamentos: r.apontamentos.length });
    }
    if (metodo === 'POST' && sub === '/lote') {
      const c = await lerCorpo(req);
      const f = filtroNotas(new URL(`http://x/?mes=${encodeURIComponent(String(c.mes ?? ''))}`));
      const abertos = ok(
        await db.from('apontamentos').select('*').eq('empresa_id', id).eq('competencia', f.de.slice(0, 10))
          .eq('regra', String(c.regra ?? '')).eq('status', 'aberto'),
        'listar apontamentos do lote',
      ) as any[];
      for (const a of abertos) await resolverApontamento(db, a, String(c.acao), c.observacao ? String(c.observacao) : null, null, email);
      log.info('auditoria em lote', { empresa: id, regra: c.regra, acao: c.acao, quantidade: abertos.length, por: email });
      return responder(res, 200, { quantidade: abertos.length });
    }
  }

  const apont = rota.match(/^\/api\/apontamentos\/(\d+)$/);
  if (metodo === 'POST' && apont) {
    const c = await lerCorpo(req);
    const a = ok(await db.from('apontamentos').select('*').eq('id', Number(apont[1])).maybeSingle(), 'ler apontamento') as any;
    if (!a) throw new ErroHttp(404, 'Apontamento não encontrado.');
    await resolverApontamento(db, a, String(c.acao), c.observacao ? String(c.observacao) : null, c.valor ? String(c.valor) : null, email);
    return responder(res, 200, { ok: true });
  }

  // Captação: Monitor, Lacunas/NSU, Importações e Histórico (só leitura)
  if (metodo === 'GET' && rota === '/api/captacao/monitor') return responder(res, 200, await monitorCaptacao(db, Date.now(), escopoSet));
  if (metodo === 'GET' && rota === '/api/captacao/lacunas') {
    const mes = url.searchParams.get('mes') ?? '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ErroHttp(400, 'Informe o mês (AAAA-MM).');
    return responder(res, 200, await lacunasCaptacao(db, mes, escopoSet));
  }
  if (metodo === 'GET' && rota === '/api/captacao/importacoes') {
    const p = lerPeriodo(url); const origem = url.searchParams.get('origem');
    return responder(res, 200, await importacoesCaptacao(db, { ...p, origem: origem === 'manual' || origem === 'coletor' ? origem : null }, escopoSet));
  }
  if (metodo === 'GET' && rota === '/api/captacao/historico') {
    const p = lerPeriodo(url, 14);
    return responder(res, 200, await historicoCaptacao(db, { ...p, soErros: url.searchParams.get('erros') === '1' }, escopoSet));
  }

  // Integrações por API (ex.: OnnePharma): token, CNPJs liberados e webhook
  if (rota === '/api/integracoes' && metodo === 'GET') return responder(res, 200, await servicoIntegracao.listar());
  if (rota === '/api/integracoes' && metodo === 'POST') return responder(res, 200, await servicoIntegracao.criar(await lerCorpo(req, 50_000), email));
  const integ = rota.match(/^\/api\/integracoes\/([0-9a-f-]{36})(?:\/(segredo|revogar|testar|reenviar))?$/);
  if (integ && metodo === 'PATCH' && !integ[2]) return responder(res, 200, await servicoIntegracao.editar(integ[1], await lerCorpo(req, 50_000), email));
  if (integ && metodo === 'POST' && integ[2] === 'segredo') return responder(res, 200, await servicoIntegracao.trocarSegredo(integ[1], email));
  if (integ && metodo === 'POST' && integ[2] === 'revogar') return responder(res, 200, await servicoIntegracao.revogar(integ[1], email));
  if (integ && metodo === 'POST' && integ[2] === 'testar') return responder(res, 200, await servicoIntegracao.testarWebhook(integ[1]));
  if (integ && metodo === 'POST' && integ[2] === 'reenviar') return responder(res, 200, await servicoIntegracao.reenviarFalhas(integ[1]));

  // Appura Coletor: instalações (cliente/grupo com seus CNPJs) e tokens por máquina
  if (rota === '/api/coletores' && metodo === 'GET') {
    const r = await servicoColetor.listar();
    if (escopoSet) r.instalacoes = (r.instalacoes as any[]).filter((i) => (i.empresas ?? []).some((e: any) => escopoSet.has(e.id)));
    return responder(res, 200, r);
  }
  if (rota === '/api/coletores' && metodo === 'POST') return responder(res, 200, await servicoColetor.criarInstalacao(await lerCorpo(req, 50_000), email));
  const colInst = rota.match(/^\/api\/coletores\/([0-9a-f-]{36})$/);
  if (colInst && metodo === 'PATCH') return responder(res, 200, await servicoColetor.editarInstalacao(colInst[1], await lerCorpo(req, 50_000), email));
  const colMaq = rota.match(/^\/api\/coletores\/([0-9a-f-]{36})\/maquinas$/);
  if (colMaq && metodo === 'POST') return responder(res, 200, await servicoColetor.adicionarMaquinas(colMaq[1], await lerCorpo(req, 10_000), email));
  const colRev = rota.match(/^\/api\/coletores\/maquinas\/([0-9a-f-]{36})\/revogar$/);
  if (colRev && metodo === 'POST') return responder(res, 200, await servicoColetor.revogarMaquina(colRev[1], email));

  // Importação de XML/ZIP (NF-e e NFC-e de saída, ou qualquer nota que falte)
  const imp = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/importar$/);
  if (metodo === 'POST' && imp) {
    const empresa = ok(await db.from('empresas').select('id,cnpj,c_uf').eq('id', imp[1]).maybeSingle(), 'ler empresa') as
      { id: string; cnpj: string; c_uf: number } | null;
    if (!empresa) throw new ErroHttp(404, 'Empresa não encontrada.');
    const nome = (url.searchParams.get('nome') || 'arquivo.xml').slice(0, 200);
    const inicio = Date.now();
    // Todo envio fica registrado (importacoes_xml), inclusive o que falhar inteiro, para dar para investigar depois
    const registrar = async (r: Partial<{ arquivos: number; importadas: number; completouResumo: number; jaExistiam: number; rejeitadas: number; motivos: unknown; erro: string }>) => {
      const { error } = await db.from('importacoes_xml').insert({
        empresa_id: empresa.id, email, arquivo: nome, arquivos: r.arquivos ?? 0, importadas: r.importadas ?? 0, completou_resumo: r.completouResumo ?? 0,
        ja_existiam: r.jaExistiam ?? 0, rejeitadas: r.rejeitadas ?? 0, motivos: r.motivos ?? null, erro: r.erro ?? null, duracao_ms: Date.now() - inicio,
      });
      if (error) log.warn('importação sem registro', { erro: error.message });
    };
    try {
      const corpo = await lerBruto(req, 80 * 1024 * 1024);
      if (!corpo.length) throw new ErroHttp(400, 'Arquivo vazio.');
      let arquivos;
      try {
        arquivos = abrirEnvio(nome, corpo);
      } catch (e) {
        throw new ErroHttp(422, `${nome}: ${(e as Error).message}`);
      }
      if (!arquivos.length) throw new ErroHttp(422, `${nome}: nenhum XML encontrado.`);
      const r = await importarXmls(db, arm, empresa, arquivos);
      const motivos = agruparMotivos(r.resultados);
      log.info('importação de XML', { empresa: empresa.cnpj, arquivo: nome, por: email, importadas: r.importadas, completou: r.completouResumo, repetidas: r.jaExistiam, rejeitadas: r.rejeitadas, motivos: motivos.slice(0, 3).map((m) => `${m.quantidade}× ${m.motivo}`) });
      await registrar({ ...r, motivos: motivos.length ? motivos : null });
      // Devolve só as rejeitadas em detalhe (o resto vai resumido)
      return responder(res, 200, { ...r, motivos, resultados: r.resultados.filter((x) => x.situacao === 'rejeitada').slice(0, 1000) });
    } catch (e) {
      await registrar({ erro: (e as Error).message.slice(0, 500) });
      log.error('importação de XML falhou', { empresa: empresa.cnpj, arquivo: nome, por: email, erro: (e as Error).message });
      throw e;
    }
  }

  // SPED Fiscal (EFD ICMS/IPI) e SPED Contribuições (EFD PIS/COFINS): lê, valida, compara e guarda o arquivo e o resultado.
  const sped = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/sped$/);
  if (sped && metodo === 'GET') {
    const f = filtroNotas(url);
    const comp = `${f.mes}-01`;
    const [a, c, si] = await Promise.all([servicoSped.vigente(sped[1], comp), servicoSped.vigente(sped[1], comp, 'efd_contribuicoes'), servicoSped.vigente(sped[1], comp, 'sintegra')]);
    return responder(res, 200, {
      vigente: a ? servicoSped.resposta(a) : null, arquivos: await servicoSped.historico(sped[1], comp),
      contribuicoes: { vigente: c ? servicoSped.resposta(c) : null, arquivos: await servicoSped.historico(sped[1], comp, 'efd_contribuicoes') },
      sintegra: { vigente: si ? servicoSped.resposta(si) : null, arquivos: await servicoSped.historico(sped[1], comp, 'sintegra') },
      sugestao: await servicoSped.sugestaoPendente(sped[1]),
    });
  }
  if ((metodo === 'POST' && sped) || (metodo === 'POST' && rota === '/api/sped')) {
    // Envio sem empresa (o Appura acha pelo CNPJ do arquivo): só para quem vê todas as empresas
    if (!sped && escopoSet) throw new ErroHttp(403, 'Envie o SPED pela tela da empresa (seu acesso é limitado a algumas empresas).');
    let esperada: { id: string; cnpj: string } | undefined;
    if (sped) {
      esperada = ok(await db.from('empresas').select('id,cnpj').eq('id', sped[1]).maybeSingle(), 'ler empresa') as { id: string; cnpj: string } | undefined;
      if (!esperada) throw new ErroHttp(404, 'Empresa não encontrada.');
    }
    const nome = (url.searchParams.get('nome') || 'sped.txt').slice(0, 200);
    const corpo = await lerBruto(req, 150 * 1024 * 1024);
    if (!corpo.length) throw new ErroHttp(400, 'Arquivo vazio.');
    if (corpo[0] === 0x50 && corpo[1] === 0x4b) throw new ErroHttp(422, 'Envie o arquivo .txt do SPED (não compactado).');
    return responder(res, 200, await servicoSped.receber(nome, corpo, email, esperada));
  }
  const spedArq = rota.match(/^\/api\/sped\/(\d+)\/(arquivo|refazer|justificar|reabrir)$/);
  if (spedArq) {
    const a = await servicoSped.porId(Number(spedArq[1]));
    if (!a) throw new ErroHttp(404, 'Arquivo SPED não encontrado.');
    if (metodo === 'GET' && spedArq[2] === 'arquivo') {
      const conteudo = await servicoSped.baixar(a);
      res.writeHead(200, {
        ...CABECALHOS_SEGURANCA,
        'Content-Type': 'text/plain; charset=iso-8859-1',
        'Content-Disposition': `attachment; filename="${a.nome.replace(/[^\w.\- ]+/g, '_')}"`,
        'Cache-Control': 'no-store',
      });
      log.info('SPED baixado', { id: a.id, cnpj: a.cnpj, por: email });
      return void res.end(conteudo);
    }
    if (metodo === 'POST' && (spedArq[2] === 'justificar' || spedArq[2] === 'reabrir')) {
      const c = await lerCorpo(req, 2_000_000);
      const itens = Array.isArray(c.itens) ? c.itens.map((i: any) => ({ tipo: String(i?.tipo ?? ''), chave: String(i?.chave ?? '') })) : [];
      const novo = await servicoSped.justificar(a, itens, spedArq[2] === 'justificar' ? String(c.observacao ?? '') : null, email);
      return responder(res, 200, servicoSped.resposta(novo));
    }
    if (metodo === 'POST' && spedArq[2] === 'refazer') {
      const novo = await servicoSped.recomparar(a);
      log.info('comparação do SPED refeita', { id: a.id, cnpj: a.cnpj, por: email, divergencias: novo.divergencias });
      return responder(res, 200, servicoSped.resposta(novo));
    }
  }

  // Pré-cadastro pelo SPED: o escritório confere e aprova
  if (metodo === 'GET' && rota === '/api/cadastros') {
    const r: any = await servicoSped.listarSugestoes();
    if (escopoSet) for (const k of Object.keys(r)) if (Array.isArray(r[k])) r[k] = r[k].filter((x: any) => x?.empresa_id ? escopoSet.has(x.empresa_id) : pode(acesso, 'administracao.empresas'));
    return responder(res, 200, r);
  }
  const cad = rota.match(/^\/api\/cadastros\/(\d+)\/(aprovar|rejeitar)$/);
  if (metodo === 'POST' && cad) {
    const id = Number(cad[1]);
    if (cad[2] === 'rejeitar') {
      await servicoSped.rejeitar(id, email);
      return responder(res, 200, { ok: true });
    }
    const c = await lerCorpo(req);
    const campos = Array.isArray(c.campos) ? c.campos.map(String) : [];
    return responder(res, 200, await servicoSped.aprovar(id, email, campos, c.regime ? String(c.regime) : null));
  }

  // ICMS-ST nas entradas de outros estados (planilha ou resumo)
  const st = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/st$/);
  if (metodo === 'GET' && st) {
    const f = filtroNotas(url);
    const ajustar = url.searchParams.get('mva') === 'ajustada';
    const r = await relatorioST(db, st[1], f.de, f.ate, ajustar);
    if (url.searchParams.get('formato') === 'xlsx') {
      res.writeHead(200, {
        ...CABECALHOS_SEGURANCA,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="ST_${r.empresa.cnpj}_${f.mes}.xlsx"`,
        'Cache-Control': 'no-store',
      });
      await escreverXlsx(new Zip(res), abasST(r, f.mes, ajustar));
      return void res.end();
    }
    const notasComST = new Set(r.linhas.map((l) => l.nota.chave)).size;
    return responder(res, 200, {
      uf: r.empresa.uf, total: r.total, notasForaDoEstado: r.notasForaDoEstado, notasComST, itensCalculados: r.linhas.length,
      itensSemRegra: r.semRegra.length, valorSemRegra: Math.round(r.semRegra.reduce((t, x) => t + x.item.v_prod, 0) * 100) / 100,
      jaRetidos: r.jaRetidos, regrasCadastradas: r.regrasCadastradas,
    });
  }

  // Tabela de ST do ES (CSV): baixar e substituir
  if (rota === '/api/st-es/tabela') {
    if (metodo === 'GET') {
      const regras = await lerRegrasST(db);
      res.writeHead(200, {
        ...CABECALHOS_SEGURANCA,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="tabela_st_es.csv"',
        'Cache-Control': 'no-store',
      });
      return void res.end(tabelaParaCsv(regras));
    }
    if (metodo === 'POST') {
      const { csv } = await lerCorpo(req, 5_000_000);
      const { regras, erros } = lerTabelaCsv(String(csv ?? ''));
      if (erros.length) throw new ErroHttp(422, `A tabela não foi importada. ${erros.slice(0, 8).join(' ')}${erros.length > 8 ? ` (e mais ${erros.length - 8} erros)` : ''}`);
      if (!regras.length) throw new ErroHttp(422, 'Nenhuma regra encontrada no arquivo.');
      const n = ok(await db.rpc('substituir_regras_st', { p_regras: regras, p_por: email }), 'gravar tabela de ST') as number;
      log.info('tabela de ST do ES importada', { regras: n, por: email });
      return responder(res, 200, { regras: n });
    }
  }

  // Empresa 360°: cadastro, certificado, captação, números da competência e histórico numa chamada só
  // Apuração do Simples Nacional (etapa B: prévia da segregação e ajustes manuais)
  const apu = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/apuracao(\/ajustes)?$/);
  if (apu) {
    const mesApu = url.searchParams.get('mes') ?? new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
    if (metodo === 'GET' && !apu[2]) return responder(res, 200, await servicoApuracao.previa(apu[1], mesApu));
    if (metodo === 'POST' && apu[2]) {
      const c = await lerCorpo(req, 10_000);
      const r = await servicoApuracao.adicionarAjuste(apu[1], String(c.mes ?? mesApu), c, email);
      log.info('apuração: ajuste lançado', { empresa: apu[1], mes: c.mes ?? mesApu, valor: c.valor, atividade: c.atividade, por: email });
      return responder(res, 200, r);
    }
  }
  const apuSim = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/apuracao\/simular$/);
  if (apuSim && metodo === 'POST') {
    const c = await lerCorpo(req, 10_000);
    const mesSim = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(c.mes)) ? String(c.mes) : '';
    if (!mesSim) throw new ErroHttp(400, 'Informe o mês no formato AAAA-MM.');
    const r = await servicoApuracao.simular(apuSim[1], mesSim, email, c.retificar === true);
    log.info('PGDAS-D simulado', { empresa: apuSim[1], mes: mesSim, total: (r as any).total_devido, tipo: (r as any).tipo, por: email });
    return responder(res, 200, r);
  }
  const apuTx = rota.match(/^\/api\/apuracao\/(\d+)\/transmitir$/);
  if (apuTx && metodo === 'POST') {
    const c = await lerCorpo(req, 10_000);
    if (c.confirmo !== true) throw new ErroHttp(400, 'Confirme que conferiu a apuração antes de transmitir.');
    const r = await servicoApuracao.transmitir(Number(apuTx[1]), email, { gerarDas: c.gerarDas === true });
    log.info('PGDAS-D transmitido', { apuracao: apuTx[1], idDeclaracao: (r as any).id_declaracao, por: email });
    return responder(res, 200, r);
  }
  const apuPdf = rota.match(/^\/api\/apuracao\/(\d+)\/(recibo|declaracao|maed-notificacao|maed-darf)$/);
  if (apuPdf && metodo === 'GET') {
    const f = await servicoApuracao.pdf(Number(apuPdf[1]), apuPdf[2] as any);
    res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${f.nome.replace(/[^\w.\- ]+/g, '_')}"`, 'Cache-Control': 'no-store' });
    log.info('PGDAS-D: PDF baixado', { apuracao: apuPdf[1], qual: apuPdf[2], por: email });
    return void res.end(f.conteudo);
  }
  const apuAj = rota.match(/^\/api\/apuracao\/ajustes\/(\d+)$/);
  if (apuAj && metodo === 'DELETE') {
    const r = await servicoApuracao.removerAjuste(Number(apuAj[1]));
    log.info('apuração: ajuste removido', { ...r, por: email });
    return responder(res, 200, { ok: true });
  }

  // SPED gerado pelo Appura (Fiscal e Contribuições): gerar, listar versões, baixar e auditar
  const sg = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/sped-gerado$/);
  if (sg) {
    const mesSg = /^\d{4}-(0[1-9]|1[0-2])$/.test(url.searchParams.get('mes') ?? '') ? url.searchParams.get('mes')! : new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
    if (metodo === 'GET') return responder(res, 200, await servicoGerarSped.listar(sg[1], mesSg));
    if (metodo === 'POST') {
      const c = await lerCorpo(req, 10_000);
      const tipo = c.tipo === 'efd_contribuicoes' ? 'efd_contribuicoes' : c.tipo === 'efd_icms_ipi' ? 'efd_icms_ipi' : null;
      if (!tipo) throw new ErroHttp(400, 'Tipo de SPED inválido.');
      const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(c.mes)) ? String(c.mes) : mesSg;
      return responder(res, 200, await servicoGerarSped.gerar(sg[1], mes, tipo, email));
    }
  }
  const sgArq = rota.match(/^\/api\/sped-gerado\/(\d+)\/(arquivo|auditar)$/);
  if (sgArq && metodo === 'GET' && sgArq[2] === 'arquivo') {
    const f = await servicoGerarSped.baixar(Number(sgArq[1]));
    res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'text/plain; charset=iso-8859-1', 'Content-Disposition': `attachment; filename="${f.nome.replace(/[^\w.\- ]+/g, '_')}"`, 'Cache-Control': 'no-store' });
    log.info('SPED gerado baixado', { id: sgArq[1], por: email });
    return void res.end(f.conteudo);
  }
  if (sgArq && metodo === 'POST' && sgArq[2] === 'auditar') return responder(res, 200, await servicoGerarSped.auditar(Number(sgArq[1]), email));

  // Conexões de IA (MCP): cada usuário vê, cria e revoga só as próprias
  if (rota === '/api/mcp/conexoes' && metodo === 'GET') {
    return responder(res, 200, { url: `${urlPublica(req)}/mcp`, ...(await servicoOAuth.conexoes(email)) });
  }
  if (rota === '/api/mcp/uso' && metodo === 'GET') {
    return responder(res, 200, await usoMcp(db, Number(url.searchParams.get('dias') ?? 7)));
  }
  if (rota === '/api/mcp/tokens' && metodo === 'POST') {
    const c = await lerCorpo(req, 10_000);
    const querAcoes = c.acoes === true;
    if (querAcoes && !pode(acesso, 'fiscal.operar')) throw new ErroHttp(403, 'Seu perfil não opera o fiscal: o token só pode ser de leitura.');
    const r = await servicoOAuth.criarPessoal(email, String(c.nome ?? ''), Number(c.dias), `${urlPublica(req)}/mcp`, querAcoes);
    log.info('MCP: token pessoal criado', { email, nome: r.nome, acoes: querAcoes });
    return responder(res, 200, r);
  }
  const conexao = rota.match(/^\/api\/mcp\/conexoes\/([ct]_[0-9a-f]{16})$/);
  if (conexao && metodo === 'DELETE') {
    const r = await servicoOAuth.revogarConexao(email, conexao[1]);
    log.info('MCP: conexão revogada', { email, id: conexao[1] });
    return responder(res, 200, r);
  }

  // Integração com o Sistema Acessórias (token cifrado; só administrador altera)
  if (rota === '/api/acessorias' || rota === '/api/acessorias/testar') {
    if (metodo === 'GET' && rota === '/api/acessorias') return responder(res, 200, await servicoAcessorias.situacao());
    if (metodo === 'POST' && rota === '/api/acessorias') return responder(res, 200, await servicoAcessorias.salvar(await lerCorpo(req, 10_000), email));
    if (metodo === 'DELETE' && rota === '/api/acessorias') return responder(res, 200, await servicoAcessorias.remover(email));
    if (metodo === 'POST' && rota === '/api/acessorias/testar') return responder(res, 200, await servicoAcessorias.testar(email));
    throw new ErroHttp(404, 'Rota não encontrada.');
  }

  // Acessórias: documentos do mês (recibos e guias além do DAS), cadastro das empresas e entregas
  if (rota.startsWith('/api/acessorias/') || rota.startsWith('/api/documentos/') || /^\/api\/empresas\/[0-9a-f-]{36}\/(documentos|acessorias)/.test(rota)) {
    const mesUrl = url.searchParams.get('mes') ?? '';
    const mesHoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
    const mesAc = /^\d{4}-(0[1-9]|1[0-2])$/.test(mesUrl) ? mesUrl : mesHoje;
    const docsEmp = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/documentos$/);
    if (docsEmp && metodo === 'GET') {
      const e = ok(await db.from('empresas').select('id,cnpj').eq('id', docsEmp[1]).maybeSingle(), 'empresa') as { id: string; cnpj: string } | null;
      if (!e) throw new ErroHttp(404, 'Empresa não encontrada.');
      const situacao = await servicoAcessorias.situacao();
      const [entregas] = situacao.configurado ? await servicoAcessorias.entregasDoMes(mesAc, [e.id]) : [];
      return responder(res, 200, {
        competencia: mesAc, documentos: await servicoDocumentos.listar(e.id, mesAc),
        tipos: TIPOS_UPLOAD.map((t) => ({ id: t, nome: TIPOS_DOCUMENTO[t] })),
        acessorias: { configurado: situacao.configurado, envioAutomatico: situacao.envioAutomatico },
        cadastro: situacao.configurado ? await servicoAcessorias.obrigacoesDaEmpresa(e.cnpj) : null,
        entregas: entregas ?? null,
      });
    }
    if (docsEmp && metodo === 'POST') {
      const pdf = await lerBruto(req, MAX_PDF + 1024);
      const r = await servicoDocumentos.registrar(docsEmp[1], mesAc, {
        tipo: String(url.searchParams.get('tipo') ?? ''), descricao: url.searchParams.get('descricao'), nomeOriginal: (url.searchParams.get('nome') || 'documento.pdf').slice(0, 200), pdf,
      }, email);
      return responder(res, 200, r);
    }
    const entEmp = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/acessorias\/entregas$/);
    if (entEmp && metodo === 'POST') {
      await servicoAcessorias.atualizarEntregas(entEmp[1], mesAc, email);
      const [r] = await servicoAcessorias.entregasDoMes(mesAc, [entEmp[1]]);
      return responder(res, 200, r ?? null);
    }
    const doc = rota.match(/^\/api\/documentos\/(\d+)(?:\/(arquivo|enviar))?$/);
    if (doc && metodo === 'GET' && doc[2] === 'arquivo') {
      const a = await servicoDocumentos.baixar(Number(doc[1]));
      res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${a.nome.replace(/[^\w.\- ]+/g, '_')}"`, 'Cache-Control': 'no-store' });
      return void res.end(a.conteudo);
    }
    if (doc && metodo === 'POST' && doc[2] === 'enviar') {
      const c = await lerCorpo(req);
      return responder(res, 200, await servicoAcessorias.enviarDocumento(Number(doc[1]), email, c.forcar === true));
    }
    if (doc && metodo === 'DELETE' && !doc[2]) return responder(res, 200, await servicoDocumentos.remover(Number(doc[1]), email));
    if (metodo === 'POST' && rota === '/api/acessorias/documentos/enviar') {
      const c = await lerCorpo(req);
      const comp = /^\d{4}-\d{2}$/.test(String(c.mes)) ? String(c.mes) : mesAc;
      const ids = idsPermitidos(acesso, Array.isArray(c.empresas) ? c.empresas.map(String).filter((x: string) => /^[0-9a-f-]{36}$/.test(x)) : undefined);
      const p = await servicoAcessorias.documentosPendentes(comp, ids);
      return responder(res, 200, { resultados: await servicoAcessorias.enviarDocumentos(p.documentos.map((d) => d.id), email), jaEnviados: p.jaEnviados });
    }
    if (metodo === 'GET' && rota === '/api/acessorias/empresas') return responder(res, 200, await servicoAcessorias.resumoEmpresas());
    if (metodo === 'POST' && rota === '/api/acessorias/empresas/sincronizar') return responder(res, 200, await servicoAcessorias.sincronizarEmpresas(email));
    if (metodo === 'GET' && rota === '/api/acessorias/entregas') {
      const lista = noEscopo(acesso, await servicoAcessorias.entregasDoMes(mesAc), (l) => l.empresaId);
      const nomes = new Map((ok(await db.from('empresas').select('id,cnpj,razao_social').limit(100000), 'empresas') as any[]).map((e) => [e.id, e]));
      const empresas = lista.map((l) => ({ ...l, razao_social: nomes.get(l.empresaId)?.razao_social ?? null, cnpj: nomes.get(l.empresaId)?.cnpj ?? null, entregas: l.entregas.filter((x) => x.situacao === 'atrasada' || x.situacao === 'pendente') }))
        .filter((l) => l.contagem.atrasada || l.contagem.pendente || l.erro)
        .sort((a, b) => b.contagem.atrasada - a.contagem.atrasada || b.contagem.pendente - a.contagem.pendente);
      // Escopo vazio = nenhuma empresa (lista vazia no serviço significaria "todas")
      const docs = escopo && !escopo.length ? { documentos: [], jaEnviados: 0 } : await servicoAcessorias.documentosPendentes(mesAc, escopo).catch(() => ({ documentos: [], jaEnviados: 0 }));
      return responder(res, 200, {
        competencia: mesAc, progresso: servicoAcessorias.progressoEntregas(), consultadas: lista.length,
        totais: lista.reduce((t, l) => ({ entregue: t.entregue + l.contagem.entregue, atrasada: t.atrasada + l.contagem.atrasada, pendente: t.pendente + l.contagem.pendente }), { entregue: 0, atrasada: 0, pendente: 0 }),
        empresas: empresas.slice(0, 300), documentosPendentes: docs.documentos.length,
      });
    }
    if (metodo === 'POST' && rota === '/api/acessorias/entregas/atualizar') {
      const c = await lerCorpo(req);
      return responder(res, 200, await servicoAcessorias.iniciarEntregasDoMes(/^\d{4}-\d{2}$/.test(String(c.mes)) ? String(c.mes) : mesAc, email));
    }
    throw new ErroHttp(404, 'Rota não encontrada.');
  }

  // Guias pelo Integra Contador (SERPRO)
  if (rota.startsWith('/api/guias') || /^\/api\/empresas\/[0-9a-f-]{36}\/guias/.test(rota)) {
    // Mês é opcional aqui (situação, chaves, teste e PDF não dependem dele): sem mês válido, vale o mês corrente
    const mesUrl = url.searchParams.get('mes') ?? '';
    const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(mesUrl) ? mesUrl : new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
    if (metodo === 'GET' && rota === '/api/guias') {
      const p = await servicoGuias.painel(mes);
      return responder(res, 200, { ...p, empresas: noEscopo(acesso, p.empresas, (e) => e.id) });
    }
    if (metodo === 'GET' && rota === '/api/guias/situacao') return responder(res, 200, await servicoGuias.situacao());
    if (metodo === 'POST' && rota === '/api/guias/testar') return responder(res, 200, await servicoGuias.testarConexao(email));
    if (metodo === 'POST' && rota === '/api/guias/chaves') return responder(res, 200, await servicoGuias.salvarChaves(await lerCorpo(req, 10_000), email));
    if (metodo === 'DELETE' && rota === '/api/guias/chaves') return responder(res, 200, await servicoGuias.removerChaves(email));
    if (metodo === 'POST' && rota === '/api/guias/enviar-pendentes') {
      const c = await lerCorpo(req);
      const ids = idsPermitidos(acesso, Array.isArray(c.ids) ? c.ids.map(String).filter((x: string) => /^[0-9a-f-]{36}$/.test(x)) : undefined);
      return responder(res, 200, await servicoAcessorias.enviarPendentes(/^\d{4}-\d{2}$/.test(String(c.mes)) ? String(c.mes) : mes, email, ids));
    }
    const envio = rota.match(/^\/api\/guias\/(\d+)\/enviar$/);
    if (metodo === 'POST' && envio) {
      const c = await lerCorpo(req);
      return responder(res, 200, await servicoAcessorias.enviarGuia(Number(envio[1]), email, c.forcar === true));
    }
    if (metodo === 'POST' && rota === '/api/guias/lote') {
      const c = await lerCorpo(req);
      const acao = c.acao === 'das' ? 'das' : c.acao === 'procuracao' ? 'procuracao' : null;
      if (!acao) throw new ErroHttp(400, 'Ação inválida.');
      const pedidas = Array.isArray(c.ids) ? c.ids.map(String).filter((x: string) => /^[0-9a-f-]{36}$/.test(x)) : [];
      if (!pedidas.length) throw new ErroHttp(400, 'Selecione ao menos uma empresa.');
      const ids = idsPermitidos(acesso, pedidas) ?? pedidas;
      return responder(res, 200, await servicoGuias.lote(acao, ids, /^\d{4}-\d{2}$/.test(String(c.mes)) ? String(c.mes) : mes, email));
    }
    const pdf = rota.match(/^\/api\/guias\/(\d+)\/pdf$/);
    if (metodo === 'GET' && pdf) {
      const g = await servicoGuias.pdf(Number(pdf[1]));
      res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${g.nome.replace(/[^\w.\- ]+/g, '_')}"`, 'Cache-Control': 'no-store' });
      log.info('guia baixada', { id: pdf[1], por: email });
      return void res.end(g.conteudo);
    }
    const eg = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/guias(?:\/(procuracao|declaracao|das))?$/);
    if (eg && metodo === 'GET' && !eg[2]) return responder(res, 200, await servicoGuias.daEmpresa(eg[1], mes));
    if (eg && metodo === 'POST' && eg[2]) {
      const c = await lerCorpo(req);
      const m = /^\d{4}-\d{2}$/.test(String(c.mes)) ? String(c.mes) : mes;
      if (eg[2] === 'procuracao') return responder(res, 200, await servicoGuias.verificarProcuracao(eg[1], email));
      if (eg[2] === 'declaracao') return responder(res, 200, await servicoGuias.consultarDeclaracao(eg[1], m, email));
      return responder(res, 200, await servicoGuias.gerarDas(eg[1], m, email, c.forcar === true));
    }
    throw new ErroHttp(404, 'Rota não encontrada.');
  }

  const e360 = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/360$/);
  if (metodo === 'GET' && e360) {
    const f = filtroNotas(url);
    const { data, error } = await db.rpc('painel_empresa_360', { p_empresa: e360[1], p_competencia: `${f.mes}-01` });
    if (error) throw new Error(`empresa 360: ${error.message}`);
    if (!data) throw new ErroHttp(404, 'Empresa não encontrada.');
    return responder(res, 200, data);
  }

  // Busca de XML (escritório inteiro ou uma empresa): lista paginada, ZIP (até 5.000) e Excel
  if (metodo === 'GET' && rota === '/api/xml/busca') {
    const q = Object.fromEntries(url.searchParams.entries());
    return responder(res, 200, await buscarXml(db, lerFiltroBusca(q), Number(q.pagina) || 1, escopo));
  }
  if (metodo === 'POST' && (rota === '/api/xml/zip' || rota === '/api/xml/excel')) {
    const c = await lerCorpo(req, 400_000);
    const f = lerFiltroBusca(c.filtros && typeof c.filtros === 'object' ? c.filtros : {});
    if (!podeEmpresa(acesso, f.empresa)) throw new ErroHttp(403, 'Esta empresa não está no seu acesso. Fale com um administrador.');
    const chaves = Array.isArray(c.chaves) && c.chaves.length ? listaChaves(c.chaves.map(String).join(' ')) : undefined;
    const registroFiltros = { ...f, termo: f.termo.slice(0, 500), selecionadas: chaves ? chaves.length : undefined };
    if (rota === '/api/xml/excel') {
      const notasX = await notasParaExcel(db, f, chaves, escopo);
      if (!notasX.length) throw new ErroHttp(404, 'Nenhuma nota com esses filtros.');
      const erroReg = await registrarDownload(db, { email, tipo: 'excel', empresaId: f.empresa, filtros: registroFiltros, quantidade: notasX.length });
      if (erroReg) log.warn('download sem registro', { erro: erroReg });
      log.info('busca de XML exportada', { quantidade: notasX.length, empresa: f.empresa, por: email });
      res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="notas_${f.de}_${f.ate}.xlsx"`, 'Cache-Control': 'no-store' });
      await escreverXlsx(new Zip(res), [abaBuscaXml(notasX, f, !f.empresa)]);
      return void res.end();
    }
    return baixarZipBusca(res, f, chaves, email, registroFiltros, escopo);
  }

  const notas = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/(notas|xml|zip)$/);
  if (metodo === 'GET' && notas) {
    const [, id, tipo] = notas;
    if (tipo === 'xml') return baixarXml(res, id, url.searchParams.get('chave') ?? '', email);
    const filtro = filtroNotas(url);
    if (tipo === 'zip') return baixarZip(res, id, filtro, email);
    return listarNotas(res, id, filtro);
  }

  throw new ErroHttp(404, 'Rota não encontrada.');
}

/* ---------- contábil ---------- */

async function rotaContabil(req: http.IncomingMessage, res: http.ServerResponse, url: URL, metodo: string, rota: string, email: string, acesso: Acesso) {
  const q = (k: string) => url.searchParams.get(k) ?? '';
  // Escopo: quem não vê todas as empresas só enxerga as do Contábil ligadas a empresas do seu escopo
  const permitidas = acesso.empresas === null ? null : new Set((ok(await db.from('ctb_empresas').select('id,empresa_id').limit(10000), 'escopo contábil') as any[]).filter((e) => e.empresa_id && acesso.empresas!.has(e.empresa_id)).map((e) => e.id as string));
  const exigirEmpresa = (id: string | null | undefined) => { if (permitidas && (!id || !permitidas.has(id))) throw new ErroHttp(403, 'Esta empresa não está no seu acesso. Fale com um administrador.'); };
  const arquivoEnviado = async (limite: number) => { const b = await lerBruto(req, limite); if (!b.length) throw new ErroHttp(400, 'Arquivo vazio.'); return b; };
  const nomeArq = () => (q('nome') || 'arquivo.csv').slice(0, 200);

  if (metodo === 'GET' && rota === '/api/contabil/resumo') {
    const [config, emps, planos, processamentos, arquivos] = await Promise.all([servicoContabil.config(), servicoContabil.empresas(), servicoContabil.planos(), servicoContabil.processamentos(15), servicoContabil.arquivos(20)]);
    const empresas = permitidas ? emps.filter((e: any) => permitidas.has(e.id)) : emps;
    return responder(res, 200, { config, empresas, planos, processamentos: permitidas ? [] : processamentos, arquivos: permitidas ? arquivos.filter((a: any) => permitidas.has(a.ctb_empresa_id)) : arquivos, pode: { configurar: pode(acesso, 'contabil.configurar'), operar: pode(acesso, 'contabil.operar'), fechar: pode(acesso, 'contabil.fechar') } });
  }
  if (rota === '/api/contabil/config' && metodo === 'PATCH') return responder(res, 200, await servicoContabil.salvarConfig(email, await lerCorpo(req)));
  if (rota === '/api/contabil/empresas' && metodo === 'GET') { const l = await servicoContabil.empresas(); return responder(res, 200, { empresas: permitidas ? l.filter((e: any) => permitidas.has(e.id)) : l }); }
  if (rota === '/api/contabil/empresas' && metodo === 'POST') return responder(res, 200, await servicoContabil.salvarEmpresa(email, await lerCorpo(req)));
  if (rota === '/api/contabil/empresas/importar' && metodo === 'POST') return responder(res, 200, await servicoContabil.importarEmpresas(email, nomeArq(), await arquivoEnviado(20 * 1024 * 1024)));
  if (rota === '/api/contabil/empresas/do-appura' && metodo === 'POST') return responder(res, 200, await servicoContabil.trazerDoAppura(email));
  const per = rota.match(/^\/api\/contabil\/periodos\/(\d+)$/);
  if (per && metodo === 'DELETE') { await servicoContabil.excluirPeriodo(Number(per[1])); return responder(res, 200, { ok: true }); }

  if (rota === '/api/contabil/planos' && metodo === 'GET') return responder(res, 200, { planos: await servicoContabil.planos() });
  const pc = rota.match(/^\/api\/contabil\/planos\/([0-9a-f-]{36})\/contas$/);
  if (pc && metodo === 'GET') return responder(res, 200, { contas: await servicoContabil.contas(pc[1], q('busca').slice(0, 60)) });
  if (rota === '/api/contabil/planos/importar' && metodo === 'POST') return responder(res, 200, await servicoContabil.importarPlano(email, q('plano'), q('padrao') === '1', nomeArq(), await arquivoEnviado(20 * 1024 * 1024)));

  const rg = rota.match(/^\/api\/contabil\/regras\/(fiscal|folha)(?:\/(\d+|importar))?$/);
  if (rg) {
    const tipo = rg[1] as 'fiscal' | 'folha';
    if (metodo === 'GET' && !rg[2]) return responder(res, 200, { regras: await servicoContabil.regras(tipo) });
    if (metodo === 'POST' && !rg[2]) return responder(res, 200, await servicoContabil.salvarRegra(email, tipo, await lerCorpo(req)));
    if (metodo === 'POST' && rg[2] === 'importar') return responder(res, 200, await servicoContabil.importarRegras(email, tipo, nomeArq(), await arquivoEnviado(20 * 1024 * 1024)));
    if (metodo === 'PATCH' && rg[2] && rg[2] !== 'importar') return responder(res, 200, await servicoContabil.salvarRegra(email, tipo, { ...(await lerCorpo(req)), id: Number(rg[2]) }));
    if (metodo === 'DELETE' && rg[2] && rg[2] !== 'importar') { await servicoContabil.excluirRegra(tipo, Number(rg[2])); return responder(res, 200, { ok: true }); }
  }
  const mod = rota.match(/^\/api\/contabil\/modelos\/([a-z_]+)$/);
  if (mod && metodo === 'GET') {
    const m = servicoContabil.modelo(mod[1]);
    res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${m.nome}"`, 'Cache-Control': 'no-store' });
    return void res.end(m.csv);
  }

  if (rota === '/api/contabil/processar/fiscal' && metodo === 'POST') {
    const c = await lerCorpo(req);
    let ids = Array.isArray(c.empresas) ? c.empresas.map(String) : [];
    if (permitidas) { ids = (ids.length ? ids : [...permitidas]).filter((i: string) => permitidas.has(i)); if (!ids.length) throw new ErroHttp(403, 'Nenhuma empresa do seu acesso.'); }
    return responder(res, 200, await servicoContabil.processarFiscal(email, { empresas: ids, inicio: String(c.inicio ?? ''), fim: String(c.fim ?? '') }));
  }
  if (rota === '/api/contabil/processar/folha' && metodo === 'POST') {
    if (permitidas) throw new ErroHttp(403, 'A planilha da folha tem várias empresas: só quem vê todas as empresas pode processar.');
    return responder(res, 200, await servicoContabil.processarFolha(email, nomeArq(), await arquivoEnviado(50 * 1024 * 1024)));
  }
  if (rota === '/api/contabil/reprocessar' && metodo === 'POST') {
    const c = await lerCorpo(req);
    if (permitidas) exigirEmpresa(c.ctb_empresa_id);
    return responder(res, 200, await servicoContabil.reprocessar(email, { tudo: c.tudo === true, ctb_empresa_id: c.ctb_empresa_id ? String(c.ctb_empresa_id) : null }));
  }
  if (rota === '/api/contabil/processamentos' && metodo === 'GET') return responder(res, 200, { processamentos: permitidas ? [] : await servicoContabil.processamentos(100) });
  if (rota === '/api/contabil/pendencias' && metodo === 'GET') {
    const emp = q('empresa') || null;
    if (permitidas) exigirEmpresa(emp);
    return responder(res, 200, await servicoContabil.pendencias({ ctb_empresa_id: emp }));
  }
  if (rota === '/api/contabil/lancamentos' && metodo === 'GET') {
    exigirEmpresa(q('empresa'));
    return responder(res, 200, await servicoContabil.lancamentos({ ctb_empresa_id: q('empresa'), inicio: q('inicio'), fim: q('fim'), pagina: Number(q('pagina')) || 1 }));
  }
  if (rota === '/api/contabil/lancamentos' && metodo === 'POST') {
    const c = await lerCorpo(req);
    exigirEmpresa(c.ctb_empresa_id);
    return responder(res, 200, await servicoContabil.lancarManual(email, c));
  }
  const lm = rota.match(/^\/api\/contabil\/lancamentos\/(\d+)$/);
  if (lm && metodo === 'DELETE') {
    const l = ok(await db.from('ctb_lancamentos').select('ctb_empresa_id').eq('id', Number(lm[1])).maybeSingle(), 'lançamento') as any;
    exigirEmpresa(l?.ctb_empresa_id);
    await servicoContabil.excluirLancamentoManual(Number(lm[1]));
    return responder(res, 200, { ok: true });
  }
  if (rota === '/api/contabil/arquivos' && metodo === 'GET') { const l = await servicoContabil.arquivos(200); return responder(res, 200, { arquivos: permitidas ? l.filter((a: any) => permitidas.has(a.ctb_empresa_id)) : l }); }
  if (rota === '/api/contabil/arquivos' && metodo === 'POST') {
    const c = await lerCorpo(req);
    exigirEmpresa(c.ctb_empresa_id);
    const tipo = c.tipo === 'dominio_txt' ? 'dominio_txt' : 'conferencia_xlsx';
    if (tipo === 'dominio_txt' && c.definitivo === true && !pode(acesso, 'contabil.fechar')) throw new ErroHttp(403, 'Arquivo definitivo (trava os lançamentos) exige a permissão de fechar do Contábil.');
    const r = await servicoContabil.gerarArquivo(email, { ctb_empresa_id: String(c.ctb_empresa_id ?? ''), inicio: String(c.inicio ?? ''), fim: String(c.fim ?? ''), tipo, definitivo: c.definitivo === true, reexportar: c.reexportar === true });
    log.info('contábil: arquivo gerado', { tipo, nome: r.nome, por: email });
    if (r.tipo === 'xlsx') {
      res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${r.nome}"`, 'Cache-Control': 'no-store' });
      await escreverXlsx(new Zip(res), r.abas);
      return void res.end();
    }
    res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'text/plain; charset=iso-8859-1', 'Content-Disposition': `attachment; filename="${r.nome}"`, 'Cache-Control': 'no-store' });
    return void res.end(r.conteudo);
  }
  const ab = rota.match(/^\/api\/contabil\/arquivos\/(\d+)\/baixar$/);
  if (ab && metodo === 'GET') {
    const reg = ok(await db.from('ctb_arquivos').select('ctb_empresa_id').eq('id', Number(ab[1])).maybeSingle(), 'arquivo') as any;
    exigirEmpresa(reg?.ctb_empresa_id);
    const a = await servicoContabil.baixarArquivo(Number(ab[1]));
    res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'text/plain; charset=iso-8859-1', 'Content-Disposition': `attachment; filename="${a.nome}"`, 'Cache-Control': 'no-store' });
    return void res.end(a.conteudo);
  }
  throw new ErroHttp(404, 'Rota não encontrada.');
}

/* ---------- auditoria ---------- */

async function listarAuditoria(res: http.ServerResponse, id: string, f: FiltroNotas) {
  const competencia = f.de.slice(0, 10);
  const lista = await buscarTodos<any>(
    (de, ate) => db.from('apontamentos')
      .select('id,regra,severidade,referencia,chave,n_item,mensagem,sugestao,quantidade,status,observacao,resolvido_por,resolvido_em')
      .eq('empresa_id', id).eq('competencia', competencia).order('severidade').order('id').range(de, ate),
    'listar apontamentos',
  );
  const mono = ok(
    await db.rpc('resumo_monofasico', { p_empresa: id, p_de: f.de, p_ate: f.ate }),
    'resumo monofásico',
  ) as { direcao: string; total: number; monofasico: number }[];
  const { count } = await db.from('documentos').select('chave', { count: 'exact', head: true }).eq('empresa_id', id)
    .gte('emitida_em', f.de).lt('emitida_em', f.ate).eq('auditado', false);
  responder(res, 200, { apontamentos: lista, regras: REGRAS, monofasico: mono, aguardandoAuditoria: count ?? 0 });
}

/* ---------- notas ---------- */

interface FiltroNotas {
  mes: string;
  de: string;
  ate: string;
  modelo: string | null;
  direcao: string | null;
}

function filtroNotas(url: URL): FiltroNotas {
  const mes = url.searchParams.get('mes') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ErroHttp(400, 'Informe o mês no formato AAAA-MM.');
  const [a, m] = mes.split('-').map(Number);
  const proximo = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  const modelo = url.searchParams.get('modelo');
  const direcao = url.searchParams.get('direcao');
  return {
    mes,
    de: `${mes}-01T00:00:00-03:00`,
    ate: `${proximo}-01T00:00:00-03:00`,
    modelo: modelo && ['55', '57', '65'].includes(modelo) ? modelo : null,
    direcao: direcao && ['entrada', 'saida'].includes(direcao) ? direcao : null,
  };
}

const COLUNAS_NOTA =
  'chave,modelo,numero,serie,emitida_em,direcao,completo,emit_cnpj,emit_nome,dest_doc,dest_nome,valor,situacao,' +
  'manifestacao_status,manifestacao_motivo,recebido_via,cfop,v_icms,v_st,v_ipi,v_pis,v_cofins,v_ibs,v_cbs,itens_extraidos';

function consultaNotas(id: string, f: FiltroNotas, colunas: string) {
  let q = db.from('documentos').select(colunas).eq('empresa_id', id).gte('emitida_em', f.de).lt('emitida_em', f.ate);
  if (f.modelo) q = q.eq('modelo', f.modelo);
  if (f.direcao) q = q.eq('direcao', f.direcao);
  return q;
}

async function listarNotas(res: http.ServerResponse, id: string, f: FiltroNotas) {
  const linhas = await buscarTodos<any>(
    (de, ate) => consultaNotas(id, f, COLUNAS_NOTA).order('emitida_em', { ascending: false }).range(de, ate),
    'listar notas',
  );
  const soma = (campo: string, filtro: (n: any) => boolean = () => true) =>
    Math.round(linhas.filter((n) => n.situacao === 'autorizada' && filtro(n)).reduce((t, n) => t + Number(n[campo] ?? 0), 0) * 100) / 100;
  const resumo = {
    quantidade: linhas.length,
    canceladas: linhas.filter((n) => n.situacao === 'cancelada').length,
    soResumo: linhas.filter((n) => !n.completo).length,
    entradas: soma('valor', (n) => n.direcao === 'entrada'),
    saidas: soma('valor', (n) => n.direcao === 'saida'),
    icms: soma('v_icms'),
    st: soma('v_st'),
    ipi: soma('v_ipi'),
    pis: soma('v_pis'),
    cofins: soma('v_cofins'),
    ibs: soma('v_ibs'),
    cbs: soma('v_cbs'),
  };
  responder(res, 200, { notas: linhas.slice(0, 1000), total: linhas.length, resumo });
}

const arm = new Armazenamento(db, configArmazenamento(cfg.masterKey, process.env.XML_BUCKET ?? 'xmls'));
const lerXmlStorage = (caminho: string) => arm.ler(caminho);
const servicoSped = new ServicoSped(db, arm);
const servicoColetor = new ServicoColetor(db, arm);
const servicoIntegracao = new ServicoIntegracao(db, arm, cfg.masterKey);
const servicoContabil = new ServicoContabil(db, arm);
// Webhook das integrações: a cada 15 s transforma as mudanças das notas em avisos e entrega os pendentes
let webhookRodando = false;
setInterval(async () => {
  if (webhookRodando) return;
  webhookRodando = true;
  try { await servicoIntegracao.enfileirar(); await servicoIntegracao.entregar(); } catch (e) { log.warn('webhook: ciclo com erro', { erro: (e as Error).message }); } finally { webhookRodando = false; }
}, 15_000).unref();
const cfgIntegra = configIntegra();
// Chaves do SERPRO: as cadastradas no painel (cifradas no banco) têm prioridade; as variáveis do servidor são opcionais
const servicoGuias = new ServicoGuias(db, arm, cfg.masterKey, (c, contratante, registrar) => new IntegraContador(c, contratante, transporteHttps, registrar), cfgIntegra);
if (cfgIntegra) log.info('Integra Contador com chaves do servidor', { ambiente: cfgIntegra.ambiente });
const servicoAcessorias = new ServicoAcessorias(db, arm, cfg.masterKey);
const servicoApuracao = new ServicoApuracao(db, () => new Date(), servicoGuias, arm);
const servicoGerarSped = new ServicoGerarSped(db, arm, servicoSped);
servicoGuias.acessorias = servicoAcessorias;
const servicoDocumentos = new ServicoDocumentosEntrega(db, arm, servicoAcessorias);
servicoApuracao.documentos = servicoDocumentos;

/* ---------- MCP do Appura (IA): OAuth 2.1 próprio + ferramentas de leitura ---------- */
const servicoOAuth = new ServicoOAuth(db);
/** URL pública: PUBLIC_URL, ou o host da requisição (https atrás do proxy do Easypanel). */
function urlPublica(req: http.IncomingMessage): string {
  const fixa = process.env.PUBLIC_URL?.trim();
  if (fixa) return fixa.replace(/\/+$/, '');
  const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost').split(',')[0].trim();
  const proto = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}
const opcoesMcp: OpcoesMcpHttp = {
  oauth: servicoOAuth,
  deps: { db, sped: servicoSped, guias: servicoGuias, acessorias: servicoAcessorias, documentos: servicoDocumentos, confirmacoes: new Confirmacoes(cfg.masterKey), apuracao: servicoApuracao, gerarSped: servicoGerarSped },
  base: urlPublica,
  entrar: async (email, senha, ip) => {
    limitarTentativas(ip);
    const e = email.trim().toLowerCase();
    if (!(await autorizado(e))) throw new Error('Este e-mail não tem acesso ao Appura.');
    const { error } = await clienteAuth().auth.signInWithPassword({ email: e, password: senha });
    if (error) throw new Error('E-mail ou senha incorretos.');
    return e;
  },
  acessoDe: (email) => usuarios.acessoDe(email),
  registrar: async (r) => {
    const { error } = await db.from('mcp_chamadas').insert({ email: r.email, client_id: r.clientId, ferramenta: r.ferramenta, argumentos: r.argumentos ?? null, sucesso: r.sucesso, duracao_ms: r.duracaoMs });
    if (error) log.warn('não registrou chamada do MCP', { erro: error.message });
  },
  lerTexto: async (req, limite) => (await lerBruto(req, limite)).toString('utf8'),
  ip: ipDe,
};

async function baixarXml(res: http.ServerResponse, id: string, chave: string, email: string) {
  if (!/^\d{44}$/.test(chave)) throw new ErroHttp(400, 'Chave inválida.');
  const doc = ok(
    await db.from('documentos').select('xml_path,xml_resumo_path').eq('empresa_id', id).eq('chave', chave).maybeSingle(),
    'buscar nota',
  ) as { xml_path: string | null; xml_resumo_path: string | null } | null;
  const caminho = doc?.xml_path ?? doc?.xml_resumo_path;
  if (!caminho) throw new ErroHttp(404, 'XML não encontrado.');
  const xml = await lerXmlStorage(caminho);
  const erroReg = await registrarDownload(db, { email, tipo: 'xml', empresaId: id, filtros: { chave }, quantidade: 1 });
  if (erroReg) log.warn('download sem registro', { erro: erroReg });
  res.writeHead(200, {
    ...CABECALHOS_SEGURANCA,
    'Content-Type': 'application/xml; charset=utf-8',
    'Content-Disposition': `attachment; filename="${chave}${doc?.xml_path ? '' : '-resumo'}.xml"`,
    'Cache-Control': 'no-store',
  });
  res.end(xml);
}

async function baixarZip(res: http.ServerResponse, id: string, f: FiltroNotas, email: string) {
  const empresa = ok(await db.from('empresas').select('cnpj').eq('id', id).maybeSingle(), 'buscar empresa') as { cnpj: string } | null;
  if (!empresa) throw new ErroHttp(404, 'Empresa não encontrada.');
  const docs = await buscarTodos<any>(
    (de, ate) => consultaNotas(id, f, 'chave,modelo,direcao,situacao,xml_path').not('xml_path', 'is', null).order('emitida_em').range(de, ate),
    'listar XMLs',
  );
  if (!docs.length) throw new ErroHttp(404, 'Nenhum XML completo nesse período.');
  if (docs.length > MAX_ZIP) throw new ErroHttp(413, `O mês tem ${docs.length.toLocaleString('pt-BR')} XMLs: o ZIP tem limite de ${MAX_ZIP.toLocaleString('pt-BR')}. Use a busca de notas com filtros (modelo, direção ou período menor).`);
  const erroReg = await registrarDownload(db, { email, tipo: 'zip', empresaId: id, filtros: { mes: f.mes, modelo: f.modelo, direcao: f.direcao }, quantidade: docs.length });
  if (erroReg) log.warn('download sem registro', { erro: erroReg });

  res.writeHead(200, {
    ...CABECALHOS_SEGURANCA,
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${empresa.cnpj}_${f.mes}.zip"`,
    'Cache-Control': 'no-store',
  });
  const zip = new Zip(res);
  const pasta: Record<string, string> = { '55': 'NFe', '57': 'CTe', '65': 'NFCe' };
  // Baixa do Storage em paralelo (8 por vez) e escreve no ZIP em ordem.
  for (let i = 0; i < docs.length; i += 8) {
    const bloco = docs.slice(i, i + 8);
    const conteudos = await Promise.all(bloco.map((d: any) => lerXmlStorage(d.xml_path).catch(() => null)));
    for (let j = 0; j < bloco.length; j++) {
      const d = bloco[j];
      const c = conteudos[j];
      if (!c) continue;
      const sub = d.situacao === 'cancelada' ? `${d.direcao}/canceladas` : d.direcao;
      await zip.adicionar(`${pasta[d.modelo] ?? d.modelo}/${sub}/${d.chave}.xml`, c);
    }
  }
  await zip.finalizar();
  res.end();
}

/** ZIP da busca de XML: as chaves marcadas ou tudo o que o filtro achar (até 5.000). No escritório inteiro, uma pasta por empresa. */
async function baixarZipBusca(res: http.ServerResponse, f: FiltroBusca, chaves: string[] | undefined, email: string, registroFiltros: unknown, escopo?: string[]) {
  const { notas: lista } = await notasParaZip(db, f, chaves, escopo);
  const comXml = lista.filter((n) => n.xml_path);
  if (!comXml.length) throw new ErroHttp(404, lista.length ? 'As notas encontradas só têm o resumo (sem XML completo).' : 'Nenhuma nota com esses filtros.');
  const porEmpresa = new Set(comXml.map((n) => n.empresa_id)).size > 1 || !f.empresa;
  const erroReg = await registrarDownload(db, { email, tipo: 'zip', empresaId: f.empresa, filtros: registroFiltros, quantidade: comXml.length });
  if (erroReg) log.warn('download sem registro', { erro: erroReg });
  log.info('ZIP da busca de XML', { quantidade: comXml.length, soResumo: lista.length - comXml.length, empresa: f.empresa, por: email });
  const nome = chaves ? `xmls_selecionados_${comXml.length}.zip` : `${f.empresa ? comXml[0].empresa_cnpj : 'escritorio'}_${f.de}_${f.ate}.zip`;
  res.writeHead(200, { ...CABECALHOS_SEGURANCA, 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${nome}"`, 'Cache-Control': 'no-store' });
  const zip = new Zip(res);
  for (let i = 0; i < comXml.length; i += 8) {
    const bloco = comXml.slice(i, i + 8);
    const conteudos = await Promise.all(bloco.map((d) => lerXmlStorage(d.xml_path!).catch(() => null)));
    for (let j = 0; j < bloco.length; j++) if (conteudos[j]) await zip.adicionar(caminhoNoZip(bloco[j], porEmpresa), conteudos[j]!);
  }
  if (lista.length > comXml.length) {
    const falta = lista.filter((n) => !n.xml_path).map((n) => `${n.chave};${n.numero ?? ''};${n.empresa_cnpj}`).join('\r\n');
    await zip.adicionar('SEM-XML-COMPLETO.txt', Buffer.from(`Notas só com resumo (o XML completo ainda não chegou):\r\nchave;numero;empresa\r\n${falta}\r\n`, 'utf8'));
  }
  await zip.finalizar();
  res.end();
}

/** Planilha da busca de XML. */
function abaBuscaXml(lista: NotaBusca[], f: FiltroBusca, comEmpresa: boolean): Aba {
  const doc = (d: string | null) => (d && d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d && d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d ?? '');
  const tipo: Record<string, string> = { '55': 'NF-e', '57': 'CT-e', '65': 'NFC-e' };
  const colunas: Coluna[] = [
    ...(comEmpresa ? [{ titulo: 'Empresa', tipo: 'texto' as const, largura: 34 }, { titulo: 'CNPJ da empresa', tipo: 'texto' as const, largura: 20 }] : []),
    { titulo: 'Emissão', tipo: 'data', largura: 12 }, { titulo: 'Tipo', tipo: 'texto', largura: 8 }, { titulo: 'Direção', tipo: 'texto', largura: 9 },
    { titulo: 'Série', tipo: 'texto', largura: 7 }, { titulo: 'Número', tipo: 'texto', largura: 11 }, { titulo: 'Chave', tipo: 'texto', largura: 48 },
    { titulo: 'CNPJ emitente', tipo: 'texto', largura: 20 }, { titulo: 'Emitente', tipo: 'texto', largura: 34 }, { titulo: 'UF', tipo: 'texto', largura: 5 },
    { titulo: 'Destinatário (CNPJ/CPF)', tipo: 'texto', largura: 20 }, { titulo: 'Destinatário', tipo: 'texto', largura: 30 }, { titulo: 'CFOP', tipo: 'texto', largura: 7 },
    { titulo: 'Valor', tipo: 'moeda', largura: 14, total: true }, { titulo: 'ICMS', tipo: 'moeda', largura: 12, total: true }, { titulo: 'ICMS-ST', tipo: 'moeda', largura: 12, total: true },
    { titulo: 'Situação', tipo: 'texto', largura: 11 }, { titulo: 'XML', tipo: 'texto', largura: 10 },
  ];
  const linhas = lista.map((n) => [
    ...(comEmpresa ? [n.empresa_nome, doc(n.empresa_cnpj)] : []),
    new Date(n.emitida_em).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' }), tipo[n.modelo] ?? n.modelo, n.direcao === 'entrada' ? 'Entrada' : 'Saída',
    n.serie ?? '', n.numero ?? '', n.chave, doc(n.emit_cnpj), n.emit_nome ?? '', UF_DA_CHAVE[n.chave.slice(0, 2)] ?? '', doc(n.dest_doc), n.dest_nome ?? '', n.cfop ?? '',
    n.valor != null ? Number(n.valor) : null, n.v_icms != null ? Number(n.v_icms) : null, n.v_st != null ? Number(n.v_st) : null,
    n.situacao === 'cancelada' ? 'Cancelada' : 'Autorizada', n.tem_xml ? 'Completo' : 'Só resumo',
  ]);
  const per = `${f.de.split('-').reverse().join('/')} a ${f.ate.split('-').reverse().join('/')}`;
  return { nome: 'Notas', cabecalho: [`Notas fiscais · ${per}`, comEmpresa ? 'Todas as empresas do escritório' : `${lista[0]?.empresa_nome ?? ''} (${doc(lista[0]?.empresa_cnpj ?? '')})`], colunas, linhas };
}

/**
 * Versão dos arquivos do painel (hash do conteúdo). Entra no endereço dos CSS/JS (?v=) e no nome do cache do
 * service worker: uma publicação nova nunca mistura HTML novo com JS/CSS antigo, nem fica presa no app instalado.
 */
const VERSAO_ESTATICA = (() => {
  const h = crypto.createHash('sha256');
  for (const [nome] of Object.values(ARQUIVOS)) {
    try { h.update(fs.readFileSync(path.join(PASTA_PUBLICA, nome))); } catch { /* arquivo ausente em teste */ }
  }
  return h.digest('hex').slice(0, 12);
})();
const COM_VERSAO = new Set(['index.html', 'sw.js']);

function arquivoEstatico(res: http.ServerResponse, url: URL): boolean {
  const alvo = ARQUIVOS[url.pathname];
  if (!alvo) return false;
  const [nome, tipo] = alvo;
  const versionado = url.searchParams.get('v') === VERSAO_ESTATICA;
  res.writeHead(200, {
    ...CABECALHOS_SEGURANCA,
    'Content-Type': tipo,
    // index e service worker sempre revalidados; CSS/JS com ?v=<versão> podem ficar em cache (o endereço muda a cada publicação)
    'Cache-Control': COM_VERSAO.has(nome) ? 'no-cache' : versionado ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
  });
  const conteudo = fs.readFileSync(path.join(PASTA_PUBLICA, nome));
  res.end(COM_VERSAO.has(nome) ? conteudo.toString('utf8').replaceAll('__VERSAO__', VERSAO_ESTATICA) : conteudo);
  return true;
}

/* ---------- tempo real (Supabase Realtime -> telas abertas) ---------- */

const ouvintes = new Set<http.ServerResponse>();
let avisoPendente: NodeJS.Timeout | null = null;

function avisarTelas(tabela: string) {
  if (!ouvintes.size || avisoPendente) return;
  // Junta várias mudanças seguidas (ex.: um lote de notas) num único aviso
  avisoPendente = setTimeout(() => {
    avisoPendente = null;
    const msg = `event: mudou\ndata: ${JSON.stringify({ tabela, em: new Date().toISOString() })}\n\n`;
    for (const r of ouvintes) r.write(msg);
  }, 1500);
}

function abrirEventos(req: http.IncomingMessage, res: http.ServerResponse) {
  res.writeHead(200, {
    ...CABECALHOS_SEGURANCA,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.write(`event: pronto\ndata: {}\n\n`);
  ouvintes.add(res);
  // Mantém a conexão viva através do proxy (Traefik/Cloudflare)
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    ouvintes.delete(res);
  });
}

function assinarRealtime() {
  const canal = db.channel('painel-mudancas');
  for (const tabela of ['sync_state', 'sync_requests', 'empresas', 'certificados', 'apontamentos']) {
    canal.on('postgres_changes', { event: '*', schema: 'public', table: tabela }, () => avisarTelas(tabela));
  }
  canal.subscribe((estado, erro) => {
    void registrarStatus(db, 'painel_tempo_real', { estado, erro: erro?.message ?? null });
    if (estado === 'SUBSCRIBED') log.info('tempo real ativo', { tabelas: 5 });
    else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') log.warn('tempo real com problema; o cliente reconecta sozinho', { estado, erro: erro?.message });
  });
}
assinarRealtime();

/** Na primeira vez (tabela vazia), carrega a tabela de ST do ES que vem no repositório (Portaria SEFAZ-ES 16-R/2019). */
async function semearTabelaST() {
  const arquivo = path.resolve(__dirname, '../../dados/tabela_st_es.csv');
  if (!fs.existsSync(arquivo)) return;
  const { count, error } = await db.from('st_es_regras').select('id', { count: 'exact', head: true });
  if (error || (count ?? 0) > 0) return;
  const { regras, erros } = lerTabelaCsv(fs.readFileSync(arquivo, 'utf8'));
  if (erros.length || !regras.length) return log.error('tabela de ST inicial inválida', { erros: erros.slice(0, 5) });
  const r = await db.rpc('substituir_regras_st', { p_regras: regras, p_por: 'carga inicial (Portaria 16-R/2019)' });
  if (r.error) log.error('falha ao carregar tabela de ST inicial', { erro: r.error.message });
  else log.info('tabela de ST do ES carregada', { regras: r.data });
}
void semearTabelaST();
void registrarStatus(db, 'painel', {
  iniciado_em: new Date().toISOString(),
  armazenamento: arm.usaR2 ? 'r2' : 'supabase',
});

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (url.pathname === '/saude') return responder(res, 200, { ok: true });
    if (url.pathname.startsWith('/api/')) return await rotaApi(req, res, url);
    if (await rotaMcp(req, res, url, opcoesMcp)) return;
    if (req.method === 'GET' && arquivoEstatico(res, url)) return;
    responder(res, 404, { erro: 'Página não encontrada.' });
  } catch (e) {
    if (res.headersSent) {
      // Falha no meio de um download: não há como mandar JSON, então encerra a conexão.
      log.error('download interrompido', { rota: url.pathname, erro: (e as Error).message });
      return void res.destroy();
    }
    if (e instanceof ErroIntegra) return responder(res, e.status, { erro: e.message, ...(e.codigo ? { codigo: e.codigo } : {}) });
    if (e instanceof ErroAcessorias) return responder(res, e.status, { erro: e.message });
    if (e instanceof ErroOAuth || e instanceof ErroColetor || e instanceof ErroIntegracao || e instanceof ErroContabil) return responder(res, e.status, { erro: e.message });
    if (e instanceof ErroPlanilha) return responder(res, 422, { erro: e.message });
    if (e instanceof ErroHttp || e instanceof ErroUsuario || e instanceof ErroSped || e instanceof ErroApontamento || e instanceof ErroApuracao || e instanceof ErroGerarSped || e instanceof ErroDocumento || e instanceof ErroBusca || e instanceof ErroCadastro) return responder(res, e.status, { erro: e.message });
    log.error('erro no painel', { rota: url.pathname, erro: (e as Error).message });
    responder(res, 500, { erro: 'Erro inesperado no servidor. Tente de novo.' });
  }
});

servidor.listen(cfg.porta, () => log.info('painel no ar', { porta: cfg.porta, emailsAutorizados: cfg.emails.size }));

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sinal, () => servidor.close(() => process.exit(0)));
}
