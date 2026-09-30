/**
 * Formato dos XMLs no R2: gzip + AES-256-GCM, leitura do formato antigo e detecção de adulteração.
 *
 *   npx tsx test/armazenamento.test.ts
 */
import assert from 'assert';
import crypto from 'crypto';
import zlib from 'zlib';
import { abrir, chaveXml, selar } from '../src/armazenamento';

const master = crypto.randomBytes(32).toString('base64');
const chave = chaveXml(master);
const xml = '<nfeProc><NFe><infNFe Id="NFe123">' + 'x'.repeat(5000) + '</infNFe></NFe></nfeProc>';

const selado = selar(xml, chave);
assert.equal(selado.subarray(0, 4).toString(), 'FXE1');
assert.ok(!selado.includes(Buffer.from('nfeProc')), 'conteúdo não pode aparecer em claro');
assert.ok(selado.length < xml.length / 5, 'deve continuar compactado');
assert.equal(abrir(selado, chave).toString(), xml);
console.log(`ok  selar/abrir (${xml.length} bytes -> ${selado.length} bytes, criptografado)`);

assert.equal(abrir(zlib.gzipSync(Buffer.from(xml)), chave).toString(), xml);
console.log('ok  lê o formato antigo (só gzip)');

const adulterado = Buffer.from(selado);
adulterado[40] ^= 0xff;
assert.throws(() => abrir(adulterado, chave));
assert.throws(() => abrir(selado, chaveXml(crypto.randomBytes(32).toString('base64'))));
console.log('ok  rejeita arquivo adulterado e chave errada');

assert.ok(!chave.equals(Buffer.from(master, 'base64')), 'chave dos XMLs é derivada, não é a MASTER_KEY');
assert.ok(chaveXml(master).equals(chave), 'derivação é determinística');
console.log('ok  chave derivada da MASTER_KEY (HKDF)');
console.log('\nTestes do armazenamento passaram.');

// ID da conta do R2 colado como endereço completo
import { configArmazenamento } from '../src/armazenamento';
process.env.R2_ACCESS_KEY_ID = 'a'; process.env.R2_SECRET_ACCESS_KEY = 'b';
for (const v of ['0123456789abcdef0123456789abcdef', 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com', ' 0123456789ABCDEF0123456789ABCDEF.r2.cloudflarestorage.com/ ']) {
  process.env.R2_ACCOUNT_ID = v;
  assert.equal(configArmazenamento(master, 'xmls').r2?.accountId.toLowerCase(), '0123456789abcdef0123456789abcdef');
}
console.log('ok  aceita o ID da conta do R2 puro ou com o endereço completo');
