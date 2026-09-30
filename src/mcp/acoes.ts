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
import type { ServicoAcessorias } from '../integra/acessorias';

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
}

const INSTRUCAO = 'NADA foi alterado ainda. Mostre este resumo ao usuário e peça confirmação explícita. Só se ele confirmar, chame esta ferramenta de novo com os MESMOS argumentos e confirmacao igual ao código abaixo (vale 10 minutos, uma vez).';
const confirmacaoSchema = z.string().max(40).optional().describe('Deixe vazio na primeira chamada (prévia). Depois que o usuário confirmar, informe o código devolvido pela prévia.');
const ARQUIVO = z.enum(['sped_fiscal', 'sped_contribuicoes', 'sintegra']).describe('sped_fiscal = XML × SPED Fiscal; sped_contribuicoes = SPED Fiscal × Contribuições; sintegra = XML × SINTEGRA.');
const TIPO_ARQ: Record<string, string> = { sped_fiscal: 'efd_icms_ipi', sped_contribuicoes: 'efd_contribuicoes', sintegra: 'sintegra' };
const MODELO: Record<string, string> = { '55': 'NF-e', '65': 'NFC-e', '57': 'CT-e' };

/** Mensagens das camadas de serviço que já são para o usuário. */
export function mensagemDeServico(e: unknown): string | null {
  const n = (e as Error)?.constructor?.name;
  return ['ErroAcao', 'ErroSped', 'ErroIntegra', 'ErroAcessorias', 'ErroFerramenta'].includes(n) ? (e as Error).message : null;
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
    title: 'Enviar guias à Acessórias',
    description: 'Envia à Acessórias (e-Contínuo) os PDFs das guias DAS já geradas na competência que ainda não foram enviadas (a mais recente de cada empresa). Não gera guia nova. Em duas etapas: prévia com código, depois execução com o código, após o usuário confirmar.',
    inputSchema: {
      competencia: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional().describe('AAAA-MM (padrão: mês atual).'),
      empresas: z.array(z.string().min(2).max(120)).max(50).optional().describe('Só estas empresas (CNPJ, id ou nome). Sem isto: todas as pendentes.'),
      confirmacao: confirmacaoSchema,
    },
    annotations: { title: 'Enviar guias à Acessórias', ...acao, openWorldHint: true },
  }, aj.envolver('appura_enviar_guias_acessorias', async (a: { competencia?: string; empresas?: string[]; confirmacao?: string }) => {
    const comp = aj.competencia(a.competencia);
    let filtro: string[] | undefined;
    if (a.empresas && a.empresas.length) { filtro = []; for (const t of a.empresas) filtro.push((await aj.resolverEmpresa(t)).id); }
    const p = await deps.acessorias.pendentes(comp, filtro);
    if (!p.guias.length) throw new ErroAcao(`Nenhuma guia de ${comp} para enviar${p.jaEnviadas ? ` (${p.jaEnviadas} já enviada${p.jaEnviadas === 1 ? '' : 's'})` : ''}. Guias sem PDF ou ainda não geradas não entram.`);
    const nomes = new Map((ok(await deps.db.from('empresas').select('id,razao_social,cnpj').in('id', [...new Set(p.guias.map((g) => g.empresaId))]), 'empresas') as any[]).map((e) => [e.id, e]));
    const ids = p.guias.map((g) => g.id).sort((x, y) => x - y);
    return duasEtapas('appura_enviar_guias_acessorias', a.confirmacao, { comp, ids }, () => ({
      acao: `Enviar ${ids.length} guia${ids.length === 1 ? '' : 's'} de ${comp} à Acessórias`,
      ja_enviadas: p.jaEnviadas,
      guias: p.guias.map((g) => { const e = nomes.get(g.empresaId); return { empresa: e ? `${e.razao_social} (${aj.cnpjFmt(e.cnpj)})` : g.empresaId, total: g.total != null ? Number(g.total) : undefined, vencimento: g.vencimento ?? undefined }; }),
    }), async () => {
      const r = await deps.acessorias.enviarLista(ids, email);
      const porGuia = new Map(p.guias.map((g) => [g.id, g.empresaId]));
      return {
        enviadas: r.filter((x) => x.ok).length, com_erro: r.filter((x) => !x.ok).length, nao_tentadas: ids.length - r.length,
        resultados: r.map((x) => { const e = nomes.get(porGuia.get(x.guiaId)!); return { empresa: e ? e.razao_social : String(x.guiaId), ok: x.ok, mensagem: x.mensagem }; }),
      };
    });
  }));
}
