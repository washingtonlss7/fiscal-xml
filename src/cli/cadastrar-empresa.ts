/**
 * Cadastra (ou atualiza) uma empresa e o certificado A1 dela no banco.
 * O PFX e a senha são gravados cifrados com a MASTER_KEY.
 * O mesmo cadastro pode ser feito pelo painel web.
 *
 *   CERT_PATH=./certificados/cliente.pfx UF=ES REGIME=simples npm run cadastrar-empresa
 *   Opcionais: RAZAO_SOCIAL, CODIGO_ERP, CNPJ (se o CNPJ não estiver no certificado)
 */
import 'dotenv/config';
import fs from 'fs';
import { configWorker } from '../config';
import { criarDb } from '../db';
import { formatarCnpj, salvarEmpresaComCertificado } from '../empresas';
import { perguntarSenha } from './senha';

async function main() {
  const cfg = configWorker();
  const certPath = process.env.CERT_PATH;
  if (!certPath) throw new Error('Informe CERT_PATH com o caminho do arquivo .pfx');
  const senha = process.env.CERT_SENHA ?? (await perguntarSenha());

  const r = await salvarEmpresaComCertificado(criarDb(cfg.supabaseUrl, cfg.supabaseServiceKey), cfg.masterKey, {
    pfx: fs.readFileSync(certPath),
    senha,
    uf: process.env.UF ?? '',
    cnpj: process.env.CNPJ,
    razaoSocial: process.env.RAZAO_SOCIAL,
    regime: process.env.REGIME ?? null,
    codigoErp: process.env.CODIGO_ERP ?? null,
  });

  console.log(`${r.novoCadastro ? 'Empresa cadastrada' : 'Certificado atualizado'}: ${formatarCnpj(r.cnpj)} (${r.razaoSocial}).`);
  console.log(`Certificado válido até ${new Date(r.validoAte).toLocaleDateString('pt-BR')}.`);
  console.log('Ela entra na próxima rodada do coletor.');
}

main().catch((e) => {
  console.error(`Erro: ${(e as Error).message}`);
  process.exit(1);
});
