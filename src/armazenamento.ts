import crypto from 'crypto';
import zlib from 'zlib';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Db } from './db';

/*
 * Armazenamento dos XMLs.
 *
 * - Novo (R2): cada arquivo é compactado (gzip) e criptografado (AES-256-GCM) antes do envio.
 *   O caminho gravado no banco recebe o prefixo "r2:".
 * - Antigo (Supabase Storage): gzip sem criptografia, caminho sem prefixo. Continua legível
 *   até a migração mover tudo para o R2.
 */

const MAGICO = Buffer.from('FXE1'); // formato: FXE1 | iv(12) | tag(16) | dados
export const PREFIXO_R2 = 'r2:';

/** Chave dos XMLs derivada da MASTER_KEY (separada da chave usada nos certificados). */
export function chaveXml(masterKeyB64: string): Buffer {
  const mestre = Buffer.from(masterKeyB64, 'base64');
  if (mestre.length !== 32) throw new Error('MASTER_KEY precisa ter 32 bytes em base64.');
  return Buffer.from(crypto.hkdfSync('sha256', mestre, Buffer.alloc(0), Buffer.from('fiscal-xml:xml:v1'), 32));
}

/** Compacta e criptografa um XML. */
export function selar(xml: string | Buffer, chave: Buffer): Buffer {
  const gz = zlib.gzipSync(typeof xml === 'string' ? Buffer.from(xml, 'utf8') : xml);
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([c.update(gz), c.final()]);
  return Buffer.concat([MAGICO, iv, c.getAuthTag(), dados]);
}

/** Abre um arquivo: criptografado (FXE1) ou só gzip (formato antigo). Devolve o XML. */
export function abrir(bruto: Buffer, chave: Buffer): Buffer {
  if (bruto.subarray(0, 4).equals(MAGICO)) {
    const iv = bruto.subarray(4, 16);
    const tag = bruto.subarray(16, 32);
    const d = crypto.createDecipheriv('aes-256-gcm', chave, iv);
    d.setAuthTag(tag);
    return zlib.gunzipSync(Buffer.concat([d.update(bruto.subarray(32)), d.final()]));
  }
  return zlib.gunzipSync(bruto);
}

export interface ConfigArmazenamento {
  masterKey: string;
  bucketSupabase: string;
  r2?: { accountId: string; accessKeyId: string; secretAccessKey: string; bucket: string };
}

export function configArmazenamento(masterKey: string, bucketSupabase: string): ConfigArmazenamento {
  // Aceita só o ID (32 caracteres) ou o endereço inteiro colado da Cloudflare (https://<id>.r2.cloudflarestorage.com).
  const idBruto = process.env.R2_ACCOUNT_ID?.trim();
  const id = idBruto?.match(/[0-9a-f]{32}/i)?.[0] ?? idBruto;
  const ak = process.env.R2_ACCESS_KEY_ID?.trim();
  const sk = process.env.R2_SECRET_ACCESS_KEY?.trim();
  return {
    masterKey,
    bucketSupabase,
    r2: id && ak && sk ? { accountId: id, accessKeyId: ak, secretAccessKey: sk, bucket: process.env.R2_BUCKET?.trim() || 'fiscal-xml' } : undefined,
  };
}

export class Armazenamento {
  private readonly chave: Buffer;
  private readonly s3?: S3Client;

  constructor(private readonly db: Db, private readonly cfg: ConfigArmazenamento) {
    this.chave = chaveXml(cfg.masterKey);
    if (cfg.r2) {
      this.s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${cfg.r2.accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId: cfg.r2.accessKeyId, secretAccessKey: cfg.r2.secretAccessKey },
        forcePathStyle: true,
        // O R2 não aceita todos os checksums que as versões recentes do SDK enviam por padrão.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      });
    }
  }

  get usaR2(): boolean {
    return !!this.s3;
  }

  /** Grava o XML e devolve o caminho a guardar no banco. */
  async salvar(caminho: string, xml: string | Buffer): Promise<string> {
    if (this.s3) {
      await this.enviarR2(caminho, selar(xml, this.chave));
      return PREFIXO_R2 + caminho;
    }
    // Sem R2 configurado: formato antigo (gzip no Supabase Storage)
    const destino = `${caminho}.gz`;
    const gz = zlib.gzipSync(typeof xml === 'string' ? Buffer.from(xml, 'utf8') : xml);
    const r = await this.db.storage.from(this.cfg.bucketSupabase).upload(destino, gz, { contentType: 'application/gzip', upsert: true });
    if (r.error) throw new Error(`Upload ${destino}: ${r.error.message}`);
    return destino;
  }

  /** Lê o arquivo bruto (como está guardado), de onde estiver. */
  async lerBruto(caminhoBanco: string): Promise<Buffer> {
    if (caminhoBanco.startsWith(PREFIXO_R2)) {
      if (!this.s3) throw new Error('Arquivo está no R2, mas as credenciais do R2 não estão configuradas.');
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.cfg.r2!.bucket, Key: caminhoBanco.slice(PREFIXO_R2.length) }));
      return Buffer.from(await r.Body!.transformToByteArray());
    }
    const r = await this.db.storage.from(this.cfg.bucketSupabase).download(caminhoBanco);
    if (r.error || !r.data) throw new Error(r.error?.message ?? `arquivo não encontrado: ${caminhoBanco}`);
    return Buffer.from(await r.data.arrayBuffer());
  }

  /** Lê e devolve o XML em texto puro. */
  async ler(caminhoBanco: string): Promise<Buffer> {
    return abrir(await this.lerBruto(caminhoBanco), this.chave);
  }

  /** Envia bytes já selados ao R2 (usado pela migração). */
  async enviarR2(chaveObjeto: string, conteudo: Buffer): Promise<void> {
    if (!this.s3) throw new Error('R2 não configurado.');
    await this.s3.send(new PutObjectCommand({
      Bucket: this.cfg.r2!.bucket, Key: chaveObjeto, Body: conteudo, ContentType: 'application/octet-stream',
    }));
  }

  /** Remove o arquivo antigo do Supabase Storage (depois de migrado). */
  async removerSupabase(caminhos: string[]): Promise<void> {
    if (!caminhos.length) return;
    const r = await this.db.storage.from(this.cfg.bucketSupabase).remove(caminhos);
    if (r.error) throw new Error(`Remover do Supabase: ${r.error.message}`);
  }

  selarXml(xml: Buffer): Buffer {
    return selar(xml, this.chave);
  }
}
