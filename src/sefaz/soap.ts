import https from 'https';

export class ErroTransporte extends Error {
  constructor(msg: string, public readonly status?: number, public readonly corpo?: string) {
    super(msg);
  }
}

/** POST SOAP 1.2 com o agente mTLS do cliente. Retorna o XML de resposta. */
export function postSoap(
  url: string,
  action: string,
  envelope: string,
  agent: https.Agent,
  timeoutMs = 60_000,
): Promise<string> {
  const corpo = Buffer.from(envelope, 'utf8');
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        agent,
        headers: {
          'Content-Type': `application/soap+xml; charset=utf-8; action="${action}"`,
          'Content-Length': corpo.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const partes: Buffer[] = [];
        res.on('data', (p) => partes.push(p));
        res.on('end', () => {
          const texto = Buffer.concat(partes).toString('utf8');
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(texto);
          else reject(new ErroTransporte(`HTTP ${res.statusCode} da SEFAZ`, res.statusCode, texto.slice(0, 2000)));
        });
      },
    );
    req.on('timeout', () => req.destroy(new ErroTransporte(`Tempo esgotado após ${timeoutMs} ms`)));
    req.on('error', (e) => {
      const msg = (e as NodeJS.ErrnoException).code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' ||
        /issuer certificate|self.signed/i.test(e.message)
        ? `${e.message}. Configure SEFAZ_CA_FILE com a cadeia ICP-Brasil (ver README).`
        : e.message;
      reject(e instanceof ErroTransporte ? e : new ErroTransporte(msg));
    });
    req.end(corpo);
  });
}
