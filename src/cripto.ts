import crypto from 'crypto';

/**
 * Cifra AES-256-GCM. Formato do texto: base64(iv[12] | tag[16] | dados).
 * A MASTER_KEY (32 bytes em base64) fica só no ambiente do servidor, nunca no banco.
 */
function chave(masterKeyB64: string): Buffer {
  const k = Buffer.from(masterKeyB64, 'base64');
  if (k.length !== 32) throw new Error('MASTER_KEY precisa ter 32 bytes em base64. Gere com: npm run gerar-chave');
  return k;
}

export function cifrar(dados: Buffer, masterKeyB64: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave(masterKeyB64), iv);
  const cifrado = Buffer.concat([c.update(dados), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), cifrado]).toString('base64');
}

export function decifrar(textoB64: string, masterKeyB64: string): Buffer {
  const bruto = Buffer.from(textoB64, 'base64');
  const iv = bruto.subarray(0, 12);
  const tag = bruto.subarray(12, 28);
  const dados = bruto.subarray(28);
  const d = crypto.createDecipheriv('aes-256-gcm', chave(masterKeyB64), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(dados), d.final()]);
}
