/**
 * Testes locais, sem SEFAZ: gera um certificado A1 de teste, sobe um servidor HTTPS
 * que exige certificado do cliente (mTLS) e responde um retDistDFeInt com docZip
 * compactados. Verifica leitura do PFX, SOAP, descompactação e interpretação.
 *
 *   npm test
 */
import assert from 'assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import https from 'https';
import zlib from 'zlib';
import forge from 'node-forge';
import { criarAgente, lerPfx } from '../src/cert';
import { cifrar, decifrar } from '../src/cripto';
import { consultarDistNSU, montarEnvelope, SERVICOS } from '../src/sefaz/distDFe';
import { interpretar } from '../src/sefaz/documentos';

const CNPJ = '12345678000195';
const CHAVE = '32260911222333000144550010000012341000012345';
const CHAVE_CTE = '32260944555666000177570010000009871000009876';

function gerarPfx(senha: string, cn: string, algoritmo: '3des' | 'aes256') {
  const chaves = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const nome = [{ name: 'commonName', value: cn }];
  cert.setSubject(nome);
  cert.setIssuer(nome);
  cert.sign(chaves.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], senha, { algorithm: algoritmo });
  return {
    pfx: Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'),
    keyPem: forge.pki.privateKeyToPem(chaves.privateKey),
    certPem: forge.pki.certificateToPem(cert),
  };
}

const gz = (xml: string) => zlib.gzipSync(Buffer.from(xml)).toString('base64');

const resNFe = `<resNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><chNFe>${CHAVE}</chNFe><CNPJ>11222333000144</CNPJ><xNome>FORNECEDOR SA</xNome><IE>123</IE><dhEmi>2026-09-20T10:00:00-03:00</dhEmi><tpNF>1</tpNF><vNF>1500.50</vNF><digVal>x</digVal><dhRecbto>2026-09-20T10:00:05-03:00</dhRecbto><nProt>132260000000001</nProt><cSitNFe>1</cSitNFe></resNFe>`;
const procNFe = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${CHAVE}" versao="4.00"><ide><cUF>32</cUF><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-09-20T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>11222333000144</CNPJ><xNome>FORNECEDOR SA</xNome></emit><dest><CNPJ>${CNPJ}</CNPJ><xNome>CLIENTE LTDA</xNome></dest><total><ICMSTot><vNF>1500.50</vNF></ICMSTot></total></infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>${CHAVE}</chNFe><nProt>132260000000001</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
const cancel = `<procEventoNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><evento versao="1.00"><infEvento Id="ID110111${CHAVE}01"><chNFe>${CHAVE}</chNFe><dhEvento>2026-09-21T09:00:00-03:00</dhEvento><tpEvento>110111</tpEvento><nSeqEvento>1</nSeqEvento><detEvento versao="1.00"><descEvento>Cancelamento</descEvento></detEvento></infEvento></evento><retEvento versao="1.00"><infEvento><cStat>135</cStat><xEvento>Cancelamento registrado</xEvento><nProt>132260000000999</nProt></infEvento></retEvento></procEventoNFe>`;
const procCTe = `<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><CTe><infCte Id="CTe${CHAVE_CTE}" versao="4.00"><ide><mod>57</mod><serie>1</serie><nCT>987</nCT><dhEmi>2026-09-22T08:00:00-03:00</dhEmi></ide><emit><CNPJ>44555666000177</CNPJ><xNome>TRANSPORTADORA</xNome></emit><vPrest><vTPrest>320.00</vTPrest></vPrest></infCte></CTe><protCTe versao="4.00"><infProt><chCTe>${CHAVE_CTE}</chCTe><nProt>332260000000001</nProt><cStat>100</cStat></infProt></protCTe></cteProc>`;

const respostaSoap = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeDistDFeInteresseResponse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDistDFeInteresseResult><retDistDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>2</tpAmb><verAplic>1.0</verAplic><cStat>138</cStat><xMotivo>Documento(s) localizado(s)</xMotivo><dhResp>2026-09-29T01:00:00-03:00</dhResp><ultNSU>000000000000003</ultNSU><maxNSU>000000000000003</maxNSU><loteDistDFeInt><docZip NSU="000000000000001" schema="resNFe_v1.01.xsd">${gz(resNFe)}</docZip><docZip NSU="000000000000002" schema="procNFe_v4.00.xsd">${gz(procNFe)}</docZip><docZip NSU="000000000000003" schema="procEventoNFe_v1.00.xsd">${gz(cancel)}</docZip></loteDistDFeInt></retDistDFeInt></nfeDistDFeInteresseResult></nfeDistDFeInteresseResponse></soap:Body></soap:Envelope>`;

async function main() {
  // 1. PFX com cifra antiga (3DES) e moderna (AES)
  for (const alg of ['3des', 'aes256'] as const) {
    const { pfx } = gerarPfx('segredo123', `CLIENTE LTDA:${CNPJ}`, alg);
    const c = lerPfx(pfx, 'segredo123');
    assert.equal(c.cnpj, CNPJ);
    assert.equal(c.titular, 'CLIENTE LTDA');
    assert.throws(() => lerPfx(pfx, 'errada'), /Senha do certificado incorreta/);
  }
  console.log('ok  leitura do PFX (3DES e AES) e senha errada');

  // 2. Cifra do certificado no banco
  const mk = Buffer.alloc(32, 7).toString('base64');
  assert.equal(decifrar(cifrar(Buffer.from('abc'), mk), mk).toString(), 'abc');
  console.log('ok  AES-256-GCM ida e volta');

  // 3. Envelope
  const env = montarEnvelope('nfe', { tpAmb: 2, cUF: 32, cnpj: CNPJ, ultNSU: '12' });
  assert.ok(env.includes('<ultNSU>000000000000012</ultNSU>'));
  assert.ok(env.includes('<cUFAutor>32</cUFAutor>'));
  console.log('ok  envelope SOAP');

  // 4. Servidor mTLS local que exige certificado do cliente
  const servidor = gerarPfx('x', 'localhost', 'aes256');
  const cliente = gerarPfx('segredo123', `CLIENTE LTDA:${CNPJ}`, '3des');
  let recebido = '';
  let certClienteApresentado = false;
  const srv = https.createServer(
    { key: servidor.keyPem, cert: servidor.certPem, requestCert: true, rejectUnauthorized: false },
    (req, res) => {
      certClienteApresentado = !!(req.socket as import('tls').TLSSocket).getPeerCertificate()?.subject;
      req.on('data', (d) => (recebido += d));
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/soap+xml' });
        res.end(respostaSoap);
      });
    },
  );
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const porta = (srv.address() as import('net').AddressInfo).port;
  SERVICOS.nfe.url[2] = `https://localhost:${porta}/`;
  // Confia no certificado do servidor de teste pelo mesmo caminho usado para a cadeia ICP-Brasil.
  const caTeste = path.join(os.tmpdir(), `ca-teste-${porta}.pem`);
  fs.writeFileSync(caTeste, servidor.certPem);
  process.env.SEFAZ_CA_FILE = caTeste;

  const agente = criarAgente(lerPfx(cliente.pfx, 'segredo123'));
  const ret = await consultarDistNSU('nfe', agente, { tpAmb: 2, cUF: 32, cnpj: CNPJ, ultNSU: '0' });
  agente.destroy();
  srv.close();

  assert.ok(certClienteApresentado, 'certificado do cliente não foi apresentado');
  assert.ok(recebido.includes(`<CNPJ>${CNPJ}</CNPJ>`));
  assert.equal(ret.cStat, '138');
  assert.equal(ret.ultNSU, '000000000000003');
  assert.equal(ret.docs.length, 3);
  console.log('ok  chamada mTLS e retDistDFeInt com 3 docZip');

  // 5. Interpretação
  const r1 = interpretar(ret.docs[0].schema, ret.docs[0].xml);
  assert.equal(r1.tipo, 'documento');
  if (r1.tipo === 'documento') {
    assert.equal(r1.chave, CHAVE);
    assert.equal(r1.completo, false);
    assert.equal(r1.valor, 1500.5);
    assert.equal(r1.emitCnpj, '11222333000144');
  }
  const r2 = interpretar(ret.docs[1].schema, ret.docs[1].xml);
  if (r2.tipo !== 'documento') throw new Error('procNFe não reconhecido');
  assert.equal(r2.completo, true);
  assert.equal(r2.numero, '1234');
  assert.equal(r2.destDoc, CNPJ);
  assert.equal(r2.protocolo, '132260000000001');
  const r3 = interpretar(ret.docs[2].schema, ret.docs[2].xml);
  if (r3.tipo !== 'evento') throw new Error('evento não reconhecido');
  assert.equal(r3.tpEvento, '110111');
  assert.equal(r3.descricao, 'Cancelamento');
  assert.equal(r3.protocolo, '132260000000999');
  const r4 = interpretar('procCTe_v4.00.xsd', procCTe);
  if (r4.tipo !== 'documento') throw new Error('CT-e não reconhecido');
  assert.equal(r4.modelo, '57');
  assert.equal(r4.chave, CHAVE_CTE);
  assert.equal(r4.valor, 320);
  console.log('ok  resNFe, procNFe, cancelamento e procCTe interpretados');

  console.log('\nTodos os testes passaram.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
