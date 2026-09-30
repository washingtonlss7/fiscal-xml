/**
 * Tela de Guias: situação da procuração, declaração, DAS, números e filtros (funções puras de public/guias.js).
 *
 *   npx tsx test/guias-tela.test.ts
 */
import assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const g = require('../public/guias.js');
const sp = (t: string) => t.replace(/\u00a0/g, ' ');

// 1) Situações
{
  assert.deepEqual(g.guProcuracao(null), { tom: 'neutro', simbolo: '–', texto: 'Não verificada' });
  assert.equal(g.guProcuracao({ situacao: 'ativa', expira_em: '2027-03-15' }).texto, 'Ativa até 15/03/2027');
  assert.equal(g.guProcuracao({ situacao: 'ausente' }).texto, 'Sem procuração');
  assert.equal(g.guProcuracao({ situacao: 'vencida', expira_em: '2026-01-10' }).texto, 'Vencida em 10/01/2026');
  assert.equal(g.guProcuracao({ situacao: 'erro' }).tom, 'atencao');
  assert.equal(g.guDeclaracao(null, 'simples').texto, 'Não consultada');
  assert.equal(g.guDeclaracao({ situacao: 'transmitida' }, 'simples').tom, 'ok');
  assert.equal(g.guDeclaracao({ situacao: 'nao_transmitida' }, 'simples').texto, 'Não transmitida');
  assert.equal(g.guDeclaracao(null, 'mei').texto, 'Não se aplica (MEI)');
  assert.equal(g.guDas(null, 'presumido', '2026-09-30').texto, 'DCTFWeb · em breve');
  assert.equal(g.guDas(null, 'simples', '2026-09-30').texto, 'Não gerado');
  assert.equal(sp(g.guDas({ total: 1520.33, vencimento: '2026-10-20' }, 'simples', '2026-09-30').texto), 'R$ 1.520,33 · vence 20/10/2026');
  const vencido = g.guDas({ total: 75.9, vencimento: '2026-09-20' }, 'mei', '2026-09-30');
  assert.deepEqual([vencido.tom, sp(vencido.texto)], ['atencao', 'R$ 75,90 · venceu 20/09/2026']);
  console.log('ok  procuração, declaração do PGDAS-D e DAS (a vencer, vencido, regime sem DAS)');
}

// 2) Números e filtros
{
  const e = (id: string, regime: string | null, x: any = {}) => ({ id, cnpj: `1122233300${id.padStart(4, '0')}`, razao_social: `Empresa ${id}`, regime, procuracao: null, declaracao: null, guia: null, ...x });
  const lista = [
    e('1', 'simples', { procuracao: { situacao: 'ativa' }, guia: { total: 100.1 } }),
    e('2', 'simples', { procuracao: { situacao: 'ausente' } }),
    e('3', 'mei', { procuracao: { situacao: 'ativa' }, guia: { total: 75.9 } }),
    e('4', 'presumido'),
    e('5', null),
  ];
  assert.deepEqual(g.guResumo(lista), { total: 3, procuracaoAtiva: 2, semProcuracao: 1, naoVerificada: 0, comDas: 2, totalDas: 176, outrosRegimes: 2 });
  const ids = (f: any) => g.guFiltrar(lista, f).map((x: any) => x.id);
  assert.deepEqual(ids({}), ['1', '2', '3'], 'padrão: Simples e MEI');
  assert.deepEqual(ids({ grupo: 'sem_procuracao' }), ['2']);
  assert.deepEqual(ids({ grupo: 'sem_das' }), ['2']);
  assert.deepEqual(ids({ grupo: 'outros' }), ['4', '5']);
  assert.deepEqual(ids({ grupo: 'mei' }), ['3']);
  assert.deepEqual(ids({ grupo: 'todas', termo: 'empresa 4' }), ['4']);
  assert.deepEqual(ids({ grupo: 'todas', termo: '11.222.333/0000-03' }), ['3'], 'busca pelo CNPJ formatado');
  console.log('ok  números da tela (só Simples e MEI) e filtros por grupo, nome e CNPJ');
}

// 3) Envio à Acessórias
{
  assert.equal(g.guEnvio(null, false), null, 'sem integração: não mostra nada');
  assert.equal(g.guEnvio(null, true).texto, 'Não enviada à Acessórias');
  assert.equal(g.guEnvio({ status: 'enviado' }, true).tom, 'ok');
  assert.equal(g.guEnvio({ status: 'erro', mensagem: 'Entrega inexistente' }, true).texto, 'Erro no envio à Acessórias');
  const l = [{ id: 'a', guia: { id: 1, envio: { status: 'enviado' } } }, { id: 'b', guia: { id: 2, envio: { status: 'erro' } } }, { id: 'c', guia: { id: 3, envio: null } }, { id: 'd', guia: null }];
  assert.deepEqual(g.guPendentesEnvio(l).map((e: any) => e.id), ['b', 'c']);
  console.log('ok  envio à Acessórias: situação da guia e pendentes para o lote');
}

console.log('\nTestes da tela de Guias passaram.');
