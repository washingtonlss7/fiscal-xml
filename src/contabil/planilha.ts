/**
 * Leitura de planilhas enviadas pelo Contábil (regras, empresas, plano de contas, folha): CSV (; ou ,) ou XLSX
 * (primeira aba). Devolve cabeçalho + linhas como texto; a interpretação de cada coluna fica com quem chama.
 */
import { ehZip, lerZip } from '../importacao/zipLeitor';
import { LinhaFolha, lerCsv } from './motor';

export class ErroPlanilha extends Error {}

const desc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');

/** Coluna "AB" → índice 27 (base 0). */
function indiceColuna(ref: string): number {
  const letras = ref.replace(/\d+/g, '');
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Número de série do Excel → AAAA-MM-DD (para colunas de data/competência). */
function dataExcel(serial: number): string {
  const d = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
  return d.toISOString().slice(0, 10);
}

export function lerXlsx(buf: Buffer): { cabecalho: string[]; linhas: LinhaFolha[] } {
  const arqs = lerZip(buf, (n) => /^xl\/(sharedStrings|workbook|styles)\.xml$|^xl\/worksheets\/sheet\d+\.xml$|^xl\/_rels\/workbook\.xml\.rels$/.test(n));
  const pega = (n: string) => arqs.find((a) => a.nome === n)?.conteudo.toString('utf8');
  const compartilhadas: string[] = [];
  const ss = pega('xl/sharedStrings.xml');
  if (ss) for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) ?? []) compartilhadas.push(desc((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  // Primeira aba do workbook
  const wb = pega('xl/workbook.xml') ?? '';
  const rels = pega('xl/_rels/workbook.xml.rels') ?? '';
  const rid = wb.match(/<sheet [^>]*r:id="([^"]+)"/)?.[1];
  const alvo = rid ? rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`))?.[1] : null;
  const caminho = alvo ? `xl/${alvo.replace(/^\/?xl\//, '')}` : 'xl/worksheets/sheet1.xml';
  const sheet = pega(caminho) ?? pega('xl/worksheets/sheet1.xml');
  if (!sheet) throw new ErroPlanilha('Planilha sem abas.');
  // Estilos de data (numFmt de data) para converter números em datas
  const estilos = pega('xl/styles.xml') ?? '';
  const fmtData = new Set<number>([14, 15, 16, 17, 22]);
  for (const m of estilos.matchAll(/<numFmt numFmtId="(\d+)" formatCode="([^"]+)"/g)) if (/[dmy]/i.test(m[2]) && !/[h]/i.test(m[2].replace(/\[[^\]]*\]/g, ''))) fmtData.add(Number(m[1]));
  const xfs = (estilos.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1].match(/<xf [^>]*>/g) ?? []).map((x) => Number(x.match(/numFmtId="(\d+)"/)?.[1] ?? 0));
  const linhasBrutas: string[][] = [];
  for (const row of sheet.match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) ?? []) {
    const r: string[] = [];
    for (const c of row.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = c.match(/r="([A-Z]+\d+)"/)?.[1];
      const t = c.match(/ t="([^"]+)"/)?.[1];
      const s = Number(c.match(/ s="(\d+)"/)?.[1] ?? -1);
      const v = c.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let valor = '';
      if (t === 's' && v != null) valor = compartilhadas[Number(v)] ?? '';
      else if (t === 'inlineStr') valor = desc((c.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1]) ?? '');
      else if (v != null) valor = s >= 0 && fmtData.has(xfs[s]) && /^\d+(\.\d+)?$/.test(v) ? dataExcel(Number(v)) : desc(v);
      r[ref ? indiceColuna(ref) : r.length] = valor;
    }
    linhasBrutas.push(Array.from(r, (x) => x ?? ''));
  }
  const filtradas = linhasBrutas.filter((r) => r.some((c) => String(c).trim()));
  const [cab = [], ...resto] = filtradas;
  const cabecalho = cab.map((c) => String(c).trim());
  return { cabecalho, linhas: resto.map((r, i) => ({ linha: i + 2, dados: Object.fromEntries(cabecalho.map((c, j) => [c, String(r[j] ?? '').trim()])) })) };
}

export function lerPlanilha(nome: string, buf: Buffer): { cabecalho: string[]; linhas: LinhaFolha[] } {
  if (ehZip(buf)) return lerXlsx(buf);
  if (/\.xls$/i.test(nome)) throw new ErroPlanilha('Arquivo .xls antigo: salve como .xlsx ou .csv.');
  // CSV: tenta UTF-8; se tiver caractere inválido, lê como Latin-1 (Excel brasileiro)
  const utf = buf.toString('utf8');
  return lerCsv(utf.includes('�') ? buf.toString('latin1') : utf);
}

/** Acha a coluna pelo nome (sem acento, sem maiúsculas). */
export function coluna(dados: Record<string, string>, ...nomes: string[]): string {
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const alvo = new Set(nomes.map(norm));
  const k = Object.keys(dados).find((c) => alvo.has(norm(c)));
  return k ? String(dados[k] ?? '').trim() : '';
}
