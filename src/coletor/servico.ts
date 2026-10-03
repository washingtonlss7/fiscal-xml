/**
 * Appura Coletor: o programa instalado no PC do cliente (onde o sistema de vendas grava os XMLs) envia as notas para cá.
 *
 * Painel: o escritório cria uma "instalação" (cliente/grupo, um ou mais CNPJs) e gera um token por máquina
 * (mostrado uma vez só; aqui fica só o hash). O token só envia XML dos CNPJs da instalação e pode ser revogado.
 *
 * Coletor (API /api/coletor/v1, Bearer apc_…): lê a configuração, pergunta quais chaves já existem, envia lotes
 * (ZIP) e manda sinal de vida. Cada XML vai para a empresa certa pelo CNPJ; a gravação é a importação que já existe
 * (validação, deduplicação pela chave, rejeitadas pela SEFAZ, canceladas).
 */
import crypto from 'crypto';
import { Armazenamento } from '../armazenamento';
import { Db, ok } from '../db';
import { abrirEnvio, agruparMotivos, decodificarXml, importarXmls, prepararXml, RejeitadaSefaz, ResultadoArquivo } from '../importacao/importar';
import { ArquivoZip } from '../importacao/zipLeitor';
import { log } from '../log';

export class ErroColetor extends Error {
  constructor(public readonly status: number, mensagem: string) { super(mensagem); }
}

export const VERSAO_API = 1;
/** Limites de um lote enviado pelo coletor. */
export const LOTE_MAX_ARQUIVOS = 200;
export const LOTE_MAX_BYTES = 20 * 1024 * 1024;
export const EXISTENTES_MAX = 2000;
const MAX_MAQUINAS = 50;

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const limpaCnpj = (s: unknown) => String(s ?? '').replace(/\D/g, '');

export function novoToken() {
  const token = `apc_${crypto.randomBytes(32).toString('base64url')}`;
  return { token, hash: hash(token), prefixo: token.slice(0, 12) };
}

export interface EmpresaColetor { id: string; cnpj: string; c_uf: number; razao_social: string }
export interface ContextoColetor { maquinaId: string; maquinaNome: string; instalacaoId: string; instalacaoNome: string; empresas: EmpresaColetor[] }

export type SituacaoMaquina = 'revogada' | 'aguardando' | 'ok' | 'atrasada' | 'sem_sinal';

/** Situação de uma máquina pelo último contato: ok até 30 min, atrasada até 24 h, depois sem sinal. */
export function situacaoMaquina(m: { revogado_em: string | null; pareado_em: string | null; ultimo_contato_em: string | null }, agora = Date.now()): SituacaoMaquina {
  if (m.revogado_em) return 'revogada';
  if (!m.pareado_em || !m.ultimo_contato_em) return 'aguardando';
  const min = (agora - Date.parse(m.ultimo_contato_em)) / 60000;
  if (min <= 30) return 'ok';
  if (min <= 24 * 60) return 'atrasada';
  return 'sem_sinal';
}

/**
 * Para qual empresa da instalação vai cada XML: emitente (saída), destinatário (entrada) ou, num evento,
 * o CNPJ da chave (cancelamento da própria nota). XML ilegível volta como rejeitado; de outro CNPJ, "fora da instalação".
 */
export function separarPorEmpresa(arquivos: ArquivoZip[], empresas: EmpresaColetor[]) {
  const porCnpj = new Map(empresas.map((e) => [e.cnpj, e]));
  const grupos = new Map<string, { empresa: EmpresaColetor; arquivos: ArquivoZip[] }>();
  const resultados: ResultadoColetor[] = [];
  const por = (e: EmpresaColetor, a: ArquivoZip) => { const g = grupos.get(e.id) ?? { empresa: e, arquivos: [] }; g.arquivos.push(a); grupos.set(e.id, g); };
  for (const a of arquivos) {
    let emit: string | undefined; let dest: string[] = []; let chave: string | undefined; let evento = false;
    try {
      const p = prepararXml(decodificarXml(a.conteudo));
      emit = p.emit; dest = (p.dest ?? '').split(',').filter(Boolean); chave = p.chave; evento = p.evento;
    } catch (e) {
      if (e instanceof RejeitadaSefaz) { emit = e.nota.emit; chave = e.nota.chave; } else {
        resultados.push({ arquivo: a.nome, situacao: 'rejeitada', motivo: (e as Error).message.slice(0, 300) });
        continue;
      }
    }
    const alvo = (emit && porCnpj.get(emit)) || dest.map((d) => porCnpj.get(d)).find(Boolean) || (evento && chave ? porCnpj.get(chave.slice(6, 20)) : undefined);
    if (alvo) por(alvo, a);
    else resultados.push({ arquivo: a.nome, situacao: 'fora_da_instalacao', chave, motivo: `CNPJ ${emit ?? '?'} não faz parte desta instalação.` });
  }
  return { grupos: [...grupos.values()], resultados };
}

export type ResultadoColetor = Pick<ResultadoArquivo, 'arquivo' | 'chave' | 'motivo'> & { situacao: ResultadoArquivo['situacao'] | 'fora_da_instalacao'; empresa?: string };

export class ServicoColetor {
  private cache = new Map<string, { ctx: ContextoColetor; ate: number }>();
  private ritmo = new Map<string, { n: number; desde: number }>();

  constructor(private readonly db: Db, private readonly arm: Armazenamento) {}

  /* ---------- painel ---------- */

  async listar(agora = Date.now()) {
    const inst = ok(await this.db.from('coletor_instalacoes').select('*').order('nome').limit(2000), 'instalações') as any[];
    if (!inst.length) return { instalacoes: [] };
    const ids = inst.map((i) => i.id);
    const vinc = ok(await this.db.from('coletor_instalacao_empresas').select('instalacao_id,empresa_id').in('instalacao_id', ids), 'empresas da instalação') as { instalacao_id: string; empresa_id: string }[];
    const empIds = [...new Set(vinc.map((v) => v.empresa_id))];
    const emps = empIds.length ? ok(await this.db.from('empresas').select('id,cnpj,razao_social').in('id', empIds), 'empresas') as { id: string; cnpj: string; razao_social: string }[] : [];
    const maqs = ok(await this.db.from('coletor_maquinas').select('id,instalacao_id,nome,token_prefixo,criado_em,criado_por,revogado_em,pareado_em,ultimo_contato_em,ultimo_envio_em,versao,hostname,sistema,pastas,pendentes,enviados_total,ultimo_erro')
      .in('instalacao_id', ids).order('criado_em'), 'máquinas') as any[];
    const desde = new Date(agora - 86400000).toISOString();
    const envios = maqs.length ? ok(await this.db.from('coletor_envios').select('maquina_id,importadas,completou_resumo,arquivos,rejeitadas,fora_da_instalacao,erro')
      .in('maquina_id', maqs.map((m) => m.id)).gte('recebido_em', desde).limit(20000), 'envios') as any[] : [];
    const porMaq = new Map<string, { arquivos: number; novas: number; rejeitadas: number; foraDaInstalacao: number; falhas: number }>();
    for (const e of envios) {
      const x = porMaq.get(e.maquina_id) ?? { arquivos: 0, novas: 0, rejeitadas: 0, foraDaInstalacao: 0, falhas: 0 };
      x.arquivos += e.arquivos; x.novas += e.importadas + e.completou_resumo; x.rejeitadas += e.rejeitadas; x.foraDaInstalacao += e.fora_da_instalacao; if (e.erro) x.falhas++;
      porMaq.set(e.maquina_id, x);
    }
    const porEmp = new Map(emps.map((e) => [e.id, e]));
    return {
      instalacoes: inst.map((i) => ({
        id: i.id, nome: i.nome, observacao: i.observacao, ativo: i.ativo !== false, criadoEm: i.criado_em, criadoPor: i.criado_por,
        empresas: vinc.filter((v) => v.instalacao_id === i.id).map((v) => porEmp.get(v.empresa_id)).filter(Boolean)
          .map((e) => ({ id: e!.id, cnpj: e!.cnpj, razaoSocial: e!.razao_social })).sort((a, b) => a.cnpj.localeCompare(b.cnpj)),
        maquinas: maqs.filter((m) => m.instalacao_id === i.id).map((m) => ({
          id: m.id, nome: m.nome, prefixo: m.token_prefixo, criadoEm: m.criado_em, criadoPor: m.criado_por, revogadoEm: m.revogado_em,
          pareadoEm: m.pareado_em, ultimoContatoEm: m.ultimo_contato_em, ultimoEnvioEm: m.ultimo_envio_em, versao: m.versao, hostname: m.hostname, sistema: m.sistema,
          pastas: m.pastas ?? [], pendentes: m.pendentes, enviadosTotal: Number(m.enviados_total ?? 0), ultimoErro: m.ultimo_erro,
          situacao: i.ativo !== false ? situacaoMaquina(m, agora) : 'revogada' as SituacaoMaquina,
          ultimas24h: porMaq.get(m.id) ?? { arquivos: 0, novas: 0, rejeitadas: 0, foraDaInstalacao: 0, falhas: 0 },
        })),
      })),
    };
  }

  private async validarEmpresas(lista: unknown): Promise<string[]> {
    const ids = [...new Set((Array.isArray(lista) ? lista : []).map(String))];
    if (!ids.length) throw new ErroColetor(400, 'Escolha pelo menos um CNPJ para a instalação.');
    if (ids.length > 200) throw new ErroColetor(400, 'No máximo 200 CNPJs por instalação.');
    const achadas = ok(await this.db.from('empresas').select('id').in('id', ids), 'empresas') as { id: string }[];
    if (achadas.length !== ids.length) throw new ErroColetor(400, 'Alguma das empresas escolhidas não existe mais. Recarregue a página.');
    return ids;
  }

  private nomesMaquinas(c: { maquinas?: unknown; quantidade?: unknown }): string[] {
    let nomes = Array.isArray(c.maquinas) ? c.maquinas.map((x) => String(x ?? '').trim()).filter(Boolean) : [];
    if (!nomes.length) {
      const n = Math.floor(Number(c.quantidade ?? 1));
      if (!Number.isFinite(n) || n < 1 || n > MAX_MAQUINAS) throw new ErroColetor(400, `Quantidade de máquinas entre 1 e ${MAX_MAQUINAS}.`);
      nomes = Array.from({ length: n }, (_, i) => (n === 1 ? 'Servidor de notas' : `Máquina ${i + 1}`));
    }
    if (nomes.length > MAX_MAQUINAS) throw new ErroColetor(400, `No máximo ${MAX_MAQUINAS} máquinas por vez.`);
    return nomes.map((n) => n.slice(0, 80));
  }

  private async gerarMaquinas(instalacaoId: string, nomes: string[], email: string) {
    const novos = nomes.map((nome) => ({ nome, ...novoToken() }));
    const linhas = ok(await this.db.from('coletor_maquinas').insert(novos.map((m) => ({ instalacao_id: instalacaoId, nome: m.nome, token_hash: m.hash, token_prefixo: m.prefixo, criado_por: email })))
      .select('id,nome'), 'criar máquinas') as { id: string; nome: string }[];
    // O token aparece só nesta resposta: depois disso o Appura guarda apenas o hash
    return linhas.map((l, i) => ({ id: l.id, nome: l.nome, token: novos[i].token }));
  }

  async criarInstalacao(c: any, email: string) {
    const nome = String(c?.nome ?? '').trim();
    if (nome.length < 2) throw new ErroColetor(400, 'Dê um nome para a instalação (ex.: o nome do cliente ou do grupo).');
    const empresas = await this.validarEmpresas(c?.empresas);
    const nomes = this.nomesMaquinas(c ?? {});
    const inst = ok(await this.db.from('coletor_instalacoes').insert({ nome: nome.slice(0, 120), observacao: String(c?.observacao ?? '').slice(0, 500) || null, criado_por: email })
      .select('id').single(), 'criar instalação') as { id: string };
    ok(await this.db.from('coletor_instalacao_empresas').insert(empresas.map((empresa_id) => ({ instalacao_id: inst.id, empresa_id }))), 'empresas da instalação');
    const maquinas = await this.gerarMaquinas(inst.id, nomes, email);
    log.info('coletor: instalação criada', { instalacao: inst.id, empresas: empresas.length, maquinas: maquinas.length, por: email });
    return { id: inst.id, maquinas };
  }

  async editarInstalacao(id: string, c: any, email: string) {
    const atual = ok(await this.db.from('coletor_instalacoes').select('id').eq('id', id).maybeSingle(), 'instalação');
    if (!atual) throw new ErroColetor(404, 'Instalação não encontrada.');
    const mud: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
    if (c?.nome !== undefined) { const n = String(c.nome).trim(); if (n.length < 2) throw new ErroColetor(400, 'Nome curto demais.'); mud.nome = n.slice(0, 120); }
    if (c?.observacao !== undefined) mud.observacao = String(c.observacao ?? '').slice(0, 500) || null;
    if (c?.ativo !== undefined) mud.ativo = !!c.ativo;
    ok(await this.db.from('coletor_instalacoes').update(mud).eq('id', id), 'editar instalação');
    if (c?.empresas !== undefined) {
      const ids = await this.validarEmpresas(c.empresas);
      ok(await this.db.from('coletor_instalacao_empresas').delete().eq('instalacao_id', id), 'trocar empresas');
      ok(await this.db.from('coletor_instalacao_empresas').insert(ids.map((empresa_id) => ({ instalacao_id: id, empresa_id }))), 'trocar empresas');
    }
    this.cache.clear();
    log.info('coletor: instalação editada', { instalacao: id, campos: Object.keys(c ?? {}), por: email });
    return { ok: true };
  }

  async adicionarMaquinas(instalacaoId: string, c: any, email: string) {
    const inst = ok(await this.db.from('coletor_instalacoes').select('id,ativo').eq('id', instalacaoId).maybeSingle(), 'instalação') as { id: string; ativo: boolean } | null;
    if (!inst) throw new ErroColetor(404, 'Instalação não encontrada.');
    if (inst.ativo === false) throw new ErroColetor(409, 'A instalação está desativada. Reative antes de gerar tokens.');
    const maquinas = await this.gerarMaquinas(instalacaoId, this.nomesMaquinas(c ?? {}), email);
    log.info('coletor: máquinas adicionadas', { instalacao: instalacaoId, maquinas: maquinas.length, por: email });
    return { maquinas };
  }

  async revogarMaquina(id: string, email: string) {
    const m = ok(await this.db.from('coletor_maquinas').select('id,revogado_em').eq('id', id).maybeSingle(), 'máquina') as { id: string; revogado_em: string | null } | null;
    if (!m) throw new ErroColetor(404, 'Máquina não encontrada.');
    if (!m.revogado_em) ok(await this.db.from('coletor_maquinas').update({ revogado_em: new Date().toISOString(), revogado_por: email }).eq('id', id), 'revogar');
    this.cache.clear();
    log.info('coletor: token revogado', { maquina: id, por: email });
    return { ok: true };
  }

  /* ---------- API do coletor ---------- */

  async autenticar(cabecalho: string | undefined): Promise<ContextoColetor> {
    const token = String(cabecalho ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!/^apc_[A-Za-z0-9_-]{43}$/.test(token)) throw new ErroColetor(401, 'Token do coletor inválido.');
    const h = hash(token);
    const c = this.cache.get(h);
    if (c && c.ate > Date.now()) return c.ctx;
    const m = ok(await this.db.from('coletor_maquinas').select('id,nome,instalacao_id,revogado_em').eq('token_hash', h).maybeSingle(), 'token') as
      { id: string; nome: string; instalacao_id: string; revogado_em: string | null } | null;
    if (!m) throw new ErroColetor(401, 'Token do coletor inválido.');
    if (m.revogado_em) throw new ErroColetor(401, 'Este token foi revogado no Appura. Gere um novo para esta máquina.');
    const inst = ok(await this.db.from('coletor_instalacoes').select('id,nome,ativo').eq('id', m.instalacao_id).single(), 'instalação') as { id: string; nome: string; ativo: boolean };
    if (inst.ativo === false) throw new ErroColetor(403, 'A instalação deste coletor está desativada no Appura.');
    const vinc = ok(await this.db.from('coletor_instalacao_empresas').select('empresa_id').eq('instalacao_id', inst.id), 'empresas') as { empresa_id: string }[];
    const empresas = vinc.length ? ok(await this.db.from('empresas').select('id,cnpj,c_uf,razao_social').in('id', vinc.map((v) => v.empresa_id)), 'empresas') as EmpresaColetor[] : [];
    const ctx = { maquinaId: m.id, maquinaNome: m.nome, instalacaoId: inst.id, instalacaoNome: inst.nome, empresas };
    this.cache.set(h, { ctx, ate: Date.now() + 60_000 });
    return ctx;
  }

  /** Até 120 chamadas por minuto por máquina (o coletor manda bem menos; isto só protege de um laço com defeito). */
  limitar(ctx: ContextoColetor) {
    const agora = Date.now();
    const r = this.ritmo.get(ctx.maquinaId);
    if (!r || agora - r.desde > 60_000) { this.ritmo.set(ctx.maquinaId, { n: 1, desde: agora }); return; }
    if (++r.n > 120) throw new ErroColetor(429, 'Muitas chamadas seguidas. Aguarde um minuto.');
  }

  async configuracao(ctx: ContextoColetor) {
    const agora = new Date().toISOString();
    ok(await this.db.from('coletor_maquinas').update({ ultimo_contato_em: agora }).eq('id', ctx.maquinaId), 'contato');
    ok(await this.db.from('coletor_maquinas').update({ pareado_em: agora }).eq('id', ctx.maquinaId).is('pareado_em', null), 'pareamento');
    return {
      versaoApi: VERSAO_API, maquina: { id: ctx.maquinaId, nome: ctx.maquinaNome }, instalacao: { id: ctx.instalacaoId, nome: ctx.instalacaoNome },
      empresas: ctx.empresas.map((e) => ({ cnpj: e.cnpj, razaoSocial: e.razao_social })).sort((a, b) => a.cnpj.localeCompare(b.cnpj)),
      limites: { arquivosPorLote: LOTE_MAX_ARQUIVOS, bytesPorLote: LOTE_MAX_BYTES, chavesPorConsulta: EXISTENTES_MAX },
      intervaloSinalSeg: 300,
    };
  }

  /** Das chaves informadas, quais o Appura já tem completas (ou já guardou como rejeitadas): o coletor não precisa mandar. */
  async existentes(ctx: ContextoColetor, corpo: any) {
    const chaves = [...new Set((Array.isArray(corpo?.chaves) ? corpo.chaves : []).map((c: unknown) => String(c ?? '')).filter((c: string) => /^\d{44}$/.test(c)))] as string[];
    if (chaves.length > EXISTENTES_MAX) throw new ErroColetor(413, `No máximo ${EXISTENTES_MAX} chaves por consulta.`);
    // Conta como sinal de vida: na primeira carga o coletor passa muito tempo só perguntando o que já existe
    await this.db.from('coletor_maquinas').update({ ultimo_contato_em: new Date().toISOString() }).eq('id', ctx.maquinaId);
    const ids = ctx.empresas.map((e) => e.id);
    const tem = new Set<string>();
    if (ids.length && chaves.length) {
      for (let i = 0; i < chaves.length; i += 200) {
        const parte = chaves.slice(i, i + 200);
        const docs = ok(await this.db.from('documentos').select('chave').in('empresa_id', ids).in('chave', parte).eq('completo', true), 'existentes') as { chave: string }[];
        const rej = ok(await this.db.from('notas_rejeitadas').select('chave').in('empresa_id', ids).in('chave', parte), 'rejeitadas') as { chave: string }[];
        for (const d of [...docs, ...rej]) tem.add(d.chave);
      }
    }
    return { existentes: chaves.filter((c) => tem.has(c)) };
  }

  /** Recebe um lote (ZIP ou XML solto), separa por empresa e grava pela importação existente. */
  async receber(ctx: ContextoColetor, nome: string, corpo: Buffer) {
    const inicio = Date.now();
    let arquivos: ArquivoZip[];
    try { arquivos = abrirEnvio(nome, corpo); } catch (e) { throw new ErroColetor(422, `Lote ilegível: ${(e as Error).message}`); }
    if (arquivos.length > LOTE_MAX_ARQUIVOS) throw new ErroColetor(413, `No máximo ${LOTE_MAX_ARQUIVOS} arquivos por lote.`);
    const { grupos, resultados } = separarPorEmpresa(arquivos, ctx.empresas);
    let erro: string | null = null;
    try {
      for (const g of grupos) {
        const r = await importarXmls(this.db, this.arm, { id: g.empresa.id, cnpj: g.empresa.cnpj, c_uf: g.empresa.c_uf }, g.arquivos);
        for (const x of r.resultados) resultados.push({ arquivo: x.arquivo, situacao: x.situacao, chave: x.chave, motivo: x.motivo, empresa: g.empresa.cnpj });
      }
    } catch (e) { erro = (e as Error).message.slice(0, 500); }
    const conta = (s: ResultadoColetor['situacao']) => resultados.filter((r) => r.situacao === s).length;
    const resumo = {
      arquivos: arquivos.length, importadas: conta('importada'), completouResumo: conta('completou_resumo'), jaExistiam: conta('ja_existia'),
      rejeitadas: conta('rejeitada'), rejeitadasSefaz: conta('rejeitada_sefaz'), foraDaInstalacao: conta('fora_da_instalacao'),
    };
    const motivos = agruparMotivos(resultados.filter((r) => r.situacao === 'rejeitada') as ResultadoArquivo[]);
    const agora = new Date().toISOString();
    const { error } = await this.db.from('coletor_envios').insert({
      maquina_id: ctx.maquinaId, recebido_em: agora, arquivos: resumo.arquivos, importadas: resumo.importadas, completou_resumo: resumo.completouResumo, ja_existiam: resumo.jaExistiam,
      rejeitadas: resumo.rejeitadas, rejeitadas_sefaz: resumo.rejeitadasSefaz, fora_da_instalacao: resumo.foraDaInstalacao, bytes: corpo.length,
      duracao_ms: Date.now() - inicio, motivos: motivos.length ? motivos : null, erro,
    });
    if (error) log.warn('coletor: envio sem registro', { erro: error.message });
    const { data: m } = await this.db.from('coletor_maquinas').select('enviados_total').eq('id', ctx.maquinaId).maybeSingle();
    await this.db.from('coletor_maquinas').update({
      ultimo_contato_em: agora, ultimo_envio_em: agora, enviados_total: Number((m as any)?.enviados_total ?? 0) + resumo.importadas + resumo.completouResumo,
      ...(erro ? { ultimo_erro: erro } : {}),
    }).eq('id', ctx.maquinaId);
    log.info('coletor: lote recebido', { maquina: ctx.maquinaId, instalacao: ctx.instalacaoNome, ...resumo, erro, duracao_ms: Date.now() - inicio });
    // Falha ao gravar (banco/armazenamento fora): o coletor deve reenviar o lote inteiro depois (a chave evita duplicar)
    if (erro) throw new ErroColetor(503, 'O Appura não conseguiu gravar este lote agora. Tente de novo em alguns minutos.');
    return { ...resumo, resultados };
  }

  /** Sinal de vida: versão, pastas acompanhadas, pendentes e último erro do coletor. */
  async sinal(ctx: ContextoColetor, c: any) {
    const texto = (v: unknown, n: number) => (v == null || v === '' ? null : String(v).slice(0, n));
    const pastas = (Array.isArray(c?.pastas) ? c.pastas : []).slice(0, 20).map((p: any) => ({
      caminho: String(p?.caminho ?? '').slice(0, 400), tipo: texto(p?.tipo, 20), arquivos: Number.isFinite(Number(p?.arquivos)) ? Number(p.arquivos) : null,
      ultimoArquivoEm: texto(p?.ultimoArquivoEm, 40), ok: p?.ok !== false,
    })).filter((p: any) => p.caminho);
    const pend = Number(c?.pendentes);
    ok(await this.db.from('coletor_maquinas').update({
      ultimo_contato_em: new Date().toISOString(), versao: texto(c?.versao, 40), hostname: texto(c?.hostname, 120), sistema: texto(c?.sistema, 120),
      pastas, pendentes: Number.isFinite(pend) && pend >= 0 ? Math.floor(pend) : null, ultimo_erro: texto(c?.erro, 500),
    }).eq('id', ctx.maquinaId), 'sinal');
    return { ok: true, empresas: ctx.empresas.map((e) => limpaCnpj(e.cnpj)) };
  }
}
