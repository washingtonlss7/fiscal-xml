/**
 * Folha (controle e conferência): etapas do mês por empresa (folha fechada, eSocial, DCTFWeb, FGTS Digital, guias
 * ao cliente, contabilizada) e o resumo das rubricas importadas no Contábil. O cálculo da folha continua no
 * sistema de folha (Domínio); aqui é o acompanhamento.
 */
import { Db, buscarTodos, ok } from '../db';
import { Escopo, ErroModulo, empresasDoEscopo, exigirEmpresaNoEscopo, exigirMes, r2, txt } from './comum';

export const STATUS_ETAPA = ['pendente', 'feito', 'nao_se_aplica'] as const;

export interface LinhaFolha {
  empresa: { id: string; cnpj: string; razao_social: string };
  funcionarios: number | null;
  etapas: Record<string, { status: string; automatico?: boolean; feito_por?: string | null; feito_em?: string | null; observacao?: string | null }>;
  feitas: number;
  total: number;
  rubricas: { quantidade: number; valor: number; pendentes: number; lancamentos: number } | null;
}

/** Progresso: etapas feitas ou "não se aplica" sobre o total de etapas ativas. */
export function progresso(etapas: LinhaFolha['etapas'], ids: string[]) {
  const feitas = ids.filter((i) => etapas[i] && etapas[i].status !== 'pendente').length;
  return { feitas, total: ids.length };
}

export class ServicoFolha {
  constructor(private readonly db: Db) {}

  async etapas(todas = false) {
    let q = this.db.from('folha_etapas').select('id,nome,descricao,ordem,ativa').order('ordem');
    if (!todas) q = q.eq('ativa', true);
    return ok(await q, 'etapas da folha') as { id: string; nome: string; descricao: string | null; ordem: number; ativa: boolean }[];
  }

  async salvarEtapa(d: Record<string, unknown>) {
    const nome = txt(d.nome, 80);
    if (!nome) throw new ErroModulo(400, 'Dê um nome à etapa.');
    const id = d.id ? String(d.id) : nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'etapa';
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(id)) throw new ErroModulo(400, 'Nome de etapa inválido.');
    const linha = { id, nome, descricao: txt(d.descricao, 300), ordem: Number(d.ordem) || 100, ativa: d.ativa !== false };
    ok(await this.db.from('folha_etapas').upsert(linha, { onConflict: 'id' }), 'gravar etapa');
    return { id };
  }

  /** Empresas com folha (configuração) e as demais, para marcar. */
  async empresas(escopo: Escopo) {
    const emps = await empresasDoEscopo(this.db, escopo, true);
    const cfg = new Map((ok(await this.db.from('folha_empresas').select('empresa_id,tem_folha,funcionarios,observacao').limit(10000), 'empresas da folha') as any[]).map((c) => [c.empresa_id, c]));
    return emps.map((e) => ({ ...e, tem_folha: cfg.get(e.id)?.tem_folha ?? false, funcionarios: cfg.get(e.id)?.funcionarios ?? null, observacao: cfg.get(e.id)?.observacao ?? null }));
  }

  async definirEmpresa(por: string, escopo: Escopo, d: Record<string, unknown>) {
    const id = String(d.empresa_id ?? '');
    exigirEmpresaNoEscopo(escopo, id);
    const func = d.funcionarios === null || d.funcionarios === '' || d.funcionarios === undefined ? null : Math.max(0, Math.floor(Number(d.funcionarios)));
    if (func !== null && !Number.isFinite(func)) throw new ErroModulo(400, 'Quantidade de funcionários inválida.');
    ok(await this.db.from('folha_empresas').upsert({ empresa_id: id, tem_folha: d.tem_folha !== false, funcionarios: func, observacao: txt(d.observacao, 300), atualizado_em: new Date().toISOString(), atualizado_por: por }, { onConflict: 'empresa_id' }), 'gravar empresa da folha');
  }

  /** Central da folha do mês: etapas de cada empresa com folha e o resumo das rubricas do Contábil. */
  async painel(mes: string, escopo: Escopo) {
    exigirMes(mes);
    const comp = `${mes}-01`;
    const [etapas, emps] = await Promise.all([this.etapas(), this.empresas(escopo)]);
    const comFolha = emps.filter((e) => e.tem_folha);
    const ids = comFolha.map((e) => e.id);
    const controle = ids.length ? ok(await this.db.from('folha_controle').select('empresa_id,etapa_id,status,observacao,feito_em,feito_por').eq('competencia', comp).in('empresa_id', ids).limit(50000), 'controle da folha') as any[] : [];
    // Resumo das rubricas: movimentos da folha no Contábil (empresa do Contábil ligada à empresa do Appura)
    const ctb = ids.length ? ok(await this.db.from('ctb_empresas').select('id,empresa_id').in('empresa_id', ids), 'empresas do Contábil') as any[] : [];
    const ctbDe = new Map(ctb.map((c) => [c.empresa_id, c.id]));
    const movs = ctb.length ? await buscarTodos<any>((a, b) => this.db.from('ctb_movimentos').select('ctb_empresa_id,valor,status').eq('origem', 'folha').eq('competencia', comp).in('ctb_empresa_id', ctb.map((c) => c.id)).range(a, b), 'rubricas') : [];
    const lancs = ctb.length ? await buscarTodos<any>((a, b) => this.db.from('ctb_lancamentos').select('ctb_empresa_id').eq('origem', 'folha').eq('competencia', comp).in('ctb_empresa_id', ctb.map((c) => c.id)).range(a, b), 'lançamentos da folha') : [];
    const etapaIds = etapas.map((e) => e.id);
    const linhas: LinhaFolha[] = comFolha.map((e) => {
      const st: LinhaFolha['etapas'] = {};
      for (const c of controle.filter((x) => x.empresa_id === e.id)) st[c.etapa_id] = { status: c.status, feito_por: c.feito_por, feito_em: c.feito_em, observacao: c.observacao };
      const ctbId = ctbDe.get(e.id);
      const mv = ctbId ? movs.filter((m) => m.ctb_empresa_id === ctbId) : [];
      const nl = ctbId ? lancs.filter((l) => l.ctb_empresa_id === ctbId).length : 0;
      // "Contabilizada" é marcada sozinha quando o Contábil já gerou os lançamentos da folha do mês
      if (etapaIds.includes('contabilizada') && (!st.contabilizada || st.contabilizada.status === 'pendente') && nl > 0) st.contabilizada = { status: 'feito', automatico: true };
      const p = progresso(st, etapaIds);
      return {
        empresa: { id: e.id, cnpj: e.cnpj, razao_social: e.razao_social }, funcionarios: e.funcionarios, etapas: st, feitas: p.feitas, total: p.total,
        rubricas: ctbId ? { quantidade: mv.length, valor: r2(mv.reduce((t, m) => t + Number(m.valor ?? 0), 0)), pendentes: mv.filter((m) => m.status !== 'ok').length, lancamentos: nl } : null,
      };
    });
    const concluidas = linhas.filter((l) => l.feitas === l.total).length;
    return { competencia: mes, etapas, empresas: linhas, totais: { empresas: linhas.length, concluidas, emAndamento: linhas.length - concluidas, semConfiguracao: emps.length - comFolha.length } };
  }

  async marcar(por: string, escopo: Escopo, d: Record<string, unknown>) {
    const empresa = String(d.empresa_id ?? '');
    exigirEmpresaNoEscopo(escopo, empresa);
    const mes = exigirMes(d.mes);
    const etapa = String(d.etapa_id ?? '');
    const status = String(d.status ?? '');
    if (!(STATUS_ETAPA as readonly string[]).includes(status)) throw new ErroModulo(400, 'Situação inválida.');
    const et = (await this.etapas(true)).find((e) => e.id === etapa);
    if (!et) throw new ErroModulo(404, 'Etapa não encontrada.');
    ok(await this.db.from('folha_controle').upsert({
      empresa_id: empresa, competencia: `${mes}-01`, etapa_id: etapa, status, observacao: txt(d.observacao, 300),
      feito_em: status === 'pendente' ? null : new Date().toISOString(), feito_por: status === 'pendente' ? null : por,
    }, { onConflict: 'empresa_id,competencia,etapa_id' }), 'marcar etapa');
  }

  /** Rubricas da folha de uma empresa no mês (vindas do Contábil), com a situação de cada uma. */
  async rubricas(empresaId: string, mes: string, escopo: Escopo) {
    exigirEmpresaNoEscopo(escopo, empresaId);
    exigirMes(mes);
    const ctb = ok(await this.db.from('ctb_empresas').select('id,codigo_dominio').eq('empresa_id', empresaId).limit(1), 'empresa do Contábil') as any[];
    if (!ctb.length) return { ligada: false, rubricas: [] };
    const mv = ok(await this.db.from('ctb_movimentos').select('rubrica,descricao,valor,status,erro_codigo,erro_detalhe').eq('origem', 'folha').eq('ctb_empresa_id', ctb[0].id).eq('competencia', `${mes}-01`).order('rubrica').limit(5000), 'rubricas') as any[];
    return { ligada: true, codigoDominio: ctb[0].codigo_dominio, rubricas: mv.map((m) => ({ ...m, valor: Number(m.valor ?? 0) })), total: r2(mv.reduce((t, m) => t + Number(m.valor ?? 0), 0)) };
  }
}
