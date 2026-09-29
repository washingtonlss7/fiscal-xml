/**
 * Teste direto com a SEFAZ, sem banco de dados.
 * Consulta o DistribuicaoDFe com um certificado A1 e salva os XMLs em ./saida.
 *
 *   CERT_PATH=./certificados/cliente.pfx UF=ES npm run teste-sefaz
 *   (a senha é pedida no terminal, ou pode vir em CERT_SENHA)
 *
 * Guarda o último NSU em ./saida/<cnpj>/<modelo>/estado.json para continuar de onde parou
 * e se recusa a consultar antes de 1 hora quando a SEFAZ disser que não há mais documentos.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { criarAgente, lerPfxArquivo } from '../cert';
import { tpAmb } from '../config';
import { consultarDistNSU, Modelo, nsu15 } from '../sefaz/distDFe';
import { interpretar } from '../sefaz/documentos';
import { codigoUf } from '../uf';
import { esperar } from '../util';
import { perguntarSenha } from './senha';

interface Estado {
  ultNSU: string;
  maxNSU?: string;
  proximaConsultaEm?: string;
  ultimoCStat?: string;
}

async function main() {
  const certPath = process.env.CERT_PATH;
  if (!certPath) throw new Error('Informe CERT_PATH com o caminho do arquivo .pfx');
  const senha = process.env.CERT_SENHA ?? (await perguntarSenha());
  const uf = (process.env.UF ?? 'ES').toUpperCase();
  const modelo = (process.env.MODELO ?? 'nfe').toLowerCase() as Modelo;
  if (modelo !== 'nfe' && modelo !== 'cte') throw new Error('MODELO deve ser nfe ou cte');
  const maxChamadas = Number(process.env.MAX_CHAMADAS ?? '10');
  const amb = tpAmb();

  const cert = lerPfxArquivo(certPath, senha);
  const cnpj = (process.env.CNPJ ?? cert.cnpj ?? '').replace(/\D/g, '');
  if (cnpj.length !== 14) throw new Error('Não achei o CNPJ no certificado. Informe CNPJ=...');

  console.log(`Certificado: ${cert.titular}`);
  console.log(`CNPJ: ${cnpj} | válido até ${cert.validoAte.toLocaleDateString('pt-BR')}`);
  console.log(`Ambiente: ${amb === 1 ? 'PRODUÇÃO' : 'homologação'} | UF autor: ${uf} | modelo: ${modelo.toUpperCase()}`);
  if (cert.validoAte.getTime() < Date.now()) throw new Error('Certificado vencido.');

  const pasta = path.join('saida', cnpj, modelo);
  fs.mkdirSync(pasta, { recursive: true });
  const arqEstado = path.join(pasta, 'estado.json');
  const estado: Estado = fs.existsSync(arqEstado)
    ? JSON.parse(fs.readFileSync(arqEstado, 'utf8'))
    : { ultNSU: nsu15(process.env.ULT_NSU ?? '0') };

  if (estado.proximaConsultaEm && new Date(estado.proximaConsultaEm).getTime() > Date.now() && process.env.FORCAR !== '1') {
    console.log(
      `\nA SEFAZ pede para aguardar. Próxima consulta liberada em ${new Date(estado.proximaConsultaEm).toLocaleString('pt-BR')}.` +
        '\nConsultar antes disso pode gerar o erro 656 e bloquear o CNPJ por 1 hora.',
    );
    return;
  }

  const agente = criarAgente(cert);
  const contagem: Record<string, number> = {};
  let totalDocs = 0;

  try {
    for (let i = 1; i <= maxChamadas; i++) {
      console.log(`\nConsulta ${i}: ultNSU=${estado.ultNSU}`);
      const ret = await consultarDistNSU(modelo, agente, { tpAmb: amb, cUF: codigoUf(uf), cnpj, ultNSU: estado.ultNSU });
      console.log(`  cStat ${ret.cStat} - ${ret.xMotivo} | ultNSU ${ret.ultNSU} | maxNSU ${ret.maxNSU} | ${ret.docs.length} doc(s)`);
      estado.ultimoCStat = ret.cStat;

      for (const doc of ret.docs) {
        const info = interpretar(doc.schema, doc.xml);
        const tipo = doc.schema.split('_')[0];
        contagem[tipo] = (contagem[tipo] ?? 0) + 1;
        const chave = info.tipo === 'desconhecido' ? 'sem-chave' : info.chave;
        fs.writeFileSync(path.join(pasta, `${doc.nsu}-${tipo}-${chave}.xml`), doc.xml);
        totalDocs++;
      }

      if (ret.cStat === '138') {
        const avancou = ret.ultNSU > estado.ultNSU;
        if (avancou) estado.ultNSU = ret.ultNSU;
        estado.maxNSU = ret.maxNSU;
        if (!avancou || ret.ultNSU >= ret.maxNSU) {
          estado.proximaConsultaEm = new Date(Date.now() + 61 * 60_000).toISOString();
          break;
        }
        fs.writeFileSync(arqEstado, JSON.stringify(estado, null, 2));
        await esperar(1500);
        continue;
      }
      if (ret.cStat === '137' || ret.cStat === '656') {
        if (ret.ultNSU > estado.ultNSU) estado.ultNSU = ret.ultNSU;
        estado.maxNSU = ret.maxNSU;
        estado.proximaConsultaEm = new Date(Date.now() + (ret.cStat === '656' ? 65 : 61) * 60_000).toISOString();
        break;
      }
      break; // outra rejeição: para e mostra o motivo
    }
  } finally {
    fs.writeFileSync(arqEstado, JSON.stringify(estado, null, 2));
    agente.destroy();
  }

  console.log(`\nResumo: ${totalDocs} documento(s) salvos em ${pasta}`);
  for (const [tipo, n] of Object.entries(contagem)) console.log(`  ${tipo}: ${n}`);
  console.log(`Último NSU: ${estado.ultNSU}${estado.maxNSU ? ` de ${estado.maxNSU}` : ''}`);
  if (estado.proximaConsultaEm) {
    console.log(`Próxima consulta liberada em: ${new Date(estado.proximaConsultaEm).toLocaleString('pt-BR')}`);
  }
}

main().catch((e) => {
  console.error(`\nErro: ${(e as Error).message}`);
  process.exit(1);
});
