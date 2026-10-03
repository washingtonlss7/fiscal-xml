/**
 * Appura Coletor: instalações e tokens (painel), autenticação, separação por CNPJ, "já existe", recebimento de lotes,
 * sinal de vida e situação das máquinas.
 *
 *   npx tsx test/coletor.test.ts
 */
import assert from 'assert';
import { PassThrough } from 'stream';
import { ErroColetor, separarPorEmpresa, ServicoColetor, situacaoMaquina } from '../src/coletor/servico';
import { Zip } from '../src/painel/zip';
import { Consulta, Linha } from './banco-falso';

const MATRIZ = { id: 'e-matriz', cnpj: '55885998000140', c_uf: 32, razao_social: 'FARMA DIGITAL STORE', ativo: true };
const FILIAL = { id: 'e-filial', cnpj: '55885998000221', c_uf: 32, razao_social: 'FARMA FILIAL', ativo: true };
const OUTRA = { id: 'e-outra', cnpj: '11222333000181', c_uf: 32, razao_social: 'OUTRA LTDA', ativo: true };

function banco() {
  const t: Record<string, Linha[]> = { empresas: [MATRIZ, FILIAL, OUTRA].map((e) => ({ ...e })), documentos: [], notas_rejeitadas: [], coletor_instalacoes: [], coletor_instalacao_empresas: [], coletor_maquinas: [], coletor_envios: [], outros: [] };
  let n = 0; const seq = () => ++n;
  const from = (nome: string) => { const q: any = new Consulta(t[nome] ?? t.outros, seq); q.not = () => q; return q; };
  return { db: { from, rpc: async () => ({ data: null, error: null }) } as any, t };
}
const arm = { salvar: async (c: string) => `r2:${c}` } as any;

const chave = (cnpj: string, mod: string, n: number) => `322609${cnpj}${mod}001${String(n).padStart(9, '0')}1${String(n).padStart(8, '0')}`.slice(0, 43) + '0';
function nota(cnpj: string, mod: '55' | '65', n: number, o: { dest?: string; cStat?: string } = {}) {
  const ch = chave(cnpj, mod, n);
  const dest = o.dest ? `<dest><CNPJ>${o.dest}</CNPJ><xNome>Cliente</xNome></dest>` : '';
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${ch}" versao="4.00"><ide><mod>${mod}</mod><serie>1</serie><nNF>${n}</nNF><dhEmi>2026-09-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF><tpEmis>1</tpEmis></ide><emit><CNPJ>${cnpj}</CNPJ><xNome>X</xNome><enderEmit><UF>ES</UF></enderEmit><CRT>3</CRT></emit>${dest}<det nItem="1"><prod><cProd>1</cProd><xProd>DIPIRONA</xProd><NCM>30049099</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>10</vUnCom><vProd>10.00</vProd></prod><imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST></ICMS00></ICMS></imposto></det><total><ICMSTot><vProd>10.00</vProd><vNF>10.00</vNF></ICMSTot></total></infNFe></NFe><protNFe versao="4.00"><infProt><chNFe>${ch}</chNFe><nProt>1</nProt><cStat>${o.cStat ?? '100'}</cStat><xMotivo>ok</xMotivo></infProt></protNFe></nfeProc>`);
}
async function zipDe(arquivos: { nome: string; conteudo: Buffer }[]) {
  const saida = new PassThrough(); const partes: Buffer[] = []; saida.on('data', (b) => partes.push(b));
  const z = new Zip(saida); for (const a of arquivos) await z.adicionar(a.nome, a.conteudo); await z.finalizar(); saida.end();
  return Buffer.concat(partes);
}
const rejeita = async (p: Promise<unknown>, status: number, re?: RegExp) => {
  try { await p; } catch (e) { assert.ok(e instanceof ErroColetor, String(e)); assert.equal((e as ErroColetor).status, status); if (re) assert.match((e as Error).message, re); return; }
  assert.fail(`esperava erro ${status}`);
};

(async () => {
  /* 1) situação das máquinas e separação por CNPJ */
  {
    const agora = Date.parse('2026-10-03T12:00:00Z');
    assert.equal(situacaoMaquina({ revogado_em: 'x', pareado_em: 'x', ultimo_contato_em: '2026-10-03T11:59:00Z' }, agora), 'revogada');
    assert.equal(situacaoMaquina({ revogado_em: null, pareado_em: null, ultimo_contato_em: null }, agora), 'aguardando');
    assert.equal(situacaoMaquina({ revogado_em: null, pareado_em: 'x', ultimo_contato_em: '2026-10-03T11:40:00Z' }, agora), 'ok');
    assert.equal(situacaoMaquina({ revogado_em: null, pareado_em: 'x', ultimo_contato_em: '2026-10-03T08:00:00Z' }, agora), 'atrasada');
    assert.equal(situacaoMaquina({ revogado_em: null, pareado_em: 'x', ultimo_contato_em: '2026-10-01T08:00:00Z' }, agora), 'sem_sinal');

    const { grupos, resultados } = separarPorEmpresa([
      { nome: 'saida-matriz.xml', conteudo: nota(MATRIZ.cnpj, '65', 1) },
      { nome: 'saida-filial.xml', conteudo: nota(FILIAL.cnpj, '65', 2) },
      { nome: 'entrada-matriz.xml', conteudo: nota(OUTRA.cnpj, '55', 3, { dest: MATRIZ.cnpj }) },
      { nome: 'rejeitada.xml', conteudo: nota(MATRIZ.cnpj, '65', 4, { cStat: '1023' }) },
      { nome: 'de-outro.xml', conteudo: nota(OUTRA.cnpj, '55', 5, { dest: '99888777000166' }) },
      { nome: 'lixo.xml', conteudo: Buffer.from('não é xml') },
    ], [MATRIZ, FILIAL]);
    const porEmp = Object.fromEntries(grupos.map((g) => [g.empresa.cnpj, g.arquivos.map((a) => a.nome)]));
    assert.deepEqual(porEmp, { [MATRIZ.cnpj]: ['saida-matriz.xml', 'entrada-matriz.xml', 'rejeitada.xml'], [FILIAL.cnpj]: ['saida-filial.xml'] });
    assert.deepEqual(resultados.map((r) => [r.arquivo, r.situacao]), [['de-outro.xml', 'fora_da_instalacao'], ['lixo.xml', 'rejeitada']]);
    console.log('ok  situação das máquinas e separação dos XMLs por CNPJ (saída, entrada, rejeitada, outro CNPJ, ilegível)');
  }

  /* 2) painel: instalação, tokens, edição, revogação */
  const { db, t } = banco();
  const s = new ServicoColetor(db, arm);
  await rejeita(s.criarInstalacao({ nome: 'F', empresas: [MATRIZ.id] }, 'a@x'), 400, /nome/);
  await rejeita(s.criarInstalacao({ nome: 'Farma', empresas: [] }, 'a@x'), 400, /CNPJ/);
  await rejeita(s.criarInstalacao({ nome: 'Farma', empresas: ['nao-existe'] }, 'a@x'), 400, /não existe/);
  await rejeita(s.criarInstalacao({ nome: 'Farma', empresas: [MATRIZ.id], quantidade: 0 }, 'a@x'), 400);
  const inst = await s.criarInstalacao({ nome: 'Grupo Farma', empresas: [MATRIZ.id, FILIAL.id], maquinas: ['Servidor de notas', 'Caixa 2'] }, 'a@x');
  assert.equal(inst.maquinas.length, 2);
  const [tk1, tk2] = inst.maquinas.map((m) => m.token);
  assert.match(tk1, /^apc_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(tk1, tk2);
  assert.ok(!JSON.stringify(t.coletor_maquinas).includes(tk1), 'o token não é guardado, só o hash');
  assert.equal(t.coletor_maquinas[0].token_prefixo, tk1.slice(0, 12));
  const um = await s.criarInstalacao({ nome: 'Loja única', empresas: [OUTRA.id], quantidade: 1 }, 'a@x');
  assert.equal(um.maquinas[0].nome, 'Servidor de notas');
  const lista = await s.listar();
  const g = lista.instalacoes.find((i) => i.id === inst.id)!;
  assert.deepEqual(g.empresas.map((e) => e.cnpj), [MATRIZ.cnpj, FILIAL.cnpj]);
  assert.deepEqual(g.maquinas.map((m) => m.situacao), ['aguardando', 'aguardando']);
  assert.ok(!JSON.stringify(lista).includes(tk1) && !JSON.stringify(lista).includes('token_hash'));
  console.log('ok  painel: instalação com vários CNPJs, um token por máquina (mostrado uma vez, guardado só o hash)');

  /* 3) API do coletor: autenticação, config, existentes, envio, sinal */
  await rejeita(s.autenticar(undefined), 401);
  await rejeita(s.autenticar('Bearer apc_' + 'x'.repeat(43)), 401);
  const ctx = await s.autenticar(`Bearer ${tk1}`);
  assert.deepEqual(ctx.empresas.map((e) => e.cnpj).sort(), [MATRIZ.cnpj, FILIAL.cnpj].sort());
  const cfg = await s.configuracao(ctx);
  assert.equal(cfg.instalacao.nome, 'Grupo Farma');
  assert.equal(cfg.empresas.length, 2);
  assert.ok(t.coletor_maquinas[0].pareado_em, 'primeira chamada marca o pareamento');

  t.documentos.push({ empresa_id: MATRIZ.id, chave: chave(MATRIZ.cnpj, '65', 1), completo: true }, { empresa_id: OUTRA.id, chave: chave(OUTRA.cnpj, '55', 9), completo: true },
    { empresa_id: MATRIZ.id, chave: chave(MATRIZ.cnpj, '55', 7), completo: false });
  t.notas_rejeitadas.push({ empresa_id: FILIAL.id, chave: chave(FILIAL.cnpj, '65', 8) });
  const ex = await s.existentes(ctx, { chaves: [chave(MATRIZ.cnpj, '65', 1), chave(MATRIZ.cnpj, '65', 2), chave(OUTRA.cnpj, '55', 9), chave(MATRIZ.cnpj, '55', 7), chave(FILIAL.cnpj, '65', 8), 'lixo'] });
  assert.deepEqual(ex.existentes.sort(), [chave(MATRIZ.cnpj, '65', 1), chave(FILIAL.cnpj, '65', 8)].sort(), 'só completas (ou rejeitadas guardadas) das empresas da instalação');
  await rejeita(s.existentes(ctx, { chaves: Array.from({ length: 2001 }, (_, i) => String(i).padStart(44, '0')) }), 413);

  const lote = await zipDe([
    { nome: '2026/09/10/a.xml', conteudo: nota(MATRIZ.cnpj, '65', 1) }, // já existia
    { nome: '2026/09/10/b.xml', conteudo: nota(MATRIZ.cnpj, '65', 2) },
    { nome: '2026/09/10/c.xml', conteudo: nota(FILIAL.cnpj, '65', 3) },
    { nome: '2026/09/10/d.xml', conteudo: nota(MATRIZ.cnpj, '65', 4, { cStat: '1023' }) },
    { nome: '2026/09/10/e.xml', conteudo: nota(OUTRA.cnpj, '65', 5) },
  ]);
  const r = await s.receber(ctx, 'lote.zip', lote);
  assert.deepEqual([r.arquivos, r.importadas, r.jaExistiam, r.rejeitadasSefaz, r.foraDaInstalacao], [5, 2, 1, 1, 1]);
  const sit = Object.fromEntries(r.resultados.map((x) => [x.arquivo, x.situacao]));
  assert.deepEqual(sit, { '2026/09/10/a.xml': 'ja_existia', '2026/09/10/b.xml': 'importada', '2026/09/10/c.xml': 'importada', '2026/09/10/d.xml': 'rejeitada_sefaz', '2026/09/10/e.xml': 'fora_da_instalacao' });
  assert.ok(t.notas_rejeitadas.some((x) => x.chave === chave(MATRIZ.cnpj, '65', 4) && x.empresa_id === MATRIZ.id), 'rejeitada guardada para o alerta');
  assert.equal(t.coletor_envios.length, 1);
  assert.equal(t.coletor_envios[0].importadas, 2);
  assert.equal(t.coletor_maquinas[0].enviados_total, 2);
  assert.ok(t.coletor_maquinas[0].ultimo_envio_em);
  await rejeita(s.receber(ctx, 'x.zip', Buffer.from('PK\u0003\u0004 lixo')), 422);

  await s.sinal(ctx, { versao: '0.1.0', hostname: 'SERVIDOR-NOTAS', sistema: 'Windows 10', pendentes: 12, pastas: [{ caminho: 'D:\\PDV\\NFCe', tipo: 'nfce', arquivos: 4127 }, { caminho: '' }], erro: '' });
  const m0 = t.coletor_maquinas[0];
  assert.deepEqual([m0.versao, m0.hostname, m0.pendentes, m0.pastas.length, m0.ultimo_erro], ['0.1.0', 'SERVIDOR-NOTAS', 12, 1, null]);
  const depois = await s.listar();
  const mq = depois.instalacoes.find((i) => i.id === inst.id)!.maquinas[0];
  assert.equal(mq.situacao, 'ok');
  assert.equal(mq.ultimas24h.novas, 2);
  console.log('ok  API: token, pareamento, chaves existentes, lote em ZIP separado por CNPJ, rejeitada guardada, fora da instalação, sinal de vida');

  /* 4) revogação, instalação desativada, troca de CNPJs, limite de ritmo */
  await s.revogarMaquina(inst.maquinas[1].id, 'a@x');
  await rejeita(s.autenticar(`Bearer ${tk2}`), 401, /revogado/);
  await s.editarInstalacao(inst.id, { empresas: [MATRIZ.id] }, 'a@x');
  assert.deepEqual((await s.autenticar(`Bearer ${tk1}`)).empresas.map((e) => e.cnpj), [MATRIZ.cnpj], 'troca de CNPJs vale na hora');
  await s.editarInstalacao(inst.id, { ativo: false }, 'a@x');
  await rejeita(s.autenticar(`Bearer ${tk1}`), 403, /desativada/);
  await rejeita(s.adicionarMaquinas(inst.id, { quantidade: 1 }, 'a@x'), 409);
  await s.editarInstalacao(inst.id, { ativo: true }, 'a@x');
  const mais = await s.adicionarMaquinas(inst.id, { maquinas: ['Caixa 3'] }, 'a@x');
  assert.equal((await s.autenticar(`Bearer ${mais.maquinas[0].token}`)).maquinaNome, 'Caixa 3');
  const c2 = await s.autenticar(`Bearer ${tk1}`);
  for (let i = 0; i < 120; i++) s.limitar(c2);
  assert.throws(() => s.limitar(c2), (e: any) => e.status === 429);
  console.log('ok  revogação imediata, instalação desativada, troca de CNPJs, nova máquina e limite de chamadas');
})().catch((e) => { console.error(e); process.exit(1); });
