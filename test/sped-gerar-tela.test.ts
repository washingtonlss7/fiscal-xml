/**
 * Cartão "Gerar SPED" (funções puras da tela).
 *
 *   npx tsx test/sped-gerar-tela.test.ts
 */
import assert from 'assert';
(globalThis as any).moeda = (v: number) => `R$ ${Number(v || 0).toFixed(2)}`;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sg = require('../public/sped-gerar.js');

assert.deepEqual(sg.sgSelo(null), { tom: 'neutro', texto: 'Não gerado' });
assert.deepEqual(sg.sgSelo({ erros: 2, alertas: 1 }), { tom: 'problema', texto: '2 pendências que impedem a transmissão' });
assert.deepEqual(sg.sgSelo({ erros: 0, alertas: 1 }), { tom: 'atencao', texto: 'Pronto, com 1 ponto para conferir' });
assert.equal(sg.sgSelo({ erros: 0, alertas: 0 }).tom, 'ok');
const fiscal = sg.sgNumeros({ tipo: 'efd_icms_ipi', resumo: { documentos: { entradas: 3, saidasNfe: 1, nfce: 20, cte: 2 }, icms: { debitos: 100, creditos: 300, saldoCredorAnterior: 0, aRecolher: 0, saldoCredorTransportar: 200 } } });
assert.deepEqual(fiscal[7], ['Saldo credor a transportar', 'R$ 200.00']);
const com = sg.sgNumeros({ tipo: 'efd_icms_ipi', resumo: { icms: { aRecolher: 50 } } });
assert.deepEqual(com[7], ['ICMS a recolher', 'R$ 50.00']);
const contrib = sg.sgNumeros({ tipo: 'efd_contribuicoes', resumo: { estabelecimentos: 2, pis: { aRecolher: 10, credito: 5, saldoCredor: 0 }, cofins: { aRecolher: 46, credito: 23, saldoCredor: 1 } } });
assert.deepEqual([contrib[3], contrib[6], contrib[7]], [['Estabelecimentos', '2'], ['Créditos (PIS + COFINS)', 'R$ 28.00'], ['Saldo credor (PIS + COFINS)', 'R$ 1.00']]);
const pontos = sg.sgPontos({ pendencias: [{ nivel: 'info', texto: 'a' }, { nivel: 'erro', texto: 'b', exemplos: ['x'] }], validacao: [{ nivel: 'alerta', mensagem: 'c' }] });
assert.deepEqual(pontos.map((p: any) => [p.nivel, p.origem]), [['erro', 'Geração'], ['alerta', 'Validação'], ['info', 'Geração']]);
console.log('ok  selo da versão, números do resumo (Fiscal e Contribuições) e pendências + validação');
console.log('\nTestes da tela Gerar SPED passaram.');
