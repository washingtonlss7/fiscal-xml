/**
 * Appura NFC-e Worker: processo separado do coletor (serviço próprio no Easypanel: `node dist/nfce/worker.js`).
 * Uma falha, reinício ou excesso de memória aqui não afeta o coletor.
 *
 * Fase 1: infraestrutura (agenda, checkpoint, execuções, lock, retry, circuit breaker, sinal de vida).
 * O registro de conectores fica VAZIO: nenhuma chamada à SEFAZ e nenhum navegador.
 */
import crypto from 'crypto';
import os from 'os';
import 'dotenv/config';
import { Armazenamento, configArmazenamento } from '../armazenamento';
import { criarDb, Db, ok } from '../db';
import { log } from '../log';
import { registrarStatus } from '../status';
import { backoffMs, CircuitBreaker, datasPendentes, deveAgendar, diaSP } from './agenda';
import { EmpresaNfce, RegistroConectores } from './conector';
import { avancarCheckpoint, executarDia, VERSAO_WORKER } from './execucoes';

export interface ConfigEmpresa { empresa_id: string; ativo: boolean; horario: string; janela_dias: number; max_tentativas: number; backoff_base_seg: number }
export interface Checkpoint {
  empresa_id: string; uf: string; ultima_data_ok: string | null; ultima_tentativa_em: string | null; tentativas_seguidas: number; proxima_tentativa_em: string | null; status: string;
}

export interface DepsCiclo {
  db: Db; conectores: RegistroConectores; arm: Armazenamento | null; dono: string; breaker: CircuitBreaker;
  agora?: () => Date; aleatorio?: () => number; pausaDownloadMs?: number; esperar?: (ms: number) => Promise<void>;
}

/** Empresas com a automação ligada, ativas e com certificado dentro da validade. */
export async function empresasHabilitadas(db: Db, agora: Date): Promise<{ empresa: EmpresaNfce; cfg: ConfigEmpresa }[]> {
  const cfgs = ok(await db.from('nfce_config').select('*').eq('ativo', true).limit(5000), 'nfce_config') as ConfigEmpresa[];
  if (!cfgs.length) return [];
  const ids = cfgs.map((c) => c.empresa_id);
  const emps = ok(await db.from('empresas').select('id,cnpj,uf,razao_social,ativo').in('id', ids), 'empresas') as (EmpresaNfce & { ativo: boolean })[];
  const certs = ok(await db.from('certificados').select('empresa_id,valido_ate').in('empresa_id', ids).eq('ativo', true), 'certificados') as { empresa_id: string; valido_ate: string }[];
  const certOk = new Set(certs.filter((c) => new Date(c.valido_ate).getTime() > agora.getTime()).map((c) => c.empresa_id));
  const porId = new Map(emps.filter((e) => e.ativo && certOk.has(e.id)).map((e) => [e.id, e]));
  return cfgs.filter((c) => porId.has(c.empresa_id)).map((c) => { const e = porId.get(c.empresa_id)!; return { empresa: { id: e.id, cnpj: e.cnpj, uf: String(e.uf).toUpperCase(), razao_social: e.razao_social }, cfg: c }; });
}

async function lerCheckpoint(db: Db, e: EmpresaNfce): Promise<Checkpoint> {
  const cp = ok(await db.from('nfce_checkpoint').select('*').eq('empresa_id', e.id).maybeSingle(), 'checkpoint') as Checkpoint | null;
  if (cp) return cp;
  ok(await db.from('nfce_checkpoint').upsert({ empresa_id: e.id, uf: e.uf, status: 'nunca' }, { onConflict: 'empresa_id', ignoreDuplicates: true }), 'criar checkpoint');
  return { empresa_id: e.id, uf: e.uf, ultima_data_ok: null, ultima_tentativa_em: null, tentativas_seguidas: 0, proxima_tentativa_em: null, status: 'nunca' };
}

/** Processa uma empresa: datas pendentes em ordem, checkpoint só com dias concluídos em sequência, retry limitado. */
export async function processarEmpresa(deps: DepsCiclo, empresa: EmpresaNfce, cfg: ConfigEmpresa, origem: 'agendada' | 'manual' = 'agendada') {
  const { db } = deps;
  const agora = (deps.agora ?? (() => new Date()))();
  const cp = await lerCheckpoint(db, empresa);
  const retryVencido = !!cp.proxima_tentativa_em && cp.proxima_tentativa_em <= agora.toISOString();
  if (origem === 'agendada' && !deveAgendar(cfg.horario, agora, cp.ultima_tentativa_em) && !retryVencido) return { situacao: 'fora_do_horario' as const };
  if (!deps.conectores.descobertaDe(empresa.uf)) {
    ok(await db.from('nfce_checkpoint').update({ ultima_tentativa_em: agora.toISOString(), erro_codigo: 'SEM_CONECTOR', erro_mensagem: `Ainda não há conector de NFC-e para ${empresa.uf}.`, atualizado_em: agora.toISOString() }).eq('empresa_id', empresa.id), 'checkpoint sem conector');
    return { situacao: 'sem_conector' as const };
  }
  if (!deps.breaker.pode(agora.getTime())) return { situacao: 'pausado' as const };
  ok(await db.from('nfce_checkpoint').update({ ultima_tentativa_em: agora.toISOString(), status: 'executando', atualizado_em: agora.toISOString() }).eq('empresa_id', empresa.id), 'checkpoint executando');

  const hoje = diaSP(agora);
  const datas = datasPendentes(cp.ultima_data_ok, hoje, cfg.janela_dias);
  const tentativa = retryVencido ? cp.tentativas_seguidas + 1 : 1;
  const resultados: { data: string; status: string; temporario?: boolean; erroCodigo?: string }[] = [];
  for (const data of datas) {
    const origemDia = cp.ultima_data_ok && data > cp.ultima_data_ok && data < datas[datas.length - cfg.janela_dias] ? 'recuperacao' : origem;
    const r = await executarDia({ db, conectores: deps.conectores, arm: deps.arm, dono: deps.dono, pausaDownloadMs: deps.pausaDownloadMs, esperar: deps.esperar }, empresa, data, origemDia, tentativa);
    if (r.situacao !== 'executada') { resultados.push({ data, status: r.situacao }); continue; }
    resultados.push({ data, status: r.status, temporario: r.temporario, erroCodigo: r.erroCodigo });
    if (r.status === 'falhou') deps.breaker.falha(r.erroCodigo ?? 'ERRO', agora.getTime()); else deps.breaker.sucesso();
    if (r.status === 'falhou' && r.temporario === false) break; // erro definitivo (credencial, CAPTCHA): não insiste nos outros dias
  }
  const novo = avancarCheckpoint(cp.ultima_data_ok, resultados);
  const falhou = resultados.find((r) => r.status === 'falhou');
  const tudoOk = resultados.length > 0 && resultados.every((r) => r.status === 'concluida');
  const status = tudoOk ? 'ok' : falhou ? 'falhou' : 'parcial';
  // Retry: só falha temporária, até o limite; depois espera o horário do dia seguinte
  const podeRepetir = !!falhou && falhou.temporario !== false && tentativa < cfg.max_tentativas;
  const fim = (deps.agora ?? (() => new Date()))();
  ok(await db.from('nfce_checkpoint').update({
    ultima_data_ok: novo, status, atualizado_em: fim.toISOString(),
    ...(tudoOk ? { ultimo_sucesso_em: fim.toISOString(), erro_codigo: null, erro_mensagem: null } : { erro_codigo: (falhou ?? resultados.find((r) => r.status !== 'concluida'))?.erroCodigo ?? null }),
    tentativas_seguidas: podeRepetir ? tentativa : 0,
    proxima_tentativa_em: podeRepetir ? new Date(fim.getTime() + backoffMs(tentativa, cfg.backoff_base_seg, deps.aleatorio)).toISOString() : null,
  }).eq('empresa_id', empresa.id), 'atualizar checkpoint');
  return { situacao: 'processada' as const, status, checkpoint: novo, resultados };
}

/* ---------- processo ---------- */

if (require.main === module) {
  const url = process.env.SUPABASE_URL?.trim(); const chave = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !chave) { log.error('nfce-worker: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórias'); process.exit(1); }
  const db = criarDb(url, chave);
  const mk = process.env.MASTER_KEY?.trim();
  const arm = mk ? new Armazenamento(db, configArmazenamento(mk, process.env.XML_BUCKET ?? 'xmls')) : null;
  // Fase 1: nenhum conector registrado (sem SEFAZ, sem navegador)
  const conectores = new RegistroConectores();
  const dono = `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`;
  const breaker = new CircuitBreaker(Number(process.env.NFCE_BREAKER_FALHAS ?? 5), Number(process.env.NFCE_BREAKER_PAUSA_MIN ?? 10) * 60_000);
  const maxRss = Number(process.env.NFCE_MAX_RSS_MB ?? 400) * 1024 * 1024;
  const intervalo = Math.max(15, Number(process.env.NFCE_INTERVALO_SEG ?? 60)) * 1000;
  const iniciado = new Date().toISOString();
  let rodando = false; let encerrando = false; let ultimoCiclo: string | null = null; let ultimoErro: string | null = null; let empresasAtivas = 0;

  const vida = () => registrarStatus(db, 'nfce_worker', {
    versao: VERSAO_WORKER, dono, iniciado_em: iniciado, ultimo_ciclo_em: ultimoCiclo, empresas_ativas: empresasAtivas,
    conectores: conectores.ufs(), circuito: breaker.estado(), rss_mb: Math.round(process.memoryUsage().rss / 1048576), ultimo_erro: ultimoErro,
  });

  const ciclo = async () => {
    if (rodando || encerrando) return;
    rodando = true;
    try {
      const rss = process.memoryUsage().rss;
      if (rss > maxRss) { log.error('nfce-worker: memória acima do limite, reiniciando', { rss_mb: Math.round(rss / 1048576) }); await vida(); process.exit(1); }
      const lista = await empresasHabilitadas(db, new Date());
      empresasAtivas = lista.length;
      const semConector = new Set<string>();
      for (const { empresa, cfg } of lista) {
        if (encerrando) break;
        try {
          const r = await processarEmpresa({ db, conectores, arm, dono, breaker, pausaDownloadMs: 1500 }, empresa, cfg);
          if (r.situacao === 'sem_conector') semConector.add(empresa.uf);
        } catch (e) { log.error('nfce-worker: erro na empresa', { empresa: empresa.cnpj, erro: (e as Error).message }); }
      }
      if (semConector.size) log.info('nfce-worker: empresas habilitadas sem conector (Fase 1: nenhum conector ativo)', { ufs: [...semConector] });
      ultimoCiclo = new Date().toISOString(); ultimoErro = null;
    } catch (e) {
      ultimoErro = (e as Error).message;
      log.error('nfce-worker: erro no ciclo', { erro: ultimoErro });
    } finally {
      rodando = false;
      await vida().catch(() => {});
    }
  };

  log.info('nfce-worker iniciado', { versao: VERSAO_WORKER, dono, intervalo_seg: intervalo / 1000, conectores: conectores.ufs(), armazenamento: arm ? 'ok' : 'sem MASTER_KEY (download desligado)' });
  const timer = setInterval(() => void ciclo(), intervalo);
  void ciclo();
  const parar = (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    clearInterval(timer);
    log.info('nfce-worker encerrando', { sinal });
    const fim = Date.now();
    const aguardar = () => (rodando && Date.now() - fim < 25_000 ? setTimeout(aguardar, 250) : process.exit(0));
    aguardar();
  };
  process.on('SIGTERM', () => parar('SIGTERM'));
  process.on('SIGINT', () => parar('SIGINT'));
}
