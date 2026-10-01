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

/* ---------- leitura (funções puras: os nomes dos campos seguem a documentação, sem diferenciar maiúsculas) ---------- */

function campo(o: any, ...nomes: string[]): any {
  if (!o || typeof o !== 'object') return undefined;
  for (const n of nomes) if (o[n] !== undefined) return o[n];
  const chaves = Object.keys(o);
  for (const n of nomes) { const k = chaves.find((c) => c.toLowerCase() === n.toLowerCase()); if (k) return o[k]; }
  return undefined;
}
const numero = (v: unknown) => { const n = Number(String(v ?? '').replace(/\D/g, '')); return Number.isFinite(n) ? n : 0; };

/** Data da Acessórias (AAAA-MM-DD, DD/MM/AAAA, com ou sem hora; "0000-00-00" = vazia) → AAAA-MM-DD ou null. */
export function dataAcessorias(v: unknown): string | null {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] === '0000' || m[2] === '00' ? null : `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return m[3] === '0000' || m[2] === '00' ? null : `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

/** Competência da Acessórias (MM/AAAA, AAAA-MM ou data) → AAAA-MM ou null. */
export function competenciaAcessorias(v: unknown): string | null {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{2})\/(\d{4})$/);
  if (m) return m[2] === '0000' ? null : `${m[2]}-${m[1]}`;
  m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return m[1] === '0000' || m[2] === '00' ? null : `${m[1]}-${m[2]}`;
  const d = dataAcessorias(s);
  return d ? d.slice(0, 7) : null;
}

export interface ObrigacaoResumo { nome: string; entregues: number; atrasadas: number; proximos30: number; futuras: number }
export interface EmpresaAcessorias { cnpj: string; id: string | null; razao: string | null; fantasia: string | null; ativa: boolean; obrigacoes: ObrigacaoResumo[] }

/** GET /companies/ListAll (com obligations): empresas, só com CNPJ/CPF válido; obrigações inativas ficam de fora. */
export function lerEmpresasAcessorias(corpo: string): EmpresaAcessorias[] {
  let j: any;
  try { j = corpo ? JSON.parse(corpo) : []; } catch { return []; }
  const lista: any[] = Array.isArray(j) ? j : j && typeof j === 'object' && !campo(j, 'Erro', 'erro') ? (Array.isArray(campo(j, 'data', 'empresas')) ? campo(j, 'data', 'empresas') : [j]) : [];
  const saida: EmpresaAcessorias[] = [];
  for (const e of lista) {
    const cnpj = String(campo(e, 'Identificador', 'CNPJ', 'cnpj') ?? '').replace(/\D/g, '');
    if (cnpj.length !== 14 && cnpj.length !== 11) continue;
    const status = String(campo(e, 'Status', 'Ativa') ?? '').trim().toLowerCase();
    const obr = campo(e, 'Obrigacoes', 'obligations');
    saida.push({
      cnpj, id: campo(e, 'ID', 'Id') != null ? String(campo(e, 'ID', 'Id')) : null,
      razao: campo(e, 'Razao', 'RazaoSocial', 'nome') ?? null, fantasia: campo(e, 'Fantasia') ?? null,
      ativa: !/^(n|inativ|0$)/.test(status),
      obrigacoes: (Array.isArray(obr) ? obr : [])
        .filter((o: any) => !/inativ/i.test(String(campo(o, 'Status') ?? '')))
        .map((o: any) => ({ nome: String(campo(o, 'Nome') ?? '').trim(), entregues: numero(campo(o, 'Entregues')), atrasadas: numero(campo(o, 'Atrasadas')), proximos30: numero(campo(o, 'Proximos30D')), futuras: numero(campo(o, 'Futuras30+', 'Futuras30')) }))
        .filter((o: ObrigacaoResumo) => o.nome),
    });
  }
  return saida;
}

export type SituacaoEntrega = 'entregue' | 'atrasada' | 'pendente' | 'dispensada';
export interface Entrega {
  nome: string; competencia: string | null; prazo: string | null; entregue_em: string | null; multa: boolean;
  situacao: SituacaoEntrega; status: string | null; guia_lida: boolean; departamento: string | null; responsavel: string | null;
}

/** Situação de uma entrega: entregue (data de entrega ou status), dispensada, atrasada (prazo passou) ou pendente. */
export function situacaoEntrega(status: string | null, prazo: string | null, entregueEm: string | null, hoje: string): SituacaoEntrega {
  const s = (status ?? '').toLowerCase();
  if (entregueEm || /entregue|conclu|baixad/.test(s)) return 'entregue';
  if (/dispens|não se aplica|nao se aplica/.test(s)) return 'dispensada';
  if (/atras/.test(s) || (prazo && prazo < hoje)) return 'atrasada';
  return 'pendente';
}

/** GET /deliveries/{cnpj}: entregas da competência (as de outra competência ficam de fora; sem competência, entram). */
export function lerEntregas(corpo: string, competencia: string, hoje: string): Entrega[] {
  let j: any;
  try { j = corpo ? JSON.parse(corpo) : []; } catch { return []; }
  const empresas: any[] = Array.isArray(j) ? j : j && typeof j === 'object' ? [j] : [];
  const saida: Entrega[] = [];
  for (const e of empresas) {
    const ents = campo(e, 'Entregas');
    for (const x of Array.isArray(ents) ? ents : []) {
      const comp = competenciaAcessorias(campo(x, 'EntCompetencia', 'Competencia'));
      if (comp && comp !== competencia) continue;
      const prazo = dataAcessorias(campo(x, 'EntDtPrazo', 'Prazo'));
      const entregueEm = dataAcessorias(campo(x, 'EntDtEntrega', 'DtEntrega'));
      const status = campo(x, 'Status') != null ? String(campo(x, 'Status')) : null;
      const cfg = campo(x, 'Config') ?? {};
      const multa = String(campo(x, 'EntMulta') ?? '').trim();
      saida.push({
        nome: String(campo(x, 'Nome') ?? 'Obrigação').trim(), competencia: comp, prazo, entregue_em: entregueEm,
        multa: !!multa && !/^(n|nao|não|0|false)$/i.test(multa), situacao: situacaoEntrega(status, prazo, entregueEm, hoje), status,
        guia_lida: /^(s|sim|1|true)$/i.test(String(campo(x, 'EntGuiaLida') ?? '').trim()),
        departamento: campo(cfg, 'DptoNome') ?? null, responsavel: campo(x, 'RespEntrega') ?? campo(cfg, 'RespEntrega') ?? null,
      });
    }
  }
  const ordem: Record<SituacaoEntrega, number> = { atrasada: 0, pendente: 1, entregue: 2, dispensada: 3 };
  return saida.sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || String(a.prazo ?? '9').localeCompare(String(b.prazo ?? '9')) || a.nome.localeCompare(b.nome));
}

/** Tipos de documento do mês que vão para a Acessórias. */
export const TIPOS_DOCUMENTO: Record<string, string> = {
  recibo_sped_fiscal: 'Recibo do SPED Fiscal', recibo_sped_contribuicoes: 'Recibo do SPED Contribuições', darf: 'DARF', dctfweb: 'DCTFWeb',
  reinf: 'Recibo da EFD-Reinf', icms: 'Guia de ICMS (DUA)', pgdas_recibo: 'Recibo do PGDAS-D', pgdas_declaracao: 'Declaração do PGDAS-D', maed: 'MAED (multa por atraso)', outro: 'Outro documento',
};
export const TIPOS_UPLOAD = ['recibo_sped_fiscal', 'recibo_sped_contribuicoes', 'darf', 'dctfweb', 'reinf', 'icms', 'outro'];
export const MAX_PDF = 15 * 1024 * 1024;

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

  /** Manda um PDF ao e-Contínuo e interpreta a resposta (não grava nada). */
  private async postarPdf(token: string, nome: string, pdf: Buffer) {
    await this.esperarVez();
    try {
      const r = await this.transporte.enviarPdf(`${URL_ACESSORIAS}/econtinuo`, token, nome, pdf);
      return { status: r.status, res: lerRespostaEcontinuo(r.status, r.corpo) };
    } catch (e) {
      return { status: 0, res: { ok: false, mensagem: `Não foi possível conectar à Acessórias: ${(e as Error).message}`, caminho: null as string | null } };
    }
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
    const { status, res } = await this.postarPdf(token, nome, pdf);
    const salvo = ok(await this.db.from('guias_envios').insert({
      guia_id: g.id, destino: 'acessorias', status: res.ok ? 'enviado' : 'erro', mensagem: res.mensagem.slice(0, 500), caminho_destino: res.caminho,
      status_http: status || null, enviado_em: new Date().toISOString(), enviado_por: email,
    }).select('*').single(), 'registrar envio');
    log.info('guia enviada à Acessórias', { guia: g.id, ok: res.ok, status, por: email });
    return salvo as { guia_id: number; status: 'enviado' | 'erro'; mensagem: string; caminho_destino: string | null; enviado_em: string; enviado_por: string };
  }

  /* ---------- documentos do mês (recibos e guias além do DAS) ---------- */

  async ultimosEnviosDocumentos(ids: number[]): Promise<Map<number, any>> {
    const m = new Map<number, any>();
    for (let i = 0; i < ids.length; i += 200) {
      const l = ok(await this.db.from('documentos_entrega_envios').select('id,documento_id,status,mensagem,caminho_destino,enviado_em,enviado_por').in('documento_id', ids.slice(i, i + 200))
        .order('enviado_em', { ascending: false }).order('id', { ascending: false }).limit(5000), 'envios dos documentos') as any[];
      for (const e of l) if (!m.has(e.documento_id)) m.set(e.documento_id, e);
    }
    return m;
  }

  /** Envia um documento do mês pelo e-Contínuo. Não reenvia o que já foi aceito, a não ser com `forcar`. */
  async enviarDocumento(documentoId: number, email: string, forcar = false) {
    const token = await this.token();
    const d = ok(await this.db.from('documentos_entrega').select('id,empresa_id,competencia,tipo,nome,caminho').eq('id', documentoId).maybeSingle(), 'documento') as any;
    if (!d) throw new ErroAcessorias(404, 'Documento não encontrado.');
    if (!forcar) {
      const ult = (await this.ultimosEnviosDocumentos([d.id])).get(d.id);
      if (ult && ult.status === 'enviado') throw new ErroAcessorias(409, 'Este documento já foi enviado à Acessórias.');
    }
    const pdf = await this.arm.ler(d.caminho);
    const { status, res } = await this.postarPdf(token, d.nome, pdf);
    const salvo = ok(await this.db.from('documentos_entrega_envios').insert({
      documento_id: d.id, status: res.ok ? 'enviado' : 'erro', mensagem: res.mensagem.slice(0, 500), caminho_destino: res.caminho,
      status_http: status || null, enviado_em: new Date().toISOString(), enviado_por: email,
    }).select('*').single(), 'registrar envio do documento');
    log.info('documento enviado à Acessórias', { documento: d.id, tipo: d.tipo, ok: res.ok, status, por: email });
    return salvo as { documento_id: number; status: 'enviado' | 'erro'; mensagem: string; caminho_destino: string | null; enviado_em: string; enviado_por: string };
  }

  /** Documentos da competência ainda não aceitos pela Acessórias. Não envia nada. */
  async documentosPendentes(competencia: string, empresaIds?: string[]) {
    await this.token();
    let q = this.db.from('documentos_entrega').select('id,empresa_id,tipo,nome,criado_em').eq('competencia', `${competencia.slice(0, 7)}-01`).order('criado_em', { ascending: true }).limit(5000);
    if (empresaIds && empresaIds.length) q = q.in('empresa_id', empresaIds.slice(0, 500));
    const docs = ok(await q, 'documentos da competência') as { id: number; empresa_id: string; tipo: string; nome: string }[];
    const ult = await this.ultimosEnviosDocumentos(docs.map((d) => d.id));
    const nao = docs.filter((d) => !ult.get(d.id) || ult.get(d.id).status !== 'enviado');
    return { documentos: nao.slice(0, 200).map((d) => ({ id: d.id, empresaId: d.empresa_id, tipo: d.tipo, nome: d.nome })), jaEnviados: docs.length - nao.length };
  }

  /** Envia a lista de documentos, um a um (para no primeiro erro que afetaria todos). */
  async enviarDocumentos(ids: number[], email: string) {
    const resultados: { documentoId: number; ok: boolean; mensagem: string }[] = [];
    for (const id of ids.slice(0, 200)) {
      try {
        const r = await this.enviarDocumento(id, email, true);
        resultados.push({ documentoId: id, ok: r.status === 'enviado', mensagem: r.mensagem });
        if (/recusou o token/.test(r.mensagem)) break;
      } catch (e) {
        resultados.push({ documentoId: id, ok: false, mensagem: (e as Error).message });
        if (e instanceof ErroAcessorias && (e.status === 503 || e.status === 500)) break;
      }
    }
    return resultados;
  }

  /* ---------- leitura: empresas e entregas ---------- */

  private async lerGet(caminho: string) {
    const token = await this.token();
    await this.esperarVez();
    let r: { status: number; corpo: string };
    try { r = await this.transporte.get(`${URL_ACESSORIAS}${caminho}`, token); } catch (e) {
      throw new ErroAcessorias(503, `Não foi possível conectar à Acessórias: ${(e as Error).message}`);
    }
    if (r.status === 401) throw new ErroAcessorias(502, 'A Acessórias recusou o token: confira o API Token em Administração › Escritório.');
    if (r.status === 429) throw new ErroAcessorias(429, 'Limite da Acessórias (100 consultas por minuto) atingido: tente de novo em 1 minuto.');
    return r;
  }

  /**
   * Copia o cadastro de empresas da Acessórias (20 por página) com o resumo das obrigações.
   * Empresas que sumiram da lista são apagadas da cópia.
   */
  async sincronizarEmpresas(email: string) {
    const todas: EmpresaAcessorias[] = [];
    for (let pagina = 1; pagina <= 200; pagina++) {
      const r = await this.lerGet(`/companies/ListAll?Pagina=${pagina}&obligations=1`);
      if (r.status === 404 || r.status === 204) break;
      if (r.status < 200 || r.status >= 300) throw new ErroAcessorias(502, `A Acessórias respondeu com status ${r.status} na página ${pagina}.`);
      const lote = lerEmpresasAcessorias(r.corpo);
      todas.push(...lote);
      let bruto: unknown = null; try { bruto = JSON.parse(r.corpo); } catch { /* vazio */ }
      if (!Array.isArray(bruto) || bruto.length < 20) break;
    }
    const agora = new Date().toISOString();
    const unicas = new Map(todas.map((e) => [e.cnpj, e]));
    const linhas = [...unicas.values()].map((e) => ({ cnpj: e.cnpj, id_acessorias: e.id, razao: e.razao, fantasia: e.fantasia, ativa: e.ativa, obrigacoes: e.obrigacoes, sincronizado_em: agora }));
    for (let i = 0; i < linhas.length; i += 500) ok(await this.db.from('acessorias_empresas').upsert(linhas.slice(i, i + 500), { onConflict: 'cnpj' }), 'gravar empresas da Acessórias');
    if (linhas.length) ok(await this.db.from('acessorias_empresas').delete().lt('sincronizado_em', agora), 'limpar empresas antigas');
    log.info('Acessórias: empresas sincronizadas', { total: linhas.length, por: email });
    return this.resumoEmpresas();
  }

  /** Cruzamento do cadastro: empresas do Appura sem cadastro na Acessórias e obrigações atrasadas. */
  async resumoEmpresas() {
    const ac = ok(await this.db.from('acessorias_empresas').select('cnpj,razao,ativa,obrigacoes,sincronizado_em').limit(100000), 'empresas da Acessórias') as { cnpj: string; razao: string | null; ativa: boolean; obrigacoes: ObrigacaoResumo[]; sincronizado_em: string }[];
    const ap = ok(await this.db.from('empresas').select('id,cnpj,razao_social,ativo').limit(100000), 'empresas') as { id: string; cnpj: string; razao_social: string; ativo?: boolean }[];
    const porCnpj = new Map(ac.map((e) => [e.cnpj, e]));
    const ativasAppura = ap.filter((e) => e.ativo !== false);
    const semCadastro = ativasAppura.filter((e) => !porCnpj.has(e.cnpj));
    const comAtraso = ativasAppura.map((e) => ({ e, a: porCnpj.get(e.cnpj) }))
      .map(({ e, a }) => ({ id: e.id, cnpj: e.cnpj, razao_social: e.razao_social, atrasadas: (a?.obrigacoes ?? []).filter((o) => o.atrasadas > 0).map((o) => ({ nome: o.nome, quantidade: o.atrasadas })) }))
      .filter((x) => x.atrasadas.length)
      .sort((x, y) => y.atrasadas.reduce((s, o) => s + o.quantidade, 0) - x.atrasadas.reduce((s, o) => s + o.quantidade, 0));
    return {
      sincronizadoEm: ac.reduce<string | null>((m, e) => (!m || e.sincronizado_em > m ? e.sincronizado_em : m), null),
      naAcessorias: ac.length, vinculadas: ativasAppura.length - semCadastro.length,
      semCadastro: semCadastro.slice(0, 500).map((e) => ({ id: e.id, cnpj: e.cnpj, razao_social: e.razao_social })), totalSemCadastro: semCadastro.length,
      comAtraso: comAtraso.slice(0, 500), totalComAtraso: comAtraso.length,
    };
  }

  /** Obrigações da empresa no cadastro da Acessórias (cópia da última sincronização). */
  async obrigacoesDaEmpresa(cnpj: string) {
    return (ok(await this.db.from('acessorias_empresas').select('cnpj,id_acessorias,ativa,obrigacoes,sincronizado_em').eq('cnpj', cnpj).maybeSingle(), 'empresa na Acessórias') as any) ?? null;
  }

  /** Entregas da competência guardadas na última consulta. */
  async entregasGuardadas(empresaId: string, competencia: string) {
    return (ok(await this.db.from('acessorias_entregas').select('*').eq('empresa_id', empresaId).eq('competencia', `${competencia}-01`).maybeSingle(), 'entregas') as any) ?? null;
  }

  /**
   * Consulta na Acessórias as entregas (obrigações) da empresa na competência e guarda.
   * O prazo das obrigações de um mês cai nos meses seguintes: a busca vai do 1º dia da competência até 4 meses depois,
   * e só ficam as entregas daquela competência.
   */
  async atualizarEntregas(empresaId: string, competencia: string, email: string) {
    const e = ok(await this.db.from('empresas').select('id,cnpj').eq('id', empresaId).maybeSingle(), 'empresa') as { id: string; cnpj: string } | null;
    if (!e) throw new ErroAcessorias(404, 'Empresa não encontrada.');
    const [a, m] = competencia.split('-').map(Number);
    const fim = new Date(Date.UTC(a, m + 3, 0)).toISOString().slice(0, 10);
    let entregas: Entrega[] = []; let erro: string | null = null;
    const r = await this.lerGet(`/deliveries/${e.cnpj}?DtInitial=${competencia}-01&DtFinal=${fim}&config=1`);
    if (r.status === 404 || r.status === 204) erro = null;
    else if (r.status < 200 || r.status >= 300) {
      let j: any = null; try { j = JSON.parse(r.corpo); } catch { /* sem JSON */ }
      erro = String((j && (j.Erro ?? j.erro ?? j.message)) || `A Acessórias respondeu com status ${r.status}.`).slice(0, 300);
    } else {
      let j: any = null; try { j = JSON.parse(r.corpo); } catch { /* sem JSON */ }
      const msgErro = j && !Array.isArray(j) && (j.Erro ?? j.erro);
      if (msgErro && !/nenhum|não encontrad|nao encontrad/i.test(String(msgErro))) erro = String(msgErro).slice(0, 300);
      else entregas = lerEntregas(r.corpo, competencia, this.hoje());
    }
    const linha = { empresa_id: e.id, competencia: `${competencia}-01`, entregas, erro, consultado_em: new Date().toISOString(), consultado_por: email };
    ok(await this.db.from('acessorias_entregas').upsert(linha, { onConflict: 'empresa_id,competencia' }), 'gravar entregas');
    return linha;
  }

  /** Data de hoje em São Paulo (AAAA-MM-DD), para dizer se a entrega está atrasada. */
  hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

  private lote: { competencia: string; total: number; feitas: number; erros: number; iniciado_em: string; iniciado_por: string; terminado_em: string | null; mensagem: string | null } | null = null;

  /** Situação da consulta em lote das entregas (em memória: some se o servidor reiniciar). */
  progressoEntregas() { return this.lote; }

  /**
   * Consulta as entregas da competência de todas as empresas ativas cadastradas na Acessórias, em segundo plano
   * (uma consulta por empresa, respeitando o limite de 100 por minuto). Devolve na hora; acompanhe por progressoEntregas().
   */
  async iniciarEntregasDoMes(competencia: string, email: string) {
    if (this.lote && !this.lote.terminado_em) throw new ErroAcessorias(409, `Já há uma consulta em andamento (${this.lote.feitas} de ${this.lote.total}).`);
    await this.token();
    const ac = new Set((ok(await this.db.from('acessorias_empresas').select('cnpj').limit(100000), 'empresas da Acessórias') as { cnpj: string }[]).map((e) => e.cnpj));
    if (!ac.size) throw new ErroAcessorias(422, 'Sincronize primeiro as empresas da Acessórias.');
    const empresas = (ok(await this.db.from('empresas').select('id,cnpj,ativo').limit(100000), 'empresas') as { id: string; cnpj: string; ativo?: boolean }[])
      .filter((e) => e.ativo !== false && ac.has(e.cnpj));
    const lote = { competencia, total: empresas.length, feitas: 0, erros: 0, iniciado_em: new Date().toISOString(), iniciado_por: email, terminado_em: null as string | null, mensagem: null as string | null };
    this.lote = lote;
    const rodar = async () => {
      for (const e of empresas) {
        try { const r = await this.atualizarEntregas(e.id, competencia, email); if (r.erro) lote.erros++; } catch (err) {
          lote.erros++;
          if (err instanceof ErroAcessorias && (err.status === 502 || err.status === 503 || err.status === 500)) { lote.mensagem = err.message; break; }
          if (err instanceof ErroAcessorias && err.status === 429) await pausa(60_000);
        }
        lote.feitas++;
      }
      lote.terminado_em = new Date().toISOString();
      log.info('Acessórias: entregas do mês consultadas', { competencia, total: lote.total, feitas: lote.feitas, erros: lote.erros, por: email });
    };
    void rodar();
    return lote;
  }

  /** Resumo das entregas guardadas da competência, por empresa (para a tela do escritório e o MCP). */
  async entregasDoMes(competencia: string, empresaIds?: string[]) {
    let q = this.db.from('acessorias_entregas').select('empresa_id,entregas,erro,consultado_em').eq('competencia', `${competencia}-01`).limit(100000);
    if (empresaIds && empresaIds.length) q = q.in('empresa_id', empresaIds);
    const linhas = ok(await q, 'entregas do mês') as { empresa_id: string; entregas: Entrega[]; erro: string | null; consultado_em: string }[];
    const hoje = this.hoje();
    return linhas.map((l) => {
      // A situação muda com o tempo (pendente vira atrasada): recalcula com a data de hoje
      const ents = (l.entregas ?? []).map((x) => ({ ...x, situacao: situacaoEntrega(x.status, x.prazo, x.entregue_em, hoje) }));
      const c = { entregue: 0, atrasada: 0, pendente: 0, dispensada: 0 } as Record<SituacaoEntrega, number>;
      for (const x of ents) c[x.situacao]++;
      return { empresaId: l.empresa_id, consultadoEm: l.consultado_em, erro: l.erro, contagem: c, entregas: ents };
    });
  }

  /** Guias da competência ainda não enviadas (a mais recente de cada empresa, com PDF). Não envia nada. */
  async pendentes(competencia: string, empresaIds?: string[]) {
    await this.token();
    let q = this.db.from('guias').select('id,empresa_id,gerado_em,caminho,total,vencimento').eq('competencia', `${competencia.slice(0, 7)}-01`).order('gerado_em', { ascending: false }).limit(5000);
    if (empresaIds && empresaIds.length) q = q.in('empresa_id', empresaIds.slice(0, 500));
    const guias = ok(await q, 'guias da competência') as { id: number; empresa_id: string; caminho: string | null; total: number | null; vencimento: string | null }[];
    // Só a guia mais recente de cada empresa (a que vale)
    const porEmpresa = new Map<string, (typeof guias)[number]>();
    for (const g of guias) if (!porEmpresa.has(g.empresa_id)) porEmpresa.set(g.empresa_id, g);
    // Guia sem PDF (o SERPRO não devolveu) não tem o que enviar
    const comPdf = [...porEmpresa.values()].filter((g) => g.caminho);
    const ult = await this.ultimosEnvios(comPdf.map((g) => g.id));
    const naoEnviadas = comPdf.filter((g) => !ult.get(g.id) || ult.get(g.id).status !== 'enviado');
    return { guias: naoEnviadas.slice(0, 200).map((g) => ({ id: g.id, empresaId: g.empresa_id, total: g.total, vencimento: g.vencimento })), jaEnviadas: comPdf.length - naoEnviadas.length };
  }

  /** Envia a lista de guias, uma a uma (para no primeiro erro que afetaria todas). */
  async enviarLista(ids: number[], email: string) {
    const resultados: { guiaId: number; ok: boolean; mensagem: string }[] = [];
    for (const id of ids.slice(0, 200)) {
      try {
        const r = await this.enviarGuia(id, email, true);
        resultados.push({ guiaId: id, ok: r.status === 'enviado', mensagem: r.mensagem });
        if (/recusou o token/.test(r.mensagem)) break;
      } catch (e) {
        resultados.push({ guiaId: id, ok: false, mensagem: (e as Error).message });
        if (e instanceof ErroAcessorias && (e.status === 503 || e.status === 500)) break;
      }
    }
    return resultados;
  }

  async enviarPendentes(competencia: string, email: string, empresaIds?: string[]) {
    const p = await this.pendentes(competencia, empresaIds);
    return { resultados: await this.enviarLista(p.guias.map((g) => g.id), email), jaEnviadas: p.jaEnviadas };
  }

  async envioAutomaticoAtivo() {
    const c = await this.config();
    return !!(c && c.envio_automatico);
  }
}
