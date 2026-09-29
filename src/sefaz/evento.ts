import crypto from 'crypto';
import https from 'https';
import { Certificado } from '../cert';
import { acharTag, parser } from './distDFe';
import { postSoap } from './soap';

/** Recepção de eventos no Ambiente Nacional (manifestação do destinatário). */
const URL_EVENTO: Record<1 | 2, string> = {
  1: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  2: 'https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
};
const WSDL_NS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4';
const NFE_NS = 'http://www.portalfiscal.inf.br/nfe';
const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const C14N = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

export const CIENCIA = { tpEvento: '210210', descricao: 'Ciencia da Operacao' } as const;
export const MAX_EVENTOS_POR_LOTE = 20;

/** Data/hora no formato exigido (AAAA-MM-DDThh:mm:ss-03:00), no fuso de Brasília. */
export function dataHoraBrasilia(d = new Date()): string {
  const local = new Date(d.getTime() - 3 * 3600_000);
  return local.toISOString().slice(0, 19) + '-03:00';
}

function certificadoBase64(certPem: string): string {
  return certPem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');
}

/**
 * Monta um <evento> de Ciência da Operação já assinado (XMLDSig enveloped, RSA-SHA1, C14N),
 * no mesmo padrão aceito pela SEFAZ. O XML é gerado já na forma canônica, então o digest
 * é calculado diretamente sobre o texto do infEvento (com o namespace herdado de <evento>).
 */
export function montarEventoCiencia(p: {
  cert: Certificado;
  tpAmb: 1 | 2;
  cnpj: string;
  chave: string;
  dhEvento?: string;
}): string {
  const id = `ID${CIENCIA.tpEvento}${p.chave}01`;
  const conteudo =
    `<cOrgao>91</cOrgao><tpAmb>${p.tpAmb}</tpAmb><CNPJ>${p.cnpj}</CNPJ><chNFe>${p.chave}</chNFe>` +
    `<dhEvento>${p.dhEvento ?? dataHoraBrasilia()}</dhEvento><tpEvento>${CIENCIA.tpEvento}</tpEvento>` +
    `<nSeqEvento>1</nSeqEvento><verEvento>1.00</verEvento>` +
    `<detEvento versao="1.00"><descEvento>${CIENCIA.descricao}</descEvento></detEvento>`;

  // Forma canônica do infEvento: o namespace padrão herdado de <evento> aparece no elemento.
  const infCanonico = `<infEvento xmlns="${NFE_NS}" Id="${id}">${conteudo}</infEvento>`;
  const digest = crypto.createHash('sha1').update(infCanonico, 'utf8').digest('base64');

  const signedInfoInterno =
    `<CanonicalizationMethod Algorithm="${C14N}"></CanonicalizationMethod>` +
    `<SignatureMethod Algorithm="${DSIG_NS}rsa-sha1"></SignatureMethod>` +
    `<Reference URI="#${id}"><Transforms>` +
    `<Transform Algorithm="${DSIG_NS}enveloped-signature"></Transform>` +
    `<Transform Algorithm="${C14N}"></Transform>` +
    `</Transforms><DigestMethod Algorithm="${DSIG_NS}sha1"></DigestMethod>` +
    `<DigestValue>${digest}</DigestValue></Reference>`;
  const signedInfoCanonico = `<SignedInfo xmlns="${DSIG_NS}">${signedInfoInterno}</SignedInfo>`;
  const assinatura = crypto.createSign('RSA-SHA1').update(signedInfoCanonico, 'utf8').sign(p.cert.keyPem, 'base64');

  return (
    `<evento xmlns="${NFE_NS}" versao="1.00">` +
    `<infEvento Id="${id}">${conteudo}</infEvento>` +
    `<Signature xmlns="${DSIG_NS}"><SignedInfo>${signedInfoInterno}</SignedInfo>` +
    `<SignatureValue>${assinatura}</SignatureValue>` +
    `<KeyInfo><X509Data><X509Certificate>${certificadoBase64(p.cert.certPem)}</X509Certificate></X509Data></KeyInfo>` +
    `</Signature></evento>`
  );
}

export interface RetornoEvento {
  chave: string;
  cStat: string;
  xMotivo: string;
  protocolo?: string;
}

export interface RetornoLoteEvento {
  cStat: string;
  xMotivo: string;
  eventos: RetornoEvento[];
}

export function montarEnvelopeEventos(eventos: string[], idLote: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
    'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">' +
    `<soap12:Body><nfeDadosMsg xmlns="${WSDL_NS}">` +
    `<envEvento xmlns="${NFE_NS}" versao="1.00"><idLote>${idLote}</idLote>${eventos.join('')}</envEvento>` +
    '</nfeDadosMsg></soap12:Body></soap12:Envelope>'
  );
}

export function parseRetornoEventos(xml: string): RetornoLoteEvento {
  const obj = parser.parse(xml);
  const ret = acharTag(obj, 'retEnvEvento');
  if (!ret) throw new Error(`Resposta sem retEnvEvento: ${xml.slice(0, 400)}`);
  const lista = ret.retEvento ? (Array.isArray(ret.retEvento) ? ret.retEvento : [ret.retEvento]) : [];
  return {
    cStat: String(ret.cStat ?? ''),
    xMotivo: String(ret.xMotivo ?? ''),
    eventos: lista.map((r: any) => {
      const inf = r.infEvento ?? {};
      return {
        chave: String(inf.chNFe ?? ''),
        cStat: String(inf.cStat ?? ''),
        xMotivo: String(inf.xMotivo ?? ''),
        protocolo: inf.nProt ? String(inf.nProt) : undefined,
      };
    }),
  };
}

/** Envia até 20 eventos de Ciência da Operação num lote. */
export async function enviarCiencia(
  agent: https.Agent,
  cert: Certificado,
  p: { tpAmb: 1 | 2; cnpj: string; chaves: string[] },
): Promise<RetornoLoteEvento> {
  if (p.chaves.length > MAX_EVENTOS_POR_LOTE) throw new Error('No máximo 20 eventos por lote.');
  const dh = dataHoraBrasilia();
  const eventos = p.chaves.map((chave) => montarEventoCiencia({ cert, tpAmb: p.tpAmb, cnpj: p.cnpj, chave, dhEvento: dh }));
  const idLote = String(Date.now()).slice(-15);
  const resposta = await postSoap(
    URL_EVENTO[p.tpAmb],
    `${WSDL_NS}/nfeRecepcaoEvento`,
    montarEnvelopeEventos(eventos, idLote),
    agent,
  );
  return parseRetornoEventos(resposta);
}
