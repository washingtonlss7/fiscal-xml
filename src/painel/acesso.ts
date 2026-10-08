/**
 * Permissões do painel: um login só, e o perfil decide o que cada pessoa vê e faz.
 *
 *   permissão = "<módulo>.<ação>"   ex.: fiscal.ver, fiscal.transmitir, folha.operar, administracao.usuarios
 *   perfil    = lista de permissões (tabela acesso_perfis; os de sistema vêm prontos e podem ser copiados)
 *   usuário   = perfil + exceções (dar/tirar) + escopo de empresas: todas | carteira (é responsável) | lista
 *
 * O servidor confere em toda chamada: a rota exige uma permissão (exigenciaDaRota) e, quando é de uma empresa,
 * a empresa precisa estar no escopo (empresaDaRota). Rota nova sem regra cai no padrão do fiscal
 * (leitura → fiscal.ver; gravação → fiscal.operar), então nunca fica aberta por engano.
 * Sem banco aqui: só regras, para testar isoladamente.
 */

export type Escopo = 'todas' | 'carteira' | 'lista';

export interface Modulo {
  id: string;
  nome: string;
  descricao: string;
  /** Já tem telas no Appura (os demais aparecem como "Em breve"). */
  disponivel: boolean;
  acoes: { id: string; nome: string; descricao: string }[];
}

const A = {
  ver: { id: 'ver', nome: 'Ver', descricao: 'Abrir as telas, consultar e baixar' },
  operar: { id: 'operar', nome: 'Operar', descricao: 'Trabalho do dia a dia: lançar, importar, conferir, ajustar' },
  fechar: { id: 'fechar', nome: 'Fechar', descricao: 'Concluir e reabrir a competência' },
  transmitir: { id: 'transmitir', nome: 'Transmitir', descricao: 'Entregar declarações oficiais (Receita, eSocial, SEFAZ)' },
  configurar: { id: 'configurar', nome: 'Configurar', descricao: 'Tabelas e regras do módulo' },
};

export const MODULOS: Modulo[] = [
  { id: 'captacao', nome: 'Captação e notas', descricao: 'Busca de XML na SEFAZ, Appura Coletor, importação, notas fiscais e downloads.', disponivel: true,
    acoes: [A.ver, { ...A.operar, descricao: 'Sincronizar com a SEFAZ e importar XML' }] },
  { id: 'fiscal', nome: 'Fiscal', descricao: 'Fechamento, auditoria, ICMS-ST, SPED/SINTEGRA, apuração, guias e documentos (Escrita Fiscal).', disponivel: true,
    acoes: [A.ver, A.operar, { ...A.transmitir, descricao: 'Transmitir o PGDAS-D' }, { ...A.configurar, descricao: 'Tabela de ICMS-ST' }] },
  { id: 'contabil', nome: 'Contábil', descricao: 'Lançamentos, conciliação, balancete, patrimônio e Lalur (Contabilidade).', disponivel: false,
    acoes: [A.ver, A.operar, A.fechar, A.transmitir, A.configurar] },
  { id: 'folha', nome: 'Folha', descricao: 'Folha de pagamento, férias, rescisões e eSocial. Dados de salário: acesso restrito.', disponivel: false,
    acoes: [A.ver, A.operar, A.fechar, A.transmitir, A.configurar] },
  { id: 'societario', nome: 'Societário', descricao: 'Abertura, alterações, certidões e alvarás (Registro/Legalização).', disponivel: false,
    acoes: [A.ver, A.operar, A.configurar] },
  { id: 'financeiro', nome: 'Financeiro do escritório', descricao: 'Honorários, contratos e cobrança dos clientes.', disponivel: false,
    acoes: [A.ver, A.operar, A.configurar] },
  { id: 'administracao', nome: 'Administração', descricao: 'Administração do Appura.', disponivel: true,
    acoes: [
      { id: 'usuarios', nome: 'Usuários e perfis', descricao: 'Criar usuários, perfis, escopo e responsáveis' },
      { id: 'empresas', nome: 'Empresas e certificados', descricao: 'Cadastrar empresas e certificados, pausar, aprovar cadastros, Appura Coletor' },
      { id: 'configuracoes', nome: 'Configurações', descricao: 'Integrações (API), SERPRO, Acessórias' },
    ] },
];

export const TODAS_PERMISSOES: string[] = MODULOS.flatMap((m) => m.acoes.map((a) => `${m.id}.${a.id}`));
const VALIDAS = new Set(TODAS_PERMISSOES);
export const permissaoValida = (p: string) => VALIDAS.has(p);
export const moduloDe = (p: string) => p.slice(0, p.indexOf('.'));

/** Módulos que dá para usar como "carteira" (responsável por empresa). */
export const MODULOS_CARTEIRA = MODULOS.filter((m) => m.id !== 'administracao' && m.id !== 'financeiro').map((m) => m.id);

/** Permissões do perfil + extras − removidas, só das válidas e de módulos ativos no escritório. */
export function permissoesEfetivas(doPerfil: string[], extras: string[] = [], removidas: string[] = [], modulosAtivos?: Set<string>): Set<string> {
  const tirar = new Set(removidas);
  const r = new Set<string>();
  for (const p of [...doPerfil, ...extras]) {
    if (!VALIDAS.has(p) || tirar.has(p)) continue;
    if (modulosAtivos && !modulosAtivos.has(moduloDe(p))) continue;
    r.add(p);
  }
  return r;
}

export interface Acesso {
  email: string;
  nome: string | null;
  perfilId: string;
  perfilNome: string;
  /** Administrador fixo do servidor (PAINEL_EMAILS): tudo, sem restrição de empresa. */
  fixo: boolean;
  permissoes: Set<string>;
  escopo: Escopo;
  /** Empresas que a pessoa vê; null = todas. */
  empresas: Set<string> | null;
}

export const pode = (a: Acesso, p: string) => a.permissoes.has(p);
export const algumVer = (a: Acesso) => [...a.permissoes].some((p) => p.endsWith('.ver'));
export const podeEmpresa = (a: Acesso, id: string | null | undefined) => !id || a.empresas === null || a.empresas.has(id);
/** Lista de ids para filtrar no banco (undefined = sem filtro). */
export const idsDoEscopo = (a: Acesso) => (a.empresas === null ? undefined : [...a.empresas]);
/** Filtra uma lista pelo escopo, lendo o id da empresa de cada item. */
export function noEscopo<T>(a: Acesso, lista: T[], id: (x: T) => string | null | undefined): T[] {
  if (a.empresas === null) return lista;
  return lista.filter((x) => { const i = id(x); return !!i && a.empresas!.has(i); });
}

/* ---------- o que cada rota exige ---------- */

/** 'algum.ver' = ver em qualquer módulo (telas comuns: lista de empresas, Empresa 360°). null = só estar logado. */
export type Exigencia = string | 'algum.ver' | null;

const UUID = '[0-9a-f-]{36}';
const re = (s: string) => new RegExp(`^${s.replace(/:id/g, UUID)}$`);

export function exigenciaDaRota(metodo: string, rota: string): Exigencia {
  const le = metodo === 'GET' || metodo === 'HEAD';
  // Do próprio usuário
  if (rota === '/api/eu' || rota === '/api/eventos') return null;
  if (rota === '/api/mcp/conexoes' || rota === '/api/mcp/tokens' || rota.startsWith('/api/mcp/conexoes/')) return null;

  // Administração
  if (rota === '/api/usuarios' || rota.startsWith('/api/usuarios/')) return 'administracao.usuarios';
  if (rota === '/api/acesso' || rota.startsWith('/api/acesso/')) return 'administracao.usuarios';
  if (rota === '/api/mcp/uso') return 'administracao.usuarios';
  if (rota === '/api/integracoes' || rota.startsWith('/api/integracoes/')) return 'administracao.configuracoes';
  if (rota === '/api/guias/testar' || rota === '/api/guias/chaves' || rota === '/api/acessorias' || rota === '/api/acessorias/testar') return 'administracao.configuracoes';
  if (rota === '/api/st-es/tabela') return 'fiscal.configurar';
  if (rota === '/api/empresas') return le ? 'algum.ver' : 'administracao.empresas';
  if (re('/api/empresas/:id/ativo').test(rota)) return 'administracao.empresas';
  if (re('/api/empresas/:id/cadastro').test(rota)) return le ? 'algum.ver' : 'administracao.empresas';
  if (rota.startsWith('/api/cadastros/')) return 'administracao.empresas';
  if (rota === '/api/coletores' || rota.startsWith('/api/coletores/')) return le ? 'captacao.ver' : 'administracao.empresas';

  // Comuns
  if (re('/api/empresas/:id/360').test(rota)) return 'algum.ver';

  // Captação e notas
  if (rota.startsWith('/api/captacao/')) return le ? 'captacao.ver' : 'captacao.operar';
  if (re('/api/empresas/:id/(sincronizar|importar)').test(rota)) return 'captacao.operar';
  if (re('/api/empresas/:id/(sincronizacao|rejeitadas|notas|xml|zip)').test(rota)) return 'captacao.ver';
  // Busca e download de XML: leitura, mesmo sendo POST
  if (rota === '/api/xml/busca' || rota === '/api/xml/zip' || rota === '/api/xml/excel') return 'captacao.ver';

  // Fiscal
  if (/^\/api\/apuracao\/\d+\/transmitir$/.test(rota)) return 'fiscal.transmitir';
  return le ? 'fiscal.ver' : 'fiscal.operar';
}

/** Empresa (ou registro de uma empresa) que a rota acessa, para conferir o escopo. */
export type AlvoEmpresa = { empresa: string } | { tabela: string; id: number } | null;

const POR_REGISTRO: [RegExp, string][] = [
  [/^\/api\/apontamentos\/(\d+)$/, 'apontamentos'],
  [/^\/api\/sped\/(\d+)\//, 'sped_arquivos'],
  [/^\/api\/apuracao\/ajustes\/(\d+)$/, 'apuracao_ajustes'],
  [/^\/api\/apuracao\/(\d+)\//, 'apuracoes_simples'],
  [/^\/api\/sped-gerado\/(\d+)\//, 'sped_gerados'],
  [/^\/api\/documentos\/(\d+)/, 'documentos_entrega'],
  [/^\/api\/guias\/(\d+)\//, 'guias'],
];

export function empresaDaRota(rota: string): AlvoEmpresa {
  const m = rota.match(/^\/api\/empresas\/([0-9a-f-]{36})(\/|$)/);
  if (m) return { empresa: m[1] };
  for (const [r, tabela] of POR_REGISTRO) {
    const x = rota.match(r);
    if (x) return { tabela, id: Number(x[1]) };
  }
  return null;
}

/* ---------- perfis ---------- */

export interface Perfil {
  id: string;
  nome: string;
  descricao: string | null;
  permissoes: string[];
  sistema: boolean;
  ordem: number;
}

/** Compatibilidade com a coluna antiga painel_usuarios.perfil (ainda gravada para rollback). */
export function perfilLegado(permissoes: Set<string>): 'admin' | 'supervisor' | 'analista' | 'consulta' {
  if (permissoes.has('administracao.usuarios')) return 'admin';
  if (permissoes.has('fiscal.transmitir')) return 'supervisor';
  if ([...permissoes].some((p) => !p.endsWith('.ver'))) return 'analista';
  return 'consulta';
}

/** id de perfil a partir do nome: "Analista Fiscal II" → "analista_fiscal_ii". */
export function idDoNome(nome: string): string {
  const base = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
  return /^[a-z]/.test(base) ? base : `p_${base}`.slice(0, 40);
}

/* ---------- sugestão de responsáveis pelo Acessórias ---------- */

/** Departamento do Acessórias → módulo do Appura. */
export function moduloDoDepartamento(dep: string | null | undefined): string | null {
  const d = String(dep ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (!d) return null;
  if (/fisc|tribut/.test(d)) return 'fiscal';
  if (/contab|contabil/.test(d)) return 'contabil';
  if (/pessoal|folha|\bdp\b|rh|trabalh/.test(d)) return 'folha';
  if (/societ|legal|registro|paralegal/.test(d)) return 'societario';
  return null;
}

/** Nome comparável: sem acento, minúsculo, só letras e espaços. */
export const nomeComparavel = (s: string | null | undefined) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * Casa o nome do responsável do Acessórias com um usuário do Appura: nome igual, ou mesmo primeiro nome e
 * último sobrenome. Mais de um candidato = não casa (fica para o administrador escolher).
 */
export function casarResponsavel(nome: string, usuarios: { email: string; nome: string | null }[]): string | null {
  const n = nomeComparavel(nome);
  if (!n) return null;
  const iguais = usuarios.filter((u) => nomeComparavel(u.nome) === n);
  if (iguais.length === 1) return iguais[0].email;
  if (iguais.length > 1) return null;
  const p = n.split(' ');
  const parecidos = usuarios.filter((u) => {
    const q = nomeComparavel(u.nome).split(' ');
    return q.length > 1 && p.length > 1 && q[0] === p[0] && q[q.length - 1] === p[p.length - 1];
  });
  return parecidos.length === 1 ? parecidos[0].email : null;
}

/** Perfis prontos (os mesmos da migration 0042; o teste confere que não divergem). */
const MODULOS_DE_TRABALHO = ['captacao', 'fiscal', 'contabil', 'folha', 'societario', 'financeiro'];
const doTrabalho = TODAS_PERMISSOES.filter((p) => MODULOS_DE_TRABALHO.includes(moduloDe(p)));
export const PERFIS_PADRAO: Perfil[] = [
  { id: 'administrador', nome: 'Administrador', descricao: 'Tudo: todos os módulos, usuários, perfis, configurações, empresas e certificados.', permissoes: [...TODAS_PERMISSOES], sistema: true, ordem: 10 },
  { id: 'gestor', nome: 'Gestor', descricao: 'Todo o trabalho de todos os módulos (inclusive transmitir e fechar), sem a administração do sistema.', permissoes: doTrabalho, sistema: true, ordem: 20 },
  { id: 'supervisor_fiscal', nome: 'Supervisor fiscal', descricao: 'Captação e todo o fiscal, inclusive transmitir o PGDAS-D, mais cadastrar empresas e certificados.', permissoes: ['captacao.ver', 'captacao.operar', 'fiscal.ver', 'fiscal.operar', 'fiscal.transmitir', 'administracao.empresas'], sistema: true, ordem: 30 },
  { id: 'analista_fiscal', nome: 'Analista fiscal', descricao: 'Dia a dia do fiscal: sincronizar, importar, auditar, conferir e calcular. Não transmite.', permissoes: ['captacao.ver', 'captacao.operar', 'fiscal.ver', 'fiscal.operar'], sistema: true, ordem: 40 },
  { id: 'analista_contabil', nome: 'Analista contábil', descricao: 'Contábil (lançar e fechar), com consulta às notas e ao fiscal.', permissoes: ['captacao.ver', 'fiscal.ver', 'contabil.ver', 'contabil.operar', 'contabil.fechar'], sistema: true, ordem: 50 },
  { id: 'analista_folha', nome: 'Analista de folha', descricao: 'Folha de pagamento (lançar e fechar). Não vê o fiscal.', permissoes: ['folha.ver', 'folha.operar', 'folha.fechar'], sistema: true, ordem: 60 },
  { id: 'consulta', nome: 'Consulta', descricao: 'Só vê e baixa notas e relatórios da captação e do fiscal. Não altera nada.', permissoes: ['captacao.ver', 'fiscal.ver'], sistema: true, ordem: 70 },
];
