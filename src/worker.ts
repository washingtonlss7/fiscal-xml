import cron from 'node-cron';
import { configWorker } from './config';
import { criarDb, ok } from './db';
import { extrairPendentes } from './extrator';
import { log } from './log';
import { executarRodada } from './rodada';

const cfg = configWorker();
const db = criarDb(cfg.supabaseUrl, cfg.supabaseServiceKey);

let rodadaAtiva: Promise<unknown> | null = null;
let ocupadoComPedidos = false;
let encerrando = false;

async function rodadaCompleta(origem: string, somenteEmpresas?: string[]) {
  if (rodadaAtiva) {
    log.warn('rodada anterior ainda em andamento; pulando', { origem });
    return;
  }
  log.info('disparando rodada', { origem, empresas: somenteEmpresas?.length });
  rodadaAtiva = executarRodada(db, cfg, somenteEmpresas)
    .catch((e) => log.error('erro na rodada', { erro: (e as Error).message }))
    .finally(() => {
      rodadaAtiva = null;
    });
  await rodadaAtiva;
}

/** Atende o botão "Sincronizar agora" do painel (tabela sync_requests). */
async function atenderPedidosManuais() {
  const pedidos = ok(
    await db.from('sync_requests').select('id,empresa_id').eq('status', 'pendente').order('solicitado_em').limit(50),
    'listar sync_requests',
  ) as { id: number; empresa_id: string }[];
  if (!pedidos.length) return;

  const ids = pedidos.map((p) => p.id);
  ok(await db.from('sync_requests').update({ status: 'processando' }).in('id', ids), 'marcar processando');

  try {
    const r = await executarRodada(db, cfg, [...new Set(pedidos.map((p) => p.empresa_id))]);
    for (const p of pedidos) {
      const res = r.resultados[p.empresa_id] ?? [];
      const docs = res.reduce((s, x) => s + x.documentos, 0);
      const aguardando = res.find((x) => x.status === 'aguardando');
      const parcial = res.some((x) => x.status === 'parcial');
      const erro = res.find((x) => x.status === 'erro' || x.status === 'bloqueado_656');
      await db
        .from('sync_requests')
        .update({
          status: erro ? 'erro' : 'concluido',
          processado_em: new Date().toISOString(),
          mensagem: erro
            ? erro.mensagem
            : aguardando && docs === 0
              ? `A SEFAZ só permite nova consulta após 1 hora (${aguardando.mensagem}).`
              : `${docs} documento(s) recebido(s)${parcial ? '; o restante continua automaticamente' : ''}.`,
        })
        .eq('id', p.id);
    }
  } catch (e) {
    await db
      .from('sync_requests')
      .update({ status: 'erro', processado_em: new Date().toISOString(), mensagem: (e as Error).message })
      .in('id', ids);
  }
}

/**
 * Empresas que ainda têm documentos na fila da SEFAZ (ultNSU < maxNSU) e já podem consultar de novo.
 * Acontece quando a rodada atinge o limite de chamadas ou quando o serviço é reiniciado no meio.
 */
async function empresasComFila(): Promise<string[]> {
  const linhas = ok(
    await db
      .from('sync_state')
      .select('empresa_id,ult_nsu,max_nsu')
      .eq('ultimo_cstat', '138')
      .lte('proxima_consulta_em', new Date().toISOString())
      .limit(1000),
    'listar filas pendentes',
  ) as { empresa_id: string; ult_nsu: string; max_nsu: string | null }[];
  return [...new Set(linhas.filter((l) => l.max_nsu && l.ult_nsu < l.max_nsu).map((l) => l.empresa_id))];
}

let ciclo = 0;
async function tique() {
  if (encerrando || ocupadoComPedidos) return;
  ocupadoComPedidos = true;
  try {
    await atenderPedidosManuais();
    // Detalha (itens e tributos) notas completas ainda não extraídas, inclusive o histórico.
    const extraidas = await extrairPendentes(db, cfg.bucket, 150);
    if (extraidas) log.info('notas detalhadas', { quantidade: extraidas });
    // A cada 3 minutos, continua filas que ficaram pela metade (sem esperar a próxima rodada agendada).
    if (ciclo++ % 3 === 0 && !rodadaAtiva) {
      const ids = await empresasComFila();
      if (ids.length) void rodadaCompleta('continuação da fila', ids);
    }
  } catch (e) {
    log.error('erro no ciclo do coletor', { erro: (e as Error).message });
  } finally {
    ocupadoComPedidos = false;
  }
}

async function iniciar() {
  log.info('coletor iniciado', {
    ambiente: cfg.tpAmb === 1 ? 'produção' : 'homologação',
    rodadas: cfg.cronRodadas,
    concorrencia: cfg.concorrencia,
  });

  // Pedidos que estavam em andamento quando o serviço reiniciou voltam para a fila.
  await db.from('sync_requests').update({ status: 'pendente' }).eq('status', 'processando');

  for (const expr of cfg.cronRodadas) {
    if (!cron.validate(expr)) throw new Error(`Expressão cron inválida em CRON_RODADAS: ${expr}`);
    cron.schedule(expr, () => void rodadaCompleta(`cron ${expr}`), { timezone: 'America/Sao_Paulo' });
  }

  const intervalo = setInterval(() => void tique(), 60_000);
  setTimeout(() => void tique(), 5_000);

  if (cfg.rodarAoIniciar) void rodadaCompleta('início');

  const parar = async (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    log.info('encerrando', { sinal });
    clearInterval(intervalo);
    for (const t of cron.getTasks().values()) t.stop();
    if (rodadaAtiva) await rodadaAtiva;
    process.exit(0);
  };
  process.on('SIGTERM', () => void parar('SIGTERM'));
  process.on('SIGINT', () => void parar('SIGINT'));
}

iniciar().catch((e) => {
  log.error('falha ao iniciar o coletor', { erro: (e as Error).message });
  process.exit(1);
});
