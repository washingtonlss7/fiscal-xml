import cron from 'node-cron';
import { Armazenamento, configArmazenamento } from './armazenamento';
import { configWorker } from './config';
import { criarDb, ok } from './db';
import { auditarPendentes, reauditarRecentes } from './auditoria/motor';
import { extrairPendentes } from './extrator';
import { fazerBackup, migrarParaR2 } from './migracao';
import { log } from './log';
import { Agendador } from './agendador';
import { carregarEmpresas, emAndamento, executarRodada, garantirSyncState, mapaClientes, novoContexto, sincronizarEmpresa } from './rodada';
import { dentroDaJanela } from './util';
import { registrarStatus } from './status';

const cfg = configWorker();
const db = criarDb(cfg.supabaseUrl, cfg.supabaseServiceKey);
const arm = new Armazenamento(db, configArmazenamento(cfg.masterKey, cfg.bucket));

let encerrando = false;
let ocupadoComPedidos = false;

/** Contadores para o resumo periódico no log. */
const estat = { empresas: 0, documentos: 0, erros: 0, desde: Date.now() };

/** Empresa que falhou antes de atualizar o controle de NSU (ex.: senha do certificado): tenta de novo em 15 min. */
async function adiar(empresaId: string) {
  await db
    .from('sync_state')
    .update({ proxima_consulta_em: new Date(Date.now() + 15 * 60_000).toISOString() })
    .eq('empresa_id', empresaId)
    .lte('proxima_consulta_em', new Date().toISOString());
}

/** Registra no log quando a janela de consultas abre e fecha. */
let janelaAberta: boolean | null = null;
function janelaAbertaAgora(): boolean {
  const aberta = dentroDaJanela(cfg.janela);
  if (aberta !== janelaAberta && cfg.janela) {
    log.info(aberta ? 'janela de consultas aberta' : 'janela de consultas encerrada', { horario: cfg.janela.texto });
  }
  janelaAberta = aberta;
  return aberta;
}

const agendador = new Agendador(
  cfg.concorrencia,
  async (limite, excluir) => {
    if (!janelaAbertaAgora()) return [];
    const devidas = ok(
      await db.rpc('empresas_para_sincronizar', { p_limite: limite, p_excluir: excluir }),
      'empresas para sincronizar',
    ) as { empresa_id: string }[];
    if (!devidas?.length) return [];
    const { empresas, certs } = await carregarEmpresas(db, devidas.map((d) => d.empresa_id));
    const ctx = novoContexto(db, cfg, arm, await mapaClientes(db));
    return empresas.map((e) => ({
      id: e.id,
      rodar: async () => {
        const r = await sincronizarEmpresa(ctx, cfg, e, certs.get(e.id));
        estat.empresas++;
        if (r.situacao === 'ok') {
          estat.documentos += r.documentos;
          estat.erros += r.resultados.filter((x) => x.status === 'erro').length;
        } else if (r.situacao !== 'ocupada') {
          estat.erros++;
          await adiar(e.id);
        }
      },
    }));
  },
  (e) => log.error('erro no agendador', { erro: (e as Error).message }),
  60_000,
  () => emAndamento,
);

/** A cada 10 minutos: garante o controle de NSU de empresas novas e registra um resumo no log. */
async function manutencao() {
  try {
    const { empresas } = await carregarEmpresas(db);
    await garantirSyncState(db, empresas);
    const fila = (ok(await db.rpc('fila_sincronizacao'), 'fila') as { vencidas: number; mais_antiga: string | null }[])?.[0];
    log.info('resumo do coletor', {
      janela: cfg.janela ? `${cfg.janela.texto} (${dentroDaJanela(cfg.janela) ? 'aberta' : 'fechada'})` : 'sem restrição',
      empresas_ativas: empresas.length,
      sincronizando_agora: agendador.ativos,
      aguardando_vaga: Number(fila?.vencidas ?? 0),
      atraso_max_min: fila?.mais_antiga ? Math.round((Date.now() - new Date(fila.mais_antiga).getTime()) / 60_000) : 0,
      ultimos_10min: { empresas: estat.empresas, documentos: estat.documentos, erros: estat.erros },
    });
    Object.assign(estat, { empresas: 0, documentos: 0, erros: 0, desde: Date.now() });
  } catch (e) {
    log.error('erro na manutenção', { erro: (e as Error).message });
  }
}

/** Atende o botão "Sincronizar agora" do painel (tabela sync_requests). */
async function atenderPedidosManuais() {
  // Pedido manual vale a qualquer horário: só a busca automática respeita a janela (JANELA_SINCRONIZACAO, padrão 23h às 6h).
  const pedidos = ok(
    await db.from('sync_requests').select('id,empresa_id').eq('status', 'pendente').order('solicitado_em').limit(50),
    'listar sync_requests',
  ) as { id: number; empresa_id: string }[];
  if (!pedidos.length) return;

  const ids = pedidos.map((p) => p.id);
  ok(await db.from('sync_requests').update({ status: 'processando' }).in('id', ids), 'marcar processando');

  try {
    const r = await executarRodada(db, cfg, arm, [...new Set(pedidos.map((p) => p.empresa_id))]);
    for (const p of pedidos) {
      const res = r[p.empresa_id];
      let status = 'concluido';
      let mensagem = '';
      if (!res) {
        status = 'erro';
        mensagem = 'Empresa inativa ou não encontrada.';
      } else if (res.situacao === 'ocupada') {
        mensagem = 'A sincronização automática desta empresa já está em andamento; os documentos aparecem em instantes.';
      } else if (res.situacao === 'sem_certificado' || res.situacao === 'vencido') {
        status = 'erro';
        mensagem = res.situacao === 'vencido' ? 'Certificado vencido.' : 'Empresa sem certificado ativo.';
      } else if (res.situacao === 'erro') {
        status = 'erro';
        mensagem = res.mensagem;
      } else if (res.situacao === 'ok') {
        const docs = res.documentos;
        const aguardando = res.resultados.find((x) => x.status === 'aguardando');
        const parcial = res.resultados.some((x) => x.status === 'parcial');
        const erro = res.resultados.find((x) => x.status === 'erro' || x.status === 'bloqueado_656');
        if (erro) {
          status = 'erro';
          mensagem = erro.mensagem ?? 'Falha na consulta.';
        } else if (aguardando && docs === 0) {
          mensagem = `A SEFAZ só permite nova consulta 1 hora depois da anterior (${aguardando.mensagem}).`;
        } else {
          mensagem = `${docs} documento(s) recebido(s)${parcial ? '; o restante continua automaticamente' : ''}.`;
        }
      }
      await db.from('sync_requests').update({ status, processado_em: new Date().toISOString(), mensagem }).eq('id', p.id);
    }
  } catch (e) {
    await db
      .from('sync_requests')
      .update({ status: 'erro', processado_em: new Date().toISOString(), mensagem: (e as Error).message })
      .in('id', ids);
  }
}

let atendendoPedidos = false;
async function ciclarPedidos() {
  if (encerrando || atendendoPedidos) return;
  atendendoPedidos = true;
  try { await atenderPedidosManuais(); } catch (e) { log.error('erro nos pedidos manuais', { erro: (e as Error).message }); } finally { atendendoPedidos = false; }
}

async function tique() {
  if (encerrando || ocupadoComPedidos) return;
  ocupadoComPedidos = true;
  try {
    // Detalha (itens e tributos) notas completas ainda não extraídas, inclusive o histórico.
    const extraidas = await extrairPendentes(db, arm, 150);
    if (extraidas) log.info('notas detalhadas', { quantidade: extraidas });
    // Audita os meses com notas novas ou alteradas (vários meses em paralelo).
    await auditarPendentes(db, 12, 3);
    // Move os XMLs antigos (Supabase Storage) para o R2 criptografado, aos poucos.
    await migrarParaR2(db, arm, 200);
  } catch (e) {
    log.error('erro no ciclo do coletor', { erro: (e as Error).message });
  } finally {
    ocupadoComPedidos = false;
  }
}

async function iniciar() {
  log.info('coletor iniciado', {
    ambiente: cfg.tpAmb === 1 ? 'produção' : 'homologação',
    empresas_simultaneas: cfg.concorrencia,
    horario_consultas: cfg.janela?.texto ?? 'sem restrição',
    intervalo_horas: cfg.intervaloHoras,
    armazenamento: arm.usaR2 ? 'Cloudflare R2 (criptografado)' : 'Supabase Storage',
  });
  await registrarStatus(db, 'coletor', {
    iniciado_em: new Date().toISOString(),
    armazenamento: arm.usaR2 ? 'r2' : 'supabase',
    r2_variaveis: ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].filter((v) => !process.env[v]?.trim()).length
      ? `faltando: ${['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].filter((v) => !process.env[v]?.trim()).join(', ')}`
      : 'ok',
    empresas_simultaneas: cfg.concorrencia,
    horario_consultas: cfg.janela?.texto ?? 'sem restrição',
  });
  if (process.env.CRON_RODADAS) log.warn('CRON_RODADAS não é mais usada: o coletor agenda cada empresa pelo INTERVALO_HORAS.');

  // Pedidos que estavam em andamento quando o serviço reiniciou voltam para a fila.
  await db.from('sync_requests').update({ status: 'pendente' }).eq('status', 'processando');

  // Consultas à SEFAZ: vagas liberadas são preenchidas na hora; a cada 15 s confere se venceu alguma.
  const abastecer = setInterval(() => void agendador.abastecer(), 15_000);
  const manut = setInterval(() => void manutencao(), 10 * 60_000);
  void manutencao().then(() => agendador.abastecer());

  // Backup semanal dos XMLs (criptografados) no disco da VPS.
  const pastaBackup = process.env.BACKUP_DIR?.trim() || '/app/backup';
  cron.schedule(process.env.BACKUP_CRON?.trim() || '30 3 * * 0', () => void fazerBackup(db, arm, pastaBackup)
    .catch((e) => log.error('erro no backup', { erro: (e as Error).message })), { timezone: 'America/Sao_Paulo' });

  // Todo dia às 6h reaudita o mês atual e o anterior (regras que dependem do tempo) e limpa o histórico antigo de chamadas.
  cron.schedule('0 6 * * *', () => {
    void reauditarRecentes(db).catch((e) => log.error('erro ao reabrir auditoria', { erro: (e as Error).message }));
    void db.rpc('limpar_logs_sefaz', { p_dias: 60 }).then((r) => {
      if (r.error) log.error('erro ao limpar logs_sefaz', { erro: r.error.message });
      else if (Number(r.data)) log.info('histórico de chamadas antigo removido', { linhas: Number(r.data) });
    });
  }, { timezone: 'America/Sao_Paulo' });

  const intervalo = setInterval(() => void tique(), 60_000);
  // Botão "Sincronizar": conferido a cada 5 s, fora do ciclo pesado (extração, auditoria), para começar na hora
  const pedidos = setInterval(() => void ciclarPedidos(), 5_000);
  setTimeout(() => void tique(), 5_000);

  const parar = async (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    log.info('encerrando', { sinal });
    clearInterval(intervalo);
    clearInterval(pedidos);
    clearInterval(abastecer);
    clearInterval(manut);
    for (const t of cron.getTasks().values()) t.stop();
    await agendador.parar();
    process.exit(0);
  };
  process.on('SIGTERM', () => void parar('SIGTERM'));
  process.on('SIGINT', () => void parar('SIGINT'));
}

iniciar().catch((e) => {
  log.error('falha ao iniciar o coletor', { erro: (e as Error).message });
  process.exit(1);
});
