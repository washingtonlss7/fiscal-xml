/**
 * Visões do escritório inteiro: Auditoria (apontamentos de todas as empresas), ICMS-ST (entradas interestaduais),
 * Certificados (validade de todos) e Relatórios (planilhas de cada módulo). Respeitam o escopo de empresas.
 */
import { Db, buscarTodos, ok } from '../db';
import { REGRAS } from '../auditoria/regras';
import { Aba } from '../painel/xlsx';
import { Escopo, ErroModulo, empresasDoEscopo, exigirMes, hojeSP, r2, somarDias } from './comum';
import { situacaoValidade, TIPOS_DOCUMENTO, ServicoSocietario } from './societario';
import { ServicoFinanceiro } from './financeiro';
import { CANAIS, DEPARTAMENTOS, PRIORIDADES, STATUS_CHAMADO, ServicoAtendimento } from './atendimento';
import { ServicoFolha } from './folha';

const limitesMes = (mes: string) => {
  const [a, m] = mes.split('-').map(Number);
  const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
  return { de: `${mes}-01T00:00:00-03:00`, ate: `${prox}-01T00:00:00-03:00` };
};

/* ---------- Auditoria do escritório ---------- */

export async function auditoriaEscritorio(db: Db, escopo: Escopo, mes: string) {
  exigirMes(mes);
  const emps = new Map((await empresasDoEscopo(db, escopo, true)).map((e) => [e.id, e]));
  const aps = await buscarTodos<any>((a, b) => db.from('apontamentos').select('empresa_id,regra,severidade,status,quantidade').eq('competencia', `${mes}-01`).range(a, b), 'apontamentos');
  const porRegra = new Map<string, any>(); const porEmpresa = new Map<string, any>();
  for (const x of aps) {
    if (!emps.has(x.empresa_id)) continue;
    const r = porRegra.get(x.regra) ?? { regra: x.regra, titulo: REGRAS[x.regra]?.titulo ?? x.regra, explicacao: REGRAS[x.regra]?.explicacao ?? '', severidade: x.severidade, abertos: 0, tratados: 0, empresas: new Set<string>() };
    if (x.status === 'aberto') { r.abertos++; r.empresas.add(x.empresa_id); } else r.tratados++;
    porRegra.set(x.regra, r);
    const e = porEmpresa.get(x.empresa_id) ?? { id: x.empresa_id, razao_social: emps.get(x.empresa_id)!.razao_social, cnpj: emps.get(x.empresa_id)!.cnpj, erros: 0, alertas: 0, info: 0, tratados: 0 };
    if (x.status !== 'aberto') e.tratados++;
    else if (x.severidade === 'erro') e.erros++; else if (x.severidade === 'alerta') e.alertas++; else e.info++;
    porEmpresa.set(x.empresa_id, e);
  }
  // Notas ainda não auditadas no mês (por empresa)
  const { de, ate } = limitesMes(mes);
  const naoAud = await buscarTodos<any>((a, b) => db.from('documentos').select('empresa_id').eq('auditado', false).gte('emitida_em', de).lt('emitida_em', ate).range(a, b), 'não auditadas');
  const pend = new Map<string, number>();
  for (const d of naoAud) if (emps.has(d.empresa_id)) pend.set(d.empresa_id, (pend.get(d.empresa_id) ?? 0) + 1);
  for (const [id, n] of pend) { const e = porEmpresa.get(id) ?? { id, razao_social: emps.get(id)!.razao_social, cnpj: emps.get(id)!.cnpj, erros: 0, alertas: 0, info: 0, tratados: 0 }; e.aguardando = n; porEmpresa.set(id, e); }
  const ordem = { erro: 0, alerta: 1, info: 2 } as Record<string, number>;
  const regras = [...porRegra.values()].map((r) => ({ ...r, empresas: r.empresas.size })).sort((a, b) => (ordem[a.severidade] ?? 3) - (ordem[b.severidade] ?? 3) || b.abertos - a.abertos);
  const empresas = [...porEmpresa.values()].map((e) => ({ aguardando: 0, ...e })).sort((a, b) => b.erros - a.erros || b.alertas - a.alertas || a.razao_social.localeCompare(b.razao_social));
  return {
    mes, regras, empresas,
    totais: { abertos: regras.reduce((t, r) => t + r.abertos, 0), tratados: regras.reduce((t, r) => t + r.tratados, 0), empresasComErro: empresas.filter((e) => e.erros).length, aguardando: empresas.reduce((t, e) => t + (e.aguardando ?? 0), 0) },
  };
}

/* ---------- ICMS-ST do escritório ---------- */

export async function stEscritorio(db: Db, escopo: Escopo, mes: string) {
  exigirMes(mes);
  const emps = await empresasDoEscopo(db, escopo, true);
  const { de, ate } = limitesMes(mes);
  const linhas = [];
  for (const e of emps) {
    const notas = await buscarTodos<any>((a, b) => db.from('documentos').select('uf_emit,valor,v_st,situacao').eq('empresa_id', e.id).eq('modelo', '55').eq('direcao', 'entrada')
      .gte('emitida_em', de).lt('emitida_em', ate).range(a, b), 'entradas');
    const validas = notas.filter((n) => n.situacao !== 'cancelada');
    const fora = validas.filter((n) => n.uf_emit && n.uf_emit !== e.uf);
    if (!validas.length) continue;
    linhas.push({
      id: e.id, razao_social: e.razao_social, cnpj: e.cnpj, uf: e.uf, entradas: validas.length, foraDoEstado: fora.length,
      valorForaDoEstado: r2(fora.reduce((t, n) => t + Number(n.valor ?? 0), 0)), stDestacado: r2(fora.reduce((t, n) => t + Number(n.v_st ?? 0), 0)),
      semStDestacado: fora.filter((n) => !Number(n.v_st)).length,
    });
  }
  const { count } = await db.from('st_es_regras').select('id', { count: 'exact', head: true });
  linhas.sort((a, b) => b.semStDestacado - a.semStDestacado || b.valorForaDoEstado - a.valorForaDoEstado);
  return { mes, empresas: linhas, regrasCadastradas: count ?? 0, totais: { foraDoEstado: linhas.reduce((t, l) => t + l.foraDoEstado, 0), semStDestacado: linhas.reduce((t, l) => t + l.semStDestacado, 0), valor: r2(linhas.reduce((t, l) => t + l.valorForaDoEstado, 0)) } };
}

/* ---------- Certificados ---------- */

export async function certificados(db: Db, escopo: Escopo) {
  const emps = await empresasDoEscopo(db, escopo);
  const certs = ok(await db.from('certificados').select('empresa_id,titular,valido_de,valido_ate,criado_em').eq('ativo', true).limit(20000), 'certificados') as any[];
  const porEmp = new Map(certs.map((c) => [c.empresa_id, c]));
  const hoje = hojeSP();
  const lista = emps.map((e) => {
    const c = porEmp.get(e.id);
    const validade = c?.valido_ate ? String(c.valido_ate).slice(0, 10) : null;
    const dias = validade ? Math.round((Date.parse(`${validade}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / 86400000) : null;
    const situacao = !c ? 'sem_certificado' : validade! < hoje ? 'vencido' : dias! <= 30 ? 'vencendo' : 'em_dia';
    return { id: e.id, razao_social: e.razao_social, cnpj: e.cnpj, ativo: e.ativo, titular: c?.titular ?? null, valido_ate: validade, dias, situacao };
  });
  const ordem = { vencido: 0, vencendo: 1, sem_certificado: 2, em_dia: 3 } as Record<string, number>;
  lista.sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || (a.dias ?? 99999) - (b.dias ?? 99999));
  return { certificados: lista, totais: { vencidos: lista.filter((c) => c.situacao === 'vencido').length, vencendo: lista.filter((c) => c.situacao === 'vencendo').length, sem: lista.filter((c) => c.situacao === 'sem_certificado').length, emDia: lista.filter((c) => c.situacao === 'em_dia').length } };
}

/* ---------- Relatórios ---------- */

export interface Relatorio { id: string; titulo: string; descricao: string; permissao: string; porMes: boolean }
export const RELATORIOS: Relatorio[] = [
  { id: 'empresas', titulo: 'Empresas', descricao: 'Cadastro das empresas: CNPJ, UF, regime, situação e certificado.', permissao: 'algum.ver', porMes: false },
  { id: 'certificados', titulo: 'Certificados', descricao: 'Validade dos certificados de todas as empresas.', permissao: 'administracao.empresas', porMes: false },
  { id: 'auditoria', titulo: 'Auditoria do mês', descricao: 'Apontamentos abertos e tratados por empresa e regra.', permissao: 'fiscal.ver', porMes: true },
  { id: 'icms_st', titulo: 'ICMS-ST do mês', descricao: 'Entradas de fora do estado e ST destacado por empresa.', permissao: 'fiscal.ver', porMes: true },
  { id: 'contabil_pendencias', titulo: 'Pendências do Contábil', descricao: 'Registros não contabilizados, por motivo e empresa.', permissao: 'contabil.ver', porMes: false },
  { id: 'folha', titulo: 'Folha do mês', descricao: 'Etapas da folha de cada empresa no mês.', permissao: 'folha.ver', porMes: true },
  { id: 'vencimentos', titulo: 'Vencimentos do societário', descricao: 'Alvarás, licenças e certidões vencidos e a vencer em 90 dias.', permissao: 'societario.ver', porMes: false },
  { id: 'honorarios', titulo: 'Honorários do mês', descricao: 'Cobranças do mês com situação e recebimentos.', permissao: 'financeiro.ver', porMes: true },
  { id: 'inadimplencia', titulo: 'Inadimplência', descricao: 'Cobranças atrasadas por cliente.', permissao: 'financeiro.ver', porMes: false },
  { id: 'chamados', titulo: 'Chamados em aberto', descricao: 'Chamados ativos com departamento, responsável e prazo.', permissao: 'atendimento.ver', porMes: false },
];

const doc = (d: string | null) => (d && d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d ?? '');
const REGIME: Record<string, string> = { simples: 'Simples Nacional', mei: 'MEI', presumido: 'Lucro Presumido', real: 'Lucro Real' };

export async function gerarRelatorio(db: Db, deps: { folha: ServicoFolha; societario: ServicoSocietario; financeiro: ServicoFinanceiro; atendimento: ServicoAtendimento }, id: string, escopo: Escopo, mes: string | null): Promise<{ nome: string; abas: Aba[] }> {
  const rel = RELATORIOS.find((r) => r.id === id);
  if (!rel) throw new ErroModulo(404, 'Relatório não encontrado.');
  if (rel.porMes) exigirMes(mes);
  const sufixo = rel.porMes ? `_${mes}` : `_${hojeSP()}`;
  const nome = `${rel.id}${sufixo}.xlsx`;
  const cab = (t: string) => [rel.porMes ? `${rel.titulo} · ${mes!.slice(5)}/${mes!.slice(0, 4)}` : rel.titulo, t];
  if (id === 'empresas') {
    const c = await certificados(db, escopo);
    const emps = await empresasDoEscopo(db, escopo);
    const cert = new Map(c.certificados.map((x) => [x.id, x]));
    return { nome, abas: [{ nome: 'Empresas', cabecalho: cab(`${emps.length} empresas`), colunas: [{ titulo: 'Razão social', tipo: 'texto', largura: 40 }, { titulo: 'CNPJ', tipo: 'texto', largura: 20 }, { titulo: 'UF', tipo: 'texto', largura: 5 }, { titulo: 'Regime', tipo: 'texto', largura: 18 }, { titulo: 'Ativa', tipo: 'texto', largura: 7 }, { titulo: 'Certificado válido até', tipo: 'data', largura: 14 }],
      linhas: emps.map((e) => [e.razao_social, doc(e.cnpj), e.uf, REGIME[e.regime ?? ''] ?? '', e.ativo ? 'Sim' : 'Não', cert.get(e.id)?.valido_ate ?? null]) }] };
  }
  if (id === 'certificados') {
    const c = await certificados(db, escopo);
    const sit: Record<string, string> = { vencido: 'Vencido', vencendo: 'Vence em até 30 dias', sem_certificado: 'Sem certificado', em_dia: 'Em dia' };
    return { nome, abas: [{ nome: 'Certificados', cabecalho: cab(`${c.totais.vencidos} vencidos · ${c.totais.vencendo} vencendo · ${c.totais.sem} sem certificado`), colunas: [{ titulo: 'Empresa', tipo: 'texto', largura: 40 }, { titulo: 'CNPJ', tipo: 'texto', largura: 20 }, { titulo: 'Titular', tipo: 'texto', largura: 36 }, { titulo: 'Válido até', tipo: 'data', largura: 12 }, { titulo: 'Dias', tipo: 'inteiro', largura: 8 }, { titulo: 'Situação', tipo: 'texto', largura: 20 }],
      linhas: c.certificados.map((x) => [x.razao_social, doc(x.cnpj), x.titular ?? '', x.valido_ate, x.dias, sit[x.situacao]]) }] };
  }
  if (id === 'auditoria') {
    const a = await auditoriaEscritorio(db, escopo, mes!);
    return { nome, abas: [
      { nome: 'Por empresa', cabecalho: cab(`${a.totais.abertos} apontamentos abertos`), colunas: [{ titulo: 'Empresa', tipo: 'texto', largura: 40 }, { titulo: 'CNPJ', tipo: 'texto', largura: 20 }, { titulo: 'Erros', tipo: 'inteiro', total: true }, { titulo: 'Alertas', tipo: 'inteiro', total: true }, { titulo: 'Info', tipo: 'inteiro', total: true }, { titulo: 'Tratados', tipo: 'inteiro', total: true }, { titulo: 'Notas não auditadas', tipo: 'inteiro', total: true }],
        linhas: a.empresas.map((e) => [e.razao_social, doc(e.cnpj), e.erros, e.alertas, e.info, e.tratados, e.aguardando ?? 0]) },
      { nome: 'Por regra', colunas: [{ titulo: 'Regra', tipo: 'texto', largura: 40 }, { titulo: 'Severidade', tipo: 'texto', largura: 10 }, { titulo: 'Abertos', tipo: 'inteiro', total: true }, { titulo: 'Tratados', tipo: 'inteiro', total: true }, { titulo: 'Empresas', tipo: 'inteiro' }],
        linhas: a.regras.map((r) => [r.titulo, r.severidade, r.abertos, r.tratados, r.empresas]) },
    ] };
  }
  if (id === 'icms_st') {
    const s = await stEscritorio(db, escopo, mes!);
    return { nome, abas: [{ nome: 'ICMS-ST', cabecalho: cab(`${s.totais.foraDoEstado} entradas de fora do estado`), colunas: [{ titulo: 'Empresa', tipo: 'texto', largura: 40 }, { titulo: 'CNPJ', tipo: 'texto', largura: 20 }, { titulo: 'Entradas', tipo: 'inteiro', total: true }, { titulo: 'De fora do estado', tipo: 'inteiro', total: true }, { titulo: 'Valor de fora', tipo: 'moeda', total: true, largura: 16 }, { titulo: 'ST destacado', tipo: 'moeda', total: true, largura: 14 }, { titulo: 'Sem ST destacado', tipo: 'inteiro', total: true }],
      linhas: s.empresas.map((e) => [e.razao_social, doc(e.cnpj), e.entradas, e.foraDoEstado, e.valorForaDoEstado, e.stDestacado, e.semStDestacado]) }] };
  }
  if (id === 'contabil_pendencias') {
    const movs = await buscarTodos<any>((a, b) => db.from('ctb_movimentos').select('ctb_empresa_id,origem,competencia,documento,cfop,rubrica,descricao,valor,erro_codigo,erro_detalhe').neq('status', 'ok').order('id').range(a, b), 'pendências');
    const ctb = new Map((ok(await db.from('ctb_empresas').select('id,codigo_dominio,razao_social,empresa_id').limit(10000), 'empresas do Contábil') as any[]).map((e) => [e.id, e]));
    const vis = movs.filter((m) => !escopo || (m.ctb_empresa_id && escopo.has(ctb.get(m.ctb_empresa_id)?.empresa_id)));
    return { nome, abas: [{ nome: 'Pendências', cabecalho: cab(`${vis.length} registros não contabilizados`), colunas: [{ titulo: 'Código', tipo: 'texto', largura: 9 }, { titulo: 'Empresa', tipo: 'texto', largura: 36 }, { titulo: 'Origem', tipo: 'texto', largura: 8 }, { titulo: 'Competência', tipo: 'data', largura: 12 }, { titulo: 'Documento', tipo: 'texto', largura: 18 }, { titulo: 'CFOP/Rubrica', tipo: 'texto', largura: 12 }, { titulo: 'Valor', tipo: 'moeda', total: true, largura: 14 }, { titulo: 'Motivo', tipo: 'texto', largura: 22 }, { titulo: 'Detalhe', tipo: 'texto', largura: 40 }],
      linhas: vis.map((m) => { const e = ctb.get(m.ctb_empresa_id); return [e?.codigo_dominio ?? '', e?.razao_social ?? '', m.origem, m.competencia, m.documento ?? '', m.cfop ?? m.rubrica ?? '', m.valor == null ? null : Number(m.valor), m.erro_codigo, m.erro_detalhe ?? m.descricao ?? '']; }) }] };
  }
  if (id === 'folha') {
    const p = await deps.folha.painel(mes!, escopo);
    const st: Record<string, string> = { feito: 'Feito', nao_se_aplica: 'Não se aplica', pendente: 'Pendente' };
    return { nome, abas: [{ nome: 'Folha', cabecalho: cab(`${p.totais.concluidas} de ${p.totais.empresas} empresas concluídas`), colunas: [{ titulo: 'Empresa', tipo: 'texto', largura: 36 }, { titulo: 'CNPJ', tipo: 'texto', largura: 20 }, ...p.etapas.map((e) => ({ titulo: e.nome, tipo: 'texto' as const, largura: 16 })), { titulo: 'Rubricas', tipo: 'inteiro' as const }, { titulo: 'Valor das rubricas', tipo: 'moeda' as const, largura: 16 }],
      linhas: p.empresas.map((l) => [l.empresa.razao_social, doc(l.empresa.cnpj), ...p.etapas.map((e) => st[l.etapas[e.id]?.status ?? 'pendente']), l.rubricas?.quantidade ?? null, l.rubricas?.valor ?? null]) }] };
  }
  if (id === 'vencimentos') {
    const v = await deps.societario.vencimentos(escopo, 90);
    const sit: Record<string, string> = { vencido: 'Vencido', vencendo: 'Vence em até 30 dias', em_dia: 'Vence em até 90 dias', sem_validade: '' };
    return { nome, abas: [{ nome: 'Vencimentos', cabecalho: cab(`${v.filter((x) => x.situacao === 'vencido').length} vencidos`), colunas: [{ titulo: 'Empresa', tipo: 'texto', largura: 36 }, { titulo: 'CNPJ', tipo: 'texto', largura: 20 }, { titulo: 'Documento', tipo: 'texto', largura: 28 }, { titulo: 'Número', tipo: 'texto', largura: 16 }, { titulo: 'Validade', tipo: 'data', largura: 12 }, { titulo: 'Situação', tipo: 'texto', largura: 20 }],
      linhas: v.map((x) => [x.empresa, doc(x.cnpj), `${TIPOS_DOCUMENTO[x.tipo] ?? x.tipo}${x.descricao ? ` · ${x.descricao}` : ''}`, x.numero ?? '', x.validade, sit[x.situacao]]) }] };
  }
  if (id === 'honorarios') {
    const t = await deps.financeiro.titulos(escopo, { mes: mes! });
    const sit: Record<string, string> = { aberto: 'Em aberto', atrasado: 'Atrasado', pago: 'Pago', cancelado: 'Cancelado' };
    return { nome, abas: [{ nome: 'Honorários', cabecalho: cab(`${t.length} cobranças com vencimento no mês`), colunas: [{ titulo: 'Cliente', tipo: 'texto', largura: 36 }, { titulo: 'Descrição', tipo: 'texto', largura: 30 }, { titulo: 'Vencimento', tipo: 'data', largura: 12 }, { titulo: 'Valor', tipo: 'moeda', total: true, largura: 14 }, { titulo: 'Situação', tipo: 'texto', largura: 12 }, { titulo: 'Pago em', tipo: 'data', largura: 12 }, { titulo: 'Valor pago', tipo: 'moeda', total: true, largura: 14 }, { titulo: 'Forma', tipo: 'texto', largura: 12 }],
      linhas: t.map((x) => [x.empresa, x.descricao, x.vencimento, x.valor, sit[x.situacao], x.pago_em, x.valor_pago, x.forma ?? '']) }] };
  }
  if (id === 'inadimplencia') {
    const t = await deps.financeiro.titulos(escopo, { status: 'atrasado' });
    return { nome, abas: [{ nome: 'Inadimplência', cabecalho: cab(`${t.length} cobranças atrasadas`), colunas: [{ titulo: 'Cliente', tipo: 'texto', largura: 36 }, { titulo: 'Descrição', tipo: 'texto', largura: 30 }, { titulo: 'Vencimento', tipo: 'data', largura: 12 }, { titulo: 'Dias de atraso', tipo: 'inteiro', largura: 10 }, { titulo: 'Valor', tipo: 'moeda', total: true, largura: 14 }],
      linhas: t.map((x) => [x.empresa, x.descricao, x.vencimento, Math.round((Date.parse(`${hojeSP()}T12:00:00Z`) - Date.parse(`${x.vencimento}T12:00:00Z`)) / 86400000), x.valor]) }] };
  }
  if (id === 'chamados') {
    const c = await deps.atendimento.listar(escopo, { status: 'ativos' });
    return { nome, abas: [{ nome: 'Chamados', cabecalho: cab(`${c.length} chamados ativos · ${c.filter((x) => x.atrasado).length} atrasados`), colunas: [{ titulo: 'Nº', tipo: 'inteiro', largura: 7 }, { titulo: 'Cliente', tipo: 'texto', largura: 32 }, { titulo: 'Assunto', tipo: 'texto', largura: 40 }, { titulo: 'Departamento', tipo: 'texto', largura: 14 }, { titulo: 'Prioridade', tipo: 'texto', largura: 10 }, { titulo: 'Situação', tipo: 'texto', largura: 18 }, { titulo: 'Responsável', tipo: 'texto', largura: 28 }, { titulo: 'Prazo', tipo: 'data', largura: 12 }, { titulo: 'Canal', tipo: 'texto', largura: 11 }, { titulo: 'Aberto em', tipo: 'data', largura: 12 }],
      linhas: c.map((x) => [Number(x.id), x.empresa ?? '', x.assunto, DEPARTAMENTOS[x.departamento], PRIORIDADES[x.prioridade], STATUS_CHAMADO[x.status], x.responsavel ?? '', x.prazo, CANAIS[x.canal], String(x.criado_em).slice(0, 10)]) }] };
  }
  throw new ErroModulo(404, 'Relatório não encontrado.');
}

export { situacaoValidade, somarDias };
