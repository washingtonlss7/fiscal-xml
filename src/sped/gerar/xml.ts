/**
 * Campos do XML que o SPED pede e que não ficam no banco: participante (endereço, IE, município),
 * modalidade do frete, pagamento, data de saída/entrada e, no CT-e, municípios, tipo, ICMS e as NF-e transportadas.
 */
import { acharTag, parser } from '../../sefaz/distDFe';

type Obj = Record<string, any>;
const lista = <T>(v: T | T[] | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());
const nnum = (v: unknown) => { const x = Number(s(v)); return Number.isFinite(x) ? x : 0; };

export interface ParticipanteXml { doc: string; cnpj: string; cpf: string; nome: string; ie: string; codMun: string; codPais: string; end: string; num: string; compl: string; bairro: string; suframa: string; uf: string }

function participante(p: Obj | undefined, ender: Obj | undefined): ParticipanteXml | null {
  if (!p) return null;
  const cnpj = s(p.CNPJ); const cpf = s(p.CPF); const estrangeiro = s(p.idEstrangeiro);
  const e = ender ?? {};
  const ie = s(p.IE);
  return {
    doc: cnpj || cpf || (estrangeiro ? `EX${estrangeiro}` : ''), cnpj, cpf, nome: s(p.xNome),
    ie: /^\d+$/.test(ie.replace(/\D/g, '')) && ie.toUpperCase() !== 'ISENTO' ? ie.replace(/\D/g, '') : '',
    codMun: s(e.cMun), codPais: s(e.cPais) || '1058', end: s(e.xLgr), num: s(e.nro), compl: s(e.xCpl), bairro: s(e.xBairro),
    suframa: s(p.ISUF), uf: s(e.UF),
  };
}

export interface ExtraNFe {
  emit: ParticipanteXml | null;
  dest: ParticipanteXml | null;
  modFrete: string;
  indPgto: '0' | '1' | '2' | '9';
  dataSaiEnt: string | null;
}

/** IND_PGTO pelo grupo pag/cobr (gerador-icms-spec §5.4). */
export function indPgto(inf: Obj): ExtraNFe['indPgto'] {
  const det = lista<Obj>(inf.pag?.detPag);
  if (det.length && det.every((d) => s(d.tPag) === '90')) return '9';
  const dups = lista<Obj>(inf.cobr?.dup);
  const emissao = s(inf.ide?.dhEmi).slice(0, 10);
  if (det.some((d) => s(d.indPag) === '1') || dups.some((d) => s(d.dVenc) > emissao)) return '1';
  if (det.some((d) => s(d.indPag) === '0') || det.length) return '0';
  return '2';
}

export function extraNFe(xml: string): ExtraNFe {
  const inf: Obj = acharTag(parser.parse(xml), 'infNFe');
  if (!inf) throw new Error('infNFe não encontrado');
  return {
    emit: participante(inf.emit, inf.emit?.enderEmit),
    dest: participante(inf.dest, inf.dest?.enderDest),
    modFrete: s(inf.transp?.modFrete) || '9',
    indPgto: indPgto(inf),
    dataSaiEnt: s(inf.ide?.dhSaiEnt) || null,
  };
}

export interface ExtraCTe {
  emit: ParticipanteXml | null;
  tpCTe: string; cMunIni: string; cMunFim: string; serie: string; vTPrest: number; vRec: number;
  icms: { cst: string; vBC: number; pICMS: number; vICMS: number };
  /** Papel do tomador: 0 remetente, 1 expedidor, 2 recebedor, 3 destinatário, 4 outros. */
  toma: string;
  remDoc: string; destDoc: string;
  chavesNFe: string[];
  chaveSubstituida: string;
}

const CST_CTE: Record<string, string> = { ICMS00: '00', ICMS20: '20', ICMS45: '40', ICMS60: '60', ICMS90: '90', ICMSOutraUF: '90', ICMSSN: '90' };

export function extraCTe(xml: string): ExtraCTe {
  const inf: Obj = acharTag(parser.parse(xml), 'infCte');
  if (!inf) throw new Error('infCte não encontrado');
  const ide: Obj = inf.ide ?? {};
  const icmsG: Obj = inf.imp?.ICMS ?? {};
  const k = Object.keys(icmsG).find((x) => !x.startsWith('@_')) ?? '';
  const g: Obj = icmsG[k] ?? {};
  const cst = s(g.CST) || CST_CTE[k] || '90';
  const toma = ide.toma4 ? '4' : s((ide.toma3 ?? ide.toma)?.toma);
  const docDe = (p: Obj | undefined) => s(p?.CNPJ) || s(p?.CPF);
  return {
    emit: participante(inf.emit, inf.emit?.enderEmit),
    tpCTe: s(ide.tpCTe) || '0', cMunIni: s(ide.cMunIni), cMunFim: s(ide.cMunFim), serie: s(ide.serie),
    vTPrest: nnum(inf.vPrest?.vTPrest), vRec: nnum(inf.vPrest?.vRec),
    icms: { cst: cst.slice(-2), vBC: nnum(g.vBC ?? g.vBCOutraUF), pICMS: nnum(g.pICMS ?? g.pICMSOutraUF), vICMS: nnum(g.vICMS ?? g.vICMSOutraUF) },
    toma, remDoc: docDe(inf.rem), destDoc: docDe(inf.dest),
    chavesNFe: lista<Obj>(inf.infCTeNorm?.infDoc?.infNFe).map((x) => s(x.chave)).filter((x) => /^\d{44}$/.test(x)),
    chaveSubstituida: s(inf.infCteSub?.chCte),
  };
}
