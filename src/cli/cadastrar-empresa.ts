/**
 * Cadastra (ou atualiza) uma empresa e o certificado A1 dela no banco.
 * O PFX e a senha são gravados cifrados com a MASTER_KEY.
 *
 *   CERT_PATH=./certificados/cliente.pfx UF=ES REGIME=simples npm run cadastrar-empresa
 *   Opcionais: RAZAO_SOCIAL, CODIGO_ERP, CNPJ (se o CNPJ não estiver no certificado)
 */
import 'dotenv/config';
import fs from 'fs';
import { lerPfx } from '../cert';
import { configWorker } from '../config';
import { cifrar } from '../cripto';
import { criarDb, ok } from '../db';
import { codigoUf } from '../uf';
import { perguntarSenha } from './senha';

async function main() {
  const cfg = configWorker();
  const certPath = process.env.CERT_PATH;
  if (!certPath) throw new Error('Informe CERT_PATH com o caminho do arquivo .pfx');
  const uf = (process.env.UF ?? '').toUpperCase();
  if (!uf) throw new Error('Informe UF (ex.: UF=ES)');
  const senha = process.env.CERT_SENHA ?? (await perguntarSenha());

  const pfx = fs.readFileSync(certPath);
  const cert = lerPfx(pfx, senha);
  const cnpj = (process.env.CNPJ ?? cert.cnpj ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14) throw new Error('Não achei o CNPJ no certificado. Informe CNPJ=...');
  if (cert.cnpj && cert.cnpj.slice(0, 8) !== cnpj.slice(0, 8)) {
    throw new Error(`O certificado é do CNPJ ${cert.cnpj}, que não tem a mesma raiz de ${cnpj}.`);
  }
  if (cert.validoAte.getTime() < Date.now()) throw new Error('Certificado vencido.');

  const db = criarDb(cfg.supabaseUrl, cfg.supabaseServiceKey);

  const empresa = ok(
    await db
      .from('empresas')
      .upsert(
        {
          cnpj,
          razao_social: process.env.RAZAO_SOCIAL ?? cert.titular,
          uf,
          c_uf: codigoUf(uf),
          regime: process.env.REGIME ?? null,
          codigo_erp: process.env.CODIGO_ERP ?? null,
          ativo: true,
        },
        { onConflict: 'cnpj' },
      )
      .select('id')
      .single(),
    'salvar empresa',
  ) as { id: string };

  ok(await db.from('certificados').update({ ativo: false }).eq('empresa_id', empresa.id).eq('ativo', true), 'desativar certificado antigo');
  ok(
    await db.from('certificados').insert({
      empresa_id: empresa.id,
      cnpj_certificado: cert.cnpj,
      titular: cert.titular,
      valido_de: cert.validoDe.toISOString(),
      valido_ate: cert.validoAte.toISOString(),
      pfx_cifrado: cifrar(pfx, cfg.masterKey),
      senha_cifrada: cifrar(Buffer.from(senha, 'utf8'), cfg.masterKey),
    }),
    'salvar certificado',
  );

  console.log(`Empresa ${cnpj} cadastrada (${cert.titular}).`);
  console.log(`Certificado válido até ${cert.validoAte.toLocaleDateString('pt-BR')}.`);
  console.log('Ela entra na próxima rodada do coletor.');
}

main().catch((e) => {
  console.error(`Erro: ${(e as Error).message}`);
  process.exit(1);
});
