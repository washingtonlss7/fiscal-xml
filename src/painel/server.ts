import 'dotenv/config';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import { buscarTodos, criarDb, ok } from '../db';
import { ErroValidacao, salvarEmpresaComCertificado } from '../empresas';
import { log } from '../log';
import { Zip } from './zip';
import { registrarStatus } from '../status';
import { abrirEnvio, importarXmls } from '../importacao/importar';
import { escreverXlsx } from './xlsx';
import { abasST, lerRegrasST, relatorioST } from '../fiscal/relatorioST';
import { lerTabelaCsv, tabelaParaCsv } from '../fiscal/st';
import { Armazenamento, configArmazenamento } from '../armazenamento';
import { auditarMes } from '../auditoria/motor';
import { REGRAS } from '../auditoria/regras';
import { dentroDaJanela, lerJanela } from '../util';
import { ErroSped, ServicoSped } from './sped';
import { authDoSupabase, ErroUsuario, GestaoUsuarios, PERFIS_INFO, PERMISSOES, permissaoDaRota } from './usuarios';

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
/** Mesmo horário de consultas do coletor (JANELA_SINCRONIZACAO, padrão 23h às 6h). */
const JANELA = lerJanela(process.env.JANELA_SINCRONIZACAO ?? '23-6');
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
const autorizado = async (email: string) => (await usuarios.perfilDe(email)) !== null;

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

  // Daqui para baixo, só usuários autorizados.
  const email = await usuarioAutenticado(req);
  const perfil = (await usuarios.perfilDe(email)) ?? 'consulta';
  const exigida = permissaoDaRota(metodo, rota);
  if (exigida && !PERMISSOES[perfil].includes(exigida)) {
    throw new ErroHttp(403, 'Seu perfil não permite esta ação. Fale com um administrador.');
  }

  if (metodo === 'GET' && rota === '/api/eu') {
    return responder(res, 200, { email, nome: await usuarios.nomeDe(email), perfil, permissoes: PERMISSOES[perfil] });
  }

  // Gestão de usuários (as regras de permissão ficam em GestaoUsuarios)
  if (rota === '/api/usuarios') {
    if (metodo === 'GET') {
      return responder(res, 200, { usuarios: await usuarios.listar(), historico: await usuarios.historico(30), perfis: PERFIS_INFO });
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

  // Avisos em tempo real para a tela (stream de texto). O navegador recarrega a lista quando chega "mudou".
  if (metodo === 'GET' && rota === '/api/eventos') return abrirEventos(req, res);

  // Visão Geral: tudo agregado numa chamada só ao banco (painel_visao_geral)
  if (metodo === 'GET' && rota === '/api/visao-geral') {
    const mes = url.searchParams.get('mes') ?? '';
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ErroHttp(400, 'Competência inválida. Use AAAA-MM.');
    const { data, error } = await db.rpc('painel_visao_geral', { p_competencia: `${mes}-01` });
    if (error) throw new Error(`visão geral: ${error.message}`);
    return responder(res, 200, data);
  }

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
        escritorio: typeof c.escritorio === 'boolean' ? c.escritorio : undefined,
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
      if (!dentroDaJanela(JANELA)) {
        return responder(res, 200, {
          mensagem: `Pedido registrado. As consultas à SEFAZ só acontecem das ${JANELA!.texto}; a empresa será sincronizada quando o horário abrir.`,
        });
      }
      return responder(res, 200, { mensagem: 'Sincronização pedida. O coletor começa em até 1 minuto.' });
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
      for (const a of abertos) await resolverApontamento(a, String(c.acao), c.observacao ? String(c.observacao) : null, null, email);
      log.info('auditoria em lote', { empresa: id, regra: c.regra, acao: c.acao, quantidade: abertos.length, por: email });
      return responder(res, 200, { quantidade: abertos.length });
    }
  }

  const apont = rota.match(/^\/api\/apontamentos\/(\d+)$/);
  if (metodo === 'POST' && apont) {
    const c = await lerCorpo(req);
    const a = ok(await db.from('apontamentos').select('*').eq('id', Number(apont[1])).maybeSingle(), 'ler apontamento') as any;
    if (!a) throw new ErroHttp(404, 'Apontamento não encontrado.');
    await resolverApontamento(a, String(c.acao), c.observacao ? String(c.observacao) : null, c.valor ? String(c.valor) : null, email);
    return responder(res, 200, { ok: true });
  }

  // Importação de XML/ZIP (NF-e e NFC-e de saída, ou qualquer nota que falte)
  const imp = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/importar$/);
  if (metodo === 'POST' && imp) {
    const empresa = ok(await db.from('empresas').select('id,cnpj,c_uf').eq('id', imp[1]).maybeSingle(), 'ler empresa') as
      { id: string; cnpj: string; c_uf: number } | null;
    if (!empresa) throw new ErroHttp(404, 'Empresa não encontrada.');
    const nome = (url.searchParams.get('nome') || 'arquivo.xml').slice(0, 200);
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
    log.info('importação de XML', { empresa: empresa.cnpj, arquivo: nome, por: email, importadas: r.importadas, completou: r.completouResumo, repetidas: r.jaExistiam, rejeitadas: r.rejeitadas });
    // Devolve só as rejeitadas em detalhe (o resto vai resumido)
    return responder(res, 200, { ...r, resultados: r.resultados.filter((x) => x.situacao === 'rejeitada').slice(0, 200) });
  }

  // SPED Fiscal (EFD ICMS/IPI): lê, valida, compara com os XMLs e guarda o arquivo e o resultado.
  const sped = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/sped$/);
  if (sped && metodo === 'GET') {
    const f = filtroNotas(url);
    const a = await servicoSped.vigente(sped[1], `${f.mes}-01`);
    return responder(res, 200, { vigente: a ? servicoSped.resposta(a) : null, arquivos: await servicoSped.historico(sped[1], `${f.mes}-01`) });
  }
  if ((metodo === 'POST' && sped) || (metodo === 'POST' && rota === '/api/sped')) {
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
  const spedArq = rota.match(/^\/api\/sped\/(\d+)\/(arquivo|refazer)$/);
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
    if (metodo === 'POST' && spedArq[2] === 'refazer') {
      const novo = await servicoSped.recomparar(a);
      log.info('comparação do SPED refeita', { id: a.id, cnpj: a.cnpj, por: email, divergencias: novo.divergencias });
      return responder(res, 200, servicoSped.resposta(novo));
    }
  }

  // Pré-cadastro pelo SPED: o escritório confere e aprova
  if (metodo === 'GET' && rota === '/api/cadastros') return responder(res, 200, await servicoSped.listarSugestoes());
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
  const e360 = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/360$/);
  if (metodo === 'GET' && e360) {
    const f = filtroNotas(url);
    const { data, error } = await db.rpc('painel_empresa_360', { p_empresa: e360[1], p_competencia: `${f.mes}-01` });
    if (error) throw new Error(`empresa 360: ${error.message}`);
    if (!data) throw new ErroHttp(404, 'Empresa não encontrada.');
    return responder(res, 200, data);
  }

  const notas = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})\/(notas|xml|zip)$/);
  if (metodo === 'GET' && notas) {
    const [, id, tipo] = notas;
    if (tipo === 'xml') return baixarXml(res, id, url.searchParams.get('chave') ?? '');
    const filtro = filtroNotas(url);
    if (tipo === 'zip') return baixarZip(res, id, filtro);
    return listarNotas(res, id, filtro);
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

const CFOP_ENTRADA_VALIDO = /^[123]\d{3}$/;
const CST_PIS_VALIDO = /^\d{2}$/;

/** Marca um apontamento como ajustado/ignorado/aberto e, quando é o caso, grava o ajuste no item. */
async function resolverApontamento(a: any, acao: string, observacao: string | null, valor: string | null, email: string) {
  const agora = new Date().toISOString();
  if (acao === 'reabrir') {
    ok(await db.from('apontamentos').update({ status: 'aberto', resolvido_por: null, resolvido_em: null, atualizado_em: agora }).eq('id', a.id), 'reabrir');
    return;
  }
  if (acao !== 'resolver' && acao !== 'ignorar') throw new ErroHttp(400, 'Ação inválida.');

  if (acao === 'resolver' && a.chave && a.n_item) {
    const campo: string | undefined = a.regra === 'CFOP_ENTRADA_INDEFINIDO' ? 'cfop_escrit' : a.sugestao?.campo;
    const v = valor ?? a.sugestao?.valor ?? null;
    if (campo && v) {
      let alteracao: Record<string, unknown>;
      if (campo === 'cfop_escrit') {
        if (!CFOP_ENTRADA_VALIDO.test(v)) throw new ErroHttp(422, 'Informe um CFOP de entrada válido (1xxx, 2xxx ou 3xxx).');
        alteracao = { cfop_escrit: v };
      } else if (campo === 'cst_pis_cofins_escrit') {
        if (!CST_PIS_VALIDO.test(v)) throw new ErroHttp(422, 'CST de PIS/COFINS inválido.');
        alteracao = { cst_pis_escrit: v, cst_cofins_escrit: v };
      } else {
        throw new ErroHttp(400, 'Ajuste não suportado para este apontamento.');
      }
      ok(
        await db.from('documento_itens').update({ ...alteracao, ajustado_por: email, ajustado_em: agora })
          .eq('empresa_id', a.empresa_id).eq('chave', a.chave).eq('n_item', a.n_item),
        'ajustar item',
      );
    } else if (a.regra === 'CFOP_ENTRADA_INDEFINIDO') {
      throw new ErroHttp(422, 'Informe o CFOP de entrada.');
    }
  }
  ok(
    await db.from('apontamentos').update({
      status: acao === 'resolver' ? 'ajustado' : 'ignorado',
      observacao: observacao ?? a.observacao ?? null,
      resolvido_por: email,
      resolvido_em: agora,
      atualizado_em: agora,
    }).eq('id', a.id),
    'resolver apontamento',
  );
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

async function baixarXml(res: http.ServerResponse, id: string, chave: string) {
  if (!/^\d{44}$/.test(chave)) throw new ErroHttp(400, 'Chave inválida.');
  const doc = ok(
    await db.from('documentos').select('xml_path,xml_resumo_path').eq('empresa_id', id).eq('chave', chave).maybeSingle(),
    'buscar nota',
  ) as { xml_path: string | null; xml_resumo_path: string | null } | null;
  const caminho = doc?.xml_path ?? doc?.xml_resumo_path;
  if (!caminho) throw new ErroHttp(404, 'XML não encontrado.');
  const xml = await lerXmlStorage(caminho);
  res.writeHead(200, {
    ...CABECALHOS_SEGURANCA,
    'Content-Type': 'application/xml; charset=utf-8',
    'Content-Disposition': `attachment; filename="${chave}${doc?.xml_path ? '' : '-resumo'}.xml"`,
    'Cache-Control': 'no-store',
  });
  res.end(xml);
}

async function baixarZip(res: http.ServerResponse, id: string, f: FiltroNotas) {
  const empresa = ok(await db.from('empresas').select('cnpj').eq('id', id).maybeSingle(), 'buscar empresa') as { cnpj: string } | null;
  if (!empresa) throw new ErroHttp(404, 'Empresa não encontrada.');
  const docs = await buscarTodos<any>(
    (de, ate) => consultaNotas(id, f, 'chave,modelo,direcao,situacao,xml_path').not('xml_path', 'is', null).order('emitida_em').range(de, ate),
    'listar XMLs',
  );
  if (!docs.length) throw new ErroHttp(404, 'Nenhum XML completo nesse período.');
  if (docs.length > 20000) throw new ErroHttp(413, 'Período com XMLs demais. Filtre por modelo ou direção.');

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

function arquivoEstatico(res: http.ServerResponse, url: URL): boolean {
  const alvo = ARQUIVOS[url.pathname];
  if (!alvo) return false;
  const [nome, tipo] = alvo;
  res.writeHead(200, {
    ...CABECALHOS_SEGURANCA,
    'Content-Type': tipo,
    // index e service worker sempre revalidados, para uma publicação nova chegar logo em quem instalou o app
    'Cache-Control': nome === 'index.html' || nome === 'sw.js' ? 'no-cache' : 'public, max-age=300',
  });
  res.end(fs.readFileSync(path.join(PASTA_PUBLICA, nome)));
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
    if (req.method === 'GET' && arquivoEstatico(res, url)) return;
    responder(res, 404, { erro: 'Página não encontrada.' });
  } catch (e) {
    if (res.headersSent) {
      // Falha no meio de um download: não há como mandar JSON, então encerra a conexão.
      log.error('download interrompido', { rota: url.pathname, erro: (e as Error).message });
      return void res.destroy();
    }
    if (e instanceof ErroHttp || e instanceof ErroUsuario || e instanceof ErroSped) return responder(res, e.status, { erro: e.message });
    log.error('erro no painel', { rota: url.pathname, erro: (e as Error).message });
    responder(res, 500, { erro: 'Erro inesperado no servidor. Tente de novo.' });
  }
});

servidor.listen(cfg.porta, () => log.info('painel no ar', { porta: cfg.porta, emailsAutorizados: cfg.emails.size }));

for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sinal, () => servidor.close(() => process.exit(0)));
}
