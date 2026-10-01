/**
 * Geração do SPED Fiscal e do SPED Contribuições (farmácia, Lucro Real, não cumulativo).
 * Os arquivos gerados passam pelos MESMOS leitores/validadores usados nos SPEDs enviados ao Appura.
 *
 *   npx tsx test/sped-gerar.test.ts
 */
import assert from 'assert';
import { analisarEfd } from '../src/sped/efd';
import { analisarContribuicoes, cruzarFiscalContribuicoes } from '../src/sped/contribuicoes';
import { anteriorContrib, anteriorIcms } from '../src/sped/gerar/anterior';
import { gerarEfdContribuicoes } from '../src/sped/gerar/contribuicoes';
import { Arquivo, d8, dataLocal, n, paraBuffer, t } from '../src/sped/gerar/escrita';
import { cfopEntradaItem, cstEntrada, gerarEfdIcms } from '../src/sped/gerar/icms';
import { DocFiscal, Estabelecimento, ItemDoc } from '../src/sped/gerar/tipos';
import { extraCTe, extraNFe } from '../src/sped/gerar/xml';
import { ServicoGerarSped } from '../src/painel/gerarSped';
import { bancoFalso } from './banco-falso';

/* ---------- utilitários de teste: CNPJ e chave com DV válidos ---------- */
function dvCnpj(base12: string) {
  const calc = (s: string, pesos: number[]) => { const r = s.split('').reduce((t, d, i) => t + Number(d) * pesos[i], 0) % 11; return r < 2 ? 0 : 11 - r; };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${d2}`;
}
function chave(cnpj: string, modelo: string, serie: number, numero: number, aamm = '2609') {
  const base = `32${aamm}${cnpj}${modelo}${String(serie).padStart(3, '0')}${String(numero).padStart(9, '0')}1${String(numero).padStart(8, '0')}`;
  let peso = 2; let soma = 0;
  for (let i = base.length - 1; i >= 0; i--) { soma += Number(base[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11; const dv = r < 2 ? 0 : 11 - r;
  return `${base}${dv}`;
}
const FARMA = dvCnpj('558859980001');
const FILIAL = dvCnpj('558859980002');
const DISTRIB = dvCnpj('112223330001');   // distribuidora (ES)
const INDUSTRIA = dvCnpj('445556660001'); // indústria (SP)
const TRANSP = dvCnpj('778889990001');
const CLIENTE = dvCnpj('221113330001');

const item = (x: Partial<ItemDoc> = {}): ItemDoc => ({
  n_item: 1, c_prod: 'P1', ean: null, x_prod: 'PRODUTO', ncm: '21069090', cest: null, cfop: '5102', u_com: 'UN', q_com: 1, v_prod: 100, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0,
  orig: 0, cst_icms: '00', csosn: false, p_red_bc: null, v_bc_icms: 100, p_icms: 17, v_icms: 17, v_fcp: 0, v_bc_st: 0, p_icms_st: 0, v_icms_st: 0, v_fcp_st: 0, v_ipi: 0,
  cst_pis: '01', cst_cofins: '01', cfop_escrit: null, ...x,
});
const part = (doc: string, nome: string, uf = 'ES', mun = '3205309') => ({ doc, cnpj: doc, cpf: '', nome, ie: '081234567', codMun: mun, codPais: '1058', end: 'RUA A', num: '10', compl: '', bairro: 'CENTRO', suframa: '', uf });
let seq = 0;
const doc = (x: Partial<DocFiscal> & { itens: ItemDoc[] }): DocFiscal => {
  const itens = x.itens.map((i, k) => ({ ...i, n_item: k + 1 }));
  const soma = (k: keyof ItemDoc) => itens.reduce((s, i) => s + (Number(i[k]) || 0), 0);
  const vNF = soma('v_prod') - soma('v_desc') + soma('v_frete') + soma('v_seg') + soma('v_outro') + soma('v_icms_st') + soma('v_fcp_st') + soma('v_ipi');
  return {
    chave: '', modelo: '55', serie: '1', numero: String(++seq), situacao: 'autorizada', completo: true, emitida_em: '2026-09-10T10:00:00-03:00', tp_nf: 1, fin_nfe: 1,
    emit_cnpj: FARMA, dest_doc: null, toma_doc: null, uf_emit: 'ES', cfop: null, valor: Math.round(vNF * 100) / 100, v_prod: soma('v_prod'), v_desc: soma('v_desc'), v_frete: soma('v_frete'), v_seg: soma('v_seg'), v_outro: soma('v_outro'),
    extraNfe: null, extraCte: null, ...x, itens,
  };
};
const comChave = (d: DocFiscal) => ({ ...d, chave: d.chave || chave(d.emit_cnpj!, d.modelo, Number(d.serie), Number(d.numero)) });

// 1) Escrita e regras puras
{
  assert.equal(n(1234.5), '1234,50'); assert.equal(n(2, 5), '2,00000'); assert.throws(() => n(-1), /negativo/);
  assert.equal(d8('2026-09-05T10:00:00-03:00'), '05092026');
  assert.equal(dataLocal('2026-10-01T02:30:00Z'), '2026-09-30', 'data local de São Paulo');
  assert.equal(t('Farmácia – “Vida” | Ltda\n'), 'Farmácia - "Vida" Ltda');
  const a = new Arquivo(); a.add('0000', 'x'); a.abrir('0', '0'); a.add('0005', 'y'); a.fechar(); a.abrir('C', '1'); a.fechar();
  const l = a.encerrar();
  assert.deepEqual(l.slice(-3), ['|9900|9999|1|', '|9990|13|', '|9999|19|']); // 6 tipos + 4 do bloco 9 = 10 linhas 9900
  assert.ok(l.includes('|0990|4|'), '0990 conta o 0000');
  assert.equal(cstEntrada({ cst_icms: '10', csosn: false }), '60'); assert.equal(cstEntrada({ cst_icms: '500', csosn: true }), '60'); assert.equal(cstEntrada({ cst_icms: '102', csosn: true }), '90');
  assert.equal(cfopEntradaItem({ cfop: '5405', cfop_escrit: null }, true), '1403'); assert.equal(cfopEntradaItem({ cfop: '6102', cfop_escrit: null }, false), '2102');
  assert.equal(cfopEntradaItem({ cfop: '5202', cfop_escrit: null }, true), '1202', 'devolução feita pelo cliente');
  assert.equal(cfopEntradaItem({ cfop: '5102', cfop_escrit: '1556' }, true), '1556', 'o CFOP de escrituração da auditoria manda');
  console.log('ok  escrita: números, datas, texto Latin-1, contadores (X990 e bloco 9) e conversão de CST/CFOP de entrada');
}

// 2) XML: participante, frete, pagamento e CT-e
{
  const nfe = `<nfeProc><NFe><infNFe Id="NFe1"><ide><dhEmi>2026-09-10T10:00:00-03:00</dhEmi><dhSaiEnt>2026-09-11T08:00:00-03:00</dhSaiEnt></ide>
    <emit><CNPJ>${DISTRIB}</CNPJ><xNome>DISTRIBUIDORA X</xNome><enderEmit><xLgr>AV B</xLgr><nro>5</nro><xBairro>IBES</xBairro><cMun>3205200</cMun><UF>ES</UF><cPais>1058</cPais></enderEmit><IE>082.222.33-1</IE></emit>
    <dest><CNPJ>${FARMA}</CNPJ><xNome>FARMA</xNome><enderDest><xLgr>RUA A</xLgr><cMun>3205309</cMun><UF>ES</UF></enderDest><IE>ISENTO</IE></dest>
    <transp><modFrete>1</modFrete></transp><cobr><dup><dVenc>2026-10-10</dVenc></dup></cobr><pag><detPag><tPag>15</tPag><vPag>10</vPag></detPag></pag></infNFe></NFe></nfeProc>`;
  const x = extraNFe(nfe);
  assert.deepEqual([x.emit!.doc, x.emit!.ie, x.emit!.codMun, x.dest!.ie, x.modFrete, x.indPgto], [DISTRIB, '082222331', '3205200', '', '1', '1']);
  const cte = `<cteProc><CTe><infCte><ide><CFOP>5353</CFOP><tpCTe>0</tpCTe><serie>1</serie><cMunIni>3205309</cMunIni><cMunFim>3550308</cMunFim><toma3><toma>0</toma></toma3></ide>
    <emit><CNPJ>${TRANSP}</CNPJ><xNome>TRANSP</xNome><enderEmit><xLgr>R C</xLgr><cMun>3205309</cMun><UF>ES</UF></enderEmit></emit>
    <rem><CNPJ>${FARMA}</CNPJ></rem><dest><CNPJ>${CLIENTE}</CNPJ></dest><vPrest><vTPrest>200.00</vTPrest><vRec>200.00</vRec></vPrest>
    <imp><ICMS><ICMS00><CST>00</CST><vBC>200.00</vBC><pICMS>12.00</pICMS><vICMS>24.00</vICMS></ICMS00></ICMS></imp>
    <infCTeNorm><infDoc><infNFe><chave>${chave(FARMA, '55', 1, 900)}</chave></infNFe></infDoc></infCTeNorm></infCte></CTe></cteProc>`;
  const y = extraCTe(cte);
  assert.deepEqual([y.toma, y.remDoc, y.icms.cst, y.icms.vICMS, y.vTPrest, y.cMunFim, y.chavesNFe.length], ['0', FARMA, '00', 24, 200, '3550308', 1]);
  console.log('ok  XML: participante (IE sem máscara, ISENTO vazio), frete, pagamento a prazo e CT-e (tomador, ICMS, NF-e transportada)');
}

/* ---------- cenário da farmácia ---------- */
const estab = (cnpj: string, docs: DocFiscal[]): Estabelecimento => ({
  id: cnpj, cnpj, razao_social: 'FARMACIA VIDA LTDA', uf: 'ES', regime: 'real', ie: '081234567', cod_municipio: '3205309', nome_fantasia: 'FARMACIA VIDA',
  cep: '29100000', logradouro: 'RUA A', numero: '10', complemento: null, bairro: 'CENTRO', fone: '2733330000', email: 'f@x.com', perfil_sped: 'A',
  contador_nome: null, contador_crc: null, contador_cnpj: null, contador_email: null, contador_fone: null, docs: docs.map(comChave),
});
const exNfe = (emit: string, dest: string, ufEmit = 'ES') => ({ emit: part(emit, `EMIT ${emit.slice(0, 4)}`, ufEmit), dest: part(dest, `DEST ${dest.slice(0, 4)}`), modFrete: '0', indPgto: '1' as const, dataSaiEnt: null });

const docs: DocFiscal[] = [
  // Compra tributada (distribuidora ES): crédito de ICMS 17% e PIS/COFINS 50
  doc({ emit_cnpj: DISTRIB, dest_doc: FARMA, extraNfe: exNfe(DISTRIB, FARMA), itens: [item({ c_prod: 'D10', ean: '7891000000017', x_prod: 'SUPLEMENTO', cfop: '5102', v_prod: 1000, v_bc_icms: 1000, v_icms: 170 })] }),
  // Compra com ST de medicamento (indústria SP): CST 60, sem crédito de ICMS; monofásico → PIS/COFINS 70
  doc({ emit_cnpj: INDUSTRIA, dest_doc: FARMA, uf_emit: 'SP', extraNfe: exNfe(INDUSTRIA, FARMA, 'SP'), itens: [
    item({ c_prod: 'M1', ean: '7891000000024', x_prod: 'DIPIRONA CX', ncm: '30049099', cfop: '6403', cst_icms: '10', u_com: 'CX', q_com: 10, v_prod: 500, v_bc_icms: 500, p_icms: 12, v_icms: 60, v_bc_st: 700, p_icms_st: 17, v_icms_st: 59 }),
    item({ c_prod: 'M2', x_prod: 'SHAMPOO', ncm: '33051000', cfop: '6403', cst_icms: '10', v_prod: 200, v_bc_icms: 200, p_icms: 12, v_icms: 24, v_icms_st: 20 }),
  ] }),
  // Compra para uso e consumo (CFOP de escrituração 1556): sem crédito; fica fora da EFD-Contribuições
  doc({ emit_cnpj: DISTRIB, dest_doc: FARMA, extraNfe: exNfe(DISTRIB, FARMA), itens: [item({ c_prod: 'SAC', x_prod: 'SACOLAS', cfop: '5102', cfop_escrit: '1556', v_prod: 80, v_bc_icms: 80, v_icms: 13.6 })] }),
  // NFC-e com 3 itens: tributado, medicamento (ST + monofásico), perfumaria (monofásico)
  doc({ modelo: '65', itens: [
    item({ cfop: '5102', v_prod: 50, v_bc_icms: 50, v_icms: 8.5 }),
    item({ cfop: '5405', ncm: '30049099', cst_icms: '60', v_prod: 30, v_bc_icms: 0, p_icms: 0, v_icms: 0, cst_pis: '04' }),
    item({ cfop: '5102', ncm: '33049910', v_prod: 40, v_desc: 4, v_bc_icms: 36, v_icms: 6.12, cst_pis: '04' }),
  ] }),
  doc({ modelo: '65', itens: [item({ cfop: '5102', v_prod: 20, v_bc_icms: 20, v_icms: 3.4 })] }),
  // NFC-e cancelada
  doc({ modelo: '65', situacao: 'cancelada', itens: [item({ v_prod: 10 })] }),
  // NF-e de venda para cliente PJ (5102) com frete cobrado
  doc({ dest_doc: CLIENTE, extraNfe: exNfe(FARMA, CLIENTE), itens: [item({ cfop: '5102', v_prod: 300, v_frete: 10, v_bc_icms: 310, v_icms: 52.7 })] }),
  // NF-e de transferência para a filial: não é receita
  doc({ dest_doc: FILIAL, extraNfe: exNfe(FARMA, FILIAL), itens: [item({ cfop: '5152', v_prod: 999, v_bc_icms: 0, p_icms: 0, v_icms: 0, cst_icms: '41' })] }),
  // Nota do mês seguinte (fora do período)
  doc({ modelo: '65', emitida_em: '2026-10-01T09:00:00-03:00', itens: [item({ v_prod: 77 })] }),
  // CT-e da venda (tomador = farmácia, remetente)
  doc({ modelo: '57', emit_cnpj: TRANSP, toma_doc: FARMA, cfop: '5353', itens: [], completo: true, extraCte: {
    emit: part(TRANSP, 'TRANSPORTADORA'), tpCTe: '0', cMunIni: '3205309', cMunFim: '3205200', serie: '1', vTPrest: 200, vRec: 200, icms: { cst: '00', vBC: 200, pICMS: 12, vICMS: 24 },
    toma: '0', remDoc: FARMA, destDoc: CLIENTE, chavesNFe: [], chaveSubstituida: '' } }),
];

// SPED do mês anterior (agosto/2026): de-para do GTIN, contador, saldo credor, E116, 1010, contas e saldo de crédito de PIS
const anteriorIcmsTxt = [
  `|0000|020|0|01082026|31082026|FARMACIA VIDA LTDA|${FARMA}||ES|081234567|3205309|||A|1|`,
  '|0100|JOAO CONTADOR|12345678909|ES012345O1|||||||||joao@esc.com|3205309|',
  `|0150|DIST01|DISTRIBUIDORA X|01058|${DISTRIB}||082222331|3205200||AV B|5||IBES|`,
  '|0190|UN|UNIDADE|', '|0190|CX|CAIXA|',
  '|0200|1001|DIPIRONA 500MG|7891000000024||UN|00|30049099||30||||', '|0220|CX|10,000000||',
  '|0200|1002|SUPLEMENTO VIT|7891000000017||UN|00|21069090||21||||',
  '|C100|0|1|DIST01|55|00|001|1|x|01082026|01082026|10,00|0|0,00|0,00|10,00|0|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|||||',
  '|C170|1|1002||1,00000|UN|10,00|0,00|0|000|1102||10,00|17,00|1,70||||||||||||||||||||||||0,00|',
  '|E110|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|150,00|0,00|',
  '|E116|000|10,00|10082026|1210|||||072026|',
  '|1010|N|N|N|N|N|N|N|N|N|N|N|N|N|',
].join('\r\n');
const anteriorContribTxt = [
  `|0000|006|0|||01082026|31082026|FARMACIA VIDA LTDA|${FARMA}|ES|3205309||00|2|`,
  '|0100|JOAO CONTADOR|12345678909|ES012345O1|||||||||joao@esc.com|3205309|',
  '|0500|01012020|04|A|5|3.1.1.01|RECEITA DE VENDAS TRIBUTADAS|||', '|0500|01012020|04|A|5|3.1.1.02|RECEITA DE VENDAS MONOFASICAS|||',
  '|0500|01012020|01|A|5|1.1.4.01|ESTOQUE DE MERCADORIAS|||', '|0500|01012020|04|A|5|4.2.1.05|FRETES SOBRE VENDAS|||',
  '|C100|1|0||65|00|001|1|x|01082026||10,00|0|0,00||10,00|9|0,00|0,00|0,00|0,00|0,00|||||||',
  '|C175|5102|10,00|0,00|01|10,00|1,6500|||0,17|01|10,00|7,6000|||0,76|3.1.1.01||',
  '|C175|5405|10,00|0,00|04|0,00|0,0000|||0,00|04|0,00|0,0000|||0,00|3.1.1.02||',
  '|C100|0|1|X|55|00|001|1|x|01082026|01082026|10,00|0|0,00||10,00|0|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|||',
  '|C170|1|1002||1,00000|UN|10,00|0,00|0|000|1102||0,00|0,00|0,00|0,00|0,00|0,00|||||||50|10,00|1,6500|||0,17|50|10,00|7,6000|||0,76|1.1.4.01|',
  '|C170|2|1001||1,00000|UN|10,00|0,00|0|060|1403||0,00|0,00|0,00|0,00|0,00|0,00|||||||70|||||0,00|70|||||0,00|1.1.4.01|',
  '|D101|0|10,00|50|07|10,00|1,6500|0,17|4.2.1.05|',
  '|1100|072026|01||101|100,00||100,00|30,00|||70,00|20,00|||||50,00|',
].join('\r\n');

async function teste() {
  const antI = anteriorIcms(anteriorIcmsTxt);
  assert.deepEqual([antI.itemPorEan.get('7891000000024'), antI.itens.get('1001')!.conversoes, antI.sldCredorTransportar, antI.e116!.codRec, antI.perfil], ['1001', [{ unid: 'CX', fator: 10 }], 150, '1210', 'A']);
  assert.deepEqual(antI.escrituracaoItem.get('1002'), { cst: '000', cfop: '1102' });
  const antC = anteriorContrib(anteriorContribTxt);
  assert.deepEqual([antC.contaPor.get('S|01|5102'), antC.contaPor.get('S|04'), antC.contaPor.get('E|70'), antC.contaPor.get('F|50'), antC.saldos1100.length], ['3.1.1.01', '3.1.1.02', '1.1.4.01', '4.2.1.05', 1]);

  /* ----- SPED Fiscal ----- */
  const e = estab(FARMA, docs);
  const ri = gerarEfdIcms(e, { competencia: '2026-09', anterior: antI });
  const txtI = ri.linhas.join('\r\n');
  const contar = (reg: string) => ri.linhas.filter((l) => l.startsWith(`|${reg}|`));
  const campos = (l: string) => l.slice(1, -1).split('|').length;
  for (const [reg, q] of [['0000', 15], ['0005', 10], ['0100', 14], ['0150', 13], ['0200', 13], ['C100', 29], ['C170', 38], ['C190', 12], ['D100', 25], ['D190', 9], ['E110', 15], ['E116', 10], ['1010', 14]] as const) {
    for (const l of contar(reg)) assert.equal(campos(l), q, `${reg} com ${q} campos: ${l}`);
  }
  // Leitor/validador do Appura: estrutura, 9900, X990 e 9999 sem erro
  const ai = analisarEfd(paraBuffer(ri.linhas));
  const errosI = ai.ocorrencias.filter((x) => x.nivel === 'erro');
  assert.deepEqual(errosI, [], `sem erros no validador: ${JSON.stringify(errosI)}`);
  assert.equal(ai.resumo.codVer, '020');
  // Documentos: 3 entradas, NFC-e (2 + cancelada), 1 venda e 1 transferência, 1 CT-e; o de outubro fica fora
  assert.equal(contar('C100').length, 8); assert.equal(contar('D100').length, 1);
  assert.ok(!txtI.includes('1003') && !txtI.includes('01102026'), 'nota de outubro fora');
  const cancel = contar('C100').find((l) => l.includes('|65|02|'))!;
  assert.equal(campos(cancel), 29); assert.match(cancel, /^\|C100\|1\|0\|\|65\|02\|001\|\d+\|\d{44}\|{21}$/, 'cancelada só com a identificação');
  // De-para pelo GTIN: dipirona vira o código próprio 1001, comprada em CX com fator 10 (0220)
  assert.ok(txtI.includes('|C170|1|1001|DIPIRONA CX|10,00000|CX|559,00|0,00|0|060|2403|'), 'ST e custo no VL_ITEM, CST 060, CFOP 2403');
  assert.ok(txtI.includes('|0220|CX|10,000000||'));
  assert.ok(txtI.includes(`|C170|1|1002|SUPLEMENTO|1,00000|UN|1000,00|0,00|0|000|1102||1000,00|17,00|170,00|`), 'crédito de ICMS na compra tributada');
  assert.ok(txtI.includes(`|C170|1|${DISTRIB}-SAC|SACOLAS|1,00000|UN|80,00|0,00|0|090|1556|`), 'uso e consumo: CST 090 sem crédito; item sem de-para com o código do fornecedor');
  assert.ok(ri.pendencias.some((p) => p.codigo === 'sem_depara'));
  // NFC-e: C190 por CST+CFOP+alíquota, sem C170; participante só da NF-e
  assert.ok(txtI.includes('|C190|000|5102|17,00|86,00|86,00|14,62|0,00|0,00|0,00|0,00||'), 'NFC-e: tributado 50 + perfumaria 40 − 4 de desconto, no mesmo grupo CST+CFOP+alíquota');
  assert.ok(txtI.includes('|C190|060|5405|0,00|30,00|0,00|0,00|0,00|0,00|0,00|0,00||'), 'medicamento com ST: CST 060 sem ICMS');
  assert.ok(!contar('0150').some((l) => l.includes('CONSUMIDOR')));
  assert.ok(contar('0150').some((l) => l.startsWith('|0150|DIST01|')), 'código do participante do SPED anterior');
  // CT-e: crédito de frete só se o SPED anterior creditava (não creditava) → CST 090
  assert.ok(txtI.includes('|D190|090|1353|0,00|200,00|0,00|0,00|0,00||'));
  // Apuração: débitos = NFC-e + venda; créditos = compra tributada; saldo credor anterior 150
  const deb = 8.5 + 6.12 + 3.4 + 52.7; const cred = 170;
  assert.deepEqual(ai.resumo.apuracao, { debitos: deb, creditos: cred, saldoCredorAnterior: 150, recolher: 0, saldoCredorTransportar: Math.round((cred + 150 - deb) * 100) / 100 });
  assert.deepEqual(ai.resumo.apuracaoCalculada, { debitos: deb, creditos: cred }, 'E110 = soma dos C190 (mesma conta do leitor)');
  assert.equal(contar('E116').length, 0, 'sem ICMS a recolher, sem E116');
  assert.ok(!ri.pendencias.some((p) => p.nivel === 'erro'), `sem pendências de erro: ${JSON.stringify(ri.pendencias.filter((p) => p.nivel === 'erro'))}`);

  // Com ICMS a recolher: E116 com código de receita e vencimento do mês seguinte (dia do anterior)
  const venda = doc({ dest_doc: CLIENTE, extraNfe: exNfe(FARMA, CLIENTE), itens: [item({ cfop: '5102', v_prod: 3000, v_bc_icms: 3000, v_icms: 510 })] });
  const ri2 = gerarEfdIcms(estab(FARMA, [...docs, venda]), { competencia: '2026-09', anterior: antI });
  const e116 = ri2.linhas.find((l) => l.startsWith('|E116|'))!;
  const e110 = ri2.linhas.find((l) => l.startsWith('|E110|'))!.slice(1, -1).split('|');
  assert.equal(e116, `|E116|000|${e110[12]}|10102026|1210|||||092026|`);
  assert.deepEqual(analisarEfd(paraBuffer(ri2.linhas)).ocorrencias.filter((x) => x.nivel === 'erro'), []);

  // Sem SPED anterior: pendências claras (contabilista, E116), mas o arquivo continua estruturalmente válido
  const ri3 = gerarEfdIcms(estab(FARMA, [...docs, venda]), { competencia: '2026-09', anterior: null });
  const cod3 = ri3.pendencias.map((p) => `${p.nivel}:${p.codigo}`);
  for (const k of ['alerta:sem_anterior', 'erro:contabilista', 'erro:e116']) assert.ok(cod3.includes(k), k);
  assert.deepEqual(analisarEfd(paraBuffer(ri3.linhas)).ocorrencias.filter((x) => x.nivel === 'erro' && /9900|990|9999|LINHA/.test(x.codigo)), []);
  // Fevereiro e 1601 viram erro de pendência
  assert.ok(gerarEfdIcms(estab(FARMA, []), { competencia: '2026-02', anterior: null }).pendencias.some((p) => p.codigo === 'inventario'));
  console.log('ok  SPED Fiscal: estrutura validada pelo leitor, campos por registro, de-para e 0220, CST/CFOP de entrada, C190, CT-e, E110 com saldo credor e E116');

  /* ----- SPED Contribuições ----- */
  const filialDocs = [doc({ modelo: '65', emit_cnpj: FILIAL, itens: [item({ cfop: '5102', v_prod: 60, v_bc_icms: 60, v_icms: 10.2 })] })];
  const rc = gerarEfdContribuicoes([estab(FARMA, docs), estab(FILIAL, filialDocs)], { competencia: '2026-09', anterior: antC });
  const L = rc.linhas; const txtC = L.join('\r\n');
  const cont = (reg: string) => L.filter((l) => l.startsWith(`|${reg}|`));
  for (const [reg, q] of [['0000', 14], ['0110', 5], ['0140', 9], ['0150', 13], ['0200', 12], ['0500', 9], ['C100', 29], ['C170', 37], ['C175', 18], ['D100', 23], ['D101', 9], ['M100', 15], ['M105', 10], ['M200', 13], ['M205', 4], ['M210', 16], ['M400', 5], ['M410', 5], ['M610', 16], ['1100', 18]] as const) {
    for (const l of cont(reg)) assert.equal(campos(l), q, `${reg} com ${q} campos: ${l}`);
  }
  const ac = analisarContribuicoes(paraBuffer(L));
  const errosC = ac.ocorrencias.filter((x) => x.nivel === 'erro');
  assert.deepEqual(errosC, [], `sem erros no validador: ${JSON.stringify(errosC)}`);
  assert.deepEqual(ac.ocorrencias.filter((x) => /^M[2468]00/.test(x.codigo)), [], 'M200/M600/M400/M800 batem com os documentos');
  assert.deepEqual(cont('0110'), ['|0110|1|1|1||']);
  assert.equal(cont('0140').length, 2, 'matriz e filial');
  assert.equal(cont('C010').length, 2);
  // Entradas: tributada com crédito (CST 50, base sem o ICMS), medicamento/shampoo monofásicos (70); uso e consumo fora
  assert.ok(txtC.includes('|50|830,00|1,6500|||13,70|50|830,00|7,6000|||63,08|1.1.4.01|'), 'base do crédito = 1000 − 170 de ICMS');
  assert.equal(cont('C170').filter((l) => l.includes('|70|')).length, 2);
  assert.ok(!txtC.includes('SACOLAS') && !txtC.includes(`${DISTRIB}-SAC`), 'uso e consumo fora');
  // NFC-e: C175 por CFOP+CST; ICMS excluído da base pelo VL_DESC
  assert.ok(txtC.includes('|C175|5102|50,00|8,50|01|41,50|1,6500|||0,68|01|41,50|7,6000|||3,15|3.1.1.01||'));
  assert.ok(txtC.includes('|C175|5102|40,00|4,00|04|0,00|0,0000|||0,00|04|0,00|0,0000|||0,00|3.1.1.02||'), 'perfumaria monofásica');
  assert.ok(txtC.includes('|C175|5405|30,00|0,00|04|'));
  // Venda NF-e: base = 300 + 10 frete − 52,70 ICMS; transferência fora
  assert.ok(txtC.includes('|01|257,30|1,6500|||4,25|01|257,30|7,6000|||19,55|3.1.1.01|'));
  assert.ok(!cont('C100').some((l) => l.includes('|999,00|')), 'transferência fora');
  // Frete de venda: crédito NAT 07, base sem o ICMS do CT-e
  assert.deepEqual(cont('D101'), ['|D101|0|200,00|50|07|176,00|1,6500|2,90|4.2.1.05|']);
  // Bloco M: débito (CST 01), crédito (101 por NAT), receita monofásica por NAT_REC 201/202
  const m210 = cont('M210')[0].slice(1, -1).split('|');
  const bcDeb = 41.5 + 16.6 + 257.3 + 49.8; // NFC-e 5102 (50−8,50), NFC-e 20−3,40, venda, filial 60−10,20
  assert.equal(m210[3], bcDeb.toFixed(2).replace('.', ','));
  assert.deepEqual(cont('M105'), ['|M105|01|50|830,00||830,00|830,00||||', '|M105|07|50|176,00||176,00|176,00||||']);
  assert.deepEqual(cont('M410').map((l) => l.split('|')[2]), ['201', '202']);
  // Crédito anterior de 50,00 (1100 de 07/2026) usado primeiro; saldo do período em 1100 próprio
  const m200 = cont('M200')[0].slice(1, -1).split('|').map((x) => Number(x.replace(',', '.')));
  const debPis = Math.round(bcDeb * 1.65) / 100; const credPis = Math.round((830 + 176) * 1.65) / 100;
  assert.equal(m200[1], debPis); assert.equal(m200[3], Math.min(50, debPis), 'crédito anterior primeiro');
  assert.equal(m200[2], Math.round(Math.max(0, Math.min(credPis, debPis - m200[3])) * 100) / 100);
  assert.equal(m200[7], 0, 'nada a recolher de PIS: créditos cobrem');
  assert.equal(cont('M205').length, 0, 'M205 proibido sem valor a recolher');
  const r1100 = cont('1100');
  assert.ok(r1100[0].startsWith('|1100|072026|01||101|100,00||100,00|50,00|'), 'saldo anterior: 30 + 20 já usados');
  assert.ok(r1100.some((l) => l.startsWith('|1100|092026|01||101|')), 'saldo do crédito do período');
  // Contas: só as usadas, todas no 0500
  assert.deepEqual(cont('0500').map((l) => l.split('|')[6]).sort(), ['1.1.4.01', '3.1.1.01', '3.1.1.02', '4.2.1.05']);
  assert.ok(!rc.pendencias.some((p) => p.nivel === 'erro'), `sem pendências de erro: ${JSON.stringify(rc.pendencias.filter((p) => p.nivel === 'erro'))}`);
  // Cruzamento SPED Fiscal × Contribuições do próprio Appura
  const cz = cruzarFiscalContribuicoes(ai.efd, ac.efd);
  const relevantes = cz.divergencias.filter((d) => d.tipo !== 'fiscal_sem_contribuicoes' && !d.chave.includes(FILIAL));
  assert.deepEqual(relevantes, [], `cruzamento: ${JSON.stringify(relevantes.slice(0, 3))}`);
  assert.ok(cz.divergencias.filter((d) => d.tipo === 'contribuicoes_sem_fiscal').every((d) => d.chave.includes(FILIAL)), 'só a NFC-e da filial (o SPED Fiscal é por estabelecimento)');
  // Sem SPED anterior: COD_CTA obrigatório vira erro de pendência
  const rc2 = gerarEfdContribuicoes([estab(FARMA, docs)], { competencia: '2026-09', anterior: null });
  assert.ok(rc2.pendencias.some((p) => p.codigo === 'cod_cta' && p.nivel === 'erro'));
  console.log('ok  SPED Contribuições: estrutura validada pelo leitor, C170/C175/D101, CST 50/70/04, exclusão do ICMS, M100/M105/M200/M210/M410, crédito anterior (1100), 0500 e cruzamento com o SPED Fiscal');
}

async function testeServico() {
  const { db, t } = bancoFalso(['empresas', 'documentos', 'documento_itens', 'sped_arquivos', 'sped_gerados']);
  const E = { id: '11111111-1111-1111-1111-111111111111', cnpj: FARMA, razao_social: 'FARMACIA VIDA LTDA', uf: 'ES', regime: 'real', ativo: true, ie: '081234567', cod_municipio: '3205309',
    nome_fantasia: 'VIDA', cep: '29100000', logradouro: 'RUA A', numero: '1', complemento: null, bairro: 'CENTRO', fone: null, email: null, perfil_sped: 'A',
    contador_nome: null, contador_crc: null, contador_cnpj: null, contador_email: null, contador_fone: null };
  const S = { ...E, id: '22222222-2222-2222-2222-222222222222', cnpj: dvCnpj('998887770001'), regime: 'simples' };
  t.empresas.push(E, S);
  const armazem = new Map<string, Buffer>();
  const arm: any = { salvar: async (c: string, b: Buffer) => { armazem.set(`r2:${c}`, Buffer.from(b)); return `r2:${c}`; }, ler: async (c: string) => { const b = armazem.get(c); if (!b) throw new Error('não achou'); return b; } };
  // Compra tributada com o XML guardado; NFC-e só no banco; CT-e com XML que falha na leitura
  const chC = chave(DISTRIB, '55', 1, 50); const chN = chave(FARMA, '65', 1, 7); const chT = chave(TRANSP, '57', 1, 9);
  t.documentos.push(
    { empresa_id: E.id, chave: chC, modelo: '55', serie: '1', numero: '50', situacao: 'autorizada', completo: true, emitida_em: '2026-09-03T10:00:00-03:00', tp_nf: 1, fin_nfe: 1, emit_cnpj: DISTRIB, dest_doc: FARMA, toma_doc: null, uf_emit: 'ES', cfop: '5102', valor: 1000, v_prod: 1000, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, xml_path: 'r2:xml/c.xml', direcao: 'entrada' },
    { empresa_id: E.id, chave: chN, modelo: '65', serie: '1', numero: '7', situacao: 'autorizada', completo: true, emitida_em: '2026-09-04T10:00:00-03:00', tp_nf: 1, fin_nfe: 1, emit_cnpj: FARMA, dest_doc: null, toma_doc: null, uf_emit: 'ES', cfop: '5102', valor: 50, v_prod: 50, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, xml_path: 'r2:xml/n.xml', direcao: 'saida' },
    { empresa_id: E.id, chave: chT, modelo: '57', serie: '1', numero: '9', situacao: 'autorizada', completo: true, emitida_em: '2026-09-05T10:00:00-03:00', tp_nf: null, fin_nfe: null, emit_cnpj: TRANSP, dest_doc: null, toma_doc: FARMA, uf_emit: 'ES', cfop: '5353', valor: 200, v_prod: 200, v_desc: 0, v_frete: 0, v_seg: 0, v_outro: 0, xml_path: 'r2:xml/sumiu.xml', direcao: 'entrada' },
  );
  t.documento_itens.push(
    { empresa_id: E.id, ...item({ c_prod: 'D10', ean: '7891000000017', cfop: '5102', v_prod: 1000, v_bc_icms: 1000, v_icms: 170 }), chave: chC, n_item: 1 },
    { empresa_id: E.id, ...item({ cfop: '5102', v_prod: 50, v_bc_icms: 50, v_icms: 8.5 }), chave: chN, n_item: 1 },
  );
  armazem.set('r2:xml/c.xml', Buffer.from(`<nfeProc><NFe><infNFe><ide><dhEmi>2026-09-03T10:00:00-03:00</dhEmi></ide><emit><CNPJ>${DISTRIB}</CNPJ><xNome>DISTRIBUIDORA X</xNome><enderEmit><xLgr>AV B</xLgr><nro>5</nro><xBairro>IBES</xBairro><cMun>3205200</cMun><UF>ES</UF></enderEmit><IE>082222331</IE></emit><dest><CNPJ>${FARMA}</CNPJ></dest><transp><modFrete>0</modFrete></transp></infNFe></NFe></nfeProc>`));
  // SPED anterior guardado (agosto)
  armazem.set('r2:sped/ant.txt', Buffer.from(anteriorIcmsTxt, 'latin1'));
  t.sped_arquivos.push({ id: 1, empresa_id: E.id, cnpj: FARMA, tipo: 'efd_icms_ipi', competencia: '2026-08-01', caminho: 'r2:sped/ant.txt', enviado_em: '2026-09-02T10:00:00Z' });
  const recebidos: any[] = [];
  const spedFalso: any = { receber: async (nome: string, buf: Buffer, email: string, emp: any) => { recebidos.push({ nome, tamanho: buf.length, email, emp }); return { valido: true, id: 77 }; } };
  const s = new ServicoGerarSped(db, arm, spedFalso);

  await assert.rejects(s.gerar(S.id, '2026-09', 'efd_icms_ipi', 'ana@x.com'), /Lucro Real e Presumido/);
  await assert.rejects(s.gerar(E.id, '2026-9', 'efd_icms_ipi', 'ana@x.com'), /Competência inválida/);
  const g1 = await s.gerar(E.id, '2026-09', 'efd_icms_ipi', 'ana@x.com') as any;
  assert.equal(g1.versao, 1); assert.equal(g1.nome, `SPED-FISCAL_${FARMA}_202609_v1.txt`);
  assert.ok(g1.pendencias.some((p: any) => p.codigo === 'xml_ausente' && /1 XML/.test(p.texto)), 'XML do CT-e que não foi lido vira pendência');
  assert.equal(g1.resumo.icms.saldoCredorAnterior, 150, 'saldo credor do SPED anterior guardado');
  assert.deepEqual(g1.validacao.filter((o: any) => o.nivel === 'erro'), []);
  const arq = await s.baixar(g1.id);
  const txt = arq.conteudo.toString('latin1');
  assert.ok(txt.startsWith(`|0000|020|0|01092026|30092026|FARMACIA VIDA LTDA|${FARMA}|`) && txt.endsWith('|\r\n'));
  assert.ok(txt.includes('|0150|DIST01|DISTRIBUIDORA X|01058|') && txt.includes('|C170|1|1002|'), 'participante pelo XML e item pelo de-para do SPED anterior');
  const g2 = await s.gerar(E.id, '2026-09', 'efd_icms_ipi', 'ana@x.com') as any;
  assert.equal(g2.versao, 2, 'nova geração = nova versão');
  const lst = await s.listar(E.id, '2026-09');
  assert.deepEqual(lst.fiscal.map((x: any) => x.versao), [2, 1]);
  // Contribuições: não tem anterior → COD_CTA vira erro de pendência, mas o arquivo sai
  const gc = await s.gerar(E.id, '2026-09', 'efd_contribuicoes', 'ana@x.com') as any;
  assert.ok(gc.pendencias.some((p: any) => p.codigo === 'cod_cta'));
  assert.ok(gc.erros > 0);
  // Auditar: passa pelo recebimento de SPED do Appura (comparações e justificativas)
  const r = await s.auditar(g2.id, 'sup@x.com') as any;
  assert.equal(r.id, 77); assert.equal(recebidos[0].emp.cnpj, FARMA); assert.equal(recebidos[0].nome, g2.nome);
  assert.equal(t.sped_gerados.find((x: any) => x.id === g2.id).auditado_arquivo_id, 77);
  console.log('ok  serviço: documentos do banco + XML do armazenamento, SPED anterior guardado, versões, validação, download e auditoria');
}

teste().then(testeServico).then(() => console.log('\nTestes da geração de SPED passaram.')).catch((e) => { console.error(e); process.exit(1); });
