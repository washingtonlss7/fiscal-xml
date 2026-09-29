import { lerPfx } from './cert';
import { cifrar } from './cripto';
import { Db, ok } from './db';
import { CODIGO_UF, codigoUf } from './uf';

export class ErroValidacao extends Error {}

const REGIMES = new Set(['mei', 'simples', 'presumido', 'real']);

export interface DadosCadastro {
  pfx: Buffer;
  senha: string;
  uf: string;
  cnpj?: string;
  razaoSocial?: string;
  regime?: string | null;
  codigoErp?: string | null;
  /** Certificado do escritório (recebe as notas dos clientes pela tag autXML). */
  escritorio?: boolean;
}

export interface EmpresaCadastrada {
  id: string;
  cnpj: string;
  razaoSocial: string;
  titular: string;
  validoAte: string;
  novoCadastro: boolean;
}

/**
 * Cadastra a empresa (ou atualiza, se o CNPJ já existir) e grava o certificado A1 cifrado.
 * O certificado anterior, se houver, é desativado. Usado pelo painel e pela linha de comando.
 */
export async function salvarEmpresaComCertificado(db: Db, masterKey: string, d: DadosCadastro): Promise<EmpresaCadastrada> {
  const uf = (d.uf ?? '').trim().toUpperCase();
  if (!CODIGO_UF[uf]) throw new ErroValidacao('Informe a UF da empresa.');
  const regime = d.regime ? d.regime.trim().toLowerCase() : null;
  if (regime && !REGIMES.has(regime)) throw new ErroValidacao('Regime inválido.');
  if (!d.pfx?.length) throw new ErroValidacao('Envie o arquivo do certificado (.pfx ou .p12).');
  if (d.pfx.length > 50_000) throw new ErroValidacao('O arquivo é grande demais para um certificado A1.');
  if (!d.senha) throw new ErroValidacao('Informe a senha do certificado.');

  let cert;
  try {
    cert = lerPfx(d.pfx, d.senha);
  } catch (e) {
    throw new ErroValidacao((e as Error).message);
  }

  const cnpjInformado = (d.cnpj ?? '').replace(/\D/g, '');
  const cnpj = cnpjInformado || cert.cnpj || '';
  if (cnpj.length !== 14) {
    throw new ErroValidacao('Não encontrei o CNPJ dentro do certificado. Informe o CNPJ da empresa.');
  }
  if (cert.cnpj && cert.cnpj.slice(0, 8) !== cnpj.slice(0, 8)) {
    throw new ErroValidacao(`Este certificado é do CNPJ ${formatarCnpj(cert.cnpj)}, que não pertence à empresa ${formatarCnpj(cnpj)}.`);
  }
  if (cert.validoAte.getTime() < Date.now()) {
    throw new ErroValidacao(`Certificado vencido em ${cert.validoAte.toLocaleDateString('pt-BR')}.`);
  }

  const existente = ok(
    await db.from('empresas').select('id,razao_social,escritorio').eq('cnpj', cnpj).maybeSingle(),
    'consultar empresa',
  ) as { id: string; razao_social: string; escritorio: boolean } | null;
  const escritorio = d.escritorio ?? existente?.escritorio ?? false;

  const razaoSocial = d.razaoSocial?.trim() || existente?.razao_social || cert.titular;
  const empresa = ok(
    await db
      .from('empresas')
      .upsert(
        {
          cnpj,
          razao_social: razaoSocial,
          uf,
          c_uf: codigoUf(uf),
          regime,
          codigo_erp: d.codigoErp?.trim() || null,
          escritorio,
          // O escritório não é destinatário das notas dos clientes: não dá ciência em nome deles.
          manifestar_ciencia: !escritorio,
          ativo: true,
        },
        { onConflict: 'cnpj' },
      )
      .select('id')
      .single(),
    'salvar empresa',
  ) as { id: string };

  ok(
    await db.from('certificados').update({ ativo: false }).eq('empresa_id', empresa.id).eq('ativo', true),
    'desativar certificado anterior',
  );
  ok(
    await db.from('certificados').insert({
      empresa_id: empresa.id,
      cnpj_certificado: cert.cnpj,
      titular: cert.titular,
      valido_de: cert.validoDe.toISOString(),
      valido_ate: cert.validoAte.toISOString(),
      pfx_cifrado: cifrar(d.pfx, masterKey),
      senha_cifrada: cifrar(Buffer.from(d.senha, 'utf8'), masterKey),
    }),
    'salvar certificado',
  );

  // Cria o controle de NSU e libera nova tentativa se a empresa estava com erro (ex.: certificado vencido).
  ok(
    await db.from('sync_state').upsert(
      [
        { empresa_id: empresa.id, modelo: 'nfe' },
        { empresa_id: empresa.id, modelo: 'cte' },
      ],
      { onConflict: 'empresa_id,modelo', ignoreDuplicates: true },
    ),
    'criar sync_state',
  );
  ok(
    await db
      .from('sync_state')
      .update({ erros_consecutivos: 0, proxima_consulta_em: new Date().toISOString() })
      .eq('empresa_id', empresa.id)
      .gt('erros_consecutivos', 0)
      .or('ultimo_cstat.is.null,ultimo_cstat.neq.656'),
    'liberar nova tentativa',
  );

  return {
    id: empresa.id,
    cnpj,
    razaoSocial,
    titular: cert.titular,
    validoAte: cert.validoAte.toISOString(),
    novoCadastro: !existente,
  };
}

export function formatarCnpj(c: string): string {
  return c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}
