import { Db, ok } from '../db';

/**
 * Gestão dos usuários do painel.
 *
 * - Os e-mails de PAINEL_EMAILS são administradores fixos (configurados no servidor, não editáveis pela tela).
 * - Os demais ficam na tabela painel_usuarios, com perfil admin, supervisor, analista ou consulta.
 * - Ninguém define a senha de outra pessoa: o usuário criado entra pelo "Primeiro acesso".
 *   "Redefinir senha" apaga a conta de login para a pessoa criar uma nova senha do mesmo jeito.
 */

export type Perfil = 'admin' | 'supervisor' | 'analista' | 'consulta';

/** O que cada perfil pode fazer. Leitura e download são livres para todos com acesso. */
/** 'transmitir': entregar declarações oficiais à Receita (PGDAS-D). O analista confere e simula; supervisor/admin transmite. */
export type Permissao = 'usuarios' | 'configuracoes' | 'certificados' | 'operar' | 'transmitir';
export const PERMISSOES: Record<Perfil, Permissao[]> = {
  admin: ['usuarios', 'configuracoes', 'certificados', 'operar', 'transmitir'],
  supervisor: ['certificados', 'operar', 'transmitir'],
  analista: ['operar'],
  consulta: [],
};

/**
 * Permissão exigida por uma rota da API. Toda escrita exige alguma permissão
 * (padrão 'operar'), então uma rota nova nunca fica aberta para o perfil Consulta por engano.
 */
export function permissaoDaRota(metodo: string, rota: string): Permissao | null {
  if (rota === '/api/usuarios' || rota.startsWith('/api/usuarios/')) return 'usuarios';
  // Transmissão do PGDAS-D (declaração oficial): supervisor e admin
  if (/^\/api\/apuracao\/\d+\/transmitir$/.test(rota)) return 'transmitir';
  // Uso do MCP de todos os usuários: só a administração
  if (rota === '/api/mcp/uso') return 'usuarios';
  if (metodo === 'GET' || metodo === 'HEAD') return null;
  // Conexões de IA: cada usuário gerencia só as próprias (o MCP respeita o perfil a cada chamada)
  if (rota === '/api/mcp/tokens' || rota.startsWith('/api/mcp/conexoes/')) return null;
  if (rota === '/api/empresas' || /^\/api\/empresas\/[^/]+\/ativo$/.test(rota)) return 'certificados';
  if (rota === '/api/st-es/tabela') return 'configuracoes';
  // Teste de conexão com o SERPRO: configuração do escritório
  if (rota === '/api/guias/testar' || rota === '/api/guias/chaves' || rota === '/api/acessorias' || rota === '/api/acessorias/testar') return 'configuracoes';
  // Aprovar dados de cadastro (e criar cliente pré-cadastrado): mesmo nível de quem cadastra empresas
  if (rota.startsWith('/api/cadastros/')) return 'certificados';
  return 'operar';
}
export type Situacao = 'ativo' | 'desativado' | 'aguardando';

export interface Usuario {
  email: string;
  nome: string | null;
  perfil: Perfil;
  ativo: boolean;
  fixo: boolean;
  situacao: Situacao;
  ultimoAcesso: string | null;
  criadoEm: string | null;
}

/** O que precisamos do Supabase Auth (separado para poder testar). */
export interface AuthAdmin {
  listar(): Promise<{ id: string; email: string; ultimoAcesso: string | null }[]>;
  excluir(id: string): Promise<void>;
}

export class ErroUsuario extends Error {
  constructor(public readonly status: number, msg: string) {
    super(msg);
  }
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PERFIS_INFO: { id: Perfil; nome: string; descricao: string }[] = [
  { id: 'admin', nome: 'Administrador', descricao: 'Acesso completo: usuários, configurações (como a tabela de ST), certificados e todo o trabalho fiscal.' },
  { id: 'supervisor', nome: 'Supervisor', descricao: 'Todo o trabalho fiscal, mais transmitir o PGDAS-D, cadastrar e trocar certificados e pausar empresas. Não gerencia usuários.' },
  { id: 'analista', nome: 'Analista', descricao: 'Trabalho do dia a dia: sincronizar, importar XML, auditar, conferir e calcular a apuração. Não transmite declarações nem mexe em certificados.' },
  { id: 'consulta', nome: 'Consulta', descricao: 'Só vê e baixa notas e relatórios. Não altera nada.' },
];
const PERFIS: Perfil[] = PERFIS_INFO.map((p) => p.id);
/** Valor desconhecido vira o perfil mais restrito. */
const normalizarPerfil = (v: unknown): Perfil => (PERFIS.includes(v as Perfil) ? (v as Perfil) : 'consulta');

export function authDoSupabase(db: Db): AuthAdmin {
  return {
    async listar() {
      const todos: { id: string; email: string; ultimoAcesso: string | null }[] = [];
      for (let page = 1; page < 50; page++) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw new Error(`listar contas de login: ${error.message}`);
        for (const u of data.users) if (u.email) todos.push({ id: u.id, email: u.email.toLowerCase(), ultimoAcesso: u.last_sign_in_at ?? null });
        if (data.users.length < 1000) break;
      }
      return todos;
    },
    async excluir(id) {
      const { error } = await db.auth.admin.deleteUser(id);
      if (error) throw new Error(`excluir conta de login: ${error.message}`);
    },
  };
}

export class GestaoUsuarios {
  private cache = { em: 0, ativos: new Map<string, { nome: string | null; perfil: Perfil }>() };

  constructor(
    private readonly db: Db,
    private readonly auth: AuthAdmin,
    private readonly fixos: Set<string>,
    /** Chamado quando o acesso de um e-mail muda (para derrubar sessões em cache). */
    private readonly aoMudar: (email: string) => void = () => {},
  ) {}

  private async ativos() {
    if (Date.now() - this.cache.em > 60_000) {
      const r = await this.db.from('painel_usuarios').select('email,nome,perfil').eq('ativo', true);
      if (!r.error) {
        this.cache = {
          em: Date.now(),
          ativos: new Map((r.data ?? []).map((u: any) => [String(u.email).toLowerCase(), { nome: u.nome ?? null, perfil: normalizarPerfil(u.perfil) }])),
        };
      }
    }
    return this.cache.ativos;
  }

  invalidar(email?: string) {
    this.cache.em = 0;
    if (email) this.aoMudar(email);
  }

  /** Perfil de quem tem acesso, ou null se não tem. */
  async perfilDe(email: string): Promise<Perfil | null> {
    if (!email) return null;
    if (this.fixos.has(email)) return 'admin';
    return (await this.ativos()).get(email)?.perfil ?? null;
  }

  async nomeDe(email: string): Promise<string | null> {
    return (await this.ativos()).get(email)?.nome ?? null;
  }

  async listar(): Promise<Usuario[]> {
    const linhas = ok(
      await this.db.from('painel_usuarios').select('email,nome,perfil,ativo,criado_em').order('nome'),
      'listar usuários',
    ) as { email: string; nome: string | null; perfil: string; ativo: boolean; criado_em: string }[];
    const contas = new Map((await this.auth.listar()).map((c) => [c.email, c]));
    const lista: Usuario[] = [];
    for (const f of [...this.fixos].sort()) {
      if (linhas.some((l) => l.email === f)) continue;
      const c = contas.get(f);
      lista.push({ email: f, nome: null, perfil: 'admin', ativo: true, fixo: true, situacao: c ? 'ativo' : 'aguardando', ultimoAcesso: c?.ultimoAcesso ?? null, criadoEm: null });
    }
    for (const l of linhas) {
      const c = contas.get(l.email);
      const fixo = this.fixos.has(l.email);
      lista.push({
        email: l.email, nome: l.nome, perfil: fixo ? 'admin' : normalizarPerfil(l.perfil), ativo: fixo || l.ativo, fixo,
        situacao: !(fixo || l.ativo) ? 'desativado' : c ? 'ativo' : 'aguardando', ultimoAcesso: c?.ultimoAcesso ?? null, criadoEm: l.criado_em,
      });
    }
    return lista;
  }

  async historico(limite = 50) {
    return ok(
      await this.db.from('painel_usuarios_log').select('em,por,acao,alvo,detalhes').order('em', { ascending: false }).limit(limite),
      'ler histórico de usuários',
    ) as { em: string; por: string; acao: string; alvo: string; detalhes: unknown }[];
  }

  private async registrar(por: string, acao: string, alvo: string, detalhes?: Record<string, unknown>) {
    ok(await this.db.from('painel_usuarios_log').insert({ por, acao, alvo, detalhes: detalhes ?? null }), 'registrar ação');
  }

  private async exigirAdmin(por: string) {
    if ((await this.perfilDe(por)) !== 'admin') throw new ErroUsuario(403, 'Só administradores podem gerenciar usuários.');
  }

  private async linha(email: string) {
    const r = ok(
      await this.db.from('painel_usuarios').select('email,nome,perfil,ativo').eq('email', email).limit(1),
      'ler usuário',
    ) as { email: string; nome: string | null; perfil: Perfil; ativo: boolean }[];
    return r[0];
  }

  private protegerFixo(email: string) {
    if (this.fixos.has(email)) throw new ErroUsuario(409, 'Este administrador é fixo (configurado no servidor) e não pode ser alterado pela tela.');
  }

  /** Quantos administradores continuam com acesso se `sem` perder o perfil/acesso. */
  private async adminsRestantes(sem: string) {
    const r = ok(
      await this.db.from('painel_usuarios').select('email').eq('perfil', 'admin').eq('ativo', true),
      'contar administradores',
    ) as { email: string }[];
    const todos = new Set([...this.fixos, ...r.map((x) => x.email)]);
    todos.delete(sem);
    return todos.size;
  }

  async criar(por: string, dados: { email?: unknown; nome?: unknown; perfil?: unknown }) {
    await this.exigirAdmin(por);
    const email = String(dados.email ?? '').trim().toLowerCase();
    const nome = String(dados.nome ?? '').trim();
    const perfil = String(dados.perfil ?? 'analista') as Perfil;
    if (!EMAIL_OK.test(email)) throw new ErroUsuario(400, 'Informe um e-mail válido.');
    if (nome.length < 2) throw new ErroUsuario(400, 'Informe o nome da pessoa.');
    if (!PERFIS.includes(perfil)) throw new ErroUsuario(400, 'Perfil inválido.');
    if (this.fixos.has(email)) throw new ErroUsuario(409, 'Este e-mail já é administrador fixo.');
    if (await this.linha(email)) throw new ErroUsuario(409, 'Já existe um usuário com este e-mail.');
    ok(await this.db.from('painel_usuarios').insert({ email, nome, perfil, ativo: true, criado_por: por }), 'criar usuário');
    await this.registrar(por, 'criar', email, { nome, perfil });
    this.invalidar(email);
  }

  async editar(por: string, alvo: string, dados: { nome?: unknown; perfil?: unknown; ativo?: unknown }) {
    await this.exigirAdmin(por);
    const email = alvo.toLowerCase();
    this.protegerFixo(email);
    const atual = await this.linha(email);
    if (!atual) throw new ErroUsuario(404, 'Usuário não encontrado.');

    const mudancas: Record<string, unknown> = {};
    if (dados.nome !== undefined) {
      const nome = String(dados.nome).trim();
      if (nome.length < 2) throw new ErroUsuario(400, 'Informe o nome da pessoa.');
      if (nome !== atual.nome) mudancas.nome = nome;
    }
    if (dados.perfil !== undefined) {
      const perfil = String(dados.perfil) as Perfil;
      if (!PERFIS.includes(perfil)) throw new ErroUsuario(400, 'Perfil inválido.');
      if (perfil !== atual.perfil) mudancas.perfil = perfil;
    }
    if (dados.ativo !== undefined && !!dados.ativo !== atual.ativo) mudancas.ativo = !!dados.ativo;
    if (!Object.keys(mudancas).length) return;

    const perdeAdmin = atual.perfil === 'admin' && atual.ativo && ((mudancas.perfil !== undefined && mudancas.perfil !== 'admin') || mudancas.ativo === false);
    if (email === por && (mudancas.perfil !== undefined || mudancas.ativo !== undefined)) {
      throw new ErroUsuario(409, 'Você não pode mudar o seu próprio perfil nem desativar a si mesmo. Peça a outro administrador.');
    }
    if (perdeAdmin && (await this.adminsRestantes(email)) < 1) throw new ErroUsuario(409, 'É preciso manter pelo menos um administrador.');

    ok(await this.db.from('painel_usuarios').update({ ...mudancas, atualizado_em: new Date().toISOString() }).eq('email', email), 'editar usuário');
    const acao = mudancas.ativo === false ? 'desativar' : mudancas.ativo === true ? 'reativar' : 'editar';
    await this.registrar(por, acao, email, { antes: { nome: atual.nome, perfil: atual.perfil, ativo: atual.ativo }, depois: mudancas });
    this.invalidar(email);
  }

  async redefinirSenha(por: string, alvo: string) {
    await this.exigirAdmin(por);
    const email = alvo.toLowerCase();
    this.protegerFixo(email);
    if (email === por) throw new ErroUsuario(409, 'Para trocar a sua própria senha, peça a outro administrador.');
    if (!(await this.linha(email))) throw new ErroUsuario(404, 'Usuário não encontrado.');
    const conta = (await this.auth.listar()).find((c) => c.email === email);
    if (conta) await this.auth.excluir(conta.id);
    await this.registrar(por, 'redefinir_senha', email, { tinha_conta: !!conta });
    this.invalidar(email);
  }

  async excluir(por: string, alvo: string, confirmacao: unknown) {
    await this.exigirAdmin(por);
    const email = alvo.toLowerCase();
    this.protegerFixo(email);
    if (email === por) throw new ErroUsuario(409, 'Você não pode excluir a si mesmo.');
    if (String(confirmacao ?? '').trim().toLowerCase() !== email) throw new ErroUsuario(400, 'Para excluir, digite o e-mail do usuário para confirmar.');
    const atual = await this.linha(email);
    if (!atual) throw new ErroUsuario(404, 'Usuário não encontrado.');
    if (atual.perfil === 'admin' && atual.ativo && (await this.adminsRestantes(email)) < 1) throw new ErroUsuario(409, 'É preciso manter pelo menos um administrador.');
    const conta = (await this.auth.listar()).find((c) => c.email === email);
    if (conta) await this.auth.excluir(conta.id);
    ok(await this.db.from('painel_usuarios').delete().eq('email', email), 'excluir usuário');
    await this.registrar(por, 'excluir', email, { nome: atual.nome, perfil: atual.perfil });
    this.invalidar(email);
  }
}
