/**
 * Escrita de arquivos SPED (EFD ICMS/IPI e EFD-Contribuições): linhas |REG|...|, formatação de campos,
 * contagem dos blocos (X990) e o Bloco 9. Regras em docs/sped/gerador-icms-spec.md §1 e gerador-contrib-spec.md §1.
 */

/** Centavos inteiros → evita erro de ponto flutuante nas somas. */
export const c = (v: number | null | undefined) => Math.round((Number(v) || 0) * 100);
export const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Número com casas fixas e vírgula decimal. Negativo é erro de geração. */
export function n(v: number | null | undefined, dec = 2): string {
  const x = Number(v) || 0;
  if (x < -0.000001) throw new ErroGeracao(`Valor negativo no arquivo (${x}).`);
  return Math.abs(x).toFixed(dec).replace('.', ',');
}
/** Número opcional: vazio quando não há valor. */
export const nv = (v: number | null | undefined, dec = 2) => (v === null || v === undefined ? '' : n(v, dec));
/** Centavos → texto com 2 casas. */
export const nc = (cent: number) => n(cent / 100, 2);

/** Data ISO (AAAA-MM-DD...) → DDMMAAAA, usando a data da própria string (sem converter fuso). */
export function d8(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${m[3]}${m[2]}${m[1]}` : '';
}
/** Data local (São Paulo) de um timestamp ISO: "2026-09-30T23:30:00-03:00" e "2026-10-01T02:30:00Z" → 2026-09-30. */
export function dataLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = String(iso);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/[+-]03:00$/.test(s)) return s.slice(0, 10);
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? s.slice(0, 10) : t.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

const SUBST: Record<string, string> = { '–': '-', '—': '-', '“': '"', '”': '"', '‘': "'", '’': "'", '…': '...', 'º': 'o', 'ª': 'a', ' ': ' ' };
/** Texto: sem |, sem controle, Latin-1, sem espaços duplos, truncado. */
export function t(v: unknown, max = 255): string {
  let s = String(v ?? '').replace(/[\u0000-\u001f|]/g, ' ');
  s = s.replace(/[–—“”‘’…ºª ]/g, (x) => SUBST[x] ?? ' ');
  // Fora do Latin-1: tenta tirar o acento; senão, remove
  s = [...s].map((ch) => (ch.charCodeAt(0) <= 0xff ? ch : ch.normalize('NFD').replace(/[^\u0000-ÿ]/g, ''))).join('');
  return s.replace(/\s+/g, ' ').trim().slice(0, max).trim();
}
export const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export class ErroGeracao extends Error {}

/** Arquivo em construção: linhas em ordem, com contagem por bloco e por registro. */
export class Arquivo {
  private linhas: string[] = [];
  private contagem = new Map<string, number>();
  private blocoAtual: string | null = null;
  private inicioBloco = 0;

  add(reg: string, ...campos: (string | number | null | undefined)[]) {
    const f = campos.map((x) => (x === null || x === undefined ? '' : String(x)));
    for (const x of f) if (x.includes('|') || /[\r\n]/.test(x)) throw new ErroGeracao(`Caractere inválido no registro ${reg}.`);
    this.linhas.push(`|${reg}|${f.join('|')}|`);
    this.contagem.set(reg, (this.contagem.get(reg) ?? 0) + 1);
  }

  /** Abre um bloco (X001). O 0000 é escrito antes, fora do bloco, mas conta no 0990. */
  abrir(bloco: string, indMov: string) {
    this.blocoAtual = bloco;
    this.inicioBloco = this.linhas.length;
    if (bloco === '0') this.inicioBloco = this.linhas.findIndex((l) => l.startsWith('|0000|'));
    this.add(`${bloco}001`, indMov);
  }

  fechar() {
    if (!this.blocoAtual) throw new ErroGeracao('Bloco não aberto.');
    const qtd = this.linhas.length - this.inicioBloco + 1;
    this.add(`${this.blocoAtual}990`, qtd);
    this.blocoAtual = null;
  }

  /** Bloco 9 (9001, 9900 por registro, 9990, 9999). */
  encerrar(): string[] {
    const tipos = [...this.contagem.keys()];
    const n9900 = tipos.length + 4; // + 9001, 9900, 9990, 9999
    const qtd9 = 1 + n9900 + 1 + 1;
    const total = this.linhas.length + qtd9;
    const bloco9 = ['|9001|0|'];
    for (const reg of tipos) bloco9.push(`|9900|${reg}|${this.contagem.get(reg)}|`);
    bloco9.push('|9900|9001|1|', `|9900|9900|${n9900}|`, '|9900|9990|1|', '|9900|9999|1|', `|9990|${qtd9}|`, `|9999|${total}|`);
    return [...this.linhas, ...bloco9];
  }

  quantidade(reg: string) { return this.contagem.get(reg) ?? 0; }
}

/** Texto final: Latin-1 com CRLF em todas as linhas. */
export function paraBuffer(linhas: string[]): Buffer {
  return Buffer.from(`${linhas.join('\r\n')}\r\n`, 'latin1');
}

/** Pendência da geração: erro = o PVA vai recusar ou o valor está errado; alerta = conferir; info = como foi feito. */
export interface Pendencia { nivel: 'erro' | 'alerta' | 'info'; codigo: string; texto: string; quantidade?: number; exemplos?: string[] }
export class Pendencias {
  private m = new Map<string, Pendencia>();
  add(nivel: Pendencia['nivel'], codigo: string, texto: string, exemplo?: string) {
    let p = this.m.get(codigo);
    if (!p) { p = { nivel, codigo, texto, quantidade: 0, exemplos: [] }; this.m.set(codigo, p); }
    p.quantidade = (p.quantidade ?? 0) + 1;
    if (exemplo && p.exemplos!.length < 8 && !p.exemplos!.includes(exemplo)) p.exemplos!.push(exemplo);
  }
  lista(): Pendencia[] {
    const o = { erro: 0, alerta: 1, info: 2 };
    return [...this.m.values()].sort((a, b) => o[a.nivel] - o[b.nivel]);
  }
  get erros() { return [...this.m.values()].filter((p) => p.nivel === 'erro').length; }
}

/** Último dia do mês AAAA-MM. */
export function ultimoDiaMes(comp: string): string {
  const [y, m] = comp.split('-').map(Number);
  return `${comp}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
