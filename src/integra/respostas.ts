/**
 * Leitura das respostas do Integra Contador (SERPRO).
 *
 * Toda resposta do gateway tem { status, mensagens: [{ codigo, texto }], dados }, em que `dados`
 * é uma STRING com JSON. Os formatos abaixo seguem a documentação do SERPRO
 * (apicenter.estaleiro.serpro.gov.br/documentacao/api-integra-contador) e aceitam pequenas
 * variações de nome (ex.: detalhamento em objeto ou lista), para não quebrar com ajustes do leiaute.
 */

export interface Mensagem { codigo: string; texto: string }

export interface RespostaGateway {
  status: number;
  mensagens: Mensagem[];
  /** `dados` já convertido de string JSON (ou o valor bruto, se não for JSON). */
  dados: unknown;
}

/** Converte o corpo HTTP do gateway. */
export function lerResposta(statusHttp: number, corpo: string): RespostaGateway {
  let j: any = null;
  try { j = corpo ? JSON.parse(corpo) : null; } catch { j = null; }
  const mensagens: Mensagem[] = Array.isArray(j?.mensagens)
    ? j.mensagens.map((m: any) => ({ codigo: String(m?.codigo ?? ''), texto: String(m?.texto ?? '').trim() }))
    : [];
  let dados: unknown = j?.dados ?? null;
  if (typeof dados === 'string') {
    const t = dados.trim();
    if (!t) dados = null;
    else { try { dados = JSON.parse(t); } catch { /* fica o texto */ } }
  }
  const status = Number(j?.status ?? statusHttp) || statusHttp;
  return { status, mensagens, dados };
}

/** Mensagem legível para o escritório (as do SERPRO vêm com o código entre colchetes). */
export function textoMensagens(m: Mensagem[]): string {
  return m.map((x) => x.texto.replace(/^\[[^\]]*\]\s*/, '')).filter(Boolean).join(' ');
}

/** Erro de negócio? Os códigos do SERPRO trazem "Sucesso", "Aviso", "EntradaIncorreta", "Erro"... */
export function temErro(r: RespostaGateway): boolean {
  if (r.status < 200 || r.status >= 300) return true;
  return r.mensagens.some((m) => /erro|entradaincorreta|acessonegado/i.test(m.codigo));
}

const num = (v: unknown) => {
  if (typeof v === 'number') return Math.round(v * 100) / 100;
  const s = String(v ?? '').trim();
  if (!s) return 0;
  // "1.234,56" ou "1234.56"
  const n = /,\d{1,2}$/.test(s) ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
/** AAAAMMDD -> AAAA-MM-DD (aceita AAAA-MM-DD e DD/MM/AAAA). */
export function dataIso(v: unknown): string | null {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}
/** Competência AAAA-MM -> período de apuração AAAAMM. */
export const periodoApuracao = (competencia: string) => competencia.slice(0, 7).replace('-', '');

/* ---------- Procurações (PROCURACOES / OBTERPROCURACAO41) ---------- */

export interface Procuracao { expiraEm: string | null; sistemas: string[]; quantidade: number }

export function lerProcuracoes(dados: unknown): Procuracao[] {
  const lista = Array.isArray(dados) ? dados : dados && typeof dados === 'object' ? [dados] : [];
  return lista.map((p: any) => {
    const sistemas = Array.isArray(p?.sistemas) ? p.sistemas.map((s: unknown) => String(s).trim()).filter(Boolean) : [];
    return { expiraEm: dataIso(p?.dtexpiracao ?? p?.dataExpiracao), sistemas, quantidade: Number(p?.nrsistemas ?? sistemas.length) || sistemas.length };
  });
}

export type SituacaoProcuracao = 'ativa' | 'vencida' | 'ausente';

/** Situação para o painel: a procuração mais longa que ainda vale. */
export function situacaoProcuracao(lista: Procuracao[], hoje: string): { situacao: SituacaoProcuracao; expiraEm: string | null; sistemas: string[] } {
  if (!lista.length) return { situacao: 'ausente', expiraEm: null, sistemas: [] };
  const validas = lista.filter((p) => !p.expiraEm || p.expiraEm >= hoje);
  const alvo = (validas.length ? validas : lista).slice().sort((a, b) => String(b.expiraEm ?? '9999').localeCompare(String(a.expiraEm ?? '9999')))[0];
  const sistemas = [...new Set((validas.length ? validas : lista).flatMap((p) => p.sistemas))];
  return { situacao: validas.length ? 'ativa' : 'vencida', expiraEm: alvo.expiraEm, sistemas };
}

/* ---------- DAS (PGDASD / GERARDAS12 e PGMEI / GERARDASPDF21) ---------- */

export interface Guia {
  numeroDocumento: string;
  periodoApuracao: string; // AAAAMM
  vencimento: string | null;
  limiteAcolhimento: string | null;
  principal: number;
  multa: number;
  juros: number;
  total: number;
  composicao: { codigo: string; denominacao: string; principal: number; multa: number; juros: number; total: number }[];
  codigoBarras: string[];
  observacoes: string[];
  pdf: Buffer | null;
}

export function lerGuias(dados: unknown): Guia[] {
  const lista = Array.isArray(dados) ? dados : dados && typeof dados === 'object' ? [dados] : [];
  const guias: Guia[] = [];
  for (const d of lista as any[]) {
    const pdf = typeof d?.pdf === 'string' && d.pdf.length > 20 ? Buffer.from(d.pdf, 'base64') : null;
    const det = d?.detalhamento ?? d?.detalhamentoDas ?? null;
    const dets = Array.isArray(det) ? det : det ? [det] : [];
    for (const x of dets) {
      const v = x?.valores ?? {};
      guias.push({
        numeroDocumento: String(x?.numeroDocumento ?? '').trim(),
        periodoApuracao: String(x?.periodoApuracao ?? '').replace(/\D/g, '').slice(0, 6),
        vencimento: dataIso(x?.dataVencimento),
        limiteAcolhimento: dataIso(x?.dataLimiteAcolhimento),
        principal: num(v.principal), multa: num(v.multa), juros: num(v.juros), total: num(v.total),
        composicao: (Array.isArray(x?.composicao) ? x.composicao : []).map((c: any) => ({
          codigo: String(c?.codigo ?? ''), denominacao: String(c?.denominacao ?? '').trim(),
          principal: num(c?.valores?.principal), multa: num(c?.valores?.multa), juros: num(c?.valores?.juros), total: num(c?.valores?.total),
        })),
        codigoBarras: Array.isArray(x?.codigoDeBarras) ? x.codigoDeBarras.map(String) : [],
        observacoes: [x?.observacao1, x?.observacao2, x?.observacao3].filter((o) => o && String(o).trim()).map((o) => String(o).trim()),
        pdf,
      });
    }
    // PDF sem detalhamento: guarda mesmo assim (o PDF é o documento que vale)
    if (!dets.length && pdf) {
      guias.push({ numeroDocumento: '', periodoApuracao: '', vencimento: null, limiteAcolhimento: null, principal: 0, multa: 0, juros: 0, total: 0, composicao: [], codigoBarras: [], observacoes: [], pdf });
    }
  }
  return guias;
}

/* ---------- Declaração do PGDAS-D (CONSULTIMADECREC14) ---------- */

export interface Declaracao { numero: string | null; temRecibo: boolean; temDeclaracao: boolean; temMaed: boolean }

export function lerUltimaDeclaracao(dados: unknown): Declaracao | null {
  if (!dados || typeof dados !== 'object') return null;
  const d = dados as any;
  const numero = d.numeroDeclaracao ? String(d.numeroDeclaracao) : null;
  const tem = (o: any, campo: string) => !!(o && typeof o[campo] === 'string' && o[campo].length > 20);
  if (!numero && !d.recibo && !d.declaracao) return null;
  return { numero, temRecibo: tem(d.recibo, 'pdf'), temDeclaracao: tem(d.declaracao, 'pdf'), temMaed: tem(d.maed, 'pdfNotificacao') || tem(d.maed, 'pdfDarf') };
}
