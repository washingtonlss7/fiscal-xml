/**
 * Appura NFC-e Worker (Fase 1): agenda, backoff, circuit breaker, checkpoint, lock, execução de um dia com
 * conectores FALSOS (nenhum acesso à SEFAZ), retry, e reinício do processo sem perder nem duplicar notas.
 *
 *   npx tsx test/nfce-worker.test.ts
 */
import assert from 'assert';
import { backoffMs, CircuitBreaker, datasPendentes, deveAgendar, diaSP, instanteDoHorario, somarDias } from '../src/nfce/agenda';
import { chaveDaEmpresa, ErroConector, NFCeDiscoveryConnector, NFCeDownloadService, RegistroConectores } from '../src/nfce/conector';
import { avancarCheckpoint, executarDia } from '../src/nfce/execucoes';
import { Lock } from '../src/nfce/lock';
import { empresasHabilitadas, processarEmpresa } from '../src/nfce/worker';
import { Consulta, Linha } from './banco-falso';

/* ---------- 1) regras puras ---------- */
{
  assert.equal(somarDias('2026-03-01', -1), '2026-02-28');
  assert.equal(diaSP(new Date('2026-10-03T02:00:00Z')), '2026-10-02', '23h em São Paulo ainda é o dia anterior');
  assert.deepEqual(datasPendentes(null, '2026-10-03', 3), ['2026-09-30', '2026-10-01', '2026-10-02'], 'primeira vez: só a janela');
  assert.deepEqual(datasPendentes('2026-10-02', '2026-10-03', 3), ['2026-09-30', '2026-10-01', '2026-10-02'], 'em dia: reconcilia a janela');
  assert.deepEqual(datasPendentes('2026-09-25', '2026-10-03', 2), ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'], 'worker parado: recupera os dias perdidos');
  assert.equal(datasPendentes('2026-01-01', '2026-10-03', 3, 31)[0], '2026-09-02', 'recuperação limitada a 31 dias');
  assert.ok(!datasPendentes('2026-09-01', '2026-10-03', 3).includes('2026-10-03'), 'nunca o dia de hoje');

  assert.equal(instanteDoHorario('2026-10-03', '02:00'), '2026-10-03T05:00:00.000Z');
  assert.equal(deveAgendar('02:00', new Date('2026-10-03T04:59:00Z'), null), false, 'antes do horário');
  assert.equal(deveAgendar('02:00', new Date('2026-10-03T05:01:00Z'), null), true);
  assert.equal(deveAgendar('02:00', new Date('2026-10-03T09:00:00Z'), '2026-10-03T05:01:00Z'), false, 'já tentou hoje');
  assert.equal(deveAgendar('02:00', new Date('2026-10-03T09:00:00Z'), '2026-10-02T05:01:00Z'), true, 'a tentativa foi ontem');

  assert.equal(backoffMs(1, 60, () => 0.5), 60_000);
  assert.equal(backoffMs(3, 60, () => 0.5), 240_000);
  assert.equal(backoffMs(2, 60, () => 0), 60_000, '−50%');
  assert.equal(backoffMs(2, 60, () => 1), 180_000, '+50%');
  assert.equal(backoffMs(20, 60, () => 0.5), 3_600_000, 'teto de 1 hora');

  const b = new CircuitBreaker(3, 1000);
  b.falha('SEFAZ_FORA', 0); b.falha('SEFAZ_FORA', 0); assert.ok(b.pode(0));
  b.falha('OUTRO', 0); b.falha('SEFAZ_FORA', 0); b.falha('SEFAZ_FORA', 0); assert.ok(b.pode(0), 'código diferente recomeça a contagem');
  b.falha('SEFAZ_FORA', 0); assert.ok(!b.pode(500), 'abre com 3 falhas seguidas do mesmo código');
  assert.equal(b.estado(500).aberto, true);
  assert.ok(b.pode(1001), 'depois da pausa deixa passar uma (meio aberto)');
  b.falha('SEFAZ_FORA', 1001); assert.ok(!b.pode(1500), 'falhou no meio aberto: abre de novo');
  assert.ok(b.pode(2002)); b.sucesso(); assert.ok(b.pode(2003)); assert.equal(b.estado(2003).falhasSeguidas, 0);

  assert.equal(avancarCheckpoint(null, [{ data: '2026-10-01', status: 'concluida' }, { data: '2026-10-02', status: 'concluida' }]), '2026-10-02');
  assert.equal(avancarCheckpoint('2026-09-30', [{ data: '2026-10-01', status: 'parcial' }, { data: '2026-10-02', status: 'concluida' }]), '2026-09-30', 'dia parcial segura o checkpoint');
  assert.equal(avancarCheckpoint('2026-09-30', [{ data: '2026-10-01', status: 'concluida' }, { data: '2026-10-02', status: 'falhou' }]), '2026-10-01');
  assert.equal(avancarCheckpoint('2026-09-28', [{ data: '2026-09-30', status: 'concluida' }]), '2026-09-28', 'buraco (dia não processado) segura');
  assert.equal(avancarCheckpoint('2026-10-02', [{ data: '2026-09-30', status: 'falhou' }, { data: '2026-10-01', status: 'concluida' }]), '2026-10-02', 'reconciliar dias antigos nunca volta o checkpoint');
  assert.equal(avancarCheckpoint(null, [{ data: '2026-10-01', status: 'ocupado' }]), null, 'executando/ocupado não avança');
  console.log('ok  agenda (janela, recuperação, horário), backoff com teto, circuit breaker e checkpoint só em dias concluídos em sequência');
}

/* ---------- banco falso com as tabelas do NFC-e, documentos e as funções de lock ---------- */
const CNPJ = '55885998000140';
const E = { id: 'emp-1', cnpj: CNPJ, uf: 'ES', razao_social: 'FARMA DIGITAL STORE' };
const chave = (n: number, mod = '65', cnpj = CNPJ) => `322610${cnpj}${mod}001${String(n).padStart(9, '0')}1${String(n).padStart(8, '0')}`.slice(0, 43) + '0';

function banco() {
  const t: Record<string, Linha[]> = { empresas: [], certificados: [], documentos: [], nfce_config: [], nfce_checkpoint: [], nfce_execucoes: [], nfce_locks: [], outros: [] };
  let n = 0; const seq = () => ++n;
  const ops: string[] = [];
  const from = (nome: string) => {
    if (nome === 'nfce_execucoes') {
      // Simula o índice único parcial (empresa_id, data_referencia) where status = 'executando'
      const q = new Consulta(t.nfce_execucoes, seq) as any;
      const insert = q.insert.bind(q);
      q.insert = (d: any) => {
        if (t.nfce_execucoes.some((x) => x.status === 'executando' && x.empresa_id === d.empresa_id && x.data_referencia === d.data_referencia)) {
          const erro: any = { select: () => erro, single: () => erro, then: (ok: any) => Promise.resolve({ data: null, error: { message: 'duplicate key' } }).then(ok) };
          return erro;
        }
        return insert({ run_id: `run-${seq()}`, ...d });
      };
      return q;
    }
    if (nome === 'documentos') {
      // O pipeline (processarDoc) grava em documentos: aqui só guardamos a chave, o que basta para a deduplicação
      const q = new Consulta(t.documentos, seq) as any;
      const upsert = q.upsert.bind(q);
      q.upsert = (d: any, o: any) => { ops.push('documentos.upsert'); return upsert(d, o); };
      q.not = () => q;
      return q;
    }
    if (t[nome]) return new Consulta(t[nome], seq);
    // Demais tabelas do pipeline (itens, eventos, cadastros…): aceitam tudo e devolvem vazio
    const q: any = new Consulta(t.outros, seq); q.not = () => q; return q;
  };
  const rpc = async (fn: string, p: any) => {
    const agora = Date.now();
    const l = t.nfce_locks.find((x) => x.chave === p.p_chave);
    if (fn === 'nfce_lock_adquirir') {
      if (!l) { t.nfce_locks.push({ chave: p.p_chave, dono: p.p_dono, expira_em: agora + p.p_segundos * 1000 }); return { data: true, error: null }; }
      if (l.expira_em < agora || l.dono === p.p_dono) { l.dono = p.p_dono; l.expira_em = agora + p.p_segundos * 1000; return { data: true, error: null }; }
      return { data: false, error: null };
    }
    if (fn === 'nfce_lock_renovar') { if (l && l.dono === p.p_dono) { l.expira_em = agora + p.p_segundos * 1000; return { data: true, error: null }; } return { data: false, error: null }; }
    if (fn === 'nfce_lock_liberar') { const i = t.nfce_locks.findIndex((x) => x.chave === p.p_chave && x.dono === p.p_dono); if (i >= 0) t.nfce_locks.splice(i, 1); return { data: i >= 0, error: null }; }
    if (fn === 'registrar_status' || fn) return { data: null, error: null };
    return { data: null, error: null };
  };
  return { db: { from, rpc } as any, t, ops };
}

function nfce(ch: string) {
  const n = Number(ch.slice(25, 34));
  const nfe = `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${ch}" versao="4.00"><ide><cUF>32</cUF><mod>65</mod><serie>1</serie><nNF>${n}</nNF><dhEmi>2026-10-01T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>${CNPJ}</CNPJ><xNome>FARMA</xNome><enderEmit><UF>ES</UF></enderEmit><CRT>3</CRT></emit><det nItem="1"><prod><cProd>1</cProd><xProd>DIPIRONA</xProd><NCM>30049099</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>10</vUnCom><vProd>10.00</vProd></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST></ICMS00></ICMS></imposto></det><total><ICMSTot><vProd>10.00</vProd><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe>`;
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">${nfe}<protNFe versao="4.00"><infProt><chNFe>${ch}</chNFe><nProt>132260000000${n}</nProt><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo></infProt></protNFe></nfeProc>`);
}

/** Conector de descoberta falso: devolve as chaves configuradas para cada dia (ou lança o erro configurado). */
function descobertaFalsa(porDia: Record<string, string[]>, erros: Record<string, ErroConector> = {}) {
  const chamadas: string[] = [];
  const c: NFCeDiscoveryConnector = { uf: 'ES', descobrir: async (_ctx, data) => { chamadas.push(data); if (erros[data]) throw erros[data]; return (porDia[data] ?? []).map((k) => ({ chave: k })); } };
  return { c, chamadas };
}
function downloadFalso(falhar: Set<string> = new Set()) {
  const baixadas: string[] = [];
  const c: NFCeDownloadService = { uf: 'ES', baixar: async (_ctx, k) => { baixadas.push(k); if (falhar.has(k)) throw new ErroConector('TIMEOUT', 'tempo esgotado'); return nfce(k); } };
  return { c, baixadas };
}
const armFalso = { salvar: async (c: string) => `r2:${c}` } as any;

(async () => {
  /* ---------- 2) lock ---------- */
  {
    const { db, t } = banco();
    const a = new Lock(db, 'nfce:x:2026-10-01', 'A', 60); const b = new Lock(db, 'nfce:x:2026-10-01', 'B', 60);
    assert.equal(await a.adquirir(), true);
    assert.equal(await b.adquirir(), false, 'segundo processo não pega o mesmo lock');
    assert.ok(a.valido);
    t.nfce_locks[0].expira_em = Date.now() - 1; // A morreu e o prazo venceu
    assert.equal(await b.adquirir(), true, 'lock vencido pode ser tomado');
    await a.liberar();
    assert.equal(t.nfce_locks.length, 1, 'o dono antigo não libera o lock de outro');
    await b.liberar();
    assert.equal(t.nfce_locks.length, 0);
    console.log('ok  lock por arrendamento: exclusivo, vence sozinho se o dono morrer e só o dono libera');
  }

  /* ---------- 3) execução de um dia ---------- */
  {
    const { db, t } = banco();
    const k1 = chave(1), k2 = chave(2), k3 = chave(3);
    t.documentos.push({ empresa_id: E.id, chave: k1, completo: true });
    const desc = descobertaFalsa({ '2026-10-01': [k1, k2, k3, k3, chave(9, '55'), chave(8, '65', '11222333000181'), 'lixo'] });
    // Sem serviço de download: dia parcial e nada baixado
    const semDl = new RegistroConectores().registrarDescoberta(desc.c);
    const r0 = await executarDia({ db, conectores: semDl, arm: armFalso, dono: 'W1' }, E, '2026-10-01', 'manual');
    assert.equal(r0.situacao, 'executada');
    if (r0.situacao !== 'executada') throw 0;
    assert.deepEqual([r0.status, r0.erroCodigo, r0.encontrados, r0.existentes, r0.novos], ['parcial', 'SEM_DOWNLOAD', 3, 1, 2], 'filtra modelo/CNPJ/inválidas, deduplica e marca parcial');
    assert.equal(t.nfce_locks.length, 0, 'lock liberado ao terminar');
    assert.equal(t.nfce_execucoes[0].status, 'parcial');
    assert.ok(t.nfce_execucoes[0].terminado_em && t.nfce_execucoes[0].versao_worker);

    // Com download: baixa só as ausentes e grava pelo pipeline existente
    const dl = downloadFalso();
    const reg = new RegistroConectores().registrarDescoberta(desc.c).registrarDownload(dl.c);
    const r1 = await executarDia({ db, conectores: reg, arm: armFalso, dono: 'W1' }, E, '2026-10-01', 'manual');
    if (r1.situacao !== 'executada') throw new Error(r1.situacao);
    assert.deepEqual(dl.baixadas, [k2, k3], 'baixa só as que faltam');
    assert.deepEqual([r1.status, r1.baixadosOk, r1.baixadosFalha], ['concluida', 2, 0]);
    assert.ok(t.documentos.some((d) => d.chave === k2) && t.documentos.some((d) => d.chave === k3), 'gravadas pelo pipeline fiscal');

    // Reprocessar o mesmo dia não baixa nem duplica nada
    const r2 = await executarDia({ db, conectores: reg, arm: armFalso, dono: 'W1' }, E, '2026-10-01', 'manual');
    if (r2.situacao !== 'executada') throw 0;
    assert.deepEqual([r2.status, r2.novos], ['concluida', 0]);
    assert.equal(dl.baixadas.length, 2);
    assert.equal(new Set(t.documentos.map((d) => d.chave)).size, t.documentos.filter((d) => d.chave).length, 'nenhuma chave duplicada');

    // Download falhando: parcial com DOWNLOAD_INCOMPLETO
    const k4 = chave(4), k5 = chave(5);
    const desc2 = descobertaFalsa({ '2026-10-02': [k4, k5] });
    const dl2 = downloadFalso(new Set([k5]));
    const r3 = await executarDia({ db, conectores: new RegistroConectores().registrarDescoberta(desc2.c).registrarDownload(dl2.c), arm: armFalso, dono: 'W1' }, E, '2026-10-02', 'agendada');
    if (r3.situacao !== 'executada') throw 0;
    assert.deepEqual([r3.status, r3.erroCodigo, r3.baixadosOk, r3.baixadosFalha], ['parcial', 'DOWNLOAD_INCOMPLETO', 1, 1]);

    // Outro processo com o lock: "ocupado", sem tocar em nada
    t.nfce_locks.push({ chave: `nfce:${E.id}:2026-10-03`, dono: 'OUTRO', expira_em: Date.now() + 60_000 });
    const antes = t.nfce_execucoes.length;
    const r4 = await executarDia({ db, conectores: reg, arm: armFalso, dono: 'W1' }, E, '2026-10-03', 'manual');
    assert.equal(r4.situacao, 'ocupado'); assert.equal(t.nfce_execucoes.length, antes);
    // Execução "executando" registrada por outro (índice único): também ocupado, e o lock é devolvido
    t.nfce_execucoes.push({ empresa_id: E.id, data_referencia: '2026-10-04', status: 'executando' });
    assert.equal((await executarDia({ db, conectores: reg, arm: armFalso, dono: 'W1' }, E, '2026-10-04', 'manual')).situacao, 'ocupado');
    assert.ok(!t.nfce_locks.some((l) => l.chave.endsWith('2026-10-04')));

    // Erro do conector: falhou, com código e se é temporário
    const desc3 = descobertaFalsa({}, { '2026-10-05': new ErroConector('CAPTCHA', 'CAPTCHA exigido: automação interrompida', false) });
    const r5 = await executarDia({ db, conectores: new RegistroConectores().registrarDescoberta(desc3.c), arm: armFalso, dono: 'W1' }, E, '2026-10-05', 'agendada');
    if (r5.situacao !== 'executada') throw 0;
    assert.deepEqual([r5.status, r5.erroCodigo, r5.temporario], ['falhou', 'CAPTCHA', false]);
    assert.equal((await executarDia({ db, conectores: new RegistroConectores(), arm: null, dono: 'W1' }, E, '2026-10-05', 'manual')).situacao, 'sem_conector');
    assert.ok(chaveDaEmpresa(k2, CNPJ) && !chaveDaEmpresa(chave(1, '55'), CNPJ));
    console.log('ok  execução do dia: filtra e deduplica chaves, baixa só as ausentes pelo pipeline, parcial sem download, ocupado com lock, erro definitivo (CAPTCHA)');
  }

  /* ---------- 4) ciclo por empresa: agenda, retry, checkpoint, reinício ---------- */
  {
    const { db, t } = banco();
    t.empresas.push({ ...E, ativo: true }, { id: 'emp-2', cnpj: '11222333000181', uf: 'ES', razao_social: 'SEM CERT', ativo: true }, { id: 'emp-3', cnpj: '99888777000166', uf: 'ES', razao_social: 'INATIVA', ativo: false });
    t.certificados.push({ empresa_id: E.id, ativo: true, valido_ate: '2027-01-01T00:00:00Z' }, { empresa_id: 'emp-2', ativo: true, valido_ate: '2026-01-01T00:00:00Z' }, { empresa_id: 'emp-3', ativo: true, valido_ate: '2027-01-01T00:00:00Z' });
    const cfg = { empresa_id: E.id, ativo: true, horario: '02:00', janela_dias: 2, max_tentativas: 3, backoff_base_seg: 60 };
    t.nfce_config.push(cfg, { ...cfg, empresa_id: 'emp-2' }, { ...cfg, empresa_id: 'emp-3' }, { ...cfg, empresa_id: 'emp-4', ativo: false });
    const hab = await empresasHabilitadas(db, new Date('2026-10-03T12:00:00Z'));
    assert.deepEqual(hab.map((x) => x.empresa.id), [E.id], 'só ativa, com automação ligada e certificado válido');

    // Fase 1 em produção: registro vazio → sem_conector, sem tocar na SEFAZ
    let agora = new Date('2026-10-03T05:10:00Z');
    const vazio = await processarEmpresa({ db, conectores: new RegistroConectores(), arm: null, dono: 'W1', breaker: new CircuitBreaker(), agora: () => agora }, E, cfg);
    assert.equal(vazio.situacao, 'sem_conector');
    assert.equal(t.nfce_checkpoint[0].erro_codigo, 'SEM_CONECTOR');
    assert.equal(t.nfce_execucoes.length, 0);

    // Fora do horário: não faz nada
    t.nfce_checkpoint[0].ultima_tentativa_em = null;
    agora = new Date('2026-10-03T04:00:00Z');
    const desc = descobertaFalsa({ '2026-10-01': [chave(11)], '2026-10-02': [chave(12), chave(13)] }, { '2026-10-02': new ErroConector('SEFAZ_FORA', 'serviço indisponível', true) });
    const dl = downloadFalso();
    const reg = new RegistroConectores().registrarDescoberta(desc.c).registrarDownload(dl.c);
    const breaker = new CircuitBreaker(5, 600_000);
    const deps = () => ({ db, conectores: reg, arm: armFalso, dono: 'W1', breaker, agora: () => agora, aleatorio: () => 0.5 });
    assert.equal((await processarEmpresa(deps(), E, cfg)).situacao, 'fora_do_horario');

    // 02:10: D-2 ok, D-1 com SEFAZ fora (temporário) → checkpoint em D-2 e retry agendado com backoff
    agora = new Date('2026-10-03T05:10:00Z');
    const r1 = await processarEmpresa(deps(), E, cfg);
    assert.equal(r1.situacao, 'processada');
    let cp = t.nfce_checkpoint[0];
    assert.deepEqual([cp.ultima_data_ok, cp.status, cp.tentativas_seguidas, cp.erro_codigo], ['2026-10-01', 'falhou', 1, 'SEFAZ_FORA']);
    assert.equal(cp.proxima_tentativa_em, new Date(agora.getTime() + 60_000).toISOString(), 'backoff de 60 s na 1ª');
    assert.equal(breaker.estado(agora.getTime()).falhasSeguidas, 1);

    // Antes do retry vencer: nada; depois: tenta de novo (a SEFAZ voltou) e o checkpoint avança
    agora = new Date('2026-10-03T05:10:30Z');
    assert.equal((await processarEmpresa(deps(), E, cfg)).situacao, 'fora_do_horario');
    const desc2 = descobertaFalsa({ '2026-10-01': [chave(11)], '2026-10-02': [chave(12), chave(13)] });
    reg.registrarDescoberta(desc2.c);
    agora = new Date('2026-10-03T05:11:30Z');
    await processarEmpresa(deps(), E, cfg);
    cp = t.nfce_checkpoint[0];
    assert.deepEqual([cp.ultima_data_ok, cp.status, cp.tentativas_seguidas, cp.proxima_tentativa_em, cp.erro_codigo], ['2026-10-02', 'ok', 0, null, null]);
    assert.ok(cp.ultimo_sucesso_em);
    const exec = t.nfce_execucoes.filter((x) => x.data_referencia === '2026-10-02');
    assert.deepEqual(exec.map((x) => [x.status, x.tentativa]), [['falhou', 1], ['concluida', 2]], 'histórico de cada tentativa');
    assert.deepEqual(dl.baixadas.sort(), [chave(11), chave(12), chave(13)].sort(), 'cada XML baixado uma vez só');

    // Retry esgotado: depois de max_tentativas, para e espera o dia seguinte
    const sempreFora = descobertaFalsa({}, { '2026-10-03': new ErroConector('SEFAZ_FORA', 'fora', true) });
    reg.registrarDescoberta(sempreFora.c);
    const cfg1 = { ...cfg, janela_dias: 1, max_tentativas: 2 };
    agora = new Date('2026-10-04T05:10:00Z');
    await processarEmpresa(deps(), E, cfg1);
    assert.equal(t.nfce_checkpoint[0].tentativas_seguidas, 1);
    agora = new Date(Date.parse(t.nfce_checkpoint[0].proxima_tentativa_em) + 1000);
    await processarEmpresa(deps(), E, cfg1);
    cp = t.nfce_checkpoint[0];
    assert.deepEqual([cp.tentativas_seguidas, cp.proxima_tentativa_em, cp.ultima_data_ok, cp.status], [0, null, '2026-10-02', 'falhou'], 'limite de tentativas: não insiste mais hoje');
    agora = new Date(agora.getTime() + 3600_000);
    assert.equal((await processarEmpresa(deps(), E, cfg1)).situacao, 'fora_do_horario');
    console.log('ok  ciclo: empresas habilitadas, sem conector (Fase 1), horário, retry com backoff até o limite, checkpoint e histórico por tentativa');
  }

  /* ---------- 5) reinício no meio: nada perdido, nada duplicado ---------- */
  {
    const { db, t } = banco();
    t.nfce_checkpoint.push({ empresa_id: E.id, uf: 'ES', ultima_data_ok: '2026-09-27', ultima_tentativa_em: null, tentativas_seguidas: 0, proxima_tentativa_em: null, status: 'ok' });
    const porDia: Record<string, string[]> = {};
    for (let d = 28, n = 100; d <= 30; d++) porDia[`2026-09-${d}`] = [chave(n++), chave(n++)];
    porDia['2026-10-01'] = [chave(200), chave(201)]; porDia['2026-10-02'] = [chave(202)];
    const cfg = { empresa_id: E.id, ativo: true, horario: '02:00', janela_dias: 2, max_tentativas: 3, backoff_base_seg: 60 };
    // 1º processo: "morre" (erro inesperado) ao baixar a 1ª nota de 30/09
    const dl1 = downloadFalso(); let morreu = false;
    const morre: NFCeDownloadService = { uf: 'ES', baixar: async (ctx, k) => { if (k === porDia['2026-09-30'][0] && !morreu) { morreu = true; throw new Error('processo reiniciado'); } return dl1.c.baixar(ctx, k); } };
    const reg1 = new RegistroConectores().registrarDescoberta(descobertaFalsa(porDia).c).registrarDownload(morre);
    const agora = new Date('2026-10-03T05:10:00Z');
    await processarEmpresa({ db, conectores: reg1, arm: armFalso, dono: 'W1', breaker: new CircuitBreaker(), agora: () => agora }, E, cfg);
    assert.equal(t.nfce_checkpoint[0].ultima_data_ok, '2026-09-29', 'parou antes do dia incompleto (30/09 parcial)');
    // Simula a queda: um lock e uma execução ficaram pendurados
    t.nfce_locks.push({ chave: `nfce:${E.id}:2026-09-30`, dono: 'W1-morto', expira_em: Date.now() - 1 });
    // 2º processo (novo dono) retoma: recupera o 30/09 e segue
    const dl2 = downloadFalso();
    const reg2 = new RegistroConectores().registrarDescoberta(descobertaFalsa(porDia).c).registrarDownload(dl2.c);
    const depois = new Date('2026-10-03T06:00:00Z');
    await processarEmpresa({ db, conectores: reg2, arm: armFalso, dono: 'W2', breaker: new CircuitBreaker() , agora: () => depois }, E, cfg, 'manual');
    const todas = Object.values(porDia).flat();
    const gravadas = t.documentos.map((d) => d.chave).filter(Boolean);
    assert.deepEqual([...new Set(gravadas)].sort(), todas.sort(), 'todas as notas gravadas');
    assert.equal(gravadas.length, new Set(gravadas).size, 'nenhuma duplicada');
    assert.deepEqual(dl2.baixadas, [porDia['2026-09-30'][0]], 'o 2º processo só baixou o que faltou');
    assert.equal(t.nfce_checkpoint[0].ultima_data_ok, '2026-10-02');
    assert.equal(t.nfce_locks.filter((l) => l.expira_em > Date.now()).length, 0, 'nenhum lock pendurado');
    console.log('ok  reinício: retoma pelo checkpoint, toma o lock vencido, não perde nem duplica notas');
  }
})().catch((e) => { console.error(e); process.exit(1); });
