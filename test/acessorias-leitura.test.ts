/**
 * Acessórias, parte 2: documentos do mês pelo e-Contínuo (upload, PGDAS-D, envio automático, lote) e leitura
 * do cadastro (empresas + obrigações) e das entregas da competência.
 *
 *   npx tsx test/acessorias-leitura.test.ts
 */
import assert from 'assert';
import { competenciaAcessorias, dataAcessorias, lerEmpresasAcessorias, lerEntregas, ServicoAcessorias, situacaoEntrega, TransporteAcessorias, URL_ACESSORIAS } from '../src/integra/acessorias';
import { nomeDocumento, ServicoDocumentosEntrega } from '../src/painel/documentosEntrega';
import { bancoFalso } from './banco-falso';

// 1) Leitura pura
{
  assert.equal(dataAcessorias('2026-10-20'), '2026-10-20');
  assert.equal(dataAcessorias('20/10/2026 10:00'), '2026-10-20');
  assert.equal(dataAcessorias('0000-00-00'), null);
  assert.equal(dataAcessorias(''), null);
  assert.equal(competenciaAcessorias('09/2026'), '2026-09');
  assert.equal(competenciaAcessorias('2026-09-01'), '2026-09');
  assert.equal(competenciaAcessorias('00/0000'), null);
  assert.equal(situacaoEntrega('Pendente', '2026-10-20', null, '2026-10-01'), 'pendente');
  assert.equal(situacaoEntrega('Pendente', '2026-09-20', null, '2026-10-01'), 'atrasada', 'prazo vencido');
  assert.equal(situacaoEntrega('Pendente', '2026-09-20', '2026-09-19', '2026-10-01'), 'entregue');
  assert.equal(situacaoEntrega('Entregue com atraso', '2026-09-20', null, '2026-10-01'), 'entregue');
  assert.equal(situacaoEntrega('Dispensada', '2026-09-20', null, '2026-10-01'), 'dispensada');

  const emp = lerEmpresasAcessorias(JSON.stringify([
    { ID: '13', Identificador: '55.885.998/0001-40', Razao: 'FARMA DIGITAL LTDA', Fantasia: 'Farma', Status: 'Ativa',
      Obrigacoes: [{ Nome: 'DAS', Status: 'Ativa', Entregues: '8', Atrasadas: '1', Proximos30D: '1', 'Futuras30+': '3' }, { Nome: 'Analisar fluxo', Status: 'Inativa nessa empresa', Entregues: '0', Atrasadas: '0', Proximos30D: '0', 'Futuras30+': '0' }] },
    { ID: '14', Identificador: '123', Razao: 'SEM CNPJ' },
    { ID: '15', Identificador: '11222333000181', Razao: 'MERCADO', Status: 'Inativa' },
  ]));
  assert.deepEqual(emp.map((e) => [e.cnpj, e.id, e.ativa]), [['55885998000140', '13', true], ['11222333000181', '15', false]]);
  assert.deepEqual(emp[0].obrigacoes, [{ nome: 'DAS', entregues: 8, atrasadas: 1, proximos30: 1, futuras: 3 }], 'obrigação inativa fica de fora');
  assert.deepEqual(lerEmpresasAcessorias(JSON.stringify({ Erro: 'Nenhuma empresa' })), []);
  assert.deepEqual(lerEmpresasAcessorias('<html>'), []);

  const ents = lerEntregas(JSON.stringify([{ ID: '13', Identificador: '55885998000140', Entregas: [
    { Nome: 'DAS', EntCompetencia: '09/2026', EntDtPrazo: '2026-10-20', EntDtEntrega: '0000-00-00', EntMulta: 'N', Status: 'Pendente', EntGuiaLida: 'S', RespEntrega: 'Ana', Config: { DptoNome: 'Fiscal' } },
    { Nome: 'SPED Fiscal', EntCompetencia: '09/2026', EntDtPrazo: '2026-09-25', EntDtEntrega: '', Status: 'Pendente', Config: { DptoNome: 'Fiscal' } },
    { Nome: 'DCTFWeb', EntCompetencia: '09/2026', EntDtPrazo: '2026-10-15', EntDtEntrega: '2026-10-01', Status: 'Entregue' },
    { Nome: 'DAS', EntCompetencia: '08/2026', EntDtPrazo: '2026-09-20', Status: 'Entregue' },
  ] }]), '2026-09', '2026-10-01');
  assert.deepEqual(ents.map((e) => [e.nome, e.situacao]), [['SPED Fiscal', 'atrasada'], ['DAS', 'pendente'], ['DCTFWeb', 'entregue']], 'só a competência pedida, atrasadas primeiro');
  assert.deepEqual([ents[1].guia_lida, ents[1].multa, ents[1].departamento, ents[1].responsavel], [true, false, 'Fiscal', 'Ana']);
  assert.equal(nomeDocumento('recibo_sped_fiscal', '2026-09', 'Recibo de Entrega (1).pdf'), 'Recibo-SPED-Fiscal-2026-09-Recibo-de-Entrega-1.pdf');
  assert.equal(nomeDocumento('darf', '2026-09', 'x.pdf', 'IRPJ trimestral'), 'DARF-2026-09-IRPJ-trimestral.pdf');
  console.log('ok  leitura: datas, competência, situação da entrega, empresas com obrigações e entregas da competência');
}

(async () => {
  const MK = Buffer.alloc(32, 9).toString('base64');
  const { db, t } = bancoFalso(['integracoes', 'guias', 'guias_envios', 'empresas', 'documentos_entrega', 'documentos_entrega_envios', 'acessorias_empresas', 'acessorias_entregas']);
  const guardados = new Map<string, Buffer>();
  const arm = { salvar: async (c: string, b: Buffer) => { guardados.set(`r2:${c}`, b); return `r2:${c}`; }, ler: async (c: string) => guardados.get(c)! } as any;
  const enviados: { nome: string; pdf: string }[] = [];
  const gets: string[] = [];
  let respostaPdf = () => ({ status: 200, corpo: JSON.stringify({ msg: 'Entrega processada com sucesso! [SPED Fiscal]', pathFolder: 'p/x.pdf' }) });
  const paginas: Record<number, unknown[]> = {
    1: Array.from({ length: 20 }, (_, i) => ({ ID: String(i + 1), Identificador: String(10000000000100 + i).padStart(14, '0'), Razao: `EMPRESA ${i + 1}`, Status: 'Ativa' })),
    2: [{ ID: '99', Identificador: '55885998000140', Razao: 'FARMA DIGITAL LTDA', Status: 'Ativa', Obrigacoes: [{ Nome: 'SPED Fiscal', Status: 'Ativa', Entregues: '5', Atrasadas: '2', Proximos30D: '1', 'Futuras30+': '0' }] }],
  };
  let entregasCorpo = JSON.stringify([{ Identificador: '55885998000140', Entregas: [{ Nome: 'SPED Fiscal', EntCompetencia: '09/2026', EntDtPrazo: '2026-09-25', Status: 'Pendente' }, { Nome: 'DCTFWeb', EntCompetencia: '09/2026', EntDtPrazo: '2026-10-15', EntDtEntrega: '2026-10-01', Status: 'Entregue' }] }]);
  const tr: TransporteAcessorias = {
    async enviarPdf(_url, _token, nome, pdf) { enviados.push({ nome, pdf: pdf.toString() }); return respostaPdf(); },
    async get(url) {
      gets.push(url.replace(URL_ACESSORIAS, ''));
      const pg = url.match(/Pagina=(\d+)/);
      if (url.includes('/companies/ListAll')) { const l = paginas[Number(pg![1])]; return l ? { status: 200, corpo: JSON.stringify(l) } : { status: 404, corpo: JSON.stringify({ Erro: 'Nenhuma empresa encontrada' }) }; }
      if (url.includes('/deliveries/')) return { status: 200, corpo: entregasCorpo };
      return { status: 404, corpo: '' };
    },
  };
  const ac = new ServicoAcessorias(db, arm, MK, tr, 0);
  ac.hoje = () => '2026-10-01';
  const docs = new ServicoDocumentosEntrega(db, arm, ac);
  const FARMA = { id: '11111111-1111-1111-1111-111111111111', cnpj: '55885998000140', razao_social: 'FARMA DIGITAL LTDA' };
  const MERC = { id: '22222222-2222-2222-2222-222222222222', cnpj: '11222333000181', razao_social: 'MERCADO REAL LTDA' };
  t.empresas.push(FARMA, MERC, { id: '33333333-3333-3333-3333-333333333333', cnpj: '44555666000177', razao_social: 'PAUSADA LTDA', ativo: false });
  const pdf = (x: string) => Buffer.from(`%PDF-1.4 ${x}`);

  // 2) Documentos do mês: validação, gravação cifrada, repetido, sem envio quando a integração não existe
  await assert.rejects(docs.registrar(FARMA.id, '2026-09', { tipo: 'darf', nomeOriginal: 'x.txt', pdf: Buffer.from('texto') }, 'a@x.com'), /em PDF/);
  await assert.rejects(docs.registrar(FARMA.id, '2026-09', { tipo: 'pgdas_recibo', nomeOriginal: 'x.pdf', pdf: pdf('a') }, 'a@x.com'), /transmissão do PGDAS-D/);
  await assert.rejects(docs.registrar(FARMA.id, '2026-9', { tipo: 'darf', nomeOriginal: 'x.pdf', pdf: pdf('a') }, 'a@x.com'), /Competência/);
  await assert.rejects(docs.registrar(FARMA.id, '2026-09', { tipo: 'xyz', nomeOriginal: 'x.pdf', pdf: pdf('a') }, 'a@x.com'), /tipo/);
  const r1 = await docs.registrar(FARMA.id, '2026-09', { tipo: 'recibo_sped_fiscal', nomeOriginal: 'recibo.pdf', pdf: pdf('recibo') }, 'a@x.com');
  assert.deepEqual([r1.repetido, r1.envio, r1.documento.nome, r1.documento.origem], [false, null, 'Recibo-SPED-Fiscal-2026-09-recibo.pdf', 'upload'], 'sem integração: guarda e não envia');
  const r1b = await docs.registrar(FARMA.id, '2026-09', { tipo: 'darf', nomeOriginal: 'outro-nome.pdf', pdf: pdf('recibo') }, 'a@x.com');
  assert.deepEqual([r1b.repetido, r1b.documento.id], [true, r1.documento.id], 'mesmo arquivo não entra duas vezes');
  assert.match([...guardados.keys()][0], /^r2:documentos\/55885998000140\/2026-09\//);
  console.log('ok  documentos: só PDF, tipo e competência válidos, nome padronizado, arquivo repetido não duplica');

  // 3) Envio: automático, manual sem duplicar, erro gravado, lote
  await ac.salvar({ token: 'TOKEN-VALIDO-ACESSORIAS-123', envioAutomatico: true }, 'adm@x.com');
  const r2 = await docs.registrar(FARMA.id, '2026-09', { tipo: 'dctfweb', nomeOriginal: 'dctf.pdf', pdf: pdf('dctf') }, 'a@x.com');
  assert.equal(r2.envio.status, 'enviado', 'envio automático');
  assert.deepEqual(enviados[0], { nome: 'DCTFWeb-2026-09-dctf.pdf', pdf: '%PDF-1.4 dctf' });
  await assert.rejects(ac.enviarDocumento(r2.documento.id, 'a@x.com'), (e: any) => e.status === 409);
  respostaPdf = () => ({ status: 200, corpo: JSON.stringify({ Erro: 'Entrega [SPED Fiscal para 55.885.998/0001-40] inexistente [Comp. 09/2026].' }) });
  const e1 = await ac.enviarDocumento(r1.documento.id, 'a@x.com');
  assert.deepEqual([e1.status, e1.mensagem], ['erro', 'Entrega [SPED Fiscal para 55.885.998/0001-40] inexistente [Comp. 09/2026].']);
  const pend = await ac.documentosPendentes('2026-09');
  assert.deepEqual([pend.documentos.map((d) => d.id), pend.jaEnviados], [[r1.documento.id], 1]);
  respostaPdf = () => ({ status: 200, corpo: JSON.stringify({ msg: 'ok', pathFolder: 'p.pdf' }) });
  const lote = await ac.enviarDocumentos(pend.documentos.map((d) => d.id), 'a@x.com');
  assert.deepEqual(lote.map((x) => x.ok), [true]);
  assert.equal((await ac.documentosPendentes('2026-09')).documentos.length, 0);
  const lista = await docs.listar(FARMA.id, '2026-09');
  assert.deepEqual(lista.map((d: any) => [d.rotulo, d.envio.status]), [['Recibo do SPED Fiscal', 'enviado'], ['DCTFWeb', 'enviado']]);
  console.log('ok  envio: automático ao entrar, sem duplicar, erro da Acessórias gravado, lote do que falta');

  // 4) PGDAS-D: recibo e declaração entram como documentos (PDF já guardado), sem gravar de novo; não podem ser removidos
  guardados.set('r2:pgdas/rec.pdf', pdf('rec')); guardados.set('r2:pgdas/dec.pdf', pdf('dec'));
  const antesArm = guardados.size;
  const pg = await docs.registrarPgdas(FARMA.id, '2026-09', 7, [
    { tipo: 'pgdas_recibo', caminho: 'r2:pgdas/rec.pdf', pdf: pdf('rec') }, { tipo: 'pgdas_declaracao', caminho: 'r2:pgdas/dec.pdf', pdf: pdf('dec') }, { tipo: 'maed', caminho: null, pdf: null },
  ], 'sup@x.com');
  assert.equal(pg.length, 2); assert.equal(guardados.size, antesArm, 'não grava o PDF de novo');
  assert.deepEqual(pg.map((x: any) => [x.documento.tipo, x.documento.origem, x.documento.apuracao_id, x.envio.status]), [['pgdas_recibo', 'pgdas', 7, 'enviado'], ['pgdas_declaracao', 'pgdas', 7, 'enviado']]);
  await assert.rejects(docs.remover(pg[0].documento.id, 'a@x.com'), /não pode ser removido/);
  await docs.remover(r1.documento.id, 'a@x.com');
  assert.equal((await docs.listar(FARMA.id, '2026-09')).length, 3);
  console.log('ok  PGDAS-D: recibo e declaração viram documentos do mês e vão à Acessórias; comprovante não sai');

  // 5) Cadastro: paginação de 20 em 20, obrigações, cruzamento com o Appura
  const resumo = await ac.sincronizarEmpresas('a@x.com');
  assert.deepEqual(gets.filter((g) => g.startsWith('/companies')), ['/companies/ListAll?Pagina=1&obligations=1', '/companies/ListAll?Pagina=2&obligations=1'], 'para na página com menos de 20');
  assert.deepEqual([resumo.naAcessorias, resumo.vinculadas, resumo.totalSemCadastro], [21, 1, 1]);
  assert.deepEqual(resumo.semCadastro.map((e) => e.razao_social), ['MERCADO REAL LTDA'], 'empresa pausada não conta');
  assert.deepEqual(resumo.comAtraso, [{ id: FARMA.id, cnpj: FARMA.cnpj, razao_social: FARMA.razao_social, atrasadas: [{ nome: 'SPED Fiscal', quantidade: 2 }] }]);
  delete paginas[2]; paginas[1] = paginas[1].slice(0, 5);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal((await ac.sincronizarEmpresas('a@x.com')).naAcessorias, 5, 'quem saiu da Acessórias sai da cópia');
  paginas[2] = [{ ID: '99', Identificador: '55885998000140', Razao: 'FARMA DIGITAL LTDA', Status: 'Ativa' }]; paginas[1] = Array.from({ length: 20 }, (_, i) => ({ ID: String(i + 1), Identificador: String(10000000000100 + i).padStart(14, '0'), Status: 'Ativa' }));
  await new Promise((r) => setTimeout(r, 5));
  await ac.sincronizarEmpresas('a@x.com');
  console.log('ok  cadastro: páginas de 20, obrigações atrasadas, empresas do Appura sem cadastro na Acessórias');

  // 6) Entregas: por empresa (janela de 4 meses, só a competência) e em lote, em segundo plano
  const ent = await ac.atualizarEntregas(FARMA.id, '2026-09', 'a@x.com');
  assert.equal(gets[gets.length - 1], '/deliveries/55885998000140?DtInitial=2026-09-01&DtFinal=2026-12-31&config=1');
  assert.deepEqual(ent.entregas.map((e) => [e.nome, e.situacao]), [['SPED Fiscal', 'atrasada'], ['DCTFWeb', 'entregue']]);
  const [m] = await ac.entregasDoMes('2026-09', [FARMA.id]);
  assert.deepEqual(m.contagem, { entregue: 1, atrasada: 1, pendente: 0, dispensada: 0 });
  entregasCorpo = JSON.stringify({ Erro: 'Token sem permissão para o departamento' });
  const comErro = await ac.atualizarEntregas(FARMA.id, '2026-09', 'a@x.com');
  assert.deepEqual([comErro.erro, comErro.entregas.length], ['Token sem permissão para o departamento', 0]);
  entregasCorpo = JSON.stringify({ Erro: 'Nenhuma entrega encontrada' });
  assert.equal((await ac.atualizarEntregas(FARMA.id, '2026-09', 'a@x.com')).erro, null, '"nenhuma entrega" não é erro');
  const ini = await ac.iniciarEntregasDoMes('2026-09', 'a@x.com');
  assert.equal(ini.total, 1, 'só empresas ativas do Appura cadastradas na Acessórias');
  await assert.rejects(ac.iniciarEntregasDoMes('2026-09', 'a@x.com'), /em andamento/);
  for (let i = 0; i < 50 && !ac.progressoEntregas()!.terminado_em; i++) await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual([ac.progressoEntregas()!.feitas, ac.progressoEntregas()!.erros], [1, 0]);
  console.log('ok  entregas: consulta por empresa, erro da Acessórias guardado, lote em segundo plano sem duplicar');
  console.log('\nTestes da Acessórias (documentos e leitura) passaram.');
})().catch((e) => { console.error(e); process.exit(1); });
