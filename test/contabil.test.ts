/**
 * Contábil: motor de regras (nota/folha → lançamento), idempotência, pendências, leiaute do Domínio e serviço.
 *
 *   npx tsx test/contabil.test.ts
 */
import assert from 'assert';
import {
  aplicar, agruparNfcePorDia, chaveUnica, cnpjValido, dataSemHora, EmpresaCtb, lerCompetencia, lerCsv, montarHistorico, movimentoDaFolha,
  movimentosDaNota, NotaFonte, RegraFiscal, RegraFolha, ultimoDia, valorBr,
} from '../src/contabil/motor';
import { arquivoDominio, abasConferencia, textoLatin1 } from '../src/contabil/dominio';
import { lerPlanilha, lerXlsx } from '../src/contabil/planilha';
import { ServicoContabil } from '../src/contabil/servico';
import { escreverXlsx } from '../src/painel/xlsx';
import { Zip } from '../src/painel/zip';
import { PassThrough } from 'stream';
import { bancoFalso } from './banco-falso';

const EMP: EmpresaCtb = { id: 'e1', codigo_dominio: '251', cnpj: '55885998000140', razao_social: 'DROGARIA ABC LTDA', regime: 'simples', plano_id: null, ativo: true };
const RF = (x: Partial<RegraFiscal>): RegraFiscal => ({ id: 1, ctb_empresa_id: null, regime: null, cfop: '5102', tipo_movimento: 'SAIDA', conta_debito: '1101', conta_credito: '3101', historico: 'Venda conforme NF {numero} – {participante}', historico_codigo: null, regra_inversao: false, ativo: true, ...x });
const CH = '32261055885998000140550010000058471000058470';
const nota = (x: Partial<NotaFonte> = {}): NotaFonte => ({
  chave: CH, empresa_cnpj: EMP.cnpj, modelo: '55', direcao: 'saida', numero: '5847', serie: '1', emitida_em: '2026-10-05T17:37:22Z', situacao: 'autorizada',
  valor: 150, cfop: '5102', completo: true, itens_extraidos: true, emit_cnpj: EMP.cnpj, emit_nome: 'DROGARIA ABC LTDA', dest_doc: '11222333000181', dest_nome: 'Drogaria XYZ', ...x,
});
const item = (cfop: string, v_prod: number, extra: any = {}) => ({ cfop, v_prod, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, v_icms_st: 0, v_fcp_st: 0, v_ipi: 0, ...extra });

(async () => {
  // 1) Utilitários
  {
    assert.equal(dataSemHora('2026-10-05T17:37:22Z'), '2026-10-05');
    assert.equal(dataSemHora('2026-10-06T01:30:00Z'), '2026-10-05', 'fuso de São Paulo');
    assert.equal(ultimoDia('2025-09-01'), '2025-09-30');
    assert.equal(ultimoDia('2024-02-01'), '2024-02-29');
    assert.equal(lerCompetencia('09/2025'), '2025-09-01');
    assert.equal(lerCompetencia('092025'), '2025-09-01');
    assert.equal(lerCompetencia('2025-09'), '2025-09-01');
    assert.equal(lerCompetencia('13/2025'), null);
    assert.equal(valorBr('5.000,00'), 5000);
    assert.equal(valorBr('R$ 850,5'), 850.5);
    assert.equal(valorBr('1234.56'), 1234.56);
    assert.equal(valorBr('abc'), null);
    assert.ok(cnpjValido('55885998000140') && !cnpjValido('55885998000141') && !cnpjValido('11111111111111'));
    assert.equal(chaveUnica('a', 1), chaveUnica('a', 1));
    assert.notEqual(chaveUnica('a', 1), chaveUnica('a', 2));
    console.log('ok  datas (sem hora, fuso SP), competência, valores pt-BR, CNPJ e chave de idempotência');
  }

  // 2) Nota → movimentos por CFOP
  {
    assert.deepEqual(movimentosDaNota(nota({ situacao: 'cancelada' }), [], 'total_nota'), [], 'cancelada não gera');
    const semCfg = movimentosDaNota(nota(), [item('5102', 150)], null);
    assert.equal(semCfg[0].erro?.codigo, 'VALOR_NAO_DEFINIDO', 'sem o Fiscal escolher o valor: pendência');
    const um = movimentosDaNota(nota(), [item('5102', 150)], 'total_nota');
    assert.deepEqual([um.length, um[0].cfop, um[0].valor, um[0].data, um[0].competencia, um[0].participante_nome], [1, '5102', 150, '2026-10-05', '2026-10-01', 'Drogaria XYZ']);
    // Dois CFOPs (comum em farmácia: 5102 + 5405) com desconto e frete rateados nos itens
    const dois = movimentosDaNota(nota({ valor: 108, cfop: '5102,5405' }), [item('5102', 60, { v_desc: 2 }), item('5405', 50, { v_frete: 0.01 })], 'total_nota');
    assert.deepEqual(dois.map((m) => [m.cfop, m.valor]), [['5102', 57.99], ['5405', 50.01]], 'diferença de centavos vai para o maior CFOP');
    const prod = movimentosDaNota(nota({ cfop: '5102,5405' }), [item('5102', 60, { v_desc: 2 }), item('5405', 50)], 'produtos');
    assert.deepEqual(prod.map((m) => m.valor), [60, 50]);
    const pmd = movimentosDaNota(nota({ cfop: '5102,5405' }), [item('5102', 60, { v_desc: 2 }), item('5405', 50)], 'produtos_menos_desconto');
    assert.deepEqual(pmd.map((m) => m.valor), [58, 50]);
    const naoFecha = movimentosDaNota(nota({ valor: 200 }), [item('5102', 150)], 'total_nota');
    assert.equal(naoFecha[0].erro?.codigo, 'VALOR_NAO_FECHA');
    assert.equal(movimentosDaNota(nota(), [], 'total_nota')[0].valor, 150, 'sem itens, um CFOP e total da nota: usa o total');
    assert.equal(movimentosDaNota(nota({ cfop: '5102,5405' }), [], 'total_nota')[0].erro?.codigo, 'NOTA_SEM_ITENS');
    assert.equal(movimentosDaNota(nota(), [], 'produtos')[0].erro?.codigo, 'NOTA_SEM_ITENS');
    // Entrada: participante é o emitente; mesma nota, mesma chave (idempotência)
    const ent = movimentosDaNota(nota({ direcao: 'entrada', emit_nome: 'Distribuidora X', cfop: '1102' }), [item('1102', 150)], 'total_nota');
    assert.equal(ent[0].participante_nome, 'Distribuidora X');
    assert.equal(movimentosDaNota(nota(), [item('5102', 150)], 'total_nota')[0].chave_unica, um[0].chave_unica);
    console.log('ok  nota → movimento por CFOP: canceladas fora, valor só com o campo escolhido, rateio, divergência e nota sem itens');
  }

  // 3) NFC-e agrupadas por dia
  {
    const a = movimentosDaNota(nota({ modelo: '65', chave: '1'.repeat(44), dest_nome: null, valor: 10 }), [item('5102', 10)], 'total_nota');
    const b = movimentosDaNota(nota({ modelo: '65', chave: '2'.repeat(44), dest_nome: null, valor: 20 }), [item('5102', 20)], 'total_nota');
    const g = agruparNfcePorDia([...a, ...b]);
    assert.deepEqual([g.length, g[0].valor, g[0].documento], [1, 30, 'NFC-e 05/10/2026 (2 notas)']);
    assert.equal(agruparNfcePorDia([...b, ...a])[0].chave_unica, g[0].chave_unica, 'mesma chave independente da ordem');
    console.log('ok  NFC-e agrupadas por empresa, dia e CFOP');
  }

  // 4) Regras e lançamento
  {
    const m = movimentosDaNota(nota(), [item('5102', 150)], 'total_nota')[0];
    m.ctb_empresa_id = EMP.id;
    const regras = { fiscais: [RF({})], folha: [] as RegraFolha[] };
    const r = aplicar(m, EMP, regras);
    assert.ok(r.ok);
    if (r.ok) assert.deepEqual([r.lancamento.conta_debito, r.lancamento.conta_credito, r.lancamento.valor, r.lancamento.historico, r.lancamento.data], ['1101', '3101', 150, 'Venda conforme NF 5847 – Drogaria XYZ', '2026-10-05']);
    // Consumidor final quando não há nome
    assert.equal(montarHistorico('Venda conforme NF {numero} – {participante}', { ...m, participante_nome: '' }), 'Venda conforme NF 5847 – Consumidor Final');
    // Prioridade: empresa > regime > geral
    const r2 = aplicar(m, EMP, { fiscais: [RF({ id: 1 }), RF({ id: 2, regime: 'simples', conta_debito: '1102' }), RF({ id: 3, ctb_empresa_id: 'e1', conta_debito: '1103' })], folha: [] });
    assert.ok(r2.ok && r2.lancamento.conta_debito === '1103' && r2.lancamento.regra === 'CFOP 5102 (empresa)');
    const r3 = aplicar(m, EMP, { fiscais: [RF({ id: 1 }), RF({ id: 2, regime: 'simples', conta_debito: '1102' })], folha: [] });
    assert.ok(r3.ok && r3.lancamento.conta_debito === '1102');
    assert.ok(!aplicar(m, { ...EMP, regime: 'real' }, { fiscais: [RF({ regime: 'simples' })], folha: [] }).ok, 'regra de outro regime não vale');
    // Sem regra, regra inativa, empresa desconhecida, conta igual
    assert.deepEqual(aplicar({ ...m, cfop: '5405' }, EMP, regras), { ok: false, codigo: 'CFOP_SEM_REGRA', detalhe: '5405' });
    assert.equal((aplicar(m, EMP, { fiscais: [RF({ ativo: false })], folha: [] }) as any).codigo, 'CFOP_SEM_REGRA');
    assert.equal((aplicar(m, null, regras) as any).codigo, 'EMPRESA_NAO_ENCONTRADA');
    assert.equal((aplicar(m, EMP, { fiscais: [RF({ conta_credito: '1101' })], folha: [] }) as any).codigo, 'REGRA_INCOMPLETA');
    // Plano de contas: conta inexistente e sintética
    const plano = new Map([['1101', { codigo: '1101', tipo: 'A' as const, ativa: true }], ['31', { codigo: '31', tipo: 'S' as const, ativa: true }]]);
    assert.equal((aplicar(m, EMP, regras, plano) as any).codigo, 'CONTA_INEXISTENTE');
    assert.equal((aplicar(m, EMP, { fiscais: [RF({ conta_credito: '31' })], folha: [] }, plano) as any).codigo, 'CONTA_SINTETICA');
    assert.ok(aplicar(m, EMP, { fiscais: [RF({ conta_credito: '0001101'.replace('1101', '31') })], folha: [] }, new Map()).ok, 'sem plano carregado: não confere');
    console.log('ok  regras: histórico dinâmico, consumidor final, prioridade empresa > regime > geral, pendências e plano de contas');
  }

  // 5) Folha por planilha
  {
    const csv = '﻿codigo_empresa;competencia;rubrica;descricao;valor\r\n0251;09/2025;001;SALÁRIO;"5.000,00"\r\n0251;09/2025;987;GRATIFICAÇÃO ESPECIAL;850,00\r\n999;09/2025;001;SALÁRIO;10,00\r\n0251;13/2025;001;SALÁRIO;10,00\r\n';
    const { linhas } = lerCsv(csv);
    assert.equal(linhas.length, 4);
    const emps = { porCodigo: new Map([['251', EMP]]), porCnpj: new Map([[EMP.cnpj, EMP]]) };
    const [sal, grat, semEmp, compRuim] = linhas.map((l) => movimentoDaFolha(l, emps));
    assert.deepEqual([sal.ctb_empresa_id, sal.competencia, sal.data, sal.rubrica, sal.valor], ['e1', '2025-09-01', '2025-09-30', '1', 5000]);
    assert.equal(semEmp.erro?.codigo, 'EMPRESA_NAO_ENCONTRADA');
    assert.equal(compRuim.erro?.codigo, 'COMPETENCIA_INVALIDA');
    const regrasFolha: RegraFolha[] = [{ id: 1, ctb_empresa_id: null, rubrica: '1', descricao: 'Salários', conta_debito: '310101', conta_credito: '210101', historico: 'Provisão de salários – competência {competencia}', historico_codigo: null, tipo_regra: 'FOLHA', ativo: true }];
    const r = aplicar(sal, EMP, { fiscais: [], folha: regrasFolha });
    assert.ok(r.ok && r.lancamento.historico === 'Provisão de salários – competência 09/2025' && r.lancamento.data === '2025-09-30');
    assert.deepEqual(aplicar(grat, EMP, { fiscais: [], folha: regrasFolha }), { ok: false, codigo: 'RUBRICA_SEM_REGRA', detalhe: '987 GRATIFICAÇÃO ESPECIAL' }, 'rubrica nova vira pendência só dela');
    assert.equal(movimentoDaFolha(linhas[0], emps).chave_unica, sal.chave_unica, 'mesma linha = mesma chave');
    console.log('ok  folha: planilha com código ou CNPJ, competência → último dia, rubrica nova vira pendência, chave estável');
  }

  // 6) Leiaute do Domínio
  {
    const lancs = [
      { data: '2026-10-05', conta_debito: '1101', conta_credito: '3101', valor: 150, historico: 'Venda conforme NF 5847 – Drogaria Ação', historico_codigo: null, origem: 'fiscal', documento: '5847', competencia: '2026-10-01' },
      { data: '2026-10-01', conta_debito: '467', conta_credito: '10018', valor: 102.58, historico: 'Linha\ncom quebra', historico_codigo: '186', origem: 'folha', documento: null, competencia: '2026-10-01' },
    ];
    const r = arquivoDominio({ codigo_dominio: '42', cnpj: '11222333000181' }, '2026-10-01', '2026-10-31', 18, lancs);
    const linhas = r.conteudo.toString('latin1').split('\r\n');
    assert.equal(linhas[linhas.length - 1], '', 'termina com CRLF');
    assert.equal(linhas[0], '01000004211222333000181' + '01/10/2026' + '31/10/2026' + 'N05' + '00000018' + '1');
    assert.equal(linhas[0].length, 55);
    assert.equal(linhas[1].length, 165); assert.equal(linhas[2].length, 664); assert.equal(linhas[5], '9'.repeat(100));
    assert.ok(linhas[1].startsWith('020000001X01/10/2026'), 'ordem por data; sequencial ímpar');
    assert.equal(linhas[2].slice(0, 45), '030000002' + '0000467' + '0010018' + '000000000010258' + '0000186');
    assert.equal(linhas[2].slice(45, 45 + 16), 'LINHA COM QUEBRA');
    assert.equal(linhas[2].slice(557, 564), '0000042');
    assert.ok(linhas[4].slice(45).startsWith('VENDA CONFORME NF 5847 - DROGARIA AÇÃO'), 'travessão vira hífen; acento fica (Latin-1)');
    assert.equal(r.conteudo.indexOf(Buffer.from([0xef, 0xbb, 0xbf])), -1, 'sem BOM');
    assert.equal(r.conteudo.includes(Buffer.from('AÇÃO', 'latin1')), true, 'Latin-1');
    assert.equal(r.total, 252.58);
    assert.throws(() => arquivoDominio({ codigo_dominio: '42', cnpj: '1' }, '2026-10-01', '2026-10-31', 1, [{ ...lancs[0], conta_debito: '12345678' }]), /Conta inválida/);
    assert.throws(() => arquivoDominio({ codigo_dominio: '', cnpj: '1' }, '2026-10-01', '2026-10-31', 1, lancs), /código do Domínio/);
    assert.equal(textoLatin1('ação “x” – 😀'), 'AÇÃO "X" - ');
    const abas = abasConferencia('T', { codigo_dominio: '42', razao_social: 'X' }, lancs);
    assert.equal(abas[0].linhas.length, 2);
    const tot = abas[1].linhas;
    assert.equal(tot.reduce((t, l) => t + Number(l[1]), 0), tot.reduce((t, l) => t + Number(l[2]), 0), 'débitos = créditos');
    console.log('ok  Domínio: registros 01/02/03/99 nas larguras certas, centavos, Latin-1 sem BOM, CRLF; conferência fecha D = C');
  }

  // 7) Planilha XLSX (o Contábil vai mandar em Excel)
  {
    const pt = new PassThrough(); const partes: Buffer[] = []; pt.on('data', (b) => partes.push(b));
    await escreverXlsx(new Zip(pt as any), [{ nome: 'Regras', colunas: [{ titulo: 'cfop', tipo: 'texto' }, { titulo: 'conta_debito', tipo: 'texto' }, { titulo: 'historico', tipo: 'texto' }, { titulo: 'data', tipo: 'data' }, { titulo: 'valor', tipo: 'moeda' }], linhas: [['5102', '1101', 'Venda & cia', '2025-09-30', 12.5]] }]);
    pt.end(); await new Promise((r) => setImmediate(r));
    const x = lerXlsx(Buffer.concat(partes));
    assert.deepEqual(x.cabecalho, ['cfop', 'conta_debito', 'historico', 'data', 'valor']);
    assert.deepEqual(x.linhas[0].dados, { cfop: '5102', conta_debito: '1101', historico: 'Venda & cia', data: '2025-09-30', valor: '12.5' });
    assert.equal(lerPlanilha('a.csv', Buffer.from('cfop;historico\n5102;Venda ação\n', 'latin1')).linhas[0].dados.historico, 'Venda ação', 'CSV do Excel em Latin-1');
    console.log('ok  planilhas: XLSX (texto, data e número) e CSV em UTF-8 ou Latin-1');
  }

  // 8) Serviço: processamento fiscal ponta a ponta, idempotência, pendências, reprocessamento e arquivo definitivo
  {
    const b = bancoFalso(['ctb_empresas', 'ctb_empresa_periodos', 'ctb_regras_fiscais', 'ctb_regras_folha', 'ctb_config', 'ctb_processamentos', 'ctb_raw_folha', 'ctb_movimentos', 'ctb_lancamentos', 'ctb_arquivos', 'ctb_planos', 'ctb_contas', 'empresas', 'documentos', 'documento_itens']);
    const salvos: string[] = [];
    const arm = { salvar: async (c: string) => { salvos.push(c); return c; }, ler: async () => Buffer.from('') } as any;
    const s = new ServicoContabil(b.db, arm);
    b.t.ctb_config.push({ id: 1, valor_fiscal: null, agrupar_nfce_por_dia: false });
    b.t.empresas.push({ id: 'ap1', cnpj: EMP.cnpj, razao_social: EMP.razao_social, regime: 'simples', codigo_erp: '251', escritorio: false });
    const tr = await s.trazerDoAppura('ana');
    assert.equal(tr.criadas, 1);
    const emp = b.t.ctb_empresas[0];
    assert.deepEqual([emp.codigo_dominio, emp.empresa_id], ['251', 'ap1']);
    const doc = (chave: string, numero: string, valor: number, cfop: string, situacao = 'autorizada') => ({ empresa_id: 'ap1', chave, modelo: '55', direcao: 'saida', numero, serie: '1', emitida_em: '2026-09-10T13:00:00Z', situacao, valor, cfop, completo: true, itens_extraidos: true, emit_cnpj: EMP.cnpj, emit_nome: 'X', dest_doc: null, dest_nome: null });
    b.t.documentos.push(doc('A'.repeat(44), '1', 100, '5102'), doc('B'.repeat(44), '2', 50, '5405'), doc('C'.repeat(44), '3', 70, '5102', 'cancelada'));
    b.t.documento_itens.push({ empresa_id: 'ap1', chave: 'A'.repeat(44), ...item('5102', 100) }, { empresa_id: 'ap1', chave: 'B'.repeat(44), ...item('5405', 50) });
    // Sem campo de valor definido: tudo pendente
    let p = await s.processarFiscal('ana', { inicio: '2026-09-01', fim: '2026-09-30', esperar: true });
    let log = b.t.ctb_processamentos.find((x) => x.id === p.processamento);
    assert.deepEqual([log.status, log.recebidos, log.lancamentos, log.rejeitados], ['concluido', 3, 0, 2]);
    assert.ok(b.t.ctb_movimentos.every((m) => m.erro_codigo === 'VALOR_NAO_DEFINIDO'));
    // Fiscal define o valor; Contábil cadastra só o 5102
    await s.salvarConfig('ana', { valor_fiscal: 'total_nota' });
    await s.salvarRegra('ana', 'fiscal', { cfop: '5102', tipo_movimento: 'saida', conta_debito: '0001101', conta_credito: '3101', historico: 'Venda NF {numero} – {participante}' });
    await assert.rejects(s.salvarRegra('ana', 'fiscal', { cfop: '5102', conta_debito: '1', conta_credito: '2', historico: 'x' }), /Já existe regra/);
    p = await s.processarFiscal('ana', { inicio: '2026-09-01', fim: '2026-09-30', esperar: true });
    log = b.t.ctb_processamentos.find((x) => x.id === p.processamento);
    assert.deepEqual([log.lancamentos, log.sem_regra, log.duplicados], [1, 1, 2], 'reprocessar a mesma fonte não duplica');
    assert.equal(b.t.ctb_movimentos.length, 2, 'mesma chave: um movimento por nota/CFOP');
    assert.equal(b.t.ctb_lancamentos.length, 1);
    assert.deepEqual([b.t.ctb_lancamentos[0].conta_debito, b.t.ctb_lancamentos[0].historico], ['1101', 'Venda NF 1 – Consumidor Final']);
    const pend = await s.pendencias({});
    assert.deepEqual(pend.grupos.map((g: any) => [g.codigo, g.detalhe, g.quantidade, g.valor]), [['CFOP_SEM_REGRA', '5405', 1, 50]]);
    // Regra nova → reprocessa só as pendências
    await s.salvarRegra('ana', 'fiscal', { cfop: '5405', tipo_movimento: 'saida', conta_debito: '1101', conta_credito: '3102', historico: 'Venda ST NF {numero}' });
    const rp = await s.reprocessar('ana', {});
    assert.equal(rp.lancamentos, 1);
    assert.equal(b.t.ctb_lancamentos.length, 2);
    assert.equal((await s.pendencias({})).total, 0);
    // Arquivo de teste não trava; definitivo trava e não reexporta
    const teste = await s.gerarArquivo('ana', { ctb_empresa_id: emp.id, inicio: '2026-09-01', fim: '2026-09-30', tipo: 'dominio_txt' });
    assert.ok(teste.tipo === 'txt' && teste.nome.endsWith('_TESTE.txt') && teste.lancamentos === 2);
    assert.ok(b.t.ctb_lancamentos.every((l) => !l.arquivo_id));
    const def = await s.gerarArquivo('ana', { ctb_empresa_id: emp.id, inicio: '2026-09-01', fim: '2026-09-30', tipo: 'dominio_txt', definitivo: true });
    assert.ok(def.tipo === 'txt' && def.nome === '251_202609_LANCAMENTOS.txt');
    assert.ok(b.t.ctb_lancamentos.every((l) => l.arquivo_id));
    await assert.rejects(s.gerarArquivo('ana', { ctb_empresa_id: emp.id, inicio: '2026-09-01', fim: '2026-09-30', tipo: 'dominio_txt', definitivo: true }), /Nenhum lançamento novo/);
    // Depois de exportado, mudar a regra e reprocessar tudo não mexe no que foi exportado
    b.t.ctb_regras_fiscais[0].conta_credito = '3199';
    await s.reprocessar('ana', { tudo: true });
    assert.ok(b.t.ctb_lancamentos.every((l) => l.conta_credito !== '3199'), 'exportado = travado');
    // Lançamento manual (Appura como livro)
    const man = await s.lancarManual('ana', { ctb_empresa_id: emp.id, data: '2026-09-30', conta_debito: '1101', conta_credito: '2101', valor: 10, historico: 'Ajuste' });
    assert.ok(man.id);
    await assert.rejects(s.lancarManual('ana', { ctb_empresa_id: emp.id, data: '2026-09-30', conta_debito: '1', conta_credito: '1', valor: 10, historico: 'x' }), /inválidas/);
    const ls = await s.lancamentos({ ctb_empresa_id: emp.id, inicio: '2026-09-01', fim: '2026-09-30' });
    assert.deepEqual([ls.quantidade, ls.total, ls.exportados], [3, 160, 2]);
    console.log('ok  serviço: Appura → empresas, pendência sem valor definido, regra por CFOP, idempotência, reprocessar, arquivo teste × definitivo (trava), lançamento manual');
  }

  // 9) Folha pelo serviço (RAW guardado, empresa por código, rubrica nova pendente) e plano de contas
  {
    const b = bancoFalso(['ctb_empresas', 'ctb_regras_fiscais', 'ctb_regras_folha', 'ctb_config', 'ctb_processamentos', 'ctb_raw_folha', 'ctb_movimentos', 'ctb_lancamentos', 'ctb_planos', 'ctb_contas', 'empresas']);
    const s = new ServicoContabil(b.db, {} as any);
    b.t.ctb_empresas.push({ ...EMP, empresa_id: null });
    await s.salvarRegra('ana', 'folha', { rubrica: '001', descricao: 'Salário', conta_debito: '310101', conta_credito: '210101', historico: 'Provisão de salários – competência {competencia}' });
    const csv = 'codigo_empresa;competencia;rubrica;descricao;valor\n251;09/2025;1;SALÁRIO;5000,00\n251;09/2025;987;GRATIFICAÇÃO ESPECIAL;850,00\n251;09/2025;1;SALÁRIO;5000,00\n';
    const r = await s.processarFolha('ana', 'folha_251_2025.csv', Buffer.from(csv));
    assert.deepEqual([r.recebidos, r.lancamentos, r.sem_regra, r.duplicados], [3, 1, 1, 1], 'linha repetida no arquivo é duplicado');
    assert.equal(b.t.ctb_raw_folha.length, 3, 'RAW guardado como veio');
    assert.equal(b.t.ctb_lancamentos[0].data, '2025-09-30');
    await assert.rejects(s.processarFolha('ana', 'x.csv', Buffer.from('a;b\n1;2\n')), /precisa das colunas/);
    // Plano de contas: tipo deduzido pela hierarquia; regra com conta sintética vira pendência
    const plano = 'codigo_reduzido;classificacao;descricao\n1;3;RESULTADO\n2;3.1;DESPESAS\n310101;3.1.01;SALÁRIOS\n210101;2.1.01;SALÁRIOS A PAGAR\n';
    const ip = await s.importarPlano('ana', 'Plano padrão Domínio novo', true, 'plano.csv', Buffer.from(plano));
    assert.deepEqual([ip.contas, ip.sinteticas], [4, 2]);
    await s.salvarRegra('ana', 'folha', { rubrica: '987', conta_debito: '2', conta_credito: '210101', historico: 'Gratificação {competencia}' });
    await s.reprocessar('ana', {});
    const pend = await s.pendencias({});
    assert.deepEqual(pend.grupos.map((g: any) => g.codigo), ['CONTA_SINTETICA']);
    console.log('ok  folha pelo serviço (RAW, duplicado no arquivo, colunas obrigatórias) e plano de contas (sintética vira pendência)');
  }

  console.log('\nTestes do Contábil passaram.');
})().catch((e) => { console.error(e); process.exit(1); });
