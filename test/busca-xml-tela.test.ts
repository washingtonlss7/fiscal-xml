/**
 * Tela da busca de XML: funções puras de public/busca-xml.js.
 *
 *   npx tsx test/busca-xml-tela.test.ts
 */
import assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { bxPeriodoDoMes, bxDias, bxErroPeriodo, bxParametros, bxDica, bxAlvoDownload, bxPaginas, BX_UFS } = require('../public/busca-xml.js');

assert.deepEqual(bxPeriodoDoMes('2026-02'), { de: '2026-02-01', ate: '2026-02-28' });
assert.deepEqual(bxPeriodoDoMes('2024-02'), { de: '2024-02-01', ate: '2024-02-29' });
assert.equal(bxDias('2026-07-03', '2026-10-01'), 91);
assert.equal(bxErroPeriodo('2025-01-01', '2026-01-01'), null, '366 dias pode');
assert.match(bxErroPeriodo('2025-01-01', '2026-01-02'), /12 meses/);
assert.match(bxErroPeriodo('2026-03-02', '2026-03-01'), /anterior/);
assert.match(bxErroPeriodo('', '2026-03-01'), /Informe/);
assert.deepEqual(bxParametros({ empresa: '', de: '2026-09-01', ate: '2026-09-30', uf: 'ES', modelo: '', direcao: 'saida', situacao: '', por: 'numero', termo: '  ' }),
  { de: '2026-09-01', ate: '2026-09-30', uf: 'ES', direcao: 'saida' }, 'campos vazios e termo em branco ficam de fora');
assert.deepEqual(bxParametros({ empresa: 'e1', de: 'a', ate: 'b', por: 'chave', termo: ' 123 ' }), { de: 'a', ate: 'b', empresa: 'e1', por: 'chave', termo: '123' });
assert.match(bxDica('numero'), /10001-10050/);
assert.deepEqual(bxAlvoDownload(0, 1306), { qtd: 1306, texto: '1.306 da busca', excede: false });
assert.deepEqual(bxAlvoDownload(3, 9000), { qtd: 3, texto: '3 marcadas', excede: false }, 'marcadas valem mais que a busca');
assert.equal(bxAlvoDownload(0, 5001).excede, true);
assert.deepEqual(bxPaginas(1, 1), [1]);
assert.deepEqual(bxPaginas(5, 10), [1, '…', 4, 5, 6, '…', 10]);
assert.deepEqual(bxPaginas(2, 3), [1, 2, 3]);
assert.equal(BX_UFS.length, 27);
console.log('ok  busca de XML (tela): período padrão, 12 meses, parâmetros, alvo do download e paginação');
console.log('\nTestes da tela de busca de XML passaram.');
