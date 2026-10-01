/**
 * Tela de documentos do mês e obrigações da Acessórias: funções puras de public/documentos.js.
 *
 *   npx tsx test/documentos-tela.test.ts
 */
import assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { dcSeloEnvio, dcSeloEntrega, dcResumoEntregas, dcDia, dcMesAnterior, dcTamanho } = require('../public/documentos.js');

assert.equal(dcSeloEnvio(null, false), null, 'sem integração não mostra selo');
assert.deepEqual(dcSeloEnvio(null, true), { tom: 'neutro', texto: 'Não enviado' });
assert.deepEqual(dcSeloEnvio({ status: 'enviado' }, true), { tom: 'ok', texto: 'Enviado à Acessórias' });
assert.deepEqual(dcSeloEnvio({ status: 'erro' }, true), { tom: 'problema', texto: 'Erro no envio' });
assert.equal(dcSeloEntrega('atrasada').tom, 'problema');
assert.equal(dcSeloEntrega('entregue').texto, 'Entregue');
assert.equal(dcSeloEntrega('xyz').texto, 'xyz');
assert.equal(dcResumoEntregas({ atrasada: 2, pendente: 1, entregue: 5, dispensada: 0 }), '2 atrasadas · 1 pendente · 5 entregues');
assert.equal(dcResumoEntregas({ atrasada: 0, pendente: 0, entregue: 0, dispensada: 0 }), 'Nenhuma obrigação nesta competência');
assert.equal(dcDia('2026-10-20'), '20/10/2026');
assert.equal(dcDia(null), '—');
assert.equal(dcMesAnterior('2026-01'), '2025-12');
assert.equal(dcMesAnterior('2026-10'), '2026-09');
assert.equal(dcTamanho(2048), '2 KB');
assert.equal(dcTamanho(3 * 1048576), '3 MB');
console.log('ok  documentos (tela): selos de envio e de entrega, resumo, datas sem fuso, mês anterior e tamanho');
console.log('\nTestes da tela de documentos passaram.');
