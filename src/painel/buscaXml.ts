/**
 * Busca de XML em dois níveis: o escritório inteiro (com ou sem empresa escolhida) ou uma empresa (aba Notas Fiscais).
 * Os filtros chegam como texto (query string ou JSON) e viram o parâmetro da função busca_xml do banco.
 * Cuidados: período de no máximo 12 meses; ZIP de no máximo 5.000 XMLs; todo download fica em downloads_xml.
 */
import { Db, ok } from '../db';

export class ErroBusca extends Error {
  constructor(public readonly status: number, msg: string) { super(msg); }
}

export const MAX_DIAS = 366;
export const MAX_ZIP = 5000;
export const MAX_EXCEL = 20000;
export const POR_PAGINA = 200;

/** Código IBGE da UF (os 2 primeiros dígitos da chave de acesso são a UF do emitente). */
export const UF_CODIGO: Record<string, string> = {
  RO: '11', AC: '12', AM: '13', RR: '14', PA: '15', AP: '16', TO: '17', MA: '21', PI: '22', CE: '23', RN: '24', PB: '25', PE: '26', AL: '27', SE: '28', BA: '29',
  MG: '31', ES: '32', RJ: '33', SP: '35', PR: '41', SC: '42', RS: '43', MS: '50', MT: '51', GO: '52', DF: '53',
};
export const UF_DA_CHAVE = Object.fromEntries(Object.entries(UF_CODIGO).map(([uf, c]) => [c, uf]));

/** "10001, 10002; 10010-10050" → faixas [de, até]. Máximo de 200 itens. */
export function faixasNumeros(texto: string): [number, number][] {
  const partes = String(texto).split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const faixas: [number, number][] = [];
  for (const p of partes) {
    const m = p.match(/^(\d{1,12})(?:-(\d{1,12}))?$/);
    if (!m) throw new ErroBusca(400, `"${p.slice(0, 30)}" não é um número de nota. Use números separados por vírgula ou uma faixa como 10001-10050.`);
    const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a;
    faixas.push(a <= b ? [a, b] : [b, a]);
  }
  if (faixas.length > 200) throw new ErroBusca(400, 'Informe até 200 números ou faixas por busca.');
  return faixas;
}

/** Lista de chaves de acesso coladas (separadas por espaço, vírgula, ponto e vírgula ou linha). Máximo de 5.000. */
export function listaChaves(texto: string): string[] {
  const achadas = String(texto).replace(/[^\d\s,;]/g, ' ').split(/[\s,;]+/).filter(Boolean);
  const invalidas = achadas.filter((c) => !/^\d{44}$/.test(c));
  if (invalidas.length) throw new ErroBusca(400, `${invalidas.length} chave${invalidas.length === 1 ? '' : 's'} sem 44 dígitos (ex.: ${invalidas[0].slice(0, 20)}…).`);
  const unicas = [...new Set(achadas)];
  if (unicas.length > MAX_ZIP) throw new ErroBusca(400, `Informe até ${MAX_ZIP} chaves por busca.`);
  return unicas;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const diaValido = (d: string) => DIA.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
const proximoDia = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

export interface FiltroBusca {
  empresa: string | null; de: string; ate: string; modelo: string | null; direcao: string | null; situacao: string | null; uf: string | null;
  por: 'numero' | 'chave' | 'documento' | 'nome' | null; termo: string;
}

/** Lê e valida os filtros (de um objeto de textos). `empresaFixa` trava a busca numa empresa (aba da empresa). */
export function lerFiltro(p: Record<string, unknown>, empresaFixa?: string | null): FiltroBusca {
  const s = (k: string) => (p[k] == null ? '' : String(p[k]).trim());
  const empresa = empresaFixa ?? (s('empresa') && s('empresa') !== 'todas' ? s('empresa') : null);
  if (empresa && !/^[0-9a-f-]{36}$/.test(empresa)) throw new ErroBusca(400, 'Empresa inválida.');
  const de = s('de'); const ate = s('ate');
  if (!diaValido(de) || !diaValido(ate)) throw new ErroBusca(400, 'Informe o período (data inicial e final).');
  if (ate < de) throw new ErroBusca(400, 'A data final é anterior à inicial.');
  const dias = (Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000 + 1;
  if (dias > MAX_DIAS) throw new ErroBusca(400, 'O período pode ter no máximo 12 meses.');
  const um = (k: string, validos: string[]) => (validos.includes(s(k)) ? s(k) : null);
  const ufTexto = s('uf').toUpperCase();
  if (ufTexto && !UF_CODIGO[ufTexto]) throw new ErroBusca(400, 'UF inválida.');
  const por = um('por', ['numero', 'chave', 'documento', 'nome']) as FiltroBusca['por'];
  return {
    empresa, de, ate, modelo: um('modelo', ['55', '57', '65']), direcao: um('direcao', ['entrada', 'saida']),
    situacao: um('situacao', ['autorizada', 'cancelada', 'resumo']), uf: ufTexto || null, por: s('termo') ? por ?? 'numero' : null, termo: s('termo').slice(0, 250000),
  };
}

/** Parâmetro da função busca_xml. */
export function parametroBusca(f: FiltroBusca, extra: { limite?: number; offset?: number; caminhos?: boolean; escopo?: string[] } = {}) {
  const p: Record<string, unknown> = {
    de: `${f.de}T00:00:00-03:00`, ate: `${proximoDia(f.ate)}T00:00:00-03:00`,
    limite: extra.limite ?? POR_PAGINA, offset: extra.offset ?? 0,
  };
  if (f.empresa) p.empresa = f.empresa;
  // Escopo de empresas do usuário (carteira/lista); sem escopo = todas
  if (extra.escopo) p.empresas = extra.escopo;
  if (f.modelo) p.modelo = f.modelo;
  if (f.direcao) p.direcao = f.direcao;
  if (f.situacao) p.situacao = f.situacao;
  if (f.uf) p.uf = UF_CODIGO[f.uf];
  if (extra.caminhos) p.caminhos = 'sim';
  if (f.por && f.termo) {
    if (f.por === 'numero') p.numeros = faixasNumeros(f.termo);
    else if (f.por === 'chave') p.chaves = listaChaves(f.termo);
    else if (f.por === 'documento') {
      const d = f.termo.replace(/\D/g, '');
      if (d.length !== 11 && d.length !== 14) throw new ErroBusca(400, 'Informe um CNPJ (14 dígitos) ou CPF (11 dígitos).');
      p.doc = d;
    } else {
      if (f.termo.length < 3) throw new ErroBusca(400, 'Digite ao menos 3 letras do nome.');
      p.nome = f.termo.replace(/[%_\\]/g, ' ').slice(0, 100);
    }
  }
  return p;
}

export interface NotaBusca {
  chave: string; modelo: string; numero: string | null; serie: string | null; emitida_em: string; direcao: string; completo: boolean;
  emit_cnpj: string | null; emit_nome: string | null; dest_doc: string | null; dest_nome: string | null; valor: number | null; situacao: string;
  cfop: string | null; v_icms: number | null; v_st: number | null; recebido_via: string | null; empresa_id: string; empresa_nome: string; empresa_cnpj: string;
  tem_xml: boolean; xml_path?: string | null;
}

export async function buscar(db: Db, f: FiltroBusca, pagina = 1, escopo?: string[]) {
  const pg = Math.max(1, Math.min(10000, Math.floor(pagina) || 1));
  const r = ok(await db.rpc('busca_xml_escopo', { p: parametroBusca(f, { offset: (pg - 1) * POR_PAGINA, escopo }) }), 'busca de XML') as { total: number; resumo: any; notas: NotaBusca[] };
  const notas = (r.notas ?? []).map((n) => { const { xml_path: _x, ...resto } = n; return { ...resto, uf_emitente: UF_DA_CHAVE[n.chave.slice(0, 2)] ?? null }; });
  return { total: r.total, pagina: pg, porPagina: POR_PAGINA, paginas: Math.max(1, Math.ceil(r.total / POR_PAGINA)), resumo: r.resumo, notas };
}

/** Notas para o ZIP: as chaves marcadas (dentro da empresa, se fixa) ou tudo o que o filtro achar. Até 5.000. */
export async function notasParaZip(db: Db, f: FiltroBusca, chaves?: string[], escopo?: string[]) {
  const filtro: FiltroBusca = chaves && chaves.length
    ? { ...f, de: '2000-01-01', ate: '2099-12-31', modelo: null, direcao: null, situacao: null, uf: null, por: 'chave', termo: chaves.join(' ') }
    : f;
  const p = parametroBusca(filtro, { limite: MAX_ZIP + 1, caminhos: true, escopo });
  if (chaves && chaves.length) { p.de = '2000-01-01T00:00:00-03:00'; p.ate = '2100-01-01T00:00:00-03:00'; }
  const r = ok(await db.rpc('busca_xml_escopo', { p }), 'notas do ZIP') as { total: number; notas: NotaBusca[] };
  if (r.total > MAX_ZIP) throw new ErroBusca(413, `A busca achou ${r.total.toLocaleString('pt-BR')} notas: o ZIP tem limite de ${MAX_ZIP.toLocaleString('pt-BR')} XMLs. Diminua o período ou use mais filtros.`);
  return { total: r.total, notas: r.notas ?? [] };
}

/** Notas para o Excel (até 20.000 linhas). */
export async function notasParaExcel(db: Db, f: FiltroBusca, chaves?: string[], escopo?: string[]) {
  const filtro: FiltroBusca = chaves && chaves.length ? { ...f, modelo: null, direcao: null, situacao: null, uf: null, por: 'chave', termo: chaves.join(' ') } : f;
  const p = parametroBusca(filtro, { limite: MAX_EXCEL + 1, escopo });
  if (chaves && chaves.length) { p.de = '2000-01-01T00:00:00-03:00'; p.ate = '2100-01-01T00:00:00-03:00'; }
  const r = ok(await db.rpc('busca_xml_escopo', { p }), 'notas do Excel') as { total: number; notas: NotaBusca[] };
  if (r.total > MAX_EXCEL) throw new ErroBusca(413, `A busca achou ${r.total.toLocaleString('pt-BR')} notas: a planilha tem limite de ${MAX_EXCEL.toLocaleString('pt-BR')} linhas. Diminua o período.`);
  return r.notas ?? [];
}

/** Caminho do XML dentro do ZIP. No escritório inteiro, cada empresa tem a sua pasta. */
export function caminhoNoZip(n: Pick<NotaBusca, 'chave' | 'modelo' | 'direcao' | 'situacao' | 'empresa_cnpj' | 'empresa_nome'>, porEmpresa: boolean) {
  const pasta: Record<string, string> = { '55': 'NFe', '57': 'CTe', '65': 'NFCe' };
  const sub = n.situacao === 'cancelada' ? `${n.direcao}/canceladas` : n.direcao;
  const emp = porEmpresa ? `${n.empresa_cnpj} ${String(n.empresa_nome ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w .-]+/g, '').trim().slice(0, 60)}/` : '';
  return `${emp}${pasta[n.modelo] ?? n.modelo}/${sub}/${n.chave}.xml`;
}

/** Grava quem baixou o quê. Falha no registro não impede o download (fica no log). */
export async function registrarDownload(db: Db, d: { email: string; tipo: 'xml' | 'zip' | 'excel'; empresaId: string | null; filtros: unknown; quantidade: number }) {
  const { error } = await db.from('downloads_xml').insert({ email: d.email, tipo: d.tipo, empresa_id: d.empresaId, filtros: d.filtros ?? null, quantidade: d.quantidade, em: new Date().toISOString() });
  return error ? error.message : null;
}
