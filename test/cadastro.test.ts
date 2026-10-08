/**
 * Edição do cadastro da empresa: validação, só o que mudou, confirmação do regime, histórico e permissão.
 *
 *   npx tsx test/cadastro.test.ts
 */
import assert from 'assert';
import { diferencas, editarCadastro, normalizar } from '../src/painel/cadastroEmpresa';
import { exigenciaDaRota } from '../src/painel/acesso';
import { bancoFalso } from './banco-falso';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { cdAlterados, cdParaTela, cdTextoAlteracao } = require('../public/cadastro.js');

// 1) Validação
assert.equal(normalizar('cep', '29.300-000'), '29300000');
assert.throws(() => normalizar('cep', '2930'), /8 dígitos/);
assert.equal(normalizar('ie', '084.358.580'), '084358580');
assert.equal(normalizar('ie', 'isento'), 'ISENTO');
assert.throws(() => normalizar('ie', 'abc'), /só números/);
assert.equal(normalizar('fone', '(28) 99999-0000'), '28999990000');
assert.throws(() => normalizar('fone', '9999-0000'), /DDD/);
assert.equal(normalizar('email', ' Fiscal@Empresa.com.BR '), 'fiscal@empresa.com.br');
assert.throws(() => normalizar('email', 'x@'), /inválido/);
assert.equal(normalizar('nome_fantasia', '  '), null, 'vazio apaga');
assert.throws(() => normalizar('regime', ''), /regime/);
assert.throws(() => normalizar('regime', 'lucro'), /inválido/);
assert.throws(() => normalizar('razao_social', 'X'), /desconhecido/);
assert.throws(() => normalizar('cod_municipio', '320'), /7 dígitos/);
assert.deepEqual(diferencas({ ie: '084358580', cep: null }, { ie: '084.358.580', cep: '29300-000' }).map((a) => [a.campo, a.antes, a.depois]), [['cep', null, '29300000']], 'só o que mudou de verdade');
console.log('ok  validação: CEP, IE (ou ISENTO), telefone, e-mail, IBGE, vazio apaga, campos fixos recusados');

(async () => {
  const { db, t } = bancoFalso(['empresas', 'empresa_alteracoes']);
  const ID = '11111111-1111-1111-1111-111111111111';
  t.empresas.push({ id: ID, cnpj: '55885998000140', razao_social: 'FARMA', uf: 'ES', regime: 'simples', codigo_erp: null, ie: null, captar_nfe: true, captar_cte: true });
  await assert.rejects(editarCadastro(db, ID, { campos: { razao_social: 'OUTRA' } }, 'a@x.com'), /não pode ser alterado/);
  await assert.rejects(editarCadastro(db, ID, { campos: { cnpj: '1' } }, 'a@x.com'), /não pode ser alterado/);
  await assert.rejects(editarCadastro(db, ID, { campos: { regime: 'real' } }, 'a@x.com'), (e: any) => e.status === 409 && e.codigo === 'CONFIRMAR_REGIME' && /Simples Nacional para Lucro Real/.test(e.message));
  assert.equal(t.empresas[0].regime, 'simples', 'sem confirmação nada muda');
  await assert.rejects(editarCadastro(db, ID, { campos: { captar_nfe: false, captar_cte: false } }, 'a@x.com'), /ao menos NF-e ou CT-e/);
  const r = await editarCadastro(db, ID, { campos: { regime: 'real', ie: '084358580', codigo_erp: '1042' }, confirmarRegime: true }, 'sup@x.com');
  assert.deepEqual(r.alteracoes.map((a) => a.campo), ['regime', 'codigo_erp', 'ie']);
  assert.deepEqual([t.empresas[0].regime, t.empresas[0].ie, t.empresas[0].cadastro_atualizado_por], ['real', '084358580', 'sup@x.com']);
  assert.deepEqual(t.empresa_alteracoes[0].campos[0], { campo: 'regime', rotulo: 'Regime tributário', antes: 'simples', depois: 'real' });
  assert.equal(t.empresa_alteracoes[0].por, 'sup@x.com');
  const nada = await editarCadastro(db, ID, { campos: { ie: '084.358.580' } }, 'sup@x.com');
  assert.equal(nada.alteracoes.length, 0); assert.equal(t.empresa_alteracoes.length, 1, 'sem mudança, sem registro');
  assert.equal(exigenciaDaRota('PATCH', `/api/empresas/${ID}/cadastro`), 'administracao.empresas', 'só quem cadastra empresas edita');
  assert.equal(exigenciaDaRota('GET', `/api/empresas/${ID}/cadastro`), 'algum.ver');
  console.log('ok  edição: campos fixos recusados, regime só com confirmação, registro de antes/depois, nada mudou = nada gravado');

  // 2) Tela
  assert.equal(cdParaTela('cep', '29300000'), '29300-000');
  assert.equal(cdParaTela('fone', '28999990000'), '(28) 99999-0000');
  assert.equal(cdParaTela('contador_fone', '2835224869'), '(28) 3522-4869');
  assert.deepEqual(cdAlterados({ regime: 'real', cep: '29300000', ie: null, captar_nfe: true }, { regime: 'real', cep: '29300-000', ie: '', captar_nfe: true }), []);
  assert.deepEqual(cdAlterados({ regime: 'real', email: 'a@x.com', captar_cte: true }, { regime: 'simples', email: 'A@X.COM', captar_cte: false }), ['regime', 'captar_cte']);
  assert.equal(cdTextoAlteracao({ campo: 'regime', rotulo: 'Regime tributário', antes: 'simples', depois: 'real' }, { simples: 'Simples Nacional', real: 'Lucro Real' }), 'Regime tributário: Simples Nacional → Lucro Real');
  assert.equal(cdTextoAlteracao({ campo: 'cep', rotulo: 'CEP', antes: null, depois: '29300000' }, {}), 'CEP: vazio → 29300-000');
  console.log('ok  tela: máscaras, detecção do que mudou e texto do histórico');
  console.log('\nTestes do cadastro da empresa passaram.');
})().catch((e) => { console.error(e); process.exit(1); });
