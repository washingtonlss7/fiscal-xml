/**
 * Apuração do Simples (etapa B): segregação da receita por atividade e qualificação, alertas e o corpo
 * da declaração no formato do PGDAS-D. Serviço com banco falso: matriz + filial, devoluções, ajustes.
 *
 *   npx tsx test/simples.test.ts
 */
import assert from 'assert';
import { apurarEstabelecimento, lacunasNumeracao, montarDeclaracao, NotaSaida, qualificar, tipoCfop, valorItem } from '../src/fiscal/simples';
import { ServicoApuracao } from '../src/painel/apuracao';
import { bancoFalso } from './banco-falso';

const CNPJ = '55885998000140';
let seqItem = 0;
const item = (x: Partial<NotaSaida['itens'][number]> = {}) => ({
  n_item: ++seqItem, cfop: '5102', ncm: '21069090', cest: null, ean: null, x_prod: 'PRODUTO', cst_icms: '102', csosn: true, cst_pis: '49',
  v_prod: 100, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, ...x,
});
const nota = (numero: number, itens: any[], x: Partial<NotaSaida> = {}): NotaSaida => ({
  chave: `3226095588599800014065001${String(numero).padStart(9, '0')}1000000000`.slice(0, 44), modelo: '65', serie: '1', numero: String(numero),
  situacao: 'autorizada', completo: true, tp_nf: 1, fin_nfe: 1, emit_cnpj: CNPJ, valor: itens.reduce((t, i) => t + valorItem(i), 0), itens, ...x,
});
const ctx = (x: any = {}) => ({ cnpj: CNPJ, naTabelaSt: () => false, compradoComSt: () => false, ...x });

// 1) Regras puras
{
  assert.deepEqual([tipoCfop('5102').tipo, tipoCfop('5405').tipo, tipoCfop('6108').tipo, tipoCfop('7102').tipo], ['venda', 'venda', 'venda', 'exportacao']);
  assert.deepEqual([tipoCfop('5910').tipo, tipoCfop('5152').tipo, tipoCfop('5202').tipo, tipoCfop('5949').tipo], ['fora', 'fora', 'fora', 'fora']);
  assert.match(tipoCfop('5910').motivo!, /bonificação/); assert.match(tipoCfop('5202').motivo!, /Devolução de compra/);
  assert.equal(tipoCfop('5999').tipo, 'desconhecido'); assert.equal(tipoCfop(null).tipo, 'desconhecido');
  assert.equal(valorItem({ v_prod: 100, v_desc: 10, v_frete: 5, v_seg: 1, v_outro: 0.5 }), 96.5, 'desconto incondicional reduz; frete/seguro/outras somam');
  assert.deepEqual(qualificar({ cst_icms: '500', csosn: true, ncm: '30049099' }), { st: true, monofasico: true, substituto: false });
  assert.deepEqual(qualificar({ cst_icms: '102', csosn: true, ncm: '33049910' }), { st: false, monofasico: true, substituto: false }, 'perfumaria: monofásico pelo NCM');
  assert.deepEqual(qualificar({ cst_icms: '60', csosn: false, ncm: '21069090' }), { st: true, monofasico: false, substituto: false });
  assert.equal(qualificar({ cst_icms: '202', csosn: true, ncm: null }).substituto, true);
  assert.equal(qualificar({ cst_icms: '30049046', csosn: true, ncm: '30049046' }).monofasico, false, 'exceção da lista de monofásicos');
  assert.deepEqual(lacunasNumeracao([{ modelo: '65', serie: '1', numero: '10' }, { modelo: '65', serie: '1', numero: '13' }, { modelo: '65', serie: '1', numero: '14' }, { modelo: '65', serie: '2', numero: '1' }]),
    [{ modelo: '65', serie: '1', de: 10, ate: 14, faltam: 2, exemplos: [11, 12] }]);
  console.log('ok  CFOP de receita, valor do item, qualificação (ST pelo CSOSN, monofásico pelo NCM) e lacunas de numeração');
}

// 2) Segregação de uma farmácia
{
  const notas = [
    nota(1, [item({ ncm: '30049099', cst_icms: '500', v_prod: 200 }), item({ ncm: '33049910', v_prod: 50, v_desc: 5 }), item({ v_prod: 30 })]), // ST+mono, mono, tributado
    nota(2, [item({ cst_icms: '500', ncm: '21069090', v_prod: 80 }), item({ cfop: '5910', v_prod: 999 })]), // ST; bonificação fica fora
    nota(4, [item({ v_prod: 70 })], { situacao: 'cancelada' }), // cancelada: fora
    nota(5, [item({ cfop: '5405', cst_icms: '102', v_prod: 40 })]), // CFOP de ST com CSOSN tributado: alerta
    nota(6, [item({ ncm: '22021000', v_prod: 20, ean: '7891000100103' })]), // bebida fria: monofásico
    nota(7, [item({ cfop: '5999', v_prod: 15 })]), // CFOP desconhecido
    nota(8, [], { completo: false, valor: 60 }), // só resumo
    nota(9, [item({ ncm: '85131010', v_prod: 25, ean: '789' })]), // tributado, mas comprado com ST
    nota(10, [item({ cfop: '7102', v_prod: 300 })], { modelo: '55' }), // exportação
    // Devolução emitida pela própria empresa (entrada, 1.411) de produto com ST e monofásico
    nota(11, [item({ cfop: '1411', ncm: '30049099', cst_icms: '500', v_prod: 20 })], { tp_nf: 0, modelo: '55' }),
    // Nota de terceiro no mesmo lote (não é da empresa): ignorada
    nota(12, [item({ v_prod: 500 })], { emit_cnpj: '11111111000191' }),
  ];
  const devTerceiro = [nota(1, [item({ cfop: '5202', v_prod: 10 })], { emit_cnpj: '22222222000191', tp_nf: 1, fin_nfe: 4, modelo: '55' })];
  const r = apurarEstabelecimento(notas, devTerceiro, [{ valor: 150, atividade: 1, st: false, monofasico: false, justificativa: 'Serviço de aplicação de injetável (NFS-e 12)' }],
    ctx({ compradoComSt: (i: any) => i.ean === '789' }));
  const g = Object.fromEntries(r.grupos.map((x) => [x.chave, x]));
  assert.equal(g.a2_st_mono.vendas, 200); assert.equal(g.a2_st_mono.devolucoes, 20); assert.equal(g.a2_st_mono.valor, 180);
  assert.equal(g.a2_mono.valor, 65, 'perfumaria 45 + bebida fria 20');
  assert.equal(g.a2_st.valor, 80);
  assert.equal(g.a1.vendas, 30 + 40 + 60 + 25, 'tributado + CFOP ST sem CSOSN + só resumo + comprado com ST');
  assert.equal(g.a1.devolucoes, 10, 'devolução do cliente (5.202) deduzida');
  assert.equal(g.a1.ajustes, 150); assert.equal(g.a1.valor, 155 - 10 + 150);
  assert.equal(g.a3.valor, 300);
  assert.equal(r.receita, 180 + 65 + 80 + 295 + 300);
  assert.deepEqual(r.notas, { saida: 8, canceladas: 1, soResumo: 1, devolucao: 2 });
  assert.deepEqual(r.fora.map((f) => [f.motivo.slice(0, 18), f.valor]), [['Remessa / retorno ', 999], ['CFOP sem classific', 15]]);
  const tipos = r.alertas.map((a) => a.tipo);
  for (const t of ['so_resumo', 'cfop_st_sem_csosn', 'st_nao_aplicada', 'cfop_desconhecido', 'numeracao', 'devolucoes']) assert.ok(tipos.includes(t), `alerta ${t}`);
  assert.ok(!tipos.includes('sem_notas'));
  assert.match(r.alertas.find((a) => a.tipo === 'st_nao_aplicada')!.detalhe, /comprado com ST/);
  assert.equal(r.alertas.find((a) => a.tipo === 'numeracao')!.quantidade, 1, 'falta a NFC-e 3');
  assert.deepEqual(g.a2_st_mono.ncms, [{ ncm: '30049099', produto: 'PRODUTO', valor: 200 }]);

  // Declaração no formato do PGDAS-D
  const d = montarDeclaracao([r]);
  assert.equal(d.receitaPaCompetenciaInterno, 180 + 65 + 80 + 295); assert.equal(d.receitaPaCompetenciaExterno, 300);
  const at = d.estabelecimentos[0].atividades!;
  assert.deepEqual(at.map((a) => [a.idAtividade, a.valorAtividade]), [[1, 295], [2, 325], [3, 300]]);
  const a2 = at.find((a) => a.idAtividade === 2)!;
  assert.deepEqual(a2.receitasAtividade.map((x: any) => [x.valor, x.qualificacoesTributarias.map((q: any) => `${q.codigoTributo}:${q.id}`).join(' ')]),
    [[80, '1007:8'], [65, '1004:9 1005:9'], [180, '1007:8 1004:9 1005:9']]);
  assert.ok(!('qualificacoesTributarias' in at[0].receitasAtividade[0]), 'atividade 1 sem qualificação');

  // Sem notas, e devolução maior que a venda
  const vazio = apurarEstabelecimento([], [], [], ctx());
  assert.equal(vazio.alertas[0].tipo, 'sem_notas'); assert.equal(vazio.alertas[0].nivel, 'erro');
  assert.deepEqual(montarDeclaracao([vazio]).estabelecimentos, [{ cnpjCompleto: CNPJ }], 'estabelecimento sem atividade vai sem "atividades"');
  const neg = apurarEstabelecimento([nota(1, [item({ v_prod: 10 })]), nota(2, [item({ cfop: '1202', v_prod: 50 })], { tp_nf: 0 })], [], [], ctx());
  assert.ok(neg.alertas.some((a) => a.tipo === 'grupo_negativo' && a.nivel === 'erro'));
  console.log('ok  segregação: ST, monofásico, ST+monofásico, exportação, fora da receita, devoluções, ajustes, alertas e declaração do PGDAS-D');
}

// 3) Serviço: matriz + filial, compras com ST, ajustes e comparação
async function testeServico() {
  const { db, t } = bancoFalso(['empresas', 'documentos', 'documento_itens', 'st_es_regras', 'apuracao_ajustes', 'sped_arquivos']);
  const M = { id: '11111111-1111-1111-1111-111111111111', cnpj: '55885998000140', razao_social: 'FARMA DIGITAL LTDA', regime: 'simples', ativo: true };
  const F = { id: '22222222-2222-2222-2222-222222222222', cnpj: '55885998000221', razao_social: 'FARMA DIGITAL LTDA - FILIAL', regime: 'simples', ativo: true };
  const O = { id: '33333333-3333-3333-3333-333333333333', cnpj: '55885998000302', razao_social: 'FARMA DIGITAL - PRESUMIDO', regime: 'presumido', ativo: true };
  const P = { id: '44444444-4444-4444-4444-444444444444', cnpj: '11222333000181', razao_social: 'PADARIA', regime: 'presumido', ativo: true };
  t.empresas.push(F, M, O, P);
  const doc = (e: any, chave: string, x: any) => t.documentos.push({ empresa_id: e.id, chave, modelo: '65', serie: '1', situacao: 'autorizada', completo: true, tp_nf: 1, fin_nfe: 1, emit_cnpj: e.cnpj, direcao: 'saida', ...x });
  const it = (e: any, chave: string, x: any) => t.documento_itens.push({ empresa_id: e.id, chave, n_item: 1, cfop: '5102', ncm: '21069090', cest: null, ean: null, x_prod: 'X', cst_icms: '102', csosn: true, cst_pis: '49', v_prod: 0, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, ...x });
  doc(M, 'm1'.padEnd(44, '0'), { numero: '1', valor: 100, emitida_em: '2026-09-05T10:00:00-03:00' }); it(M, 'm1'.padEnd(44, '0'), { v_prod: 100, ncm: '30049099', cst_icms: '500' });
  doc(M, 'm2'.padEnd(44, '0'), { numero: '2', valor: 40, emitida_em: '2026-09-06T10:00:00-03:00' }); it(M, 'm2'.padEnd(44, '0'), { v_prod: 40, ncm: '96190000', cest: '2004800', ean: '7890000000001' });
  doc(M, 'm0'.padEnd(44, '0'), { numero: '9', valor: 999, emitida_em: '2026-08-31T23:00:00-03:00' }); // mês anterior
  doc(F, 'f1'.padEnd(44, '0'), { numero: '1', valor: 60, emitida_em: '2026-09-10T10:00:00-03:00' }); it(F, 'f1'.padEnd(44, '0'), { v_prod: 60 });
  doc(O, 'o1'.padEnd(44, '0'), { numero: '1', valor: 5000, emitida_em: '2026-09-10T10:00:00-03:00' }); it(O, 'o1'.padEnd(44, '0'), { v_prod: 5000 });
  // Compra com ST (EAN) na matriz em julho; tabela de ST com o CEST do absorvente
  t.documentos.push({ empresa_id: M.id, chave: 'c1'.padEnd(44, '0'), modelo: '55', direcao: 'entrada', completo: true, emitida_em: '2026-07-10T10:00:00-03:00', situacao: 'autorizada', emit_cnpj: '99999999000191', tp_nf: 1 });
  t.documento_itens.push({ empresa_id: M.id, chave: 'c1'.padEnd(44, '0'), n_item: 1, ean: '7890000000001', ncm: '96190000', cst_icms: '60', v_icms_st: 0 });
  t.st_es_regras.push({ id: 1, cest: '2004800', ncm: null, mva: 40, pmpf: null, aliquota_interna: 17 });

  const s = new ServicoApuracao(db, () => new Date('2026-10-02T12:00:00Z'));
  await assert.rejects(s.previa(P.id, '2026-09'), /só para empresas do Simples/);
  await assert.rejects(s.previa(M.id, '2026-13'), /Competência inválida/);
  await assert.rejects(s.adicionarAjuste(M.id, '2026-09', { valor: 10, atividade: 2, justificativa: 'teste de ajuste' }, 'ana@x.com'), /marque ICMS-ST/);
  await assert.rejects(s.adicionarAjuste(M.id, '2026-09', { valor: 10, atividade: 1, justificativa: 'x' }, 'ana@x.com'), /justificativa/);
  const aj = await s.adicionarAjuste(F.id, '2026-09', { valor: 25.5, atividade: 1, justificativa: 'Venda sem nota emitida depois' }, 'ana@x.com');

  const p = await s.previa(F.id, '2026-09');
  assert.equal(p.empresa.id, F.id);
  assert.deepEqual(p.estabelecimentos.map((e: any) => e.cnpj), [M.cnpj, F.cnpj], 'matriz primeiro; o CNPJ do Presumido fica fora');
  assert.equal(p.receita, 100 + 40 + 60 + 25.5);
  assert.deepEqual(p.grupos.map((g: any) => [g.chave, g.valor]), [['a1', 125.5], ['a2_st_mono', 100]]);
  const alertasM = p.estabelecimentos[0].alertas.map((a: any) => a.tipo);
  assert.ok(alertasM.includes('st_nao_aplicada'), 'absorvente comprado com ST vendido como tributado');
  assert.equal(p.estabelecimentos[1].ajustes[0].justificativa, 'Venda sem nota emitida depois');
  assert.equal(p.comparacao.mesAnterior.notas, 999);
  assert.deepEqual(p.declaracao.estabelecimentos.map((e: any) => e.cnpjCompleto), [M.cnpj, F.cnpj]);
  assert.equal(p.declaracao.pa, 202609);
  await s.removerAjuste(aj.id);
  assert.equal((await s.previa(M.id, '2026-09')).receita, 200);
  await assert.rejects(s.removerAjuste(aj.id), /não encontrado/);
  console.log('ok  serviço: matriz + filiais do Simples, compras com ST pelo EAN, tabela de ST, ajustes e comparação com o mês anterior');
}

testeServico().then(() => console.log('\nTestes da apuração do Simples passaram.')).catch((e) => { console.error(e); process.exit(1); });
