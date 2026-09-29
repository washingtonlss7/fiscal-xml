import { parser, acharTag } from './distDFe';

export interface InfoDocumento {
  tipo: 'documento';
  modelo: '55' | '57' | '65';
  chave: string;
  completo: boolean;
  numero?: string;
  serie?: string;
  emitidaEm?: string;
  emitCnpj?: string;
  emitNome?: string;
  destDoc?: string;
  destNome?: string;
  valor?: number;
  situacao: 'autorizada' | 'cancelada' | 'denegada';
  protocolo?: string;
}

export interface InfoEvento {
  tipo: 'evento';
  chave: string;
  tpEvento: string;
  nSeq: number;
  descricao?: string;
  ocorridoEm?: string;
  protocolo?: string;
}

export type InfoDFe = InfoDocumento | InfoEvento | { tipo: 'desconhecido'; schema: string };

const txt = (v: unknown): string | undefined => (v === undefined || v === null || v === '' ? undefined : String(v));
const num = (v: unknown): number | undefined => {
  const t = txt(v);
  if (t === undefined) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};
const chaveDoId = (id: unknown) => txt(id)?.replace(/^\D+/, '');

/** Tipos de evento que mudam a situação do documento. */
export const EVENTO_CANCELAMENTO = new Set(['110111', '110112']);

/** Interpreta um docZip já descompactado, a partir do nome do schema e do conteúdo. */
export function interpretar(schema: string, xml: string): InfoDFe {
  const base = schema.split('_')[0];
  const o = parser.parse(xml);

  switch (base) {
    case 'resNFe': {
      const r = acharTag(o, 'resNFe');
      const sit = txt(r.cSitNFe);
      return {
        tipo: 'documento',
        modelo: '55',
        chave: String(r.chNFe),
        completo: false,
        emitidaEm: txt(r.dhEmi),
        emitCnpj: txt(r.CNPJ) ?? txt(r.CPF),
        emitNome: txt(r.xNome),
        valor: num(r.vNF),
        situacao: sit === '3' ? 'cancelada' : sit === '2' ? 'denegada' : 'autorizada',
        protocolo: txt(r.nProt),
      };
    }
    case 'procNFe': {
      const inf = acharTag(o, 'infNFe');
      const prot = acharTag(o, 'infProt') ?? {};
      const ide = inf.ide ?? {};
      const cStat = txt(prot.cStat);
      return {
        tipo: 'documento',
        modelo: txt(ide.mod) === '65' ? '65' : '55',
        chave: txt(prot.chNFe) ?? chaveDoId(inf['@_Id'])!,
        completo: true,
        numero: txt(ide.nNF),
        serie: txt(ide.serie),
        emitidaEm: txt(ide.dhEmi) ?? txt(ide.dEmi),
        emitCnpj: txt(inf.emit?.CNPJ) ?? txt(inf.emit?.CPF),
        emitNome: txt(inf.emit?.xNome),
        destDoc: txt(inf.dest?.CNPJ) ?? txt(inf.dest?.CPF) ?? txt(inf.dest?.idEstrangeiro),
        destNome: txt(inf.dest?.xNome),
        valor: num(inf.total?.ICMSTot?.vNF),
        situacao: cStat === '110' || cStat === '301' || cStat === '302' ? 'denegada' : 'autorizada',
        protocolo: txt(prot.nProt),
      };
    }
    case 'procCTe': {
      const inf = acharTag(o, 'infCte');
      const prot = acharTag(o, 'infProt') ?? {};
      const ide = inf.ide ?? {};
      return {
        tipo: 'documento',
        modelo: '57',
        chave: txt(prot.chCTe) ?? chaveDoId(inf['@_Id'])!,
        completo: true,
        numero: txt(ide.nCT),
        serie: txt(ide.serie),
        emitidaEm: txt(ide.dhEmi),
        emitCnpj: txt(inf.emit?.CNPJ) ?? txt(inf.emit?.CPF),
        emitNome: txt(inf.emit?.xNome),
        destDoc: txt(inf.dest?.CNPJ) ?? txt(inf.dest?.CPF),
        destNome: txt(inf.dest?.xNome),
        valor: num(inf.vPrest?.vTPrest),
        situacao: 'autorizada',
        protocolo: txt(prot.nProt),
      };
    }
    case 'resEvento': {
      const r = acharTag(o, 'resEvento');
      return {
        tipo: 'evento',
        chave: String(r.chNFe ?? r.chCTe),
        tpEvento: String(r.tpEvento),
        nSeq: num(r.nSeqEvento) ?? 1,
        descricao: txt(r.xEvento),
        ocorridoEm: txt(r.dhEvento),
        protocolo: txt(r.nProt),
      };
    }
    case 'procEventoNFe':
    case 'procEventoCTe': {
      const inf = acharTag(o, 'infEvento');
      const ret = acharTag(acharTag(o, 'retEvento') ?? {}, 'infEvento') ?? {};
      return {
        tipo: 'evento',
        chave: String(inf.chNFe ?? inf.chCTe),
        tpEvento: String(inf.tpEvento),
        nSeq: num(inf.nSeqEvento) ?? 1,
        descricao: txt(inf.detEvento?.descEvento) ?? txt(ret.xEvento),
        ocorridoEm: txt(inf.dhEvento),
        protocolo: txt(ret.nProt),
      };
    }
    default:
      return { tipo: 'desconhecido', schema };
  }
}
