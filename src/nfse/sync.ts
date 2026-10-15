/**
 * Captação de NFS-e pelo ADN, empresa por empresa, com o NSU guardado em nfse_captacao.
 * - pede o lote a partir do último NSU; grava cada documento (XML no armazenamento, dados em nfse_documentos/eventos);
 * - lote cheio: continua em seguida (até o limite de chamadas da rodada); lote parcial ou vazio: volta no intervalo;
 * - 429 (excesso de consultas): espera 65 minutos; outros erros: espera crescente (15 min, 30, 60… até 6 h).
 */
import https from 'https';
import { Armazenamento } from '../armazenamento';
import { Db, ok } from '../db';
import { log } from '../log';
import { consultarAdn, DocAdn, ErroAdn, RetornoAdn, Transporte } from './adn';
import { EVENTOS_CANCELAMENTO, lerXmlNfse, papelNaNota } from './leitor';

const minutos = (n: number) => n * 60_000;
const daquiA = (ms: number) => new Date(Date.now() + ms).toISOString();
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Espera após erro: 15 min, 30, 60… até 6 h. */
export const esperaAposErro = (erros: number) => minutos(Math.min(15 * 2 ** Math.max(0, erros - 1), 360));
/** Lote cheio do ADN (acima disso, há mais documentos esperando). */
export const TAMANHO_LOTE = 50;

export interface ContextoNfse {
  db: Db;
  arm: Armazenamento;
  tpAmb: 1 | 2;
  maxChamadas: number;
  /** Intervalo entre consultas de uma empresa em dia (nunca menos de 1 hora). */
  intervaloMs: number;
  manual?: boolean;
  podeConsultar?: () => boolean;
  transporte?: Transporte;
  /** Pausa entre lotes seguidos (testes usam 0). */
  pausaMs?: number;
}

export interface ResultadoNfse { status: 'ok' | 'aguardando' | 'desligada' | 'erro' | 'parcial'; chamadas: number; documentos: number; mensagem?: string }

const anoMes = (iso: string | null) => (iso && /^\d{4}-\d{2}/.test(iso) ? `${iso.slice(0, 4)}/${iso.slice(5, 7)}` : 'sem-data');

/** Grava um documento recebido do ADN. Devolve true se era NFS-e ou evento conhecido. Idempotente. */
export async function gravarDocNfse(ctx: Pick<ContextoNfse, 'db' | 'arm'>, empresa: { id: string; cnpj: string }, d: DocAdn): Promise<'nfse' | 'evento' | 'outro'> {
  const { db, arm } = ctx;
  let lido;
  try { lido = d.xml ? lerXmlNfse(d.xml) : { tipo: 'outro' as const }; } catch (e) {
    log.warn('NFS-e: XML ilegível', { cnpj: empresa.cnpj, nsu: d.nsu, erro: (e as Error).message });
    lido = { tipo: 'outro' as const };
  }
  if (lido.tipo === 'nfse') {
    const n = lido.nfse;
    const caminho = await arm.salvar(`${empresa.cnpj}/${anoMes(n.emitidaEm)}/nfse/${n.chave}.xml`, d.xml);
    // Cancelamento que chegou antes da nota (outra empresa do escritório) continua valendo
    const ev = ok(await db.from('nfse_eventos').select('tp_evento').eq('chave', n.chave).in('tp_evento', Object.keys(EVENTOS_CANCELAMENTO)).limit(1), 'eventos da nota') as { tp_evento: string }[];
    ok(await db.from('nfse_documentos').upsert({
      empresa_id: empresa.id, chave: n.chave, papel: papelNaNota(n, empresa.cnpj), numero: n.numero, serie_dps: n.serieDps, numero_dps: n.numeroDps,
      competencia: n.competencia, emitida_em: n.emitidaEm,
      prestador_doc: n.prestador.doc, prestador_nome: n.prestador.nome, prestador_mun: n.prestador.mun,
      tomador_doc: n.tomador.doc, tomador_nome: n.tomador.nome, tomador_mun: n.tomador.mun, intermediario_doc: n.intermediarioDoc,
      mun_incidencia: n.munIncidencia, mun_prestacao: n.munPrestacao, cod_trib_nac: n.codTribNac, cod_nbs: n.codNbs, descricao: n.descricao,
      valor_servico: n.valorServico, base_calculo: n.baseCalculo, aliquota: n.aliquota, valor_iss: n.valorIss, iss_retido: n.issRetido,
      valor_retencoes: n.valorRetencoes, valor_liquido: n.valorLiquido,
      situacao: ev.length ? EVENTOS_CANCELAMENTO[ev[0].tp_evento] : 'autorizada',
      nsu: d.nsu, xml_path: caminho, atualizado_em: new Date().toISOString(),
    }, { onConflict: 'empresa_id,chave' }), 'gravar NFS-e');
    return 'nfse';
  }
  if (lido.tipo === 'evento') {
    const e = lido.evento;
    const caminho = await arm.salvar(`${empresa.cnpj}/${anoMes(e.ocorridoEm)}/nfse-eventos/${e.chave}-${e.tpEvento}-${e.nSeq}.xml`, d.xml);
    ok(await db.from('nfse_eventos').upsert({ empresa_id: empresa.id, chave: e.chave, tp_evento: e.tpEvento, n_seq: e.nSeq, descricao: e.descricao, ocorrido_em: e.ocorridoEm, nsu: d.nsu, xml_path: caminho },
      { onConflict: 'empresa_id,chave,tp_evento,n_seq' }), 'gravar evento da NFS-e');
    const nova = EVENTOS_CANCELAMENTO[e.tpEvento];
    // Vale para todas as cópias da nota (prestador e tomador cadastrados no escritório)
    if (nova) ok(await db.from('nfse_documentos').update({ situacao: nova, atualizado_em: new Date().toISOString() }).eq('chave', e.chave), 'aplicar cancelamento da NFS-e');
    return 'evento';
  }
  if (d.xml) await arm.salvar(`${empresa.cnpj}/outros/nfse-${d.nsu}.xml`, d.xml);
  if (d.tipo !== 'DPS' && d.tipo !== 'PEDIDO_REGISTRO_EVENTO') log.warn('NFS-e: documento não reconhecido', { cnpj: empresa.cnpj, nsu: d.nsu, tipo: d.tipo });
  return 'outro';
}

async function registrar(db: Db, reg: Record<string, unknown>) {
  const r = await db.from('nfse_logs').insert(reg);
  if (r.error) log.warn('falha ao gravar nfse_logs', { erro: r.error.message });
}

async function atualizar(db: Db, empresaId: string, campos: Record<string, unknown>) {
  ok(await db.from('nfse_captacao').update(campos).eq('empresa_id', empresaId), 'atualizar captação da NFS-e');
}

/** Quando a empresa pode consultar de novo. No pedido manual, basta ter passado 10 minutos da última consulta (sem erro pendente). */
export function nfseLiberadaEm(estado: { proxima_consulta_em: string; ultima_consulta_em?: string | null; erros_consecutivos?: number | null; ultimo_status?: string | null }, manual: boolean): number {
  const proxima = new Date(estado.proxima_consulta_em).getTime();
  if (!manual || !estado.ultima_consulta_em || (estado.erros_consecutivos ?? 0) > 0 || estado.ultimo_status === 'aguardando_adn') return proxima;
  return Math.min(proxima, new Date(estado.ultima_consulta_em).getTime() + minutos(10));
}

export async function sincronizarNfse(ctx: ContextoNfse, empresa: { id: string; cnpj: string }, agent: https.Agent): Promise<ResultadoNfse> {
  const { db } = ctx;
  const estado = ok(await db.from('nfse_captacao').select('*').eq('empresa_id', empresa.id).maybeSingle(), 'ler captação da NFS-e') as any;
  if (!estado?.ativo) return { status: 'desligada', chamadas: 0, documentos: 0 };
  const liberada = nfseLiberadaEm(estado, !!ctx.manual);
  if (liberada > Date.now()) return { status: 'aguardando', chamadas: 0, documentos: 0, mensagem: `liberado em ${new Date(liberada).toISOString()}` };

  let ult = Number(estado.ult_nsu ?? 0);
  let erros = Number(estado.erros_consecutivos ?? 0);
  let chamadas = 0; let documentos = 0;
  const intervalo = Math.max(minutos(61), ctx.intervaloMs);

  while (chamadas < ctx.maxChamadas) {
    if (ctx.podeConsultar && !ctx.podeConsultar()) return { status: chamadas ? 'parcial' : 'aguardando', chamadas, documentos, mensagem: 'fora do horário de consulta' };
    chamadas++;
    const t0 = Date.now();
    let ret: RetornoAdn;
    try {
      ret = await consultarAdn(agent, { tpAmb: ctx.tpAmb, nsu: ult }, ctx.transporte);
    } catch (e) {
      const msg = (e as Error).message;
      const http = e instanceof ErroAdn ? e.http : undefined;
      await registrar(db, { empresa_id: empresa.id, nsu_enviado: ult, http_status: http ?? null, status: 'erro', erro: msg.slice(0, 1000), duracao_ms: Date.now() - t0 });
      if (http === 429) {
        await atualizar(db, empresa.id, { ultima_consulta_em: new Date().toISOString(), ultimo_status: 'aguardando_adn', ultimo_motivo: msg, proxima_consulta_em: daquiA(minutos(65)) });
        log.warn('NFS-e: ADN pediu para esperar', { cnpj: empresa.cnpj });
        return { status: 'aguardando', chamadas, documentos, mensagem: msg };
      }
      erros++;
      await atualizar(db, empresa.id, { ultima_consulta_em: new Date().toISOString(), ultimo_status: 'erro', ultimo_motivo: msg.slice(0, 500), erros_consecutivos: erros, proxima_consulta_em: daquiA(esperaAposErro(erros)) });
      log.error('NFS-e: falha na consulta ao ADN', { cnpj: empresa.cnpj, erro: msg });
      return { status: 'erro', chamadas, documentos, mensagem: msg };
    }

    const novos = ret.docs.filter((d) => d.nsu > ult).sort((a, b) => a.nsu - b.nsu);
    const maior = novos.length ? novos[novos.length - 1].nsu : ult;
    await registrar(db, { empresa_id: empresa.id, nsu_enviado: ult, http_status: ret.http, status: ret.status, qtd_docs: novos.length, ult_nsu_retornado: maior, erro: ret.erros.join('; ').slice(0, 1000) || null, duracao_ms: Date.now() - t0 });

    if (ret.status === 'REJEICAO' || (ret.erros.length && !novos.length && ret.status !== 'NENHUM_DOCUMENTO_LOCALIZADO')) {
      erros++;
      const msg = ret.erros.join('; ') || 'Rejeição do ADN';
      await atualizar(db, empresa.id, { ultima_consulta_em: new Date().toISOString(), ultimo_status: 'rejeicao', ultimo_motivo: msg.slice(0, 500), erros_consecutivos: erros, proxima_consulta_em: daquiA(esperaAposErro(erros)) });
      log.error('NFS-e: rejeição do ADN', { cnpj: empresa.cnpj, motivo: msg });
      return { status: 'erro', chamadas, documentos, mensagem: msg };
    }

    // Notas primeiro, eventos depois (o cancelamento encontra a nota já gravada)
    const ehEvento = (d: DocAdn) => d.tipo.includes('EVENTO') && d.tipo !== 'PEDIDO_REGISTRO_EVENTO';
    let gravados = 0;
    for (const d of [...novos.filter((x) => !ehEvento(x)), ...novos.filter(ehEvento)]) {
      if ((await gravarDocNfse(ctx, empresa, d)) !== 'outro') gravados++;
    }
    documentos += gravados;
    ult = maior; erros = 0;
    const cheio = ret.docs.length >= TAMANHO_LOTE && novos.length > 0;
    await atualizar(db, empresa.id, {
      ult_nsu: ult, ultima_consulta_em: new Date().toISOString(), ultima_sync_ok_em: new Date().toISOString(),
      ultimo_status: novos.length ? 'documentos' : 'em_dia', ultimo_motivo: ret.alertas.join('; ').slice(0, 500) || null, erros_consecutivos: 0,
      documentos_total: Number(estado.documentos_total ?? 0) + documentos,
      proxima_consulta_em: cheio ? daquiA(minutos(2)) : daquiA(intervalo),
    });
    if (!cheio) {
      if (documentos) log.info('NFS-e captadas', { cnpj: empresa.cnpj, documentos, ult_nsu: ult });
      return { status: 'ok', chamadas, documentos };
    }
    await esperar(ctx.pausaMs ?? 1000);
  }
  return { status: 'parcial', chamadas, documentos, mensagem: 'limite de chamadas da rodada atingido' };
}
