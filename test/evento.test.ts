/**
 * Confere a assinatura do evento de Ciência da Operação com uma biblioteca independente (xml-crypto),
 * como a SEFAZ faz: canonicalização C14N, digest SHA-1 do infEvento e assinatura RSA-SHA1.
 *
 *   npx tsx test/evento.test.ts
 */
import assert from 'assert';
import forge from 'node-forge';
import { DOMParser } from '@xmldom/xmldom';
import crypto from 'crypto';
import { C14nCanonicalization } from 'xml-crypto';
import { lerPfx } from '../src/cert';
import { montarEnvelopeEventos, montarEventoCiencia, parseRetornoEventos } from '../src/sefaz/evento';

const CHAVE = '32260911222333000144550010000012341000012345';
const CNPJ = '12345678000195';

function gerarPfx() {
  const chaves = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = '02';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const nome = [{ name: 'commonName', value: `EMPRESA TESTE LTDA:${CNPJ}` }];
  cert.setSubject(nome);
  cert.setIssuer(nome);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], 'x', { algorithm: '3des' });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary');
}

const cert = lerPfx(gerarPfx(), 'x');
const evento = montarEventoCiencia({ cert, tpAmb: 2, cnpj: CNPJ, chave: CHAVE, dhEvento: '2026-09-29T03:00:00-03:00' });

// O evento vai dentro do envelope de lote; a verificação é feita no documento completo, como na SEFAZ.
const envelope = montarEnvelopeEventos([evento], '123');

const c14n = new C14nCanonicalization();
function verificar(xml: string): boolean {
  const d = new DOMParser().parseFromString(xml, 'text/xml');
  const inf = d.getElementsByTagName('infEvento')[0];
  const si = d.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'SignedInfo')[0];
  const digestInformado = d.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'DigestValue')[0].textContent;
  const valor = d.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'SignatureValue')[0].textContent ?? '';
  // Canonicalização feita pela biblioteca independente (C14N inclusivo, como exige a SEFAZ)
  const digest = crypto.createHash('sha1').update(c14n.process(inf as any, {} as any)).digest('base64');
  if (digest !== digestInformado) return false;
  return crypto.verify('RSA-SHA1', Buffer.from(c14n.process(si as any, {} as any)), cert.certPem, Buffer.from(valor, 'base64'));
}

assert.ok(verificar(envelope), 'assinatura inválida');
console.log('ok  assinatura do evento verificada com canonicalização independente (C14N + SHA-1 + RSA)');

// Adulterar o conteúdo tem que invalidar a assinatura.
const adulterado = envelope.replace(`<chNFe>${CHAVE}</chNFe>`, `<chNFe>${CHAVE.replace(/5$/, '6')}</chNFe>`);
assert.ok(!verificar(adulterado), 'assinatura adulterada deveria ser rejeitada');
console.log('ok  conteúdo adulterado é rejeitado');

assert.ok(evento.includes('<cOrgao>91</cOrgao>'));
assert.ok(evento.includes(`Id="ID210210${CHAVE}01"`));
assert.ok(evento.includes('<descEvento>Ciencia da Operacao</descEvento>'));
console.log('ok  campos do evento (cOrgao 91, Id, descEvento)');

const retorno = parseRetornoEventos(
  `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeRecepcaoEventoNFResult xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` +
  `<retEnvEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>123</idLote><tpAmb>2</tpAmb><cOrgao>91</cOrgao><cStat>128</cStat><xMotivo>Lote de evento processado</xMotivo>` +
  `<retEvento versao="1.00"><infEvento><tpAmb>2</tpAmb><cOrgao>91</cOrgao><cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo><chNFe>${CHAVE}</chNFe><tpEvento>210210</tpEvento><nProt>891260000000001</nProt></infEvento></retEvento>` +
  `</retEnvEvento></nfeRecepcaoEventoNFResult></soap:Body></soap:Envelope>`,
);
assert.equal(retorno.cStat, '128');
assert.equal(retorno.eventos[0].cStat, '135');
assert.equal(retorno.eventos[0].chave, CHAVE);
console.log('ok  leitura do retorno do lote (128/135)');
console.log('\nTestes do evento passaram.');
