/**
 * API de integração com outros sistemas (ex.: OnnePharma). O sistema recebe um token próprio, limitado aos CNPJs
 * liberados, e só lê: lista as notas novas ou alteradas desde um cursor, baixa o XML (um ou vários em ZIP) e, se tiver
 * webhook, recebe um aviso assinado (HMAC-SHA256) a cada nota nova ou alterada. NF-e e NFC-e; CT-e fica de fora.
 *
 * O cursor é o id de integracao_mudancas, escrita no ponto em que toda nota é gravada (src/integracao/mudancas.ts).
 */
import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';
import { Writable } from 'stream';
import { Armazenamento } from '../armazenamento';
import { cifrar, decifrar } from '../cripto';
import { Db, ok } from '../db';
import { log } from '../log';
import { Zip } from '../painel/zip';

export class ErroIntegracao extends Error {
  constructor(public readonly status: number, mensagem: string) { super(mensagem); }
}

export const VERSAO_API = 1;
export const LIMITE_LISTA = 500;
export const LIMITE_ZIP = 500;
const MODELOS = ['55', '65'];
const DIRECOES = ['entrada', 'saida'];
/** Espera entre tentativas do webhook (a 11ª falha desiste). */
export const ESPERAS_WEBHOOK_SEG = [60, 300, 900, 1800, 3600, 7200, 14400, 28800, 43200, 86400];

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export function novoToken() {
  const token = `apk_${crypto.randomBytes(32).toString('base64url')}`;
  return { token, hash: hash(token), prefixo: token.slice(0, 12) };
}
export const novoSegredo = () => `whsec_${crypto.randomBytes(32).toString('base64url')}`;

/** Assinatura do webhook: t=<unix>,v1=<hex HMAC-SHA256(segredo, "<t>.<corpo>")>. O OnnePharma confere igual. */
export function assinar(segredo: string, corpo: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${crypto.createHmac('sha256', segredo).update(`${t}.${corpo}`).digest('hex')}`;
}
export function conferirAssinatura(segredo: string, corpo: string, cabecalho: string, toleranciaSeg = 300, agora = Math.floor(Date.now() / 1000)): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(cabecalho || '');
  if (!m || Math.abs(agora - Number(m[1])) > toleranciaSeg) return false;
  const esperado = crypto.createHmac('sha256', segredo).update(`${m[1]}.${corpo}`).digest();
  const recebido = Buffer.from(m[2], 'hex');
  return recebido.length === esperado.length && crypto.timingSafeEqual(recebido, esperado);
}

/** Cursor opaco para o sistema integrado (hoje é o id da mudança). */
export const codificarCursor = (id: number) => Buffer.from(`m${id}`).toString('base64url');
export function decodificarCursor(c: string | null | undefined): number {
  if (!c || c === '0') return 0;
  const t = Buffer.from(c, 'base64url').toString();
  if (!/^m\d{1,15}$/.test(t)) throw new ErroIntegracao(400, 'Cursor inválido. Use o "proximoCursor" devolvido pela chamada anterior (ou nenhum, para começar do início).');
  return Number(t.slice(1));
}

/** Endereço do webhook: só https e nunca rede interna (o Appura não pode ser usado para chamar a própria rede). */
export async function validarUrlWebhook(u: string, resolver: (h: string) => Promise<string[]> = async (h) => (await dns.lookup(h, { all: true })).map((x) => x.address)): Promise<string> {
  let url: URL;
  try { url = new URL(String(u).trim()); } catch { throw new ErroIntegracao(400, 'Endereço do webhook inválido.'); }
  if (url.protocol !== 'https:') throw new ErroIntegracao(400, 'O webhook precisa usar https://.');
  if (url.username || url.password) throw new ErroIntegracao(400, 'Não coloque usuário e senha no endereço do webhook.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : await resolver(host).catch(() => { throw new ErroIntegracao(400, `Não encontrei o endereço ${host}.`); });
  for (const ip of ips) if (ipInterno(ip)) throw new ErroIntegracao(400, 'O webhook não pode apontar para endereço interno ou local.');
  return url.toString();
}
export function ipInterno(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:127.') || x.startsWith('::ffff:10.') || x.startsWith('::ffff:192.168.');
}

export interface ContextoIntegracao { id: string; nome: string; empresas: { id: string; cnpj: string; razao_social: string }[]; modelos: string[]; direcoes: string[] }

/** Nota no formato da API (o mesmo no webhook e na lista). */
export function notaApi(d: any, empresa: { cnpj: string; razao_social: string }) {
  return {
    chave: d.chave, cnpj: empresa.cnpj, empresa: empresa.razao_social,
    modelo: d.modelo === '65' ? 'nfce' : 'nfe', direcao: d.direcao,
    numero: d.numero, serie: d.serie, emitidaEm: d.emitida_em, valor: d.valor == null ? null : Number(d.valor),
    situacao: d.situacao, completo: !!d.completo, protocolo: d.protocolo ?? null,
    emitente: { cnpj: d.emit_cnpj ?? null, nome: d.emit_nome ?? null },
    destinatario: { documento: d.dest_doc ?? null, nome: d.dest_nome ?? null },
    capturadoEm: d.capturado_em ?? null,
  };
}

const CAMPOS_DOC = 'id,empresa_id,chave,modelo,direcao,numero,serie,emitida_em,valor,situacao,completo,protocolo,emit_cnpj,emit_nome,dest_doc,dest_nome,capturado_em,xml_path,xml_resumo_path';

export class ServicoIntegracao {
  private cache = new Map<string, { ctx: ContextoIntegracao; ate: number }>();
  private ritmo = new Map<string, { n: number; desde: number }>();
  private usoGravado = new Map<string, number>();

  constructor(private readonly db: Db, private readonly arm: Armazenamento, private readonly masterKey: string,
    private readonly http: (url: string, corpo: string, cab: Record<string, string>) => Promise<{ status: number; corpo: string }> = enviarHttp) {}

  /* ---------- painel ---------- */

  async listar() {
    const ints = ok(await this.db.from('integracoes_api').select('id,nome,token_prefixo,modelos,direcoes,webhook_url,ativo,criado_em,criado_por,revogado_em,ultimo_uso_em,webhook_cursor').order('criado_em').limit(200), 'integrações') as any[];
    if (!ints.length) return { integracoes: [] };
    const ids = ints.map((i) => i.id);
    const vinc = ok(await this.db.from('integracao_api_empresas').select('integracao_id,empresa_id').in('integracao_id', ids), 'empresas') as any[];
    const emps = vinc.length ? ok(await this.db.from('empresas').select('id,cnpj,razao_social').in('id', [...new Set(vinc.map((v) => v.empresa_id))]), 'empresas') as any[] : [];
    const porId = new Map(emps.map((e) => [e.id, e]));
    const desde = new Date(Date.now() - 86400000).toISOString();
    const fila = ok(await this.db.from('integracao_webhook_fila').select('integracao_id,status,entregue_em,criado_em,ultimo_erro,ultimo_http,tentativas').in('integracao_id', ids).gte('criado_em', new Date(Date.now() - 7 * 86400000).toISOString()).limit(20000), 'fila') as any[];
    const chamadas = ok(await this.db.from('integracao_api_chamadas').select('integracao_id,rota,status,itens,em').in('integracao_id', ids).gte('em', desde).order('em', { ascending: false }).limit(2000), 'chamadas') as any[];
    return {
      integracoes: ints.map((i) => {
        const f = fila.filter((x) => x.integracao_id === i.id);
        const falhas = f.filter((x) => x.status === 'falhou');
        const ultimaFalha = f.filter((x) => x.ultimo_erro).sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1))[0];
        const ch = chamadas.filter((c) => c.integracao_id === i.id);
        return {
          id: i.id, nome: i.nome, prefixo: i.token_prefixo, modelos: i.modelos, direcoes: i.direcoes, webhookUrl: i.webhook_url, ativo: i.ativo && !i.revogado_em,
          revogadoEm: i.revogado_em, criadoEm: i.criado_em, criadoPor: i.criado_por, ultimoUsoEm: i.ultimo_uso_em,
          empresas: vinc.filter((v) => v.integracao_id === i.id).map((v) => porId.get(v.empresa_id)).filter(Boolean).map((e: any) => ({ id: e.id, cnpj: e.cnpj, razaoSocial: e.razao_social })),
          webhook: {
            pendentes: f.filter((x) => x.status === 'pendente').length, entregues7d: f.filter((x) => x.status === 'entregue').length, falhas7d: falhas.length,
            ultimaEntregaEm: f.filter((x) => x.entregue_em).map((x) => x.entregue_em).sort().pop() ?? null,
            ultimoErro: ultimaFalha ? `${ultimaFalha.ultimo_http ? `HTTP ${ultimaFalha.ultimo_http}: ` : ''}${ultimaFalha.ultimo_erro}` : null,
          },
          api24h: { chamadas: ch.length, erros: ch.filter((c) => c.status >= 400).length, notas: ch.reduce((t, c) => t + (c.itens ?? 0), 0) },
        };
      }),
    };
  }

  private async validarEmpresas(lista: unknown): Promise<string[]> {
    const ids = [...new Set((Array.isArray(lista) ? lista : []).map(String))];
    if (!ids.length) throw new ErroIntegracao(400, 'Escolha pelo menos um CNPJ.');
    const achadas = ok(await this.db.from('empresas').select('id').in('id', ids), 'empresas') as { id: string }[];
    if (achadas.length !== ids.length) throw new ErroIntegracao(400, 'Alguma das empresas escolhidas não existe mais.');
    return ids;
  }

  private lista(v: unknown, permitidos: string[], nome: string): string[] {
    const l = [...new Set((Array.isArray(v) ? v : []).map(String))].filter((x) => permitidos.includes(x));
    if (!l.length) throw new ErroIntegracao(400, `Escolha pelo menos um ${nome}.`);
    return l;
  }

  private async maxMudanca(): Promise<number> {
    const r = ok(await this.db.from('integracao_mudancas').select('id').order('id', { ascending: false }).limit(1), 'mudanças') as { id: number }[];
    return Number(r[0]?.id ?? 0);
  }

  async criar(c: any, email: string) {
    const nome = String(c?.nome ?? '').trim();
    if (nome.length < 2) throw new ErroIntegracao(400, 'Dê um nome para a integração (ex.: OnnePharma).');
    const empresas = await this.validarEmpresas(c?.empresas);
    const modelos = this.lista(c?.modelos ?? MODELOS, MODELOS, 'modelo (NF-e ou NFC-e)');
    const direcoes = this.lista(c?.direcoes ?? DIRECOES, DIRECOES, 'tipo (entrada ou saída)');
    const webhookUrl = c?.webhookUrl ? await validarUrlWebhook(c.webhookUrl) : null;
    const t = novoToken();
    const segredo = webhookUrl ? novoSegredo() : null;
    // O webhook avisa só o que acontecer daqui para frente; o histórico é lido pela API (cursor vazio = desde o início)
    const cursor = c?.webhookHistorico ? 0 : await this.maxMudanca();
    const r = ok(await this.db.from('integracoes_api').insert({
      nome: nome.slice(0, 80), ativo: true, token_hash: t.hash, token_prefixo: t.prefixo, modelos, direcoes, webhook_url: webhookUrl,
      webhook_segredo_cifrado: segredo ? cifrar(Buffer.from(segredo), this.masterKey) : null, webhook_cursor: cursor, criado_por: email,
    }).select('id').single(), 'criar integração') as { id: string };
    ok(await this.db.from('integracao_api_empresas').insert(empresas.map((empresa_id) => ({ integracao_id: r.id, empresa_id }))), 'empresas da integração');
    log.info('integração criada', { integracao: r.id, nome, empresas: empresas.length, webhook: !!webhookUrl, por: email });
    return { id: r.id, token: t.token, webhookSegredo: segredo };
  }

  async editar(id: string, c: any, email: string) {
    const atual = ok(await this.db.from('integracoes_api').select('id,webhook_url,webhook_segredo_cifrado,revogado_em').eq('id', id).maybeSingle(), 'integração') as any;
    if (!atual) throw new ErroIntegracao(404, 'Integração não encontrada.');
    if (atual.revogado_em) throw new ErroIntegracao(409, 'Esta integração foi revogada. Crie outra.');
    const mud: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
    let segredo: string | null = null;
    if (c?.nome !== undefined) { const n = String(c.nome).trim(); if (n.length < 2) throw new ErroIntegracao(400, 'Nome curto demais.'); mud.nome = n.slice(0, 80); }
    if (c?.modelos !== undefined) mud.modelos = this.lista(c.modelos, MODELOS, 'modelo');
    if (c?.direcoes !== undefined) mud.direcoes = this.lista(c.direcoes, DIRECOES, 'tipo');
    if (c?.ativo !== undefined) mud.ativo = !!c.ativo;
    if (c?.webhookUrl !== undefined) {
      mud.webhook_url = c.webhookUrl ? await validarUrlWebhook(c.webhookUrl) : null;
      // Primeiro webhook desta integração: gera o segredo e começa a avisar só daqui para frente
      if (mud.webhook_url && !atual.webhook_segredo_cifrado) {
        segredo = novoSegredo();
        mud.webhook_segredo_cifrado = cifrar(Buffer.from(segredo), this.masterKey);
        mud.webhook_cursor = await this.maxMudanca();
      }
    }
    ok(await this.db.from('integracoes_api').update(mud).eq('id', id), 'editar integração');
    if (c?.empresas !== undefined) {
      const ids = await this.validarEmpresas(c.empresas);
      ok(await this.db.from('integracao_api_empresas').delete().eq('integracao_id', id), 'trocar empresas');
      ok(await this.db.from('integracao_api_empresas').insert(ids.map((empresa_id) => ({ integracao_id: id, empresa_id }))), 'trocar empresas');
    }
    this.cache.clear();
    log.info('integração editada', { integracao: id, campos: Object.keys(c ?? {}), por: email });
    return { ok: true, webhookSegredo: segredo };
  }

  async trocarSegredo(id: string, email: string) {
    const segredo = novoSegredo();
    ok(await this.db.from('integracoes_api').update({ webhook_segredo_cifrado: cifrar(Buffer.from(segredo), this.masterKey), atualizado_em: new Date().toISOString() }).eq('id', id).is('revogado_em', null), 'trocar segredo');
    log.info('integração: segredo do webhook trocado', { integracao: id, por: email });
    return { webhookSegredo: segredo };
  }

  async revogar(id: string, email: string) {
    ok(await this.db.from('integracoes_api').update({ revogado_em: new Date().toISOString(), revogado_por: email, ativo: false }).eq('id', id).is('revogado_em', null), 'revogar');
    ok(await this.db.from('integracao_webhook_fila').update({ status: 'falhou', ultimo_erro: 'integração revogada' }).eq('integracao_id', id).eq('status', 'pendente'), 'cancelar fila');
    this.cache.clear();
    log.info('integração revogada', { integracao: id, por: email });
    return { ok: true };
  }

  async reenviarFalhas(id: string) {
    const r = ok(await this.db.from('integracao_webhook_fila').update({ status: 'pendente', tentativas: 0, proxima_em: new Date().toISOString() }).eq('integracao_id', id).eq('status', 'falhou').select('id'), 'reenviar') as any[];
    return { reenviadas: r.length };
  }

  /** Envia agora um evento de teste ao webhook e devolve o que o sistema respondeu. */
  async testarWebhook(id: string) {
    const i = ok(await this.db.from('integracoes_api').select('id,nome,webhook_url,webhook_segredo_cifrado').eq('id', id).maybeSingle(), 'integração') as any;
    if (!i?.webhook_url || !i.webhook_segredo_cifrado) throw new ErroIntegracao(400, 'Esta integração não tem webhook.');
    const corpo = JSON.stringify({ id: `teste-${Date.now()}`, evento: 'teste', versao: VERSAO_API, criadoEm: new Date().toISOString(), mensagem: 'Teste do webhook do Appura.' });
    const segredo = decifrar(i.webhook_segredo_cifrado, this.masterKey).toString();
    try {
      const r = await this.http(i.webhook_url, corpo, this.cabecalhos(segredo, corpo, 'teste', 'teste'));
      return { ok: r.status >= 200 && r.status < 300, status: r.status, resposta: r.corpo.slice(0, 300) };
    } catch (e) {
      return { ok: false, status: null, resposta: (e as Error).message };
    }
  }

  private cabecalhos(segredo: string, corpo: string, evento: string, entrega: string) {
    return { 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': `Appura-Webhook/${VERSAO_API}`, 'X-Appura-Evento': evento, 'X-Appura-Entrega': entrega, 'X-Appura-Assinatura': assinar(segredo, corpo) };
  }

  /* ---------- API ---------- */

  async autenticar(cabecalho: string | undefined): Promise<ContextoIntegracao> {
    const token = String(cabecalho ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!/^apk_[A-Za-z0-9_-]{43}$/.test(token)) throw new ErroIntegracao(401, 'Token inválido.');
    const h = hash(token);
    const c = this.cache.get(h);
    if (c && c.ate > Date.now()) return c.ctx;
    const i = ok(await this.db.from('integracoes_api').select('id,nome,modelos,direcoes,ativo,revogado_em').eq('token_hash', h).maybeSingle(), 'token') as any;
    if (!i) throw new ErroIntegracao(401, 'Token inválido.');
    if (i.revogado_em) throw new ErroIntegracao(401, 'Este token foi revogado no Appura.');
    if (i.ativo === false) throw new ErroIntegracao(403, 'Esta integração está pausada no Appura.');
    const vinc = ok(await this.db.from('integracao_api_empresas').select('empresa_id').eq('integracao_id', i.id), 'empresas') as any[];
    const empresas = vinc.length ? ok(await this.db.from('empresas').select('id,cnpj,razao_social').in('id', vinc.map((v) => v.empresa_id)), 'empresas') as any[] : [];
    const ctx = { id: i.id, nome: i.nome, empresas, modelos: i.modelos, direcoes: i.direcoes };
    this.cache.set(h, { ctx, ate: Date.now() + 60_000 });
    return ctx;
  }

  /** 120 chamadas por minuto por integração. */
  limitar(ctx: ContextoIntegracao) {
    const agora = Date.now(); const r = this.ritmo.get(ctx.id);
    if (!r || agora - r.desde > 60_000) { this.ritmo.set(ctx.id, { n: 1, desde: agora }); return; }
    if (++r.n > 120) throw new ErroIntegracao(429, 'Muitas chamadas seguidas. Aguarde um minuto.');
  }

  async registrar(ctx: ContextoIntegracao, rota: string, status: number, itens: number | null, ip: string) {
    const { error } = await this.db.from('integracao_api_chamadas').insert({ integracao_id: ctx.id, rota: rota.slice(0, 200), status, itens, ip: ip.slice(0, 60) });
    if (error) log.warn('integração: chamada sem registro', { erro: error.message });
    // Último uso: no máximo uma gravação por minuto
    if ((this.usoGravado.get(ctx.id) ?? 0) < Date.now() - 60_000) {
      this.usoGravado.set(ctx.id, Date.now());
      await this.db.from('integracoes_api').update({ ultimo_uso_em: new Date().toISOString() }).eq('id', ctx.id);
    }
  }

  private empresasDoFiltro(ctx: ContextoIntegracao, cnpj: string | null) {
    if (!cnpj) return ctx.empresas;
    const c = cnpj.replace(/\D/g, '');
    const e = ctx.empresas.filter((x) => x.cnpj === c);
    if (!e.length) throw new ErroIntegracao(403, `O CNPJ ${c} não está liberado para esta integração.`);
    return e;
  }

  empresas(ctx: ContextoIntegracao) {
    return { integracao: ctx.nome, versao: VERSAO_API, modelos: ctx.modelos.map((m) => (m === '65' ? 'nfce' : 'nfe')), direcoes: ctx.direcoes,
      empresas: ctx.empresas.map((e) => ({ cnpj: e.cnpj, razaoSocial: e.razao_social })) };
  }

  /**
   * Notas novas ou alteradas depois do cursor, na ordem em que aconteceram. Cada nota aparece uma vez por chamada
   * (a versão mais recente). Guarde o "proximoCursor" e use na próxima chamada; "temMais" diz se já pode chamar de novo.
   */
  async documentos(ctx: ContextoIntegracao, q: { cursor: string | null; cnpj: string | null; modelo: string | null; direcao: string | null; limite: number }) {
    const desde = decodificarCursor(q.cursor);
    const emps = this.empresasDoFiltro(ctx, q.cnpj);
    const porId = new Map(emps.map((e) => [e.id, e]));
    const modelos = q.modelo ? [q.modelo === 'nfce' ? '65' : q.modelo === 'nfe' ? '55' : 'x'].filter((m) => ctx.modelos.includes(m)) : ctx.modelos;
    const direcoes = q.direcao ? [q.direcao].filter((d) => ctx.direcoes.includes(d)) : ctx.direcoes;
    if (!modelos.length || !direcoes.length) throw new ErroIntegracao(400, 'Filtro de modelo ou direção fora do que esta integração pode ler.');
    const limite = Math.min(LIMITE_LISTA, Math.max(1, Math.floor(q.limite) || 100));
    if (!emps.length) return { documentos: [], proximoCursor: codificarCursor(desde), temMais: false };
    const muds = ok(await this.db.from('integracao_mudancas').select('id,empresa_id,chave,tipo').in('empresa_id', [...porId.keys()]).gt('id', desde).order('id').limit(limite), 'mudanças') as any[];
    const ultimo = muds.length ? Number(muds[muds.length - 1].id) : desde;
    const chaves = [...new Set(muds.map((m) => m.chave.trim()))];
    const docs: any[] = [];
    for (let i = 0; i < chaves.length; i += 200) {
      docs.push(...ok(await this.db.from('documentos').select(CAMPOS_DOC).in('empresa_id', [...porId.keys()]).in('chave', chaves.slice(i, i + 200)), 'notas') as any[]);
    }
    const doc = new Map(docs.map((d) => [`${d.empresa_id}|${d.chave}`, d]));
    const vistos = new Set<string>(); const saida: any[] = [];
    for (let i = muds.length - 1; i >= 0; i--) { // mais recente primeiro para deduplicar, depois volta à ordem
      const m = muds[i]; const k = `${m.empresa_id}|${m.chave.trim()}`;
      if (vistos.has(k)) continue; vistos.add(k);
      const d = doc.get(k);
      if (!d || !modelos.includes(d.modelo) || !direcoes.includes(d.direcao)) continue;
      saida.push({ ...notaApi(d, porId.get(m.empresa_id)!), mudanca: m.tipo === 'cancelado' ? 'cancelada' : m.tipo === 'carga_inicial' ? 'existente' : 'gravada' });
    }
    saida.reverse();
    return { documentos: saida, proximoCursor: codificarCursor(ultimo), temMais: muds.length === limite };
  }

  private async acharDoc(ctx: ContextoIntegracao, chave: string, cnpj: string | null) {
    if (!/^\d{44}$/.test(chave)) throw new ErroIntegracao(400, 'Chave inválida.');
    const emps = this.empresasDoFiltro(ctx, cnpj);
    const docs = ok(await this.db.from('documentos').select(CAMPOS_DOC).eq('chave', chave).in('empresa_id', emps.map((e) => e.id)).limit(5), 'nota') as any[];
    const d = docs.find((x) => ctx.modelos.includes(x.modelo) && ctx.direcoes.includes(x.direcao));
    if (!d) throw new ErroIntegracao(404, 'Nota não encontrada para os CNPJs desta integração.');
    return d;
  }

  async xml(ctx: ContextoIntegracao, chave: string, cnpj: string | null): Promise<{ xml: Buffer; completo: boolean }> {
    const d = await this.acharDoc(ctx, chave, cnpj);
    const caminho = d.xml_path ?? d.xml_resumo_path;
    if (!caminho) throw new ErroIntegracao(404, 'XML ainda não disponível.');
    return { xml: await this.arm.ler(caminho), completo: !!d.xml_path };
  }

  /** ZIP com até 500 XMLs (nome: <chave>.xml, ou <chave>-resumo.xml). Chaves fora da integração ficam de fora. */
  async zip(ctx: ContextoIntegracao, chavesBrutas: unknown, cnpj: string | null, saida: Writable, antes: () => void): Promise<number> {
    const chaves = [...new Set((Array.isArray(chavesBrutas) ? chavesBrutas : []).map(String).filter((c) => /^\d{44}$/.test(c)))];
    if (!chaves.length) throw new ErroIntegracao(400, 'Informe as chaves (lista "chaves").');
    if (chaves.length > LIMITE_ZIP) throw new ErroIntegracao(413, `No máximo ${LIMITE_ZIP} chaves por ZIP.`);
    const emps = this.empresasDoFiltro(ctx, cnpj);
    const docs: any[] = [];
    for (let i = 0; i < chaves.length; i += 200) docs.push(...ok(await this.db.from('documentos').select('chave,modelo,direcao,xml_path,xml_resumo_path').in('empresa_id', emps.map((e) => e.id)).in('chave', chaves.slice(i, i + 200)), 'notas') as any[]);
    const validos = docs.filter((d) => ctx.modelos.includes(d.modelo) && ctx.direcoes.includes(d.direcao) && (d.xml_path || d.xml_resumo_path));
    const unicos = [...new Map(validos.map((d) => [d.chave, d])).values()];
    if (!unicos.length) throw new ErroIntegracao(404, 'Nenhuma das chaves foi encontrada para os CNPJs desta integração.');
    antes();
    const z = new Zip(saida);
    for (let i = 0; i < unicos.length; i += 8) {
      const bloco = unicos.slice(i, i + 8);
      const conteudos = await Promise.all(bloco.map((d) => this.arm.ler(d.xml_path ?? d.xml_resumo_path).catch(() => null)));
      for (let j = 0; j < bloco.length; j++) if (conteudos[j]) await z.adicionar(`${bloco[j].chave}${bloco[j].xml_path ? '' : '-resumo'}.xml`, conteudos[j]!);
    }
    await z.finalizar();
    return unicos.length;
  }

  /* ---------- webhook ---------- */

  /** Passo 1: transforma as mudanças novas em entregas (uma por nota) para cada integração com webhook. */
  async enfileirar(): Promise<number> {
    const ints = ok(await this.db.from('integracoes_api').select('id,modelos,direcoes,webhook_cursor').eq('ativo', true).is('revogado_em', null).not('webhook_url', 'is', null).limit(200), 'integrações com webhook') as any[];
    let total = 0;
    for (const i of ints) {
      const vinc = ok(await this.db.from('integracao_api_empresas').select('empresa_id').eq('integracao_id', i.id), 'empresas') as any[];
      if (!vinc.length) continue;
      const muds = ok(await this.db.from('integracao_mudancas').select('id,empresa_id,chave,tipo').in('empresa_id', vinc.map((v) => v.empresa_id)).gt('id', i.webhook_cursor).order('id').limit(500), 'mudanças') as any[];
      if (!muds.length) continue;
      const chaves = [...new Set(muds.map((m) => m.chave.trim()))];
      const agora = new Date().toISOString();
      const docs: any[] = [];
      for (let k = 0; k < chaves.length; k += 200) docs.push(...ok(await this.db.from('documentos').select('id,empresa_id,chave,modelo,direcao').in('empresa_id', vinc.map((v) => v.empresa_id)).in('chave', chaves.slice(k, k + 200)), 'notas') as any[]);
      const doc = new Map(docs.map((d) => [`${d.empresa_id}|${d.chave}`, d]));
      const linhas = muds.map((m) => ({ m, d: doc.get(`${m.empresa_id}|${m.chave.trim()}`) }))
        .filter(({ d }) => d && i.modelos.includes(d.modelo) && i.direcoes.includes(d.direcao))
        .map(({ m, d }) => ({ integracao_id: i.id, documento_id: d.id, mudanca_id: m.id, evento: m.tipo === 'cancelado' ? 'documento.atualizado' : 'documento.novo',
          status: 'pendente', tentativas: 0, proxima_em: agora, criado_em: agora }));
      if (linhas.length) ok(await this.db.from('integracao_webhook_fila').upsert(linhas, { onConflict: 'integracao_id,documento_id,mudanca_id', ignoreDuplicates: true }), 'enfileirar webhook');
      ok(await this.db.from('integracoes_api').update({ webhook_cursor: muds[muds.length - 1].id }).eq('id', i.id), 'avançar cursor do webhook');
      total += linhas.length;
    }
    return total;
  }

  /** Passo 2: entrega o que está pendente (com retentativa e espera crescente). */
  async entregar(limite = 40): Promise<{ entregues: number; falhas: number }> {
    const fila = ok(await this.db.rpc('integracao_webhook_reservar', { p_limite: limite, p_segundos: 120 }), 'reservar entregas') as any[];
    if (!fila?.length) return { entregues: 0, falhas: 0 };
    const ints = new Map<string, any>();
    for (const id of [...new Set(fila.map((f) => f.integracao_id))]) {
      ints.set(id, ok(await this.db.from('integracoes_api').select('id,webhook_url,webhook_segredo_cifrado,ativo,revogado_em').eq('id', id).maybeSingle(), 'integração'));
    }
    const docs = ok(await this.db.from('documentos').select(`${CAMPOS_DOC}`).in('id', [...new Set(fila.map((f) => f.documento_id))]), 'notas') as any[];
    const porDoc = new Map(docs.map((d) => [d.id, d]));
    const emps = docs.length ? ok(await this.db.from('empresas').select('id,cnpj,razao_social').in('id', [...new Set(docs.map((d) => d.empresa_id))]), 'empresas') as any[] : [];
    const porEmp = new Map(emps.map((e) => [e.id, e]));
    let entregues = 0; let falhas = 0;
    const tratar = async (f: any) => {
      const i = ints.get(f.integracao_id); const d = porDoc.get(f.documento_id);
      const fim = async (mud: Record<string, unknown>) => { ok(await this.db.from('integracao_webhook_fila').update(mud).eq('id', f.id), 'atualizar entrega'); };
      if (!i || !i.ativo || i.revogado_em || !i.webhook_url) return fim({ status: 'falhou', ultimo_erro: 'integração pausada ou sem webhook' });
      if (!d) return fim({ status: 'falhou', ultimo_erro: 'nota não existe mais' });
      let xml: string | null = null;
      const caminho = d.xml_path ?? d.xml_resumo_path;
      if (caminho) { try { const b = await this.arm.ler(caminho); if (b.length <= 1024 * 1024) xml = b.toString('utf8'); } catch { /* sem XML no aviso: o sistema baixa pela API */ } }
      const corpo = JSON.stringify({ id: String(f.id), evento: f.evento, versao: VERSAO_API, criadoEm: f.criado_em, documento: notaApi(d, porEmp.get(d.empresa_id) ?? { cnpj: '', razao_social: '' }), xml });
      try {
        const r = await this.http(i.webhook_url, corpo, this.cabecalhos(decifrar(i.webhook_segredo_cifrado, this.masterKey).toString(), corpo, f.evento, String(f.id)));
        if (r.status >= 200 && r.status < 300) { entregues++; return fim({ status: 'entregue', entregue_em: new Date().toISOString(), ultimo_http: r.status, ultimo_erro: null, tentativas: f.tentativas + 1 }); }
        throw Object.assign(new Error(r.corpo.slice(0, 200) || `HTTP ${r.status}`), { http: r.status });
      } catch (e) {
        falhas++;
        const t = f.tentativas + 1;
        const espera = ESPERAS_WEBHOOK_SEG[t - 1];
        return fim({ tentativas: t, ultimo_http: (e as any).http ?? null, ultimo_erro: (e as Error).message.slice(0, 300),
          ...(espera ? { proxima_em: new Date(Date.now() + espera * 1000).toISOString() } : { status: 'falhou' }) });
      }
    };
    for (let k = 0; k < fila.length; k += 4) await Promise.all(fila.slice(k, k + 4).map(tratar));
    if (falhas) log.warn('webhook: entregas com falha', { entregues, falhas });
    return { entregues, falhas };
  }
}

/** POST com tempo limite de 15 s, sem seguir redirecionamento. */
async function enviarHttp(url: string, corpo: string, cab: Record<string, string>): Promise<{ status: number; corpo: string }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(url, { method: 'POST', body: corpo, headers: cab, redirect: 'manual', signal: ctrl.signal });
    return { status: r.status, corpo: (await r.text()).slice(0, 1000) };
  } catch (e) {
    throw new Error((e as Error).name === 'AbortError' ? 'sem resposta em 15 s' : (e as Error).message);
  } finally { clearTimeout(t); }
}
