/**
 * Gestão de usuários do painel: permissões, proteções e registro.
 *
 *   npx tsx test/usuarios.test.ts
 */
import assert from 'assert';
import { AuthAdmin, GestaoUsuarios, PERMISSOES, permissaoDaRota } from '../src/painel/usuarios';

/** Banco em memória com o suficiente de supabase-js para as tabelas de usuários. */
function bancoMemoria(inicial: any[]) {
  const tabelas: Record<string, any[]> = { painel_usuarios: inicial.map((x) => ({ ...x })), painel_usuarios_log: [] };
  const from = (t: string) => {
    let op = 'select';
    let dados: any;
    const filtros: [string, unknown][] = [];
    let limite = Infinity;
    const q: any = {
      select: () => q, order: () => q,
      eq: (c: string, v: unknown) => { filtros.push([c, v]); return q; },
      limit: (n: number) => { limite = n; return q; },
      insert: (d: any) => { op = 'insert'; dados = d; return q; },
      update: (d: any) => { op = 'update'; dados = d; return q; },
      delete: () => { op = 'delete'; return q; },
      then: (ok: any) => {
        const tab = tabelas[t];
        const casa = (r: any) => filtros.every(([c, v]) => r[c] === v);
        let data: any = null;
        if (op === 'select') data = tab.filter(casa).slice(0, limite);
        if (op === 'insert') tab.push({ ...dados });
        if (op === 'update') tab.filter(casa).forEach((r) => Object.assign(r, dados));
        if (op === 'delete') tabelas[t] = tab.filter((r) => !casa(r));
        return Promise.resolve({ data, error: null }).then(ok);
      },
    };
    return q;
  };
  return { db: { from } as any, tabelas };
}

function authMemoria(emails: string[]) {
  const contas = emails.map((email, i) => ({ id: `id${i}`, email, ultimoAcesso: '2026-09-29T12:00:00Z' }));
  const auth: AuthAdmin = {
    listar: async () => contas.map((c) => ({ ...c })),
    excluir: async (id) => { contas.splice(contas.findIndex((c) => c.id === id), 1); },
  };
  return { auth, contas };
}

const rejeita = async (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: any) => re.test(e.message));

(async () => {
  const FIXO = 'dono@x.com';
  const { db, tabelas } = bancoMemoria([
    { email: 'ana@x.com', nome: 'Ana', perfil: 'admin', ativo: true, criado_em: '2026-09-29' },
    { email: 'bia@x.com', nome: 'Bia', perfil: 'analista', ativo: true, criado_em: '2026-09-29' },
  ]);
  const { auth, contas } = authMemoria([FIXO, 'ana@x.com', 'bia@x.com']);
  const mudou: string[] = [];
  const g = new GestaoUsuarios(db, auth, new Set([FIXO]), (e) => mudou.push(e));

  // Perfis
  assert.equal(await g.perfilDe(FIXO), 'admin');
  assert.equal(await g.perfilDe('ana@x.com'), 'admin');
  assert.equal(await g.perfilDe('bia@x.com'), 'analista');
  assert.equal(await g.perfilDe('zeca@x.com'), null);
  console.log('ok  perfis: fixo é administrador, tabela define os demais, desconhecido sem acesso');

  // Operador não gerencia
  await rejeita(g.criar('bia@x.com', { email: 'c@x.com', nome: 'Carla' }), /Só administradores/);
  console.log('ok  analista não gerencia usuários');

  // Criar
  await g.criar('ana@x.com', { email: ' Caio@X.com ', nome: 'Caio', perfil: 'analista' });
  assert.equal(await g.perfilDe('caio@x.com'), 'analista');
  await rejeita(g.criar('ana@x.com', { email: 'caio@x.com', nome: 'Caio' }), /Já existe/);
  await rejeita(g.criar('ana@x.com', { email: FIXO, nome: 'Dono' }), /administrador fixo/);
  await rejeita(g.criar('ana@x.com', { email: 'sem-arroba', nome: 'Xavier' }), /e-mail válido/);
  await rejeita(g.criar('ana@x.com', { email: 'd@x.com', nome: 'Davi', perfil: 'root' }), /Perfil inválido/);
  let lista = await g.listar();
  assert.equal(lista.find((u) => u.email === 'caio@x.com')?.situacao, 'aguardando');
  assert.equal(lista.find((u) => u.email === FIXO)?.fixo, true);
  console.log('ok  criar: e-mail normalizado, duplicado/fixo/inválido recusados, novo fica aguardando primeiro acesso');

  // Editar e desativar
  await g.editar('ana@x.com', 'bia@x.com', { nome: 'Beatriz', perfil: 'admin' });
  assert.equal(await g.perfilDe('bia@x.com'), 'admin');
  await g.editar('ana@x.com', 'caio@x.com', { ativo: false });
  assert.equal(await g.perfilDe('caio@x.com'), null);
  assert.ok(mudou.includes('caio@x.com'), 'sessões derrubadas ao desativar');
  lista = await g.listar();
  assert.equal(lista.find((u) => u.email === 'caio@x.com')?.situacao, 'desativado');
  await g.editar('ana@x.com', 'caio@x.com', { ativo: true });
  assert.equal(await g.perfilDe('caio@x.com'), 'analista');
  console.log('ok  editar, desativar (corta acesso na hora) e reativar');

  // Proteções
  await rejeita(g.editar('ana@x.com', 'ana@x.com', { ativo: false }), /próprio perfil|a si mesmo/);
  await rejeita(g.editar('ana@x.com', 'ana@x.com', { perfil: 'analista' }), /próprio perfil/);
  await g.editar('ana@x.com', 'ana@x.com', { nome: 'Ana Paula' });
  await rejeita(g.editar('ana@x.com', FIXO, { ativo: false }), /fixo/);
  await rejeita(g.excluir('ana@x.com', 'ana@x.com', 'ana@x.com'), /a si mesmo/);
  await rejeita(g.excluir('ana@x.com', 'caio@x.com', 'outro@x.com'), /digite o e-mail/);
  console.log('ok  proteções: não altera o próprio acesso, fixo intocável, exclusão exige confirmação');

  // Último administrador (instância sem fixos)
  {
    const b = bancoMemoria([{ email: 'so@x.com', nome: 'Só', perfil: 'admin', ativo: true }, { email: 'op@x.com', nome: 'Op', perfil: 'admin', ativo: true }]);
    const g2 = new GestaoUsuarios(b.db, authMemoria([]).auth, new Set());
    await g2.editar('so@x.com', 'op@x.com', { perfil: 'analista' });
    b.tabelas.painel_usuarios.push({ email: 'x@x.com', nome: 'X', perfil: 'analista', ativo: true });
    // "so" é o último administrador: ninguém pode tirá-lo (ele mesmo já é barrado pela regra do próprio usuário)
    await rejeita(g2.editar('so@x.com', 'so@x.com', { perfil: 'analista' }), /próprio perfil/);
    console.log('ok  sempre sobra pelo menos um administrador');
  }

  // Redefinir senha e excluir
  await g.redefinirSenha('ana@x.com', 'bia@x.com');
  assert.ok(!contas.some((c) => c.email === 'bia@x.com'), 'conta de login apagada');
  lista = await g.listar();
  assert.equal(lista.find((u) => u.email === 'bia@x.com')?.situacao, 'aguardando');
  await g.excluir('ana@x.com', 'caio@x.com', 'CAIO@x.com');
  assert.equal(await g.perfilDe('caio@x.com'), null);
  assert.ok(!tabelas.painel_usuarios.some((u) => u.email === 'caio@x.com'));
  console.log('ok  redefinir senha (volta a aguardar primeiro acesso) e excluir');

  // Registro
  const acoes = tabelas.painel_usuarios_log.map((l) => `${l.acao}:${l.alvo}`);
  assert.deepEqual(acoes, [
    'criar:caio@x.com', 'editar:bia@x.com', 'desativar:caio@x.com', 'reativar:caio@x.com', 'editar:ana@x.com',
    'redefinir_senha:bia@x.com', 'excluir:caio@x.com',
  ]);
  assert.ok(tabelas.painel_usuarios_log.every((l) => l.por === 'ana@x.com'));
  console.log('ok  cada ação registrada com quem fez');

  // Permissões por perfil
  {
    const id = '0f7c2a1e-1111-2222-3333-444455556666';
    const pode = (perfil: keyof typeof PERMISSOES, metodo: string, rota: string) => {
      const p = permissaoDaRota(metodo, rota);
      return !p || PERMISSOES[perfil].includes(p);
    };
    // Todos leem e baixam
    for (const perfil of ['admin', 'supervisor', 'analista', 'consulta'] as const) {
      assert.ok(pode(perfil, 'GET', '/api/empresas'));
      assert.ok(pode(perfil, 'GET', `/api/empresas/${id}/zip`));
      assert.ok(pode(perfil, 'GET', `/api/empresas/${id}/st`));
    }
    // Guias (Integra Contador): consulta só vê; gerar e verificar é de quem opera; testar a conexão é configuração
    assert.ok(pode('consulta', 'GET', '/api/guias') && pode('consulta', 'GET', '/api/guias/7/pdf'));
    assert.ok(!pode('consulta', 'POST', `/api/empresas/${id}/guias/das`) && pode('analista', 'POST', `/api/empresas/${id}/guias/das`));
    assert.ok(!pode('consulta', 'POST', '/api/guias/lote') && pode('analista', 'POST', '/api/guias/lote'));
    assert.ok(!pode('supervisor', 'POST', '/api/guias/testar') && pode('admin', 'POST', '/api/guias/testar'));
    // Consulta não altera nada
    for (const [m, r] of [['POST', `/api/empresas/${id}/sincronizar`], ['POST', `/api/empresas/${id}/importar`], ['POST', '/api/apontamentos/9'],
      ['POST', `/api/empresas/${id}/auditoria/refazer`], ['POST', '/api/empresas'], ['POST', '/api/qualquer-rota-nova']]) {
      assert.ok(!pode('consulta', m, r), `${m} ${r}`);
    }
    // Analista opera, mas não mexe em certificado, pausa, configuração nem usuários
    assert.ok(pode('analista', 'POST', `/api/empresas/${id}/sincronizar`));
    assert.ok(pode('analista', 'POST', `/api/empresas/${id}/importar`));
    assert.ok(!pode('analista', 'POST', '/api/empresas'));
    assert.ok(!pode('analista', 'POST', `/api/empresas/${id}/ativo`));
    assert.ok(!pode('analista', 'POST', '/api/st-es/tabela'));
    assert.ok(!pode('analista', 'GET', '/api/usuarios'));
    // SPED: analista envia e refaz a comparação; aprovar cadastro é de supervisor/admin; consulta só lê
    assert.ok(pode('analista', 'POST', '/api/sped'));
    assert.ok(pode('analista', 'POST', `/api/empresas/${id}/sped`));
    assert.ok(pode('analista', 'POST', '/api/sped/12/refazer'));
    assert.ok(!pode('analista', 'POST', '/api/cadastros/3/aprovar'));
    assert.ok(!pode('analista', 'POST', '/api/cadastros/3/rejeitar'));
    assert.ok(pode('supervisor', 'POST', '/api/cadastros/3/aprovar'));
    assert.ok(pode('consulta', 'GET', '/api/cadastros') && pode('consulta', 'GET', '/api/sped/12/arquivo'));
    assert.ok(!pode('consulta', 'POST', '/api/sped'));
    // Supervisor: certificados e pausa sim; configuração e usuários não
    assert.ok(pode('supervisor', 'POST', '/api/empresas'));
    assert.ok(pode('supervisor', 'POST', `/api/empresas/${id}/ativo`));
    assert.ok(!pode('supervisor', 'POST', '/api/st-es/tabela'));
    assert.ok(!pode('supervisor', 'GET', '/api/usuarios'));
    assert.ok(!pode('supervisor', 'DELETE', '/api/usuarios/a%40x.com'));
    // Administrador: tudo
    assert.ok(pode('admin', 'POST', '/api/st-es/tabela'));
    assert.ok(pode('admin', 'PATCH', '/api/usuarios/a%40x.com'));
    console.log('ok  permissões: consulta só lê, analista opera, supervisor cuida de certificados, admin faz tudo');
  }

  // Perfil desconhecido no banco vira o mais restrito
  {
    const b = bancoMemoria([{ email: 'y@x.com', nome: 'Y', perfil: 'root', ativo: true }]);
    assert.equal(await new GestaoUsuarios(b.db, authMemoria([]).auth, new Set()).perfilDe('y@x.com'), 'consulta');
    console.log('ok  perfil inválido no banco é tratado como Consulta');
  }

  console.log('\nTestes de usuários passaram.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
