/**
 * Núcleo do painel: rotas (nenhum endereço abre página em branco) e formatação pt-BR.
 *
 *   npx tsx test/nucleo.test.ts
 */
import assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const n = require('../public/nucleo.js');

const ID = '0f7c2a1e-1111-2222-3333-444455556666';
const todos = () => true;
const consulta = (p: string) => ['captacao.ver', 'fiscal.ver', 'algum.ver'].includes(p);

// 1) Rotas principais
{
  const r = (h: string, pode = todos) => n.resolverRota(h, pode);
  assert.deepEqual(r(''), { tela: 'visao', base: '#/visao-geral' });
  assert.deepEqual(r('#/visao-geral'), { tela: 'visao', base: '#/visao-geral' });
  assert.deepEqual(r('#/fechamento'), { tela: 'fechamento', base: '#/fechamento', consulta: '' });
  assert.deepEqual(r('#/fechamento?status=bloqueado&etapa=auditoria&atencao=1'), { tela: 'fechamento', base: '#/fechamento', consulta: 'status=bloqueado&etapa=auditoria&atencao=1' });
  assert.deepEqual(r('#/empresas'), { tela: 'empresas', base: '#/empresas' });
  assert.deepEqual(r(`#/empresas/${ID}`), { tela: 'empresa', base: '#/empresas', id: ID, aba: 'visao' });
  const abas: Record<string, string> = { notas: 'notas', auditoria: 'auditoria', 'icms-st': 'st', sped: 'sped', guias: 'guias', arquivos: 'arquivos', historico: 'historico' };
  for (const [url, aba] of Object.entries(abas)) {
    assert.equal(r(`#/empresas/${ID}/${url}`).aba, aba, url);
    assert.equal(n.enderecoEmpresa(ID, aba), `#/empresas/${ID}/${url}`, 'ida e volta do endereço da aba');
  }
  assert.equal(n.enderecoEmpresa(ID, 'visao'), `#/empresas/${ID}`);
  assert.deepEqual(r('#/sped?cadastro=12'), { tela: 'sped', base: '#/sped', consulta: 'cadastro=12' });
  assert.deepEqual(r('#/guias'), { tela: 'guias', base: '#/guias' });
  assert.deepEqual(r('#/ia'), { tela: 'ia', base: '#/ia' });
  assert.deepEqual(r('#/escritorio', (p: string) => p === 'administracao.empresas'), { tela: 'escritorio', base: '#/escritorio' });
  assert.equal(r('#/escritorio', () => false).semPermissao, 'Escritório');
  assert.deepEqual(r('#/empresas/0f7c2a1e-1111-2222-3333-444455556666/guias').aba, 'guias');
  assert.deepEqual(r('#/usuarios'), { tela: 'usuarios', base: '#/usuarios' });
  console.log('ok  rotas principais, abas da Empresa 360° e filtros da Central no endereço');
}

// 2) Endereços inválidos e sem permissão nunca abrem página em branco
{
  assert.deepEqual(n.resolverRota('#/qualquer-coisa', todos), { redirecionar: '#/visao-geral' });
  assert.deepEqual(n.resolverRota('#/empresas/nao-e-uuid', todos), { redirecionar: '#/visao-geral' });
  assert.deepEqual(n.resolverRota(`#/empresas/${ID}/aba-que-nao-existe`, todos), { redirecionar: `#/empresas/${ID}` });
  assert.deepEqual(n.resolverRota('#/usuarios', consulta), { redirecionar: '#/visao-geral', semPermissao: 'Usuários' });
  console.log('ok  rota desconhecida, aba inexistente e rota sem permissão redirecionam');
}

// 2b) Rotas por módulo: cada tela pede a permissão do seu módulo; a tela inicial é a primeira que o perfil abre
{
  assert.deepEqual(n.resolverRota('#/perfis', todos), { tela: 'perfis', base: '#/perfis' });
  assert.deepEqual(n.resolverRota('#/responsaveis', todos), { tela: 'responsaveis', base: '#/responsaveis' });
  assert.equal(n.resolverRota('#/perfis', consulta).semPermissao, 'Perfis de acesso');
  // Só folha (módulo ainda sem telas): não vê o fiscal nem a captação, cai na lista de empresas
  const folha = (p: string) => ['folha.ver', 'folha.operar', 'algum.ver'].includes(p);
  assert.deepEqual(n.resolverRota('', folha), { redirecionar: '#/empresas' });
  assert.deepEqual(n.resolverRota('#/fechamento', folha), { redirecionar: '#/empresas', semPermissao: 'Fechamento' });
  assert.deepEqual(n.resolverRota('#/notas', folha), { redirecionar: '#/empresas', semPermissao: 'Notas Fiscais' });
  assert.deepEqual(n.resolverRota('#/captacao/monitor', folha), { redirecionar: '#/empresas', semPermissao: 'Captação' });
  assert.deepEqual(n.resolverRota('#/empresas', folha), { tela: 'empresas', base: '#/empresas' });
  // Analista contábil: notas e fiscal só para ver; integrações não
  const contabil = (p: string) => ['captacao.ver', 'fiscal.ver', 'contabil.ver', 'algum.ver'].includes(p);
  assert.equal(n.resolverRota('#/notas', contabil).tela, 'xml');
  assert.equal(n.resolverRota('#/integracoes', contabil).semPermissao, 'Integrações');
  // Só administração de usuários (sem ver nenhum módulo): vai para Usuários
  assert.deepEqual(n.resolverRota('#/visao-geral', (p: string) => p === 'administracao.usuarios'), { redirecionar: '#/usuarios' });
  console.log('ok  rotas por módulo e tela inicial conforme o perfil');
}

// 3) Formatação pt-BR
{
  const nb = (s: string) => s.replace(/ /g, ' ');
  assert.equal(nb(n.moeda(18420.35)), 'R$ 18.420,35');
  assert.equal(n.moeda(null), '—');
  assert.equal(n.formatarCnpj('55885998000140'), '55.885.998/0001-40');
  assert.equal(n.formatarData('2026-09-30T15:00:00Z'), '30/09/2026');
  assert.equal(n.formatarHora('2026-09-30T05:48:00Z'), '02:48');
  assert.equal(n.formatarPercentual(69.63), '69,6%');
  assert.equal(n.textoCompetencia('2026-09'), 'Setembro / 2026');
  console.log('ok  moeda, CNPJ, data, hora, percentual e competência');
}

console.log('\nTestes do núcleo passaram.');
