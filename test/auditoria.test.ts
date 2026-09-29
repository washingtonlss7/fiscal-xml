/**
 * Regras da auditoria com notas de exemplo.
 *
 *   npx tsx test/auditoria.test.ts
 */
import assert from 'assert';
import { auditar, ItemAuditoria, NotaAuditoria } from '../src/auditoria/regras';
import { cfopEntrada, monofasico } from '../src/auditoria/tabelas';

const EMPRESA = { cnpj: '55885998000140', uf: 'ES', regime: 'simples' };
const agora = new Date('2026-09-29T12:00:00-03:00');
const base: NotaAuditoria = {
  chave: '', modelo: '55', numero: '1', serie: '1', emitida_em: '2026-09-20T10:00:00-03:00', direcao: 'entrada',
  completo: true, situacao: 'autorizada', emit_cnpj: '11222333000144', emit_nome: 'FORNECEDOR', dest_doc: EMPRESA.cnpj,
  crt_emit: 3, uf_emit: 'ES', uf_dest: 'ES', v_prod: 100, toma_doc: null, manifestacao_status: null, manifestacao_motivo: null,
  itens_extraidos: true,
};
const item = (chave: string, n: number, o: Partial<ItemAuditoria>): ItemAuditoria => ({
  chave, n_item: n, x_prod: 'PRODUTO', ncm: '30049099', cfop: '5403', cst_icms: '10', csosn: false, v_prod: 100,
  v_bc_icms: 100, p_icms: 17, v_icms: 17, cst_pis: '04', cst_cofins: '04', cst_ibscbs: '000', ...o,
});
const k = (n: number) => String(n).padStart(44, '0');

const notas: NotaAuditoria[] = [
  { ...base, chave: k(1) },                                                            // ok
  { ...base, chave: k(2), situacao: 'cancelada' },                                     // cancelada
  { ...base, chave: k(3), completo: false, itens_extraidos: false, emitida_em: '2026-09-20T10:00:00-03:00' }, // só resumo
  { ...base, chave: k(4), v_prod: 150 },                                               // soma diferente
  { ...base, chave: k(5), crt_emit: 1 },                                               // Simples com CST
  { ...base, chave: k(6), uf_emit: 'SP' },                                             // interestadual revenda
  { ...base, chave: k(7), modelo: '57', toma_doc: '99999999000199' },                  // CT-e sem tomador
  { ...base, chave: k(8), direcao: 'saida', emit_cnpj: EMPRESA.cnpj, numero: '10' },   // saída monofásica tributada
  { ...base, chave: k(9), direcao: 'saida', emit_cnpj: EMPRESA.cnpj, numero: '13' },   // lacuna 11-12
];
const itens: ItemAuditoria[] = [
  item(k(1), 1, {}),
  item(k(4), 1, {}),
  item(k(5), 1, { cst_icms: '00', cfop: '5102' }),
  item(k(6), 1, { cfop: '6102', cst_icms: '00', v_bc_icms: 100, p_icms: 12, v_icms: 12, ncm: '21069090', cst_pis: '01' }),
  item(k(1), 2, { cfop: '5104', cst_icms: '60', v_bc_icms: 0, p_icms: 0, v_icms: 0, ncm: '96190000', cst_pis: '01', v_prod: 0 }),
  item(k(1), 3, { cfop: '5403', cst_icms: '20', v_bc_icms: 100, p_icms: 17, v_icms: 15, cst_pis: '01', v_prod: 0 }),
  item(k(1), 4, { cfop: '5556', v_prod: 0, ncm: '48201000', cst_pis: '01' }),
  item(k(8), 1, { cfop: '5102', cst_icms: '00', cst_pis: '01' }),
  item(k(9), 1, { cfop: '5405', cst_icms: '60', v_bc_icms: 0, p_icms: 0, v_icms: 0, cst_pis: '04' }),
];

const r = auditar(EMPRESA, notas, itens, agora);
const regras = (nome: string) => r.apontamentos.filter((a) => a.regra === nome);

assert.equal(regras('NOTA_CANCELADA').length, 1);
assert.equal(regras('SO_RESUMO').length, 1);
assert.equal(regras('SOMA_ITENS').length, 1);
assert.equal(regras('SOMA_ITENS')[0].chave, k(4));
assert.equal(regras('CRT_CST').length, 1);
assert.equal(regras('INTERESTADUAL_REVENDA').length, 1);
assert.equal(regras('CTE_SEM_TOMADOR')[0].quantidade, 1);
console.log('ok  canceladas, só resumo, soma dos itens, CRT x CST, interestadual, CT-e sem tomador');

assert.equal(regras('CST_ST_EM_VENDA_COMUM').length, 1, 'CFOP 5104 com CST 60');
assert.equal(regras('CFOP_ST_SEM_CST_ST').length, 1, 'CFOP 5403 com CST 20');
assert.equal(regras('ICMS_CALCULO').length, 1, '100 x 17% = 17, destacado 15');
console.log('ok  CFOP x ST nos dois sentidos e cálculo do ICMS');

const mono = regras('MONO_RECEITA_TRIBUTADA');
assert.equal(mono.length, 1);
assert.deepEqual(mono[0].sugestao, { campo: 'cst_pis_cofins_escrit', valor: '04' });
assert.equal(regras('MONO_COMPRA_TRIBUTADA').length, 1, 'item 3004 com CST PIS 01 na entrada');
console.log('ok  monofásico: venda tributada (sugere CST 04) e compra com CST 01');

assert.equal(regras('CFOP_ENTRADA_INDEFINIDO').length, 1, 'CFOP 5556 sem conversão');
const num = regras('NUMERACAO_FALTANTE');
assert.equal(num.length, 1);
assert.equal(num[0].referencia, 'serie:1:11-12');
assert.equal(num[0].quantidade, 2);
console.log('ok  CFOP de entrada indefinido e numeração faltante (11 a 12)');

const s1 = r.sugestoes.find((s) => s.chave === k(1) && s.n_item === 1)!;
assert.equal(s1.cfop_escrit, '1403');
assert.equal(s1.monofasico, true);
const s8 = r.sugestoes.find((s) => s.chave === k(8))!;
assert.equal(s8.cfop_escrit, '5102', 'saída mantém o CFOP próprio');
assert.equal(s8.cst_pis_escrit, '04');
console.log('ok  sugestões de escrituração (CFOP 5403 → 1403, CST PIS 04 na saída monofásica)');

assert.equal(cfopEntrada('6102'), '2102');
assert.equal(cfopEntrada('5405'), '1403');
assert.equal(cfopEntrada('6353'), '2353');
assert.equal(cfopEntrada('5556'), null);
assert.ok(monofasico('30049099'));
assert.equal(monofasico('30049046'), null, 'exceção da Lei 10.147');
assert.ok(monofasico('33049910'));
assert.equal(monofasico('96190000'), null);
console.log('ok  tabelas: conversão de CFOP e lista monofásica com exceções');
// Apontamentos agregados usam referência 'mes'; a unicidade no banco inclui a competência (migração 0008).
assert.equal(regras('CTE_SEM_TOMADOR')[0].referencia, 'mes');
console.log('\nTestes da auditoria passaram.');
