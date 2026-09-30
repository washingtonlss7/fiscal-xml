/**
 * Integra Contador (SERPRO): leitura das respostas, cliente (token, renovação, registro) e guias
 * (procuração, declaração do PGDAS-D, DAS do Simples e do MEI) com transporte e banco simulados.
 *
 *   npx tsx test/integra.test.ts
 */
import assert from 'assert';
import forge from 'node-forge';
import { cifrar } from '../src/cripto';
import { configIntegra, IntegraContador, RegistroChamada, Transporte, URL_AUTENTICACAO } from '../src/integra/cliente';
import { dataIso, lerGuias, lerProcuracoes, lerResposta, lerUltimaDeclaracao, periodoApuracao, situacaoProcuracao, temErro, textoMensagens } from '../src/integra/respostas';
import { ServicoGuias } from '../src/painel/guias';
import { bancoFalso } from './banco-falso';

const ESC = '11222333000181';
const CLI = '55885998000140';
const MEI = '44555666000177';
const pdfB64 = Buffer.from('%PDF-1.4 guia de teste do Appura').toString('base64');

/** Resposta do gateway no formato da documentação (dados = string JSON). */
const gw = (status: number, dados: unknown, mensagens: { codigo: string; texto: string }[] = [{ codigo: '[Sucesso-X]', texto: 'Requisição efetuada com sucesso.' }]) =>
  ({ status, corpo: JSON.stringify({ status, mensagens, dados: dados === null ? '' : JSON.stringify(dados) }) });

const dasSimples = (pa: string) => [{
  pdf: pdfB64, cnpjCompleto: CLI,
  detalhamento: [{
    periodoApuracao: pa, numeroDocumento: '07202612345678901', dataVencimento: '20261020', dataLimiteAcolhimento: '20261020',
    valores: { principal: 1520.33, multa: 0, juros: 0, total: 1520.33 },
    composicao: [{ periodoApuracao: pa, codigo: '1001', denominacao: 'IRPJ - SIMPLES NACIONAL', valores: { principal: 84.1, multa: 0, juros: 0, total: 84.1 } }],
  }],
}];

// 1) Leitura das respostas
{
  const r = lerResposta(200, JSON.stringify({ status: 200, mensagens: [{ codigo: '[Sucesso-PGDASD]', texto: '[Sucesso-PGDASD] Requisição efetuada com sucesso.' }], dados: JSON.stringify(dasSimples('202609')) }));
  assert.equal(temErro(r), false);
  assert.equal(textoMensagens(r.mensagens), 'Requisição efetuada com sucesso.');
  const [g] = lerGuias(r.dados);
  assert.equal(g.numeroDocumento, '07202612345678901');
  assert.equal(g.vencimento, '2026-10-20');
  assert.equal(g.total, 1520.33);
  assert.equal(g.composicao[0].denominacao, 'IRPJ - SIMPLES NACIONAL');
  assert.equal(g.pdf!.toString(), '%PDF-1.4 guia de teste do Appura');
  // detalhamento em objeto (detalhamentoDas) e valores em texto
  const [g2] = lerGuias([{ pdf: pdfB64, detalhamentoDas: { periodoApuracao: '202609', numeroDocumento: '1', dataVencimento: '20/10/2026', valores: { principal: '75,90', multa: '0', juros: '0', total: '75,90' } } }]);
  assert.deepEqual([g2.vencimento, g2.total], ['2026-10-20', 75.9]);
  assert.equal(temErro(lerResposta(400, JSON.stringify({ status: 400, mensagens: [{ codigo: '[EntradaIncorreta-PGDASD-001]', texto: 'Período inválido' }], dados: '' }))), true);
  assert.equal(lerResposta(502, '<html>gateway</html>').status, 502);
  assert.equal(periodoApuracao('2026-09'), '202609');
  assert.equal(dataIso('20261020'), '2026-10-20');
  const procs = lerProcuracoes([{ dtexpiracao: '20270315', nrsistemas: 2, sistemas: ['PGDASD', 'PGMEI'] }, { dtexpiracao: '20250101', nrsistemas: 1, sistemas: ['DCTFWEB'] }]);
  assert.deepEqual(situacaoProcuracao(procs, '2026-09-30'), { situacao: 'ativa', expiraEm: '2027-03-15', sistemas: ['PGDASD', 'PGMEI'] });
  assert.equal(situacaoProcuracao(procs.slice(1), '2026-09-30').situacao, 'vencida');
  assert.equal(situacaoProcuracao([], '2026-09-30').situacao, 'ausente');
  assert.deepEqual(lerUltimaDeclaracao({ numeroDeclaracao: '00000000202609001', recibo: { nomeArquivo: 'r.pdf', pdf: pdfB64 }, declaracao: { pdf: pdfB64 } }), { numero: '00000000202609001', temRecibo: true, temDeclaracao: true, temMaed: false });
  assert.equal(lerUltimaDeclaracao(null), null);
  console.log('ok  respostas: DAS (PDF, valores, composição), procurações, declaração, datas e mensagens');
}

// 2) Configuração e cliente
{
  assert.equal(configIntegra({}), null, 'sem chaves: não configurado');
  assert.deepEqual(configIntegra({ SERPRO_AMBIENTE: 'trial' }), { ambiente: 'trial', consumerKey: '', consumerSecret: '' });
  assert.equal(configIntegra({ SERPRO_CONSUMER_KEY: 'k', SERPRO_CONSUMER_SECRET: 's' })!.ambiente, 'producao');
}

async function testeCliente() {
  const chamadas: { url: string; headers: Record<string, string>; corpo: string }[] = [];
  let expirar = false;
  const t: Transporte = {
    async post(url, headers, corpo) {
      chamadas.push({ url, headers, corpo });
      if (url === URL_AUTENTICACAO) return { status: 200, corpo: JSON.stringify({ access_token: `A${chamadas.length}`, jwt_token: `J${chamadas.length}`, expires_in: 2008, token_type: 'Bearer' }) };
      if (expirar) { expirar = false; return { status: 401, corpo: '' }; }
      return gw(200, dasSimples('202609'));
    },
  };
  const reg: RegistroChamada[] = [];
  let agora = 1_000_000;
  const c = new IntegraContador({ ambiente: 'producao', consumerKey: 'chave', consumerSecret: 'segredo' }, async () => ({ cnpj: ESC }), t, async (r) => { reg.push(r); }, () => agora);
  const p = { metodo: 'Emitir' as const, contribuinte: CLI, idSistema: 'PGDASD', idServico: 'GERARDAS12', dados: { periodoApuracao: '202609' }, por: 'a@x.com' };
  await c.chamar(p);
  await c.chamar(p);
  assert.equal(chamadas.filter((x) => x.url === URL_AUTENTICACAO).length, 1, 'token reaproveitado');
  const auth = chamadas[0];
  assert.equal(auth.headers.Authorization, `Basic ${Buffer.from('chave:segredo').toString('base64')}`);
  assert.equal(auth.headers['Role-Type'], 'TERCEIROS');
  assert.equal(auth.corpo, 'grant_type=client_credentials');
  const g = chamadas[1];
  assert.equal(g.url, 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Emitir');
  assert.equal(g.headers.Authorization, 'Bearer A1'); assert.equal(g.headers.jwt_token, 'J1');
  const corpo = JSON.parse(g.corpo);
  assert.deepEqual(corpo.contratante, { numero: ESC, tipo: 2 }); assert.deepEqual(corpo.autorPedidoDados, { numero: ESC, tipo: 2 });
  assert.deepEqual(corpo.contribuinte, { numero: CLI, tipo: 2 });
  assert.deepEqual(corpo.pedidoDados, { idSistema: 'PGDASD', idServico: 'GERARDAS12', versaoSistema: '1.0', dados: '{"periodoApuracao":"202609"}' });
  // Token expirado pelo relógio e 401 do gateway: autentica de novo
  agora += 2008 * 1000;
  await c.chamar(p);
  expirar = true;
  await c.chamar(p);
  assert.equal(chamadas.filter((x) => x.url === URL_AUTENTICACAO).length, 3);
  assert.equal(reg.length, 4, 'cada chamada registrada uma vez');
  assert.ok(reg.every((r) => r.sucesso && r.servico === 'GERARDAS12' && r.cnpj === CLI && r.por === 'a@x.com'));
  // Autenticação recusada
  const recusa = new IntegraContador({ ambiente: 'producao', consumerKey: 'x', consumerSecret: 'y' }, async () => ({ cnpj: ESC }), { post: async () => ({ status: 401, corpo: '{}' }) });
  await assert.rejects(recusa.chamar(p), /recusou a autenticação/);
  // Trial: sem autenticação, URL de teste
  const urls: string[] = [];
  const trial = new IntegraContador({ ambiente: 'trial', consumerKey: '', consumerSecret: '' }, async () => { throw new Error('não usa certificado'); }, { post: async (u) => { urls.push(u); return gw(200, null); } });
  await trial.chamar({ ...p, metodo: 'Consultar' });
  assert.deepEqual(urls, ['https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1/Consultar']);
  console.log('ok  cliente: autenticação (Basic + Role-Type + mTLS), token em cache, renovação, corpo do pedido, registro e trial');
}

function pfxEscritorio() {
  const chaves = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = chaves.publicKey; cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86_400_000); cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const nome = [{ name: 'commonName', value: `CONTABIL FARMA:${ESC}` }];
  cert.setSubject(nome); cert.setIssuer(nome); cert.sign(chaves.privateKey, forge.md.sha256.create());
  return Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(chaves.privateKey, [cert], 'senha', { algorithm: '3des' })).getBytes(), 'binary');
}

async function testeGuias() {
  const MK = Buffer.alloc(32, 7).toString('base64');
  const { db, t } = bancoFalso(['empresas', 'certificados', 'integra_chamadas', 'integra_procuracoes', 'pgdas_declaracoes', 'guias']);
  t.empresas.push(
    { id: 'e-esc', cnpj: ESC, razao_social: 'CONTABIL FARMA', regime: 'real', ativo: true, escritorio: true },
    { id: 'e-sn', cnpj: CLI, razao_social: 'FARMA TESTE', regime: 'simples', ativo: true, escritorio: false },
    { id: 'e-mei', cnpj: MEI, razao_social: 'JOAO MEI', regime: 'mei', ativo: true, escritorio: false },
    { id: 'e-lp', cnpj: '99888777000166', razao_social: 'PRESUMIDO SA', regime: 'presumido', ativo: true, escritorio: false },
  );
  const arquivos = new Map<string, Buffer>();
  const arm = { salvar: async (c: string, b: Buffer) => { arquivos.set(`r2:${c}`, b); return `r2:${c}`; }, ler: async (c: string) => arquivos.get(c)! } as any;
  const pedidos: any[] = [];
  let semProcuracao = false;
  const transporte: Transporte = {
    async post(url, _h, corpo, agente) {
      if (url === URL_AUTENTICACAO) { assert.ok(agente, 'autenticação com o certificado do escritório (mTLS)'); return { status: 200, corpo: JSON.stringify({ access_token: 'A', jwt_token: 'J', expires_in: 2008 }) }; }
      const j = JSON.parse(corpo); pedidos.push(j);
      const { idServico } = j.pedidoDados; const dados = JSON.parse(j.pedidoDados.dados);
      if (idServico === 'OBTERPROCURACAO41') {
        assert.deepEqual(dados, { outorgante: j.contribuinte.numero, tipoOutorgante: '2', outorgado: ESC, tipoOutorgado: '2' });
        return semProcuracao ? gw(200, [], [{ codigo: '[Aviso-PROCURACOES-001]', texto: 'Não foram encontradas procurações.' }]) : gw(200, [{ dtexpiracao: '20270315', nrsistemas: 1, sistemas: ['PGDASD'] }]);
      }
      if (idServico === 'CONSULTIMADECREC14') return gw(200, { numeroDeclaracao: '00000000202609001', recibo: { pdf: pdfB64 } });
      if (idServico === 'GERARDAS12') return gw(200, dasSimples(dados.periodoApuracao));
      if (idServico === 'GERARDASPDF21') return gw(200, [{ pdf: pdfB64, cnpjCompleto: MEI, detalhamento: [{ periodoApuracao: dados.periodoApuracao, numeroDocumento: '0799', dataVencimento: '20261020', dataLimiteAcolhimento: '20261020', valores: { principal: 75.9, multa: 0, juros: 0, total: 75.9 } }] }]);
      return gw(400, null, [{ codigo: '[Erro-X]', texto: 'serviço não simulado' }]);
    },
  };
  const criar = (cfg: 'producao' | 'trial') => new ServicoGuias(db, arm, MK, (contratante, registrar) => new IntegraContador({ ambiente: cfg, consumerKey: 'k', consumerSecret: 's' }, contratante, transporte, registrar));

  // Sem certificado do escritório: pendência e erro claro
  let s = criar('producao');
  assert.match((await s.situacao()).pendencias.join(' '), /certificado e-CNPJ da empresa do escritório/);
  await assert.rejects(s.verificarProcuracao('e-sn', 'a@x.com'), /sem certificado ativo/);
  t.certificados.push({ id: 'c1', empresa_id: 'e-esc', ativo: true, criado_em: '2026-01-01', valido_ate: new Date(Date.now() + 86400e3 * 300).toISOString(),
    pfx_cifrado: cifrar(pfxEscritorio(), MK), senha_cifrada: cifrar(Buffer.from('senha'), MK) });
  s = criar('producao');
  const sit = await s.situacao();
  assert.equal(sit.pronto, true); assert.deepEqual(sit.pendencias, []);

  // Procuração
  const p = await s.verificarProcuracao('e-sn', 'a@x.com') as any;
  assert.deepEqual([p.situacao, p.expira_em, p.sistemas], ['ativa', '2027-03-15', ['PGDASD']]);
  semProcuracao = true;
  assert.equal((await s.verificarProcuracao('e-mei', 'a@x.com') as any).situacao, 'ausente');
  await assert.rejects(s.gerarDas('e-mei', '2026-09', 'a@x.com'), /procuração do cliente para o escritório está ausente/);
  semProcuracao = false;
  await s.verificarProcuracao('e-mei', 'a@x.com');

  // Declaração e DAS do Simples
  const d = await s.consultarDeclaracao('e-sn', '2026-09', 'a@x.com') as any;
  assert.deepEqual([d.situacao, d.numero, d.competencia], ['transmitida', '00000000202609001', '2026-09-01']);
  await assert.rejects(s.consultarDeclaracao('e-mei', '2026-09', 'a@x.com'), /Simples Nacional/);
  const r = await s.gerarDas('e-sn', '2026-09', 'a@x.com');
  assert.equal(r.guias.length, 1);
  const g = r.guias[0] as any;
  assert.deepEqual([g.tipo, g.numero_documento, g.vencimento, Number(g.total), g.competencia], ['das_simples', '07202612345678901', '2026-10-20', 1520.33, '2026-09-01']);
  assert.equal((await s.pdf(g.id)).conteudo.toString(), '%PDF-1.4 guia de teste do Appura', 'PDF guardado e devolvido');
  assert.match((await s.pdf(g.id)).nome, /^DAS-2026-09-07202612345678901\.pdf$/);
  const pedidoDas = pedidos.find((x) => x.pedidoDados.idServico === 'GERARDAS12');
  assert.deepEqual([pedidoDas.contribuinte.numero, pedidoDas.pedidoDados.dados], [CLI, '{"periodoApuracao":"202609"}']);
  // Segunda vez: não gera de novo sem confirmar (cada chamada é cobrada)
  await assert.rejects(s.gerarDas('e-sn', '2026-09', 'a@x.com'), (e: any) => e.status === 409 && e.codigo === 'DAS_EXISTENTE');
  assert.equal((await s.gerarDas('e-sn', '2026-09', 'a@x.com', true)).guias.length, 1, 'gerar de novo com confirmação');
  // MEI, regime sem DAS e competência futura
  assert.equal((await s.gerarDas('e-mei', '2026-09', 'a@x.com')).guias[0].tipo, 'das_mei');
  assert.ok(pedidos.some((x) => x.pedidoDados.idSistema === 'PGMEI' && x.pedidoDados.idServico === 'GERARDASPDF21'));
  await assert.rejects(s.gerarDas('e-lp', '2026-09', 'a@x.com'), /Simples Nacional e do MEI/);
  await assert.rejects(s.gerarDas('e-sn', '2099-01', 'a@x.com'), /competência futura/);

  // Painel, empresa e lote
  const painel = await s.painel('2026-09');
  assert.deepEqual(painel.empresas.map((e: any) => e.id).sort(), ['e-lp', 'e-mei', 'e-sn'], 'escritório fica fora da lista');
  const sn = painel.empresas.find((e: any) => e.id === 'e-sn')!;
  assert.equal(sn.procuracao.situacao, 'ativa'); assert.equal(sn.declaracao.situacao, 'transmitida'); assert.equal(Number(sn.guia.total), 1520.33);
  const emp = await s.daEmpresa('e-sn', '2026-09');
  assert.equal(emp.guias.length, 2);
  const lote = await s.lote('das', ['e-sn', 'e-lp', 'e-mei'], '2026-09', 'a@x.com');
  assert.deepEqual(lote.resultados.map((x) => x.ok), [false, false, false], 'já gerados (não gera de novo) e regime sem DAS');
  assert.match(lote.resultados[1].mensagem, /Simples Nacional e do MEI/);
  const lp = await s.lote('procuracao', ['e-sn', 'e-lp'], '2026-09', 'a@x.com');
  assert.deepEqual(lp.resultados.map((x) => x.mensagem), ['Procuração ativa', 'Procuração ativa']);

  // Toda chamada registrada (cobrança), com a empresa
  const sit2 = await s.situacao();
  assert.equal(sit2.chamadasMes.total, t.integra_chamadas.length);
  assert.ok(t.integra_chamadas.every((c: any) => c.ambiente === 'producao' && c.por === 'a@x.com'));
  assert.ok(t.integra_chamadas.some((c: any) => c.servico === 'GERARDAS12' && c.empresa_id === 'e-sn'));

  // Não configurado e trial: nada gravado
  const semChave = new ServicoGuias(db, arm, MK, null);
  assert.equal((await semChave.situacao()).configurado, false);
  await assert.rejects(semChave.gerarDas('e-sn', '2026-09', 'a@x.com'), /não configurado/);
  const antes = t.guias.length;
  const trial = criar('trial');
  await assert.rejects(trial.gerarDas('e-sn', '2026-09', 'a@x.com', true), /ambiente de teste do SERPRO/);
  assert.equal(t.guias.length, antes);
  assert.equal((await trial.testarConexao('a@x.com')).ok, true);
  console.log('ok  guias: certificado do escritório, procuração, declaração, DAS do Simples e do MEI, PDF guardado, sem geração duplicada, lote, registro e trial');
}

(async () => {
  await testeCliente();
  await testeGuias();
  console.log('\nTestes do Integra Contador passaram.');
})().catch((e) => { console.error(e); process.exit(1); });
