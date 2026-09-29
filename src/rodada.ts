import { criarAgente, lerPfx } from './cert';
import { ConfigWorker } from './config';
import { decifrar } from './cripto';
import { buscarTodos, Db, ok } from './db';
import { log } from './log';
import { Modelo } from './sefaz/distDFe';
import { ContextoSync, ResultadoSync, sincronizarModelo } from './sync';
import { emParalelo } from './util';

interface EmpresaRow {
  id: string;
  cnpj: string;
  razao_social: string;
  c_uf: number;
  captar_nfe: boolean;
  captar_cte: boolean;
}

interface CertRow {
  empresa_id: string;
  pfx_cifrado: string;
  senha_cifrada: string;
  valido_ate: string;
}

/** Empresas em sincronização agora (evita duas consultas simultâneas do mesmo CNPJ). */
const emAndamento = new Set<string>();

export interface ResumoRodada {
  empresas: number;
  documentos: number;
  erros: number;
  duracaoMs: number;
}

export async function executarRodada(
  db: Db,
  cfg: ConfigWorker,
  somenteEmpresas?: string[],
): Promise<ResumoRodada & { resultados: Record<string, ResultadoSync[]> }> {
  const inicio = Date.now();

  const empresas = await buscarTodos<EmpresaRow>((de, ate) => {
    let q = db.from('empresas').select('id,cnpj,razao_social,c_uf,captar_nfe,captar_cte').eq('ativo', true);
    if (somenteEmpresas?.length) q = q.in('id', somenteEmpresas);
    return q.order('cnpj').range(de, ate);
  }, 'listar empresas');

  const certs = await buscarTodos<CertRow>(
    (de, ate) =>
      db.from('certificados').select('empresa_id,pfx_cifrado,senha_cifrada,valido_ate').eq('ativo', true).range(de, ate),
    'listar certificados',
  );
  const certPorEmpresa = new Map(certs.map((c) => [c.empresa_id, c]));

  // Garante uma linha de controle de NSU para cada empresa/modelo.
  const estados = empresas.flatMap((e) => [
    ...(e.captar_nfe ? [{ empresa_id: e.id, modelo: 'nfe' }] : []),
    ...(e.captar_cte ? [{ empresa_id: e.id, modelo: 'cte' }] : []),
  ]);
  for (let i = 0; i < estados.length; i += 500) {
    ok(
      await db.from('sync_state').upsert(estados.slice(i, i + 500), { onConflict: 'empresa_id,modelo', ignoreDuplicates: true }),
      'criar sync_state',
    );
  }

  const ctx: ContextoSync = { db, bucket: cfg.bucket, tpAmb: cfg.tpAmb, maxChamadasPorRodada: cfg.maxChamadasPorRodada };
  const resultados: Record<string, ResultadoSync[]> = {};
  let documentos = 0;
  let erros = 0;

  log.info('rodada iniciada', { empresas: empresas.length });

  await emParalelo(empresas, cfg.concorrencia, async (empresa) => {
    if (emAndamento.has(empresa.id)) return;
    const cert = certPorEmpresa.get(empresa.id);
    if (!cert) {
      log.warn('empresa sem certificado ativo', { cnpj: empresa.cnpj });
      return;
    }
    if (new Date(cert.valido_ate).getTime() < Date.now()) {
      log.warn('certificado vencido', { cnpj: empresa.cnpj, valido_ate: cert.valido_ate });
      erros++;
      return;
    }

    emAndamento.add(empresa.id);
    let agente: ReturnType<typeof criarAgente> | undefined;
    try {
      const pfx = decifrar(cert.pfx_cifrado, cfg.masterKey);
      const senha = decifrar(cert.senha_cifrada, cfg.masterKey).toString('utf8');
      agente = criarAgente(lerPfx(pfx, senha));

      const modelos: Modelo[] = [
        ...(empresa.captar_nfe ? (['nfe'] as const) : []),
        ...(empresa.captar_cte ? (['cte'] as const) : []),
      ];
      const lista: ResultadoSync[] = [];
      for (const modelo of modelos) {
        const r = await sincronizarModelo(ctx, empresa, modelo, agente);
        lista.push(r);
        documentos += r.documentos;
        if (r.status === 'erro') erros++;
      }
      resultados[empresa.id] = lista;
      const total = lista.reduce((s, r) => s + r.documentos, 0);
      if (total > 0 || lista.some((r) => r.status !== 'ok' && r.status !== 'aguardando')) {
        log.info('empresa sincronizada', { cnpj: empresa.cnpj, documentos: total, resultados: lista });
      }
    } catch (e) {
      erros++;
      log.error('falha ao sincronizar empresa', { cnpj: empresa.cnpj, erro: (e as Error).message });
    } finally {
      agente?.destroy();
      emAndamento.delete(empresa.id);
    }
  });

  const resumo = { empresas: empresas.length, documentos, erros, duracaoMs: Date.now() - inicio };
  log.info('rodada concluída', { ...resumo });
  return { ...resumo, resultados };
}
