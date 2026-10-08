/**
 * Telas de acesso (Perfis, Responsáveis e o bloco de acesso da gaveta de usuário): funções puras.
 *
 *   npx tsx test/acesso-tela.test.ts
 */
import assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const a = require('../public/acesso.js');

{
  const perfil = ['captacao.ver', 'captacao.operar', 'fiscal.ver', 'fiscal.operar'];
  assert.deepEqual(a.acDiferenca(perfil, perfil), { extras: [], removidas: [] });
  assert.deepEqual(a.acDiferenca(perfil, ['captacao.ver', 'fiscal.ver', 'fiscal.operar', 'fiscal.transmitir']), { extras: ['fiscal.transmitir'], removidas: ['captacao.operar'] });
  assert.deepEqual(a.acEfetivas(perfil, ['fiscal.transmitir'], ['captacao.operar']), ['captacao.ver', 'fiscal.operar', 'fiscal.transmitir', 'fiscal.ver']);
  // Ida e volta: marcar → exceções → efetivas = o que foi marcado
  const marcadas = ['captacao.ver', 'fiscal.ver', 'folha.ver'];
  const d = a.acDiferenca(perfil, marcadas);
  assert.deepEqual(a.acEfetivas(perfil, d.extras, d.removidas), [...marcadas].sort());
  console.log('ok  exceções: diferença contra o perfil e ida e volta');
}

{
  assert.deepEqual(a.acAlternar(['fiscal.ver'], 'fiscal.transmitir', true), ['fiscal.transmitir', 'fiscal.ver']);
  assert.deepEqual(a.acAlternar([], 'fiscal.operar', true), ['fiscal.operar', 'fiscal.ver'], 'marcar uma ação liga o ver');
  assert.deepEqual(a.acAlternar(['fiscal.ver', 'fiscal.operar', 'captacao.ver'], 'fiscal.ver', false), ['captacao.ver'], 'desmarcar o ver desliga o módulo');
  assert.deepEqual(a.acAlternar([], 'administracao.usuarios', true), ['administracao.usuarios'], 'administração não tem "ver"');
  console.log('ok  grade: ver acompanha as ações do módulo');
}

{
  assert.equal(a.acResumoEscopo({ escopo: 'todas' }), 'Todas as empresas');
  assert.equal(a.acResumoEscopo({ escopo: 'carteira', empresasNoEscopo: 12 }), 'Carteira: 12 empresas');
  assert.equal(a.acResumoEscopo({ escopo: 'lista', empresas: ['x'] }), 'Lista: 1 empresa');
  assert.equal(a.acResumoEscopo({ escopo: 'lista', fixo: true }), 'Todas as empresas');
  const modulos = [
    { id: 'captacao', nome: 'Captação e notas', acoes: [{ id: 'ver', nome: 'Ver' }, { id: 'operar', nome: 'Operar' }] },
    { id: 'fiscal', nome: 'Fiscal', acoes: [{ id: 'ver', nome: 'Ver' }, { id: 'transmitir', nome: 'Transmitir' }] },
    { id: 'folha', nome: 'Folha', acoes: [{ id: 'ver', nome: 'Ver' }] },
  ];
  assert.equal(a.acResumoPermissoes(['captacao.ver', 'captacao.operar', 'fiscal.ver'], modulos), 'Captação e notas: ver, operar · Fiscal: ver');
  assert.equal(a.acResumoPermissoes([], modulos), '');
  const emps = [{ razao_social: 'FARMA DIGITAL LTDA', cnpj: '55885998000140' }, { razao_social: 'Contabilize', cnpj: '11222333000144' }];
  assert.equal(a.acFiltrarEmpresas(emps, 'farma').length, 1);
  assert.equal(a.acFiltrarEmpresas(emps, '55.885').length, 1);
  assert.equal(a.acFiltrarEmpresas(emps, '').length, 2);
  console.log('ok  resumos de escopo e permissões, busca de empresa');
}

console.log('\nTestes das telas de acesso passaram.');
