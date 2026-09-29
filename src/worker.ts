import cron from 'node-cron';
import { configWorker } from './config';
import { criarDb, ok } from './db';
import { log } from './log';
import { executarRodada } from './rodada';

const cfg = configWorker();
const db = criarDb(cfg.supabaseUrl, cfg.supabaseServiceKey);

let rodadaAtiva: Promise<unknown> | null = null;
let encerrando = false;

async function rodadaCompleta(origem: string) {
  if (rodadaAtiva) {
    log.warn('rodada anterior ainda em andamento; pulando', { origem });
    return;
  }
  log.info('disparando rodada', { origem });
  rodadaAtiva = executarRodada(db, cfg)
    .catch((e) => log.error('erro na rodada', { erro: (e as Error).message }))
    .finally(() => {
      rodadaAtiva = null;
    });
  await rodadaAtiva;
}

/** Atende o botão "Sincronizar agora" do painel (tabela sync_requests). */
async function atenderPedidosManuais() {
  if (encerrando) return;
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
              : `${docs} documento(s) recebido(s).`,
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

function iniciar() {
  log.info('coletor iniciado', {
    ambiente: cfg.tpAmb === 1 ? 'produção' : 'homologação',
    rodadas: cfg.cronRodadas,
    concorrencia: cfg.concorrencia,
  });

  for (const expr of cfg.cronRodadas) {
    if (!cron.validate(expr)) throw new Error(`Expressão cron inválida em CRON_RODADAS: ${expr}`);
    cron.schedule(expr, () => void rodadaCompleta(`cron ${expr}`), { timezone: 'America/Sao_Paulo' });
  }

  const intervalo = setInterval(() => {
    atenderPedidosManuais().catch((e) => log.error('erro nos pedidos manuais', { erro: (e as Error).message }));
  }, 60_000);

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

iniciar();
