import { Db, ok } from '../db';
import {
  Acesso, casarResponsavel, Escopo, idDoNome, MODULOS, MODULOS_CARTEIRA, moduloDoDepartamento, Perfil, perfilLegado,
  permissaoValida, permissoesEfetivas, TODAS_PERMISSOES,
} from './acesso';

/**
 * Gestão dos usuários do painel e do acesso de cada um (perfil, exceções e escopo de empresas).
 *
 * - Os e-mails de PAINEL_EMAILS são administradores fixos (configurados no servidor, não editáveis pela tela).
 * - Os demais ficam em painel_usuarios (nome, ativo) + acesso_usuarios (perfil, exceções, escopo).
 * - Ninguém define a senha de outra pessoa: o usuário criado entra pelo "Primeiro acesso".
 *   "Redefinir senha" apaga a conta de login para a pessoa criar uma nova senha do mesmo jeito.
 * - Regras de acesso (módulos, ações, rotas): acesso.ts.
 */

export type Situacao = 'ativo' | 'desativado' | 'aguardando';

export interface Usuario {
  email: string;
  nome: string | null;
  perfilId: string;
  perfilNome: string;
  escopo: Escopo;
  permissoesExtra: string[];
  permissoesRemovidas: string[];
  /** Empresas do escopo "lista" (ids). */
  empresas: string[];
  /** Quantas empresas a pessoa vê (null = todas). */
  empresasNoEscopo: number | null;
  permissoes: string[];
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
const ESCOPOS: Escopo[] = ['todas', 'carteira', 'lista'];
const LEGADO_PARA_PERFIL: Record<string, string> = { admin: 'administrador', supervisor: 'supervisor_fiscal', analista: 'analista_fiscal', consulta: 'consulta' };
const uniq = (l: string[]) => [...new Set(l)];

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

interface LinhaAcesso { email: string; perfil_id: string; escopo: Escopo; permissoes_extra: string[] | null; permissoes_removidas: string[] | null }
interface Estado {
  em: number;
  perfis: Map<string, Perfil>;
  modulosAtivos: Set<string>;
  /** Usuários ativos (inclui fixos). */
  acessos: Map<string, Acesso>;
}

export class GestaoUsuarios {
  private estado: Estado | null = null;
  private carregando: Promise<Estado> | null = null;

  constructor(
    private readonly db: Db,
    private readonly auth: AuthAdmin,
    private readonly fixos: Set<string>,
    /** Chamado quando o acesso de um e-mail muda (para derrubar sessões em cache). */
    private readonly aoMudar: (email: string) => void = () => {},
  ) {}

  /* ---------- leitura (cache de 1 min) ---------- */

  private async carregar(): Promise<Estado> {
    const [usu, ace, per, mod, lis, resp] = await Promise.all([
      this.db.from('painel_usuarios').select('email,nome,perfil,ativo').limit(5000),
      this.db.from('acesso_usuarios').select('email,perfil_id,escopo,permissoes_extra,permissoes_removidas').limit(5000),
      this.db.from('acesso_perfis').select('id,nome,descricao,permissoes,sistema,ordem').order('ordem').limit(500),
      this.db.from('escritorio_modulos').select('modulo,ativo').limit(100),
      this.db.from('acesso_usuario_empresas').select('email,empresa_id').limit(100000),
      this.db.from('empresa_responsaveis').select('email,empresa_id').limit(100000),
    ]);
    const perfis = new Map((ok(per, 'perfis') as Perfil[]).map((p) => [p.id, { ...p, permissoes: p.permissoes ?? [] }]));
    const modLinhas = ok(mod, 'módulos') as { modulo: string; ativo: boolean }[];
    // Módulo sem linha conta como ativo; administração nunca desliga
    const modulosAtivos = new Set(MODULOS.map((m) => m.id).filter((m) => m === 'administracao' || modLinhas.find((l) => l.modulo === m)?.ativo !== false));
    const acessoDe = new Map((ok(ace, 'acessos') as LinhaAcesso[]).map((a) => [a.email, a]));
    const porEmail = (linhas: { email: string; empresa_id: string }[]) => {
      const m = new Map<string, Set<string>>();
      for (const l of linhas) { const s = m.get(l.email) ?? new Set<string>(); s.add(l.empresa_id); m.set(l.email, s); }
      return m;
    };
    const lista = porEmail(ok(lis, 'empresas por usuário') as any[]);
    const carteira = porEmail(ok(resp, 'responsáveis') as any[]);

    const acessos = new Map<string, Acesso>();
    for (const f of this.fixos) {
      acessos.set(f, {
        email: f, nome: null, perfilId: 'administrador', perfilNome: 'Administrador (fixo)', fixo: true, escopo: 'todas', empresas: null,
        permissoes: permissoesEfetivas(TODAS_PERMISSOES, [], [], modulosAtivos),
      });
    }
    for (const u of ok(usu, 'usuários') as { email: string; nome: string | null; perfil: string; ativo: boolean }[]) {
      const email = String(u.email).toLowerCase();
      const fixo = acessos.get(email);
      if (fixo) { fixo.nome = u.nome ?? null; continue; }
      if (!u.ativo) continue;
      const a = acessoDe.get(email);
      const perfil = perfis.get(a?.perfil_id ?? LEGADO_PARA_PERFIL[u.perfil] ?? 'consulta') ?? perfis.get('consulta');
      const escopo: Escopo = a && ESCOPOS.includes(a.escopo) ? a.escopo : 'todas';
      acessos.set(email, {
        email, nome: u.nome ?? null, perfilId: perfil?.id ?? 'consulta', perfilNome: perfil?.nome ?? 'Consulta', fixo: false, escopo,
        empresas: escopo === 'todas' ? null : new Set((escopo === 'lista' ? lista : carteira).get(email) ?? []),
        permissoes: permissoesEfetivas(perfil?.permissoes ?? [], a?.permissoes_extra ?? [], a?.permissoes_removidas ?? [], modulosAtivos),
      });
    }
    return { em: Date.now(), perfis, modulosAtivos, acessos };
  }

  private async atual(): Promise<Estado> {
    if (this.estado && Date.now() - this.estado.em < 60_000) return this.estado;
    if (!this.carregando) {
      this.carregando = this.carregar().then((e) => { this.estado = e; return e; }).finally(() => { this.carregando = null; });
    }
    try {
      return await this.carregando;
    } catch (e) {
      if (this.estado) return this.estado; // banco fora: segue com o último acesso conhecido
      throw e;
    }
  }

  invalidar(email?: string) {
    this.estado = null;
    if (email) this.aoMudar(email);
  }

  /** Acesso de quem pode entrar, ou null. */
  async acessoDe(email: string): Promise<Acesso | null> {
    if (!email) return null;
    return (await this.atual()).acessos.get(email.toLowerCase()) ?? null;
  }

  async nomeDe(email: string): Promise<string | null> {
    return (await this.acessoDe(email))?.nome ?? null;
  }

  async modulosAtivos(): Promise<Set<string>> {
    return (await this.atual()).modulosAtivos;
  }

  async listar(): Promise<Usuario[]> {
    const [linhas, aces, lis] = await Promise.all([
      this.db.from('painel_usuarios').select('email,nome,perfil,ativo,criado_em').order('nome'),
      this.db.from('acesso_usuarios').select('email,perfil_id,escopo,permissoes_extra,permissoes_removidas').limit(5000),
      this.db.from('acesso_usuario_empresas').select('email,empresa_id').limit(100000),
    ]);
    const est = await this.atual();
    const ace = new Map((ok(aces, 'acessos') as LinhaAcesso[]).map((a) => [a.email, a]));
    const listaDe = new Map<string, string[]>();
    for (const l of ok(lis, 'empresas por usuário') as { email: string; empresa_id: string }[]) listaDe.set(l.email, [...(listaDe.get(l.email) ?? []), l.empresa_id]);
    const contas = new Map((await this.auth.listar()).map((c) => [c.email, c]));
    const rows = ok(linhas, 'listar usuários') as { email: string; nome: string | null; perfil: string; ativo: boolean; criado_em: string }[];
    const lista: Usuario[] = [];
    const base = (email: string) => {
      const c = contas.get(email);
      return { ultimoAcesso: c?.ultimoAcesso ?? null, temConta: !!c };
    };
    for (const f of [...this.fixos].sort()) {
      if (rows.some((l) => l.email === f)) continue;
      const a = est.acessos.get(f)!;
      const b = base(f);
      lista.push({ email: f, nome: null, perfilId: 'administrador', perfilNome: a.perfilNome, escopo: 'todas', permissoesExtra: [], permissoesRemovidas: [], empresas: [],
        empresasNoEscopo: null, permissoes: [...a.permissoes], ativo: true, fixo: true, situacao: b.temConta ? 'ativo' : 'aguardando', ultimoAcesso: b.ultimoAcesso, criadoEm: null });
    }
    for (const l of rows) {
      const fixo = this.fixos.has(l.email);
      const a = ace.get(l.email);
      const perfilId = fixo ? 'administrador' : a?.perfil_id ?? LEGADO_PARA_PERFIL[l.perfil] ?? 'consulta';
      const perfil = est.perfis.get(perfilId);
      const efetivo = est.acessos.get(l.email);
      const perms = efetivo ? [...efetivo.permissoes] : [...permissoesEfetivas(perfil?.permissoes ?? [], a?.permissoes_extra ?? [], a?.permissoes_removidas ?? [], est.modulosAtivos)];
      const b = base(l.email);
      lista.push({
        email: l.email, nome: l.nome, perfilId, perfilNome: fixo ? 'Administrador (fixo)' : perfil?.nome ?? perfilId,
        escopo: fixo ? 'todas' : a?.escopo ?? 'todas', permissoesExtra: fixo ? [] : a?.permissoes_extra ?? [], permissoesRemovidas: fixo ? [] : a?.permissoes_removidas ?? [],
        empresas: listaDe.get(l.email) ?? [], empresasNoEscopo: efetivo?.empresas ? efetivo.empresas.size : efetivo ? null : 0,
        permissoes: perms, ativo: fixo || l.ativo, fixo,
        situacao: !(fixo || l.ativo) ? 'desativado' : b.temConta ? 'ativo' : 'aguardando', ultimoAcesso: b.ultimoAcesso, criadoEm: l.criado_em,
      });
    }
    return lista;
  }

  async historico(limite = 50) {
    const [a, b] = await Promise.all([
      this.db.from('painel_usuarios_log').select('em,por,acao,alvo,detalhes').order('em', { ascending: false }).limit(limite),
      this.db.from('acesso_log').select('em,por,acao,alvo,detalhes').order('em', { ascending: false }).limit(limite),
    ]);
    const todos = [...(ok(a, 'histórico de usuários') as any[]), ...(ok(b, 'histórico de acesso') as any[])];
    return todos.sort((x, y) => String(y.em).localeCompare(String(x.em))).slice(0, limite) as { em: string; por: string; acao: string; alvo: string; detalhes: unknown }[];
  }

  /* ---------- escrita ---------- */

  private async registrar(por: string, acao: string, alvo: string, detalhes?: Record<string, unknown>) {
    ok(await this.db.from('painel_usuarios_log').insert({ por, acao, alvo, detalhes: detalhes ?? null }), 'registrar ação');
  }

  private async registrarAcesso(por: string, acao: string, alvo: string, detalhes?: Record<string, unknown>) {
    ok(await this.db.from('acesso_log').insert({ por, acao, alvo, detalhes: detalhes ?? null }), 'registrar mudança de acesso');
  }

  private async exigirAdmin(por: string) {
    if (!(await this.acessoDe(por))?.permissoes.has('administracao.usuarios')) {
      throw new ErroUsuario(403, 'Só quem administra usuários pode fazer isso.');
    }
  }

  private async linha(email: string) {
    const r = ok(await this.db.from('painel_usuarios').select('email,nome,perfil,ativo').eq('email', email).limit(1), 'ler usuário') as
      { email: string; nome: string | null; perfil: string; ativo: boolean }[];
    return r[0];
  }

  private async linhaAcesso(email: string): Promise<LinhaAcesso | undefined> {
    const r = ok(await this.db.from('acesso_usuarios').select('email,perfil_id,escopo,permissoes_extra,permissoes_removidas').eq('email', email).limit(1), 'ler acesso') as LinhaAcesso[];
    return r[0];
  }

  private protegerFixo(email: string) {
    if (this.fixos.has(email)) throw new ErroUsuario(409, 'Este administrador é fixo (configurado no servidor) e não pode ser alterado pela tela.');
  }

  /** Quem continua administrando usuários se `sem` perder o acesso (ou ficar com `novas` permissões). */
  private async adminsRestantes(sem: string) {
    const est = await this.atual();
    return [...est.acessos.values()].filter((a) => a.email !== sem && a.permissoes.has('administracao.usuarios')).length;
  }

  /** Valida e normaliza os dados de acesso enviados pela tela. */
  private async lerAcesso(dados: Record<string, unknown>, atual?: LinhaAcesso) {
    const est = await this.atual();
    const perfilId = dados.perfilId !== undefined ? String(dados.perfilId) : atual?.perfil_id ?? 'analista_fiscal';
    if (!est.perfis.has(perfilId)) throw new ErroUsuario(400, 'Perfil inválido.');
    const escopo = (dados.escopo !== undefined ? String(dados.escopo) : atual?.escopo ?? 'todas') as Escopo;
    if (!ESCOPOS.includes(escopo)) throw new ErroUsuario(400, 'Escopo de empresas inválido.');
    const lista = (v: unknown, padrao: string[] | null | undefined) => {
      if (v === undefined) return padrao ?? [];
      if (!Array.isArray(v)) throw new ErroUsuario(400, 'Lista de permissões inválida.');
      const l = uniq(v.map(String));
      const ruim = l.find((p) => !permissaoValida(p));
      if (ruim) throw new ErroUsuario(400, `Permissão desconhecida: ${ruim}.`);
      return l;
    };
    const extras = lista(dados.permissoesExtra, atual?.permissoes_extra);
    const removidas = lista(dados.permissoesRemovidas, atual?.permissoes_removidas);
    const perfil = est.perfis.get(perfilId)!;
    // Exceção só faz sentido contra o perfil: dar o que ele não tem, tirar o que ele tem
    const extrasLimpos = extras.filter((p) => !perfil.permissoes.includes(p));
    const removidasLimpas = removidas.filter((p) => perfil.permissoes.includes(p));
    let empresas: string[] | undefined;
    if (dados.empresas !== undefined) {
      if (!Array.isArray(dados.empresas)) throw new ErroUsuario(400, 'Lista de empresas inválida.');
      empresas = uniq(dados.empresas.map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x)));
    }
    if (escopo === 'lista' && empresas !== undefined && !empresas.length) throw new ErroUsuario(400, 'Escolha ao menos uma empresa para o escopo "lista".');
    return { perfilId, escopo, extras: extrasLimpos, removidas: removidasLimpas, empresas, efetivas: permissoesEfetivas(perfil.permissoes, extrasLimpos, removidasLimpas, est.modulosAtivos) };
  }

  private async gravarListaEmpresas(email: string, empresas: string[]) {
    ok(await this.db.from('acesso_usuario_empresas').delete().eq('email', email), 'limpar empresas do usuário');
    for (let i = 0; i < empresas.length; i += 500) {
      ok(await this.db.from('acesso_usuario_empresas').insert(empresas.slice(i, i + 500).map((empresa_id) => ({ email, empresa_id }))), 'gravar empresas do usuário');
    }
  }

  async criar(por: string, dados: Record<string, unknown>) {
    await this.exigirAdmin(por);
    const email = String(dados.email ?? '').trim().toLowerCase();
    const nome = String(dados.nome ?? '').trim();
    if (!EMAIL_OK.test(email)) throw new ErroUsuario(400, 'Informe um e-mail válido.');
    if (nome.length < 2) throw new ErroUsuario(400, 'Informe o nome da pessoa.');
    // Compatibilidade: a tela antiga mandava "perfil" (admin/supervisor/analista/consulta)
    if (dados.perfilId === undefined && typeof dados.perfil === 'string') dados = { ...dados, perfilId: LEGADO_PARA_PERFIL[dados.perfil] ?? dados.perfil };
    const ac = await this.lerAcesso(dados);
    if (this.fixos.has(email)) throw new ErroUsuario(409, 'Este e-mail já é administrador fixo.');
    if (await this.linha(email)) throw new ErroUsuario(409, 'Já existe um usuário com este e-mail.');
    ok(await this.db.from('painel_usuarios').insert({ email, nome, perfil: perfilLegado(ac.efetivas), ativo: true, criado_por: por }), 'criar usuário');
    ok(await this.db.from('acesso_usuarios').insert({
      email, perfil_id: ac.perfilId, escopo: ac.escopo, permissoes_extra: ac.extras, permissoes_removidas: ac.removidas, atualizado_por: por,
    }), 'criar acesso');
    if (ac.empresas?.length) await this.gravarListaEmpresas(email, ac.empresas);
    await this.registrar(por, 'criar', email, { nome, perfil: ac.perfilId, escopo: ac.escopo, extras: ac.extras, removidas: ac.removidas, empresas: ac.empresas?.length ?? 0 });
    this.invalidar(email);
  }

  async editar(por: string, alvo: string, dados: Record<string, unknown>) {
    await this.exigirAdmin(por);
    const email = alvo.toLowerCase();
    this.protegerFixo(email);
    const atual = await this.linha(email);
    if (!atual) throw new ErroUsuario(404, 'Usuário não encontrado.');
    if (dados.perfilId === undefined && typeof dados.perfil === 'string') dados = { ...dados, perfilId: LEGADO_PARA_PERFIL[dados.perfil] ?? dados.perfil };
    const acAtual = await this.linhaAcesso(email);

    const mudancas: Record<string, unknown> = {};
    if (dados.nome !== undefined) {
      const nome = String(dados.nome).trim();
      if (nome.length < 2) throw new ErroUsuario(400, 'Informe o nome da pessoa.');
      if (nome !== atual.nome) mudancas.nome = nome;
    }
    if (dados.ativo !== undefined && !!dados.ativo !== atual.ativo) mudancas.ativo = !!dados.ativo;

    const tocaAcesso = ['perfilId', 'escopo', 'permissoesExtra', 'permissoesRemovidas', 'empresas'].some((k) => dados[k] !== undefined);
    const ac = tocaAcesso || !acAtual ? await this.lerAcesso(dados, acAtual ?? { email, perfil_id: LEGADO_PARA_PERFIL[atual.perfil] ?? 'consulta', escopo: 'todas', permissoes_extra: [], permissoes_removidas: [] }) : null;
    const antesEfetivas = (await this.acessoDe(email))?.permissoes ?? new Set<string>();
    const acessoMudou = !!ac && (!acAtual || ac.perfilId !== acAtual.perfil_id || ac.escopo !== acAtual.escopo
      || JSON.stringify([...ac.extras].sort()) !== JSON.stringify([...(acAtual.permissoes_extra ?? [])].sort())
      || JSON.stringify([...ac.removidas].sort()) !== JSON.stringify([...(acAtual.permissoes_removidas ?? [])].sort())
      || ac.empresas !== undefined);
    if (!Object.keys(mudancas).length && !acessoMudou) return;

    if (email === por && (acessoMudou || mudancas.ativo !== undefined)) {
      throw new ErroUsuario(409, 'Você não pode mudar o seu próprio acesso nem desativar a si mesmo. Peça a outro administrador.');
    }
    const eraAdmin = atual.ativo && antesEfetivas.has('administracao.usuarios');
    const continuaAdmin = mudancas.ativo !== false && (ac ? ac.efetivas.has('administracao.usuarios') : eraAdmin);
    if (eraAdmin && !continuaAdmin && (await this.adminsRestantes(email)) < 1) throw new ErroUsuario(409, 'É preciso manter pelo menos um administrador.');

    if (ac) mudancas.perfil = perfilLegado(ac.efetivas);
    if (Object.keys(mudancas).length) ok(await this.db.from('painel_usuarios').update({ ...mudancas, atualizado_em: new Date().toISOString() }).eq('email', email), 'editar usuário');
    if (ac && acessoMudou) {
      ok(await this.db.from('acesso_usuarios').upsert({
        email, perfil_id: ac.perfilId, escopo: ac.escopo, permissoes_extra: ac.extras, permissoes_removidas: ac.removidas,
        atualizado_em: new Date().toISOString(), atualizado_por: por,
      }, { onConflict: 'email' }), 'gravar acesso');
      if (ac.empresas !== undefined) await this.gravarListaEmpresas(email, ac.escopo === 'lista' ? ac.empresas : []);
    }
    const acao = mudancas.ativo === false ? 'desativar' : mudancas.ativo === true ? 'reativar' : 'editar';
    await this.registrar(por, acao, email, {
      antes: { nome: atual.nome, ativo: atual.ativo, perfil: acAtual?.perfil_id ?? atual.perfil, escopo: acAtual?.escopo ?? 'todas', extras: acAtual?.permissoes_extra ?? [], removidas: acAtual?.permissoes_removidas ?? [] },
      depois: { ...mudancas, ...(ac && acessoMudou ? { perfil: ac.perfilId, escopo: ac.escopo, extras: ac.extras, removidas: ac.removidas, empresas: ac.empresas?.length } : {}) },
    });
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
    const eraAdmin = atual.ativo && (await this.acessoDe(email))?.permissoes.has('administracao.usuarios');
    if (eraAdmin && (await this.adminsRestantes(email)) < 1) throw new ErroUsuario(409, 'É preciso manter pelo menos um administrador.');
    const conta = (await this.auth.listar()).find((c) => c.email === email);
    if (conta) await this.auth.excluir(conta.id);
    ok(await this.db.from('empresa_responsaveis').delete().eq('email', email), 'tirar das carteiras');
    ok(await this.db.from('painel_usuarios').delete().eq('email', email), 'excluir usuário');
    await this.registrar(por, 'excluir', email, { nome: atual.nome, perfil: atual.perfil });
    this.invalidar(email);
  }

  /* ---------- perfis ---------- */

  async perfis(): Promise<(Perfil & { usuarios: number })[]> {
    const est = await this.atual();
    const uso = ok(await this.db.from('acesso_usuarios').select('perfil_id').limit(5000), 'uso dos perfis') as { perfil_id: string }[];
    return [...est.perfis.values()].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))
      .map((p) => ({ ...p, usuarios: uso.filter((u) => u.perfil_id === p.id).length }));
  }

  /** Cria (sem id) ou edita um perfil. Os perfis de sistema não mudam: duplique e edite a cópia. */
  async salvarPerfil(por: string, dados: Record<string, unknown>) {
    await this.exigirAdmin(por);
    const est = await this.atual();
    const nome = String(dados.nome ?? '').trim();
    const descricao = dados.descricao == null ? null : String(dados.descricao).trim().slice(0, 300) || null;
    if (nome.length < 2 || nome.length > 60) throw new ErroUsuario(400, 'Dê um nome ao perfil (2 a 60 letras).');
    if (!Array.isArray(dados.permissoes)) throw new ErroUsuario(400, 'Marque as permissões do perfil.');
    const permissoes = uniq(dados.permissoes.map(String));
    const ruim = permissoes.find((p) => !permissaoValida(p));
    if (ruim) throw new ErroUsuario(400, `Permissão desconhecida: ${ruim}.`);
    if (!permissoes.length) throw new ErroUsuario(400, 'O perfil precisa de ao menos uma permissão.');
    const outroComNome = [...est.perfis.values()].find((p) => p.nome.toLowerCase() === nome.toLowerCase() && p.id !== dados.id);
    if (outroComNome) throw new ErroUsuario(409, `Já existe o perfil "${outroComNome.nome}".`);
    const agora = new Date().toISOString();

    if (dados.id) {
      const id = String(dados.id);
      const atual = est.perfis.get(id);
      if (!atual) throw new ErroUsuario(404, 'Perfil não encontrado.');
      if (atual.sistema) throw new ErroUsuario(409, 'Perfis prontos não são alterados. Use "Duplicar" e edite a cópia.');
      // Não deixar o escritório sem administrador por mudança de perfil
      if (atual.permissoes.includes('administracao.usuarios') && !permissoes.includes('administracao.usuarios')) {
        const usam = new Set((ok(await this.db.from('acesso_usuarios').select('email').eq('perfil_id', id).limit(5000), 'quem usa') as { email: string }[]).map((x) => x.email));
        const restantes = [...est.acessos.values()].filter((a) => !usam.has(a.email) && a.permissoes.has('administracao.usuarios')).length;
        if (restantes < 1) throw new ErroUsuario(409, 'É preciso manter pelo menos um administrador.');
      }
      ok(await this.db.from('acesso_perfis').update({ nome, descricao, permissoes, atualizado_em: agora, atualizado_por: por }).eq('id', id), 'editar perfil');
      await this.registrarAcesso(por, 'perfil_editar', id, { antes: { nome: atual.nome, permissoes: atual.permissoes }, depois: { nome, permissoes } });
      const usam = ok(await this.db.from('acesso_usuarios').select('email').eq('perfil_id', id).limit(5000), 'quem usa') as { email: string }[];
      this.invalidar();
      for (const u of usam) this.aoMudar(u.email);
      return { id };
    }
    let id = idDoNome(nome);
    for (let n = 2; est.perfis.has(id); n++) id = `${idDoNome(nome).slice(0, 36)}_${n}`;
    ok(await this.db.from('acesso_perfis').insert({ id, nome, descricao, permissoes, sistema: false, ordem: 100, atualizado_por: por }), 'criar perfil');
    await this.registrarAcesso(por, 'perfil_criar', id, { nome, permissoes });
    this.invalidar();
    return { id };
  }

  async excluirPerfil(por: string, id: string) {
    await this.exigirAdmin(por);
    const p = (await this.atual()).perfis.get(id);
    if (!p) throw new ErroUsuario(404, 'Perfil não encontrado.');
    if (p.sistema) throw new ErroUsuario(409, 'Perfis prontos não podem ser excluídos.');
    const usam = ok(await this.db.from('acesso_usuarios').select('email').eq('perfil_id', id).limit(1), 'quem usa') as unknown[];
    if (usam.length) throw new ErroUsuario(409, 'Há usuários com este perfil. Troque o perfil deles antes de excluir.');
    ok(await this.db.from('acesso_perfis').delete().eq('id', id), 'excluir perfil');
    await this.registrarAcesso(por, 'perfil_excluir', id, { nome: p.nome, permissoes: p.permissoes });
    this.invalidar();
  }

  /* ---------- módulos contratados ---------- */

  async modulos() {
    const ativos = await this.modulosAtivos();
    return MODULOS.map((m) => ({ ...m, ativo: ativos.has(m.id) }));
  }

  async definirModulo(por: string, modulo: string, ativo: boolean) {
    await this.exigirAdmin(por);
    if (!MODULOS.some((m) => m.id === modulo)) throw new ErroUsuario(404, 'Módulo desconhecido.');
    if (modulo === 'administracao') throw new ErroUsuario(409, 'A administração não pode ser desligada.');
    ok(await this.db.from('escritorio_modulos').upsert({ modulo, ativo, atualizado_em: new Date().toISOString(), atualizado_por: por }, { onConflict: 'modulo' }), 'gravar módulo');
    await this.registrarAcesso(por, ativo ? 'modulo_ligar' : 'modulo_desligar', modulo);
    const todos = [...(await this.atual()).acessos.keys()];
    this.invalidar();
    for (const e of todos) this.aoMudar(e);
  }

  /* ---------- responsáveis (carteira) ---------- */

  async responsaveis() {
    const [emps, resp] = await Promise.all([
      this.db.from('empresas').select('id,cnpj,razao_social,ativo').order('razao_social').limit(10000),
      this.db.from('empresa_responsaveis').select('empresa_id,modulo,email,origem').limit(100000),
    ]);
    const est = await this.atual();
    const usuarios = [...est.acessos.values()].map((a) => ({ email: a.email, nome: a.nome, escopo: a.escopo }))
      .sort((a, b) => (a.nome ?? a.email).localeCompare(b.nome ?? b.email));
    const porEmp = new Map<string, Record<string, string[]>>();
    for (const r of ok(resp, 'responsáveis') as { empresa_id: string; modulo: string; email: string }[]) {
      const m = porEmp.get(r.empresa_id) ?? {};
      (m[r.modulo] ??= []).push(r.email);
      porEmp.set(r.empresa_id, m);
    }
    return {
      modulos: MODULOS.filter((m) => MODULOS_CARTEIRA.includes(m.id) && est.modulosAtivos.has(m.id)).map((m) => ({ id: m.id, nome: m.nome, disponivel: m.disponivel })),
      usuarios,
      empresas: (ok(emps, 'empresas') as any[]).map((e) => ({ id: e.id, cnpj: e.cnpj, razaoSocial: e.razao_social, ativo: e.ativo, responsaveis: porEmp.get(e.id) ?? {} })),
    };
  }

  /** Define os responsáveis de várias empresas num módulo (substitui os anteriores daquele módulo). */
  async definirResponsaveis(por: string, dados: Record<string, unknown>) {
    await this.exigirAdmin(por);
    const modulo = String(dados.modulo ?? '');
    if (!MODULOS_CARTEIRA.includes(modulo)) throw new ErroUsuario(400, 'Módulo inválido.');
    const empresas = Array.isArray(dados.empresas) ? uniq(dados.empresas.map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x))) : [];
    if (!empresas.length) throw new ErroUsuario(400, 'Escolha ao menos uma empresa.');
    const est = await this.atual();
    const emails = Array.isArray(dados.emails) ? uniq(dados.emails.map((x) => String(x).toLowerCase())) : [];
    const desconhecido = emails.find((e) => !est.acessos.has(e));
    if (desconhecido) throw new ErroUsuario(400, `Usuário sem acesso ativo: ${desconhecido}.`);
    const origem = dados.origem === 'acessorias' ? 'acessorias' : 'manual';
    for (let i = 0; i < empresas.length; i += 200) {
      ok(await this.db.from('empresa_responsaveis').delete().eq('modulo', modulo).in('empresa_id', empresas.slice(i, i + 200)), 'limpar responsáveis');
    }
    const linhas = empresas.flatMap((empresa_id) => emails.map((email) => ({ empresa_id, modulo, email, origem, criado_por: por })));
    for (let i = 0; i < linhas.length; i += 500) ok(await this.db.from('empresa_responsaveis').insert(linhas.slice(i, i + 500)), 'gravar responsáveis');
    await this.registrarAcesso(por, 'responsaveis', modulo, { empresas: empresas.length, emails, origem });
    this.invalidar();
    for (const e of emails) this.aoMudar(e);
    return { empresas: empresas.length, responsaveis: emails.length };
  }

  /**
   * Sugestões de responsáveis a partir das entregas do Acessórias (departamento + responsável de cada obrigação).
   * Só sugere: o administrador confere e aplica. Nome sem usuário correspondente vem como "sem usuário".
   */
  async sugestoesAcessorias() {
    const est = await this.atual();
    const usuarios = [...est.acessos.values()].map((a) => ({ email: a.email, nome: a.nome }));
    const [ent, emps, resp] = await Promise.all([
      this.db.from('acessorias_entregas').select('empresa_id,competencia,entregas').order('competencia', { ascending: false }).limit(20000),
      this.db.from('empresas').select('id,cnpj,razao_social').limit(10000),
      this.db.from('empresa_responsaveis').select('empresa_id,modulo,email').limit(100000),
    ]);
    const nomeEmp = new Map((ok(emps, 'empresas') as any[]).map((e) => [e.id, e]));
    const ja = new Set((ok(resp, 'responsáveis') as any[]).map((r) => `${r.empresa_id}|${r.modulo}|${r.email}`));
    // Por empresa e módulo, o responsável que mais aparece nas entregas (das competências mais recentes)
    const conta = new Map<string, Map<string, number>>();
    for (const l of ok(ent, 'entregas do Acessórias') as { empresa_id: string; competencia: string; entregas: any[] }[]) {
      for (const e of Array.isArray(l.entregas) ? l.entregas : []) {
        const modulo = moduloDoDepartamento(e?.departamento);
        const nome = String(e?.responsavel ?? '').trim();
        if (!modulo || !nome || !est.modulosAtivos.has(modulo)) continue;
        const k = `${l.empresa_id}|${modulo}`;
        const m = conta.get(k) ?? new Map<string, number>();
        m.set(nome, (m.get(nome) ?? 0) + 1);
        conta.set(k, m);
      }
    }
    const sugestoes: { empresaId: string; razaoSocial: string; cnpj: string; modulo: string; nomeAcessorias: string; email: string | null; jaDefinido: boolean }[] = [];
    for (const [k, m] of conta) {
      const [empresaId, modulo] = k.split('|');
      const e = nomeEmp.get(empresaId);
      if (!e) continue;
      const [nome] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      const email = casarResponsavel(nome, usuarios);
      sugestoes.push({ empresaId, razaoSocial: e.razao_social, cnpj: e.cnpj, modulo, nomeAcessorias: nome, email, jaDefinido: !!email && ja.has(`${empresaId}|${modulo}|${email}`) });
    }
    sugestoes.sort((a, b) => a.razaoSocial.localeCompare(b.razaoSocial) || a.modulo.localeCompare(b.modulo));
    return { sugestoes, semUsuario: [...new Set(sugestoes.filter((s) => !s.email).map((s) => s.nomeAcessorias))].sort() };
  }

  /** Aplica as sugestões escolhidas (acrescenta; não tira responsáveis já definidos). */
  async aplicarSugestoes(por: string, itens: unknown) {
    await this.exigirAdmin(por);
    const est = await this.atual();
    if (!Array.isArray(itens) || !itens.length) throw new ErroUsuario(400, 'Escolha ao menos uma sugestão.');
    const linhas = uniq(itens.map((i: any) => `${String(i?.empresaId ?? '')}|${String(i?.modulo ?? '')}|${String(i?.email ?? '').toLowerCase()}`))
      .map((k) => { const [empresa_id, modulo, email] = k.split('|'); return { empresa_id, modulo, email }; })
      .filter((l) => /^[0-9a-f-]{36}$/.test(l.empresa_id) && MODULOS_CARTEIRA.includes(l.modulo) && est.acessos.has(l.email));
    if (!linhas.length) throw new ErroUsuario(400, 'Nenhuma sugestão válida.');
    for (let i = 0; i < linhas.length; i += 500) {
      ok(await this.db.from('empresa_responsaveis').upsert(linhas.slice(i, i + 500).map((l) => ({ ...l, origem: 'acessorias', criado_por: por })), { onConflict: 'empresa_id,modulo,email' }), 'gravar responsáveis');
    }
    await this.registrarAcesso(por, 'responsaveis', 'acessorias', { aplicadas: linhas.length });
    this.invalidar();
    for (const e of uniq(linhas.map((l) => l.email))) this.aoMudar(e);
    return { aplicadas: linhas.length };
  }
}
