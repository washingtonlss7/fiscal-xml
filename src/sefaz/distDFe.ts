import https from 'https';
import zlib from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import { postSoap } from './soap';

export type Modelo = 'nfe' | 'cte';

interface ConfigServico {
  url: Record<1 | 2, string>;
  wsdlNs: string;
  metodo: string;
  dadosMsg: string;
  ns: string;
  versao: string;
}

/** Web services do Ambiente Nacional (NT 2014.002 para NF-e; MOC CT-e para CT-e). */
export const SERVICOS: Record<Modelo, ConfigServico> = {
  nfe: {
    url: {
      1: 'https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
      2: 'https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx',
    },
    wsdlNs: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe',
    metodo: 'nfeDistDFeInteresse',
    dadosMsg: 'nfeDadosMsg',
    ns: 'http://www.portalfiscal.inf.br/nfe',
    versao: '1.01',
  },
  cte: {
    url: {
      1: 'https://www1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx',
      2: 'https://hom1.cte.fazenda.gov.br/CTeDistribuicaoDFe/CTeDistribuicaoDFe.asmx',
    },
    wsdlNs: 'http://www.portalfiscal.inf.br/cte/wsdl/CTeDistribuicaoDFe',
    metodo: 'cteDistDFeInteresse',
    dadosMsg: 'cteDadosMsg',
    ns: 'http://www.portalfiscal.inf.br/cte',
    versao: '1.00',
  },
};

export interface DocZip {
  nsu: string;
  schema: string;
  xml: string;
}

export interface RetornoDist {
  cStat: string;
  xMotivo: string;
  ultNSU: string;
  maxNSU: string;
  dhResp?: string;
  docs: DocZip[];
}

export const nsu15 = (n: string | number) => String(n).replace(/\D/g, '').padStart(15, '0').slice(-15);

export interface ParametrosConsulta {
  tpAmb: 1 | 2;
  cUF: number;
  cnpj: string;
  /** distNSU: continua a partir deste NSU. */
  ultNSU?: string;
  /** consNSU: busca só este NSU (recuperação de lacunas). */
  nsu?: string;
}

export function montarEnvelope(modelo: Modelo, p: ParametrosConsulta): string {
  const s = SERVICOS[modelo];
  const pedido = p.nsu !== undefined
    ? `<consNSU><NSU>${nsu15(p.nsu)}</NSU></consNSU>`
    : `<distNSU><ultNSU>${nsu15(p.ultNSU ?? '0')}</ultNSU></distNSU>`;
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    '<soap12:Body>' +
    `<${s.metodo} xmlns="${s.wsdlNs}">` +
    `<${s.dadosMsg}>` +
    `<distDFeInt xmlns="${s.ns}" versao="${s.versao}">` +
    `<tpAmb>${p.tpAmb}</tpAmb>` +
    `<cUFAutor>${p.cUF}</cUFAutor>` +
    `<CNPJ>${p.cnpj}</CNPJ>` +
    pedido +
    '</distDFeInt>' +
    `</${s.dadosMsg}>` +
    `</${s.metodo}>` +
    '</soap12:Body></soap12:Envelope>'
  );
}

export const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false, // mantém NSU, CNPJ e chaves com zeros à esquerda
  parseAttributeValue: false,
  trimValues: true,
  isArray: (nome) => nome === 'docZip',
});

/** Procura a primeira ocorrência de uma tag em qualquer profundidade. */
export function acharTag(obj: unknown, nome: string): any {
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  if (nome in o) return o[nome];
  for (const v of Object.values(o)) {
    const r = acharTag(v, nome);
    if (r !== undefined) return r;
  }
  return undefined;
}

export function descompactar(b64: string): string {
  return zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8');
}

export function parseRetorno(xmlResposta: string): RetornoDist {
  const obj = parser.parse(xmlResposta);
  const ret = acharTag(obj, 'retDistDFeInt');
  if (!ret) {
    const falha = acharTag(obj, 'Fault');
    const motivo = falha ? JSON.stringify(falha).slice(0, 500) : xmlResposta.slice(0, 500);
    throw new Error(`Resposta sem retDistDFeInt: ${motivo}`);
  }
  const docs: DocZip[] = (ret.loteDistDFeInt?.docZip ?? []).map((d: any) => ({
    nsu: nsu15(d['@_NSU']),
    schema: String(d['@_schema'] ?? ''),
    xml: descompactar(String(d['#text'] ?? '')),
  }));
  return {
    cStat: String(ret.cStat ?? ''),
    xMotivo: String(ret.xMotivo ?? ''),
    ultNSU: nsu15(ret.ultNSU ?? '0'),
    maxNSU: nsu15(ret.maxNSU ?? '0'),
    dhResp: ret.dhResp ? String(ret.dhResp) : undefined,
    docs,
  };
}

/** Uma chamada ao DistribuicaoDFe (distNSU ou consNSU). Não faz loop: quem chama controla o ritmo e as regras de 137/656. */
export async function consultarDistNSU(
  modelo: Modelo,
  agent: https.Agent,
  p: ParametrosConsulta,
): Promise<RetornoDist> {
  const s = SERVICOS[modelo];
  const resposta = await postSoap(s.url[p.tpAmb], `${s.wsdlNs}/${s.metodo}`, montarEnvelope(modelo, p), agent);
  return parseRetorno(resposta);
}
