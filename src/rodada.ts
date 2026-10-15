import https from 'https';
import { Certificado, criarAgente, lerPfx } from './cert';
import { Armazenamento } from './armazenamento';
import { ConfigWorker } from './config';
import { decifrar } from './cripto';
import { buscarTodos, Db, ok } from './db';
import { log } from './log';
import { manifestarPendentes } from './manifestacao';
import { Modelo } from './sefaz/distDFe';
import { ContextoSync, ResultadoSync, sincronizarModelo } from './sync';
import { dentroDaJanela, emParalelo } from './util';
import { ResultadoNfse, sincronizarNfse } from './nfse/sync';

export interface EmpresaRow {
  id: string;
  cnpj: string;
  razao_social: string;
  c_uf: number;
  captar_nfe: boolean;
  captar_cte: boolean;
  escritorio: boolean;
  manifestar_ciencia: boolean;
}

export interface CertRow {
  id: string;
  empresa_id: string;
  pfx_cifrado: string;
  senha_cifrada: string;
  valido_ate: string;
}

const COLUNAS_EMPRESA = 'id,cnpj,razao_social,c_uf,captar_nfe,captar_cte,escritorio,manifestar_ciencia';
const COLUNAS_CERT = 'id,empresa_id,pfx_cifrado,senha_cifrada,valido_ate';

/** Empresas em sincronização agora (evita duas consultas simultâneas do mesmo CNPJ). */
export const emAndamento = new Set<string>();

/**
 * Certificados já abertos, por id do registro. Abrir um PFX (node-forge) custa CPU;
 * com 1.000 empresas consultando várias vezes ao dia, reaproveitar faz diferença.
 * Um certificado novo gera outro registro (outro id), então o cache nunca fica desatualizado.
 */
const certsAbertos = new Map<string, Certificado>();

function abrirCertificado(row: CertRow, masterKey: string): Certificado {
  let c = certsAbertos.get(row.id);
  if (!c) {
    const pfx = decifrar(row.pfx_cifrado, masterKey);
    const senha = decifrar(row.senha_cifrada, masterKey).toString('utf8');
    c = lerPfx(pfx, senha);
    certsAbertos.set(row.id, c);
  }
  return c;
}

/** Mapa CNPJ -> empresa (para distribuir notas recebidas pelo escritório via autXML), renovado a cada 5 min. */
let cacheClientes: { em: number; mapa?: ContextoSync['clientes'] } = { em: 0 };
export async function mapaClientes(db: Db): Promise<ContextoSync['clientes']> {
  if (Date.now() - cacheClientes.em < 5 * 60_000) return cacheClientes.mapa;
  const todas = await buscarTodos<{ id: string; cnpj: string; escritorio: boolean; ativo: boolean }>(
    (de, ate) => db.from('empresas').select('id,cnpj,escritorio,ativo').range(de, ate),
    'mapa de clientes',
  );
  const temEscritorio = todas.some((e) => e.escritorio && e.ativo);
  cacheClientes = { em: Date.now(), mapa: temEscritorio ? new Map(todas.map((e) => [e.cnpj, { id: e.id, cnpj: e.cnpj }])) : undefined };
  return cacheClientes.mapa;
}

export function novoContexto(db: Db, cfg: ConfigWorker, arm: Armazenamento, clientes: ContextoSync['clientes'], manual = false): ContextoSync {
  return {
    db, arm, tpAmb: cfg.tpAmb, maxChamadasPorRodada: cfg.maxChamadasPorRodada,
    intervaloMs: cfg.intervaloHoras * 3600_000, clientes, manual,
    // Pedido manual (botão Sincronizar) consulta na hora, a qualquer horário; a busca automática fica na janela
    podeConsultar: manual ? () => true : () => dentroDaJanela(cfg.janela),
  };
}

/** Lê as empresas e os certificados ativos das empresas indicadas (ou de todas). */
export async function carregarEmpresas(db: Db, ids?: string[]): Promise<{ empresas: EmpresaRow[]; certs: Map<string, CertRow> }> {
  const empresas = await buscarTodos<EmpresaRow>((de, ate) => {
    let q = db.from('empresas').select(COLUNAS_EMPRESA).eq('ativo', true);
    if (ids?.length) q = q.in('id', ids);
    return q.order('cnpj').range(de, ate);
  }, 'listar empresas');
  if (!empresas.length) return { empresas, certs: new Map() };
  const lista = await buscarTodos<CertRow>((de, ate) => {
    let q = db.from('certificados').select(COLUNAS_CERT).eq('ativo', true);
    if (ids?.length) q = q.in('empresa_id', ids);
    return q.range(de, ate);
  }, 'listar certificados');
  return { empresas, certs: new Map(lista.map((c) => [c.empresa_id, c])) };
}

/** Garante uma linha de controle de NSU para cada empresa/modelo ativo. */
export async function garantirSyncState(db: Db, empresas: EmpresaRow[]): Promise<void> {
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
}

export type ResultadoEmpresa =
  | { situacao: 'ocupada' | 'sem_certificado' | 'vencido'; nfse?: ResultadoNfse }
  | { situacao: 'ok'; resultados: ResultadoSync[]; documentos: number; nfse?: ResultadoNfse }
  | { situacao: 'erro'; mensagem: string; nfse?: ResultadoNfse };

/** Empresas com a captação de NFS-e em andamento (agendador próprio, separado do da NF-e). */
export const nfseEmAndamento = new Set<string>();

/** Captação de NFS-e (ADN) de uma empresa, com o certificado dela. */
export async function sincronizarNfseEmpresa(
  db: Db, cfg: ConfigWorker, arm: Armazenamento, empresa: Pick<EmpresaRow, 'id' | 'cnpj'>, cert: CertRow | undefined, manual = false,
): Promise<ResultadoNfse> {
  if (nfseEmAndamento.has(empresa.id)) return { status: 'aguardando', chamadas: 0, documentos: 0, mensagem: 'captação de NFS-e já em andamento' };
  if (!cert) return { status: 'erro', chamadas: 0, documentos: 0, mensagem: 'Empresa sem certificado ativo.' };
  if (new Date(cert.valido_ate).getTime() < Date.now()) return { status: 'erro', chamadas: 0, documentos: 0, mensagem: 'Certificado vencido.' };
  nfseEmAndamento.add(empresa.id);
  let agente: https.Agent | undefined;
  try {
    agente = criarAgente(abrirCertificado(cert, cfg.masterKey));
    return await sincronizarNfse({
      db, arm, tpAmb: cfg.tpAmb, maxChamadas: cfg.maxChamadasPorRodada, intervaloMs: cfg.intervaloHoras * 3600_000, manual,
      podeConsultar: manual ? () => true : () => dentroDaJanela(cfg.janela),
    }, empresa, agente);
  } catch (e) {
    certsAbertos.delete(cert.id);
    const mensagem = (e as Error).message;
    log.error('falha na captação de NFS-e', { cnpj: empresa.cnpj, erro: mensagem });
    return { status: 'erro', chamadas: 0, documentos: 0, mensagem };
  } finally {
    agente?.destroy();
    nfseEmAndamento.delete(empresa.id);
  }
}

/** Sincroniza uma empresa: NF-e, CT-e e, se for o caso, ciência das notas que chegaram só como resumo. */
export async function sincronizarEmpresa(
  ctx: ContextoSync,
  cfg: ConfigWorker,
  empresa: EmpresaRow,
  cert: CertRow | undefined,
): Promise<ResultadoEmpresa> {
  if (emAndamento.has(empresa.id)) return { situacao: 'ocupada' };
  if (!cert) {
    log.warn('empresa sem certificado ativo', { cnpj: empresa.cnpj });
    return { situacao: 'sem_certificado' };
  }
  if (new Date(cert.valido_ate).getTime() < Date.now()) {
    log.warn('certificado vencido', { cnpj: empresa.cnpj, valido_ate: cert.valido_ate });
    return { situacao: 'vencido' };
  }

  emAndamento.add(empresa.id);
  let agente: https.Agent | undefined;
  try {
    const certificado = abrirCertificado(cert, cfg.masterKey);
    agente = criarAgente(certificado);

    const modelos: Modelo[] = [
      ...(empresa.captar_nfe ? (['nfe'] as const) : []),
      ...(empresa.captar_cte ? (['cte'] as const) : []),
    ];
    const resultados: ResultadoSync[] = [];
    for (const modelo of modelos) resultados.push(await sincronizarModelo(ctx, empresa, modelo, agente));

    // Notas que chegaram só como resumo: dá ciência para a SEFAZ liberar o XML completo.
    if (empresa.captar_nfe && empresa.manifestar_ciencia && !empresa.escritorio && (!ctx.podeConsultar || ctx.podeConsultar())) {
      await manifestarPendentes(ctx.db, cfg.tpAmb, empresa, certificado, agente);
    }
    const documentos = resultados.reduce((s, r) => s + r.documentos, 0);
    if (documentos > 0 || resultados.some((r) => r.status !== 'ok' && r.status !== 'aguardando')) {
      log.info('empresa sincronizada', { cnpj: empresa.cnpj, documentos, resultados });
    }
    return { situacao: 'ok', resultados, documentos };
  } catch (e) {
    const mensagem = (e as Error).message;
    // Senha errada ou PFX ilegível não se resolve sozinho: tira do cache para reler se o certificado mudar.
    certsAbertos.delete(cert.id);
    log.error('falha ao sincronizar empresa', { cnpj: empresa.cnpj, erro: mensagem });
    return { situacao: 'erro', mensagem };
  } finally {
    agente?.destroy();
    emAndamento.delete(empresa.id);
  }
}

/** Sincroniza agora as empresas indicadas (botão "Sincronizar agora" do painel). */
export async function executarRodada(
  db: Db,
  cfg: ConfigWorker,
  arm: Armazenamento,
  ids: string[],
  progresso?: ContextoSync['progresso'],
): Promise<Record<string, ResultadoEmpresa>> {
  const { empresas, certs } = await carregarEmpresas(db, ids);
  await garantirSyncState(db, empresas);
  const ctx = { ...novoContexto(db, cfg, arm, await mapaClientes(db), true), progresso };
  const saida: Record<string, ResultadoEmpresa> = {};
  const comNfse = new Set((ok(await db.from('nfse_captacao').select('empresa_id').eq('ativo', true).in('empresa_id', empresas.map((e) => e.id)), 'empresas com NFS-e') as { empresa_id: string }[]).map((x) => x.empresa_id));
  await emParalelo(empresas, cfg.concorrencia, async (e) => {
    saida[e.id] = await sincronizarEmpresa(ctx, cfg, e, certs.get(e.id));
    if (comNfse.has(e.id)) saida[e.id].nfse = await sincronizarNfseEmpresa(db, cfg, arm, e, certs.get(e.id), true);
  });
  return saida;
}
