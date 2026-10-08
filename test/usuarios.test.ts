/**
 * Usuários e acesso do painel: perfis por módulo, exceções, escopo de empresas, responsáveis, proteções e registro.
 *
 *   npx tsx test/usuarios.test.ts
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { AuthAdmin, GestaoUsuarios } from '../src/painel/usuarios';
import {
  Acesso, algumVer, casarResponsavel, empresaDaRota, exigenciaDaRota, idDoNome, moduloDoDepartamento, noEscopo, PERFIS_PADRAO, perfilLegado,
  permissoesEfetivas, pode, podeEmpresa, TODAS_PERMISSOES,
} from '../src/painel/acesso';
import { bancoFalso } from './banco-falso';

function authMemoria(emails: string[]) {
  const contas = emails.map((email, i) => ({ id: `id${i}`, email, ultimoAcesso: '2026-09-29T12:00:00Z' }));
  const auth: AuthAdmin = {
    listar: async () => contas.map((c) => ({ ...c })),
    excluir: async (id) => { contas.splice(contas.findIndex((c) => c.id === id), 1); },
  };
  return { auth, contas };
}

const TABELAS = ['painel_usuarios', 'painel_usuarios_log', 'acesso_usuarios', 'acesso_perfis', 'escritorio_modulos', 'acesso_usuario_empresas', 'empresa_responsaveis', 'acesso_log', 'empresas', 'acessorias_entregas'];
function cenario(usuarios: { email: string; nome: string; perfil: string; ativo?: boolean; perfilId?: string; escopo?: string }[]) {
  const b = bancoFalso(TABELAS);
  b.t.acesso_perfis.push(...PERFIS_PADRAO.map((p) => ({ ...p, permissoes: [...p.permissoes] })));
  for (const u of usuarios) {
    b.t.painel_usuarios.push({ email: u.email, nome: u.nome, perfil: u.perfil, ativo: u.ativo ?? true, criado_em: '2026-09-29' });
    if (u.perfilId) b.t.acesso_usuarios.push({ email: u.email, perfil_id: u.perfilId, escopo: u.escopo ?? 'todas', permissoes_extra: [], permissoes_removidas: [] });
  }
  return b;
}

const rejeita = async (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: any) => re.test(e.message));
const E1 = '11111111-1111-1111-1111-111111111111';
const E2 = '22222222-2222-2222-2222-222222222222';
const E3 = '33333333-3333-3333-3333-333333333333';

(async () => {
  // 0) Perfis prontos do código = os da migration (sem divergência)
  {
    const sql = fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/0042_acesso_modulos.sql'), 'utf8');
    for (const p of PERFIS_PADRAO) {
      const m = sql.match(new RegExp(`\\('${p.id}', '([^']+)',[\\s\\S]*?array\\[([^\\]]*)\\]`));
      assert.ok(m, `perfil ${p.id} na migration`);
      assert.equal(m![1], p.nome);
      const daMigration = m![2].split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean).sort();
      assert.deepEqual(daMigration, [...p.permissoes].sort(), `permissões de ${p.id}`);
      for (const x of daMigration) assert.ok(TODAS_PERMISSOES.includes(x), `permissão válida ${x}`);
    }
    console.log('ok  perfis prontos: código e migration iguais, só permissões do catálogo');
  }

  // 1) Regras puras
  {
    assert.deepEqual([...permissoesEfetivas(['fiscal.ver', 'fiscal.operar'], ['fiscal.transmitir', 'inventada.x'], ['fiscal.operar'])].sort(), ['fiscal.transmitir', 'fiscal.ver']);
    assert.deepEqual([...permissoesEfetivas(['fiscal.ver', 'folha.ver'], [], [], new Set(['fiscal']))], ['fiscal.ver'], 'módulo desligado some');
    assert.equal(perfilLegado(new Set(['administracao.usuarios'])), 'admin');
    assert.equal(perfilLegado(new Set(['fiscal.ver', 'fiscal.transmitir'])), 'supervisor');
    assert.equal(perfilLegado(new Set(['fiscal.ver', 'fiscal.operar'])), 'analista');
    assert.equal(perfilLegado(new Set(['fiscal.ver'])), 'consulta');
    assert.equal(idDoNome('Analista Fiscal II'), 'analista_fiscal_ii');
    assert.equal(idDoNome('2º turno'), 'p_2_turno');
    assert.equal(moduloDoDepartamento('Departamento Fiscal'), 'fiscal');
    assert.equal(moduloDoDepartamento('Dpto. Pessoal'), 'folha');
    assert.equal(moduloDoDepartamento('Contábil'), 'contabil');
    assert.equal(moduloDoDepartamento('Societário / Legalização'), 'societario');
    assert.equal(moduloDoDepartamento('Comercial'), null);
    const us = [{ email: 'mailana@x', nome: 'Mailana Fiorese' }, { email: 'maria@x', nome: 'Maria Eduarda Carvalho' }, { email: 'maria2@x', nome: 'Maria Silva' }];
    assert.equal(casarResponsavel('MAILANA FIORESE', us), 'mailana@x');
    assert.equal(casarResponsavel('Maria Eduarda S. Carvalho', us), 'maria@x', 'primeiro nome + último sobrenome');
    assert.equal(casarResponsavel('Maria', us), null, 'ambíguo não casa');
    assert.equal(casarResponsavel('Fulano de Tal', us), null);
    console.log('ok  regras: permissões efetivas, módulo desligado, perfil antigo, id do perfil, departamento e nome do Acessórias');
  }

  // 2) O que cada rota exige e de qual empresa ela é
  {
    const id = '0f7c2a1e-1111-2222-3333-444455556666';
    const acesso = (perfilId: string, extras: string[] = []): Acesso => {
      const p = PERFIS_PADRAO.find((x) => x.id === perfilId)!;
      return { email: 'a@x', nome: null, perfilId, perfilNome: p.nome, fixo: false, escopo: 'todas', empresas: null, permissoes: permissoesEfetivas(p.permissoes, extras) };
    };
    const libera = (perfilId: string, metodo: string, rota: string) => {
      const a = acesso(perfilId); const e = exigenciaDaRota(metodo, rota);
      return e === null || (e === 'algum.ver' ? algumVer(a) : pode(a, e));
    };
    // Todos os perfis do fiscal leem e baixam
    for (const p of ['administrador', 'supervisor_fiscal', 'analista_fiscal', 'consulta', 'analista_contabil']) {
      assert.ok(libera(p, 'GET', '/api/empresas') && libera(p, 'GET', `/api/empresas/${id}/zip`) && libera(p, 'GET', `/api/empresas/${id}/st`) && libera(p, 'POST', '/api/xml/zip'), p);
    }
    // Folha não vê o fiscal nem as notas, mas vê a lista de empresas
    assert.ok(libera('analista_folha', 'GET', '/api/empresas') && libera('analista_folha', 'GET', `/api/empresas/${id}/360`));
    assert.ok(!libera('analista_folha', 'GET', '/api/visao-geral') && !libera('analista_folha', 'GET', `/api/empresas/${id}/notas`) && !libera('analista_folha', 'POST', '/api/xml/zip'));
    assert.ok(!libera('analista_folha', 'GET', '/api/guias') && !libera('analista_folha', 'GET', '/api/captacao/monitor'));
    // Guias: consulta só vê; gerar/verificar é de quem opera o fiscal; testar a conexão é configuração
    assert.ok(libera('consulta', 'GET', '/api/guias') && libera('consulta', 'GET', '/api/guias/7/pdf'));
    assert.ok(!libera('consulta', 'POST', `/api/empresas/${id}/guias/das`) && libera('analista_fiscal', 'POST', `/api/empresas/${id}/guias/das`));
    assert.ok(!libera('supervisor_fiscal', 'POST', '/api/guias/testar') && libera('administrador', 'POST', '/api/guias/testar'));
    assert.ok(libera('consulta', 'POST', '/api/mcp/tokens') && libera('analista_folha', 'DELETE', '/api/mcp/conexoes/t_0123456789abcdef'), 'conexões de IA: cada um as suas');
    assert.ok(libera('administrador', 'GET', '/api/mcp/uso') && !libera('supervisor_fiscal', 'GET', '/api/mcp/uso'));
    assert.ok(libera('supervisor_fiscal', 'POST', '/api/apuracao/12/transmitir') && !libera('analista_fiscal', 'POST', '/api/apuracao/12/transmitir') && !libera('gestor', 'POST', '/api/usuarios'));
    assert.ok(libera('gestor', 'POST', '/api/apuracao/12/transmitir'), 'gestor transmite');
    // Consulta e contábil não alteram o fiscal nem a captação
    for (const [m, r] of [['POST', `/api/empresas/${id}/sincronizar`], ['POST', `/api/empresas/${id}/importar`], ['POST', '/api/apontamentos/9'],
      ['POST', `/api/empresas/${id}/auditoria/refazer`], ['POST', '/api/empresas'], ['POST', '/api/qualquer-rota-nova']]) {
      assert.ok(!libera('consulta', m, r) && !libera('analista_contabil', m, r), `${m} ${r}`);
    }
    // Analista fiscal opera (inclusive captação), sem certificado, pausa, configuração nem usuários
    assert.ok(libera('analista_fiscal', 'POST', `/api/empresas/${id}/sincronizar`) && libera('analista_fiscal', 'POST', `/api/empresas/${id}/importar`));
    assert.ok(!libera('analista_fiscal', 'POST', '/api/empresas') && !libera('analista_fiscal', 'POST', `/api/empresas/${id}/ativo`));
    assert.ok(!libera('analista_fiscal', 'POST', '/api/st-es/tabela') && !libera('analista_fiscal', 'GET', '/api/usuarios') && !libera('analista_fiscal', 'GET', '/api/acesso/perfis'));
    assert.ok(libera('analista_fiscal', 'POST', '/api/sped') && libera('analista_fiscal', 'POST', '/api/sped/12/refazer') && !libera('analista_fiscal', 'POST', '/api/cadastros/3/aprovar'));
    // Supervisor: certificados e pausa; não configura nem gerencia usuários
    assert.ok(libera('supervisor_fiscal', 'POST', '/api/empresas') && libera('supervisor_fiscal', 'POST', `/api/empresas/${id}/ativo`) && libera('supervisor_fiscal', 'POST', '/api/cadastros/3/aprovar'));
    assert.ok(!libera('supervisor_fiscal', 'POST', '/api/st-es/tabela') && !libera('supervisor_fiscal', 'DELETE', '/api/usuarios/a%40x.com') && !libera('supervisor_fiscal', 'POST', '/api/integracoes'));
    // Administrador: tudo
    assert.ok(libera('administrador', 'POST', '/api/st-es/tabela') && libera('administrador', 'PATCH', '/api/usuarios/a%40x.com') && libera('administrador', 'POST', '/api/acesso/responsaveis'));
    // Exceção individual: analista fiscal com transmitir
    {
      const a = acesso('analista_fiscal', ['fiscal.transmitir']);
      assert.ok(pode(a, exigenciaDaRota('POST', '/api/apuracao/12/transmitir') as string));
    }
    // Empresa da rota (para conferir o escopo)
    assert.deepEqual(empresaDaRota(`/api/empresas/${id}/notas`), { empresa: id });
    assert.deepEqual(empresaDaRota(`/api/empresas/${id}`), { empresa: id });
    assert.deepEqual(empresaDaRota('/api/apontamentos/9'), { tabela: 'apontamentos', id: 9 });
    assert.deepEqual(empresaDaRota('/api/apuracao/ajustes/5'), { tabela: 'apuracao_ajustes', id: 5 });
    assert.deepEqual(empresaDaRota('/api/apuracao/12/transmitir'), { tabela: 'apuracoes_simples', id: 12 });
    assert.deepEqual(empresaDaRota('/api/guias/7/pdf'), { tabela: 'guias', id: 7 });
    assert.deepEqual(empresaDaRota('/api/documentos/3/arquivo'), { tabela: 'documentos_entrega', id: 3 });
    assert.deepEqual(empresaDaRota('/api/sped/4/arquivo'), { tabela: 'sped_arquivos', id: 4 });
    assert.deepEqual(empresaDaRota('/api/sped-gerado/8/arquivo'), { tabela: 'sped_gerados', id: 8 });
    assert.equal(empresaDaRota('/api/visao-geral'), null);
    const lim: Acesso = { ...acesso('consulta'), escopo: 'lista', empresas: new Set([E1]) };
    assert.ok(podeEmpresa(lim, E1) && !podeEmpresa(lim, E2) && podeEmpresa(lim, null));
    assert.deepEqual(noEscopo(lim, [{ id: E1 }, { id: E2 }], (x) => x.id), [{ id: E1 }]);
    console.log('ok  rotas: cada módulo pede a sua permissão, folha não vê fiscal, rota nova fechada, escopo pela empresa do registro');
  }

  // 3) Acesso de cada usuário (fixo, convertido, sem linha nova, desativado)
  const FIXO = 'dono@x.com';
  const b = cenario([
    { email: 'ana@x.com', nome: 'Ana', perfil: 'admin', perfilId: 'administrador' },
    { email: 'bia@x.com', nome: 'Bia', perfil: 'analista', perfilId: 'analista_fiscal' },
    { email: 'leo@x.com', nome: 'Leo', perfil: 'supervisor' }, // sem linha em acesso_usuarios: usa o perfil antigo
    { email: 'off@x.com', nome: 'Off', perfil: 'admin', perfilId: 'administrador', ativo: false },
  ]);
  b.t.empresas.push({ id: E1, cnpj: '11111111000111', razao_social: 'Alfa', ativo: true }, { id: E2, cnpj: '22222222000122', razao_social: 'Beta', ativo: true }, { id: E3, cnpj: '33333333000133', razao_social: 'Gama', ativo: true });
  const { auth, contas } = authMemoria([FIXO, 'ana@x.com', 'bia@x.com']);
  const mudou: string[] = [];
  const g = new GestaoUsuarios(b.db, auth, new Set([FIXO]), (e) => mudou.push(e));
  {
    const f = (await g.acessoDe(FIXO))!;
    assert.ok(f.fixo && f.empresas === null && f.permissoes.has('administracao.usuarios') && f.permissoes.has('folha.transmitir'));
    assert.equal((await g.acessoDe('bia@x.com'))!.perfilNome, 'Analista fiscal');
    assert.ok((await g.acessoDe('leo@x.com'))!.permissoes.has('fiscal.transmitir'), 'perfil antigo "supervisor" vira Supervisor fiscal');
    assert.equal(await g.acessoDe('off@x.com'), null);
    assert.equal(await g.acessoDe('zeca@x.com'), null);
    console.log('ok  acesso: fixo tem tudo, perfil convertido, sem linha nova usa o antigo, desativado/desconhecido sem acesso');
  }

  // 4) Criar com escopo e exceções
  await rejeita(g.criar('bia@x.com', { email: 'c@x.com', nome: 'Carla' }), /administra usuários/);
  await g.criar('ana@x.com', { email: ' Caio@X.com ', nome: 'Caio', perfilId: 'analista_fiscal', escopo: 'lista', empresas: [E1, E2], permissoesExtra: ['fiscal.transmitir', 'fiscal.ver'], permissoesRemovidas: ['captacao.operar'] });
  {
    const c = (await g.acessoDe('caio@x.com'))!;
    assert.ok(c.permissoes.has('fiscal.transmitir') && !c.permissoes.has('captacao.operar'));
    assert.deepEqual([...c.empresas!].sort(), [E1, E2]);
    const linha = b.t.acesso_usuarios.find((x) => x.email === 'caio@x.com');
    assert.deepEqual([linha.permissoes_extra, linha.permissoes_removidas], [['fiscal.transmitir'], ['captacao.operar']], 'exceção só do que difere do perfil');
    assert.equal(b.t.painel_usuarios.find((x) => x.email === 'caio@x.com').perfil, 'supervisor', 'coluna antiga acompanha (rollback)');
  }
  await rejeita(g.criar('ana@x.com', { email: 'caio@x.com', nome: 'Caio' }), /Já existe/);
  await rejeita(g.criar('ana@x.com', { email: FIXO, nome: 'Dono' }), /administrador fixo/);
  await rejeita(g.criar('ana@x.com', { email: 'sem-arroba', nome: 'Xavier' }), /e-mail válido/);
  await rejeita(g.criar('ana@x.com', { email: 'd@x.com', nome: 'Davi', perfilId: 'root' }), /Perfil inválido/);
  await rejeita(g.criar('ana@x.com', { email: 'd@x.com', nome: 'Davi', permissoesExtra: ['tudo.sempre'] }), /Permissão desconhecida/);
  await rejeita(g.criar('ana@x.com', { email: 'd@x.com', nome: 'Davi', escopo: 'lista', empresas: [] }), /ao menos uma empresa/);
  await g.criar('ana@x.com', { email: 'velho@x.com', nome: 'Velho', perfil: 'consulta' });
  assert.equal((await g.acessoDe('velho@x.com'))!.perfilId, 'consulta', 'tela antiga (perfil) ainda funciona');
  let lista = await g.listar();
  assert.equal(lista.find((u) => u.email === 'caio@x.com')?.situacao, 'aguardando');
  assert.equal(lista.find((u) => u.email === 'caio@x.com')?.empresasNoEscopo, 2);
  assert.equal(lista.find((u) => u.email === FIXO)?.fixo, true);
  console.log('ok  criar: escopo em lista, exceções limpas contra o perfil, validações e compatibilidade com a tela antiga');

  // 5) Editar: perfil, carteira, desativar e reativar
  await g.editar('ana@x.com', 'bia@x.com', { nome: 'Beatriz', perfilId: 'consulta' });
  assert.ok(!(await g.acessoDe('bia@x.com'))!.permissoes.has('fiscal.operar'));
  assert.ok(mudou.includes('bia@x.com'), 'sessões derrubadas ao mudar o acesso');
  await g.editar('ana@x.com', 'bia@x.com', { escopo: 'carteira' });
  assert.equal((await g.acessoDe('bia@x.com'))!.empresas!.size, 0, 'carteira vazia: não vê nenhuma empresa');
  await g.definirResponsaveis('ana@x.com', { modulo: 'fiscal', empresas: [E1, E3], emails: ['bia@x.com'] });
  assert.deepEqual([...(await g.acessoDe('bia@x.com'))!.empresas!].sort(), [E1, E3], 'carteira = empresas em que é responsável');
  await g.definirResponsaveis('ana@x.com', { modulo: 'fiscal', empresas: [E3], emails: [] });
  assert.deepEqual([...(await g.acessoDe('bia@x.com'))!.empresas!], [E1], 'tirar responsável tira da carteira');
  await rejeita(g.definirResponsaveis('ana@x.com', { modulo: 'administracao', empresas: [E1], emails: [] }), /Módulo inválido/);
  await rejeita(g.definirResponsaveis('ana@x.com', { modulo: 'fiscal', empresas: [E1], emails: ['zeca@x.com'] }), /sem acesso ativo/);
  await g.editar('ana@x.com', 'caio@x.com', { ativo: false });
  assert.equal(await g.acessoDe('caio@x.com'), null);
  await g.editar('ana@x.com', 'caio@x.com', { ativo: true });
  assert.ok((await g.acessoDe('caio@x.com'))!.permissoes.has('fiscal.transmitir'), 'reativado volta com o mesmo acesso');
  await g.editar('ana@x.com', 'caio@x.com', { escopo: 'todas', empresas: [] });
  assert.equal((await g.acessoDe('caio@x.com'))!.empresas, null);
  assert.equal(b.t.acesso_usuario_empresas.filter((x) => x.email === 'caio@x.com').length, 0, 'lista limpa ao sair do escopo "lista"');
  lista = await g.listar();
  assert.equal(lista.find((u) => u.email === 'bia@x.com')?.escopo, 'carteira');
  console.log('ok  editar: perfil, carteira pelos responsáveis, lista limpa, desativar e reativar');

  // 6) Proteções
  await rejeita(g.editar('ana@x.com', 'ana@x.com', { ativo: false }), /próprio acesso|a si mesmo/);
  await rejeita(g.editar('ana@x.com', 'ana@x.com', { perfilId: 'consulta' }), /próprio acesso/);
  await rejeita(g.editar('ana@x.com', 'ana@x.com', { escopo: 'lista', empresas: [E1] }), /próprio acesso/);
  await g.editar('ana@x.com', 'ana@x.com', { nome: 'Ana Paula' });
  await rejeita(g.editar('ana@x.com', FIXO, { ativo: false }), /fixo/);
  await rejeita(g.excluir('ana@x.com', 'ana@x.com', 'ana@x.com'), /a si mesmo/);
  await rejeita(g.excluir('ana@x.com', 'caio@x.com', 'outro@x.com'), /digite o e-mail/);
  {
    const b2 = cenario([{ email: 'so@x.com', nome: 'Só', perfil: 'admin', perfilId: 'administrador' }, { email: 'op@x.com', nome: 'Op', perfil: 'admin', perfilId: 'administrador' }]);
    const g2 = new GestaoUsuarios(b2.db, authMemoria([]).auth, new Set());
    await g2.editar('so@x.com', 'op@x.com', { perfilId: 'analista_fiscal' });
    await g2.criar('so@x.com', { email: 'x@x.com', nome: 'Xis', perfilId: 'gestor' });
    await rejeita(g2.editar('x@x.com', 'so@x.com', { perfilId: 'consulta' }), /administra usuários/);
    // Perfil próprio com administração: não dá para tirá-la se só esse perfil administra
    const { id } = await g2.salvarPerfil('so@x.com', { nome: 'Chefe', permissoes: ['fiscal.ver', 'administracao.usuarios'] });
    await g2.editar('so@x.com', 'op@x.com', { perfilId: id });
    await g2.editar('op@x.com', 'so@x.com', { perfilId: 'consulta' });
    await rejeita(g2.salvarPerfil('op@x.com', { id, nome: 'Chefe', permissoes: ['fiscal.ver'] }), /pelo menos um administrador/);
    await rejeita(g2.editar('op@x.com', 'op@x.com', { perfilId: 'consulta' }), /próprio acesso/);
    console.log('ok  proteções: não muda o próprio acesso, fixo intocável, sempre sobra um administrador (inclusive ao editar perfil)');
  }

  // 7) Perfis e módulos
  {
    await rejeita(g.salvarPerfil('ana@x.com', { id: 'consulta', nome: 'Consulta', permissoes: ['fiscal.ver'] }), /Perfis prontos não são alterados/);
    await rejeita(g.salvarPerfil('ana@x.com', { nome: 'Consulta', permissoes: ['fiscal.ver'] }), /Já existe o perfil/);
    await rejeita(g.salvarPerfil('ana@x.com', { nome: 'Vazio', permissoes: [] }), /ao menos uma permissão/);
    await rejeita(g.salvarPerfil('ana@x.com', { nome: 'Errado', permissoes: ['x.y'] }), /desconhecida/);
    await rejeita(g.salvarPerfil('bia@x.com', { nome: 'Meu', permissoes: ['fiscal.ver'] }), /administra usuários/);
    const { id } = await g.salvarPerfil('ana@x.com', { nome: 'Fiscal júnior', descricao: 'Sem importar', permissoes: ['captacao.ver', 'fiscal.ver', 'fiscal.operar'] });
    assert.equal(id, 'fiscal_junior');
    await g.editar('ana@x.com', 'velho@x.com', { perfilId: id });
    assert.ok((await g.acessoDe('velho@x.com'))!.permissoes.has('fiscal.operar'));
    mudou.length = 0;
    await g.salvarPerfil('ana@x.com', { id, nome: 'Fiscal júnior', permissoes: ['captacao.ver', 'fiscal.ver'] });
    assert.ok(!(await g.acessoDe('velho@x.com'))!.permissoes.has('fiscal.operar'), 'mudar o perfil muda quem o usa');
    assert.ok(mudou.includes('velho@x.com'));
    await rejeita(g.excluirPerfil('ana@x.com', id), /Há usuários/);
    await rejeita(g.excluirPerfil('ana@x.com', 'gestor'), /prontos não podem/);
    const perfis = await g.perfis();
    assert.equal(perfis.find((p) => p.id === id)!.usuarios, 1);
    // Módulo desligado tira as permissões dele de todos
    await g.definirModulo('ana@x.com', 'captacao', false);
    assert.ok(!(await g.acessoDe('caio@x.com'))!.permissoes.has('captacao.ver'));
    assert.ok(!(await g.acessoDe(FIXO))!.permissoes.has('captacao.ver'), 'até do administrador fixo');
    assert.equal((await g.modulos()).find((m) => m.id === 'captacao')!.ativo, false);
    await g.definirModulo('ana@x.com', 'captacao', true);
    await rejeita(g.definirModulo('ana@x.com', 'administracao', false), /não pode ser desligada/);
    console.log('ok  perfis: prontos intocáveis, nome único, criar/editar vale para quem usa, excluir só sem uso; módulo desligado some');
  }

  // 8) Sugestões do Acessórias
  {
    b.t.acessorias_entregas.push({ empresa_id: E2, competencia: '2026-09-01', entregas: [
      { nome: 'DCTFWeb', departamento: 'Fiscal', responsavel: 'BEATRIZ' }, { nome: 'EFD', departamento: 'Fiscal', responsavel: 'Caio' }, { nome: 'GFIP', departamento: 'Pessoal', responsavel: 'Fulano' },
      { nome: 'EFD-Reinf', departamento: 'Fiscal', responsavel: 'Caio' },
    ] });
    const s = await g.sugestoesAcessorias();
    const fiscal = s.sugestoes.find((x) => x.modulo === 'fiscal')!;
    assert.deepEqual([fiscal.empresaId, fiscal.nomeAcessorias, fiscal.email], [E2, 'Caio', 'caio@x.com'], 'o nome que mais aparece');
    assert.deepEqual(s.semUsuario, ['Fulano']);
    const r = await g.aplicarSugestoes('ana@x.com', [{ empresaId: E2, modulo: 'fiscal', email: 'caio@x.com' }, { empresaId: E2, modulo: 'fiscal', email: 'zeca@x.com' }]);
    assert.equal(r.aplicadas, 1, 'sugestão com usuário sem acesso é ignorada');
    assert.equal(b.t.empresa_responsaveis.find((x) => x.empresa_id === E2).origem, 'acessorias');
    assert.ok((await g.sugestoesAcessorias()).sugestoes.find((x) => x.modulo === 'fiscal')!.jaDefinido);
    console.log('ok  Acessórias: sugere pelo departamento e nome, aplica só o escolhido e marca o que já está definido');
  }

  // 9) Redefinir senha, excluir e registro
  await g.redefinirSenha('ana@x.com', 'bia@x.com');
  assert.ok(!contas.some((c) => c.email === 'bia@x.com'), 'conta de login apagada');
  await g.excluir('ana@x.com', 'bia@x.com', 'BIA@x.com');
  assert.equal(await g.acessoDe('bia@x.com'), null);
  assert.ok(!b.t.empresa_responsaveis.some((x) => x.email === 'bia@x.com'), 'sai das carteiras ao ser excluído');
  const acoes = b.t.painel_usuarios_log.map((l) => `${l.acao}:${l.alvo}`);
  assert.ok(['criar:caio@x.com', 'editar:bia@x.com', 'desativar:caio@x.com', 'reativar:caio@x.com', 'redefinir_senha:bia@x.com', 'excluir:bia@x.com'].every((a) => acoes.includes(a)));
  assert.ok(b.t.acesso_log.some((l) => l.acao === 'perfil_criar') && b.t.acesso_log.some((l) => l.acao === 'modulo_desligar') && b.t.acesso_log.some((l) => l.acao === 'responsaveis'));
  const hist = await g.historico(100);
  assert.ok(hist.some((x) => x.acao === 'perfil_editar') && hist.some((x) => x.acao === 'criar'), 'histórico junta usuários e acesso');
  console.log('ok  redefinir senha, excluir (sai das carteiras) e registro de tudo com quem fez');

  console.log('\nTestes de usuários e acesso passaram.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
