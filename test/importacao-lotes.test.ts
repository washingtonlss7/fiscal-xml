/**
 * Importação em lotes: o ZIP montado no navegador (public/nucleo.js) é lido pelo servidor (zipLeitor) e os lotes respeitam os limites.
 *
 *   npx tsx test/importacao-lotes.test.ts
 */
import assert from 'assert';
import zlib from 'zlib';
import { abrirEnvio } from '../src/importacao/importar';
import { lerZip } from '../src/importacao/zipLeitor';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { crc32, zipSimples, lotesImportacao } = require('../public/nucleo.js');

assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'CRC-32 padrão');
const arquivos = [
  { nome: 'NFe 1.xml', bytes: new TextEncoder().encode('<nfeProc>um</nfeProc>') },
  { nome: 'pasta/ção.xml', bytes: new TextEncoder().encode('<nfeProc>dois — ç</nfeProc>') },
  { nome: 'vazio.xml', bytes: new Uint8Array(0) },
];
const zip = Buffer.from(zipSimples(arquivos));
const lidos = lerZip(zip);
assert.deepEqual(lidos.map((a) => [a.nome, a.conteudo.toString('utf8')]), [['NFe 1.xml', '<nfeProc>um</nfeProc>'], ['pasta/ção.xml', '<nfeProc>dois — ç</nfeProc>'], ['vazio.xml', '']]);
assert.equal(abrirEnvio('lote-3.zip', zip).length, 3, 'o servidor abre o lote como ZIP');
// O CRC gravado confere com o do zlib (outros programas também abrem o ZIP)
assert.equal(zip.readUInt32LE(14), zlib.crc32 ? zlib.crc32(Buffer.from('<nfeProc>um</nfeProc>')) : crc32(arquivos[0].bytes));
console.log('ok  ZIP do navegador: CRC-32, nomes UTF-8, arquivo vazio e leitura pelo servidor');

const f = (name: string, size: number) => ({ name, size });
const xmls = Array.from({ length: 120 }, (_, i) => f(`n${i}.xml`, 10_000));
const l = lotesImportacao([...xmls, f('grande.zip', 30_000_000), f('enorme.xml', 20_000_000)]);
assert.deepEqual(l.map((x: any[]) => x.length), [50, 50, 1, 1, 20], 'ZIP e XML gigante vão sozinhos; o resto em lotes de 50');
const porTamanho = lotesImportacao(Array.from({ length: 10 }, (_, i) => f(`n${i}.xml`, 4 * 1024 * 1024)));
assert.deepEqual(porTamanho.map((x: any[]) => x.length), [3, 3, 3, 1], 'lote para em 15 MB');
assert.deepEqual(lotesImportacao([]), []);
console.log('ok  lotes: até 50 XMLs ou 15 MB por envio; ZIP e arquivo grande sozinhos');
console.log('\nTestes da importação em lotes passaram.');
