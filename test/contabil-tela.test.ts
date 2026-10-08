/**
 * Tela do Contábil: funções puras e rota.
 *
 *   npx tsx test/contabil-tela.test.ts
 */
import assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const c = require('../public/contabil.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const n = require('../public/nucleo.js');

assert.deepEqual(c.ctPeriodoDoMes('2026-02'), { inicio: '2026-02-01', fim: '2026-02-28' });
assert.deepEqual(c.ctPeriodoDoMes('2024-02'), { inicio: '2024-02-01', fim: '2024-02-29' });
assert.equal(c.ctResumoProcessamento({ status: 'concluido', recebidos: 8422, lancamentos: 8390, sem_regra: 28, rejeitados: 4, duplicados: 0 }), '8.422 recebidos · 8.390 lançamentos · 28 sem regra · 4 com erro');
assert.equal(c.ctResumoProcessamento({ status: 'concluido', recebidos: 1, lancamentos: 1, sem_regra: 0, rejeitados: 0, duplicados: 1 }), '1 recebido · 1 lançamento · 1 já processado (não duplicados)');
assert.equal(c.ctResumoProcessamento({ status: 'erro', erro: 'x' }), 'Erro: x');
assert.equal(c.ctTom({ status: 'concluido', sem_regra: 1 }), 'atencao');
assert.equal(c.ctTom({ status: 'concluido' }), 'ok');
assert.equal(c.ctTom({ status: 'erro' }), 'problema');
assert.equal(c.ctData('2025-09-30'), '30/09/2025');
console.log('ok  período do mês, resumo e tom do processamento, data');

const contabil = (p: string) => ['contabil.ver', 'contabil.operar', 'algum.ver'].includes(p);
assert.deepEqual(n.resolverRota('#/contabil', contabil), { redirecionar: '#/contabil/processar' });
assert.deepEqual(n.resolverRota('#/contabil/regras', contabil), { tela: 'contabil', base: '#/contabil/regras', aba: 'regras' });
assert.equal(n.resolverRota('#/contabil/regras', (p: string) => p === 'fiscal.ver').semPermissao, 'Contábil');
assert.deepEqual(n.resolverRota('#/contabil/inexistente', contabil), { redirecionar: '#/empresas' });
console.log('ok  rotas do Contábil pedem contabil.ver');
console.log('\nTestes da tela do Contábil passaram.');
