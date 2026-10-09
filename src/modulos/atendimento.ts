/** Atendimento: chamados dos clientes (departamento, responsável, prazo, situação) e conversa interna. */
import { Db, ok } from '../db';
import { Escopo, ErroModulo, dataOpcional, empresasDoEscopo, exigirEmpresaNoEscopo, hojeSP, txt } from './comum';

export const DEPARTAMENTOS: Record<string, string> = { fiscal: 'Fiscal', contabil: 'Contábil', folha: 'Folha', societario: 'Societário', financeiro: 'Financeiro', captacao: 'Captação / notas', outro: 'Outro' };
export const PRIORIDADES: Record<string, string> = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' };
export const STATUS_CHAMADO: Record<string, string> = { aberto: 'Aberto', em_andamento: 'Em andamento', aguardando_cliente: 'Aguardando cliente', resolvido: 'Resolvido', fechado: 'Fechado' };
export const CANAIS: Record<string, string> = { telefone: 'Telefone', whatsapp: 'WhatsApp', email: 'E-mail', presencial: 'Presencial', outro: 'Outro' };
const ATIVOS = ['aberto', 'em_andamento', 'aguardando_cliente'];

export function atrasado(c: { status: string; prazo: string | null }, hoje = hojeSP()) {
  return ATIVOS.includes(c.status) && !!c.prazo && c.prazo < hoje;
}

export class ServicoAtendimento {
  constructor(private readonly db: Db) {}

  async listar(escopo: Escopo, f: { status?: string | null; departamento?: string | null; responsavel?: string | null; empresa?: string | null; busca?: string | null }) {
    let q = this.db.from('atd_chamados').select('*').order('atualizado_em', { ascending: false }).limit(2000);
    if (f.status === 'ativos') q = q.in('status', ATIVOS); else if (f.status && STATUS_CHAMADO[f.status]) q = q.eq('status', f.status);
    if (f.departamento && DEPARTAMENTOS[f.departamento]) q = q.eq('departamento', f.departamento);
    if (f.responsavel === '__sem') q = q.is('responsavel', null); else if (f.responsavel) q = q.eq('responsavel', f.responsavel);
    if (f.empresa) q = q.eq('empresa_id', f.empresa);
    if (f.busca) q = q.ilike('assunto', `%${f.busca.replace(/[%_]/g, ' ')}%`);
    const l = ok(await q, 'chamados') as any[];
    const emps = new Map((await empresasDoEscopo(this.db, escopo)).map((e) => [e.id, e]));
    const hoje = hojeSP();
    return l.filter((c) => (c.empresa_id ? emps.has(c.empresa_id) : true)).map((c) => ({ ...c, empresa: c.empresa_id ? emps.get(c.empresa_id)!.razao_social : null, atrasado: atrasado(c, hoje) }));
  }

  async resumo(escopo: Escopo, eu: string) {
    const ativos = await this.listar(escopo, { status: 'ativos' });
    const porDep: Record<string, number> = {};
    for (const c of ativos) porDep[c.departamento] = (porDep[c.departamento] ?? 0) + 1;
    return { ativos: ativos.length, atrasados: ativos.filter((c) => c.atrasado).length, meus: ativos.filter((c) => c.responsavel === eu).length, semResponsavel: ativos.filter((c) => !c.responsavel).length, porDepartamento: porDep };
  }

  private async chamado(escopo: Escopo, id: number) {
    const c = ok(await this.db.from('atd_chamados').select('*').eq('id', id).maybeSingle(), 'chamado') as any;
    if (!c) throw new ErroModulo(404, 'Chamado não encontrado.');
    if (c.empresa_id) exigirEmpresaNoEscopo(escopo, c.empresa_id);
    return c;
  }

  async detalhe(escopo: Escopo, id: number) {
    const c = await this.chamado(escopo, id);
    const msgs = ok(await this.db.from('atd_mensagens').select('id,autor,texto,criado_em').eq('chamado_id', id).order('criado_em'), 'mensagens') as any[];
    const e = c.empresa_id ? ok(await this.db.from('empresas').select('razao_social,cnpj').eq('id', c.empresa_id).maybeSingle(), 'empresa') as any : null;
    return { ...c, empresa: e?.razao_social ?? null, cnpj: e?.cnpj ?? null, atrasado: atrasado(c), mensagens: msgs };
  }

  private validar(d: Record<string, unknown>, parcial: boolean) {
    const m: Record<string, unknown> = {};
    const set = (k: string, lista: Record<string, string>, nome: string) => {
      if (d[k] === undefined) return;
      const v = String(d[k]);
      if (!lista[v]) throw new ErroModulo(400, `${nome} inválido.`);
      m[k] = v;
    };
    if (!parcial || d.assunto !== undefined) { const a = txt(d.assunto, 200); if (!a) throw new ErroModulo(400, 'Informe o assunto.'); m.assunto = a; }
    set('departamento', DEPARTAMENTOS, 'Departamento'); set('prioridade', PRIORIDADES, 'Prioridade'); set('status', STATUS_CHAMADO, 'Situação'); set('canal', CANAIS, 'Canal');
    if (d.solicitante !== undefined) m.solicitante = txt(d.solicitante, 200);
    if (d.responsavel !== undefined) m.responsavel = txt(d.responsavel, 200)?.toLowerCase() ?? null;
    if (d.prazo !== undefined) m.prazo = dataOpcional(d.prazo, 'Prazo');
    return m;
  }

  async criar(por: string, escopo: Escopo, d: Record<string, unknown>) {
    const empresa = d.empresa_id ? String(d.empresa_id) : null;
    if (empresa) exigirEmpresaNoEscopo(escopo, empresa);
    const m = this.validar(d, false);
    const r = ok(await this.db.from('atd_chamados').insert({ ...m, empresa_id: empresa, criado_por: por }).select('id'), 'abrir chamado') as any[];
    const id = Number(r[0].id);
    const texto = txt(d.mensagem, 8000);
    if (texto) ok(await this.db.from('atd_mensagens').insert({ chamado_id: id, autor: por, texto }), 'mensagem');
    return { id };
  }

  async atualizar(por: string, escopo: Escopo, id: number, d: Record<string, unknown>) {
    const c = await this.chamado(escopo, id);
    const m = this.validar(d, true);
    if (!Object.keys(m).length) return { ok: true };
    const resolvendo = m.status && ['resolvido', 'fechado'].includes(String(m.status)) && !['resolvido', 'fechado'].includes(c.status);
    ok(await this.db.from('atd_chamados').update({ ...m, atualizado_em: new Date().toISOString(), ...(resolvendo ? { resolvido_em: new Date().toISOString() } : m.status ? { resolvido_em: ['resolvido', 'fechado'].includes(String(m.status)) ? c.resolvido_em : null } : {}) }).eq('id', id), 'atualizar chamado');
    // Mudanças de situação e responsável ficam na conversa (histórico)
    const notas: string[] = [];
    if (m.status && m.status !== c.status) notas.push(`Situação: ${STATUS_CHAMADO[c.status]} → ${STATUS_CHAMADO[String(m.status)]}`);
    if (m.responsavel !== undefined && m.responsavel !== c.responsavel) notas.push(`Responsável: ${c.responsavel ?? 'ninguém'} → ${m.responsavel ?? 'ninguém'}`);
    if (notas.length) ok(await this.db.from('atd_mensagens').insert({ chamado_id: id, autor: por, texto: `[${notas.join(' · ')}]` }), 'histórico');
    return { ok: true };
  }

  async responder(por: string, escopo: Escopo, id: number, texto: unknown) {
    await this.chamado(escopo, id);
    const t = txt(texto, 8000);
    if (!t) throw new ErroModulo(400, 'Escreva a mensagem.');
    ok(await this.db.from('atd_mensagens').insert({ chamado_id: id, autor: por, texto: t }), 'mensagem');
    ok(await this.db.from('atd_chamados').update({ atualizado_em: new Date().toISOString() }).eq('id', id), 'atualizar chamado');
  }

  async excluir(escopo: Escopo, id: number) {
    await this.chamado(escopo, id);
    ok(await this.db.from('atd_chamados').delete().eq('id', id), 'excluir chamado');
  }
}
