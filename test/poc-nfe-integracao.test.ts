/**
 * Prova de conceito NFeIntegracao: funções puras com dados FICTÍCIOS (o WSDL e o XSD abaixo não são o contrato oficial;
 * o comando baixa o contrato real na hora e nunca usa estes exemplos).
 *
 *   npx tsx test/poc-nfe-integracao.test.ts
 */
import assert from 'assert';
import zlib from 'zlib';
import forge from 'node-forge';
import { SignedXml } from 'xml-crypto';
import {
  abrirLote, classificar, conferirChave, dvChave, lerEstruturaXsd, lerResposta, lerWsdl, mascararChave, mascararDoc, montarEnvelope,
  montarSolicitacao, tipoCertificado, verificarAssinatura,
} from '../src/poc/nfeIntegracaoContab';

const CNPJ = '11222333000181';
const base43 = `3226101122233300018165001000012345100001234`;
const CHAVE = base43 + String(dvChave(base43));

// Chave
assert.equal(CHAVE.length, 44);
assert.ok(conferirChave(CHAVE, CNPJ).ok);
assert.match(conferirChave(CHAVE.slice(0, 43) + String((Number(CHAVE[43]) + 1) % 10), CNPJ).problemas.join(), /Dígito/);
assert.match(conferirChave(CHAVE, '99999999000199').problemas.join(), /CNPJ/);
assert.match(conferirChave(CHAVE.replace(/^32/, '43').slice(0, 43) + '0', CNPJ).problemas.join(), /UF 43/);
assert.equal(mascararChave(CHAVE), `${CHAVE.slice(0, 6)}…${CHAVE.slice(-6)}`);
assert.equal(mascararDoc(CNPJ), '11.***.***/0001-81');
assert.equal(mascararDoc('12345678909'), '***.456.***-09');
assert.deepEqual(tipoCertificado(`EMPRESA LTDA:${CNPJ}`), { tipo: 'e-CNPJ', documento: CNPJ });
assert.deepEqual(tipoCertificado('FULANO DE TAL:12345678909'), { tipo: 'e-CPF', documento: '12345678909' });

// WSDL fictício no estilo .NET (document/literal wrapped)
const wsdl = `<?xml version="1.0"?><wsdl:definitions xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:s="http://www.w3.org/2001/XMLSchema" xmlns:tns="http://exemplo.ficticio/ws" xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" targetNamespace="http://exemplo.ficticio/ws">
<wsdl:types><s:schema targetNamespace="http://exemplo.ficticio/ws">
<s:element name="nfeIntegracaoContab"><s:complexType><s:sequence><s:element name="nfeDadosMsgDownload"><s:complexType mixed="true"><s:sequence><s:any/></s:sequence></s:complexType></s:element></s:sequence></s:complexType></s:element>
<s:element name="nfeIntegracaoContabResponse"><s:complexType><s:sequence><s:element name="nfeIntegracaoContabResult"/></s:sequence></s:complexType></s:element>
</s:schema></wsdl:types>
<wsdl:message name="inMsg"><wsdl:part name="parameters" element="tns:nfeIntegracaoContab"/></wsdl:message>
<wsdl:message name="outMsg"><wsdl:part name="parameters" element="tns:nfeIntegracaoContabResponse"/></wsdl:message>
<wsdl:portType name="P"><wsdl:operation name="nfeIntegracaoContab"><wsdl:input message="tns:inMsg"/><wsdl:output message="tns:outMsg"/></wsdl:operation><wsdl:operation name="nfeIntegracaoDetranCDV"><wsdl:input message="tns:inMsg"/></wsdl:operation></wsdl:portType>
<wsdl:binding name="B12" type="tns:P"><soap12:binding transport="http://schemas.xmlsoap.org/soap/http"/><wsdl:operation name="nfeIntegracaoContab"><soap12:operation soapAction="http://exemplo.ficticio/ws/nfeIntegracaoContab"/></wsdl:operation></wsdl:binding>
<wsdl:service name="S"><wsdl:port name="P12" binding="tns:B12"><soap12:address location="https://exemplo.ficticio/ws.asmx"/></wsdl:port></wsdl:service>
</wsdl:definitions>`;
const c = lerWsdl(wsdl, 'nfeIntegracaoContab');
assert.equal(c.targetNamespace, 'http://exemplo.ficticio/ws');
assert.equal(c.soapAction, 'http://exemplo.ficticio/ws/nfeIntegracaoContab');
assert.equal(c.endereco, 'https://exemplo.ficticio/ws.asmx');
assert.equal(c.elementoEntrada, 'nfeIntegracaoContab'); assert.equal(c.parametroEhCorpo, false); assert.equal(c.conteudo, 'xml');
assert.deepEqual(c.operacoesDisponiveis, ['nfeIntegracaoContab', 'nfeIntegracaoDetranCDV']);
assert.throws(() => lerWsdl(wsdl, 'outraOperacao'), /não tem a operação/);
assert.throws(() => lerWsdl(wsdl.replace(/xmlns:soap12="[^"]+"/, ''), 'nfeIntegracaoContab'), /SOAP 1.2/);
const env = montarEnvelope(c, '<distNFeRS/>');
assert.ok(env.includes('<nfeIntegracaoContab xmlns="http://exemplo.ficticio/ws"><nfeDadosMsgDownload><distNFeRS/></nfeDadosMsgDownload></nfeIntegracaoContab>'));
assert.ok(!env.includes('>xml<'), 'nunca envia o marcador "xml" dos exemplos');
assert.ok(montarEnvelope({ ...c, conteudo: 'texto' }, '<a/>').includes('&lt;a/&gt;'));

// XSD fictício: ordem, escolhas e documentação
const xsd = `<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns="http://www.portalfiscal.inf.br/nfe" targetNamespace="http://www.portalfiscal.inf.br/nfe">
<xs:element name="distNFeRS"><xs:complexType><xs:sequence>
 <xs:element name="tpAmb"/><xs:element name="cUF"/>
 <xs:choice><xs:annotation><xs:documentation>Identificação do contribuinte consultado</xs:documentation></xs:annotation><xs:element name="CNPJ"/><xs:element name="CPF"/></xs:choice>
 <xs:element name="mod"><xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="55"/><xs:enumeration value="65"/></xs:restriction></xs:simpleType></xs:element>
 <xs:choice>
  <xs:element name="solRel"><xs:complexType><xs:sequence><xs:element name="indXML"/><xs:element name="indEmit"/><xs:element name="indDest"/><xs:element name="ultNSU"/></xs:sequence></xs:complexType></xs:element>
  <xs:element name="solDFe"><xs:complexType><xs:sequence><xs:element name="chAcesso"/></xs:sequence></xs:complexType></xs:element>
 </xs:choice>
</xs:sequence><xs:attribute name="versao" fixed="1.00"/></xs:complexType></xs:element></xs:schema>`;
const e = lerEstruturaXsd({ 'ficticio.xsd': xsd }, 'distNFeRS');
assert.equal(e.versao, '1.00');
assert.deepEqual(e.filhos.map((f) => f.nome ?? `choice(${f.filhos.map((x) => x.nome).join('|')})`), ['tpAmb', 'cUF', 'choice(CNPJ|CPF)', 'mod', 'choice(solRel|solDFe)']);
const dados = { tpAmb: '1' as const, cUF: '43', modelo: '65', cnpjConsultado: CNPJ, docSolicitante: '12345678909', versao: '1.00' };
const s1 = montarSolicitacao(e, { ...dados, modo: { tipo: 'solDFe', chave: CHAVE } });
assert.ok('xml' in s1);
if ('xml' in s1) assert.equal(s1.xml, `<distNFeRS xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><tpAmb>1</tpAmb><cUF>43</cUF><CNPJ>${CNPJ}</CNPJ><mod>65</mod><solDFe><chAcesso>${CHAVE}</chAcesso></solDFe></distNFeRS>`);
const s2 = montarSolicitacao(e, { ...dados, modo: { tipo: 'solRel', indXML: '1', indEmit: '1', indDest: '0', ultNSU: '0' } });
if ('xml' in s2) { assert.ok(s2.xml.includes('<solRel><indXML>1</indXML><indEmit>1</indEmit><indDest>0</indDest><ultNSU>0</ultNSU></solRel>')); assert.ok(!s2.xml.includes('solDFe')); } else assert.fail(s2.erro);
// Identidade sem documentação: não adivinha
const semDoc = lerEstruturaXsd({ 'f.xsd': xsd.replace(/<xs:annotation>[\s\S]*?<\/xs:annotation>/, '') }, 'distNFeRS');
const s3 = montarSolicitacao(semDoc, { ...dados, modo: { tipo: 'solDFe', chave: CHAVE } });
assert.ok('erro' in s3 && s3.detalhes.some((x) => /não diz se é o contribuinte/.test(x)));
// Elemento obrigatório desconhecido: interrompe
const s4 = montarSolicitacao(lerEstruturaXsd({ 'f.xsd': xsd.replace('<xs:element name="cUF"/>', '<xs:element name="cUF"/><xs:element name="dhSolic"/>') }, 'distNFeRS'), { ...dados, modo: { tipo: 'solDFe', chave: CHAVE } });
assert.ok('erro' in s4 && s4.detalhes.some((x) => /dhSolic/.test(x)));
assert.throws(() => lerEstruturaXsd({ 'f.xsd': '<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"/>' }, 'distNFeRS'), /Nenhum XSD/);

// NFC-e fictícia assinada com chave gerada aqui
const chaves = forge.pki.rsa.generateKeyPair(2048);
const cert = forge.pki.createCertificate();
cert.publicKey = chaves.publicKey; cert.serialNumber = '01';
cert.validity.notBefore = new Date(Date.now() - 86400000); cert.validity.notAfter = new Date(Date.now() + 86400000);
cert.setSubject([{ name: 'commonName', value: `EMPRESA FICTICIA:${CNPJ}` }]); cert.setIssuer([{ name: 'commonName', value: 'AC FICTICIA' }]);
cert.sign(chaves.privateKey, forge.md.sha256.create());
const certPem = forge.pki.certificateToPem(cert); const keyPem = forge.pki.privateKeyToPem(chaves.privateKey);
const nfe = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${CHAVE}" versao="4.00"><ide><mod>65</mod></ide><emit><CNPJ>${CNPJ}</CNPJ></emit><det nItem="1"><prod><cProd>1</cProd></prod></det></infNFe></NFe>`;
const sig = new SignedXml({ privateKey: keyPem, publicCert: certPem, canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315', signatureAlgorithm: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1' });
sig.addReference({ xpath: "//*[local-name(.)='infNFe']", transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'], digestAlgorithm: 'http://www.w3.org/2000/09/xmldsig#sha1' });
sig.getKeyInfoContent = () => `<X509Data><X509Certificate>${certPem.replace(/-----[^-]+-----|\s/g, '')}</X509Certificate></X509Data>`;
sig.computeSignature(nfe, { location: { reference: "//*[local-name(.)='infNFe']", action: 'after' } });
const nfeAssinada = sig.getSignedXml();
const proc = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${nfeAssinada}<protNFe versao="4.00"><infProt><chNFe>${CHAVE}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;

const cl = classificar(proc, CHAVE, CNPJ);
assert.equal(cl.classe, 'nfce_completa'); assert.equal(cl.itens, 1); assert.ok(cl.protocoloConfere);
assert.equal(classificar(proc.replace(/<protNFe[\s\S]*<\/protNFe>/, ''), CHAVE, CNPJ).classe, 'nota_sem_protocolo');
assert.equal(classificar(proc, CHAVE, '99999999000199').classe, 'desconhecido');
assert.equal(classificar(`<resNFe><chNFe>${CHAVE}</chNFe></resNFe>`, CHAVE, CNPJ).classe, 'resumo');
assert.equal(classificar('<procEventoNFe><chNFe>1</chNFe></procEventoNFe>', null, CNPJ).classe, 'evento');
const a1 = verificarAssinatura(proc);
assert.deepEqual([a1.presente, a1.verificada, a1.titular], [true, true, `EMPRESA FICTICIA:${CNPJ}`], a1.erro ?? '');
const adulterado = proc.replace('<cProd>1</cProd>', '<cProd>2</cProd>');
assert.equal(verificarAssinatura(adulterado).verificada, false, 'conteúdo alterado não pode passar');
assert.deepEqual(verificarAssinatura('<nfeProc/>'), { presente: false, verificada: null, titular: null, erro: null });

// Resposta SOAP fictícia: retDistNFeRS com loteDistComp (gzip + base64) contendo <proc>
const lote = zlib.gzipSync(Buffer.from(`<loteDistNFeRS><proc>${proc}</proc><proc>${Buffer.from(zlib.gzipSync(Buffer.from('<resNFe><chNFe>1</chNFe></resNFe>'))).toString('base64')}</proc></loteDistNFeRS>`)).toString('base64');
const ret = `<retDistNFeRS xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><tpAmb>1</tpAmb><cStat>118</cStat><xMotivo>DF-e localizado</xMotivo><ultNSURet>7</ultNSURet><loteDistComp>${lote}</loteDistComp></retDistNFeRS>`;
const soapXml = `<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeIntegracaoContabResponse xmlns="http://exemplo.ficticio/ws"><nfeIntegracaoContabResult>${ret}</nfeIntegracaoContabResult></nfeIntegracaoContabResponse></soap:Body></soap:Envelope>`;
const r = lerResposta(soapXml);
assert.deepEqual([r.fault, r.cStat, r.xMotivo, r.campos.ultNSURet], [null, '118', 'DF-e localizado', '7']);
// Mesmo retorno vindo como texto escapado
const esc = lerResposta(soapXml.replace(ret, ret.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')));
assert.equal(esc.cStat, '118'); assert.equal(esc.loteBase64, lote);
const l = abrirLote(r.loteBase64!);
assert.equal(l.docs.length, 2);
assert.equal(l.docs[0].origem, 'xml'); assert.equal(l.docs[0].texto, proc, 'bytes do documento preservados');
assert.equal(l.docs[1].origem, 'base64-gzip'); assert.equal(classificar(l.docs[1].texto, null, CNPJ).classe, 'resumo');
assert.equal(verificarAssinatura(l.docs[0].texto).verificada, true, 'extraído do lote continua verificável');
// Rejeição e SOAP Fault
const rej = lerResposta(soapXml.replace(ret, '<retDistNFeRS><cStat>8002</cStat><xMotivo>Rejeicao: Requisitante nao e contabilista</xMotivo></retDistNFeRS>'));
assert.deepEqual([rej.cStat, rej.xMotivo, rej.loteBase64], ['8002', 'Rejeicao: Requisitante nao e contabilista', null]);
const fault = lerResposta('<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault><soap:Code><soap:Value>soap:Receiver</soap:Value></soap:Code><soap:Reason><soap:Text>Erro no servidor</soap:Text></soap:Reason></soap:Fault></soap:Body></soap:Envelope>');
assert.match(String(fault.fault), /Erro no servidor/); assert.equal(fault.retorno, null);

console.log('poc-nfe-integracao: ok');
