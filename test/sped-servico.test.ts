/**
 * SPED guardado + pré-cadastro (ServicoSped) com um banco e um armazenamento em memória.
 *
 *   npx tsx test/sped-servico.test.ts
 */
import assert from 'assert';
import { ServicoSped } from '../src/painel/sped';
import { CNPJ as CNPJ_BABY, montar as montarSintegra, r50 as s50, r61 as s61 } from './sintegra-arquivo';

/* ---------- banco em memória com o pedaço da API do supabase-js que o serviço usa ---------- */
type Linha = Record<string, any>;
class Consulta {
  private filtros: ((l: Linha) => boolean)[] = [];
  private ordem: [string, boolean][] = [];
  private lim = Infinity;
  private de = 0;
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
  private conflito: string[] = [];
  private dados: any;
  private unico: 'single' | 'maybe' | null = null;
  constructor(private tabela: Linha[], private seq: () => number) {}
  select() { return this; }
  insert(d: any) { this.op = 'insert'; this.dados = d; return this; }
  update(d: any) { this.op = 'update'; this.dados = d; return this; }
  upsert(d: any, o: { onConflict?: string } = {}) { this.op = 'upsert'; this.dados = d; this.conflito = (o.onConflict ?? '').split(','); return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c: string, v: any) { this.filtros.push((l) => l[c] === v); return this; }
  in(c: string, v: any[]) { this.filtros.push((l) => v.includes(l[c])); return this; }
  is(c: string, v: any) { this.filtros.push((l) => (l[c] ?? null) === v); return this; }
  gte(c: string, v: any) { this.filtros.push((l) => l[c] >= v); return this; }
  lte(c: string, v: any) { this.filtros.push((l) => l[c] <= v); return this; }
  order(c: string, o: { ascending?: boolean } = {}) { this.ordem.push([c, o.ascending !== false]); return this; }
  limit(n: number) { this.lim = n; return this; }
  range(de: number, ate: number) { this.de = de; this.lim = ate - de + 1; return this; }
  single() { this.unico = 'single'; return this; }
  maybeSingle() { this.unico = 'maybe'; return this; }
  private executar(): { data: any; error: null } {
    let linhas: Linha[];
    if (this.op === 'upsert') {
      for (const d of [].concat(this.dados)) {
        const ex = this.tabela.find((l) => this.conflito.every((c) => l[c] === (d as any)[c]));
        if (ex) Object.assign(ex, d); else this.tabela.push({ id: this.seq(), ...(d as any) });
      }
      return { data: null, error: null };
    }
    if (this.op === 'delete') {
      const fica = this.tabela.filter((l) => !this.filtros.every((f) => f(l)));
      this.tabela.splice(0, this.tabela.length, ...fica);
      return { data: null, error: null };
    }
    if (this.op === 'insert') {
      const l = { id: this.seq(), status: 'pendente', criado_em: new Date(Date.now() + this.seq()).toISOString(), ...JSON.parse(JSON.stringify(this.dados)) };
      this.tabela.push(l);
      linhas = [l];
    } else {
      linhas = this.tabela.filter((l) => this.filtros.every((f) => f(l)));
      if (this.op === 'update') for (const l of linhas) Object.assign(l, JSON.parse(JSON.stringify(this.dados)));
      for (const [c, asc] of [...this.ordem].reverse()) linhas.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
      linhas = linhas.slice(this.de, this.de + this.lim);
    }
    const copia = linhas.map((l) => ({ ...l, razao_social: l.razao_social ?? l.dados?.razao_social }));
    if (this.unico) return { data: copia[0] ?? null, error: null };
    return { data: copia, error: null };
  }
  then(ok: (r: any) => any, erro?: (e: any) => any) { try { return Promise.resolve(this.executar()).then(ok, erro); } catch (e) { return Promise.reject(e).then(ok, erro); } }
}
function bancoFalso() {
  const t: Record<string, Linha[]> = { empresas: [], documentos: [], sped_arquivos: [], cadastro_sugestoes: [], divergencias_justificadas: [], documento_itens: [] };
  let n = 0;
  let relogio = Date.parse('2026-09-30T10:00:00Z');
  const seq = () => ++n;
  const db = { from: (nome: string) => new Consulta(t[nome], seq) } as any;
  const avancar = () => { relogio += 60_000; return new Date(relogio).toISOString(); };
  return { db, t, avancar };
}
const arquivos = new Map<string, Buffer>();
const arm = {
  salvar: async (c: string, b: Buffer) => { arquivos.set(`r2:${c}`, Buffer.from(b)); return `r2:${c}`; },
  ler: async (c: string) => arquivos.get(c)!,
} as any;

/* ---------- SPED sintético ---------- */
const CNPJ = '55885998000140';
function sped(periodo: string, opts: { cep?: string; chaves?: string[]; e110?: [number, number]; vendas?: string[] } = {}) {
  const [a, m] = periodo.split('-');
  const ult = new Date(Number(a), Number(m), 0).getDate();
  const ini = `01${m}${a}`; const fim = `${ult}${m}${a}`;
  const c100 = (opts.chaves ?? []).flatMap((ch, i) => [
    `|C100|0|1|F1|55|00|1|${i + 1}|${ch}|05${m}${a}|06${m}${a}|100,00|1|0|0|100,00|9|0|0|0|0|0|0|0|0|0|0|0|0|`,
    '|C190|000|1102|0|100,00|100,00|0|0|0|0|0||',
  ]).concat((opts.vendas ?? []).flatMap((ch, i) => [
    `|C100|1|0||65|00|1|${900 + i}|${ch}|10${m}${a}|10${m}${a}|50,00|0|0|0|50,00|9|0|0|0|0|0|0|0|0|0|0|0|0|`,
    '|C190|060|5405|0|50,00|0|0|0|0|0|0||',
  ]));
  const l = [
    `|0000|017|0|${ini}|${fim}|FARMA TESTE LTDA|${CNPJ}||ES|084358580|3201209|||A|1|`, '|0001|0|',
    `|0005|FARMA TESTE|${opts.cep ?? '29306306'}|RUA A|10||CENTRO|2835224869|||`,
    '|0150|F1|FORNECEDOR SA|1058|11222333000181||123|3550308||RUA B|1|||', '|0990|5|',
    '|C001|0|', ...c100, `|C990|${c100.length + 2}|`, '|D001|1|', '|D990|2|',
    '|E001|0|', `|E100|${ini}|${fim}|`, `|E110|0|0|0|0|0|0|0|0|${String(opts.e110?.[0] ?? 0).replace('.', ',')}|0|0|0|${String(opts.e110?.[1] ?? 0).replace('.', ',')}|0|`, '|E990|4|',
  ];
  const cont = new Map<string, number>();
  for (const x of l) { const r = x.split('|')[1]; cont.set(r, (cont.get(r) ?? 0) + 1); }
  const nomes = [...cont.keys(), '9001', '9900', '9990', '9999'];
  cont.set('9001', 1); cont.set('9900', nomes.length); cont.set('9990', 1); cont.set('9999', 1);
  const l9 = ['|9001|0|', ...nomes.map((r) => `|9900|${r}|${cont.get(r)}|`)];
  l9.push(`|9990|${l9.length + 2}|`, `|9999|${l.length + l9.length + 2}|`);
  return Buffer.from([...l, ...l9].join('\r\n') + '\r\n', 'latin1');
}
/** SPED Contribuições sintético (cumulativo) com NFC-e de venda e o CST informado. */
function contrib(periodo: string, vendas: { chave: string; cst: string }[]) {
  const [a, m] = periodo.split('-');
  const ult = new Date(Number(a), Number(m), 0).getDate();
  const c = vendas.flatMap((v, i) => [
    `|C100|1|0||65|00|1|${900 + i}|${v.chave}|10${m}${a}|10${m}${a}|50,00|0|0|0|50,00|9|0|0|0|0|0|0|0|0|${v.cst === '01' ? '0,33' : '0'}|${v.cst === '01' ? '1,50' : '0'}|0|0|`,
    `|C175|5405|50,00|0|${v.cst}|50,00|0,65|||${v.cst === '01' ? '0,33' : '0'}|${v.cst}|50,00|3|||${v.cst === '01' ? '1,50' : '0'}|1||`,
  ]);
  const pis = vendas.filter((v) => v.cst === '01').length * 0.33; const cof = vendas.filter((v) => v.cst === '01').length * 1.5;
  const f = (x: number) => x.toFixed(2).replace('.', ',');
  const l = [
    `|0000|006|0|||01${m}${a}|${ult}${m}${a}|FARMA TESTE LTDA|${CNPJ}|ES|3201209||00|2|`, '|0001|0|',
    '|0100|JOSE CONTADOR|12345678909|ES-012345/O||29300000|RUA C|1|||2733334444||contab@exemplo.com.br|3205309|',
    '|0110|2|||9|', `|0140|EMP1|FARMA TESTE LTDA|${CNPJ}|ES|084358580|3201209|||`, '|0990|6|',
    '|A001|1|', '|A990|2|', '|C001|0|', `|C010|${CNPJ}|2|`, ...c, `|C990|${c.length + 3}|`,
    '|D001|1|', '|D990|2|', '|F001|1|', '|F990|2|', '|M001|0|',
    `|M200|0|0|0|0|0|0|0|${f(pis)}|0|0|${f(pis)}|${f(pis)}|`, `|M600|0|0|0|0|0|0|0|${f(cof)}|0|0|${f(cof)}|${f(cof)}|`, '|M990|4|',
    '|1001|1|', '|1990|2|',
  ];
  const cont = new Map<string, number>();
  for (const x of l) { const r = x.split('|')[1]; cont.set(r, (cont.get(r) ?? 0) + 1); }
  const nomes = [...cont.keys(), '9001', '9900', '9990', '9999'];
  cont.set('9001', 1); cont.set('9900', nomes.length); cont.set('9990', 1); cont.set('9999', 1);
  const l9 = ['|9001|0|', ...nomes.map((r) => `|9900|${r}|${cont.get(r)}|`)];
  l9.push(`|9990|${l9.length + 2}|`, `|9999|${l.length + l9.length + 2}|`);
  return Buffer.from([...l, ...l9].join('\r\n') + '\r\n', 'latin1');
}
function chaveNfce(num: number, mes: string) {
  const base = `3226${mes}${CNPJ}650010000009${String(num).padStart(2, '0')}10000009${String(num).padStart(2, '0')}`.slice(0, 43);
  let soma = 0; let peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(base[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return base + (r < 2 ? 0 : 11 - r);
}
function chave(num: number, mes: string) {
  const base = `3226${mes}11222333000181550010000000${String(num).padStart(2, '0')}1000000${String(num).padStart(2, '0')}`.slice(0, 43);
  let soma = 0; let peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(base[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return base + (r < 2 ? 0 : 11 - r);
}

(async () => {
  const { db, t } = bancoFalso();
  const s = new ServicoSped(db, arm);

  // 1) CNPJ que não é cliente: guarda o arquivo e cria pré-cadastro de cliente novo
  const r1 = await s.receber('farma-07.txt', sped('2026-07'), 'analista@x.com');
  assert.ok(r1.valido);
  if (!r1.valido) return;
  assert.deepEqual(r1.ocorrencias.filter((o: any) => o.nivel === 'erro').map((o: any) => o.mensagem), []);
  assert.equal(r1.clienteNovo, true); assert.equal(r1.empresaId, null); assert.equal(r1.comparacao, null);
  assert.equal(t.sped_arquivos.length, 1); assert.equal(t.sped_arquivos[0].empresa_id, null);
  assert.ok(arquivos.has(t.sped_arquivos[0].caminho), 'arquivo guardado');
  assert.equal(t.cadastro_sugestoes.length, 1);
  const lista = await s.listarSugestoes();
  assert.equal(lista.pendentes[0].clienteNovo, true);
  assert.ok(lista.pendentes[0].diferencas.some((d: any) => d.campo === 'ie' && d.proposto === '084358580'));

  // Mesmo arquivo de novo: não duplica arquivo nem sugestão
  await s.receber('farma-07.txt', sped('2026-07'), 'analista@x.com');
  assert.equal(t.sped_arquivos.length, 1); assert.equal(t.cadastro_sugestoes.length, 1);

  // 2) Aprovar cliente novo: cria a empresa com os campos aprovados e liga o SPED
  const ap = await s.aprovar(t.cadastro_sugestoes[0].id, 'gustavo@x.com', ['ie', 'cod_municipio', 'cep'], 'presumido');
  assert.equal(ap.criada, true);
  const emp = t.empresas[0];
  assert.deepEqual([emp.cnpj, emp.uf, emp.c_uf, emp.regime, emp.ie, emp.municipio, emp.cep, emp.nome_fantasia],
    [CNPJ, 'ES', 32, 'presumido', '084358580', 'Cachoeiro de Itapemirim', '29306306', undefined]);
  assert.equal(t.sped_arquivos[0].empresa_id, emp.id);
  assert.equal(t.sped_arquivos[0].divergencias, 0, 'comparação feita depois de ligar à empresa');
  assert.equal(t.cadastro_sugestoes[0].status, 'aprovado');
  await assert.rejects(s.aprovar(t.cadastro_sugestoes[0].id, 'gustavo@x.com', [], null), /já foi decidida/);

  // 3) Cliente cadastrado: só o que falta/difere vira sugestão; recusado não volta
  const r2 = await s.receber('farma-08.txt', sped('2026-08'), 'analista@x.com');
  assert.ok(r2.valido && !r2.clienteNovo && r2.sugestao, 'fantasia, endereço etc. ainda não aprovados');
  const pend = (await s.listarSugestoes()).pendentes[0];
  assert.ok(!pend.diferencas.some((d: any) => ['ie', 'cep', 'cod_municipio'].includes(d.campo)), 'o que já está igual não aparece');
  await s.rejeitar(pend.id, 'gustavo@x.com');
  const r3 = await s.receber('farma-08b.txt', Buffer.concat([sped('2026-08'), Buffer.from('\r\n')]), 'analista@x.com');
  assert.ok(r3.valido && r3.sugestao === null, 'mesma proposta recusada não é sugerida de novo');
  const r4 = await s.receber('farma-09.txt', sped('2026-09', { cep: '29300000' }), 'analista@x.com');
  assert.ok(r4.valido && r4.sugestao, 'CEP novo no SPED de setembro: sugere de novo');
  const p4 = (await s.listarSugestoes()).pendentes[0];
  assert.deepEqual(p4.diferencas.find((d: any) => d.campo === 'cep'), { campo: 'cep', rotulo: 'CEP', grupo: 'endereco', atual: '29306306', proposto: '29300000' });
  const r5 = await s.receber('farma-06.txt', sped('2026-06', { cep: '29111111' }), 'analista@x.com');
  assert.ok(r5.valido && r5.sugestao === null, 'SPED mais antigo não troca a sugestão mais nova');
  await s.aprovar(p4.id, 'gustavo@x.com', ['cep'], null);
  assert.equal(t.empresas[0].cep, '29300000'); assert.equal(t.empresas[0].cadastro_atualizado_por, 'gustavo@x.com');

  // 4) Comparação guardada: nota de julho escriturada no SPED de agosto não é divergência
  const ch = chave(1, '07');
  t.documentos.push({ empresa_id: emp.id, chave: ch, modelo: '55', numero: '1', emitida_em: '2026-07-30T12:00:00-03:00', valor: 100, situacao: 'autorizada',
    emit_cnpj: '11222333000181', dest_doc: CNPJ, toma_doc: null, emit_nome: 'FORNECEDOR SA' });
  const julho = await s.vigente(emp.id, '2026-07-01');
  const refeito = await s.recomparar(julho!);
  assert.equal(refeito.divergencias, 1, 'julho: XML de entrada sem C100');
  await s.receber('farma-08-retificador.txt', sped('2026-08', { chaves: [ch] }), 'analista@x.com');
  const julhoDepois = await s.vigente(emp.id, '2026-07-01');
  assert.equal(julhoDepois!.divergencias, 0, 'o envio de agosto refez julho: a nota entrou no mês seguinte');
  const agosto = await s.vigente(emp.id, '2026-08-01');
  assert.equal(agosto!.nome, 'farma-08-retificador.txt', 'vigente é o envio mais recente');
  assert.equal(agosto!.divergencias, 0, 'agosto: a nota escriturada tem XML (emitido em julho)');
  assert.equal((await s.historico(emp.id, '2026-08-01')).length, 3);
  // 5) Saldo credor: anterior do E110 × a transportar do mês anterior guardado
  await s.receber('farma-10.txt', sped('2026-10', { e110: [0, 100] }), 'analista@x.com');
  const nov = await s.receber('farma-11.txt', sped('2026-11', { e110: [80, 80] }), 'analista@x.com');
  assert.ok(nov.valido && nov.ocorrencias.some((o: any) => o.codigo === 'E110_SALDO_ANTERIOR' && /Diferença de R\$\s?20,00/.test(o.mensagem)));
  const dez = await s.receber('farma-12.txt', sped('2026-12', { e110: [80, 0] }), 'analista@x.com');
  assert.ok(dez.valido && !dez.ocorrencias.some((o: any) => o.codigo === 'E110_SALDO_ANTERIOR'));
  // 6) SPED Contribuições: guardado à parte, CST 49 em venda é erro e cruza com o SPED Fiscal do mês
  const v1 = chaveNfce(1, '10'); const v2 = chaveNfce(2, '10');
  const rc = await s.receber('contrib-10.txt', contrib('2026-10', [{ chave: v1, cst: '49' }, { chave: v2, cst: '01' }]), 'analista@x.com');
  assert.ok(rc.valido);
  if (!rc.valido) return;
  assert.equal(rc.tipo, 'efd_contribuicoes');
  assert.deepEqual(rc.ocorrencias.filter((o: any) => o.nivel !== 'info').map((o: any) => o.codigo), ['CST_49_VENDA'], JSON.stringify(rc.ocorrencias));
  assert.equal(rc.resumo.receitaBruta, 100); assert.deepEqual(rc.resumo.apuracao.pis, { contribuicao: 0.33, creditos: 0, recolher: 0.33 });
  assert.equal(rc.comparacao.contagem.contribuicoes_sem_fiscal, 2, 'o SPED Fiscal de outubro não tem essas NFC-e');
  const contribRow = await s.vigente(emp.id, '2026-10-01', 'efd_contribuicoes');
  assert.equal(contribRow!.divergencias, 2);
  assert.equal((await s.vigente(emp.id, '2026-10-01'))!.tipo, 'efd_icms_ipi', 'o vigente do Fiscal não muda');
  // Chega o SPED Fiscal de outubro com as duas vendas: o Contribuições é cruzado de novo
  await s.receber('farma-10b.txt', sped('2026-10', { e110: [0, 100], vendas: [v1, v2] }), 'analista@x.com');
  const depois = await s.vigente(emp.id, '2026-10-01', 'efd_contribuicoes');
  assert.equal(depois!.divergencias, 0); assert.equal(depois!.comparacao.totais.conferidas, 2);
  assert.equal((await s.historico(emp.id, '2026-10-01', 'efd_contribuicoes')).length, 1);
  const refeito2 = await s.recomparar(depois!);
  assert.equal(refeito2.divergencias, 0);

  // 7) Monofásico × tributado pelos XMLs de saída (itens das NFC-e)
  t.documento_itens.push(
    { empresa_id: emp.id, chave: v1, ncm: '30049099', v_prod: 20, v_desc: 0 }, // medicamento (monofásico)
    { empresa_id: emp.id, chave: v1, ncm: '21069090', v_prod: 30, v_desc: 0 }, // suplemento (tributável) numa nota com CST 49
    { empresa_id: emp.id, chave: v2, ncm: '33049910', v_prod: 50, v_desc: 0 }, // perfumaria (monofásica) numa nota com CST 01
  );
  const mono = await s.recomparar(depois!);
  assert.equal(mono.comparacao.contagem.receita_tributavel_sem_pis, 1);
  assert.equal(mono.comparacao.contagem.monofasico_tributado, 1);
  assert.deepEqual([mono.comparacao.monofasico.receitaMonofasica, mono.comparacao.monofasico.receitaTributavel, mono.comparacao.monofasico.pisEstimado], [70, 30, 0.2]);
  assert.equal(mono.divergencias, 2);

  // 8) Justificar divergências: some da contagem, sobrevive ao arquivo retificador e pode ser reaberta
  const alvo = mono.comparacao.divergencias.find((d: any) => d.tipo === 'monofasico_tributado');
  await assert.rejects(s.justificar(mono, [{ tipo: alvo.tipo, chave: alvo.chave }], 'ok', 'analista@x.com'), /pelo menos 5/);
  const just = await s.justificar(mono, [{ tipo: alvo.tipo, chave: alvo.chave }], 'Produto reclassificado no ERP em outubro', 'analista@x.com');
  assert.equal(just.divergencias, 1);
  assert.equal(just.comparacao.divergencias.find((d: any) => d.chave === alvo.chave && d.tipo === alvo.tipo).justificativa.por, 'analista@x.com');
  const refeito3 = await s.recomparar(just);
  assert.equal(refeito3.divergencias, 1, 'recomparar mantém a justificativa');
  const reaberta = await s.justificar(refeito3, [{ tipo: alvo.tipo, chave: alvo.chave }], null, 'analista@x.com');
  assert.equal(reaberta.divergencias, 2);
  await assert.rejects(s.justificar(reaberta, [{ tipo: 'x', chave: 'y' }], 'qualquer coisa', 'a@x.com'), /Nenhuma divergência/);

  // 9) SINTEGRA: cliente novo do Simples, guardado, comparado e com justificativa
  const arq = montarSintegra([s50({ numero: 101, cfop: '1102', valor: 100 }), s61('20260801', 32104, 32110, 2142.6)]);
  const rs = await s.receber('NFS_08-2026.TXT', arq, 'analista@x.com');
  assert.ok(rs.valido && rs.tipo === 'sintegra' && rs.clienteNovo && rs.sugestao);
  if (!rs.valido) return;
  assert.equal(rs.comparacao, null);
  const apS = await s.aprovar(rs.sugestao!.id, 'gustavo@x.com', ['ie', 'cod_municipio', 'logradouro', 'cep'], 'simples');
  const baby = t.empresas.find((e) => e.id === apS.empresaId)!;
  assert.deepEqual([baby.cnpj, baby.regime, baby.municipio, baby.cep], [CNPJ_BABY, 'simples', 'Januária', '39480000']);
  const vig = await s.vigente(baby.id, '2026-08-01', 'sintegra');
  assert.equal(vig!.divergencias, 0, 'sem XMLs no Appura: registro sem XML é só informação');
  const chF = (n: number) => `312608${'11222333000181'}55001${String(n).padStart(9, '0')}1${String(n).padStart(8, '0')}`.slice(0, 43) + '0';
  t.documentos.push(
    { empresa_id: baby.id, chave: chF(101), modelo: '55', numero: '101', emitida_em: '2026-08-05T10:00:00-03:00', valor: 100, situacao: 'autorizada', emit_cnpj: '11222333000181', dest_doc: CNPJ_BABY, emit_nome: 'FORNECEDOR' },
    { empresa_id: baby.id, chave: chF(555), modelo: '55', numero: '555', emitida_em: '2026-08-06T10:00:00-03:00', valor: 80, situacao: 'autorizada', emit_cnpj: '11222333000181', dest_doc: CNPJ_BABY, emit_nome: 'FORNECEDOR' },
  );
  const vig2 = await s.recomparar(vig!);
  assert.equal(vig2.comparacao.totais.entradasConferidas, 1);
  assert.equal(vig2.divergencias, 1, 'NF-e 555 com XML e sem registro 50');
  const semReg = vig2.comparacao.divergencias.find((d: any) => d.tipo === 'xml_sem_registro');
  const vig3 = await s.justificar(vig2, [{ tipo: semReg.tipo, chave: semReg.chave }], 'Nota devolvida, lançada em setembro', 'analista@x.com');
  assert.equal(vig3.divergencias, 0);
  console.log('ok  monofásico × tributado pelo NCM, justificativas (lote, recomparar, reabrir) e SINTEGRA de cliente novo');
  console.log('ok  SPED guardado, cliente novo aprovado, sugestões (recusa, mais nova, só diferenças) e comparação com o mês seguinte');
  console.log('\nTestes do serviço de SPED passaram.');
})().catch((e) => { console.error(e); process.exit(1); });
