/**
 * Telas da Captação: Monitor (situação de cada empresa agora), Lacunas/NSU (o que a SEFAZ ainda deve e a numeração
 * das saídas), Importações (envios manuais e do Appura Coletor) e Histórico (consultas à SEFAZ e capturas por dia).
 * Só leitura. O pesado é resumido no banco (funções captacao_* da migração 0040).
 */
import { Db, ok } from '../db';
import { situacaoMaquina } from '../coletor/servico';

export type Tom = 'ok' | 'atencao' | 'problema' | 'neutro';
const H = 3600_000;
const num = (s: unknown) => (s == null || !/^\d+$/.test(String(s)) ? 0 : Number(s));

export interface EstadoSefaz {
  modelo: string; ultNsu: number; maxNsu: number; restantes: number; ultimaConsultaEm: string | null; ultimaSyncOkEm: string | null;
  proximaConsultaEm: string | null; cstat: string | null; motivo: string | null; erros: number;
}

/**
 * Situação de uma empresa na captação. O coletor de NF-e só consulta a SEFAZ de madrugada (23h às 6h), então
 * "sem consulta boa" só vira atenção depois de 30 h e problema depois de 48 h.
 */
export function avaliarEmpresa(e: {
  certificadoValidoAte: string | null; sefaz: EstadoSefaz[]; maquinas: { situacao: string }[]; agora: number;
}): { tom: Tom; motivos: string[] } {
  const prob: string[] = []; const at: string[] = [];
  if (!e.certificadoValidoAte) prob.push('Sem certificado ativo: a SEFAZ não é consultada.');
  else {
    const dias = (Date.parse(e.certificadoValidoAte) - e.agora) / (24 * H);
    if (dias < 0) prob.push('Certificado vencido: a SEFAZ não é consultada.');
    else if (dias < 30) at.push(`Certificado vence em ${Math.ceil(dias)} dia${Math.ceil(dias) === 1 ? '' : 's'}.`);
  }
  for (const s of e.sefaz) {
    const m = s.modelo === 'cte' ? 'CT-e' : 'NF-e';
    if (s.erros >= 3) prob.push(`${m}: ${s.erros} consultas seguidas com erro${s.motivo ? ` (${s.motivo})` : ''}.`);
    else if (s.erros > 0 && s.cstat !== '656') at.push(`${m}: última consulta com erro${s.motivo ? ` (${s.motivo})` : ''}.`);
    const semOk = s.ultimaSyncOkEm ? (e.agora - Date.parse(s.ultimaSyncOkEm)) / H : Infinity;
    if (s.ultimaConsultaEm || s.ultimaSyncOkEm) {
      if (semOk > 48) prob.push(`${m}: sem consulta bem-sucedida há mais de 48 h.`);
      else if (semOk > 30) at.push(`${m}: sem consulta bem-sucedida há mais de 30 h.`);
    }
    if (s.restantes > 0) at.push(`${m}: ${s.restantes.toLocaleString('pt-BR')} documento${s.restantes === 1 ? '' : 's'} ainda na fila da SEFAZ.`);
  }
  for (const mq of e.maquinas) {
    if (mq.situacao === 'sem_sinal') prob.push('Appura Coletor sem sinal há mais de 24 h.');
    else if (mq.situacao === 'atrasada') at.push('Appura Coletor sem sinal há algumas horas.');
  }
  return { tom: prob.length ? 'problema' : at.length ? 'atencao' : 'ok', motivos: [...prob, ...at] };
}

export async function monitor(db: Db, agora = Date.now(), escopo: Set<string> | null = null) {
  const todasEmpresas = ok(await db.from('empresas').select('id,cnpj,razao_social,uf,ativo').eq('ativo', true).order('razao_social').limit(5000), 'empresas') as
    { id: string; cnpj: string; razao_social: string; uf: string }[];
  const empresas = escopo ? todasEmpresas.filter((e) => escopo.has(e.id)) : todasEmpresas;
  const [estados, certs, ultimas, maqs, vinc, pedidos, status] = await Promise.all([
    db.from('sync_state').select('*').limit(20000),
    db.from('certificados').select('empresa_id,valido_ate').eq('ativo', true).limit(10000),
    db.rpc('captacao_ultimas'),
    db.from('coletor_maquinas').select('id,instalacao_id,nome,revogado_em,pareado_em,ultimo_contato_em,ultimo_envio_em,pendentes,versao').is('revogado_em', null).limit(5000),
    db.from('coletor_instalacao_empresas').select('instalacao_id,empresa_id').limit(20000),
    db.from('sync_requests').select('empresa_id,status,solicitado_em,iniciado_em').in('status', ['pendente', 'processando']).limit(1000),
    db.from('sistema_status').select('chave,valor,atualizado_em').limit(50),
  ]);
  const est = ok(estados, 'sync_state') as any[];
  const cert = new Map((ok(certs, 'certificados') as any[]).map((c) => [c.empresa_id, c.valido_ate as string]));
  const ult = new Map((ok(ultimas, 'últimas capturas') as any[]).map((u) => [u.empresa_id, u]));
  const vinculos = ok(vinc, 'instalações') as any[];
  // Com escopo, só as máquinas de instalações que atendem alguma empresa do escopo
  const instNoEscopo = escopo ? new Set(vinculos.filter((v) => escopo.has(v.empresa_id)).map((v) => v.instalacao_id)) : null;
  const maquinas = (ok(maqs, 'coletores') as any[]).filter((m) => !instNoEscopo || instNoEscopo.has(m.instalacao_id));
  const porInst = new Map<string, any[]>();
  for (const m of maquinas) { const l = porInst.get(m.instalacao_id) ?? []; l.push(m); porInst.set(m.instalacao_id, l); }
  const maqDaEmpresa = new Map<string, any[]>();
  for (const v of vinculos) {
    const l = maqDaEmpresa.get(v.empresa_id) ?? []; l.push(...(porInst.get(v.instalacao_id) ?? [])); maqDaEmpresa.set(v.empresa_id, l);
  }
  const pend = new Map((ok(pedidos, 'pedidos') as any[]).filter((p) => !escopo || escopo.has(p.empresa_id)).map((p) => [p.empresa_id, p]));

  const linhas = empresas.map((e) => {
    const sefaz: EstadoSefaz[] = est.filter((s) => s.empresa_id === e.id).sort((a, b) => a.modelo.localeCompare(b.modelo)).reverse().map((s) => {
      const u = num(s.ult_nsu); const m = num(s.max_nsu);
      return { modelo: s.modelo, ultNsu: u, maxNsu: m, restantes: Math.max(0, m - u), ultimaConsultaEm: s.ultima_consulta_em, ultimaSyncOkEm: s.ultima_sync_ok_em,
        proximaConsultaEm: s.proxima_consulta_em, cstat: s.ultimo_cstat, motivo: s.ultimo_motivo, erros: s.erros_consecutivos ?? 0 };
    });
    const mqs = (maqDaEmpresa.get(e.id) ?? []).map((m) => ({ id: m.id, nome: m.nome, situacao: situacaoMaquina(m, agora), ultimoEnvioEm: m.ultimo_envio_em, ultimoContatoEm: m.ultimo_contato_em, pendentes: m.pendentes, versao: m.versao }));
    const u = ult.get(e.id);
    const av = avaliarEmpresa({ certificadoValidoAte: cert.get(e.id) ?? null, sefaz, maquinas: mqs, agora });
    return {
      id: e.id, cnpj: e.cnpj, razaoSocial: e.razao_social, uf: e.uf, certificadoValidoAte: cert.get(e.id) ?? null, sefaz, maquinas: mqs,
      ultimaCaptura: u?.ultima_captura ?? null, capturas24h: Number(u?.ultimas_24h ?? 0), sincronizando: pend.get(e.id) ?? null, ...av,
    };
  });
  const st = ok(status, 'status') as { chave: string; valor: any; atualizado_em: string }[];
  const consultaMaisRecente = (escopo ? est.filter((s) => escopo.has(s.empresa_id)) : est).reduce((m, s) => (s.ultima_consulta_em && s.ultima_consulta_em > m ? s.ultima_consulta_em : m), '');
  return {
    agora: new Date(agora).toISOString(),
    resumo: {
      empresas: linhas.length, problema: linhas.filter((l) => l.tom === 'problema').length, atencao: linhas.filter((l) => l.tom === 'atencao').length,
      capturas24h: linhas.reduce((t, l) => t + l.capturas24h, 0), naFilaSefaz: linhas.reduce((t, l) => t + l.sefaz.reduce((x, s) => x + s.restantes, 0), 0),
      coletoresAtivos: maquinas.filter((m) => situacaoMaquina(m, agora) === 'ok').length, coletores: maquinas.length,
      sincronizando: pend.size,
    },
    servicos: {
      // O coletor de NF-e grava o status só ao iniciar: a vida dele se vê pela última consulta feita à SEFAZ
      coletorSefaz: { iniciadoEm: st.find((s) => s.chave === 'coletor')?.valor?.iniciado_em ?? null, ultimaConsultaEm: consultaMaisRecente || null, horario: st.find((s) => s.chave === 'coletor')?.valor?.horario_consultas ?? null },
      nfceWorker: st.find((s) => s.chave === 'nfce_worker') ? { atualizadoEm: st.find((s) => s.chave === 'nfce_worker')!.atualizado_em } : null,
    },
    empresas: linhas,
  };
}

const r2 = (n: number) => Math.round(n);

/** Limites (UTC) do mês AAAA-MM no fuso de São Paulo (UTC−3, sem horário de verão). */
export function limitesMes(mes: string): { inicio: string; fim: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error('Mês inválido.');
  const [a, m] = mes.split('-').map(Number);
  const ini = new Date(Date.UTC(a, m - 1, 1, 3)); const fim = new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 1, 3));
  return { inicio: ini.toISOString(), fim: fim.toISOString() };
}

export async function lacunas(db: Db, mes: string, escopo: Set<string> | null = null) {
  const { inicio, fim } = limitesMes(mes);
  const [emps, nsu, numer] = await Promise.all([
    db.from('empresas').select('id,cnpj,razao_social').eq('ativo', true).limit(5000),
    db.rpc('captacao_lacunas_nsu'),
    db.rpc('captacao_numeracao', { p_inicio: inicio, p_fim: fim }),
  ]);
  const porId = new Map((ok(emps, 'empresas') as any[]).filter((e) => !escopo || escopo.has(e.id)).map((e) => [e.id, e]));
  const nome = (id: string) => porId.get(id) ?? null;
  const sefaz = (ok(nsu, 'lacunas de NSU') as any[]).filter((l) => nome(l.empresa_id)).map((l) => ({
    empresaId: l.empresa_id, cnpj: nome(l.empresa_id).cnpj, razaoSocial: nome(l.empresa_id).razao_social, modelo: l.modelo,
    ultNsu: Number(l.ult_nsu), maxNsu: Number(l.max_nsu), naFila: Math.max(0, Number(l.max_nsu) - Number(l.ult_nsu)),
    janelaDe: l.de == null ? null : Number(l.de), recebidos: Number(l.recebidos), lacunas: Number(l.lacunas),
  })).sort((a, b) => b.lacunas + b.naFila - (a.lacunas + a.naFila) || a.razaoSocial.localeCompare(b.razaoSocial));
  const numeracao = (ok(numer, 'numeração') as any[]).filter((l) => nome(l.empresa_id)).map((l) => ({
    empresaId: l.empresa_id, cnpj: nome(l.empresa_id).cnpj, razaoSocial: nome(l.empresa_id).razao_social, modelo: l.modelo, serie: l.serie,
    menor: Number(l.menor), maior: Number(l.maior), emitidas: Number(l.emitidas), faltam: Number(l.faltam), rejeitadas: Number(l.rejeitadas),
    semExplicacao: Math.max(0, Number(l.faltam) - Number(l.rejeitadas)),
  })).sort((a, b) => b.faltam - a.faltam || a.razaoSocial.localeCompare(b.razaoSocial) || a.modelo.localeCompare(b.modelo) || a.serie.localeCompare(b.serie));
  return {
    mes, sefaz, numeracao,
    totais: {
      lacunasNsu: sefaz.reduce((t, l) => t + l.lacunas, 0), naFila: sefaz.reduce((t, l) => t + l.naFila, 0),
      numerosFaltando: numeracao.reduce((t, l) => t + l.faltam, 0), rejeitadas: numeracao.reduce((t, l) => t + l.rejeitadas, 0),
    },
  };
}

export function lerPeriodo(url: URL, padraoDias = 30) {
  const dias = Math.min(180, Math.max(1, Math.floor(Number(url.searchParams.get('dias') ?? padraoDias)) || padraoDias));
  const empresa = url.searchParams.get('empresa');
  return { dias, empresa: empresa && /^[0-9a-f-]{36}$/.test(empresa) ? empresa : null, desde: new Date(Date.now() - dias * 24 * H).toISOString() };
}

/** Importações manuais (tela da empresa) e lotes do Appura Coletor, juntos e do mais novo para o mais antigo. */
export async function importacoes(db: Db, f: { desde: string; empresa: string | null; origem: string | null }, escopo: Set<string> | null = null) {
  const emps = (ok(await db.from('empresas').select('id,cnpj,razao_social').limit(5000), 'empresas') as any[]).filter((e) => !escopo || escopo.has(e.id));
  const porId = new Map(emps.map((e) => [e.id, e]));
  const itens: any[] = [];
  if (f.origem !== 'coletor') {
    let q = db.from('importacoes_xml').select('id,empresa_id,email,arquivo,arquivos,importadas,completou_resumo,ja_existiam,rejeitadas,motivos,erro,duracao_ms,em').gte('em', f.desde).order('em', { ascending: false }).limit(1000);
    if (f.empresa) q = q.eq('empresa_id', f.empresa);
    for (const i of ok(await q, 'importações') as any[]) {
      if (escopo && !escopo.has(i.empresa_id)) continue;
      const e = porId.get(i.empresa_id);
      itens.push({ origem: 'manual', em: i.em, empresas: e ? [{ id: e.id, cnpj: e.cnpj, razaoSocial: e.razao_social }] : [], quem: i.email, arquivo: i.arquivo,
        arquivos: i.arquivos, novas: i.importadas + i.completou_resumo, jaExistiam: i.ja_existiam, rejeitadas: i.rejeitadas, rejeitadasSefaz: null, foraDaInstalacao: null,
        motivos: i.motivos, erro: i.erro, duracaoMs: i.duracao_ms });
    }
  }
  if (f.origem !== 'manual') {
    const maqs = ok(await db.from('coletor_maquinas').select('id,nome,instalacao_id').limit(5000), 'máquinas') as any[];
    const insts = ok(await db.from('coletor_instalacoes').select('id,nome').limit(5000), 'instalações') as any[];
    const vinc = ok(await db.from('coletor_instalacao_empresas').select('instalacao_id,empresa_id').limit(20000), 'vínculos') as any[];
    let ids = maqs.map((m) => m.id);
    if (escopo) {
      const instNoEscopo = new Set(vinc.filter((v) => escopo.has(v.empresa_id)).map((v) => v.instalacao_id));
      ids = maqs.filter((m) => instNoEscopo.has(m.instalacao_id)).map((m) => m.id);
    }
    if (f.empresa) {
      const instDaEmp = new Set(vinc.filter((v) => v.empresa_id === f.empresa).map((v) => v.instalacao_id));
      ids = maqs.filter((m) => instDaEmp.has(m.instalacao_id)).map((m) => m.id);
    }
    if (ids.length) {
      const envios = ok(await db.from('coletor_envios').select('*').in('maquina_id', ids).gte('recebido_em', f.desde).order('recebido_em', { ascending: false }).limit(2000), 'envios') as any[];
      const maq = new Map(maqs.map((m) => [m.id, m])); const inst = new Map(insts.map((i) => [i.id, i]));
      for (const e of envios) {
        const m = maq.get(e.maquina_id); const i = m ? inst.get(m.instalacao_id) : null;
        const empresas = vinc.filter((v) => m && v.instalacao_id === m.instalacao_id).map((v) => porId.get(v.empresa_id)).filter(Boolean).map((x: any) => ({ id: x.id, cnpj: x.cnpj, razaoSocial: x.razao_social }));
        itens.push({ origem: 'coletor', em: e.recebido_em, empresas, quem: `${i?.nome ?? 'Instalação'} · ${m?.nome ?? 'máquina'}`, arquivo: null,
          arquivos: e.arquivos, novas: e.importadas + e.completou_resumo, jaExistiam: e.ja_existiam, rejeitadas: e.rejeitadas, rejeitadasSefaz: e.rejeitadas_sefaz,
          foraDaInstalacao: e.fora_da_instalacao, motivos: e.motivos, erro: e.erro, duracaoMs: e.duracao_ms });
      }
    }
  }
  itens.sort((a, b) => (a.em < b.em ? 1 : a.em > b.em ? -1 : 0));
  const soma = (k: string) => itens.reduce((t, i) => t + (Number(i[k]) || 0), 0);
  return {
    itens: itens.slice(0, 1500),
    totais: { envios: itens.length, arquivos: soma('arquivos'), novas: soma('novas'), jaExistiam: soma('jaExistiam'), rejeitadas: soma('rejeitadas'), rejeitadasSefaz: soma('rejeitadasSefaz'), comErro: itens.filter((i) => i.erro).length },
    limitado: itens.length > 1500,
  };
}

/** Histórico: documentos capturados por dia e origem, e as consultas feitas à SEFAZ (com filtro de só erros). */
export async function historico(db: Db, f: { desde: string; empresa: string | null; soErros: boolean }, escopo: Set<string> | null = null) {
  const emps = ok(await db.from('empresas').select('id,cnpj,razao_social').limit(5000), 'empresas') as any[];
  const porId = new Map(emps.map((e) => [e.id, e]));
  const porDia = ok(await (escopo ? db.rpc('captacao_por_dia_escopo', { p_desde: f.desde, p_empresas: [...escopo] }) : db.rpc('captacao_por_dia', { p_desde: f.desde })), 'capturas por dia') as { dia: string; recebido_via: string; modelo: string; qtd: number }[];
  const dias = new Map<string, { dia: string; sefaz: number; importacao: number; autxml: number; nfe: number; nfce: number; cte: number; total: number }>();
  for (const l of porDia) {
    const d = dias.get(l.dia) ?? { dia: l.dia, sefaz: 0, importacao: 0, autxml: 0, nfe: 0, nfce: 0, cte: 0, total: 0 };
    const q = Number(l.qtd);
    if (l.recebido_via === 'importacao') d.importacao += q; else if (l.recebido_via === 'autxml') d.autxml += q; else d.sefaz += q;
    if (l.modelo === '65') d.nfce += q; else if (l.modelo === '57') d.cte += q; else d.nfe += q;
    d.total += q;
    dias.set(l.dia, d);
  }
  let q = db.from('logs_sefaz').select('id,empresa_id,modelo,cstat,motivo,ult_nsu_enviado,ult_nsu_retornado,max_nsu,qtd_docs,duracao_ms,erro,criado_em').gte('criado_em', f.desde).order('criado_em', { ascending: false }).limit(500);
  if (f.empresa) q = q.eq('empresa_id', f.empresa);
  if (f.soErros) q = q.or('erro.not.is.null,cstat.not.in.(137,138)');
  const consultas = (ok(await q, 'consultas') as any[]).filter((c) => !escopo || escopo.has(c.empresa_id)).map((c) => {
    const e = porId.get(c.empresa_id);
    const okCstat = c.cstat === '137' || c.cstat === '138';
    return { id: c.id, em: c.criado_em, empresaId: c.empresa_id, cnpj: e?.cnpj ?? null, razaoSocial: e?.razao_social ?? '—', modelo: c.modelo, cstat: c.cstat, motivo: c.motivo,
      documentos: c.qtd_docs ?? 0, ultNsu: num(c.ult_nsu_retornado), maxNsu: num(c.max_nsu), duracaoMs: c.duracao_ms, erro: c.erro,
      tom: (c.erro ? 'problema' : okCstat ? 'ok' : c.cstat === '656' ? 'atencao' : 'problema') as Tom };
  });
  let pq = db.from('sync_requests').select('id,empresa_id,status,solicitado_em,iniciado_em,processado_em,mensagem').gte('solicitado_em', f.desde).order('solicitado_em', { ascending: false }).limit(200);
  if (f.empresa) pq = pq.eq('empresa_id', f.empresa);
  const manuais = (ok(await pq, 'sincronizações manuais') as any[]).filter((p) => !escopo || escopo.has(p.empresa_id)).map((p) => ({ ...p, razaoSocial: porId.get(p.empresa_id)?.razao_social ?? '—' }));
  const lista = [...dias.values()].sort((a, b) => (a.dia < b.dia ? 1 : -1));
  return {
    dias: lista, consultas, manuais,
    totais: { capturados: lista.reduce((t, d) => t + d.total, 0), consultas: consultas.length, comErro: consultas.filter((c) => c.tom !== 'ok').length, mediaMs: consultas.length ? r2(consultas.reduce((t, c) => t + (c.duracaoMs ?? 0), 0) / consultas.length) : 0 },
  };
}
