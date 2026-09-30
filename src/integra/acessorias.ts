/**
 * Sistema Acessórias (https://api.acessorias.com/documentation).
 *
 * - Autenticação: Authorization: Bearer <API Token> (gerado por usuário em Configurações › API Token).
 * - Limite: 100 requisições por minuto (janela deslizante).
 * - e-Contínuo: POST /econtinuo, multipart/form-data com o campo `arquivo` (PDF). A Acessórias lê do PDF
 *   CNPJ, competência, vencimento e valor, e baixa a entrega da obrigação da empresa.
 *   Sucesso: HTTP 200 { msg, pathFolder }. Erro de negócio: HTTP 200 { Erro: "Entrega [...] inexistente [...]" }.
 */
import { Armazenamento } from '../armazenamento';
import { cifrar, decifrar } from '../cripto';
import { Db, ok } from '../db';
import { log } from '../log';

export const URL_ACESSORIAS = 'https://api.acessorias.com';

export class ErroAcessorias extends Error {
  constructor(public readonly status: number, msg: string) { super(msg); }
}

export interface TransporteAcessorias {
  enviarPdf(url: string, token: string, nome: string, pdf: Buffer): Promise<{ status: number; corpo: string }>;
  get(url: string, token: string): Promise<{ status: number; corpo: string }>;
}

/** Transporte real: fetch do Node 22 com FormData (multipart). */
export const transporteFetch: TransporteAcessorias = {
  async enviarPdf(url, token, nome, pdf) {
    const form = new FormData();
    form.append('arquivo', new Blob([pdf], { type: 'application/pdf' }), nome);
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, body: form, signal: AbortSignal.timeout(60_000) });
    return { status: r.status, corpo: await r.text() };
  },
  async get(url, token) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    return { status: r.status, corpo: await r.text() };
  },
};

/** Resposta do e-Contínuo: enviado (com a pasta de destino) ou erro com a mensagem da Acessórias. */
export function lerRespostaEcontinuo(status: number, corpo: string): { ok: boolean; mensagem: string; caminho: string | null } {
  let j: any = null;
  try { j = corpo ? JSON.parse(corpo) : null; } catch { j = null; }
  if (status === 401) return { ok: false, mensagem: 'A Acessórias recusou o token: confira o API Token em Administração › Escritório.', caminho: null };
  if (status === 429) return { ok: false, mensagem: 'Limite da Acessórias (100 envios por minuto) atingido: tente de novo em 1 minuto.', caminho: null };
  const erro = j && (j.Erro ?? j.erro ?? j.error);
  if (erro) return { ok: false, mensagem: String(erro), caminho: null };
  if (status >= 200 && status < 300 && j && (j.msg || j.pathFolder)) return { ok: true, mensagem: String(j.msg ?? 'Entrega processada.'), caminho: j.pathFolder ? String(j.pathFolder) : null };
  return { ok: false, mensagem: `A Acessórias respondeu com status ${status}${j && j.message ? `: ${j.message}` : ''}.`, caminho: null };
}

const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ServicoAcessorias {
  private ultimoEnvio = 0;

  constructor(
    private readonly db: Db,
    private readonly arm: Armazenamento,
    private readonly masterKey: string,
    private readonly transporte: TransporteAcessorias = transporteFetch,
    /** Intervalo mínimo entre chamadas (100/min da Acessórias, com folga). */
    private readonly intervaloMs = 700,
  ) {}

  private async config() {
    return ok(await this.db.from('integracoes').select('*').eq('servico', 'acessorias').maybeSingle(), 'integração Acessórias') as
      { token_cifrado: string; final_token: string | null; envio_automatico: boolean; atualizado_em: string; atualizado_por: string } | null;
  }

  private async token(): Promise<string> {
    const c = await this.config();
    if (!c) throw new ErroAcessorias(503, 'Integração com a Acessórias não configurada: cadastre o API Token em Administração › Escritório.');
    try { return decifrar(c.token_cifrado, this.masterKey).toString('utf8'); } catch {
      throw new ErroAcessorias(500, 'Não foi possível abrir o token da Acessórias. Cadastre de novo.');
    }
  }

  private async esperarVez() {
    const falta = this.ultimoEnvio + this.intervaloMs - Date.now();
    if (falta > 0) await pausa(falta);
    this.ultimoEnvio = Date.now();
  }

  async situacao() {
    const c = await this.config();
    const ini = new Date(Date.now() - 31 * 86400000).toISOString();
    const envios = c ? ok(await this.db.from('guias_envios').select('status').gte('enviado_em', ini).limit(100000), 'envios') as { status: string }[] : [];
    return c
      ? { configurado: true, finalToken: c.final_token, envioAutomatico: c.envio_automatico, atualizadoEm: c.atualizado_em, atualizadoPor: c.atualizado_por,
        envios30d: { total: envios.length, erros: envios.filter((e) => e.status === 'erro').length } }
      : { configurado: false, finalToken: null, envioAutomatico: false, atualizadoEm: null, atualizadoPor: null, envios30d: { total: 0, erros: 0 } };
  }

  async salvar(dados: { token?: unknown; envioAutomatico?: unknown }, email: string) {
    const token = String(dados.token ?? '').trim();
    const atual = await this.config();
    const envioAutomatico = dados.envioAutomatico === undefined ? (atual?.envio_automatico ?? true) : dados.envioAutomatico === true;
    if (!token && !atual) throw new ErroAcessorias(422, 'Informe o API Token da Acessórias.');
    if (token && (/\s/.test(token) || token.length < 16 || token.length > 500)) throw new ErroAcessorias(422, 'Token em formato inválido: copie o API Token exatamente como aparece na Acessórias.');
    ok(await this.db.from('integracoes').upsert({
      servico: 'acessorias',
      token_cifrado: token ? cifrar(Buffer.from(token, 'utf8'), this.masterKey) : atual!.token_cifrado,
      final_token: token ? token.slice(-4) : atual!.final_token,
      envio_automatico: envioAutomatico,
      atualizado_em: new Date().toISOString(), atualizado_por: email,
    }, { onConflict: 'servico' }), 'gravar integração Acessórias');
    log.info('integração Acessórias atualizada', { envioAutomatico, tokenNovo: !!token, por: email });
    return this.situacao();
  }

  async remover(email: string) {
    ok(await this.db.from('integracoes').delete().eq('servico', 'acessorias'), 'remover integração Acessórias');
    log.info('integração Acessórias removida', { por: email });
    return this.situacao();
  }

  /** Confere o token com uma leitura simples (lista de empresas, página 1). */
  async testar(email: string) {
    const token = await this.token();
    await this.esperarVez();
    let r: { status: number; corpo: string };
    try { r = await this.transporte.get(`${URL_ACESSORIAS}/companies/ListAll?Pagina=1`, token); } catch (e) {
      throw new ErroAcessorias(503, `Não foi possível conectar à Acessórias: ${(e as Error).message}`);
    }
    log.info('Acessórias: token testado', { status: r.status, por: email });
    if (r.status === 401) return { ok: false, mensagem: 'A Acessórias recusou o token. Gere um novo em Configurações › API Token.' };
    if (r.status >= 200 && r.status < 300) return { ok: true, mensagem: 'A Acessórias aceitou o token.' };
    return { ok: false, mensagem: `A Acessórias respondeu com status ${r.status}.` };
  }

  /** Último envio de cada guia (para as telas). */
  async ultimosEnvios(guiaIds: number[]): Promise<Map<number, any>> {
    const m = new Map<number, any>();
    for (let i = 0; i < guiaIds.length; i += 200) {
      const lote = guiaIds.slice(i, i + 200);
      const l = ok(await this.db.from('guias_envios').select('id,guia_id,status,mensagem,caminho_destino,enviado_em,enviado_por').in('guia_id', lote)
        .order('enviado_em', { ascending: false }).order('id', { ascending: false }).limit(5000), 'envios das guias') as any[];
      for (const e of l) if (!m.has(e.guia_id)) m.set(e.guia_id, e);
    }
    return m;
  }

  /** Envia o PDF de uma guia pelo e-Contínuo. Não reenvia o que já foi aceito, a não ser com `forcar`. */
  async enviarGuia(guiaId: number, email: string, forcar = false) {
    const token = await this.token();
    const g = ok(await this.db.from('guias').select('id,empresa_id,tipo,competencia,numero_documento,caminho').eq('id', guiaId).maybeSingle(), 'guia') as any;
    if (!g) throw new ErroAcessorias(404, 'Guia não encontrada.');
    if (!g.caminho) throw new ErroAcessorias(422, 'Esta guia não tem PDF guardado para enviar.');
    if (!forcar) {
      const ult = (await this.ultimosEnvios([g.id])).get(g.id);
      if (ult && ult.status === 'enviado') throw new ErroAcessorias(409, 'Esta guia já foi enviada à Acessórias.');
    }
    const pdf = await this.arm.ler(g.caminho);
    const nome = `${g.tipo === 'das_mei' ? 'DAS-MEI' : 'DAS'}-${String(g.competencia).slice(0, 7)}-${g.numero_documento ?? g.id}.pdf`;
    await this.esperarVez();
    let res: { ok: boolean; mensagem: string; caminho: string | null }; let status = 0;
    try {
      const r = await this.transporte.enviarPdf(`${URL_ACESSORIAS}/econtinuo`, token, nome, pdf);
      status = r.status;
      res = lerRespostaEcontinuo(r.status, r.corpo);
    } catch (e) {
      res = { ok: false, mensagem: `Não foi possível conectar à Acessórias: ${(e as Error).message}`, caminho: null };
    }
    const salvo = ok(await this.db.from('guias_envios').insert({
      guia_id: g.id, destino: 'acessorias', status: res.ok ? 'enviado' : 'erro', mensagem: res.mensagem.slice(0, 500), caminho_destino: res.caminho,
      status_http: status || null, enviado_em: new Date().toISOString(), enviado_por: email,
    }).select('*').single(), 'registrar envio');
    log.info('guia enviada à Acessórias', { guia: g.id, ok: res.ok, status, por: email });
    return salvo as { guia_id: number; status: 'enviado' | 'erro'; mensagem: string; caminho_destino: string | null; enviado_em: string; enviado_por: string };
  }

  /** Envia as guias da competência que ainda não foram aceitas (em sequência, respeitando o limite da Acessórias). */
  async enviarPendentes(competencia: string, email: string, empresaIds?: string[]) {
    await this.token();
    let q = this.db.from('guias').select('id,empresa_id,gerado_em,caminho').eq('competencia', `${competencia.slice(0, 7)}-01`).order('gerado_em', { ascending: false }).limit(5000);
    if (empresaIds && empresaIds.length) q = q.in('empresa_id', empresaIds.slice(0, 500));
    const guias = ok(await q, 'guias da competência') as { id: number; empresa_id: string; caminho: string | null }[];
    // Só a guia mais recente de cada empresa (a que vale)
    const porEmpresa = new Map<string, { id: number; caminho: string | null }>();
    for (const g of guias) if (!porEmpresa.has(g.empresa_id)) porEmpresa.set(g.empresa_id, g);
    // Guia sem PDF (o SERPRO não devolveu) não tem o que enviar
    const ids = [...porEmpresa.values()].filter((g) => g.caminho).map((g) => g.id);
    const ult = await this.ultimosEnvios(ids);
    const pendentes = ids.filter((id) => !ult.get(id) || ult.get(id).status !== 'enviado').slice(0, 200);
    const resultados: { guiaId: number; ok: boolean; mensagem: string }[] = [];
    for (const id of pendentes) {
      try {
        const r = await this.enviarGuia(id, email, true);
        resultados.push({ guiaId: id, ok: r.status === 'enviado', mensagem: r.mensagem });
        if (/recusou o token/.test(r.mensagem)) break;
      } catch (e) {
        resultados.push({ guiaId: id, ok: false, mensagem: (e as Error).message });
        if (e instanceof ErroAcessorias && (e.status === 503 || e.status === 500)) break;
      }
    }
    return { resultados, jaEnviadas: ids.length - ids.filter((id) => !ult.get(id) || ult.get(id).status !== 'enviado').length };
  }

  async envioAutomaticoAtivo() {
    const c = await this.config();
    return !!(c && c.envio_automatico);
  }
}
