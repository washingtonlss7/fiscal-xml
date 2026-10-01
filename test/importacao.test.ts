/**
 * Importação de XML/ZIP pelo painel: leitura de ZIP, validação, decodificação e gravação.
 *
 *   npx tsx test/importacao.test.ts
 */
import assert from 'assert';
import { PassThrough } from 'stream';
import { abrirEnvio, decodificarXml, importarXmls, prepararXml } from '../src/importacao/importar';
import { lerZip } from '../src/importacao/zipLeitor';
import { Zip } from '../src/painel/zip';

const EMPRESA = { id: 'e1', cnpj: '55885998000140', c_uf: 32 };
const chave = (mod: string, n: number) => `3226095588599800014${0}${mod}001${String(n).padStart(9, '0')}1${String(n).padStart(8, '0')}`.slice(0, 44).padEnd(44, '0');

function nota(mod: '55' | '65', n: number, opts: { emit?: string; dest?: string; cStat?: string; semProt?: boolean } = {}) {
  const ch = chave(mod, n);
  const dest = opts.dest ? `<dest><CNPJ>${opts.dest}</CNPJ><xNome>Cliente</xNome></dest>` : '';
  const prot = opts.semProt ? '' : `<protNFe versao="4.00"><infProt><chNFe>${ch}</chNFe><nProt>13226000000${n}</nProt><cStat>${opts.cStat ?? '100'}</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe>`;
  const nfe = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${ch}" versao="4.00"><ide><mod>${mod}</mod><serie>1</serie><nNF>${n}</nNF><dhEmi>2026-09-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>${opts.emit ?? EMPRESA.cnpj}</CNPJ><xNome>FARMA</xNome><enderEmit><UF>ES</UF></enderEmit><CRT>1</CRT></emit>${dest}<det nItem="1"><prod><cProd>1</cProd><xProd>DIPIRONA</xProd><NCM>30049099</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>10</vUnCom><vProd>10.00</vProd></prod><imposto><ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS></imposto></det><total><ICMSTot><vProd>10.00</vProd><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe>`;
  return opts.semProt ? nfe : `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${nfe}${prot}</nfeProc>`;
}

async function zipDe(arquivos: { nome: string; conteudo: Buffer }[]): Promise<Buffer> {
  const saida = new PassThrough();
  const partes: Buffer[] = [];
  saida.on('data', (b) => partes.push(b));
  const z = new Zip(saida);
  for (const a of arquivos) await z.adicionar(a.nome, a.conteudo);
  await z.finalizar();
  saida.end();
  return Buffer.concat(partes);
}

/** Banco falso: registra as operações e devolve vazio (suficiente para o fluxo de gravação). */
function bancoFalso(existentes: { chave: string; completo: boolean }[] = []) {
  const ops: { tabela: string; op: string; dados?: any }[] = [];
  const consulta = (tabela: string) => {
    let op = 'select';
    let dados: any;
    const q: any = {
      select: () => q, eq: () => q, in: () => q, limit: () => q, order: () => q, not: () => q, is: () => q,
      upsert: (d: any) => { op = 'upsert'; dados = d; return q; },
      update: (d: any) => { op = 'update'; dados = d; return q; },
      insert: (d: any) => { op = 'insert'; dados = d; return q; },
      delete: () => { op = 'delete'; return q; },
      then: (ok: any) => {
        ops.push({ tabela, op, dados });
        const data = tabela === 'documentos' && op === 'select' ? existentes : [];
        return Promise.resolve({ data, error: null }).then(ok);
      },
    };
    return q;
  };
  return { db: { from: consulta } as any, ops };
}
const armFalso = { salvar: async (c: string) => `r2:${c}` } as any;

(async () => {
  // 1) ZIP (com ZIP dentro) e filtro de .xml
  {
    const interno = await zipDe([{ nome: 'b.xml', conteudo: Buffer.from(nota('65', 2)) }]);
    const zip = await zipDe([
      { nome: 'a.xml', conteudo: Buffer.from(nota('65', 1)) },
      { nome: 'leia-me.txt', conteudo: Buffer.from('x') },
      { nome: 'lote.zip', conteudo: interno },
    ]);
    const lidos = abrirEnvio('envio.zip', zip);
    assert.deepEqual(lidos.map((x) => x.nome), ['a.xml', 'lote.zip/b.xml']);
    assert.equal(lidos[0].conteudo.toString(), nota('65', 1));
    assert.throws(() => lerZip(Buffer.from('PK\u0003\u0004 lixo')), /ZIP inválido/);
    console.log('ok  ZIP: lê XMLs, abre ZIP dentro de ZIP e ignora outros arquivos');
  }

  // 2) Validação
  {
    const p = prepararXml(nota('65', 3));
    assert.equal(p.modelo, '65');
    assert.equal(p.emit, EMPRESA.cnpj);
    assert.equal(p.schema.split('_')[0], 'procNFe');
    assert.throws(() => prepararXml(nota('55', 4, { semProt: true })), /sem protocolo/);
    assert.throws(() => prepararXml(nota('55', 5, { cStat: '204' })), /rejeitada pela SEFAZ \(204/);
    assert.throws(() => prepararXml('isto não é xml'), /não é um arquivo XML/);
    assert.throws(() => prepararXml('<cadastro><x>1</x></cadastro>'), /não reconhecido/);
    console.log('ok  validação: exige protocolo autorizado e tipo reconhecido (NFC-e identificada como modelo 65)');
  }

  // 3) XML em ISO-8859-1
  {
    const latin = Buffer.from(nota('55', 6).replace('UTF-8', 'ISO-8859-1').replace('DIPIRONA', 'PÃO DE AÇÚCAR'), 'latin1');
    const t = decodificarXml(latin);
    assert.ok(t.includes('PÃO DE AÇÚCAR'));
    assert.ok(t.includes('encoding="UTF-8"'));
    console.log('ok  XML em ISO-8859-1 convertido sem estragar acentos');
  }

  // 4) Gravação: saída própria, entrada, de outra empresa (recusada), repetida e já existente
  {
    const { db, ops } = bancoFalso([{ chave: chave('55', 12), completo: true }, { chave: chave('55', 13), completo: false }]);
    const arquivos = [
      { nome: 'nfce1.xml', conteudo: Buffer.from(nota('65', 10)) },
      { nome: 'nfce1-copia.xml', conteudo: Buffer.from(nota('65', 10)) },
      { nome: 'entrada.xml', conteudo: Buffer.from(nota('55', 11, { emit: '11222333000181', dest: EMPRESA.cnpj })) },
      { nome: 'ja-tem.xml', conteudo: Buffer.from(nota('55', 12)) },
      { nome: 'so-resumo.xml', conteudo: Buffer.from(nota('55', 13, { emit: '11222333000181', dest: EMPRESA.cnpj })) },
      { nome: 'outra-empresa.xml', conteudo: Buffer.from(nota('55', 14, { emit: '11222333000181', dest: '99888777000166' })) },
    ];
    const r = await importarXmls(db, armFalso, EMPRESA, arquivos);
    assert.equal(r.importadas, 2, JSON.stringify(r.resultados));
    assert.equal(r.completouResumo, 1);
    assert.equal(r.jaExistiam, 2);
    assert.equal(r.rejeitadas, 1);
    assert.match(r.resultados.find((x) => x.arquivo === 'outra-empresa.xml')!.motivo!, /não é emitente nem destinatário/);
    assert.deepEqual(r.porModelo, { 'NFC-e saída': 1, 'NF-e entrada': 2 });
    const gravados = ops.filter((o) => o.tabela === 'documentos' && o.op === 'upsert').map((o) => o.dados);
    assert.equal(gravados.length, 3);
    const nfce = gravados.find((d) => d.modelo === '65');
    assert.equal(nfce.direcao, 'saida');
    assert.equal(nfce.recebido_via, 'importacao');
    assert.equal(nfce.nsu, null);
    assert.ok(nfce.xml_path.startsWith('r2:55885998000140/2026/09/65/'));
    assert.ok(ops.some((o) => o.tabela === 'documento_itens' && o.op === 'insert'), 'itens extraídos na importação');
    console.log('ok  importação: saída (NFC-e) e entrada gravadas, resumo completado, repetidas e de outro CNPJ tratadas');
  }

  // 5) Rejeitada pela SEFAZ (vai para notas_rejeitadas, não vira documento) e XML com protocolo de cancelamento (entra cancelada)
  {
    const { db, ops } = bancoFalso();
    const r = await importarXmls(db, armFalso, EMPRESA, [
      { nome: 'rej-normal.xml', conteudo: Buffer.from(nota('65', 20, { cStat: '1023' })) },
      { nome: 'rej-normal-copia.xml', conteudo: Buffer.from(nota('65', 20, { cStat: '1023' })) },
      { nome: 'rej-outro-emitente.xml', conteudo: Buffer.from(nota('55', 21, { cStat: '1023', emit: '11222333000181', dest: EMPRESA.cnpj })) },
      { nome: 'cancelada.xml', conteudo: Buffer.from(nota('65', 22, { cStat: '101' })) },
    ]);
    assert.deepEqual([r.rejeitadasSefaz, r.rejeitadas, r.importadas], [2, 1, 1], JSON.stringify(r.resultados));
    const rej = ops.filter((o) => o.tabela === 'notas_rejeitadas' && o.op === 'upsert').flatMap((o) => o.dados);
    assert.deepEqual(rej.map((x: any) => [x.numero, x.cstat, x.empresa_id]), [['20', '1023', EMPRESA.id]], 'uma linha por chave, só do próprio emitente');
    const canc = ops.find((o) => o.tabela === 'documentos' && o.op === 'upsert')!.dados;
    assert.equal(canc.situacao, 'cancelada', 'protocolo 101 entra como cancelada');
    console.log('ok  rejeitada pela SEFAZ guardada à parte (sem virar documento) e XML com protocolo de cancelamento entra cancelado');
  }

  console.log('\nTestes da importação passaram.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
