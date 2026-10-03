/**
 * Execução de um dia de uma empresa: lock → registro da execução → descoberta → deduplicação → download dos ausentes
 * → pipeline fiscal existente (importarXmls) → resultado. O checkpoint só avança no ciclo (ver avancarCheckpoint),
 * e só com dias "concluída" em sequência.
 */
import { Armazenamento } from '../armazenamento';
import { Db, ok } from '../db';
import { importarXmls } from '../importacao/importar';
import { log } from '../log';
import { chaveDaEmpresa, EmpresaNfce, ErroConector, RegistroConectores } from './conector';
import { Lock } from './lock';

export const VERSAO_WORKER = 'nfce-worker/1.0.0-fase1';

export interface DepsExecucao {
  db: Db;
  conectores: RegistroConectores;
  /** Armazenamento do pipeline (só necessário quando há download). */
  arm: Armazenamento | null;
  dono: string;
  /** Pausa entre downloads (ritmo calmo com a SEFAZ). */
  pausaDownloadMs?: number;
  esperar?: (ms: number) => Promise<void>;
}

export type ResultadoDia =
  | { situacao: 'ocupado' }
  | { situacao: 'sem_conector' }
  | { situacao: 'executada'; status: 'concluida' | 'parcial' | 'falhou'; runId: string; temporario?: boolean; erroCodigo?: string; encontrados: number; existentes: number; novos: number; baixadosOk: number; baixadosFalha: number };

/** Chaves que já estão no Appura (lotes de 200). */
export async function chavesExistentes(db: Db, empresaId: string, chaves: string[]): Promise<Set<string>> {
  const existe = new Set<string>();
  for (let i = 0; i < chaves.length; i += 200) {
    const r = ok(await db.from('documentos').select('chave').eq('empresa_id', empresaId).in('chave', chaves.slice(i, i + 200)), 'chaves existentes') as { chave: string }[];
    for (const d of r) existe.add(d.chave);
  }
  return existe;
}

export async function executarDia(deps: DepsExecucao, empresa: EmpresaNfce, data: string, origem: 'agendada' | 'manual' | 'recuperacao', tentativa = 1): Promise<ResultadoDia> {
  const { db } = deps;
  const descoberta = deps.conectores.descobertaDe(empresa.uf);
  if (!descoberta) return { situacao: 'sem_conector' };
  const lock = new Lock(db, `nfce:${empresa.id}:${data}`, deps.dono);
  if (!(await lock.adquirir())) return { situacao: 'ocupado' };
  const esperar = deps.esperar ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const controle = new AbortController();
  const inicio = Date.now();
  let runId = '';
  try {
    const { data: run, error } = await db.from('nfce_execucoes').insert({
      empresa_id: empresa.id, data_referencia: data, origem, status: 'executando', tentativa, versao_worker: VERSAO_WORKER, iniciado_em: new Date().toISOString(),
    }).select('run_id').single();
    if (error) return { situacao: 'ocupado' }; // outra execução "executando" para a mesma empresa e data (índice único)
    runId = (run as any).run_id;
    const c = { encontrados: 0, existentes: 0, novos: 0, baixadosOk: 0, baixadosFalha: 0 };
    let status: 'concluida' | 'parcial' | 'falhou' = 'concluida';
    let erroCodigo: string | undefined; let erroMensagem: string | undefined; let temporario: boolean | undefined;
    try {
      const ctx = { empresa, sinal: controle.signal };
      const notas = await descoberta.descobrir(ctx, data);
      // Só chaves válidas, modelo 65, deste CNPJ; sem repetidas
      const chaves = [...new Set(notas.map((n) => String(n.chave ?? '').replace(/\D/g, '')).filter((k) => chaveDaEmpresa(k, empresa.cnpj)))];
      const ignoradas = notas.length - chaves.length;
      c.encontrados = chaves.length;
      const existentes = await chavesExistentes(db, empresa.id, chaves);
      c.existentes = existentes.size;
      const ausentes = chaves.filter((k) => !existentes.has(k));
      c.novos = ausentes.length;
      if (ignoradas > 0) log.warn('nfce: itens da descoberta ignorados (chave inválida, outro modelo ou outro CNPJ)', { run_id: runId, empresa: empresa.cnpj, ignoradas });
      if (ausentes.length) {
        const download = deps.conectores.downloadDe(empresa.uf);
        if (!download || !deps.arm) {
          // Sem serviço de download: o dia fica parcial (as chaves ausentes continuam pendentes para a próxima)
          status = 'parcial'; erroCodigo = 'SEM_DOWNLOAD'; erroMensagem = `${ausentes.length} chave(s) ausente(s) sem serviço de download para ${empresa.uf}.`;
          c.baixadosFalha = ausentes.length;
        } else {
          for (const chave of ausentes) {
            if (!lock.valido) { status = 'parcial'; erroCodigo = 'LOCK_PERDIDO'; erroMensagem = 'O lock venceu durante a execução: parado para não duplicar trabalho.'; break; }
            try {
              const xml = await download.baixar(ctx, chave);
              const r = await importarXmls(db, deps.arm, { id: empresa.id, cnpj: empresa.cnpj, c_uf: Number(chave.slice(0, 2)) }, [{ nome: `${chave}.xml`, conteudo: xml }]);
              const gravou = r.importadas + r.completouResumo + r.jaExistiam;
              const res = r.resultados[0];
              if (gravou > 0 && (!res || res.chave === chave)) c.baixadosOk++;
              else { c.baixadosFalha++; log.warn('nfce: XML baixado recusado pelo pipeline', { run_id: runId, chave, motivo: res?.motivo }); }
            } catch (e) {
              c.baixadosFalha++;
              log.warn('nfce: falha no download', { run_id: runId, chave, erro: (e as Error).message, codigo: (e as ErroConector).codigo });
            }
            if (deps.pausaDownloadMs) await esperar(deps.pausaDownloadMs);
          }
          if (c.baixadosFalha > 0 && status === 'concluida') { status = 'parcial'; erroCodigo = 'DOWNLOAD_INCOMPLETO'; erroMensagem = `${c.baixadosFalha} de ${ausentes.length} XML(s) não baixado(s).`; }
        }
      }
    } catch (e) {
      status = 'falhou';
      erroCodigo = e instanceof ErroConector ? e.codigo : 'ERRO_INESPERADO';
      erroMensagem = (e as Error).message.slice(0, 500);
      temporario = e instanceof ErroConector ? e.temporario : true;
    }
    ok(await db.from('nfce_execucoes').update({
      status, encontrados: c.encontrados, existentes: c.existentes, novos: c.novos, baixados_ok: c.baixadosOk, baixados_falha: c.baixadosFalha,
      erro_codigo: erroCodigo ?? null, erro_mensagem: erroMensagem ?? null, terminado_em: new Date().toISOString(),
    }).eq('run_id', runId), 'finalizar execução');
    log.info('nfce: execução', { run_id: runId, empresa: empresa.cnpj, data_referencia: data, origem, tentativa, status, ...c, erro_codigo: erroCodigo, duracao_ms: Date.now() - inicio, versao: VERSAO_WORKER });
    return { situacao: 'executada', status, runId, temporario, erroCodigo, ...c };
  } finally {
    controle.abort();
    await lock.liberar().catch(() => {});
  }
}

/**
 * Novo checkpoint: o último dia de uma sequência contínua de dias "concluída" a partir do checkpoint atual.
 * Um dia parcial ou com falha segura o checkpoint ali (os dias seguintes podem ser processados, mas não o avançam).
 */
const proximoDia = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);

export function avancarCheckpoint(atual: string | null, resultados: { data: string; status: string }[]): string | null {
  const ok = new Set(resultados.filter((r) => r.status === 'concluida').map((r) => r.data));
  const datas = [...new Set(resultados.map((r) => r.data))].sort();
  let novo = atual;
  for (const d of datas) {
    if (novo && d <= novo) continue;
    if (!ok.has(d)) break;
    // Só avança em sequência: um dia que nem foi processado (buraco) também segura o checkpoint
    if (novo && d !== proximoDia(novo)) break;
    novo = d;
  }
  return novo;
}
