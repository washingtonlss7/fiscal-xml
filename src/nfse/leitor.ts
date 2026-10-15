/**
 * Leitura do XML da NFS-e do padrão nacional (leiaute 1.00 do Sistema Nacional NFS-e) e dos eventos.
 *   <NFSe><infNFSe Id="NFS{chave 50}"> nNFSe, cLocIncid, emit, valores, <DPS><infDPS> dhEmi, serie, nDPS, dCompet,
 *   prest, toma, interm, serv(cServ: cTribNac, xDescServ, cNBS; locPrest), valores(vServPrest, trib) </infDPS></DPS>
 *   <evento><infEvento> … <pedRegEvento><infPedReg> chNFSe, dhEvento, e101101 (cancelamento) … </infPedReg>
 */
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true,
  parseTagValue: false, parseAttributeValue: false, trimValues: true,
});

/** Primeira ocorrência de uma tag em qualquer profundidade. */
function achar(obj: unknown, nome: string): any {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  if (nome in o) return o[nome];
  for (const v of Object.values(o)) { const r = achar(v, nome); if (r !== undefined) return r; }
  return undefined;
}
const texto = (v: unknown): string | null => (v == null || typeof v === 'object' ? (v && typeof v === 'object' && '#text' in (v as any) ? String((v as any)['#text']) : null) : String(v).trim() || null);
const num = (v: unknown): number | null => { const t = texto(v); if (t == null) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const doc = (o: any): string | null => texto(o?.CNPJ) ?? texto(o?.CPF) ?? null;
const mun = (o: any): string | null => texto(achar(o, 'cMun'));

/** Eventos que tiram a nota de circulação. */
export const EVENTOS_CANCELAMENTO: Record<string, 'cancelada' | 'substituida'> = {
  '101101': 'cancelada', // Cancelamento de NFS-e
  '101103': 'cancelada', // Cancelamento deferido por análise fiscal
  '105102': 'substituida', // Cancelamento de NFS-e por substituição
  '105104': 'cancelada', // Cancelamento por ofício
};
export const NOME_EVENTO: Record<string, string> = {
  '101101': 'Cancelamento', '101103': 'Cancelamento deferido', '105102': 'Cancelamento por substituição', '105104': 'Cancelamento por ofício',
  '202201': 'Confirmação do prestador', '203202': 'Confirmação do tomador', '204203': 'Confirmação do intermediário',
  '202205': 'Rejeição do prestador', '203206': 'Rejeição do tomador', '204207': 'Rejeição do intermediário', '205208': 'Anulação da rejeição',
  '305101': 'Bloqueio por ofício', '305102': 'Desbloqueio por ofício',
};

export interface NfseLida {
  chave: string;
  numero: string | null;
  serieDps: string | null;
  numeroDps: string | null;
  competencia: string | null; // AAAA-MM-DD
  emitidaEm: string | null;
  prestador: { doc: string | null; nome: string | null; mun: string | null };
  tomador: { doc: string | null; nome: string | null; mun: string | null };
  intermediarioDoc: string | null;
  munIncidencia: string | null;
  munPrestacao: string | null;
  codTribNac: string | null;
  codNbs: string | null;
  descricao: string | null;
  valorServico: number | null;
  baseCalculo: number | null;
  aliquota: number | null;
  valorIss: number | null;
  issRetido: boolean | null;
  valorRetencoes: number | null;
  valorLiquido: number | null;
}

export interface EventoLido { chave: string; tpEvento: string; nSeq: number; descricao: string; ocorridoEm: string | null }

export type Lido = { tipo: 'nfse'; nfse: NfseLida } | { tipo: 'evento'; evento: EventoLido } | { tipo: 'outro' };

export function lerXmlNfse(xml: string): Lido {
  const j = parser.parse(xml);
  const inf = achar(j, 'infNFSe');
  if (inf) {
    const id = String(inf['@_Id'] ?? '');
    const chave = id.replace(/^NFS/, '');
    if (!/^\d{50}$/.test(chave)) throw new Error(`Chave da NFS-e inválida: ${id || '(sem Id)'}`);
    const dps = achar(inf, 'infDPS') ?? {};
    const prest = dps.prest ?? {};
    const emit = inf.emit ?? {};
    const toma = dps.toma ?? {};
    const cServ = achar(dps, 'cServ') ?? {};
    const vNfse = inf.valores ?? {};
    const vDps = dps.valores ?? {};
    const tribMun = achar(vDps, 'tribMun') ?? {};
    const tpRet = texto(tribMun.tpRetISSQN);
    const vServ = num(achar(vDps, 'vServ'));
    const vLiq = num(vNfse.vLiq);
    return {
      tipo: 'nfse',
      nfse: {
        chave,
        numero: texto(inf.nNFSe),
        serieDps: texto(dps.serie),
        numeroDps: texto(dps.nDPS),
        competencia: texto(dps.dCompet)?.slice(0, 10) ?? null,
        emitidaEm: texto(dps.dhEmi) ?? texto(inf.dhProc),
        // O emitente da NFS-e é o prestador (vem completo em <emit>; <prest> do DPS pode ter só o documento)
        prestador: { doc: doc(emit) ?? doc(prest), nome: texto(emit.xNome) ?? texto(prest.xNome), mun: mun(emit) ?? mun(prest) ?? texto(dps.cLocEmi) },
        tomador: { doc: doc(toma), nome: texto(toma.xNome), mun: mun(toma) },
        intermediarioDoc: doc(dps.interm),
        munIncidencia: texto(inf.cLocIncid),
        munPrestacao: texto(achar(dps, 'cLocPrestacao')),
        codTribNac: texto(cServ.cTribNac),
        codNbs: texto(cServ.cNBS),
        descricao: texto(cServ.xDescServ),
        valorServico: vServ,
        baseCalculo: num(vNfse.vBC),
        aliquota: num(vNfse.pAliqAplic),
        valorIss: num(vNfse.vISSQN),
        // tpRetISSQN: 1 = não retido; 2 = retido pelo tomador; 3 = retido pelo intermediário
        issRetido: tpRet == null ? null : tpRet !== '1',
        valorRetencoes: num(vNfse.vTotalRet),
        valorLiquido: vLiq ?? vServ,
      },
    };
  }
  const infEv = achar(j, 'infEvento');
  if (infEv) {
    const ped = achar(infEv, 'infPedReg') ?? {};
    const chave = texto(ped.chNFSe) ?? String(infEv['@_Id'] ?? '').replace(/^EVT/, '').slice(0, 50);
    const codigo = Object.keys(ped).map((k) => k.match(/^e(\d{6})$/)?.[1]).find(Boolean)
      ?? String(infEv['@_Id'] ?? '').replace(/^EVT/, '').slice(50, 56);
    if (!/^\d{50}$/.test(chave ?? '') || !/^\d{6}$/.test(codigo ?? '')) return { tipo: 'outro' };
    const corpo = ped[`e${codigo}`] ?? {};
    return {
      tipo: 'evento',
      evento: {
        chave: chave!, tpEvento: codigo!, nSeq: Number(texto(infEv.nSeqEvento) ?? texto(ped.nPedRegEvento) ?? 1) || 1,
        descricao: texto(corpo.xDesc) ?? NOME_EVENTO[codigo!] ?? `Evento ${codigo}`,
        ocorridoEm: texto(ped.dhEvento) ?? texto(infEv.dhProc),
      },
    };
  }
  return { tipo: 'outro' };
}

/** Papel da empresa na nota, pelo documento (CNPJ). */
export function papelNaNota(n: NfseLida, cnpj: string): 'prestador' | 'tomador' | 'intermediario' {
  if (n.prestador.doc === cnpj) return 'prestador';
  if (n.tomador.doc === cnpj) return 'tomador';
  if (n.intermediarioDoc === cnpj) return 'intermediario';
  // Mesma raiz (filial consultada com o certificado da matriz)
  const raiz = cnpj.slice(0, 8);
  if (n.prestador.doc?.slice(0, 8) === raiz) return 'prestador';
  if (n.tomador.doc?.slice(0, 8) === raiz) return 'tomador';
  return 'intermediario';
}
