/**
 * NFS-e Nacional: leitura da resposta do ADN, do XML da nota e dos eventos, captação por NSU (com transporte falso),
 * painel, Contábil e tela.
 *
 *   npx tsx test/nfse.test.ts
 */
import assert from 'assert';
import zlib from 'zlib';
import { bancoFalso } from './banco-falso';
import { abrirArquivo, consultarAdn, ErroAdn, lerRetorno, Transporte } from '../src/nfse/adn';
import { lerXmlNfse, papelNaNota } from '../src/nfse/leitor';
import { esperaAposErro, nfseLiberadaEm, sincronizarNfse, TAMANHO_LOTE } from '../src/nfse/sync';
import { ServicoNfsePainel, situacaoCaptacao } from '../src/painel/nfse';
import { aplicar, cfopDaNfse, movimentosDaNfse } from '../src/contabil/motor';
import { exigenciaDaRota } from '../src/painel/acesso';
/* eslint-disable @typescript-eslint/no-var-requires */
const tela = require('../public/nfse.js');
const nucleo = require('../public/nucleo.js');
/* eslint-enable @typescript-eslint/no-var-requires */

const PREST = '11222333000181';
const TOMA = '44555666000199';
const chave = (n: number) => `3201209${PREST}000000000${String(n).padStart(13, '0')}${'1'.repeat(50 - 7 - 14 - 9 - 13)}`.slice(0, 50);
const CH1 = chave(1); const CH2 = chave(2);

const nfseXml = (ch: string, numero: number, o: { toma?: string; munToma?: string; vServ?: string; ret?: string } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<NFSe versao="1.00" xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS${ch}">
<xLocEmi>Cachoeiro de Itapemirim</xLocEmi><nNFSe>${numero}</nNFSe><cLocIncid>3201209</cLocIncid><cStat>100</cStat><dhProc>2026-09-15T10:00:01-03:00</dhProc>
<emit><CNPJ>${PREST}</CNPJ><IM>123</IM><xNome>ALFA SERVICOS LTDA</xNome><enderNac><cMun>3201209</cMun><UF>ES</UF></enderNac></emit>
<valores><vBC>1000.00</vBC><pAliqAplic>2.00</pAliqAplic><vISSQN>20.00</vISSQN><vTotalRet>0.00</vTotalRet><vLiq>1000.00</vLiq></valores>
<DPS versao="1.00"><infDPS Id="DPS320120921122233300018100001000000000000${numero}">
<tpAmb>1</tpAmb><dhEmi>2026-09-15T10:00:00-03:00</dhEmi><serie>1</serie><nDPS>${numero}</nDPS><dCompet>2026-09-15</dCompet><tpEmit>1</tpEmit><cLocEmi>3201209</cLocEmi>
<prest><CNPJ>${PREST}</CNPJ></prest>
<toma><CNPJ>${o.toma ?? TOMA}</CNPJ><xNome>BETA COMERCIO SA</xNome><end><endNac><cMun>${o.munToma ?? '3205309'}</cMun><CEP>29000000</CEP></endNac></end></toma>
<serv><locPrest><cLocPrestacao>3201209</cLocPrestacao></locPrest><cServ><cTribNac>171901</cTribNac><xDescServ>Consultoria contábil</xDescServ><cNBS>113040000</cNBS></cServ></serv>
<valores><vServPrest><vServ>${o.vServ ?? '1000.00'}</vServ></vServPrest><trib><tribMun><tribISSQN>1</tribISSQN><tpRetISSQN>${o.ret ?? '1'}</tpRetISSQN></tribMun></trib></valores>
</infDPS></DPS></infNFSe></NFSe>`;

const eventoXml = (ch: string) => `<evento versao="1.00" xmlns="http://www.sped.fazenda.gov.br/nfse"><infEvento Id="EVT${ch}101101001">
<nSeqEvento>1</nSeqEvento><dhProc>2026-09-20T09:00:00-03:00</dhProc><pedRegEvento versao="1.00"><infPedReg Id="PRE${ch}101101001">
<tpAmb>1</tpAmb><dhEvento>2026-09-20T08:59:00-03:00</dhEvento><CNPJAutor>${PREST}</CNPJAutor><chNFSe>${ch}</chNFSe><nPedRegEvento>001</nPedRegEvento>
<e101101><xDesc>Cancelamento de NFS-e</xDesc><cMotivo>1</cMotivo><xMotivo>Erro na emissão</xMotivo></e101101></infPedReg></pedRegEvento></infEvento></evento>`;

const gz = (s: string) => zlib.gzipSync(Buffer.from(s)).toString('base64');

async function rejeita(p: Promise<unknown>, trecho: RegExp, status?: number) {
  try { await p; } catch (e) {
    assert.match((e as Error).message, trecho);
    if (status !== undefined) assert.equal((e as any).status ?? (e as any).http, status);
    return;
  }
  assert.fail('deveria ter recusado');
}

async function main() {
  /* ---------- ADN ---------- */
  assert.equal(chave(1).length, 50);
  assert.equal(abrirArquivo(gz('<a/>')), '<a/>');
  assert.equal(abrirArquivo(Buffer.from('<b/>').toString('base64')), '<b/>');
  assert.equal(abrirArquivo('<c/>'), '<c/>');
  const r1 = lerRetorno(200, JSON.stringify({ StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: [{ NSU: 7, ChaveAcesso: CH1, TipoDocumento: 'NFSE', ArquivoXml: gz('<x/>') }], Alertas: [], Erros: [] }));
  assert.equal(r1.docs.length, 1); assert.equal(r1.docs[0].nsu, 7); assert.equal(r1.docs[0].xml, '<x/>'); assert.equal(r1.docs[0].tipo, 'NFSE');
  // camelCase também
  const r2 = lerRetorno(200, JSON.stringify({ statusProcessamento: 'documentos_localizados', loteDFe: [{ nsu: '8', tipoDocumento: 'evento', arquivoXml: gz('<y/>') }] }));
  assert.equal(r2.status, 'DOCUMENTOS_LOCALIZADOS'); assert.equal(r2.docs[0].nsu, 8); assert.equal(r2.docs[0].tipo, 'EVENTO');
  const r3 = lerRetorno(400, JSON.stringify({ Erros: [{ Codigo: 'E2220', Descricao: 'Certificado não autorizado' }] }));
  assert.equal(r3.status, 'REJEICAO'); assert.deepEqual(r3.erros, ['E2220 - Certificado não autorizado']);
  assert.throws(() => lerRetorno(200, '<html>'), ErroAdn);

  let ultimaUrl = '';
  const fixo = (status: number, corpo: string): Transporte => async (url) => { ultimaUrl = url; return { status, corpo }; };
  await consultarAdn({} as any, { tpAmb: 1, nsu: 41 }, fixo(200, '{}'));
  assert.equal(ultimaUrl, 'https://adn.nfse.gov.br/contribuintes/DFe/41?lote=true');
  await consultarAdn({} as any, { tpAmb: 2, nsu: 0 }, fixo(200, '{}'));
  assert.equal(ultimaUrl, 'https://adn.producaorestrita.nfse.gov.br/contribuintes/DFe/0?lote=true');
  assert.equal((await consultarAdn({} as any, { tpAmb: 1, nsu: 1 }, fixo(404, ''))).status, 'NENHUM_DOCUMENTO_LOCALIZADO');
  assert.equal((await consultarAdn({} as any, { tpAmb: 1, nsu: 1 }, fixo(404, JSON.stringify({ StatusProcessamento: 'NENHUM_DOCUMENTO_LOCALIZADO' })))).docs.length, 0);
  await rejeita(consultarAdn({} as any, { tpAmb: 1, nsu: 1 }, fixo(429, '')), /esperar/, 429);
  await rejeita(consultarAdn({} as any, { tpAmb: 1, nsu: 1 }, fixo(503, '')), /indisponível/, 503);
  await rejeita(consultarAdn({} as any, { tpAmb: 1, nsu: 1 }, fixo(403, '')), /Certificado recusado/, 403);
  await rejeita(consultarAdn({} as any, { tpAmb: 1, nsu: 1 }, fixo(400, JSON.stringify({ Erros: [{ Codigo: 'E1', Descricao: 'NSU inválido' }] }))), /NSU inválido/, 400);

  /* ---------- leitor ---------- */
  const l = lerXmlNfse(nfseXml(CH1, 15));
  assert.equal(l.tipo, 'nfse');
  if (l.tipo !== 'nfse') return;
  const n = l.nfse;
  assert.equal(n.chave, CH1); assert.equal(n.numero, '15'); assert.equal(n.serieDps, '1');
  assert.equal(n.competencia, '2026-09-15'); assert.equal(n.emitidaEm, '2026-09-15T10:00:00-03:00');
  assert.deepEqual(n.prestador, { doc: PREST, nome: 'ALFA SERVICOS LTDA', mun: '3201209' });
  assert.deepEqual(n.tomador, { doc: TOMA, nome: 'BETA COMERCIO SA', mun: '3205309' });
  assert.equal(n.codTribNac, '171901'); assert.equal(n.descricao, 'Consultoria contábil');
  assert.equal(n.valorServico, 1000); assert.equal(n.valorIss, 20); assert.equal(n.aliquota, 2); assert.equal(n.issRetido, false); assert.equal(n.valorLiquido, 1000);
  assert.equal((lerXmlNfse(nfseXml(CH1, 15, { ret: '2' })) as any).nfse.issRetido, true);
  assert.equal(papelNaNota(n, PREST), 'prestador');
  assert.equal(papelNaNota(n, TOMA), 'tomador');
  assert.equal(papelNaNota(n, '11222333000262'), 'prestador', 'filial da mesma raiz');
  const ev = lerXmlNfse(eventoXml(CH1));
  assert.equal(ev.tipo, 'evento');
  if (ev.tipo === 'evento') assert.deepEqual(ev.evento, { chave: CH1, tpEvento: '101101', nSeq: 1, descricao: 'Cancelamento de NFS-e', ocorridoEm: '2026-09-20T08:59:00-03:00' });
  assert.equal(lerXmlNfse('<outro><x/></outro>').tipo, 'outro');
  assert.throws(() => lerXmlNfse('<NFSe><infNFSe Id="NFS123"/></NFSe>'), /Chave da NFS-e inválida/);

  /* ---------- captação por NSU ---------- */
  assert.equal(esperaAposErro(1), 15 * 60_000); assert.equal(esperaAposErro(3), 60 * 60_000); assert.equal(esperaAposErro(20), 360 * 60_000);
  const agora = Date.now();
  assert.equal(nfseLiberadaEm({ proxima_consulta_em: new Date(agora + 3600_000).toISOString(), ultima_consulta_em: new Date(agora - 20 * 60_000).toISOString(), erros_consecutivos: 0 }, true) <= agora, true, 'manual: 10 min bastam');
  assert.equal(nfseLiberadaEm({ proxima_consulta_em: new Date(agora + 3600_000).toISOString(), ultima_consulta_em: new Date(agora - 20 * 60_000).toISOString(), erros_consecutivos: 2 }, true) > agora, true, 'com erro espera');
  {
    const b = bancoFalso(['empresas', 'nfse_captacao', 'nfse_documentos', 'nfse_eventos', 'nfse_logs']);
    const EMP = { id: 'e1', cnpj: PREST };
    b.t.nfse_captacao.push({ empresa_id: 'e1', ativo: true, ult_nsu: 0, proxima_consulta_em: new Date(agora - 1000).toISOString(), erros_consecutivos: 0, documentos_total: 0 });
    const salvos = new Map<string, string>();
    const arm = { salvar: async (c: string, d: string | Buffer) => { salvos.set(c, String(d)); return c; } } as any;
    // 1ª chamada: lote cheio (50); 2ª: nota 2 + cancelamento da nota 1 (NSU já visto é ignorado); 3ª não acontece
    const lote1 = Array.from({ length: TAMANHO_LOTE }, (_, i) => ({ NSU: i + 1, TipoDocumento: i === 0 ? 'NFSE' : 'DPS', ArquivoXml: i === 0 ? gz(nfseXml(CH1, 15)) : gz('<DPS/>') }));
    const lote2 = [{ NSU: 50, TipoDocumento: 'DPS', ArquivoXml: gz('<DPS/>') }, { NSU: 52, TipoDocumento: 'EVENTO', ArquivoXml: gz(eventoXml(CH1)) }, { NSU: 51, TipoDocumento: 'NFSE', ArquivoXml: gz(nfseXml(CH2, 16)) }];
    const urls: string[] = [];
    const respostas = [lote1, lote2];
    const transporte: Transporte = async (url) => { urls.push(url); const lote = respostas.shift(); return lote ? { status: 200, corpo: JSON.stringify({ StatusProcessamento: 'DOCUMENTOS_LOCALIZADOS', LoteDFe: lote }) } : { status: 404, corpo: '' }; };
    const ctx = { db: b.db, arm, tpAmb: 1 as const, maxChamadas: 10, intervaloMs: 0, transporte, pausaMs: 0 };
    const r = await sincronizarNfse(ctx, EMP, {} as any);
    assert.deepEqual([r.status, r.chamadas, r.documentos], ['ok', 2, 3]);
    assert.deepEqual(urls.map((u) => u.replace(/.*DFe\//, '')), ['0?lote=true', '50?lote=true']);
    const cap = b.t.nfse_captacao[0];
    assert.equal(cap.ult_nsu, 52); assert.equal(cap.erros_consecutivos, 0); assert.equal(cap.ultimo_status, 'documentos'); assert.equal(cap.documentos_total, 3);
    assert.ok(Date.parse(cap.proxima_consulta_em) >= Date.now() + 60 * 60_000, 'em dia: volta em pelo menos 1 hora');
    assert.equal(b.t.nfse_documentos.length, 2);
    const d1 = b.t.nfse_documentos.find((x) => x.chave === CH1)!;
    assert.equal(d1.situacao, 'cancelada', 'evento de cancelamento aplicado');
    assert.equal(d1.papel, 'prestador'); assert.equal(d1.valor_servico, 1000);
    assert.ok(d1.xml_path.startsWith(`${PREST}/2026/09/nfse/`));
    assert.equal(b.t.nfse_documentos.find((x) => x.chave === CH2)!.situacao, 'autorizada');
    assert.equal(b.t.nfse_eventos.length, 1);
    assert.equal(b.t.nfse_logs.length, 2);
    // Consulta recente (automática): não chama de novo
    const r2b = await sincronizarNfse({ ...ctx, transporte: async () => { throw new Error('não devia chamar'); } }, EMP, {} as any);
    assert.equal(r2b.status, 'aguardando');
    // 429: espera 65 min, sem contar erro
    cap.proxima_consulta_em = new Date(Date.now() - 1).toISOString();
    const r3b = await sincronizarNfse({ ...ctx, transporte: fixo(429, '') }, EMP, {} as any);
    assert.equal(r3b.status, 'aguardando'); assert.equal(cap.ultimo_status, 'aguardando_adn'); assert.equal(cap.erros_consecutivos, 0);
    // Erro: espera crescente
    cap.proxima_consulta_em = new Date(Date.now() - 1).toISOString();
    const r4 = await sincronizarNfse({ ...ctx, transporte: fixo(503, '') }, EMP, {} as any);
    assert.equal(r4.status, 'erro'); assert.equal(cap.erros_consecutivos, 1); assert.equal(cap.ult_nsu, 52, 'erro não mexe no NSU');
    // Desligada
    cap.ativo = false;
    assert.equal((await sincronizarNfse(ctx, EMP, {} as any)).status, 'desligada');
  }

  /* ---------- painel ---------- */
  {
    const b = bancoFalso(['empresas', 'certificados', 'nfse_captacao', 'nfse_documentos']);
    b.t.empresas.push({ id: 'a', cnpj: PREST, razao_social: 'Alfa', ativo: true, escritorio: false }, { id: 'b', cnpj: TOMA, razao_social: 'Beta', ativo: true, escritorio: false });
    b.t.certificados.push({ empresa_id: 'a', valido_ate: '2099-01-01T00:00:00Z', ativo: true });
    const s = new ServicoNfsePainel(b.db, async () => Buffer.from('<xml/>'));
    await s.definirCaptacao('ana@x', null, ['a', 'b'], true);
    let c = await s.captacao(null);
    assert.equal(c.totais.ligadas, 2);
    assert.equal(c.empresas.find((e) => e.empresa_id === 'a')!.situacao.texto, 'Aguardando a primeira consulta');
    assert.equal(c.empresas.find((e) => e.empresa_id === 'b')!.situacao.texto, 'Sem certificado');
    await s.definirCaptacao('ana@x', null, ['b'], false);
    c = await s.captacao(null);
    assert.equal(c.totais.ligadas, 1);
    await rejeita(s.definirCaptacao('ana@x', new Set(['a']), ['b'], true), /não está no seu acesso/);
    await rejeita(s.definirCaptacao('ana@x', null, [], true), /ao menos uma/);
    assert.equal((await s.captacao(new Set(['a']))).empresas.length, 1, 'escopo');
    assert.deepEqual(situacaoCaptacao({ ativo: true, ultimo_status: 'em_dia', erros_consecutivos: 0, ultima_sync_ok_em: 'x' }, true), { texto: 'Em dia', tom: 'ok' });
    assert.equal(situacaoCaptacao({ ativo: true, ultimo_status: 'erro', erros_consecutivos: 1, ultima_sync_ok_em: 'x' }, true).tom, 'problema');
    assert.equal(situacaoCaptacao(null, true).texto, 'Desligada');

    b.t.nfse_documentos.push(
      { id: 1, empresa_id: 'a', chave: CH1, papel: 'prestador', numero: '15', emitida_em: '2026-09-15T13:00:00Z', situacao: 'autorizada', valor_servico: 1000, valor_iss: 20, prestador_nome: 'Alfa', tomador_nome: 'Beta', tomador_doc: TOMA, xml_path: 'p/1.xml' },
      { id: 2, empresa_id: 'a', chave: CH2, papel: 'tomador', numero: '7', emitida_em: '2026-09-20T13:00:00Z', situacao: 'cancelada', valor_servico: 50, valor_iss: 1, prestador_nome: 'Gama', xml_path: 'p/2.xml' },
      { id: 3, empresa_id: 'b', chave: chave(3), papel: 'tomador', numero: '15', emitida_em: '2026-09-21T13:00:00Z', situacao: 'autorizada', valor_servico: 1000, valor_iss: 20, prestador_nome: 'Alfa', xml_path: 'p/3.xml' },
    );
    let lst = await s.listar(null, { mes: '2026-09' });
    assert.equal(lst.total, 3);
    assert.deepEqual(lst.totais.prestador, { quantidade: 1, valor: 1000, iss: 20 });
    assert.deepEqual(lst.totais.tomador, { quantidade: 1, valor: 1000, iss: 20 }, 'cancelada fora do total');
    lst = await s.listar(new Set(['a']), { mes: '2026-09' });
    assert.equal(lst.total, 2, 'escopo filtra');
    assert.equal((await s.listar(null, { mes: '2026-09', papel: 'tomador' })).total, 2);
    assert.equal((await s.listar(null, { mes: '2026-10' })).total, 0);
    await rejeita(s.listar(null, {}), /Informe o mês/);
    await rejeita(s.listar(null, { mes: '2026-13' }), /Competência inválida/);
    await rejeita(s.listar(new Set(['a']), { mes: '2026-09', empresa: 'b' }), /não está no seu acesso/);
    assert.equal((await s.xml(null, 1)).nome, `NFSe_${CH1}.xml`);
    await rejeita(s.xml(new Set(['b']), 1), /não está no seu acesso/);
    const z = await s.paraZip(null, { mes: '2026-09' });
    assert.equal(z.length, 3);
    assert.ok(z.some((x) => x.nome === `${PREST}/NFSe/recebidas/canceladas/${CH2}.xml`), 'várias empresas: pasta por CNPJ; cancelada separada');
    assert.equal((await s.paraZip(null, { mes: '2026-09', empresa: 'b' }))[0].nome, `NFSe/recebidas/${chave(3)}.xml`);
    const p = await s.planilha(null, { mes: '2026-09' });
    assert.equal(p.abas[0].linhas.length, 3);
  }

  /* ---------- Contábil ---------- */
  {
    assert.equal(cfopDaNfse({ papel: 'prestador', prestador_mun: '3201209', tomador_mun: '3205309' }), '5933');
    assert.equal(cfopDaNfse({ papel: 'prestador', prestador_mun: '3201209', tomador_mun: '3550308' }), '6933');
    assert.equal(cfopDaNfse({ papel: 'tomador', prestador_mun: '3550308', tomador_mun: '3201209' }), '2933');
    assert.equal(cfopDaNfse({ papel: 'tomador', prestador_mun: null, tomador_mun: '3201209' }), '1933');
    assert.equal(cfopDaNfse({ papel: 'intermediario', prestador_mun: null, tomador_mun: null }), null);
    const base = { chave: CH1, empresa_cnpj: PREST, papel: 'prestador' as const, numero: '15', emitida_em: '2026-09-15T13:00:00Z', situacao: 'autorizada', valor_servico: 1000,
      prestador_doc: PREST, prestador_nome: 'Alfa', prestador_mun: '3201209', tomador_doc: TOMA, tomador_nome: 'Beta', tomador_mun: '3201209' };
    const [m] = movimentosDaNfse(base);
    assert.equal(m.cfop, '5933'); assert.equal(m.modelo, 'nfse'); assert.equal(m.direcao, 'saida'); assert.equal(m.participante_nome, 'Beta'); assert.equal(m.valor, 1000); assert.equal(m.competencia, '2026-09-01');
    assert.equal(movimentosDaNfse({ ...base }).at(0)!.chave_unica, m.chave_unica, 'idempotente');
    assert.deepEqual(movimentosDaNfse({ ...base, situacao: 'cancelada' }), []);
    assert.deepEqual(movimentosDaNfse({ ...base, papel: 'intermediario' }), []);
    const emp = { id: 'c1', codigo_dominio: '1', cnpj: PREST, razao_social: 'Alfa', regime: 'simples' as const, plano_id: null, ativo: true };
    const regra = { id: 1, ctb_empresa_id: null, regime: null, cfop: '5933', tipo_movimento: 'SAIDA', conta_debito: '5', conta_credito: '301', historico: 'Serviço {modelo} {numero} – {participante}', historico_codigo: null, regra_inversao: false, ativo: true };
    const a = aplicar({ ...m, ctb_empresa_id: 'c1' }, emp, { fiscais: [regra], folha: [] });
    assert.ok(a.ok);
    if (a.ok) assert.equal(a.lancamento.historico, 'Serviço NFS-e 15 – Beta');
    const semRegra = aplicar({ ...movimentosDaNfse({ ...base, papel: 'tomador' })[0], ctb_empresa_id: 'c1' }, emp, { fiscais: [regra], folha: [] });
    assert.ok(!semRegra.ok && semRegra.codigo === 'CFOP_SEM_REGRA' && semRegra.detalhe === '1933');
  }

  /* ---------- permissões, tela e rota ---------- */
  assert.equal(exigenciaDaRota('GET', '/api/nfse/notas'), 'captacao.ver');
  assert.equal(exigenciaDaRota('GET', '/api/nfse/zip'), 'captacao.ver');
  assert.equal(exigenciaDaRota('POST', '/api/nfse/captacao'), 'administracao.empresas');
  assert.equal(exigenciaDaRota('GET', '/api/nfse/captacao'), 'captacao.ver');
  assert.equal(tela.nfConsulta({ mes: '2026-09', empresa: '', papel: 'tomador', busca: 'a b' }), 'mes=2026-09&papel=tomador&busca=a%20b');
  assert.equal(tela.nfDoc(PREST), '11.222.333/0001-81');
  assert.equal(tela.nfDoc('12345678909'), '123.456.789-09');
  assert.equal(tela.nfDoc(null), '—');
  assert.deepEqual(nucleo.resolverRota('#/nfse', () => true), { redirecionar: '#/nfse/notas' });
  assert.deepEqual(nucleo.resolverRota('#/nfse/captacao', () => true), { tela: 'nfse', base: '#/nfse/notas', aba: 'captacao' });
  assert.deepEqual(nucleo.resolverRota('#/nfse/notas', (p: string) => p === 'fiscal.ver'), { redirecionar: '#/visao-geral', semPermissao: 'NFS-e' });

  console.log('nfse: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
