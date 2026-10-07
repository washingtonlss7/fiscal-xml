/**
 * API de integração (ex.: OnnePharma): token e segredo, assinatura do webhook, endereço do webhook, cursor das notas,
 * XML e ZIP, enfileiramento e entrega do webhook com retentativa, e o registro de mudanças na gravação das notas.
 *
 *   npx tsx test/integracao.test.ts
 */
import assert from 'assert';
import { PassThrough } from 'stream';
import { assinar, codificarCursor, conferirAssinatura, decodificarCursor, ErroIntegracao, ipInterno, ServicoIntegracao, validarUrlWebhook } from '../src/integracao/servico';
import { processarDoc } from '../src/sync';
import { lerZip } from '../src/importacao/zipLeitor';
import { Consulta, Linha } from './banco-falso';

const MK = Buffer.alloc(32, 7).toString('base64');
const FARMA = { id: 'e1', cnpj: '55885998000140', razao_social: 'FARMA DIGITAL STORE LTDA', c_uf: 32, ativo: true };
const OUTRA = { id: 'e2', cnpj: '11222333000181', razao_social: 'OUTRA LTDA', c_uf: 32, ativo: true };
const ch = (cnpj: string, mod: string, n: number) => `322610${cnpj}${mod}001${String(n).padStart(9, '0')}1${String(n).padStart(8, '0')}`.slice(0, 43) + '0';
const rejeita = async (p: Promise<unknown>, status: number, re?: RegExp) => {
  try { await p; } catch (e) { assert.ok(e instanceof ErroIntegracao, String(e)); assert.equal((e as ErroIntegracao).status, status); if (re) assert.match((e as Error).message, re); return; }
  assert.fail(`esperava ${status}`);
};

function banco() {
  const t: Record<string, Linha[]> = { empresas: [FARMA, OUTRA].map((e) => ({ ...e })), documentos: [], integracoes_api: [], integracao_api_empresas: [], integracao_mudancas: [], integracao_webhook_fila: [], integracao_api_chamadas: [], eventos: [], outros: [] };
  let n = 0; const seq = () => ++n;
  const from = (nome: string) => { const q: any = new Consulta(t[nome] ?? t.outros, seq); q.not = (c: string, op: string, v: any) => { (q as any).filtros.push((l: Linha) => !(op === 'is' && (l[c] ?? null) === v)); return q; }; return q; };
  const rpc = async (f: string, p: any) => {
    if (f !== 'integracao_webhook_reservar') return { data: null, error: null };
    const agora = new Date().toISOString();
    const r = t.integracao_webhook_fila.filter((x) => x.status === 'pendente' && x.proxima_em <= agora).slice(0, p.p_limite);
    for (const x of r) x.proxima_em = new Date(Date.now() + p.p_segundos * 1000).toISOString();
    return { data: r.map((x) => ({ ...x })), error: null };
  };
  return { db: { from, rpc } as any, t };
}

(async () => {
  /* 1) peças puras */
  const corpo = '{"a":1}';
  const cab = assinar('whsec_x', corpo, 1700000000);
  assert.ok(conferirAssinatura('whsec_x', corpo, cab, 300, 1700000100));
  assert.ok(!conferirAssinatura('whsec_y', corpo, cab, 300, 1700000100), 'segredo errado');
  assert.ok(!conferirAssinatura('whsec_x', corpo + ' ', cab, 300, 1700000100), 'corpo alterado');
  assert.ok(!conferirAssinatura('whsec_x', corpo, cab, 300, 1700001000), 'assinatura velha (replay)');
  assert.equal(decodificarCursor(codificarCursor(23155)), 23155);
  assert.equal(decodificarCursor(null), 0);
  assert.throws(() => decodificarCursor('lixo!'));
  assert.ok(ipInterno('10.0.0.5') && ipInterno('127.0.0.1') && ipInterno('192.168.1.1') && ipInterno('169.254.169.254') && ipInterno('::1') && !ipInterno('8.8.8.8'));
  const pub = async () => ['200.150.10.1'];
  assert.equal(await validarUrlWebhook('https://onnepharma.com.br/api/appura/webhook', pub), 'https://onnepharma.com.br/api/appura/webhook');
  await rejeita(validarUrlWebhook('http://onnepharma.com.br/x', pub), 400, /https/);
  await rejeita(validarUrlWebhook('https://interno.local/x', async () => ['10.1.2.3']), 400, /interno/);
  await rejeita(validarUrlWebhook('https://169.254.169.254/latest', pub), 400, /interno/);
  console.log('ok  assinatura HMAC (segredo, corpo, replay), cursor e endereço do webhook (só https, nunca rede interna)');

  /* 2) painel + API */
  const { db, t } = banco();
  const xmls = new Map<string, Buffer>();
  const arm = { salvar: async (c: string, x: string) => { xmls.set(`r2:${c}`, Buffer.from(x)); return `r2:${c}`; }, ler: async (c: string) => { const b = xmls.get(c); if (!b) throw new Error('não achei'); return b; } } as any;
  const enviados: { url: string; corpo: string; cab: Record<string, string> }[] = [];
  let respostaHttp = 200;
  const s = new ServicoIntegracao(db, arm, MK, async (url, corpo, cab) => { enviados.push({ url, corpo, cab }); return { status: respostaHttp, corpo: respostaHttp === 200 ? 'ok' : 'falhou' }; });

  // Notas que já existiam (carga inicial)
  const doc = (e: typeof FARMA, mod: string, n: number, dir: string, extra: any = {}) => {
    const chave = ch(e.cnpj, mod, n); const path = `r2:${e.cnpj}/${chave}.xml`; xmls.set(path, Buffer.from(`<nfeProc>${chave}</nfeProc>`));
    t.documentos.push({ id: `d${t.documentos.length + 1}`, empresa_id: e.id, chave, modelo: mod, direcao: dir, numero: String(n), serie: '1', emitida_em: '2026-10-01T10:00:00Z', valor: 10, situacao: 'autorizada', completo: true, xml_path: path, emit_cnpj: e.cnpj, capturado_em: '2026-10-01T10:00:00Z', ...extra });
    t.integracao_mudancas.push({ id: t.integracao_mudancas.length + 1, empresa_id: e.id, chave, tipo: 'carga_inicial' });
    return chave;
  };
  const a1 = doc(FARMA, '65', 1, 'saida'); const a2 = doc(FARMA, '55', 2, 'entrada'); doc(FARMA, '57', 3, 'entrada'); doc(OUTRA, '65', 4, 'saida');
  const res = doc(FARMA, '55', 5, 'entrada', { completo: false, xml_path: null, xml_resumo_path: 'r2:resumo5' }); xmls.set('r2:resumo5', Buffer.from('<resNFe/>'));

  await rejeita(s.criar({ nome: 'O', empresas: [FARMA.id] }, 'a@x'), 400);
  await rejeita(s.criar({ nome: 'OnnePharma', empresas: [FARMA.id], webhookUrl: 'http://x.com' }, 'a@x'), 400);
  const cr = await s.criar({ nome: 'OnnePharma', empresas: [FARMA.id] }, 'a@x');
  assert.match(cr.token, /^apk_[A-Za-z0-9_-]{43}$/);
  assert.equal(cr.webhookSegredo, null);
  assert.ok(!JSON.stringify(t.integracoes_api).includes(cr.token), 'token não é guardado');
  await rejeita(s.autenticar('Bearer apk_' + 'x'.repeat(43)), 401);
  const ctx = await s.autenticar(`Bearer ${cr.token}`);
  assert.deepEqual(s.empresas(ctx).empresas, [{ cnpj: FARMA.cnpj, razaoSocial: FARMA.razao_social }]);

  // Primeira leitura: tudo da FARMA (NF-e e NFC-e, entrada e saída), sem CT-e e sem a outra empresa
  const p1 = await s.documentos(ctx, { cursor: null, cnpj: null, modelo: null, direcao: null, limite: 100 });
  assert.deepEqual(p1.documentos.map((d) => [d.chave, d.modelo, d.direcao, d.completo]), [[a1, 'nfce', 'saida', true], [a2, 'nfe', 'entrada', true], [res, 'nfe', 'entrada', false]]);
  assert.equal(p1.temMais, false);
  // Paginação
  const pg = await s.documentos(ctx, { cursor: null, cnpj: null, modelo: null, direcao: null, limite: 2 });
  assert.equal(pg.documentos.length, 2); assert.equal(pg.temMais, true);
  const pg2 = await s.documentos(ctx, { cursor: pg.proximoCursor, cnpj: null, modelo: null, direcao: null, limite: 2 });
  assert.deepEqual(pg2.documentos.map((d) => d.chave), [res]);
  // Filtros
  assert.deepEqual((await s.documentos(ctx, { cursor: null, cnpj: FARMA.cnpj, modelo: 'nfce', direcao: null, limite: 100 })).documentos.map((d) => d.chave), [a1]);
  assert.deepEqual((await s.documentos(ctx, { cursor: null, cnpj: null, modelo: null, direcao: 'entrada', limite: 100 })).documentos.length, 2);
  await rejeita(s.documentos(ctx, { cursor: null, cnpj: OUTRA.cnpj, modelo: null, direcao: null, limite: 100 }), 403);
  // Nada novo depois do cursor; depois um cancelamento: a nota volta, uma vez só, como cancelada
  assert.equal((await s.documentos(ctx, { cursor: p1.proximoCursor, cnpj: null, modelo: null, direcao: null, limite: 100 })).documentos.length, 0);
  t.documentos[0].situacao = 'cancelada';
  t.integracao_mudancas.push({ id: 100, empresa_id: FARMA.id, chave: a1, tipo: 'gravado' }, { id: 101, empresa_id: FARMA.id, chave: a1, tipo: 'cancelado' });
  const p2 = await s.documentos(ctx, { cursor: p1.proximoCursor, cnpj: null, modelo: null, direcao: null, limite: 100 });
  assert.deepEqual(p2.documentos.map((d) => [d.chave, d.situacao, d.mudanca]), [[a1, 'cancelada', 'cancelada']]);
  // XML e ZIP
  assert.equal((await s.xml(ctx, a2, null)).xml.toString(), `<nfeProc>${a2}</nfeProc>`);
  assert.equal((await s.xml(ctx, res, null)).completo, false);
  await rejeita(s.xml(ctx, ch(OUTRA.cnpj, '65', 4), null), 404);
  await rejeita(s.xml(ctx, ch(FARMA.cnpj, '57', 3), null), 404, /não encontrada/);
  const saida = new PassThrough(); const partes: Buffer[] = []; saida.on('data', (b) => partes.push(b));
  let abriu = false;
  const nz = await s.zip(ctx, [a1, a2, res, ch(OUTRA.cnpj, '65', 4)], null, saida, () => { abriu = true; });
  saida.end();
  assert.equal(nz, 3); assert.ok(abriu);
  assert.deepEqual(lerZip(Buffer.concat(partes)).map((x) => x.nome).sort(), [`${a1}.xml`, `${a2}.xml`, `${res}-resumo.xml`].sort());
  for (let i = 0; i < 120; i++) s.limitar(ctx);
  assert.throws(() => s.limitar(ctx), (e: any) => e.status === 429);
  console.log('ok  API: token, CNPJs liberados, cursor com paginação e filtros, sem CT-e, cancelamento posterior, XML completo/resumo, ZIP, limite de chamadas');

  /* 3) webhook */
  await rejeita(s.editar(cr.id, { webhookUrl: 'https://10.0.0.1/x' }, 'a@x'), 400);
  const ed = await s.editar(cr.id, { webhookUrl: 'https://8.8.8.8/appura' }, 'a@x');
  assert.match(String(ed.webhookSegredo), /^whsec_/);
  assert.equal(t.integracoes_api[0].webhook_cursor, 101, 'o webhook começa só com o que acontecer daqui para frente');
  assert.equal(await s.enfileirar(), 0);
  // Nota nova de saída da FARMA, uma da outra empresa e um CT-e: só a primeira vira aviso
  const nova = doc(FARMA, '65', 9, 'saida'); t.integracao_mudancas[t.integracao_mudancas.length - 1] = { id: 200, empresa_id: FARMA.id, chave: nova, tipo: 'gravado' };
  const outra = doc(OUTRA, '65', 10, 'saida'); t.integracao_mudancas[t.integracao_mudancas.length - 1] = { id: 201, empresa_id: OUTRA.id, chave: outra, tipo: 'gravado' };
  const cte = doc(FARMA, '57', 11, 'entrada'); t.integracao_mudancas[t.integracao_mudancas.length - 1] = { id: 202, empresa_id: FARMA.id, chave: cte, tipo: 'gravado' };
  assert.equal(await s.enfileirar(), 1);
  assert.equal(await s.enfileirar(), 0, 'não enfileira de novo');
  const r1 = await s.entregar();
  assert.deepEqual(r1, { entregues: 1, falhas: 0 });
  const env = enviados[0];
  const json = JSON.parse(env.corpo);
  assert.deepEqual([json.evento, json.documento.chave, json.documento.modelo, json.xml], ['documento.novo', nova, 'nfce', `<nfeProc>${nova}</nfeProc>`]);
  assert.ok(conferirAssinatura(String(ed.webhookSegredo), env.corpo, env.cab['X-Appura-Assinatura']), 'assinatura confere com o segredo mostrado');
  assert.equal(env.cab['X-Appura-Evento'], 'documento.novo');
  assert.equal(t.integracao_webhook_fila[0].status, 'entregue');
  // Falha: tenta de novo depois de 1 minuto; depois de 10 tentativas desiste; "reenviar" volta para a fila
  respostaHttp = 500;
  const n2 = doc(FARMA, '55', 12, 'entrada'); t.integracao_mudancas[t.integracao_mudancas.length - 1] = { id: 300, empresa_id: FARMA.id, chave: n2, tipo: 'gravado' };
  await s.enfileirar();
  assert.deepEqual(await s.entregar(), { entregues: 0, falhas: 1 });
  const f2 = t.integracao_webhook_fila[1];
  assert.equal(f2.tentativas, 1); assert.equal(f2.status, 'pendente'); assert.ok(Date.parse(f2.proxima_em) > Date.now() + 50_000);
  f2.tentativas = 10; f2.proxima_em = new Date(0).toISOString();
  await s.entregar();
  assert.equal(f2.status, 'falhou');
  respostaHttp = 200;
  assert.deepEqual(await s.reenviarFalhas(cr.id), { reenviadas: 1 });
  assert.deepEqual(await s.entregar(), { entregues: 1, falhas: 0 });
  const teste = await s.testarWebhook(cr.id);
  assert.equal(teste.ok, true);
  await s.revogar(cr.id, 'a@x');
  await rejeita(s.autenticar(`Bearer ${cr.token}`), 401, /revogado/);
  console.log('ok  webhook: só daqui para frente, filtra empresa e CT-e, XML no aviso, assinatura, retentativa, desiste após 10, reenviar, teste, revogação');

  /* 4) a gravação das notas registra a mudança (SEFAZ, importação e coletor passam por processarDoc) */
  {
    const { db: db2, t: t2 } = banco();
    const chave = ch(FARMA.cnpj, '65', 77);
    const xml = `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00"><ide><mod>65</mod><serie>1</serie><nNF>77</nNF><dhEmi>2026-10-01T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>${FARMA.cnpj}</CNPJ><xNome>F</xNome><enderEmit><UF>ES</UF></enderEmit><CRT>3</CRT></emit><total><ICMSTot><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe><infProt><chNFe>${chave}</chNFe><nProt>1</nProt><cStat>100</cStat></infProt></protNFe></nfeProc>`;
    await processarDoc({ db: db2, arm }, { id: FARMA.id, cnpj: FARMA.cnpj } as any, 'nfe', { nsu: '', schema: 'procNFe_v4.00.xsd', xml }, 'importacao');
    assert.deepEqual(t2.integracao_mudancas.map((m) => [m.empresa_id, m.chave, m.tipo]), [[FARMA.id, chave, 'gravado']]);
    console.log('ok  gravar uma nota registra a mudança para a API e o webhook');
  }
})().catch((e) => { console.error(e); process.exit(1); });
