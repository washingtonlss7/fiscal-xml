/**
 * Ferramentas de AÇÃO do MCP do Appura (fase 2). Só existem quando a conexão tem o escopo appura.acoes
 * e o perfil do usuário pode operar.
 *
 * Toda ação é em duas etapas:
 *   1. chamada sem `confirmacao`  → devolve a prévia (o que vai acontecer, item a item) e um código;
 *   2. chamada com `confirmacao`  → executa exatamente o que a prévia mostrou.
 * O código é um HMAC do usuário + ferramenta + alvo já resolvido (ids, lista de itens, texto), vale 10 minutos
 * e só pode ser usado uma vez. Se o alvo mudar entre a prévia e a execução (nova divergência, guia enviada
 * pelo painel...), o código não confere e a IA precisa pedir nova prévia.
 */
import crypto from 'crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Db, ok } from '../db';
import type { ServicoSped } from '../painel/sped';
import type { ServicoGuias } from '../painel/guias';
import { TIPOS_DOCUMENTO, type ServicoAcessorias } from '../integra/acessorias';
import { resolverApontamento } from '../painel/apontamentos';

export const VALIDADE_CONFIRMACAO_MS = 10 * 60_000;
export const MAX_ITENS_ACAO = 500;

/** Serializa com as chaves em ordem: o mesmo alvo gera sempre o mesmo texto. */
export function canonico(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonico((v as any)[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

/** Códigos de confirmação: sem estado no banco, uso único na memória do processo. */
export class Confirmacoes {
  private usados = new Map<string, number>();
  private chave: Buffer;
  constructor(segredo: string, private agora: () => number = Date.now) {
    this.chave = crypto.createHash('sha256').update(`appura-mcp-confirmacao|${segredo}`).digest();
  }

  private assinar(email: string, ferramenta: string, alvo: unknown, exp: number): string {
    return crypto.createHmac('sha256', this.chave).update(`${email}|${ferramenta}|${canonico(alvo)}|${exp}`).digest('base64url').slice(0, 22);
  }

  emitir(email: string, ferramenta: string, alvo: unknown): { codigo: string; expiraEm: string } {
    const exp = this.agora() + VALIDADE_CONFIRMACAO_MS;
    return { codigo: `${exp.toString(36)}.${this.assinar(email, ferramenta, alvo, exp)}`, expiraEm: new Date(exp).toISOString() };
  }

  /** Confere e consome o código. Devolve o motivo quando não vale. */
  consumir(codigo: string, email: string, ferramenta: string, alvo: unknown): { ok: true } | { ok: false; motivo: string } {
    const m = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{22})$/.exec(String(codigo || '').trim());
    if (!m) return { ok: false, motivo: 'Código de confirmação inválido.' };
    const exp = parseInt(m[1], 36);
    const agora = this.agora();
    for (const [c, e] of this.usados) if (e < agora) this.usados.delete(c);
    if (!Number.isFinite(exp) || exp < agora) return { ok: false, motivo: 'O código de confirmação venceu (vale 10 minutos).' };
    const esperado = this.assinar(email, ferramenta, alvo, exp);
    if (!crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(m[2].padEnd(esperado.length).slice(0, esperado.length)))) {
      return { ok: false, motivo: 'O código não confere com esta ação: os argumentos mudaram ou a situação no Appura mudou desde a prévia.' };
    }
    if (this.usados.has(codigo)) return { ok: false, motivo: 'Este código de confirmação já foi usado.' };
    this.usados.set(codigo, exp);
    return { ok: true };
  }
}

export class ErroAcao extends Error {}

export interface DepsAcoes { db: Db; sped: ServicoSped; guias: ServicoGuias; acessorias: ServicoAcessorias; confirmacoes: Confirmacoes }
type Empresa = { id: string; cnpj: string; razao_social: string; regime: string | null; uf: string };
interface Ajudantes {
  email: string;
  resolverEmpresa: (termo: string) => Promise<Empresa>;
  competencia: (c?: string) => string;
  envolver: <A>(nome: string, fn: (a: A) => Promise<unknown>) => (a: A) => Promise<any>;
  cnpjFmt: (c: string) => string;
  /** Empresas do escopo do usuário (undefined = todas). */
  escopo?: string[];
}

const INSTRUCAO = 'NADA foi alterado ainda. Mostre este resumo ao usuário e peça confirmação explícita. Só se ele confirmar, chame esta ferramenta de novo com os MESMOS argumentos e confirmacao igual ao código abaixo (vale 10 minutos, uma vez).';
const confirmacaoSchema = z.string().max(40).optional().describe('Deixe vazio na primeira chamada (prévia). Depois que o usuário confirmar, informe o código devolvido pela prévia.');
const ARQUIVO = z.enum(['sped_fiscal', 'sped_contribuicoes', 'sintegra']).describe('sped_fiscal = XML × SPED Fiscal; sped_contribuicoes = SPED Fiscal × Contribuições; sintegra = XML × SINTEGRA.');
const TIPO_ARQ: Record<string, string> = { sped_fiscal: 'efd_icms_ipi', sped_contribuicoes: 'efd_contribuicoes', sintegra: 'sintegra' };
const MODELO: Record<string, string> = { '55': 'NF-e', '65': 'NFC-e', '57': 'CT-e' };

/** Mensagens das camadas de serviço que já são para o usuário. */
export function mensagemDeServico(e: unknown): string | null {
  const n = (e as Error)?.constructor?.name;
  return ['ErroAcao', 'ErroSped', 'ErroIntegra', 'ErroAcessorias', 'ErroFerramenta', 'ErroApontamento'].includes(n) ? (e as Error).message : null;
}

export function registrarAcoes(server: McpServer, deps: DepsAcoes, aj: Ajudantes) {
  const { email } = aj;
  const acao = { readOnlyHint: false, destructiveHint: false, idempotentHint: true };

  /** Prévia ou execução, conforme o código. */
  async function duasEtapas<T>(ferramenta: string, confirmacao: string | undefined, alvo: unknown, previa: () => T, executar: () => Promise<unknown>) {
    if (!confirmacao) {
      const c = deps.confirmacoes.emitir(email, ferramenta, alvo);
      return { etapa: 'previa', ...previa(), instrucao: INSTRUCAO, confirmacao: c.codigo, confirmacao_vence_em: c.expiraEm };
    }
    const v = deps.confirmacoes.consumir(confirmacao, email, ferramenta, alvo);
    if (!v.ok) throw new ErroAcao(`${v.motivo} Chame de novo sem o campo confirmacao para gerar uma prévia atualizada.`);
    return { etapa: 'executada', ...(await executar() as object) };
  }

  /* ---------- divergências do SPED/SINTEGRA ---------- */

  async function selecionar(a: { empresa: string; competencia?: string; arquivo: string; tipos?: string[]; chaves?: string[]; todas?: boolean }, justificadas: boolean) {
    if (!a.todas && !(a.tipos && a.tipos.length) && !(a.chaves && a.chaves.length)) {
      throw new ErroAcao(`Diga quais divergências: informe tipos, chaves (ou números das notas) ou ${justificadas ? 'todas_justificadas' : 'todas_abertas'}=true.`);
    }
    const emp = await aj.resolverEmpresa(a.empresa);
    const comp = aj.competencia(a.competencia);
    const arq = await deps.sped.vigente(emp.id, `${comp}-01`, TIPO_ARQ[a.arquivo]);
    if (!arq) throw new ErroAcao(`Nenhum arquivo ${a.arquivo} enviado para ${emp.razao_social} em ${comp}.`);
    if (!arq.comparacao) throw new ErroAcao('Este arquivo não tem comparação guardada.');
    const tipos = new Set((a.tipos ?? []).map((t) => t.trim()));
    const chaves = new Set((a.chaves ?? []).map((c) => c.replace(/\D/g, '')).filter(Boolean));
    const lista = ((arq.comparacao.divergencias ?? []) as any[])
      .filter((d) => (justificadas ? !!d.justificativa : !d.justificativa))
      .filter((d) => !tipos.size || tipos.has(d.tipo))
      .filter((d) => !chaves.size || chaves.has(String(d.chave ?? '')) || (d.numero != null && chaves.has(String(d.numero))));
    if (!lista.length) throw new ErroAcao(`Nenhuma divergência ${justificadas ? 'justificada' : 'em aberto'} com esses filtros. Use appura_divergencias para ver os tipos e chaves.`);
    if (lista.length > MAX_ITENS_ACAO) throw new ErroAcao(`São ${lista.length} divergências: o limite por ação é ${MAX_ITENS_ACAO}. Filtre por tipo ou chave.`);
    return { emp, comp, arq, lista };
  }
  const descrever = (d: any) => ({
    tipo: d.tipo, nivel: d.nivel, documento: `${MODELO[d.modelo] ?? d.modelo ?? ''} ${d.numero ?? ''}`.trim(), chave: /^\d{44}$/.test(d.chave) ? d.chave : undefined,
    participante: d.participante || undefined, detalhe: d.detalhe, justificativa_atual: d.justificativa ? d.justificativa.observacao : undefined,
  });

  server.registerTool('appura_justificar_divergencias', {
    title: 'Justificar divergências',
    description: 'Justifica divergências em aberto da comparação SPED/SINTEGRA (a mesma ação do botão "Justificar" do painel). A divergência continua visível, com a justificativa, quem justificou e quando; pode ser reaberta. Em duas etapas: primeiro devolve a prévia e um código; só executa quando chamada de novo com o código, depois de o usuário confirmar.',
    inputSchema: {
      empresa: z.string().min(2).max(120).describe('CNPJ, id ou parte da razão social.'),
      competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe('AAAA-MM (padrão: mês atual).'),
      arquivo: ARQUIVO,
      tipos: z.array(z.string().max(60)).max(20).optional().describe('Tipos de divergência (campo "tipo" de appura_divergencias).'),
      chaves: z.array(z.string().max(60)).max(500).optional().describe('Chaves de acesso (44 dígitos) ou números das notas.'),
      todas_abertas: z.boolean().optional().describe('true para todas as divergências em aberto do arquivo (até 500).'),
      observacao: z.string().min(5).max(1000).describe('Justificativa escrita (vai para o histórico com o seu usuário).'),
      confirmacao: confirmacaoSchema,
    },
    annotations: { title: 'Justificar divergências', ...acao, openWorldHint: false },
  }, aj.envolver('appura_justificar_divergencias', async (a: { empresa: string; competencia?: string; arquivo: string; tipos?: string[]; chaves?: string[]; todas_abertas?: boolean; observacao: string; confirmacao?: string }) => {
    const { emp, comp, arq, lista } = await selecionar({ ...a, todas: a.todas_abertas }, false);
    const obs = a.observacao.trim();
    const itens = lista.map((d) => ({ tipo: d.tipo, chave: d.chave }));
    return duasEtapas('appura_justificar_divergencias', a.confirmacao, { arquivo: arq.id, itens, obs }, () => ({
      acao: `Justificar ${lista.length} divergência${lista.length === 1 ? '' : 's'} em aberto`,
      empresa: `${emp.razao_social} (${aj.cnpjFmt(emp.cnpj)})`, competencia: comp, arquivo: arq.nome, justificativa: obs,
      divergencias: lista.slice(0, 30).map(descrever), mais: Math.max(0, lista.length - 30),
    }), async () => {
      const r = await deps.sped.justificar(arq, itens, obs, email);
      return { mensagem: `${lista.length} divergência${lista.length === 1 ? '' : 's'} justificada${lista.length === 1 ? '' : 's'}.`, empresa: emp.razao_social, competencia: comp, divergencias_em_aberto_agora: r.divergencias };
    });
  }));

  server.registerTool('appura_reabrir_divergencias', {
    title: 'Reabrir divergências',
    description: 'Tira a justificativa de divergências já justificadas (elas voltam a ficar em aberto e a contar como pendência). Em duas etapas: prévia com código, depois execução com o código, após o usuário confirmar.',
    inputSchema: {
      empresa: z.string().min(2).max(120).describe('CNPJ, id ou parte da razão social.'),
      competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe('AAAA-MM (padrão: mês atual).'),
      arquivo: ARQUIVO,
      tipos: z.array(z.string().max(60)).max(20).optional(),
      chaves: z.array(z.string().max(60)).max(500).optional().describe('Chaves de acesso ou números das notas.'),
      todas_justificadas: z.boolean().optional(),
      confirmacao: confirmacaoSchema,
    },
    annotations: { title: 'Reabrir divergências', ...acao, openWorldHint: false },
  }, aj.envolver('appura_reabrir_divergencias', async (a: { empresa: string; competencia?: string; arquivo: string; tipos?: string[]; chaves?: string[]; todas_justificadas?: boolean; confirmacao?: string }) => {
    const { emp, comp, arq, lista } = await selecionar({ ...a, todas: a.todas_justificadas }, true);
    const itens = lista.map((d) => ({ tipo: d.tipo, chave: d.chave }));
    return duasEtapas('appura_reabrir_divergencias', a.confirmacao, { arquivo: arq.id, itens }, () => ({
      acao: `Reabrir ${lista.length} divergência${lista.length === 1 ? '' : 's'} justificada${lista.length === 1 ? '' : 's'}`,
      empresa: `${emp.razao_social} (${aj.cnpjFmt(emp.cnpj)})`, competencia: comp, arquivo: arq.nome,
      divergencias: lista.slice(0, 30).map(descrever), mais: Math.max(0, lista.length - 30),
    }), async () => {
      const r = await deps.sped.justificar(arq, itens, null, email);
      return { mensagem: `${lista.length} divergência${lista.length === 1 ? '' : 's'} reaberta${lista.length === 1 ? '' : 's'}.`, empresa: emp.razao_social, competencia: comp, divergencias_em_aberto_agora: r.divergencias };
    });
  }));

  /* ---------- procuração no e-CAC ---------- */

  server.registerTool('appura_verificar_procuracao', {
    title: 'Verificar procuração no e-CAC',
    description: 'Consulta no Integra Contador (SERPRO) se cada cliente deu procuração eletrônica ao escritório e grava o resultado no Appura. Cada empresa é uma consulta cobrada pelo SERPRO. Em duas etapas: prévia com código, depois execução com o código, após o usuário confirmar.',
    inputSchema: {
      empresas: z.array(z.string().min(2).max(120)).min(1).max(20).describe('Até 20 empresas: CNPJ, id ou parte da razão social.'),
      confirmacao: confirmacaoSchema,
    },
    annotations: { title: 'Verificar procuração', ...acao, openWorldHint: true },
  }, aj.envolver('appura_verificar_procuracao', async (a: { empresas: string[]; confirmacao?: string }) => {
    const emps: Empresa[] = [];
    for (const t of a.empresas) { const e = await aj.resolverEmpresa(t); if (!emps.some((x) => x.id === e.id)) emps.push(e); }
    const atuais = ok(await deps.db.from('integra_procuracoes').select('empresa_id,situacao,expira_em,verificado_em').in('empresa_id', emps.map((e) => e.id)), 'procurações') as any[];
    const ids = emps.map((e) => e.id).sort();
    return duasEtapas('appura_verificar_procuracao', a.confirmacao, { ids }, () => ({
      acao: `Consultar a procuração de ${emps.length} empresa${emps.length === 1 ? '' : 's'} no Integra Contador`,
      custo: `${emps.length} consulta${emps.length === 1 ? '' : 's'} cobrada${emps.length === 1 ? '' : 's'} pelo SERPRO no contrato do escritório.`,
      empresas: emps.map((e) => {
        const p = atuais.find((x) => x.empresa_id === e.id);
        return { razao_social: e.razao_social, cnpj: aj.cnpjFmt(e.cnpj), situacao_atual: p ? p.situacao : 'não verificada', verificada_em: p ? p.verificado_em : undefined };
      }),
    }), async () => {
      const resultados = [];
      for (const e of emps) {
        try {
          const r = await deps.guias.verificarProcuracao(e.id, email) as any;
          resultados.push({ razao_social: e.razao_social, cnpj: aj.cnpjFmt(e.cnpj), situacao: r.situacao, expira_em: r.expira_em ?? undefined, mensagem: r.mensagem ?? undefined });
        } catch (x) {
          resultados.push({ razao_social: e.razao_social, cnpj: aj.cnpjFmt(e.cnpj), situacao: 'erro', mensagem: mensagemDeServico(x) ?? 'Falha inesperada.' });
          // Sem Integra configurado ou chaves recusadas: as próximas falhariam igual
          if (/configurad|chave|certificado|autentica/i.test((x as Error).message)) break;
        }
      }
      return { resultados, verificadas: resultados.filter((r) => r.situacao !== 'erro').length };
    });
  }));

  /* ---------- envio de guias à Acessórias ---------- */

  server.registerTool('appura_enviar_guias_acessorias', {
    title: 'Enviar guias e documentos à Acessórias',
    description: 'Envia à Acessórias (e-Contínuo) o que a competência tem e ainda não foi aceito: os PDFs das guias DAS já geradas (a mais recente de cada empresa) e os documentos do mês guardados no Appura (recibos do SPED, DARF, DCTFWeb, Reinf, guia de ICMS, recibo e declaração do PGDAS-D). Não gera guia nem documento. Em duas etapas: prévia com código, depois execução com o código, após o usuário confirmar.',
    inputSchema: {
      competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe('AAAA-MM (padrão: mês atual).'),
      empresas: z.array(z.string().min(2).max(120)).max(50).optional().describe('Só estas empresas (CNPJ, id ou nome). Sem isto: todas as pendentes.'),
      o_que: z.enum(['tudo', 'guias', 'documentos']).optional().describe('tudo (padrão), só as guias DAS ou só os documentos do mês.'),
      confirmacao: confirmacaoSchema,
    },
    annotations: { title: 'Enviar à Acessórias', ...acao, openWorldHint: true },
  }, aj.envolver('appura_enviar_guias_acessorias', async (a: { competencia?: string; empresas?: string[]; o_que?: 'tudo' | 'guias' | 'documentos'; confirmacao?: string }) => {
    const comp = aj.competencia(a.competencia);
    const oque = a.o_que ?? 'tudo';
    let filtro: string[] | undefined;
    if (a.empresas && a.empresas.length) { filtro = []; for (const t of a.empresas) filtro.push((await aj.resolverEmpresa(t)).id); }
    else if (aj.escopo) {
      if (!aj.escopo.length) throw new ErroAcao('Nenhuma empresa no seu acesso.');
      filtro = aj.escopo;
    }
    const p = oque === 'documentos' ? { guias: [], jaEnviadas: 0 } : await deps.acessorias.pendentes(comp, filtro);
    const pd = oque === 'guias' ? { documentos: [], jaEnviados: 0 } : await deps.acessorias.documentosPendentes(comp, filtro);
    if (!p.guias.length && !pd.documentos.length) {
      throw new ErroAcao(`Nada de ${comp} para enviar${p.jaEnviadas + pd.jaEnviados ? ` (${p.jaEnviadas + pd.jaEnviados} já enviado${p.jaEnviadas + pd.jaEnviados === 1 ? '' : 's'})` : ''}. Guias sem PDF ou ainda não geradas não entram; documentos entram pela aba Documentos da empresa.`);
    }
    const idsEmp = [...new Set([...p.guias.map((g) => g.empresaId), ...pd.documentos.map((d) => d.empresaId)])];
    const nomes = new Map((ok(await deps.db.from('empresas').select('id,razao_social,cnpj').in('id', idsEmp), 'empresas') as any[]).map((e) => [e.id, e]));
    const nomeEmp = (id: string) => { const e = nomes.get(id); return e ? `${e.razao_social} (${aj.cnpjFmt(e.cnpj)})` : id; };
    const ids = p.guias.map((g) => g.id).sort((x, y) => x - y);
    const idsDoc = pd.documentos.map((d) => d.id).sort((x, y) => x - y);
    const partes = [ids.length ? `${ids.length} guia${ids.length === 1 ? '' : 's'}` : '', idsDoc.length ? `${idsDoc.length} documento${idsDoc.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' e ');
    return duasEtapas('appura_enviar_guias_acessorias', a.confirmacao, { comp, ids, idsDoc }, () => ({
      acao: `Enviar ${partes} de ${comp} à Acessórias`,
      ja_enviados: p.jaEnviadas + pd.jaEnviados,
      guias: p.guias.map((g) => ({ empresa: nomeEmp(g.empresaId), total: g.total != null ? Number(g.total) : undefined, vencimento: g.vencimento ?? undefined })),
      documentos: pd.documentos.map((d) => ({ empresa: nomeEmp(d.empresaId), tipo: TIPOS_DOCUMENTO[d.tipo] ?? d.tipo, arquivo: d.nome })),
    }), async () => {
      const r = ids.length ? await deps.acessorias.enviarLista(ids, email) : [];
      const rd = idsDoc.length ? await deps.acessorias.enviarDocumentos(idsDoc, email) : [];
      const porGuia = new Map(p.guias.map((g) => [g.id, g.empresaId]));
      const porDoc = new Map(pd.documentos.map((d) => [d.id, d]));
      return {
        enviados: r.filter((x) => x.ok).length + rd.filter((x) => x.ok).length, com_erro: r.filter((x) => !x.ok).length + rd.filter((x) => !x.ok).length,
        nao_tentados: ids.length - r.length + idsDoc.length - rd.length,
        resultados: [
          ...r.map((x) => ({ empresa: nomes.get(porGuia.get(x.guiaId)!)?.razao_social ?? String(x.guiaId), documento: 'DAS', ok: x.ok, mensagem: x.mensagem })),
          ...rd.map((x) => { const d = porDoc.get(x.documentoId)!; return { empresa: nomes.get(d.empresaId)?.razao_social ?? d.empresaId, documento: TIPOS_DOCUMENTO[d.tipo] ?? d.tipo, ok: x.ok, mensagem: x.mensagem }; }),
        ],
      };
    });
  }));

  /* ---------- DAS (Integra Contador) ---------- */

  server.registerTool('appura_gerar_das', {
    title: 'Gerar DAS',
    description: 'Gera o DAS do Simples Nacional ou do MEI pelo Integra Contador (SERPRO), grava o PDF no Appura e, se o envio automático estiver ligado, manda à Acessórias. Cada empresa é uma emissão cobrada pelo SERPRO. Não gera de novo quando já existe DAS da competência dentro do vencimento. Em duas etapas: prévia com código, depois execução com o código, após o usuário confirmar.',
    inputSchema: {
      empresas: z.array(z.string().min(2).max(120)).min(1).max(20).describe('Até 20 empresas do Simples ou MEI: CNPJ, id ou parte da razão social.'),
      competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe('Período de apuração AAAA-MM (obrigatório: normalmente o mês anterior).'),
      confirmacao: confirmacaoSchema,
    },
    annotations: { title: 'Gerar DAS', ...acao, idempotentHint: false, openWorldHint: true },
  }, aj.envolver('appura_gerar_das', async (a: { empresas: string[]; competencia: string; confirmacao?: string }) => {
    const comp = a.competencia;
    if (comp > aj.competencia()) throw new ErroAcao('Não dá para gerar DAS de competência futura.');
    const emps: Empresa[] = [];
    for (const t of a.empresas) { const e = await aj.resolverEmpresa(t); if (!emps.some((x) => x.id === e.id)) emps.push(e); }
    const ids = emps.map((e) => e.id);
    const [procs, decls, guias] = await Promise.all([
      deps.db.from('integra_procuracoes').select('empresa_id,situacao').in('empresa_id', ids).then((r: any) => ok(r, 'procurações') as any[]),
      deps.db.from('pgdas_declaracoes').select('empresa_id,situacao').in('empresa_id', ids).eq('competencia', `${comp}-01`).then((r: any) => ok(r, 'declarações') as any[]),
      deps.db.from('guias').select('empresa_id,total,vencimento,gerado_em').in('empresa_id', ids).eq('competencia', `${comp}-01`).order('gerado_em', { ascending: false }).then((r: any) => ok(r, 'guias') as any[]),
    ]);
    const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
    const analise = emps.map((e) => {
      const proc = procs.find((p) => p.empresa_id === e.id);
      const decl = decls.find((d) => d.empresa_id === e.id);
      const guia = guias.find((g) => g.empresa_id === e.id);
      let motivo: string | null = null;
      if (e.regime !== 'simples' && e.regime !== 'mei') motivo = 'Regime sem DAS (DCTFWeb/DARF ainda não estão no Appura).';
      else if (proc && (proc.situacao === 'ausente' || proc.situacao === 'vencida')) motivo = `Procuração ${proc.situacao} no e-CAC.`;
      else if (guia && (!guia.vencimento || guia.vencimento >= hoje)) motivo = `Já tem DAS da competência dentro do vencimento (total ${guia.total}, vence ${guia.vencimento ?? '—'}).`;
      return {
        e, motivo,
        linha: {
          razao_social: e.razao_social, cnpj: aj.cnpjFmt(e.cnpj), regime: e.regime === 'mei' ? 'MEI' : e.regime === 'simples' ? 'Simples Nacional' : (e.regime ?? 'não informado'),
          procuracao: proc ? proc.situacao : 'não verificada',
          declaracao_pgdas: e.regime === 'simples' ? (decl ? decl.situacao : 'não consultada') : undefined,
          vai_gerar: !motivo, motivo: motivo ?? undefined,
        },
      };
    });
    const gerar = analise.filter((x) => !x.motivo).map((x) => x.e);
    if (!gerar.length) throw new ErroAcao(`Nenhuma das empresas pode ter DAS gerado agora: ${analise.map((x) => `${x.e.razao_social}: ${x.motivo}`).join(' ')}`);
    const alvo = { comp, ids: gerar.map((e) => e.id).sort() };
    return duasEtapas('appura_gerar_das', a.confirmacao, alvo, () => ({
      acao: `Gerar o DAS de ${comp} para ${gerar.length} empresa${gerar.length === 1 ? '' : 's'}`,
      custo: `${gerar.length} emiss${gerar.length === 1 ? 'ão cobrada' : 'ões cobradas'} pelo SERPRO no contrato do escritório.`,
      atencao: analise.some((x) => x.linha.declaracao_pgdas && x.linha.declaracao_pgdas !== 'transmitida' && !x.motivo)
        ? 'Há empresa do Simples sem declaração do PGDAS-D confirmada: sem a declaração transmitida o SERPRO não emite o DAS.' : undefined,
      empresas: analise.map((x) => x.linha),
    }), async () => {
      const resultados = [];
      for (const e of gerar) {
        try {
          const r = await deps.guias.gerarDas(e.id, comp, email, false) as any;
          const g = r.guias[0] ?? {};
          resultados.push({ razao_social: e.razao_social, cnpj: aj.cnpjFmt(e.cnpj), ok: true, total: g.total != null ? Number(g.total) : undefined, vencimento: g.vencimento ?? undefined,
            pdf: g.caminho ? 'guardado no Appura' : 'o SERPRO não devolveu o PDF', acessorias: g.envio ? g.envio.status : undefined, avisos: r.avisos?.length ? r.avisos : undefined });
        } catch (x) {
          resultados.push({ razao_social: e.razao_social, cnpj: aj.cnpjFmt(e.cnpj), ok: false, mensagem: mensagemDeServico(x) ?? 'Falha inesperada.' });
          if (/configurad|chave|certificado|autentica/i.test((x as Error).message)) break;
        }
      }
      return { geradas: resultados.filter((r) => r.ok).length, com_erro: resultados.filter((r) => !r.ok).length, nao_tentadas: gerar.length - resultados.length, resultados };
    });
  }));

  /* ---------- apontamentos da auditoria ---------- */

  server.registerTool('appura_tratar_apontamentos', {
    title: 'Tratar apontamentos da auditoria',
    description: 'Trata apontamentos da auditoria das notas, igual aos botões do painel: aplicar_sugestao (grava no item a correção sugerida pela regra, ex.: CST de PIS/COFINS, e marca como ajustado), ignorar (com observação obrigatória) ou reabrir. Escolha por regra e/ou ids (de appura_apontamentos_auditoria). Em duas etapas: prévia com código, depois execução com o código, após o usuário confirmar.',
    inputSchema: {
      empresa: z.string().min(2).max(120).describe('CNPJ, id ou parte da razão social.'),
      competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe('AAAA-MM (padrão: mês atual).'),
      acao: z.enum(['aplicar_sugestao', 'ignorar', 'reabrir']),
      regras: z.array(z.string().max(60)).max(20).optional().describe('Códigos das regras (campo "regra").'),
      ids: z.array(z.number().int().positive()).max(500).optional().describe('Ids dos apontamentos.'),
      observacao: z.string().max(1000).optional().describe('Obrigatória para ignorar (mínimo 5 caracteres).'),
      confirmacao: confirmacaoSchema,
    },
    annotations: { title: 'Tratar apontamentos', ...acao, openWorldHint: false },
  }, aj.envolver('appura_tratar_apontamentos', async (a: { empresa: string; competencia?: string; acao: string; regras?: string[]; ids?: number[]; observacao?: string; confirmacao?: string }) => {
    if (!(a.regras && a.regras.length) && !(a.ids && a.ids.length)) throw new ErroAcao('Diga quais apontamentos: informe regras ou ids (veja em appura_apontamentos_auditoria).');
    const obs = a.observacao?.trim() || null;
    if (a.acao === 'ignorar' && (!obs || obs.length < 5)) throw new ErroAcao('Para ignorar, escreva a observação (pelo menos 5 caracteres): ela fica no histórico.');
    const emp = await aj.resolverEmpresa(a.empresa);
    const comp = aj.competencia(a.competencia);
    let q = deps.db.from('apontamentos').select('*').eq('empresa_id', emp.id).eq('competencia', `${comp}-01`);
    if (a.acao === 'reabrir') q = q.in('status', ['ajustado', 'ignorado']); else q = q.eq('status', 'aberto');
    if (a.regras && a.regras.length) q = q.in('regra', a.regras);
    if (a.ids && a.ids.length) q = q.in('id', a.ids);
    const todos = ok(await q.order('id').limit(MAX_ITENS_ACAO + 1), 'apontamentos') as any[];
    if (todos.length > MAX_ITENS_ACAO) throw new ErroAcao(`Mais de ${MAX_ITENS_ACAO} apontamentos com esses filtros. Filtre por regra ou ids.`);
    const temSugestao = (x: any) => !!(x.sugestao && x.sugestao.campo && x.sugestao.valor != null && x.chave && x.n_item);
    const lista = a.acao === 'aplicar_sugestao' ? todos.filter(temSugestao) : todos;
    const semSugestao = todos.length - lista.length;
    if (!lista.length) {
      throw new ErroAcao(todos.length ? `Nenhum desses ${todos.length} apontamentos tem correção sugerida: trate no painel (ex.: informar o CFOP) ou use ignorar.`
        : `Nenhum apontamento ${a.acao === 'reabrir' ? 'tratado' : 'em aberto'} com esses filtros em ${comp}.`);
    }
    const alvo = { acao: a.acao, ids: lista.map((x) => x.id), obs };
    const verbo = { aplicar_sugestao: 'Aplicar a correção sugerida em', ignorar: 'Ignorar', reabrir: 'Reabrir' }[a.acao]!;
    return duasEtapas('appura_tratar_apontamentos', a.confirmacao, alvo, () => ({
      acao: `${verbo} ${lista.length} apontamento${lista.length === 1 ? '' : 's'}`,
      empresa: `${emp.razao_social} (${aj.cnpjFmt(emp.cnpj)})`, competencia: comp, observacao: obs ?? undefined,
      sem_sugestao_fora_da_acao: semSugestao || undefined,
      apontamentos: lista.slice(0, 30).map((x) => ({
        id: x.id, regra: x.regra, severidade: x.severidade, mensagem: x.mensagem, chave: x.chave ?? undefined, item: x.n_item ?? undefined, status_atual: x.status,
        correcao: a.acao === 'aplicar_sugestao' ? `${x.sugestao.campo} → ${x.sugestao.valor}` : undefined,
      })),
      mais: Math.max(0, lista.length - 30),
    }), async () => {
      const acaoPainel = { aplicar_sugestao: 'resolver', ignorar: 'ignorar', reabrir: 'reabrir' }[a.acao]!;
      let feitos = 0; const erros: string[] = [];
      for (const x of lista) {
        try { await resolverApontamento(deps.db, x, acaoPainel, obs, null, email); feitos++; } catch (e) { erros.push(`#${x.id}: ${mensagemDeServico(e) ?? 'falha inesperada'}`); }
      }
      return { mensagem: `${feitos} apontamento${feitos === 1 ? '' : 's'} tratado${feitos === 1 ? '' : 's'}.`, tratados: feitos, erros: erros.length ? erros.slice(0, 20) : undefined };
    });
  }));
}
