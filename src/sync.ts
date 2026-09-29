import https from 'https';
import { Db, ok, salvarXml } from './db';
import { log } from './log';
import { consultarDistNSU, DocZip, Modelo, RetornoDist } from './sefaz/distDFe';
import { EVENTO_CANCELAMENTO, interpretar } from './sefaz/documentos';
import { daquiA, esperar, minutos } from './util';

export interface EmpresaSync {
  id: string;
  cnpj: string;
  c_uf: number;
}

export interface ContextoSync {
  db: Db;
  bucket: string;
  tpAmb: 1 | 2;
  maxChamadasPorRodada: number;
}

export interface ResultadoSync {
  modelo: Modelo;
  status: 'ok' | 'aguardando' | 'bloqueado_656' | 'erro' | 'parcial';
  chamadas: number;
  documentos: number;
  mensagem?: string;
}

/** Espera após erro: 15 min, 30, 60... até 6 h. */
const backoff = (erros: number) => minutos(Math.min(15 * 2 ** Math.max(0, erros - 1), 360));

function anoMes(data?: string): string {
  return data && /^\d{4}-\d{2}/.test(data) ? `${data.slice(0, 4)}/${data.slice(5, 7)}` : 'sem-data';
}

async function processarDoc(ctx: ContextoSync, empresa: EmpresaSync, modelo: Modelo, doc: DocZip): Promise<void> {
  const { db, bucket } = ctx;
  const info = interpretar(doc.schema, doc.xml);
  let chave: string | null = null;

  if (info.tipo === 'documento') {
    chave = info.chave;
    const sufixo = info.completo ? 'completo' : 'resumo';
    const caminho = `${empresa.cnpj}/${anoMes(info.emitidaEm)}/${info.modelo}/${info.chave}-${sufixo}.xml.gz`;
    await salvarXml(db, bucket, caminho, doc.xml);

    const linha = {
      empresa_id: empresa.id,
      modelo: info.modelo,
      chave: info.chave,
      direcao: info.emitCnpj === empresa.cnpj ? 'saida' : 'entrada',
      completo: info.completo,
      numero: info.numero ?? null,
      serie: info.serie ?? null,
      emitida_em: info.emitidaEm ?? null,
      emit_cnpj: info.emitCnpj ?? null,
      emit_nome: info.emitNome ?? null,
      dest_doc: info.destDoc ?? null,
      dest_nome: info.destNome ?? null,
      valor: info.valor ?? null,
      situacao: info.situacao,
      protocolo: info.protocolo ?? null,
      nsu: doc.nsu,
      atualizado_em: new Date().toISOString(),
    };

    if (info.completo) {
      ok(
        await db.from('documentos').upsert({ ...linha, xml_path: caminho }, { onConflict: 'empresa_id,chave' }),
        'upsert documento completo',
      );
      // O XML completo diz "autorizada"; se já recebemos cancelamento, mantém cancelada.
      const canc = ok(
        await db
          .from('eventos')
          .select('id')
          .eq('empresa_id', empresa.id)
          .eq('chave', info.chave)
          .in('tp_evento', [...EVENTO_CANCELAMENTO])
          .limit(1),
        'consulta cancelamento',
      );
      if (canc?.length) {
        ok(
          await db.from('documentos').update({ situacao: 'cancelada' }).eq('empresa_id', empresa.id).eq('chave', info.chave),
          'marcar cancelada',
        );
      }
    } else {
      // Resumo nunca sobrescreve um documento que já existe (pode já estar completo).
      ok(
        await db
          .from('documentos')
          .upsert({ ...linha, xml_resumo_path: caminho }, { onConflict: 'empresa_id,chave', ignoreDuplicates: true }),
        'insert resumo',
      );
    }
  } else if (info.tipo === 'evento') {
    chave = info.chave;
    const caminho = `${empresa.cnpj}/${anoMes(info.ocorridoEm)}/eventos/${info.chave}-${info.tpEvento}-${info.nSeq}.xml.gz`;
    await salvarXml(db, bucket, caminho, doc.xml);
    ok(
      await db.from('eventos').upsert(
        {
          empresa_id: empresa.id,
          chave: info.chave,
          tp_evento: info.tpEvento,
          n_seq: info.nSeq,
          descricao: info.descricao ?? null,
          ocorrido_em: info.ocorridoEm ?? null,
          protocolo: info.protocolo ?? null,
          nsu: doc.nsu,
          xml_path: caminho,
        },
        { onConflict: 'empresa_id,chave,tp_evento,n_seq' },
      ),
      'upsert evento',
    );
    if (EVENTO_CANCELAMENTO.has(info.tpEvento)) {
      ok(
        await db
          .from('documentos')
          .update({ situacao: 'cancelada', atualizado_em: new Date().toISOString() })
          .eq('empresa_id', empresa.id)
          .eq('chave', info.chave),
        'aplicar cancelamento',
      );
    }
  } else {
    await salvarXml(db, bucket, `${empresa.cnpj}/outros/${modelo}-${doc.nsu}.xml.gz`, doc.xml);
    log.warn('schema não reconhecido', { cnpj: empresa.cnpj, schema: doc.schema, nsu: doc.nsu });
  }

  ok(
    await db.from('dfe_recebidos').upsert(
      { empresa_id: empresa.id, modelo, nsu: doc.nsu, schema: doc.schema, chave },
      { onConflict: 'empresa_id,modelo,nsu', ignoreDuplicates: true },
    ),
    'registrar NSU',
  );
}

async function atualizarEstado(db: Db, empresaId: string, modelo: Modelo, campos: Record<string, unknown>) {
  ok(
    await db.from('sync_state').update(campos).eq('empresa_id', empresaId).eq('modelo', modelo),
    'atualizar sync_state',
  );
}

async function registrarLog(db: Db, reg: Record<string, unknown>) {
  const r = await db.from('logs_sefaz').insert(reg);
  if (r.error) log.warn('falha ao gravar logs_sefaz', { erro: r.error.message });
}

/**
 * Sincroniza um modelo (NF-e ou CT-e) de uma empresa, respeitando as regras da NT 2014.002:
 * - consulta em sequência enquanto ultNSU < maxNSU;
 * - ao chegar no fim (ultNSU = maxNSU) ou receber 137, só volta a consultar após 1 hora;
 * - 656 (consumo indevido) bloqueia o CNPJ por 1 hora.
 */
export async function sincronizarModelo(
  ctx: ContextoSync,
  empresa: EmpresaSync,
  modelo: Modelo,
  agent: https.Agent,
): Promise<ResultadoSync> {
  const { db } = ctx;
  const estado = ok(
    await db.from('sync_state').select('*').eq('empresa_id', empresa.id).eq('modelo', modelo).maybeSingle(),
    'ler sync_state',
  ) as any;
  if (!estado) throw new Error(`sync_state ausente para ${empresa.cnpj}/${modelo}`);

  if (new Date(estado.proxima_consulta_em).getTime() > Date.now()) {
    return { modelo, status: 'aguardando', chamadas: 0, documentos: 0, mensagem: `liberado em ${estado.proxima_consulta_em}` };
  }

  let ultNSU: string = estado.ult_nsu;
  let erros: number = estado.erros_consecutivos ?? 0;
  let chamadas = 0;
  let documentos = 0;

  while (chamadas < ctx.maxChamadasPorRodada) {
    chamadas++;
    const t0 = Date.now();
    let ret: RetornoDist;
    try {
      ret = await consultarDistNSU(modelo, agent, { tpAmb: ctx.tpAmb, cUF: empresa.c_uf, cnpj: empresa.cnpj, ultNSU });
    } catch (e) {
      erros++;
      const msg = (e as Error).message;
      await registrarLog(db, { empresa_id: empresa.id, modelo, ult_nsu_enviado: ultNSU, erro: msg, duracao_ms: Date.now() - t0 });
      await atualizarEstado(db, empresa.id, modelo, {
        ultima_consulta_em: new Date().toISOString(),
        erros_consecutivos: erros,
        ultimo_motivo: msg.slice(0, 500),
        proxima_consulta_em: daquiA(backoff(erros)),
      });
      log.error('falha na consulta', { cnpj: empresa.cnpj, modelo, erro: msg });
      return { modelo, status: 'erro', chamadas, documentos, mensagem: msg };
    }

    await registrarLog(db, {
      empresa_id: empresa.id,
      modelo,
      cstat: ret.cStat,
      motivo: ret.xMotivo,
      ult_nsu_enviado: ultNSU,
      ult_nsu_retornado: ret.ultNSU,
      max_nsu: ret.maxNSU,
      qtd_docs: ret.docs.length,
      duracao_ms: Date.now() - t0,
    });

    const base = {
      ultima_consulta_em: new Date().toISOString(),
      ultimo_cstat: ret.cStat,
      ultimo_motivo: ret.xMotivo,
    };

    if (ret.cStat === '138') {
      for (const doc of ret.docs) {
        await processarDoc(ctx, empresa, modelo, doc);
        documentos++;
      }
      // Se o NSU não avançou, trata como fim para não repetir a mesma consulta (evita 656).
      const naoAvancou = ret.ultNSU <= ultNSU;
      if (!naoAvancou) ultNSU = ret.ultNSU;
      erros = 0;
      const chegouAoFim = naoAvancou || ret.ultNSU >= ret.maxNSU;
      await atualizarEstado(db, empresa.id, modelo, {
        ...base,
        ult_nsu: ultNSU,
        max_nsu: ret.maxNSU,
        erros_consecutivos: 0,
        ultima_sync_ok_em: new Date().toISOString(),
        proxima_consulta_em: chegouAoFim ? daquiA(minutos(61)) : daquiA(minutos(5)),
      });
      if (chegouAoFim) return { modelo, status: 'ok', chamadas, documentos };
      await esperar(1500);
      continue;
    }

    if (ret.cStat === '137') {
      // Nenhum documento novo. A NT exige aguardar 1 hora antes de consultar de novo.
      await atualizarEstado(db, empresa.id, modelo, {
        ...base,
        ult_nsu: ret.ultNSU > ultNSU ? ret.ultNSU : ultNSU,
        max_nsu: ret.maxNSU,
        erros_consecutivos: 0,
        ultima_sync_ok_em: new Date().toISOString(),
        proxima_consulta_em: daquiA(minutos(61)),
      });
      return { modelo, status: 'ok', chamadas, documentos };
    }

    if (ret.cStat === '656') {
      await atualizarEstado(db, empresa.id, modelo, {
        ...base,
        erros_consecutivos: erros + 1,
        proxima_consulta_em: daquiA(minutos(65)),
      });
      log.warn('consumo indevido (656): CNPJ bloqueado por 1 hora', { cnpj: empresa.cnpj, modelo, motivo: ret.xMotivo });
      return { modelo, status: 'bloqueado_656', chamadas, documentos, mensagem: ret.xMotivo };
    }

    // Qualquer outra rejeição (certificado sem permissão, CNPJ divergente, etc.)
    erros++;
    await atualizarEstado(db, empresa.id, modelo, {
      ...base,
      erros_consecutivos: erros,
      proxima_consulta_em: daquiA(backoff(erros)),
    });
    log.error('rejeição da SEFAZ', { cnpj: empresa.cnpj, modelo, cStat: ret.cStat, motivo: ret.xMotivo });
    return { modelo, status: 'erro', chamadas, documentos, mensagem: `${ret.cStat} - ${ret.xMotivo}` };
  }

  return { modelo, status: 'parcial', chamadas, documentos, mensagem: 'limite de chamadas da rodada atingido' };
}
