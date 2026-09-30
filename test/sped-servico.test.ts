/**
 * SPED guardado + pré-cadastro (ServicoSped) com um banco e um armazenamento em memória.
 *
 *   npx tsx test/sped-servico.test.ts
 */
import assert from 'assert';
import { ServicoSped } from '../src/painel/sped';

/* ---------- banco em memória com o pedaço da API do supabase-js que o serviço usa ---------- */
type Linha = Record<string, any>;
class Consulta {
  private filtros: ((l: Linha) => boolean)[] = [];
  private ordem: [string, boolean][] = [];
  private lim = Infinity;
  private de = 0;
  private op: 'select' | 'insert' | 'update' = 'select';
  private dados: any;
  private unico: 'single' | 'maybe' | null = null;
  constructor(private tabela: Linha[], private seq: () => number) {}
  select() { return this; }
  insert(d: any) { this.op = 'insert'; this.dados = d; return this; }
  update(d: any) { this.op = 'update'; this.dados = d; return this; }
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
  const t: Record<string, Linha[]> = { empresas: [], documentos: [], sped_arquivos: [], cadastro_sugestoes: [] };
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
function sped(periodo: string, opts: { cep?: string; chaves?: string[]; e110?: [number, number] } = {}) {
  const [a, m] = periodo.split('-');
  const ult = new Date(Number(a), Number(m), 0).getDate();
  const ini = `01${m}${a}`; const fim = `${ult}${m}${a}`;
  const c100 = (opts.chaves ?? []).flatMap((ch, i) => [
    `|C100|0|1|F1|55|00|1|${i + 1}|${ch}|05${m}${a}|06${m}${a}|100,00|1|0|0|100,00|9|0|0|0|0|0|0|0|0|0|0|0|0|`,
    '|C190|000|1102|0|100,00|100,00|0|0|0|0|0||',
  ]);
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
  console.log('ok  SPED guardado, cliente novo aprovado, sugestões (recusa, mais nova, só diferenças) e comparação com o mês seguinte');
  console.log('\nTestes do serviço de SPED passaram.');
})().catch((e) => { console.error(e); process.exit(1); });
