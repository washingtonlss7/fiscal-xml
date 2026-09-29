/**
 * Extração de itens, tributos e duplicatas (NF-e com regime normal, Simples, ST e IBS/CBS; CT-e com tomador).
 *
 *   npx tsx test/extrator.test.ts
 */
import assert from 'assert';
import { extrairCTe, extrairNFe } from '../src/extrator';

const CHAVE = '32260911222333000144550010000012341000012345';

const nfe = `<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${CHAVE}" versao="4.00">
<ide><cUF>32</cUF><natOp>VENDA DE MERCADORIA</natOp><mod>55</mod><serie>1</serie><nNF>1234</nNF><dhEmi>2026-09-20T10:00:00-03:00</dhEmi><tpNF>1</tpNF><finNFe>1</finNFe><indFinal>0</indFinal></ide>
<emit><CNPJ>11222333000144</CNPJ><xNome>FORNECEDOR SA</xNome><enderEmit><UF>SP</UF></enderEmit><CRT>3</CRT></emit>
<dest><CNPJ>12345678000195</CNPJ><xNome>CLIENTE LTDA</xNome><enderDest><UF>ES</UF></enderDest></dest>
<det nItem="1"><prod><cProd>A1</cProd><cEAN>7891234567895</cEAN><xProd>SHAMPOO 300ML</xProd><NCM>33051000</NCM><CEST>2002000</CEST><CFOP>6403</CFOP><uCom>UN</uCom><qCom>10.0000</qCom><vUnCom>12.5000000000</vUnCom><vProd>125.00</vProd><vDesc>5.00</vDesc></prod>
<imposto><ICMS><ICMS10><orig>0</orig><CST>10</CST><modBC>3</modBC><vBC>120.00</vBC><pICMS>12.00</pICMS><vICMS>14.40</vICMS><modBCST>4</modBCST><pMVAST>40.00</pMVAST><vBCST>168.00</vBCST><pICMSST>17.00</pICMSST><vICMSST>14.16</vICMSST></ICMS10></ICMS>
<IPI><cEnq>999</cEnq><IPITrib><CST>50</CST><vBC>120.00</vBC><pIPI>5.00</pIPI><vIPI>6.00</vIPI></IPITrib></IPI>
<PIS><PISAliq><CST>01</CST><vBC>120.00</vBC><pPIS>1.65</pPIS><vPIS>1.98</vPIS></PISAliq></PIS>
<COFINS><COFINSAliq><CST>01</CST><vBC>120.00</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>9.12</vCOFINS></COFINSAliq></COFINS>
<IBSCBS><CST>000</CST><cClassTrib>000001</cClassTrib><gIBSCBS><vBC>120.00</vBC><gIBSUF><pIBSUF>0.1000</pIBSUF><vIBSUF>0.12</vIBSUF></gIBSUF><gIBSMun><pIBSMun>0.0000</pIBSMun><vIBSMun>0.00</vIBSMun></gIBSMun><vIBS>0.12</vIBS><gCBS><pCBS>0.9000</pCBS><vCBS>1.08</vCBS></gCBS></gIBSCBS></IBSCBS></imposto></det>
<det nItem="2"><prod><cProd>B2</cProd><cEAN>SEM GTIN</cEAN><xProd>SACOLA</xProd><NCM>39232190</NCM><CFOP>6102</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>2.00</vUnCom><vProd>2.00</vProd></prod>
<imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det>
<total><ICMSTot><vBC>120.00</vBC><vICMS>14.40</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>168.00</vBCST><vST>14.16</vST><vFCPST>0.00</vFCPST><vProd>127.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>5.00</vDesc><vIPI>6.00</vIPI><vPIS>1.98</vPIS><vCOFINS>9.12</vCOFINS><vOutro>0.00</vOutro><vNF>142.16</vNF></ICMSTot>
<IBSCBSTot><vBCIBSCBS>120.00</vBCIBSCBS><gIBS><gIBSUF><vIBSUF>0.12</vIBSUF></gIBSUF><vIBS>0.12</vIBS></gIBS><gCBS><vCBS>1.08</vCBS></gCBS></IBSCBSTot></total>
<cobr><fat><nFat>1234</nFat></fat><dup><nDup>001</nDup><dVenc>2026-10-20</dVenc><vDup>71.08</vDup></dup><dup><nDup>002</nDup><dVenc>2026-11-20</dVenc><vDup>71.08</vDup></dup></cobr>
</infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>${CHAVE}</chNFe><nProt>1</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;

const r = extrairNFe(nfe);
assert.equal(r.itens.length, 2);
const [i1, i2] = r.itens;
assert.equal(i1.n_item, 1);
assert.equal(i1.ncm, '33051000');
assert.equal(i1.cfop, '6403');
assert.equal(i1.cst_icms, '10');
assert.equal(i1.csosn, false);
assert.equal(i1.v_icms, 14.4);
assert.equal(i1.v_icms_st, 14.16);
assert.equal(i1.p_mva_st, 40);
assert.equal(i1.v_ipi, 6);
assert.equal(i1.cst_pis, '01');
assert.equal(i1.v_cofins, 9.12);
assert.equal(i1.cst_ibscbs, '000');
assert.equal(i1.c_class_trib, '000001');
assert.equal(i1.v_ibs, 0.12);
assert.equal(i1.v_cbs, 1.08);
assert.equal(i1.p_cbs, 0.9);
console.log('ok  item regime normal com ST, IPI, PIS/COFINS e IBS/CBS');

assert.equal(i2.cst_icms, '102');
assert.equal(i2.csosn, true);
assert.equal(i2.ean, null);
assert.equal(i2.cst_pis, '07');
assert.equal(i2.v_pis, null);
console.log('ok  item do Simples (CSOSN) e PIS/COFINS não tributado');

assert.equal(r.cabecalho.tp_nf, 1);
assert.equal(r.cabecalho.crt_emit, 3);
assert.equal(r.cabecalho.uf_emit, 'SP');
assert.equal(r.cabecalho.uf_dest, 'ES');
assert.equal(r.cabecalho.v_st, 14.16);
assert.equal(r.cabecalho.v_ibs, 0.12);
assert.equal(r.cabecalho.v_cbs, 1.08);
assert.equal(r.cabecalho.cfop, '6403,6102');
console.log('ok  totais da nota e CFOPs');

assert.equal(r.duplicatas.length, 2);
assert.deepEqual(r.duplicatas[1], { n_dup: '002', vencimento: '2026-11-20', valor: 71.08 });
console.log('ok  duplicatas');

const cte = `<cteProc xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00"><CTe><infCte Id="CTe32260944555666000177570010000009871000009876" versao="4.00">
<ide><CFOP>6353</CFOP><natOp>PRESTACAO DE SERVICO</natOp><mod>57</mod><UFIni>SP</UFIni><UFFim>ES</UFFim><toma3><toma>3</toma></toma3></ide>
<emit><CNPJ>44555666000177</CNPJ><enderEmit><UF>SP</UF></enderEmit></emit>
<rem><CNPJ>11222333000144</CNPJ></rem><dest><CNPJ>12345678000195</CNPJ></dest>
<vPrest><vTPrest>320.00</vTPrest></vPrest><imp><ICMS><ICMS00><CST>00</CST><vBC>320.00</vBC><pICMS>12.00</pICMS><vICMS>38.40</vICMS></ICMS00></ICMS></imp>
</infCte></CTe></cteProc>`;
const c = extrairCTe(cte);
assert.equal(c.cabecalho.cfop, '6353');
assert.equal(c.cabecalho.toma_doc, '12345678000195');
assert.equal(c.cabecalho.uf_ini, 'SP');
assert.equal(c.cabecalho.v_icms, 38.4);
assert.equal(c.cabecalho.v_prod, 320);
console.log('ok  CT-e: CFOP, tomador (toma3 = destinatário), UFs e ICMS');
console.log('\nTestes da extração passaram.');
