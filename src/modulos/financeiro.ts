/**
 * Financeiro do escritório: contratos de honorários por cliente, cobranças (títulos) geradas mês a mês, baixa de
 * pagamento, inadimplência. Não emite boleto/PIX nesta versão (o controle é das cobranças e recebimentos).
 */
import { Db, buscarTodos, ok } from '../db';
import { Escopo, ErroModulo, dataOpcional, empresasDoEscopo, exigirEmpresaNoEscopo, exigirMes, hojeSP, numeroOpcional, r2, txt } from './comum';

export const FORMAS = ['pix', 'boleto', 'transferencia', 'dinheiro', 'cartao', 'outro'];

/** Vencimento do título: dia do contrato no mês informado (dia 1 a 28 existe em todo mês). */
export const vencimentoNoMes = (mes: string, dia: number) => `${mes}-${String(dia).padStart(2, '0')}`;

/** O contrato vale no mês? (começou até o fim do mês e não terminou antes do começo). */
export function contratoNoMes(c: { inicio: string; fim: string | null; ativo: boolean }, mes: string): boolean {
  if (!c.ativo) return false;
  const ini = `${mes}-01`; const [a, m] = mes.split('-').map(Number);
  const fim = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
  return c.inicio <= fim && (!c.fim || c.fim >= ini);
}

export function situacaoTitulo(t: { status: string; vencimento: string }, hoje = hojeSP()) {
  if (t.status !== 'aberto') return t.status;
  return t.vencimento < hoje ? 'atrasado' : 'aberto';
}

export class ServicoFinanceiro {
  constructor(private readonly db: Db) {}

  async contratos(escopo: Escopo) {
    const emps = new Map((await empresasDoEscopo(this.db, escopo)).map((e) => [e.id, e]));
    const l = ok(await this.db.from('fin_contratos').select('*').order('criado_em').limit(10000), 'contratos') as any[];
    return l.filter((c) => emps.has(c.empresa_id)).map((c) => ({ ...c, valor_mensal: Number(c.valor_mensal), empresa: emps.get(c.empresa_id)!.razao_social, cnpj: emps.get(c.empresa_id)!.cnpj }));
  }

  async salvarContrato(por: string, escopo: Escopo, d: Record<string, unknown>) {
    const empresa = String(d.empresa_id ?? '');
    exigirEmpresaNoEscopo(escopo, empresa);
    const valor = numeroOpcional(d.valor_mensal, 'Valor mensal');
    if (!valor || valor <= 0) throw new ErroModulo(400, 'Informe o valor mensal.');
    const dia = Number(d.dia_vencimento);
    if (!Number.isInteger(dia) || dia < 1 || dia > 28) throw new ErroModulo(400, 'Dia de vencimento entre 1 e 28.');
    const inicio = dataOpcional(d.inicio, 'Início');
    if (!inicio) throw new ErroModulo(400, 'Informe o início do contrato.');
    const fim = dataOpcional(d.fim, 'Fim');
    if (fim && fim < inicio) throw new ErroModulo(400, 'O fim é antes do início.');
    const mesR = d.mes_reajuste ? Number(d.mes_reajuste) : null;
    if (mesR !== null && (!Number.isInteger(mesR) || mesR < 1 || mesR > 12)) throw new ErroModulo(400, 'Mês de reajuste inválido.');
    const linha = { empresa_id: empresa, descricao: txt(d.descricao, 200) ?? 'Honorários mensais', valor_mensal: r2(valor), dia_vencimento: dia, inicio, fim, indice_reajuste: txt(d.indice_reajuste, 40), mes_reajuste: mesR, ativo: d.ativo !== false, observacao: txt(d.observacao, 1000), atualizado_em: new Date().toISOString() };
    if (d.id) { ok(await this.db.from('fin_contratos').update(linha).eq('id', Number(d.id)), 'editar contrato'); return { id: Number(d.id) }; }
    const r = ok(await this.db.from('fin_contratos').insert({ ...linha, criado_por: por }).select('id'), 'criar contrato') as any[];
    return { id: r[0]?.id };
  }

  /** Gera as cobranças do mês para os contratos vigentes (não duplica: uma por contrato e mês). */
  async gerarCobrancas(por: string, escopo: Escopo, mes: string) {
    exigirMes(mes);
    const contratos = (await this.contratos(escopo)).filter((c) => contratoNoMes(c, mes));
    const comp = `${mes}-01`;
    const ja = new Set((ok(await this.db.from('fin_titulos').select('contrato_id').eq('competencia', comp).not('contrato_id', 'is', null).limit(20000), 'cobranças do mês') as any[]).map((t) => Number(t.contrato_id)));
    const novos = contratos.filter((c) => !ja.has(Number(c.id))).map((c) => ({
      contrato_id: c.id, empresa_id: c.empresa_id, competencia: comp, descricao: `${c.descricao} ${mes.slice(5)}/${mes.slice(0, 4)}`, valor: c.valor_mensal,
      vencimento: vencimentoNoMes(mes, c.dia_vencimento), status: 'aberto', criado_por: por,
    }));
    for (let i = 0; i < novos.length; i += 500) ok(await this.db.from('fin_titulos').insert(novos.slice(i, i + 500)), 'gerar cobranças');
    return { geradas: novos.length, jaExistiam: contratos.length - novos.length };
  }

  async titulos(escopo: Escopo, f: { mes?: string | null; status?: string | null; empresa?: string | null }) {
    const emps = new Map((await empresasDoEscopo(this.db, escopo)).map((e) => [e.id, e]));
    const l = await buscarTodos<any>((a, b) => {
      let q = this.db.from('fin_titulos').select('*').order('vencimento');
      if (f.mes) { const [y, m] = f.mes.split('-').map(Number); q = q.gte('vencimento', `${f.mes}-01`).lte('vencimento', new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)); }
      if (f.status === 'aberto' || f.status === 'atrasado') q = q.eq('status', 'aberto');
      else if (f.status === 'pago' || f.status === 'cancelado') q = q.eq('status', f.status);
      if (f.empresa) q = q.eq('empresa_id', f.empresa);
      return q.range(a, b);
    }, 'cobranças');
    const hoje = hojeSP();
    return l.filter((t) => emps.has(t.empresa_id)).map((t) => ({ ...t, valor: Number(t.valor), valor_pago: t.valor_pago == null ? null : Number(t.valor_pago), situacao: situacaoTitulo(t, hoje), empresa: emps.get(t.empresa_id)!.razao_social }))
      .filter((t) => f.status !== 'atrasado' || t.situacao === 'atrasado');
  }

  async resumo(escopo: Escopo, mes: string) {
    exigirMes(mes);
    const doMes = await this.titulos(escopo, { mes });
    const abertos = await this.titulos(escopo, { status: 'atrasado' });
    const soma = (l: any[], k = 'valor') => r2(l.reduce((t, x) => t + Number(x[k] ?? 0), 0));
    const porCliente = new Map<string, { empresa: string; titulos: number; valor: number; maisAntigo: string }>();
    for (const t of abertos) {
      const c = porCliente.get(t.empresa_id) ?? { empresa: t.empresa, titulos: 0, valor: 0, maisAntigo: t.vencimento };
      c.titulos++; c.valor = r2(c.valor + t.valor); if (t.vencimento < c.maisAntigo) c.maisAntigo = t.vencimento;
      porCliente.set(t.empresa_id, c);
    }
    return {
      mes,
      previsto: soma(doMes.filter((t) => t.status !== 'cancelado')),
      recebido: soma(doMes.filter((t) => t.status === 'pago'), 'valor_pago'),
      emAberto: soma(doMes.filter((t) => t.status === 'aberto')),
      atrasadoTotal: soma(abertos),
      inadimplentes: [...porCliente.entries()].map(([id, v]) => ({ empresa_id: id, ...v })).sort((a, b) => b.valor - a.valor),
      contratosAtivos: (await this.contratos(escopo)).filter((c) => contratoNoMes(c, mes)).length,
    };
  }

  async criarAvulso(por: string, escopo: Escopo, d: Record<string, unknown>) {
    const empresa = String(d.empresa_id ?? '');
    exigirEmpresaNoEscopo(escopo, empresa);
    const valor = numeroOpcional(d.valor, 'Valor');
    if (!valor || valor <= 0) throw new ErroModulo(400, 'Informe o valor.');
    const venc = dataOpcional(d.vencimento, 'Vencimento');
    if (!venc) throw new ErroModulo(400, 'Informe o vencimento.');
    const descricao = txt(d.descricao, 200);
    if (!descricao) throw new ErroModulo(400, 'Informe a descrição (ex.: abertura de empresa, IRPF).');
    const r = ok(await this.db.from('fin_titulos').insert({ contrato_id: null, empresa_id: empresa, competencia: `${venc.slice(0, 7)}-01`, descricao, valor: r2(valor), vencimento: venc, status: 'aberto', observacao: txt(d.observacao, 500), criado_por: por }).select('id'), 'cobrança avulsa') as any[];
    return { id: r[0]?.id };
  }

  private async titulo(escopo: Escopo, id: number) {
    const t = ok(await this.db.from('fin_titulos').select('id,empresa_id,status,valor').eq('id', id).maybeSingle(), 'cobrança') as any;
    if (!t) throw new ErroModulo(404, 'Cobrança não encontrada.');
    exigirEmpresaNoEscopo(escopo, t.empresa_id);
    return t;
  }

  async baixar(por: string, escopo: Escopo, id: number, d: Record<string, unknown>) {
    const t = await this.titulo(escopo, id);
    if (t.status !== 'aberto') throw new ErroModulo(409, 'Só cobrança em aberto recebe baixa.');
    const pago = dataOpcional(d.pago_em, 'Data do pagamento') ?? hojeSP();
    const valor = numeroOpcional(d.valor_pago, 'Valor pago') ?? Number(t.valor);
    if (valor <= 0) throw new ErroModulo(400, 'Valor pago inválido.');
    const forma = FORMAS.includes(String(d.forma)) ? String(d.forma) : 'outro';
    ok(await this.db.from('fin_titulos').update({ status: 'pago', pago_em: pago, valor_pago: r2(valor), forma, observacao: txt(d.observacao, 500) ?? undefined }).eq('id', id), 'baixar cobrança');
    return { ok: true, por };
  }

  async alterarStatus(escopo: Escopo, id: number, status: 'aberto' | 'cancelado') {
    await this.titulo(escopo, id);
    ok(await this.db.from('fin_titulos').update({ status, pago_em: null, valor_pago: null, forma: null }).eq('id', id), 'alterar cobrança');
  }
}
