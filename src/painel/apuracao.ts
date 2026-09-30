/**
 * Apuração do Simples Nacional, etapa B: lê as notas de saída do mês (matriz e filiais do Simples),
 * roda a segregação (src/fiscal/simples.ts) e guarda os ajustes manuais. Não chama o SERPRO.
 */
import { buscarTodos, Db, ok } from '../db';
import { AjusteReceita, apurarEstabelecimento, ContextoApuracao, GRUPOS, Grupo, montarDeclaracao, NotaSaida, ResultadoEstabelecimento } from '../fiscal/simples';
import { acharRegra, RegraST } from '../fiscal/st';

export class ErroApuracao extends Error {
  constructor(public readonly status: number, msg: string) {
    super(msg);
  }
}

const COLUNAS_NOTA = 'chave,modelo,serie,numero,situacao,completo,tp_nf,fin_nfe,emit_cnpj,valor,direcao';
const COLUNAS_ITEM = 'chave,n_item,cfop,ncm,cest,ean,x_prod,cst_icms,csosn,cst_pis,v_prod,v_desc,v_frete,v_seg,v_outro';
const CST_COMPRA_COM_ST = '10,30,60,70,201,202,203,500';

/** Intervalo do mês no fuso de São Paulo. */
export function intervalo(competencia: string) {
  const [y, m] = competencia.split('-').map(Number);
  const prox = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return { de: `${competencia}-01T00:00:00-03:00`, ate: `${prox}-01T00:00:00-03:00` };
}
const mesesAntes = (competencia: string, n: number) => {
  const [y, m] = competencia.split('-').map(Number);
  const t = y * 12 + (m - 1) - n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

type Estab = { id: string; cnpj: string; razao_social: string; regime: string | null; ativo: boolean };

export class ServicoApuracao {
  constructor(private db: Db, private agora: () => Date = () => new Date()) {}

  /** Matriz e filiais (mesma raiz de CNPJ) do Simples. A matriz (0001) vem primeiro. */
  private async estabelecimentos(empresaId: string): Promise<{ principal: Estab; estabs: Estab[] }> {
    const e = ok(await this.db.from('empresas').select('id,cnpj,razao_social,regime,ativo').eq('id', empresaId).maybeSingle(), 'empresa') as Estab | null;
    if (!e) throw new ErroApuracao(404, 'Empresa não encontrada.');
    if (e.regime !== 'simples') throw new ErroApuracao(422, e.regime === 'mei' ? 'MEI não tem apuração: o DAS-MEI tem valor fixo (gere na aba Guias).' : 'A apuração do PGDAS-D é só para empresas do Simples Nacional. Confira o regime no cadastro.');
    const irmas = ok(await this.db.from('empresas').select('id,cnpj,razao_social,regime,ativo').like('cnpj', `${e.cnpj.slice(0, 8)}%`), 'filiais') as Estab[];
    const estabs = irmas.filter((x) => x.regime === 'simples' && (x.ativo || x.id === e.id))
      .sort((a, b) => (a.cnpj.slice(8, 12) === '0001' ? -1 : b.cnpj.slice(8, 12) === '0001' ? 1 : a.cnpj.localeCompare(b.cnpj)));
    return { principal: e, estabs };
  }

  private async notasComItens(empresaId: string, filtro: (q: any) => any): Promise<NotaSaida[]> {
    const notas = await buscarTodos<any>((a, b) => filtro(this.db.from('documentos').select(COLUNAS_NOTA).eq('empresa_id', empresaId)).order('chave').range(a, b), 'notas do mês');
    const chaves = notas.filter((n) => n.completo).map((n) => n.chave);
    const porChave = new Map<string, any[]>();
    for (let i = 0; i < chaves.length; i += 150) {
      const lote = chaves.slice(i, i + 150);
      const itens = await buscarTodos<any>((a, b) => this.db.from('documento_itens').select(COLUNAS_ITEM).eq('empresa_id', empresaId).in('chave', lote).order('chave').order('n_item').range(a, b), 'itens');
      for (const it of itens) (porChave.get(it.chave) ?? porChave.set(it.chave, []).get(it.chave)!).push(it);
    }
    return notas.map((n) => ({ ...n, valor: n.valor === null ? null : Number(n.valor), itens: porChave.get(n.chave) ?? [] }));
  }

  /** EANs e NCMs comprados com ICMS-ST nos 6 meses anteriores (entradas com CST/CSOSN de ST ou ST destacado). */
  private async compradosComSt(empresaId: string, competencia: string) {
    const { ate } = intervalo(competencia);
    const de = intervalo(mesesAntes(competencia, 6)).de;
    const chaves = (await buscarTodos<any>((a, b) => this.db.from('documentos').select('chave').eq('empresa_id', empresaId).eq('direcao', 'entrada').eq('modelo', '55').eq('completo', true)
      .gte('emitida_em', de).lt('emitida_em', ate).order('chave').range(a, b), 'compras')).map((n) => n.chave);
    const eans = new Set<string>(); const ncms = new Set<string>();
    for (let i = 0; i < chaves.length; i += 150) {
      const itens = await buscarTodos<any>((a, b) => this.db.from('documento_itens').select('ean,ncm').eq('empresa_id', empresaId).in('chave', chaves.slice(i, i + 150))
        .or(`cst_icms.in.(${CST_COMPRA_COM_ST}),v_icms_st.gt.0`).order('chave').range(a, b), 'itens comprados com ST');
      for (const it of itens) {
        if (it.ean && /^\d{8,14}$/.test(it.ean)) eans.add(it.ean);
        if (it.ncm) ncms.add(it.ncm);
      }
    }
    return { eans, ncms };
  }

  private async regrasSt(): Promise<RegraST[]> {
    return (await buscarTodos<any>((a, b) => this.db.from('st_es_regras').select('cest,ncm,descricao,mva,pmpf,aliquota_interna').order('id').range(a, b), 'tabela de ST')) as RegraST[];
  }

  async ajustes(empresaIds: string[], competencia: string): Promise<(AjusteReceita & { empresa_id: string })[]> {
    const l = ok(await this.db.from('apuracao_ajustes').select('id,empresa_id,valor,atividade,st,monofasico,justificativa,criado_por,criado_em')
      .in('empresa_id', empresaIds).eq('competencia', `${competencia}-01`).order('id'), 'ajustes') as any[];
    return l.map((x) => ({ id: x.id, empresa_id: x.empresa_id, valor: Number(x.valor), atividade: x.atividade, st: x.st, monofasico: x.monofasico, justificativa: x.justificativa, por: x.criado_por, em: x.criado_em }));
  }

  /** Receita aproximada de um mês (soma das notas de saída autorizadas), para comparar com a apuração. */
  private async totalSaidas(estabs: Estab[], competencia: string): Promise<number> {
    const { de, ate } = intervalo(competencia);
    let t = 0;
    for (const e of estabs) {
      const l = await buscarTodos<any>((a, b) => this.db.from('documentos').select('valor').eq('empresa_id', e.id).eq('direcao', 'saida').eq('situacao', 'autorizada').eq('emit_cnpj', e.cnpj).eq('tp_nf', 1)
        .gte('emitida_em', de).lt('emitida_em', ate).order('chave').range(a, b), 'total do mês');
      t += l.reduce((s, n) => s + Number(n.valor || 0), 0);
    }
    return Math.round(t * 100) / 100;
  }

  async previa(empresaId: string, competencia: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw new ErroApuracao(400, 'Competência inválida (AAAA-MM).');
    const { principal, estabs } = await this.estabelecimentos(empresaId);
    const { de, ate } = intervalo(competencia);
    const regras = await this.regrasSt();
    const indice = new Map<string, RegraST[]>();
    for (const r of regras) { const k = r.cest ? `c${r.cest}` : `n${String(r.ncm).slice(0, 4)}`; (indice.get(k) ?? indice.set(k, []).get(k)!).push(r); }
    const naTabelaSt = (i: { ncm: string | null; cest: string | null }) => {
      const cand = [...(i.cest ? indice.get(`c${i.cest}`) ?? [] : []), ...(i.ncm ? indice.get(`n${i.ncm.slice(0, 4)}`) ?? [] : [])];
      return cand.length ? !!acharRegra({ cest: i.cest, ncm: i.ncm }, cand) : false;
    };
    const ajustes = await this.ajustes(estabs.map((e) => e.id), competencia);

    const resultados: (ResultadoEstabelecimento & { id: string; razao_social: string; ajustes: AjusteReceita[] })[] = [];
    for (const e of estabs) {
      const [saidas, devolucoes, comprados] = await Promise.all([
        this.notasComItens(e.id, (q) => q.eq('direcao', 'saida').gte('emitida_em', de).lt('emitida_em', ate)),
        this.notasComItens(e.id, (q) => q.eq('direcao', 'entrada').eq('fin_nfe', 4).gte('emitida_em', de).lt('emitida_em', ate)),
        this.compradosComSt(e.id, competencia),
      ]);
      const ctx: ContextoApuracao = {
        cnpj: e.cnpj, naTabelaSt,
        compradoComSt: (i) => (i.ean && comprados.eans.has(i.ean)) || false,
      };
      const aj = ajustes.filter((a) => a.empresa_id === e.id);
      resultados.push({ id: e.id, razao_social: e.razao_social, ajustes: aj, ...apurarEstabelecimento(saidas, devolucoes, aj, ctx) });
    }

    // SINTEGRA do mês com divergências em aberto (conferência de completude)
    const sintegra = ok(await this.db.from('sped_arquivos').select('empresa_id,nome,divergencias,enviado_em').in('empresa_id', estabs.map((e) => e.id)).eq('tipo', 'sintegra')
      .eq('competencia', `${competencia}-01`).order('enviado_em', { ascending: false }), 'SINTEGRA') as any[];

    const consolidado = new Map<string, Grupo>();
    for (const r of resultados) for (const g of r.grupos) {
      const c = consolidado.get(g.chave) ?? { ...g, vendas: 0, devolucoes: 0, ajustes: 0, valor: 0, itens: 0, ncms: [] };
      c.vendas += g.vendas; c.devolucoes += g.devolucoes; c.ajustes += g.ajustes; c.valor += g.valor; c.itens += g.itens; c.ncms = [...c.ncms, ...g.ncms];
      consolidado.set(g.chave, c);
    }
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const grupos = [...consolidado.values()].map((g) => ({ ...g, vendas: r2(g.vendas), devolucoes: r2(g.devolucoes), ajustes: r2(g.ajustes), valor: r2(g.valor), ncms: g.ncms.sort((a, b) => b.valor - a.valor).slice(0, 5) }))
      .sort((a, b) => Object.keys(GRUPOS).indexOf(a.chave) - Object.keys(GRUPOS).indexOf(b.chave));
    const receita = r2(grupos.reduce((t, g) => t + g.valor, 0));

    const [anterior, anoPassado] = await Promise.all([this.totalSaidas(estabs, mesesAntes(competencia, 1)), this.totalSaidas(estabs, mesesAntes(competencia, 12))]);
    const declaracao = montarDeclaracao(resultados);
    return {
      empresa: { id: principal.id, cnpj: principal.cnpj, razao_social: principal.razao_social },
      competencia,
      receita,
      grupos,
      estabelecimentos: resultados.map(({ grupos: _g, ...r }) => ({ ...r, grupos: _g })),
      sintegra: sintegra.map((s) => ({ empresa_id: s.empresa_id, nome: s.nome, divergencias: s.divergencias, enviado_em: s.enviado_em })),
      comparacao: { mesAnterior: { competencia: mesesAntes(competencia, 1), notas: anterior }, mesmoMesAnoPassado: { competencia: mesesAntes(competencia, 12), notas: anoPassado } },
      declaracao: { pa: Number(competencia.replace('-', '')), ...declaracao },
      geradoEm: this.agora().toISOString(),
    };
  }

  async adicionarAjuste(empresaId: string, competencia: string, a: { valor: unknown; atividade: unknown; st?: unknown; monofasico?: unknown; justificativa: unknown }, email: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw new ErroApuracao(400, 'Competência inválida (AAAA-MM).');
    const { estabs } = await this.estabelecimentos(empresaId);
    if (!estabs.some((e) => e.id === empresaId)) throw new ErroApuracao(422, 'Estabelecimento fora do Simples.');
    const valor = Math.round(Number(a.valor) * 100) / 100;
    if (!Number.isFinite(valor) || valor === 0 || Math.abs(valor) > 99_999_999) throw new ErroApuracao(422, 'Informe o valor do ajuste (positivo soma, negativo diminui).');
    const atividade = Number(a.atividade);
    if (![1, 2, 3].includes(atividade)) throw new ErroApuracao(422, 'Escolha o grupo da receita.');
    const st = atividade === 2 && a.st === true; const mono = atividade === 2 && a.monofasico === true;
    if (atividade === 2 && !st && !mono) throw new ErroApuracao(422, 'Na revenda com ST/monofásico, marque ICMS-ST, monofásico ou os dois.');
    const just = String(a.justificativa ?? '').trim();
    if (just.length < 5) throw new ErroApuracao(422, 'Escreva a justificativa do ajuste (pelo menos 5 caracteres).');
    const linha = ok(await this.db.from('apuracao_ajustes').insert({
      empresa_id: empresaId, competencia: `${competencia}-01`, valor, atividade, st, monofasico: mono, justificativa: just.slice(0, 1000), criado_por: email,
    }).select('id').single(), 'gravar ajuste') as { id: number };
    return { id: linha.id };
  }

  async removerAjuste(id: number) {
    const a = ok(await this.db.from('apuracao_ajustes').select('id,empresa_id,competencia').eq('id', id).maybeSingle(), 'ajuste');
    if (!a) throw new ErroApuracao(404, 'Ajuste não encontrado.');
    ok(await this.db.from('apuracao_ajustes').delete().eq('id', id), 'remover ajuste');
    return a as { id: number; empresa_id: string; competencia: string };
  }
}
