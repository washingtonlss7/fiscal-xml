import fs from 'fs';
import https from 'https';
import tls from 'tls';
import forge from 'node-forge';
import { caBundlePath } from './config';

export interface Certificado {
  keyPem: string;
  certPem: string;
  cadeiaPem: string[];
  cnpj: string | null;
  titular: string;
  validoDe: Date;
  validoAte: Date;
}

/**
 * Lê um certificado A1 (.pfx/.p12). Usa node-forge em vez de passar o PFX direto
 * ao Node, porque muitos A1 usam cifras antigas (RC2/3DES) que o OpenSSL 3 recusa.
 */
export function lerPfx(pfx: Buffer, senha: string): Certificado {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  } catch (e) {
    const msg = (e as Error).message ?? '';
    if (/MAC|password|Invalid/i.test(msg)) throw new Error('Senha do certificado incorreta.');
    throw new Error(`Não foi possível ler o arquivo PFX: ${msg}`);
  }

  const oids = forge.pki.oids;
  const chaves = [
    ...(p12.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: oids.keyBag })[oids.keyBag] ?? []),
  ];
  const chave = chaves.find((b) => b.key)?.key as forge.pki.rsa.PrivateKey | undefined;
  if (!chave) throw new Error('O PFX não contém chave privada.');

  const certs = (p12.getBags({ bagType: oids.certBag })[oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c);
  if (!certs.length) throw new Error('O PFX não contém certificado.');

  const modulo = chave.n.toString(16);
  const folha =
    certs.find((c) => (c.publicKey as forge.pki.rsa.PublicKey).n?.toString(16) === modulo) ?? certs[0];
  const cadeia = certs.filter((c) => c !== folha);

  const cn = String(folha.subject.getField('CN')?.value ?? '');
  const cnpj = cn.match(/(\d{14})/)?.[1] ?? null;

  return {
    keyPem: forge.pki.privateKeyToPem(chave),
    certPem: forge.pki.certificateToPem(folha),
    cadeiaPem: cadeia.map((c) => forge.pki.certificateToPem(c)),
    cnpj,
    titular: cn.split(':')[0] || cn,
    validoDe: folha.validity.notBefore,
    validoAte: folha.validity.notAfter,
  };
}

export function lerPfxArquivo(caminho: string, senha: string): Certificado {
  return lerPfx(fs.readFileSync(caminho), senha);
}

let caExtra: string[] | null = null;
function autoridades(): string[] {
  if (caExtra === null) {
    const p = caBundlePath();
    if (p && fs.existsSync(p) && fs.statSync(p).size > 0) {
      caExtra = [fs.readFileSync(p, 'utf8')];
    } else {
      if (p) console.warn(`SEFAZ_CA_FILE aponta para ${p}, mas o arquivo não existe ou está vazio. Usando só as raízes padrão.`);
      caExtra = [];
    }
  }
  // Mantém as raízes padrão do Node e acrescenta a cadeia ICP-Brasil, se informada.
  return [...tls.rootCertificates, ...caExtra];
}

/** Agente HTTPS com autenticação mútua (mTLS) usando o certificado do cliente. */
export function criarAgente(cert: Certificado): https.Agent {
  return new https.Agent({
    key: cert.keyPem,
    cert: [cert.certPem, ...cert.cadeiaPem].join('\n'),
    ca: autoridades(),
    minVersion: 'TLSv1.2',
    keepAlive: true,
    maxSockets: 2,
  });
}
