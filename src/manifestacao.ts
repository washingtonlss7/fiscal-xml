import https from 'https';
import { Certificado } from './cert';
import { Db, ok } from './db';
import { log } from './log';
import { enviarCiencia, MAX_EVENTOS_POR_LOTE } from './sefaz/evento';
import { EmpresaSync } from './sync';

/** Retornos que significam "ciência registrada" (135/136) ou "já existia" (573 duplicidade). */
const REGISTRADO = new Set(['135', '136', '573']);

/**
 * Dá Ciência da Operação (210210) nas NF-e de entrada que chegaram só como resumo.
 * Depois disso, a SEFAZ libera o XML completo, que chega na próxima consulta do distNSU.
 */
export async function manifestarPendentes(
  db: Db,
  tpAmb: 1 | 2,
  empresa: EmpresaSync,
  cert: Certificado,
  agent: https.Agent,
  limite = 100,
): Promise<{ registradas: number; rejeitadas: number }> {
  const pendentes = ok(
    await db
      .from('documentos')
      .select('chave')
      .eq('empresa_id', empresa.id)
      .eq('modelo', '55')
      .eq('completo', false)
      .eq('direcao', 'entrada')
      .eq('recebido_via', 'proprio')
      .eq('situacao', 'autorizada')
      .is('manifestacao_status', null)
      .order('emitida_em', { ascending: false })
      .limit(limite),
    'listar notas para ciência',
  ) as { chave: string }[];

  let registradas = 0;
  let rejeitadas = 0;
  for (let i = 0; i < pendentes.length; i += MAX_EVENTOS_POR_LOTE) {
    const chaves = pendentes.slice(i, i + MAX_EVENTOS_POR_LOTE).map((p) => p.chave);
    let ret;
    try {
      ret = await enviarCiencia(agent, cert, { tpAmb, cnpj: empresa.cnpj, chaves });
    } catch (e) {
      log.warn('falha ao enviar ciência', { cnpj: empresa.cnpj, erro: (e as Error).message });
      break; // tenta de novo na próxima rodada
    }
    await db.from('logs_sefaz').insert({
      empresa_id: empresa.id, modelo: 'nfe', cstat: ret.cStat, motivo: `Ciência (${chaves.length}): ${ret.xMotivo}`,
      qtd_docs: ret.eventos.length,
    });
    if (ret.cStat !== '128') {
      log.warn('lote de ciência rejeitado', { cnpj: empresa.cnpj, cStat: ret.cStat, motivo: ret.xMotivo });
      break;
    }
    const agora = new Date().toISOString();
    for (const ev of ret.eventos) {
      const okEv = REGISTRADO.has(ev.cStat);
      if (okEv) registradas++;
      else rejeitadas++;
      await db
        .from('documentos')
        .update({
          manifestacao: okEv ? 'ciencia' : null,
          manifestacao_status: okEv ? 'ciencia' : 'rejeitada',
          manifestacao_em: agora,
          manifestacao_motivo: `${ev.cStat} - ${ev.xMotivo}`.slice(0, 300),
        })
        .eq('empresa_id', empresa.id)
        .eq('chave', ev.chave);
    }
  }
  if (registradas || rejeitadas) log.info('ciência da operação', { cnpj: empresa.cnpj, registradas, rejeitadas });
  return { registradas, rejeitadas };
}
