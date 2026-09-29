/**
 * ICMS-ST nas entradas de outros estados (ES) e planilha Excel.
 *
 *   npx tsx test/st.test.ts
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { abasST, RelatorioST } from '../src/fiscal/relatorioST';
import {
  acharRegra, aliquotaInterestadual, calcularItem, calcularST, ItemST, lerTabelaCsv, mvaAjustada, NotaST, RegraST, tabelaParaCsv,
} from '../src/fiscal/st';
import { escreverXlsx } from '../src/painel/xlsx';
import { Zip } from '../src/painel/zip';

const nota = (uf: string, chave = 'N'.repeat(44)): NotaST => ({
  chave, numero: '123', serie: '1', emitida_em: '2026-09-10T10:00:00-03:00', emit_cnpj: '11222333000181', emit_nome: 'Fornecedor', uf_emit: uf,
});
const item = (x: Partial<ItemST> = {}): ItemST => ({
  chave: 'N'.repeat(44), n_item: 1, x_prod: 'Produto', ncm: '30049099', cest: '1300100', cfop: '6102', orig: 0, q_com: 10, u_com: 'UN',
  v_prod: 1000, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, v_ipi: 0, v_icms: null, p_icms: null, v_icms_st: 0, ...x,
});
const regra = (x: Partial<RegraST> = {}): RegraST => ({ cest: '1300100', ncm: null, descricao: null, mva: 40, pmpf: null, aliquota_interna: 17, ...x });

// 1) Exemplo do contador: R$ 1.000, MVA 40%, interna 17%, ICMS próprio 12% => ST R$ 118,00
{
  const l = calcularItem(nota('BA'), item(), regra(), false);
  assert.equal(l.aliqInterestadual, 12);
  assert.equal(l.baseST, 1400);
  assert.equal(l.icmsProprio, 120);
  assert.equal(l.icmsST, 118);
  console.log('ok  exemplo do contador (12%): Base ST 1.400, ST R$ 118,00');
}

// 2) Vindo de SP a alíquota interestadual para o ES é 7%: 238 − 70 = 168
{
  assert.equal(aliquotaInterestadual('SP', 0), 7);
  assert.equal(aliquotaInterestadual('MG', 0), 7);
  assert.equal(aliquotaInterestadual('BA', 0), 12);
  assert.equal(aliquotaInterestadual('SP', 1), 4); // importado
  const l = calcularItem(nota('SP'), item(), regra(), false);
  assert.equal(l.icmsST, 168);
  console.log('ok  de SP/MG/RJ para o ES: 7% (ST R$ 168,00); importado 4%; demais estados 12%');
}

// 3) Frete, seguro, outras, desconto e IPI; IPI entra só na Base ST
{
  const l = calcularItem(nota('BA'), item({ v_frete: 50, v_seg: 10, v_outro: 5, v_desc: 15, v_ipi: 100 }), regra(), false);
  assert.equal(l.baseOperacao, 1050);
  assert.equal(l.baseST, 1610); // (1050 + 100) × 1,4
  assert.equal(l.icmsProprio, 126); // 1050 × 12%
  assert.equal(l.icmsST, 147.7); // 1610 × 17% = 273,70 − 126
  console.log('ok  frete/seguro/outras/desconto na base e IPI só na Base ST');
}

// 4) PMPF: Base ST = PMPF × quantidade
{
  const l = calcularItem(nota('SP'), item({ q_com: 20 }), regra({ mva: null, pmpf: 75 }), false);
  assert.equal(l.usouPmpf, true);
  assert.equal(l.baseST, 1500);
  assert.equal(l.icmsST, 185); // 1500 × 17% = 255 − 70
  console.log('ok  PMPF × quantidade como Base ST');
}

// 5) MVA ajustada (Conv. 142/2018)
{
  assert.equal(Math.round(mvaAjustada(40, 12, 17) * 100) / 100, 48.43);
  const l = calcularItem(nota('SP'), item(), regra(), true);
  assert.equal(l.mvaUsada, 56.87); // (1,4 × 0,93 / 0,83) − 1
  console.log('ok  MVA ajustada (40% -> 56,87% vindo de SP)');
}

// 6) Regra mais específica: CEST > NCM mais longo > NCM curto
{
  const rs = [regra({ cest: null, ncm: '30', mva: 10 }), regra({ cest: null, ncm: '300490', mva: 20 }), regra({ cest: '1300100', ncm: null, mva: 30 })];
  assert.equal(acharRegra({ cest: '1300100', ncm: '30049099' }, rs)?.mva, 30);
  assert.equal(acharRegra({ cest: null, ncm: '30049099' }, rs)?.mva, 20);
  assert.equal(acharRegra({ cest: null, ncm: '30021000' }, rs)?.mva, 10);
  assert.equal(acharRegra({ cest: null, ncm: '22021000' }, rs), undefined);
  console.log('ok  escolha da regra: CEST, depois NCM mais específico');
}

// 7) Seleção: só fora do ES, CFOP de venda/transferência, sem ST retido; CEST sem regra vai para a lista
{
  const ns = [nota('SP', 'A'.repeat(44)), nota('ES', 'B'.repeat(44))];
  const its = [
    item({ chave: 'A'.repeat(44), n_item: 1 }),
    item({ chave: 'A'.repeat(44), n_item: 2, v_icms_st: 30 }), // já retido
    item({ chave: 'A'.repeat(44), n_item: 3, cfop: '6202' }), // devolução
    item({ chave: 'A'.repeat(44), n_item: 4, cest: '9999999', ncm: '99999999' }), // sem regra
    item({ chave: 'A'.repeat(44), n_item: 5, cest: null, ncm: '84713012' }), // não é ST
    item({ chave: 'B'.repeat(44), n_item: 1 }), // compra dentro do ES
  ];
  const r = calcularST(ns, its, [regra()]);
  assert.deepEqual(r.linhas.map((l) => l.item.n_item), [1]);
  assert.equal(r.jaRetidos, 1);
  assert.deepEqual(r.semRegra.map((x) => x.item.n_item), [4]);
  assert.equal(r.total, 168);
  console.log('ok  seleção dos itens (fora do ES, sem ST retido, CFOP de compra) e lista "sem regra"');
}

// 8) Tabela em CSV (Excel pt-BR: ";" e vírgula decimal)
{
  const csv = '﻿CEST;NCM;Descrição;MVA;PMPF;Alíquota interna\r\n1300100;;Medicamentos;33,05;;17\r\n;2202;Refrigerantes;;4,5;\r\n;;sem chave;10;;\r\n';
  const { regras, erros } = lerTabelaCsv(csv);
  assert.equal(regras.length, 2);
  assert.equal(regras[0].mva, 33.05);
  assert.equal(regras[1].pmpf, 4.5);
  assert.equal(regras[1].aliquota_interna, 17);
  assert.equal(erros.length, 1);
  assert.match(erros[0], /Linha 4/);
  const volta = lerTabelaCsv(tabelaParaCsv(regras));
  assert.deepEqual(volta.regras, regras);
  console.log('ok  importação e exportação da tabela em CSV (com validação por linha)');
}

// 9) Planilha Excel válida
(async () => {
  const r = calcularST([nota('SP')], [item(), item({ n_item: 2, cest: '1234567' })], [regra()]);
  const rel: RelatorioST = { ...r, empresa: { cnpj: '55885998000140', razao_social: 'Empresa <Teste> & Cia', uf: 'ES' }, notasForaDoEstado: 1, regrasCadastradas: 1 };
  const arq = path.join(os.tmpdir(), `st-teste-${process.pid}.xlsx`);
  const saida = fs.createWriteStream(arq);
  await escreverXlsx(new Zip(saida), abasST(rel, '2026-09', false));
  await new Promise<void>((ok) => saida.end(ok));
  execFileSync('unzip', ['-tq', arq]);
  const py = `
import openpyxl, sys
wb = openpyxl.load_workbook(sys.argv[1])
assert wb.sheetnames == ['ST por item', 'Resumo por nota', 'Sem regra na tabela'], wb.sheetnames
ws = wb['ST por item']
rows = [r for r in ws.iter_rows(values_only=True)]
hdr = next(i for i, r in enumerate(rows) if r and r[0] == 'Emissão')
dados = rows[hdr + 1]
col = rows[hdr].index('ICMS-ST a recolher')
assert abs(dados[col] - 168) < 0.001, dados[col]
assert rows[hdr + 2][0] == 'Total'
assert 'Empresa <Teste> & Cia' in rows[1][0]
assert wb['Sem regra na tabela'].max_row >= 4
print('xlsx-ok')
`;
  const out = execFileSync('python3', ['-c', py, arq]).toString();
  assert.match(out, /xlsx-ok/);
  fs.unlinkSync(arq);
  console.log('ok  planilha Excel abre e tem as 3 abas, valores e total');
  console.log('\nTestes de ST passaram.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
