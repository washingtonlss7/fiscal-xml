import https from 'https';
import { Db, ok, salvarXml } from './db';
import { log } from './log';
import { consultarDistNSU, DocZip, Modelo, RetornoDist } from './sefaz/distDFe';
import { gravarExtracao } from './extrator';
import { EVENTO_CANCELAMENTO, interpretar } from './sefaz/documentos';
import { daquiA, emParalelo, esperar, minutos } from './util';

export interface EmpresaSync {
  id: string;
  cnpj: string;
  c_uf: number;
  /** Certificado do escritório: recebe notas dos clientes pela tag autXML e as distribui. */
  escritorio?: boolean;
}

export interface ContextoSync {
  db: Db;
  bucket: string;
  tpAmb: 1 | 2;
  maxChamadasPorRodada: number;
  /** CNPJ -> empresa cadastrada, para distribuir as notas recebidas pelo escritório (autXML). */
  clientes?: Map<string, { id: string; cnpj: string }>;
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

/** consNSU (recuperação de lacunas): a SEFAZ aceita 20 por hora; usamos no máximo 15, uma vez por hora. */
const LACUNAS_POR_HORA = 15;

function anoMes(data?: string): string {
  return data && /^\d{4}-\d{2}/.test(data) ? `${data.slice(0, 4)}/${data.slice(5, 7)}` : 'sem-data';
}

/** Grava um documento já recebido (nota, resumo ou evento). Idempotente: pode ser reprocessado. */
async function processarDoc(ctx: ContextoSync, empresa: EmpresaSync, modelo: Modelo, doc: DocZip): Promise<string | null> {
  const { db, bucket } = ctx;
  const info = interpretar(doc.schema, doc.xml);

  if (info.tipo === 'documento') {
    // Nota recebida pelo escritório via autXML: pertence ao cliente emitente (saída) ou destinatário (entrada).
    let alvo: { id: string; cnpj: string } = empresa;
    let direcao: 'entrada' | 'saida' = info.emitCnpj === empresa.cnpj ? 'saida' : 'entrada';
    let via: 'proprio' | 'autxml' = 'proprio';
    if (empresa.escritorio && ctx.clientes) {
      const porEmit = info.emitCnpj ? ctx.clientes.get(info.emitCnpj) : undefined;
      const porDest = info.destDoc ? ctx.clientes.get(info.destDoc) : undefined;
      if (porEmit && porEmit.id !== empresa.id) { alvo = porEmit; direcao = 'saida'; via = 'autxml'; }
      else if (porDest && porDest.id !== empresa.id) { alvo = porDest; direcao = 'entrada'; via = 'autxml'; }
    }

    const sufixo = info.completo ? 'completo' : 'resumo';
    const caminho = `${alvo.cnpj}/${anoMes(info.emitidaEm)}/${info.modelo}/${info.chave}-${sufixo}.xml.gz`;
    await salvarXml(db, bucket, caminho, doc.xml);

    const linha = {
      empresa_id: alvo.id,
      recebido_via: via,
      modelo: info.modelo,
      chave: info.chave,
      direcao,
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
      // O XML completo diz "autorizada"; se já recebemos cancelamento (por qualquer empresa), mantém cancelada.
      const canc = ok(
        await db
          .from('eventos')
          .select('id')
          .eq('chave', info.chave)
          .in('tp_evento', [...EVENTO_CANCELAMENTO])
          .limit(1),
        'consulta cancelamento',
      );
      if (canc?.length) {
        ok(
          await db.from('documentos').update({ situacao: 'cancelada' }).eq('empresa_id', alvo.id).eq('chave', info.chave),
          'marcar cancelada',
        );
      }
      // Itens, tributos e duplicatas. Se falhar aqui, o extrator em segundo plano tenta de novo.
      try {
        await gravarExtracao(db, alvo.id, info.chave, info.modelo, doc.xml);
      } catch (e) {
        log.warn('extração adiada', { chave: info.chave, erro: (e as Error).message });
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
    return info.chave;
  }

  if (info.tipo === 'evento') {
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
      // O cancelamento vale para todas as cópias da nota (emitente e destinatário cadastrados).
      ok(
        await db
          .from('documentos')
          .update({ situacao: 'cancelada', atualizado_em: new Date().toISOString() })
          .eq('chave', info.chave),
        'aplicar cancelamento',
      );
    }
    return info.chave;
  }

  await salvarXml(db, bucket, `${empresa.cnpj}/outros/${modelo}-${doc.nsu}.xml.gz`, doc.xml);
  log.warn('schema não reconhecido', { cnpj: empresa.cnpj, schema: doc.schema, nsu: doc.nsu });
  return null;
}

/**
 * Passo 1 de cada lote: grava os documentos brutos na fila (dfe_recebidos) numa única operação.
 * Só depois disso o ultNSU é salvo, e o processamento pode falhar/reiniciar sem perder nada.
 */
async function enfileirar(db: Db, empresa: EmpresaSync, modelo: Modelo, docs: DocZip[]): Promise<void> {
  if (!docs.length) return;
  ok(
    await db.from('dfe_recebidos').upsert(
      docs.map((d) => ({ empresa_id: empresa.id, modelo, nsu: d.nsu, schema: d.schema, xml: d.xml, processado: false })),
      { onConflict: 'empresa_id,modelo,nsu', ignoreDuplicates: true },
    ),
    'enfileirar documentos',
  );
}

/**
 * Passo 2: processa o que estiver na fila desta empresa/modelo (inclusive sobras de uma execução interrompida).
 * Notas e resumos vão em paralelo; eventos depois, em ordem, para o cancelamento encontrar a nota já gravada.
 */
async function processarFila(ctx: ContextoSync, empresa: EmpresaSync, modelo: Modelo): Promise<number> {
  const { db } = ctx;
  let total = 0;
  for (;;) {
    const pendentes = ok(
      await db
        .from('dfe_recebidos')
        .select('nsu,schema,xml')
        .eq('empresa_id', empresa.id)
        .eq('modelo', modelo)
        .eq('processado', false)
        .order('nsu')
        .limit(200),
      'ler fila',
    ) as { nsu: string; schema: string; xml: string | null }[];
    if (!pendentes.length) return total;

    const docs: DocZip[] = pendentes.filter((p) => p.xml).map((p) => ({ nsu: p.nsu, schema: p.schema, xml: p.xml as string }));
    const chaves = new Map<string, string | null>();
    const ehEvento = (d: DocZip) => /^(resEvento|procEvento)/.test(d.schema);
    await emParalelo(docs.filter((d) => !ehEvento(d)), 6, async (d) => {
      chaves.set(d.nsu, await processarDoc(ctx, empresa, modelo, d));
    });
    for (const d of docs.filter(ehEvento)) chaves.set(d.nsu, await processarDoc(ctx, empresa, modelo, d));

    // Marca como processado e descarta o XML da fila (ele já está no Storage).
    await emParalelo(pendentes, 6, async (p) => {
      ok(
        await db
          .from('dfe_recebidos')
          .update({ processado: true, xml: null, chave: chaves.get(p.nsu) ?? null })
          .eq('empresa_id', empresa.id)
          .eq('modelo', modelo)
          .eq('nsu', p.nsu),
        'marcar processado',
      );
    });
    total += docs.length;
  }
}

/**
 * Recupera NSUs que ficaram faltando na sequência (consNSU), no máximo uma vez por hora.
 * Um NSU sem documento (cStat 137) é registrado como "vazio" para não ser consultado de novo.
 */
async function recuperarLacunas(
  ctx: ContextoSync,
  empresa: EmpresaSync,
  modelo: Modelo,
  agent: https.Agent,
  ultNSU: string,
  verificadasEm: string | null,
): Promise<number> {
  const { db } = ctx;
  if (verificadasEm && Date.now() - new Date(verificadasEm).getTime() < minutos(61)) return 0;

  const lacunas = ok(
    await db.rpc('lacunas_nsu', { p_empresa: empresa.id, p_modelo: modelo, p_ate: ultNSU, p_limite: LACUNAS_POR_HORA }),
    'listar lacunas',
  ) as { nsu: string }[];
  await db
    .from('sync_state')
    .update({ lacunas_verificadas_em: new Date().toISOString() })
    .eq('empresa_id', empresa.id)
    .eq('modelo', modelo);
  if (!lacunas?.length) return 0;

  log.info('recuperando lacunas de NSU', { cnpj: empresa.cnpj, modelo, qtd: lacunas.length });
  let recuperados = 0;
  for (const { nsu } of lacunas) {
    const t0 = Date.now();
    let ret: RetornoDist;
    try {
      ret = await consultarDistNSU(modelo, agent, { tpAmb: ctx.tpAmb, cUF: empresa.c_uf, cnpj: empresa.cnpj, nsu });
    } catch (e) {
      log.warn('falha ao recuperar NSU', { cnpj: empresa.cnpj, modelo, nsu, erro: (e as Error).message });
      break;
    }
    await registrarLog(db, {
      empresa_id: empresa.id, modelo, cstat: ret.cStat, motivo: `consNSU: ${ret.xMotivo}`,
      ult_nsu_enviado: nsu, qtd_docs: ret.docs.length, duracao_ms: Date.now() - t0,
    });
    if (ret.cStat === '138' && ret.docs.length) {
      await enfileirar(db, empresa, modelo, ret.docs);
      recuperados += ret.docs.length;
    } else if (ret.cStat === '137') {
      ok(
        await db.from('dfe_recebidos').upsert(
          { empresa_id: empresa.id, modelo, nsu, schema: 'vazio', processado: true },
          { onConflict: 'empresa_id,modelo,nsu', ignoreDuplicates: true },
        ),
        'registrar NSU vazio',
      );
    } else {
      break; // 656 ou outra rejeição: para e tenta na próxima hora
    }
    await esperar(500);
  }
  if (recuperados) await processarFila(ctx, empresa, modelo);
  return recuperados;
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
 * - consulta em sequência enquanto ultNSU < maxNSU, sempre com o último ultNSU devolvido;
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

  // Sobras de uma execução interrompida são processadas antes de qualquer consulta.
  let documentos = await processarFila(ctx, empresa, modelo);

  const estado = ok(
    await db.from('sync_state').select('*').eq('empresa_id', empresa.id).eq('modelo', modelo).maybeSingle(),
    'ler sync_state',
  ) as any;
  if (!estado) throw new Error(`sync_state ausente para ${empresa.cnpj}/${modelo}`);

  if (new Date(estado.proxima_consulta_em).getTime() > Date.now()) {
    return { modelo, status: 'aguardando', chamadas: 0, documentos, mensagem: `liberado em ${estado.proxima_consulta_em}` };
  }

  let ultNSU: string = estado.ult_nsu;
  let erros: number = estado.erros_consecutivos ?? 0;
  let chamadas = 0;

  const finalizar = async (status: ResultadoSync['status']) => {
    // Fila em dia: aproveita para recuperar NSUs que ficaram faltando.
    documentos += await recuperarLacunas(ctx, empresa, modelo, agent, ultNSU, estado.lacunas_verificadas_em ?? null);
    return { modelo, status, chamadas, documentos };
  };

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
      // 1) guarda o lote bruto, 2) salva o NSU devolvido, 3) processa. Nessa ordem, um reinício não quebra a sequência.
      await enfileirar(db, empresa, modelo, ret.docs);
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
        proxima_consulta_em: chegouAoFim ? daquiA(minutos(61)) : daquiA(minutos(3)),
      });
      documentos += await processarFila(ctx, empresa, modelo);
      if (chegouAoFim) return finalizar('ok');
      await esperar(1500);
      continue;
    }

    if (ret.cStat === '137') {
      // Nenhum documento novo. A NT exige aguardar 1 hora antes de consultar de novo.
      if (ret.ultNSU > ultNSU) ultNSU = ret.ultNSU;
      await atualizarEstado(db, empresa.id, modelo, {
        ...base,
        ult_nsu: ultNSU,
        max_nsu: ret.maxNSU,
        erros_consecutivos: 0,
        ultima_sync_ok_em: new Date().toISOString(),
        proxima_consulta_em: daquiA(minutos(61)),
      });
      return finalizar('ok');
    }

    if (ret.cStat === '656') {
      // Se a SEFAZ acusar NSU desatualizado, ela devolve o ultNSU correto: adota esse valor
      // e as notas que ficaram para trás entram na recuperação de lacunas.
      const corrigiu = /ultNSU/i.test(ret.xMotivo) && ret.ultNSU > ultNSU;
      if (corrigiu) ultNSU = ret.ultNSU;
      await atualizarEstado(db, empresa.id, modelo, {
        ...base,
        ...(corrigiu ? { ult_nsu: ultNSU } : {}),
        erros_consecutivos: erros + 1,
        proxima_consulta_em: daquiA(minutos(65)),
      });
      log.warn('consumo indevido (656): CNPJ bloqueado por 1 hora', { cnpj: empresa.cnpj, modelo, motivo: ret.xMotivo, corrigiu });
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
