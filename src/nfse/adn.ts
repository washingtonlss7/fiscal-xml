/**
 * Cliente da API de distribuição do Ambiente de Dados Nacional (ADN) da NFS-e para contribuintes.
 *
 *   GET {base}/DFe/{NSU}?lote=true   (autenticação mútua com o certificado ICP-Brasil da empresa)
 *
 * Devolve os documentos (NFS-e, eventos) em que o CNPJ do certificado é prestador, tomador ou intermediário, a partir
 * do NSU informado. Cada documento vem compactado (gzip) e em base64. O manual oficial não detalha o formato da
 * resposta; a leitura aqui aceita os nomes em PascalCase e camelCase e é conferida em produção na primeira execução.
 */
import https from 'https';
import zlib from 'zlib';

export const BASES_ADN = {
  1: 'https://adn.nfse.gov.br/contribuintes',
  2: 'https://adn.producaorestrita.nfse.gov.br/contribuintes',
} as const;

export class ErroAdn extends Error {
  constructor(msg: string, public readonly http?: number, public readonly corpo?: string) { super(msg); }
}

export interface DocAdn {
  nsu: number;
  chave: string | null;
  /** NFSE, EVENTO, DPS, PEDIDO_REGISTRO_EVENTO, CNC… */
  tipo: string;
  tipoEvento: string | null;
  xml: string;
}

export interface RetornoAdn {
  http: number;
  /** DOCUMENTOS_LOCALIZADOS, NENHUM_DOCUMENTO_LOCALIZADO, REJEICAO */
  status: string;
  docs: DocAdn[];
  erros: string[];
  alertas: string[];
}

/** Pega um campo pelo nome, sem diferenciar maiúsculas (a API mistura PascalCase e camelCase). */
function campo(o: any, ...nomes: string[]): any {
  if (!o || typeof o !== 'object') return undefined;
  const chaves = Object.keys(o);
  for (const n of nomes) {
    const k = chaves.find((c) => c.toLowerCase() === n.toLowerCase());
    if (k !== undefined) return o[k];
  }
  return undefined;
}

/** base64 → gzip → XML (aceita também XML só em base64 ou já em texto). */
export function abrirArquivo(conteudo: string): string {
  const s = String(conteudo ?? '').trim();
  if (s.startsWith('<')) return s;
  const buf = Buffer.from(s, 'base64');
  if (buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf).toString('utf8');
  return buf.toString('utf8');
}

const mensagens = (l: unknown): string[] => (Array.isArray(l) ? l : l ? [l] : []).map((e: any) =>
  typeof e === 'string' ? e : [campo(e, 'Codigo', 'codigo'), campo(e, 'Descricao', 'descricao', 'mensagem'), campo(e, 'Complemento', 'complemento')].filter(Boolean).join(' - '),
).filter(Boolean);

/** Lê o corpo JSON da resposta do ADN. */
export function lerRetorno(http: number, corpo: string): RetornoAdn {
  let j: any;
  try { j = corpo ? JSON.parse(corpo) : {}; } catch { throw new ErroAdn(`Resposta do ADN não é JSON (HTTP ${http})`, http, corpo.slice(0, 1000)); }
  const lote = campo(j, 'LoteDFe', 'loteDfe', 'Documentos') ?? [];
  const docs: DocAdn[] = (Array.isArray(lote) ? lote : []).map((d: any) => {
    const arquivo = campo(d, 'ArquivoXml', 'arquivoXml', 'Xml');
    return {
      nsu: Number(campo(d, 'NSU', 'nsu')),
      chave: campo(d, 'ChaveAcesso', 'chaveAcesso') ? String(campo(d, 'ChaveAcesso', 'chaveAcesso')) : null,
      tipo: String(campo(d, 'TipoDocumento', 'tipoDocumento') ?? '').toUpperCase(),
      tipoEvento: campo(d, 'TipoEvento', 'tipoEvento') != null ? String(campo(d, 'TipoEvento', 'tipoEvento')) : null,
      xml: arquivo ? abrirArquivo(String(arquivo)) : '',
    };
  }).filter((d: DocAdn) => Number.isFinite(d.nsu) && d.nsu > 0);
  const erros = mensagens(campo(j, 'Erros', 'erros', 'Erro'));
  let status = String(campo(j, 'StatusProcessamento', 'statusProcessamento') ?? '').toUpperCase();
  if (!status) status = docs.length ? 'DOCUMENTOS_LOCALIZADOS' : erros.length ? 'REJEICAO' : 'NENHUM_DOCUMENTO_LOCALIZADO';
  return { http, status, docs, erros, alertas: mensagens(campo(j, 'Alertas', 'alertas')) };
}

export type Transporte = (url: string, agent: https.Agent) => Promise<{ status: number; corpo: string }>;

/** GET com o agente mTLS da empresa. */
export const transporteHttps: Transporte = (url, agent) => new Promise((resolve, reject) => {
  const req = https.request(url, { method: 'GET', agent, headers: { Accept: 'application/json' }, timeout: 60_000 }, (res) => {
    const partes: Buffer[] = [];
    res.on('data', (p) => partes.push(p));
    res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8') }));
  });
  req.on('timeout', () => req.destroy(new ErroAdn('Tempo esgotado na consulta ao ADN (60 s)')));
  req.on('error', reject);
  req.end();
});

/**
 * Consulta o lote de documentos a partir do NSU. 404 com "nenhum documento" é resposta normal (fim da fila);
 * 429 (excesso de consultas) e 5xx viram ErroAdn com o código HTTP, para o agendador esperar.
 */
export async function consultarAdn(agent: https.Agent, p: { tpAmb: 1 | 2; nsu: number }, transporte: Transporte = transporteHttps): Promise<RetornoAdn> {
  const url = `${BASES_ADN[p.tpAmb]}/DFe/${Math.max(0, Math.floor(p.nsu))}?lote=true`;
  const r = await transporte(url, agent);
  if (r.status === 429) throw new ErroAdn('O ADN pediu para esperar (excesso de consultas).', 429, r.corpo.slice(0, 500));
  if (r.status >= 500) throw new ErroAdn(`ADN indisponível (HTTP ${r.status}).`, r.status, r.corpo.slice(0, 500));
  if (r.status === 401 || r.status === 403) throw new ErroAdn(`Certificado recusado pelo ADN (HTTP ${r.status}).`, r.status, r.corpo.slice(0, 500));
  if (r.status === 404 && !/[{[]/.test(r.corpo.trim().slice(0, 1))) return { http: 404, status: 'NENHUM_DOCUMENTO_LOCALIZADO', docs: [], erros: [], alertas: [] };
  const ret = lerRetorno(r.status, r.corpo);
  if (r.status >= 400 && ret.status !== 'NENHUM_DOCUMENTO_LOCALIZADO') throw new ErroAdn(ret.erros.join('; ') || `HTTP ${r.status} do ADN`, r.status, r.corpo.slice(0, 500));
  return ret;
}
