/**
 * Tela SPED e pré-cadastro: o que vem marcado para aprovar e o resumo de cada envio.
 *
 *   npx tsx test/sped-tela.test.ts
 */
import assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const t = require('../public/sped.js');

{
  const dif = [{ campo: 'ie', atual: null }, { campo: 'cep', atual: '29300000' }, { campo: 'email', atual: null }];
  assert.deepEqual(t.spPadraoMarcados(dif, false), ['ie', 'email'], 'o que muda um valor existente fica desmarcado');
  assert.deepEqual(t.spPadraoMarcados(dif, true), ['ie', 'cep', 'email'], 'cliente novo: tudo marcado');
  console.log('ok  campos marcados por padrão');
}
{
  const r = (x: any) => t.spResumoEnvio({ valido: true, ocorrencias: [], comparacao: { divergencias: [] }, ...x });
  assert.equal(r({}).texto, 'arquivo sem erros · XML e SPED conferem');
  assert.equal(r({}).tom, 'ok');
  assert.equal(r({ ocorrencias: [{ nivel: 'erro' }, { nivel: 'alerta' }], comparacao: { divergencias: [{ nivel: 'alerta' }, { nivel: 'info' }] } }).texto, '1 erro no arquivo · 1 divergência com os XMLs');
  assert.equal(r({ comparacao: null, clienteNovo: true }).texto, 'arquivo sem erros · cliente novo: aguardando aprovação do cadastro');
  assert.equal(r({ sugestao: { id: 1 } }).tom, 'info');
  assert.equal(t.spResumoEnvio({ valido: false }).tom, 'problema');
  assert.equal(r({ tipo: 'efd_contribuicoes', ocorrencias: [{ nivel: 'erro' }], comparacao: null }).texto, 'SPED Contribuições · 1 erro no arquivo · sem SPED Fiscal do mês para cruzar');
  assert.equal(r({ tipo: 'efd_contribuicoes', comparacao: { divergencias: [] } }).texto, 'SPED Contribuições · arquivo sem erros · vendas conferem com o SPED Fiscal');
  console.log('ok  resumo do envio (erros, divergências, cliente novo, cadastro a conferir)');
}
console.log('\nTestes da tela SPED passaram.');
