/**
 * Contábil (ETL contábil + livro): processa fontes, aplica as regras do Contábil, guarda movimentos (staging) e
 * lançamentos (livro), lista pendências, registra cada processamento e gera arquivos (conferência e Domínio).
 *
 * Princípios da especificação: regras só em tabela; sem regra = pendência (nunca suposição); idempotente (chave
 * única por movimento); nada se perde (erro classificado); log de cada processamento; lançamento exportado em
 * arquivo definitivo fica travado.
 */
import { Db, buscarTodos, ok } from '../db';
import { Armazenamento } from '../armazenamento';
import { log } from '../log';
import {
  aplicar, agruparNfcePorDia, chaveUnica, CodigoErro, Conta, EmpresaCtb, ERROS, ItemFonte, Lancamento, Movimento, movimentoDaFolha,
  movimentosDaNota, NotaFonte, r2, RegraFiscal, RegraFolha, ValorFiscal, cnpjValido, lerCompetencia, ultimoDia,
} from './motor';
import { arquivoDominio, abasConferencia, ErroDominio, LancamentoSaida } from './dominio';
import { coluna, lerPlanilha } from './planilha';

export class ErroContabil extends Error {
  constructor(public readonly status: number, msg: string) { super(msg); }
}

const so = (v: unknown) => String(v ?? '').replace(/\D+/g, '');
const semZeros = (c: string) => String(c ?? '').trim().replace(/^0+(?=\d)/, '');
const REGIMES = ['simples', 'mei', 'presumido', 'real'];
const DATA = /^\d{4}-\d{2}-\d{2}$/;
/** Erros que dependem só da regra/empresa/plano: dá para reprocessar com o movimento guardado. */
const ERROS_DE_REGRA: CodigoErro[] = ['CFOP_SEM_REGRA', 'RUBRICA_SEM_REGRA', 'REGRA_INCOMPLETA', 'CONTA_INEXISTENTE', 'CONTA_SINTETICA', 'EMPRESA_NAO_ENCONTRADA'];

function regimeDe(v: string): string | null {
  const t = v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!t) return null;
  if (t.includes('mei')) return 'mei';
  if (t.includes('simples')) return 'simples';
  if (t.includes('presumido')) return 'presumido';
  if (t.includes('real')) return 'real';
  return REGIMES.includes(t) ? t : null;
}
const simNao = (v: string, padrao: boolean) => (!v ? padrao : /^(s|sim|true|1|x|ativo|yes)$/i.test(v.trim()));

export interface Contadores { recebidos: number; processados: number; rejeitados: number; sem_regra: number; duplicados: number; lancamentos: number }

export class ServicoContabil {
  /** Processamentos em andamento neste processo (o resultado fica no log). */
  private rodando = new Set<number>();

  constructor(private readonly db: Db, private readonly arm: Armazenamento) {}

  /* ===================== configuração ===================== */

  async config() {
    const r = ok(await this.db.from('ctb_config').select('valor_fiscal,agrupar_nfce_por_dia,atualizado_em,atualizado_por').eq('id', 1).maybeSingle(), 'configuração') as any;
    return r ?? { valor_fiscal: null, agrupar_nfce_por_dia: false };
  }

  async salvarConfig(por: string, d: Record<string, unknown>) {
    const m: Record<string, unknown> = { atualizado_em: new Date().toISOString(), atualizado_por: por };
    if (d.valor_fiscal !== undefined) {
      if (d.valor_fiscal !== null && !['total_nota', 'produtos', 'produtos_menos_desconto'].includes(String(d.valor_fiscal))) throw new ErroContabil(400, 'Campo de valor inválido.');
      m.valor_fiscal = d.valor_fiscal;
    }
    if (d.agrupar_nfce_por_dia !== undefined) m.agrupar_nfce_por_dia = d.agrupar_nfce_por_dia === true;
    ok(await this.db.from('ctb_config').upsert({ id: 1, ...m }, { onConflict: 'id' }), 'gravar configuração');
    return this.config();
  }

  /* ===================== empresas (tabela mestre) ===================== */

  async empresas() {
    const [emps, pers, pend, lanc] = await Promise.all([
      this.db.from('ctb_empresas').select('id,codigo_dominio,cnpj,razao_social,regime,ambiente,ativo,empresa_id,plano_id,atualizado_em').order('razao_social').limit(10000),
      this.db.from('ctb_empresa_periodos').select('id,ctb_empresa_id,inicio,fim,fonte').order('inicio').limit(50000),
      this.db.from('ctb_movimentos').select('ctb_empresa_id').neq('status', 'ok').limit(100000),
      this.db.from('ctb_lancamentos').select('ctb_empresa_id').limit(200000),
    ]);
    const conta = (l: any[]) => { const m = new Map<string, number>(); for (const x of l) if (x.ctb_empresa_id) m.set(x.ctb_empresa_id, (m.get(x.ctb_empresa_id) ?? 0) + 1); return m; };
    const p = conta(ok(pend, 'pendências') as any[]); const l = conta(ok(lanc, 'lançamentos') as any[]);
    const periodos = ok(pers, 'períodos') as any[];
    return (ok(emps, 'empresas') as any[]).map((e) => ({ ...e, periodos: periodos.filter((x) => x.ctb_empresa_id === e.id), pendencias: p.get(e.id) ?? 0, lancamentos: l.get(e.id) ?? 0 }));
  }

  private async todasEmpresas(): Promise<EmpresaCtb[]> {
    return ok(await this.db.from('ctb_empresas').select('id,codigo_dominio,cnpj,razao_social,regime,plano_id,ativo,empresa_id').limit(10000), 'empresas') as any[];
  }

  /** Cria ou atualiza uma empresa (pelo id, ou pelo código do Domínio). */
  async salvarEmpresa(por: string, d: Record<string, unknown>) {
    const codigo = semZeros(so(d.codigo_dominio));
    const cnpj = so(d.cnpj);
    const razao = String(d.razao_social ?? '').trim();
    if (!/^\d{1,7}$/.test(codigo)) throw new ErroContabil(400, 'Código do Domínio inválido (até 7 dígitos).');
    if (!cnpjValido(cnpj)) throw new ErroContabil(400, 'CNPJ/CPF inválido (use o número completo do estabelecimento, com filial).');
    if (razao.length < 2) throw new ErroContabil(400, 'Informe a razão social.');
    const regime = d.regime ? regimeDe(String(d.regime)) : null;
    const ambiente = d.ambiente === 'dominio_antigo' ? 'dominio_antigo' : 'dominio_novo';
    const appura = ok(await this.db.from('empresas').select('id').eq('cnpj', cnpj).limit(1), 'empresa do Appura') as { id: string }[];
    const linha = { codigo_dominio: codigo, cnpj, razao_social: razao, regime, ambiente, ativo: d.ativo !== false, empresa_id: appura[0]?.id ?? null, plano_id: d.plano_id ? String(d.plano_id) : null, atualizado_em: new Date().toISOString(), atualizado_por: por };
    if (d.id) {
      ok(await this.db.from('ctb_empresas').update(linha).eq('id', String(d.id)), 'editar empresa');
      return { id: String(d.id) };
    }
    const ja = ok(await this.db.from('ctb_empresas').select('id,cnpj,codigo_dominio').or(`codigo_dominio.eq.${codigo},cnpj.eq.${cnpj}`).limit(2), 'empresa existente') as any[];
    if (ja.length) throw new ErroContabil(409, `Já existe empresa com este ${ja[0].cnpj === cnpj ? 'CNPJ' : 'código do Domínio'}.`);
    const r = ok(await this.db.from('ctb_empresas').insert(linha).select('id'), 'criar empresa') as any[];
    return { id: r[0]?.id };
  }

  /**
   * Relação de empresas do Contábil (planilha): código do Domínio, CNPJ, razão social, regime, ambiente e,
   * opcionalmente, período inicial/final e fonte. Atualiza pelo código; acrescenta os períodos.
   */
  async importarEmpresas(por: string, nome: string, buf: Buffer) {
    const { linhas } = lerPlanilha(nome, buf);
    const erros: string[] = []; let gravadas = 0; let periodos = 0;
    const existentes = await this.todasEmpresas();
    for (const l of linhas) {
      const d = l.dados;
      const codigo = semZeros(so(coluna(d, 'codigo_dominio', 'codigo', 'codigo_empresa', 'cod_empresa', 'empresa')));
      const cnpj = so(coluna(d, 'cnpj', 'cnpj_cpf', 'cpf_cnpj'));
      try {
        const atual = existentes.find((e) => e.codigo_dominio === codigo);
        const r = await this.salvarEmpresa(por, {
          id: atual?.id, codigo_dominio: codigo, cnpj, razao_social: coluna(d, 'razao_social', 'razao', 'nome', 'empresa_nome') || atual?.razao_social,
          regime: coluna(d, 'regime', 'tributacao', 'regime_tributario') || atual?.regime, ambiente: /antigo/i.test(coluna(d, 'ambiente')) ? 'dominio_antigo' : 'dominio_novo',
        });
        gravadas++;
        const ini = coluna(d, 'periodo_inicial', 'inicio', 'periodo_inicio', 'de'); const fim = coluna(d, 'periodo_final', 'fim', 'periodo_fim', 'ate');
        if (ini && fim) {
          const di = this.dataPlanilha(ini, false); const df = this.dataPlanilha(fim, true);
          if (!di || !df || df < di) erros.push(`Linha ${l.linha}: período inválido (${ini} a ${fim}).`);
          else { ok(await this.db.from('ctb_empresa_periodos').insert({ ctb_empresa_id: r.id, inicio: di, fim: df, fonte: coluna(d, 'fonte', 'origem') || null }), 'período'); periodos++; }
        }
      } catch (e) { erros.push(`Linha ${l.linha}: ${(e as Error).message}`); }
    }
    return { linhas: linhas.length, gravadas, periodos, erros: erros.slice(0, 200) };
  }

  private dataPlanilha(v: string, fimDoMes: boolean): string | null {
    const s = v.trim();
    let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (m) return `${m[3]}-${m[2]}-${m[1]}`;
    if (DATA.test(s)) return s;
    const comp = lerCompetencia(s);
    return comp ? (fimDoMes ? ultimoDia(comp) : comp) : null;
  }

  /** Cria no Contábil as empresas da captação que têm código do Domínio (campo "código ERP" do cadastro). */
  async trazerDoAppura(por: string) {
    const emps = ok(await this.db.from('empresas').select('id,cnpj,razao_social,regime,codigo_erp').eq('escritorio', false).limit(10000), 'empresas do Appura') as any[];
    const ja = await this.todasEmpresas();
    let criadas = 0; const semCodigo: string[] = []; const erros: string[] = [];
    for (const e of emps) {
      if (ja.some((x) => x.cnpj === so(e.cnpj))) continue;
      const codigo = semZeros(so(e.codigo_erp));
      if (!codigo) { semCodigo.push(e.razao_social); continue; }
      try { await this.salvarEmpresa(por, { codigo_dominio: codigo, cnpj: e.cnpj, razao_social: e.razao_social, regime: e.regime }); criadas++; } catch (x) { erros.push(`${e.razao_social}: ${(x as Error).message}`); }
    }
    return { criadas, semCodigo, erros };
  }

  async excluirPeriodo(id: number) {
    ok(await this.db.from('ctb_empresa_periodos').delete().eq('id', id), 'excluir período');
  }

  /* ===================== plano de contas ===================== */

  async planos() {
    const ps = ok(await this.db.from('ctb_planos').select('id,nome,padrao,criado_em').order('nome'), 'planos') as any[];
    const out = [];
    for (const p of ps) {
      const { count } = await this.db.from('ctb_contas').select('codigo', { count: 'exact', head: true }).eq('plano_id', p.id);
      out.push({ ...p, contas: count ?? 0 });
    }
    return out;
  }

  async contas(planoId: string, busca = '') {
    let q = this.db.from('ctb_contas').select('codigo,classificacao,descricao,tipo,natureza,ativa').eq('plano_id', planoId).order('classificacao');
    if (busca) q = /^\d+$/.test(busca) ? q.or(`codigo.eq.${semZeros(busca)},classificacao.like.${busca}%`) : q.ilike('descricao', `%${busca.replace(/[%_]/g, ' ')}%`);
    return ok(await q.limit(2000), 'contas') as any[];
  }

  /**
   * Importa (substitui) o plano de contas a partir de planilha: código reduzido, classificação, descrição, tipo
   * (S/A ou Sintética/Analítica) e natureza (D/C, opcional). Sem tipo, deduz: conta que é "mãe" de outra é sintética.
   */
  async importarPlano(por: string, nomePlano: string, padrao: boolean, nome: string, buf: Buffer) {
    const nomeP = nomePlano.trim();
    if (nomeP.length < 2) throw new ErroContabil(400, 'Dê um nome ao plano (ex.: "Plano padrão Domínio novo").');
    const { linhas } = lerPlanilha(nome, buf);
    const erros: string[] = []; const contas = new Map<string, any>();
    for (const l of linhas) {
      const d = l.dados;
      const codigo = semZeros(so(coluna(d, 'codigo', 'codigo_reduzido', 'reduzido', 'cod', 'conta')));
      const classificacao = coluna(d, 'classificacao', 'classificacao_conta', 'mascara', 'estrutura').trim();
      const descricao = coluna(d, 'descricao', 'nome', 'descricao_conta', 'nome_conta').trim();
      const tipoBruto = coluna(d, 'tipo', 'tipo_conta', 'grau').trim().toUpperCase();
      const nat = coluna(d, 'natureza').trim().toUpperCase();
      if (!/^\d{1,7}$/.test(codigo)) { erros.push(`Linha ${l.linha}: código reduzido inválido (${coluna(d, 'codigo', 'codigo_reduzido', 'reduzido')}).`); continue; }
      if (!classificacao || !descricao) { erros.push(`Linha ${l.linha}: falta classificação ou descrição.`); continue; }
      if (contas.has(codigo)) { erros.push(`Linha ${l.linha}: código ${codigo} repetido.`); continue; }
      const tipo = tipoBruto.startsWith('S') ? 'S' : tipoBruto.startsWith('A') ? 'A' : null;
      contas.set(codigo, { codigo, classificacao, descricao, tipo, natureza: nat.startsWith('D') ? 'D' : nat.startsWith('C') ? 'C' : null });
    }
    if (!contas.size) throw new ErroContabil(422, `Nenhuma conta válida no arquivo. ${erros.slice(0, 5).join(' ')}`);
    // Tipo deduzido pela hierarquia da classificação quando a planilha não traz
    const classes = [...contas.values()].map((c) => c.classificacao);
    for (const c of contas.values()) if (!c.tipo) c.tipo = classes.some((x) => x !== c.classificacao && x.startsWith(`${c.classificacao}.`)) ? 'S' : 'A';
    let plano = (ok(await this.db.from('ctb_planos').select('id').eq('nome', nomeP).limit(1), 'plano') as any[])[0];
    if (!plano) plano = (ok(await this.db.from('ctb_planos').insert({ nome: nomeP, padrao: false, atualizado_por: por }).select('id'), 'criar plano') as any[])[0];
    ok(await this.db.from('ctb_contas').delete().eq('plano_id', plano.id), 'limpar plano');
    const lista = [...contas.values()].map((c) => ({ ...c, plano_id: plano.id, ativa: true }));
    for (let i = 0; i < lista.length; i += 1000) ok(await this.db.from('ctb_contas').insert(lista.slice(i, i + 1000)), 'gravar contas');
    if (padrao) {
      ok(await this.db.from('ctb_planos').update({ padrao: false }).neq('id', plano.id), 'tirar padrão');
      ok(await this.db.from('ctb_planos').update({ padrao: true }).eq('id', plano.id), 'marcar padrão');
    }
    return { plano: plano.id, contas: lista.length, sinteticas: lista.filter((c) => c.tipo === 'S').length, erros: erros.slice(0, 200) };
  }

  /** Contas do plano da empresa (ou do plano padrão); vazio = sem plano carregado (o Domínio confere na importação). */
  private async planoDa(empresa: EmpresaCtb, cache: Map<string, Map<string, Conta>>): Promise<Map<string, Conta>> {
    let id = empresa.plano_id;
    if (!id) {
      if (!cache.has('__padrao')) {
        const p = ok(await this.db.from('ctb_planos').select('id').eq('padrao', true).limit(1), 'plano padrão') as any[];
        cache.set('__padrao', new Map([['id', { codigo: p[0]?.id ?? '', tipo: 'A', ativa: true }]]));
      }
      id = cache.get('__padrao')!.get('id')!.codigo || null;
    }
    if (!id) return new Map();
    if (!cache.has(id)) {
      const contas = await buscarTodos<any>((de, ate) => this.db.from('ctb_contas').select('codigo,tipo,ativa').eq('plano_id', id!).range(de, ate), 'contas do plano');
      cache.set(id, new Map(contas.map((c) => [semZeros(c.codigo), c as Conta])));
    }
    return cache.get(id)!;
  }

  /* ===================== regras ===================== */

  async regras(tipo: 'fiscal' | 'folha') {
    const t = tipo === 'fiscal' ? 'ctb_regras_fiscais' : 'ctb_regras_folha';
    return ok(await this.db.from(t).select('*').order(tipo === 'fiscal' ? 'cfop' : 'rubrica').limit(20000), 'regras') as any[];
  }

  private validarRegra(tipo: 'fiscal' | 'folha', d: Record<string, unknown>) {
    const txt = (k: string) => String(d[k] ?? '').trim();
    const conta = (k: string) => semZeros(so(txt(k)));
    const r: Record<string, unknown> = {
      ctb_empresa_id: d.ctb_empresa_id ? String(d.ctb_empresa_id) : null,
      conta_debito: conta('conta_debito'), conta_credito: conta('conta_credito'), historico: txt('historico'),
      historico_codigo: so(txt('historico_codigo')) ? semZeros(so(txt('historico_codigo'))) : null, ativo: d.ativo !== false,
    };
    if (!/^\d{1,7}$/.test(String(r.conta_debito)) || !/^\d{1,7}$/.test(String(r.conta_credito))) throw new ErroContabil(400, 'Contas de débito e crédito: código reduzido com até 7 dígitos.');
    if (r.conta_debito === r.conta_credito) throw new ErroContabil(400, 'Débito e crédito não podem ser a mesma conta.');
    if (!String(r.historico)) throw new ErroContabil(400, 'Informe o histórico.');
    if (tipo === 'fiscal') {
      const cfop = so(txt('cfop'));
      if (!/^\d{4}$/.test(cfop)) throw new ErroContabil(400, 'CFOP inválido (4 dígitos).');
      r.cfop = cfop; r.tipo_movimento = txt('tipo_movimento').toUpperCase() || 'NAO_INFORMADO';
      r.regime = d.regime ? regimeDe(String(d.regime)) : null;
      r.regra_inversao = d.regra_inversao === true || simNao(String(d.regra_inversao ?? ''), false);
    } else {
      const rub = semZeros(txt('rubrica'));
      if (!rub) throw new ErroContabil(400, 'Informe a rubrica.');
      r.rubrica = rub; r.descricao = txt('descricao') || null; r.tipo_regra = txt('tipo_regra').toUpperCase() || 'FOLHA';
    }
    return r;
  }

  async salvarRegra(por: string, tipo: 'fiscal' | 'folha', d: Record<string, unknown>) {
    const t = tipo === 'fiscal' ? 'ctb_regras_fiscais' : 'ctb_regras_folha';
    const r = { ...this.validarRegra(tipo, d), atualizado_em: new Date().toISOString(), atualizado_por: por };
    if (d.id) { ok(await this.db.from(t).update(r).eq('id', Number(d.id)), 'editar regra'); return { id: Number(d.id) }; }
    const igual = await this.regraIgual(tipo, r);
    if (igual) throw new ErroContabil(409, 'Já existe regra para este CFOP/rubrica neste escopo. Edite a existente.');
    const x = ok(await this.db.from(t).insert(r).select('id'), 'criar regra') as any[];
    return { id: x[0]?.id };
  }

  private async regraIgual(tipo: 'fiscal' | 'folha', r: Record<string, unknown>) {
    const t = tipo === 'fiscal' ? 'ctb_regras_fiscais' : 'ctb_regras_folha';
    let q = this.db.from(t).select('id').limit(1);
    q = r.ctb_empresa_id ? q.eq('ctb_empresa_id', r.ctb_empresa_id as string) : q.is('ctb_empresa_id', null);
    if (tipo === 'fiscal') { q = q.eq('cfop', r.cfop as string); q = r.regime ? q.eq('regime', r.regime as string) : q.is('regime', null); }
    else q = q.eq('rubrica', r.rubrica as string);
    return (ok(await q, 'regra igual') as any[])[0] ?? null;
  }

  async excluirRegra(tipo: 'fiscal' | 'folha', id: number) {
    ok(await this.db.from(tipo === 'fiscal' ? 'ctb_regras_fiscais' : 'ctb_regras_folha').delete().eq('id', id), 'excluir regra');
  }

  /** Importa a tabela DE/PARA do Contábil (planilha). Atualiza a regra do mesmo CFOP/rubrica e escopo. */
  async importarRegras(por: string, tipo: 'fiscal' | 'folha', nome: string, buf: Buffer) {
    const { linhas } = lerPlanilha(nome, buf);
    const emps = await this.todasEmpresas();
    let gravadas = 0; const erros: string[] = [];
    for (const l of linhas) {
      const d = l.dados;
      try {
        const codEmp = semZeros(so(coluna(d, 'codigo_empresa', 'empresa', 'codigo_dominio')));
        const emp = codEmp ? emps.find((e) => e.codigo_dominio === codEmp) : null;
        if (codEmp && !emp) throw new Error(`empresa ${codEmp} não está na tabela mestre`);
        const dados: Record<string, unknown> = {
          ctb_empresa_id: emp?.id ?? null, conta_debito: coluna(d, 'conta_debito', 'debito', 'deb'), conta_credito: coluna(d, 'conta_credito', 'credito', 'cred'),
          historico: coluna(d, 'historico', 'historico_padrao'), historico_codigo: coluna(d, 'historico_codigo', 'cod_historico', 'codigo_historico'),
          ativo: simNao(coluna(d, 'ativo'), true),
        };
        if (tipo === 'fiscal') Object.assign(dados, { cfop: coluna(d, 'cfop'), tipo_movimento: coluna(d, 'tipo_movimento', 'tipo'), regime: coluna(d, 'regime'), regra_inversao: coluna(d, 'regra_inversao', 'inversao') });
        else Object.assign(dados, { rubrica: coluna(d, 'rubrica', 'codigo_rubrica', 'evento'), descricao: coluna(d, 'descricao', 'nome_rubrica'), tipo_regra: coluna(d, 'tipo_regra', 'tipo') });
        const r = { ...this.validarRegra(tipo, dados), atualizado_em: new Date().toISOString(), atualizado_por: por };
        const ja = await this.regraIgual(tipo, r);
        const t = tipo === 'fiscal' ? 'ctb_regras_fiscais' : 'ctb_regras_folha';
        if (ja) ok(await this.db.from(t).update(r).eq('id', ja.id), 'atualizar regra'); else ok(await this.db.from(t).insert(r), 'criar regra');
        gravadas++;
      } catch (e) { erros.push(`Linha ${l.linha}: ${(e as Error).message}`); }
    }
    return { linhas: linhas.length, gravadas, erros: erros.slice(0, 200) };
  }

  /* ===================== processamento ===================== */

  private async abrirProcessamento(origem: 'fiscal' | 'folha', fonte: string, usuario: string, inicio: string | null, fim: string | null) {
    const r = ok(await this.db.from('ctb_processamentos').insert({ origem, fonte, usuario, periodo_inicio: inicio, periodo_fim: fim, status: 'processando' }).select('id'), 'abrir processamento') as any[];
    return Number(r[0].id);
  }

  private async fecharProcessamento(id: number, c: Contadores & { empresas: number }, resumo: unknown, erro?: string) {
    ok(await this.db.from('ctb_processamentos').update({
      ...c, status: erro ? 'erro' : 'concluido', erro: erro ?? null, resumo, concluido_em: new Date().toISOString(),
    }).eq('id', id), 'fechar processamento');
  }

  /** Lançamentos já exportados em arquivo definitivo: não são mexidos por reprocessamento. */
  private async travados(movIds: number[]): Promise<Set<number>> {
    const s = new Set<number>();
    for (let i = 0; i < movIds.length; i += 300) {
      const l = ok(await this.db.from('ctb_lancamentos').select('movimento_id,arquivo_id').in('movimento_id', movIds.slice(i, i + 300)).not('arquivo_id', 'is', null), 'travados') as any[];
      for (const x of l) s.add(x.movimento_id);
    }
    return s;
  }

  /**
   * Grava movimentos (upsert pela chave única) e gera/regenera o lançamento de cada um. Movimento cujo lançamento
   * já foi exportado em arquivo definitivo é contado como duplicado e não é alterado.
   */
  private async gravarMovimentos(procId: number, movs: Movimento[], ctx: { empresas: EmpresaCtb[]; fiscais: RegraFiscal[]; folha: RegraFolha[]; planos: Map<string, Map<string, Conta>> }, c: Contadores, pendencias: Map<string, number>) {
    const porId = new Map(ctx.empresas.map((e) => [e.id, e]));
    for (let i = 0; i < movs.length; i += 300) {
      const lote = movs.slice(i, i + 300);
      const chaves = lote.map((m) => m.chave_unica);
      const existentes = new Map((ok(await this.db.from('ctb_movimentos').select('id,chave_unica,status').in('chave_unica', chaves), 'movimentos existentes') as any[]).map((x) => [x.chave_unica, x]));
      const trav = await this.travados([...existentes.values()].map((x) => Number(x.id)));
      const vistos = new Set<string>();
      const linhas: any[] = []; const resultados: { chave: string; res: ReturnType<typeof aplicar> }[] = [];
      for (const m of lote) {
        if (vistos.has(m.chave_unica)) { c.duplicados++; continue; } // repetido no mesmo arquivo
        vistos.add(m.chave_unica);
        const ex = existentes.get(m.chave_unica);
        if (ex && trav.has(Number(ex.id))) { c.duplicados++; continue; }
        if (ex) c.duplicados++;
        const emp = m.ctb_empresa_id ? porId.get(m.ctb_empresa_id) ?? null : null;
        const plano = emp ? await this.planoDa(emp, ctx.planos) : undefined;
        const res = aplicar(m, emp, { fiscais: ctx.fiscais, folha: ctx.folha }, plano);
        resultados.push({ chave: m.chave_unica, res });
        if (res.ok) c.processados++; else {
          if (res.codigo === 'CFOP_SEM_REGRA' || res.codigo === 'RUBRICA_SEM_REGRA') c.sem_regra++; else c.rejeitados++;
          const k = `${res.codigo}|${res.detalhe ?? ''}`; pendencias.set(k, (pendencias.get(k) ?? 0) + 1);
        }
        linhas.push({
          chave_unica: m.chave_unica, origem: m.origem, ctb_empresa_id: m.ctb_empresa_id, cnpj: m.cnpj, competencia: m.competencia, data: m.data || m.competencia,
          documento: m.documento, chave_nfe: m.chave_nfe ?? null, modelo: m.modelo ?? null, cfop: m.cfop ?? null, rubrica: m.rubrica ?? null, descricao: m.descricao ?? null,
          participante_nome: m.participante_nome ?? null, participante_doc: m.participante_doc ?? null, valor: m.valor, dados: m.dados ?? null,
          status: res.ok ? 'ok' : res.codigo === 'VALOR_INVALIDO' || res.codigo === 'DATA_INVALIDA' || res.codigo === 'CNPJ_INVALIDO' ? 'erro' : 'pendente',
          erro_codigo: res.ok ? null : res.codigo, erro_detalhe: res.ok ? null : res.detalhe ?? null, processamento_id: procId, atualizado_em: new Date().toISOString(),
        });
      }
      if (!linhas.length) continue;
      const gravados = ok(await this.db.from('ctb_movimentos').upsert(linhas, { onConflict: 'chave_unica' }).select('id,chave_unica'), 'gravar movimentos') as any[];
      const idDe = new Map(gravados.map((g) => [g.chave_unica, Number(g.id)]));
      const ids = [...idDe.values()];
      ok(await this.db.from('ctb_lancamentos').delete().in('movimento_id', ids).is('arquivo_id', null), 'limpar lançamentos antigos');
      const novos = resultados.filter((r) => r.res.ok).map((r) => ({ ...(r.res as { ok: true; lancamento: Lancamento }).lancamento, movimento_id: idDe.get(r.chave), processamento_id: procId }));
      if (novos.length) { ok(await this.db.from('ctb_lancamentos').insert(novos), 'gravar lançamentos'); c.lancamentos += novos.length; }
    }
  }

  private async contexto() {
    const [empresas, fiscais, folha] = await Promise.all([this.todasEmpresas(), this.regras('fiscal'), this.regras('folha')]);
    return { empresas, fiscais: fiscais as RegraFiscal[], folha: folha as RegraFolha[], planos: new Map<string, Map<string, Conta>>() };
  }

  /**
   * Fonte fiscal: notas do Appura (XML já lido) das empresas escolhidas no período. NF-e e NFC-e; canceladas não
   * geram lançamento e, se já tinham gerado (sem exportação definitiva), o lançamento é retirado.
   */
  async processarFiscal(por: string, d: { empresas?: string[]; inicio: string; fim: string; esperar?: boolean }) {
    if (!DATA.test(d.inicio) || !DATA.test(d.fim) || d.fim < d.inicio) throw new ErroContabil(400, 'Período inválido.');
    const ctx = await this.contexto();
    const escolhidas = ctx.empresas.filter((e) => e.ativo && (!d.empresas?.length || d.empresas.includes(e.id)));
    if (!escolhidas.length) throw new ErroContabil(400, 'Nenhuma empresa ativa na seleção.');
    const id = await this.abrirProcessamento('fiscal', 'Notas do Appura (XML)', por, d.inicio, d.fim);
    const tarefa = this.rodarFiscal(id, escolhidas, d.inicio, d.fim, ctx).catch((e) => log.error('contábil: processamento fiscal falhou', { id, erro: (e as Error).message }));
    if (d.esperar) await tarefa;
    return { processamento: id };
  }

  private async rodarFiscal(id: number, escolhidas: EmpresaCtb[], inicio: string, fim: string, ctx: Awaited<ReturnType<ServicoContabil['contexto']>>) {
    this.rodando.add(id);
    const c: Contadores = { recebidos: 0, processados: 0, rejeitados: 0, sem_regra: 0, duplicados: 0, lancamentos: 0 };
    const pend = new Map<string, number>(); const avisos: string[] = []; let canceladasRetiradas = 0;
    try {
      const cfg = await this.config();
      const de = `${inicio}T00:00:00-03:00`;
      const ate = new Date(Date.parse(`${fim}T00:00:00-03:00`) + 86400000).toISOString();
      for (const emp of escolhidas) {
        const ligada = (emp as any).empresa_id as string | null;
        if (!ligada) { avisos.push(`${emp.codigo_dominio} ${emp.razao_social}: não está na captação do Appura (sem notas para processar).`); continue; }
        const notas = await buscarTodos<any>((a, b) => this.db.from('documentos')
          .select('chave,modelo,direcao,numero,serie,emitida_em,situacao,valor,cfop,completo,itens_extraidos,emit_cnpj,emit_nome,dest_doc,dest_nome')
          .eq('empresa_id', ligada).in('modelo', ['55', '65']).gte('emitida_em', de).lt('emitida_em', ate).order('emitida_em').range(a, b), 'notas');
        c.recebidos += notas.length;
        // Canceladas: retira lançamentos ainda não exportados
        const canceladas = notas.filter((n) => n.situacao !== 'autorizada').map((n) => n.chave);
        for (let i = 0; i < canceladas.length; i += 300) {
          const movs = ok(await this.db.from('ctb_movimentos').select('id').in('chave_nfe', canceladas.slice(i, i + 300)).eq('ctb_empresa_id', emp.id), 'movimentos de canceladas') as any[];
          if (!movs.length) continue;
          const trav = await this.travados(movs.map((m) => Number(m.id)));
          const soltos = movs.map((m) => Number(m.id)).filter((x) => !trav.has(x));
          if (soltos.length) { ok(await this.db.from('ctb_movimentos').delete().in('id', soltos), 'retirar canceladas'); canceladasRetiradas += soltos.length; }
          if (trav.size) avisos.push(`${emp.razao_social}: ${trav.size} nota(s) cancelada(s) depois de exportada(s) ao Domínio — estornar manualmente.`);
        }
        const autorizadas = notas.filter((n) => n.situacao === 'autorizada');
        const movs: Movimento[] = [];
        for (let i = 0; i < autorizadas.length; i += 200) {
          const bloco = autorizadas.slice(i, i + 200);
          const itens = await buscarTodos<any>((a, b) => this.db.from('documento_itens').select('chave,cfop,v_prod,v_desc,v_frete,v_seg,v_outro,v_icms_st,v_fcp_st,v_ipi')
            .eq('empresa_id', ligada).in('chave', bloco.map((n) => n.chave)).range(a, b), 'itens');
          const porChave = new Map<string, ItemFonte[]>();
          for (const it of itens) { const k = String(it.chave).trim(); porChave.set(k, [...(porChave.get(k) ?? []), it]); }
          for (const n of bloco) {
            const nota: NotaFonte = { ...n, chave: String(n.chave).trim(), empresa_cnpj: emp.cnpj, valor: n.valor == null ? null : Number(n.valor) };
            for (const m of movimentosDaNota(nota, porChave.get(nota.chave) ?? [], cfg.valor_fiscal as ValorFiscal | null)) movs.push({ ...m, ctb_empresa_id: emp.id });
          }
        }
        const finais = cfg.agrupar_nfce_por_dia ? agruparNfcePorDia(movs) : movs;
        await this.gravarMovimentos(id, finais, ctx, c, pend);
      }
      await this.fecharProcessamento(id, { ...c, empresas: escolhidas.length }, { pendencias: Object.fromEntries(pend), avisos, canceladasRetiradas, valor_fiscal: cfg.valor_fiscal });
    } catch (e) {
      await this.fecharProcessamento(id, { ...c, empresas: escolhidas.length }, { pendencias: Object.fromEntries(pend), avisos }, (e as Error).message).catch(() => {});
      throw e;
    } finally { this.rodando.delete(id); }
  }

  /** Fonte folha: planilha (código da empresa ou CNPJ, competência, rubrica, descrição, valor). Guarda o RAW. */
  async processarFolha(por: string, nome: string, buf: Buffer) {
    const { cabecalho, linhas } = lerPlanilha(nome, buf);
    if (!linhas.length) throw new ErroContabil(422, 'Planilha sem linhas.');
    const tem = (...n: string[]) => cabecalho.some((c) => n.includes(c.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()));
    if (!tem('rubrica', 'codigo_rubrica', 'cod_rubrica', 'evento', 'codigo_evento') || !tem('valor', 'valor_rubrica', 'vlr') || !tem('competencia', 'comp', 'mes')) {
      throw new ErroContabil(422, 'A planilha precisa das colunas: código da empresa (ou CNPJ), competência, rubrica, descrição e valor.');
    }
    const ctx = await this.contexto();
    const porCodigo = new Map(ctx.empresas.map((e) => [e.codigo_dominio, e])); const porCnpj = new Map(ctx.empresas.map((e) => [e.cnpj, e]));
    const id = await this.abrirProcessamento('folha', `Planilha: ${nome.slice(0, 150)}`, por, null, null);
    const c: Contadores = { recebidos: linhas.length, processados: 0, rejeitados: 0, sem_regra: 0, duplicados: 0, lancamentos: 0 };
    const pend = new Map<string, number>();
    try {
      for (let i = 0; i < linhas.length; i += 1000) ok(await this.db.from('ctb_raw_folha').insert(linhas.slice(i, i + 1000).map((l) => ({ processamento_id: id, arquivo: nome.slice(0, 200), linha: l.linha, dados: l.dados }))), 'gravar RAW');
      const movs = linhas.map((l) => movimentoDaFolha(l, { porCodigo, porCnpj }));
      await this.gravarMovimentos(id, movs, ctx, c, pend);
      const comps = movs.map((m) => m.competencia).filter((x) => x > '1900-01-01').sort();
      ok(await this.db.from('ctb_processamentos').update({ periodo_inicio: comps[0] ?? null, periodo_fim: comps.length ? ultimoDia(comps[comps.length - 1]) : null }).eq('id', id), 'período');
      await this.fecharProcessamento(id, { ...c, empresas: new Set(movs.map((m) => m.ctb_empresa_id).filter(Boolean)).size }, { pendencias: Object.fromEntries(pend) });
    } catch (e) {
      await this.fecharProcessamento(id, { ...c, empresas: 0 }, { pendencias: Object.fromEntries(pend) }, (e as Error).message).catch(() => {});
      throw e;
    }
    return { processamento: id, ...c };
  }

  /**
   * Reprocessa o que está parado por regra (CFOP/rubrica sem regra, conta inválida, empresa não encontrada) e,
   * com `tudo`, regenera também os lançamentos ainda não exportados (depois de mudar uma regra).
   * Pendências que dependem da fonte (valor não definido, nota sem itens) pedem novo processamento fiscal.
   */
  async reprocessar(por: string, d: { tudo?: boolean; ctb_empresa_id?: string | null }) {
    const ctx = await this.contexto();
    const id = await this.abrirProcessamento('fiscal', d.tudo ? 'Reprocessamento (tudo não exportado)' : 'Reprocessamento de pendências', por, null, null);
    const c: Contadores = { recebidos: 0, processados: 0, rejeitados: 0, sem_regra: 0, duplicados: 0, lancamentos: 0 };
    const pend = new Map<string, number>();
    let q = (a: number, b: number) => {
      let x = this.db.from('ctb_movimentos').select('*');
      x = d.tudo ? x : x.neq('status', 'ok').in('erro_codigo', ERROS_DE_REGRA);
      if (d.ctb_empresa_id) x = x.eq('ctb_empresa_id', d.ctb_empresa_id);
      return x.order('id').range(a, b);
    };
    const movs = await buscarTodos<any>(q, 'movimentos para reprocessar');
    c.recebidos = movs.length;
    const porCodigo = new Map(ctx.empresas.map((e) => [e.codigo_dominio, e])); const porCnpj = new Map(ctx.empresas.map((e) => [e.cnpj, e]));
    const lista: Movimento[] = movs.filter((m) => !(['VALOR_NAO_DEFINIDO', 'NOTA_SEM_ITENS', 'VALOR_NAO_FECHA', 'DATA_INVALIDA', 'VALOR_INVALIDO', 'CNPJ_INVALIDO', 'COMPETENCIA_INVALIDA'] as string[]).includes(m.erro_codigo)).map((m) => {
      let empId = m.ctb_empresa_id as string | null;
      if (!empId && m.origem === 'folha') { const cod = m.dados?.codigo_empresa; empId = (cod && porCodigo.get(String(cod))?.id) || (m.cnpj && porCnpj.get(m.cnpj)?.id) || null; }
      return { ...m, ctb_empresa_id: empId, valor: m.valor == null ? null : Number(m.valor), erro: null };
    });
    await this.gravarMovimentos(id, lista, ctx, c, pend);
    c.duplicados = 0; // aqui "existente" é o esperado
    await this.fecharProcessamento(id, { ...c, empresas: new Set(lista.map((m) => m.ctb_empresa_id).filter(Boolean)).size }, { pendencias: Object.fromEntries(pend), fonte: 'reprocessamento' });
    return { processamento: id, ...c };
  }

  async processamentos(limite = 50) {
    const l = ok(await this.db.from('ctb_processamentos').select('*').order('iniciado_em', { ascending: false }).limit(limite), 'processamentos') as any[];
    return l.map((p) => ({ ...p, emAndamento: p.status === 'processando' && this.rodando.has(Number(p.id)) }));
  }

  /* ===================== pendências e lançamentos ===================== */

  /** Pendências agrupadas por tipo de erro e detalhe (CFOP, rubrica, empresa…), com quantidade, valor e empresas. */
  async pendencias(f: { ctb_empresa_id?: string | null }) {
    const movs = await buscarTodos<any>((a, b) => {
      let q = this.db.from('ctb_movimentos').select('id,origem,ctb_empresa_id,cnpj,competencia,documento,cfop,rubrica,descricao,valor,status,erro_codigo,erro_detalhe,dados').neq('status', 'ok');
      if (f.ctb_empresa_id) q = q.eq('ctb_empresa_id', f.ctb_empresa_id);
      return q.order('id').range(a, b);
    }, 'pendências');
    const emps = new Map((await this.todasEmpresas()).map((e) => [e.id, e]));
    const grupos = new Map<string, any>();
    for (const m of movs) {
      const chave = `${m.erro_codigo}|${m.erro_codigo === 'CFOP_SEM_REGRA' ? m.cfop : m.erro_codigo === 'RUBRICA_SEM_REGRA' ? m.rubrica : m.erro_detalhe ?? ''}`;
      const g = grupos.get(chave) ?? { codigo: m.erro_codigo, titulo: (ERROS as any)[m.erro_codigo] ?? m.erro_codigo, detalhe: m.erro_codigo === 'CFOP_SEM_REGRA' ? m.cfop : m.erro_codigo === 'RUBRICA_SEM_REGRA' ? `${m.rubrica ?? ''} ${m.descricao ?? ''}`.trim() : m.erro_detalhe, quantidade: 0, valor: 0, empresas: new Set<string>(), exemplos: [] as any[] };
      g.quantidade++; g.valor += Number(m.valor ?? 0);
      const e = m.ctb_empresa_id ? emps.get(m.ctb_empresa_id) : null;
      g.empresas.add(e ? `${e.codigo_dominio} ${e.razao_social}` : m.dados?.codigo_empresa ? `código ${m.dados.codigo_empresa}` : m.cnpj ?? '—');
      if (g.exemplos.length < 5) g.exemplos.push({ id: m.id, documento: m.documento, competencia: m.competencia, valor: m.valor });
      grupos.set(chave, g);
    }
    const lista = [...grupos.values()].map((g) => ({ ...g, valor: r2(g.valor), empresas: [...g.empresas].slice(0, 20), nEmpresas: g.empresas.size })).sort((a, b) => b.quantidade - a.quantidade);
    return { total: movs.length, grupos: lista };
  }

  async lancamentos(f: { ctb_empresa_id: string; inicio: string; fim: string; pagina?: number }) {
    if (!DATA.test(f.inicio) || !DATA.test(f.fim)) throw new ErroContabil(400, 'Período inválido.');
    const todos = await buscarTodos<any>((a, b) => this.db.from('ctb_lancamentos').select('id,data,conta_debito,conta_credito,valor,historico,historico_codigo,origem,documento,competencia,regra,arquivo_id')
      .eq('ctb_empresa_id', f.ctb_empresa_id).gte('data', f.inicio).lte('data', f.fim).order('data').order('id').range(a, b), 'lançamentos');
    const { count: pend } = await this.db.from('ctb_movimentos').select('id', { count: 'exact', head: true }).eq('ctb_empresa_id', f.ctb_empresa_id).neq('status', 'ok').gte('competencia', `${f.inicio.slice(0, 7)}-01`).lte('competencia', f.fim);
    const total = r2(todos.reduce((t, l) => t + Number(l.valor), 0));
    const porOrigem: Record<string, { quantidade: number; valor: number }> = {};
    for (const l of todos) { const o = porOrigem[l.origem] ?? { quantidade: 0, valor: 0 }; o.quantidade++; o.valor = r2(o.valor + Number(l.valor)); porOrigem[l.origem] = o; }
    const pg = Math.max(1, Number(f.pagina) || 1);
    return { quantidade: todos.length, total, debitos: total, creditos: total, confere: true, porOrigem, pendencias: pend ?? 0, exportados: todos.filter((l) => l.arquivo_id).length, pagina: pg, lancamentos: todos.slice((pg - 1) * 500, pg * 500) };
  }

  /** Lançamento manual (o Appura como livro contábil). Contas conferidas no plano da empresa, se houver. */
  async lancarManual(por: string, d: Record<string, unknown>) {
    const emps = await this.todasEmpresas();
    const emp = emps.find((e) => String(e.id) === String(d.ctb_empresa_id));
    if (!emp) throw new ErroContabil(404, 'Empresa não encontrada.');
    const data = String(d.data ?? '');
    if (!DATA.test(data)) throw new ErroContabil(400, 'Data inválida.');
    const valor = Number(d.valor);
    if (!(valor > 0)) throw new ErroContabil(400, 'Valor inválido.');
    const deb = semZeros(so(d.conta_debito)); const cred = semZeros(so(d.conta_credito));
    const historico = String(d.historico ?? '').trim();
    if (!/^\d{1,7}$/.test(deb) || !/^\d{1,7}$/.test(cred) || deb === cred) throw new ErroContabil(400, 'Contas de débito e crédito inválidas.');
    if (!historico) throw new ErroContabil(400, 'Informe o histórico.');
    const plano = await this.planoDa(emp, new Map());
    if (plano.size) for (const c of [deb, cred]) {
      const conta = plano.get(c);
      if (!conta || !conta.ativa) throw new ErroContabil(400, `A conta ${c} não existe no plano de contas.`);
      if (conta.tipo !== 'A') throw new ErroContabil(400, `A conta ${c} é sintética: use uma conta analítica.`);
    }
    const r = ok(await this.db.from('ctb_lancamentos').insert({
      ctb_empresa_id: emp.id, competencia: `${data.slice(0, 7)}-01`, data, conta_debito: deb, conta_credito: cred, valor: r2(valor), historico,
      historico_codigo: so(d.historico_codigo) || null, origem: 'manual', documento: d.documento ? String(d.documento).slice(0, 60) : null, regra: null, criado_por: por,
    }).select('id'), 'lançamento manual') as any[];
    return { id: r[0]?.id };
  }

  async excluirLancamentoManual(id: number) {
    const l = ok(await this.db.from('ctb_lancamentos').select('id,origem,arquivo_id').eq('id', id).maybeSingle(), 'lançamento') as any;
    if (!l) throw new ErroContabil(404, 'Lançamento não encontrado.');
    if (l.origem !== 'manual') throw new ErroContabil(409, 'Só lançamentos manuais são excluídos aqui. Os gerados por regra mudam reprocessando.');
    if (l.arquivo_id) throw new ErroContabil(409, 'Lançamento já exportado em arquivo definitivo.');
    ok(await this.db.from('ctb_lancamentos').delete().eq('id', id), 'excluir lançamento');
  }

  /* ===================== arquivos ===================== */

  /**
   * Gera a planilha de conferência ou o TXT do Domínio de uma empresa e período. "Definitivo" (só TXT, sem
   * pendências no período) trava os lançamentos exportados; a planilha e o TXT de teste não travam nada.
   */
  async gerarArquivo(por: string, d: { ctb_empresa_id: string; inicio: string; fim: string; tipo: 'dominio_txt' | 'conferencia_xlsx'; definitivo?: boolean; reexportar?: boolean }) {
    if (!DATA.test(d.inicio) || !DATA.test(d.fim) || d.fim < d.inicio) throw new ErroContabil(400, 'Período inválido.');
    const emp = (await this.todasEmpresas()).find((e) => String(e.id) === String(d.ctb_empresa_id));
    if (!emp) throw new ErroContabil(404, 'Empresa não encontrada.');
    let lancs = await buscarTodos<any>((a, b) => this.db.from('ctb_lancamentos').select('id,data,conta_debito,conta_credito,valor,historico,historico_codigo,origem,documento,competencia,regra,arquivo_id')
      .eq('ctb_empresa_id', emp.id).gte('data', d.inicio).lte('data', d.fim).order('data').range(a, b), 'lançamentos do arquivo');
    const definitivo = d.tipo === 'dominio_txt' && d.definitivo === true;
    if (definitivo && !d.reexportar) lancs = lancs.filter((l) => !l.arquivo_id);
    if (!lancs.length) throw new ErroContabil(404, definitivo ? 'Nenhum lançamento novo para exportar no período (os demais já foram exportados).' : 'Nenhum lançamento no período.');
    if (definitivo) {
      const { count } = await this.db.from('ctb_movimentos').select('id', { count: 'exact', head: true }).eq('ctb_empresa_id', emp.id).neq('status', 'ok').gte('competencia', `${d.inicio.slice(0, 7)}-01`).lte('competencia', d.fim);
      if (count) throw new ErroContabil(409, `Há ${count} pendência(s) nesta empresa e período. Resolva antes do arquivo definitivo (ou gere o arquivo de teste).`);
    }
    const saida: LancamentoSaida[] = lancs.map((l) => ({ ...l, valor: Number(l.valor) }));
    const total = r2(saida.reduce((t, l) => t + l.valor, 0));
    const base = `${emp.codigo_dominio}_${d.inicio.slice(0, 7).replace('-', '')}${d.fim.slice(0, 7) !== d.inicio.slice(0, 7) ? `-${d.fim.slice(0, 7).replace('-', '')}` : ''}`;
    const reg = ok(await this.db.from('ctb_arquivos').insert({
      tipo: d.tipo, ctb_empresa_id: emp.id, competencia_inicio: d.inicio, competencia_fim: d.fim, nome: 'gerando', lancamentos: saida.length, total, definitivo, criado_por: por,
    }).select('id'), 'registrar arquivo') as any[];
    const arqId = Number(reg[0].id);
    if (d.tipo === 'conferencia_xlsx') {
      const nome = `CONFERENCIA_${base}.xlsx`;
      ok(await this.db.from('ctb_arquivos').update({ nome }).eq('id', arqId), 'nome do arquivo');
      return { tipo: 'xlsx' as const, nome, abas: abasConferencia(`Lançamentos para conferência · ${d.inicio.split('-').reverse().join('/')} a ${d.fim.split('-').reverse().join('/')}`, emp, saida) };
    }
    let r;
    try { r = arquivoDominio(emp, d.inicio, d.fim, arqId, saida); } catch (e) {
      ok(await this.db.from('ctb_arquivos').delete().eq('id', arqId), 'desfazer registro');
      if (e instanceof ErroDominio) throw new ErroContabil(422, e.message);
      throw e;
    }
    const nome = `${base}_LANCAMENTOS${definitivo ? '' : '_TESTE'}.txt`;
    const caminho = await this.arm.salvar(`contabil/${emp.codigo_dominio}/${arqId}_${nome}`, r.conteudo);
    ok(await this.db.from('ctb_arquivos').update({ nome, caminho, sha256: r.sha256 }).eq('id', arqId), 'gravar arquivo');
    if (definitivo) for (let i = 0; i < lancs.length; i += 300) ok(await this.db.from('ctb_lancamentos').update({ arquivo_id: arqId }).in('id', lancs.slice(i, i + 300).map((l) => l.id)), 'travar lançamentos');
    return { tipo: 'txt' as const, nome, conteudo: r.conteudo, lancamentos: r.lancamentos, total: r.total };
  }

  async arquivos(limite = 100) {
    return ok(await this.db.from('ctb_arquivos').select('id,tipo,ctb_empresa_id,competencia_inicio,competencia_fim,nome,lancamentos,total,definitivo,criado_por,criado_em').order('criado_em', { ascending: false }).limit(limite), 'arquivos') as any[];
  }

  async baixarArquivo(id: number) {
    const a = ok(await this.db.from('ctb_arquivos').select('nome,caminho,tipo').eq('id', id).maybeSingle(), 'arquivo') as any;
    if (!a?.caminho) throw new ErroContabil(404, 'Arquivo não encontrado (a planilha de conferência é gerada na hora: gere de novo).');
    return { nome: a.nome, conteudo: await this.arm.ler(a.caminho) };
  }

  /** Modelos de planilha (cabeçalhos) para o Contábil preencher. */
  modelo(tipo: string): { nome: string; csv: string } {
    const m: Record<string, [string, string]> = {
      regras_fiscais: ['modelo_regras_fiscais.csv', 'cfop;tipo_movimento;regime;codigo_empresa;conta_debito;conta_credito;historico;historico_codigo;regra_inversao;ativo\r\n'],
      regras_folha: ['modelo_regras_folha.csv', 'rubrica;descricao;codigo_empresa;conta_debito;conta_credito;historico;historico_codigo;tipo_regra;ativo\r\n'],
      empresas: ['modelo_empresas.csv', 'codigo_dominio;cnpj;razao_social;regime;ambiente;periodo_inicial;periodo_final;fonte\r\n'],
      plano: ['modelo_plano_de_contas.csv', 'codigo_reduzido;classificacao;descricao;tipo;natureza\r\n'],
      folha: ['modelo_folha.csv', 'codigo_empresa;cnpj;competencia;rubrica;descricao;valor;tipo\r\n'],
    };
    const x = m[tipo];
    if (!x) throw new ErroContabil(404, 'Modelo desconhecido.');
    return { nome: x[0], csv: '﻿' + x[1] };
  }
}

export { chaveUnica };
