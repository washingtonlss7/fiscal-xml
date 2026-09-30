/**
 * MCP do Appura, fase 2: ferramentas de ação com prévia + confirmação (código HMAC de uso único).
 *
 *   npx tsx test/mcp-acoes.test.ts
 */
import assert from 'assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { canonico, Confirmacoes, VALIDADE_CONFIRMACAO_MS } from '../src/mcp/acoes';
import { criarServidorMcp } from '../src/mcp/ferramentas';
import { ErroIntegra } from '../src/integra/cliente';
import { bancoFalso } from './banco-falso';

const ACOES = ['appura_enviar_guias_acessorias', 'appura_justificar_divergencias', 'appura_reabrir_divergencias', 'appura_verificar_procuracao'];
const ler = (r: any) => { const t = r.content[0].text; return JSON.parse(t.slice(t.indexOf('{'))); };

// 1) Código de confirmação
{
  let agora = Date.parse('2026-09-30T15:00:00Z');
  const c = new Confirmacoes('segredo', () => agora);
  assert.equal(canonico({ b: [2, 1], a: { d: 1, c: null } }), canonico({ a: { c: null, d: 1 }, b: [2, 1] }), 'ordem das chaves não importa');
  const alvo = { arquivo: 7, itens: [{ tipo: 'x', chave: '1' }] };
  const k = c.emitir('ana@x.com', 'f', alvo).codigo;
  assert.match(k, /^[0-9a-z]+\.[A-Za-z0-9_-]{22}$/);
  assert.equal(c.consumir(k, 'bia@x.com', 'f', alvo).ok, false, 'outro usuário');
  assert.equal(c.consumir(k, 'ana@x.com', 'g', alvo).ok, false, 'outra ferramenta');
  assert.equal(c.consumir(k, 'ana@x.com', 'f', { ...alvo, arquivo: 8 }).ok, false, 'outro alvo');
  assert.equal(c.consumir(k.replace(/.$/, (x) => (x === 'A' ? 'B' : 'A')), 'ana@x.com', 'f', alvo).ok, false, 'assinatura adulterada');
  assert.equal(c.consumir('lixo', 'ana@x.com', 'f', alvo).ok, false);
  assert.equal(new Confirmacoes('outro-segredo', () => agora).consumir(k, 'ana@x.com', 'f', alvo).ok, false, 'depende do segredo do servidor');
  assert.equal(c.consumir(k, 'ana@x.com', 'f', alvo).ok, true);
  const reuso = c.consumir(k, 'ana@x.com', 'f', alvo);
  assert.ok(!reuso.ok && /já foi usado/.test(reuso.motivo), 'uso único');
  const k2 = c.emitir('ana@x.com', 'f', alvo).codigo;
  agora += VALIDADE_CONFIRMACAO_MS + 1;
  const venc = c.consumir(k2, 'ana@x.com', 'f', alvo);
  assert.ok(!venc.ok && /venceu/.test(venc.motivo), 'vale 10 minutos');
  console.log('ok  código de confirmação: HMAC por usuário/ferramenta/alvo, uso único, validade de 10 minutos');
}

async function conectar(deps: any, ctx: any) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const server = criarServidorMcp(deps, ctx, async (r) => { deps.registro.push(r); });
  await server.connect(b);
  const cliente = new Client({ name: 'teste', version: '1' });
  await cliente.connect(a);
  return cliente;
}

async function testeFerramentas() {
  const { db, t } = bancoFalso(['empresas', 'integra_procuracoes']);
  const FARMA = { id: '11111111-1111-1111-1111-111111111111', cnpj: '55885998000140', razao_social: 'FARMA DIGITAL LTDA', regime: 'simples', uf: 'ES' };
  const DROGA = { id: '22222222-2222-2222-2222-222222222222', cnpj: '98765432000111', razao_social: 'DROGARIA CENTRAL LTDA', regime: 'mei', uf: 'ES' };
  t.empresas.push(FARMA, DROGA);
  t.integra_procuracoes.push({ empresa_id: FARMA.id, situacao: 'ausente', verificado_em: '2026-09-01T10:00:00Z' });

  const divs = [
    { tipo: 'xml_sem_sintegra', nivel: 'erro', modelo: '55', numero: 101, chave: '3'.repeat(44), detalhe: 'Nota fora do SINTEGRA' },
    { tipo: 'xml_sem_sintegra', nivel: 'erro', modelo: '55', numero: 102, chave: '4'.repeat(44), detalhe: 'Nota fora do SINTEGRA' },
    { tipo: 'valor_divergente', nivel: 'alerta', modelo: '55', numero: 103, chave: '5'.repeat(44), detalhe: 'Valor diferente' },
  ];
  const arquivo: any = { id: 9, nome: 'SINTEGRA-09.TXT', empresa_id: FARMA.id, tipo: 'sintegra', comparacao: { divergencias: divs } };
  const chamadasSped: any[] = [];
  const sped = {
    vigente: async (id: string, comp: string, tipo: string) => (id === FARMA.id && comp === '2026-09-01' && tipo === 'sintegra' ? arquivo : null),
    justificar: async (a: any, itens: any[], obs: string | null, email: string) => {
      chamadasSped.push({ itens, obs, email });
      for (const d of a.comparacao.divergencias) if (itens.some((i) => i.tipo === d.tipo && i.chave === d.chave)) d.justificativa = obs === null ? undefined : { observacao: obs, por: email };
      return { ...a, divergencias: a.comparacao.divergencias.filter((d: any) => !d.justificativa).length };
    },
  };
  const verificadas: string[] = [];
  const guias = {
    verificarProcuracao: async (id: string, email: string) => {
      verificadas.push(`${id}|${email}`);
      if (id === DROGA.id) throw new ErroIntegra(422, 'O SERPRO não respondeu para este contribuinte.');
      return { situacao: 'ativa', expira_em: '2027-09-30' };
    },
  };
  const pendentes = [{ id: 51, empresaId: FARMA.id, total: 312.4, vencimento: '2026-10-20' }, { id: 52, empresaId: DROGA.id, total: 75.9, vencimento: '2026-10-20' }];
  const enviadas: number[][] = [];
  const acessorias = {
    pendentes: async (_comp: string, ids?: string[]) => ({ guias: pendentes.filter((g) => !ids || ids.includes(g.empresaId)), jaEnviadas: 1 }),
    enviarLista: async (ids: number[]) => { enviadas.push(ids); return ids.map((id) => ({ guiaId: id, ok: id === 51, mensagem: id === 51 ? 'Enviada.' : 'Entrega inexistente.' })); },
  };
  let agora = Date.parse('2026-09-30T15:00:00Z');
  const deps: any = { db, sped, guias, acessorias, confirmacoes: new Confirmacoes('s', () => agora), registro: [] };

  // Sem o escopo de ações, ou perfil Consulta: nenhuma ferramenta de ação aparece
  const leitor = await conectar(deps, { email: 'ana@x.com', perfil: 'analista', clientId: null, acoes: false });
  assert.ok(!(await leitor.listTools()).tools.some((f) => ACOES.includes(f.name)));
  assert.match(String(leitor.getInstructions()), /Todas as ferramentas desta conexão são de leitura/);
  await leitor.close();

  const c = await conectar(deps, { email: 'ana@x.com', perfil: 'analista', clientId: 'app1', acoes: true });
  const tools = (await c.listTools()).tools;
  assert.deepEqual(tools.filter((f) => ACOES.includes(f.name)).map((f) => f.name).sort(), ACOES);
  assert.ok(tools.filter((f) => ACOES.includes(f.name)).every((f) => f.annotations?.readOnlyHint === false && f.annotations?.destructiveHint === false));
  assert.equal(tools.find((f) => f.name === 'appura_verificar_procuracao')!.annotations!.openWorldHint, true, 'chama o SERPRO');
  assert.match(String(c.getInstructions()), /Nunca confirme por conta própria/);

  // Justificar: prévia não altera nada
  const base = { empresa: '55885998000140', competencia: '2026-09', arquivo: 'sintegra', tipos: ['xml_sem_sintegra'], observacao: 'Notas de remessa sem obrigação no SINTEGRA.' };
  const semFiltro: any = await c.callTool({ name: 'appura_justificar_divergencias', arguments: { ...base, tipos: undefined } });
  assert.equal(semFiltro.isError, true); assert.match(semFiltro.content[0].text, /Diga quais divergências/);
  const pv = ler(await c.callTool({ name: 'appura_justificar_divergencias', arguments: base }));
  assert.equal(pv.etapa, 'previa'); assert.match(pv.instrucao, /NADA foi alterado/);
  assert.deepEqual(pv.divergencias.map((d: any) => d.documento), ['NF-e 101', 'NF-e 102']);
  assert.equal(chamadasSped.length, 0, 'prévia não grava');

  // Código com argumentos diferentes não vale
  const outra: any = await c.callTool({ name: 'appura_justificar_divergencias', arguments: { ...base, observacao: 'Outro texto qualquer', confirmacao: pv.confirmacao } });
  assert.equal(outra.isError, true); assert.match(outra.content[0].text, /não confere/);
  assert.equal(chamadasSped.length, 0);
  // O código de outra ferramenta também não
  const cruzado: any = await c.callTool({ name: 'appura_reabrir_divergencias', arguments: { ...base, observacao: undefined, confirmacao: pv.confirmacao } });
  assert.equal(cruzado.isError, true);

  // Com o código certo: executa exatamente o que a prévia mostrou
  const ex = ler(await c.callTool({ name: 'appura_justificar_divergencias', arguments: { ...base, confirmacao: pv.confirmacao } }));
  assert.equal(ex.etapa, 'executada'); assert.equal(ex.divergencias_em_aberto_agora, 1);
  assert.deepEqual(chamadasSped[0], { itens: [{ tipo: 'xml_sem_sintegra', chave: '3'.repeat(44) }, { tipo: 'xml_sem_sintegra', chave: '4'.repeat(44) }], obs: base.observacao, email: 'ana@x.com' });
  const de_novo: any = await c.callTool({ name: 'appura_justificar_divergencias', arguments: { ...base, confirmacao: pv.confirmacao } });
  assert.equal(de_novo.isError, true, 'as duas já estão justificadas: o alvo mudou e o código não serve mais');

  // Reabrir pela chave/número da nota
  const pr = ler(await c.callTool({ name: 'appura_reabrir_divergencias', arguments: { empresa: 'farma', competencia: '2026-09', arquivo: 'sintegra', chaves: ['102'] } }));
  assert.deepEqual(pr.divergencias.map((d: any) => [d.documento, d.justificativa_atual]), [['NF-e 102', base.observacao]]);
  ler(await c.callTool({ name: 'appura_reabrir_divergencias', arguments: { empresa: 'farma', competencia: '2026-09', arquivo: 'sintegra', chaves: ['102'], confirmacao: pr.confirmacao } }));
  assert.deepEqual(chamadasSped[1], { itens: [{ tipo: 'xml_sem_sintegra', chave: '4'.repeat(44) }], obs: null, email: 'ana@x.com' });

  // Prévia vencida
  const pv2 = ler(await c.callTool({ name: 'appura_justificar_divergencias', arguments: { ...base, tipos: ['valor_divergente'] } }));
  agora += VALIDADE_CONFIRMACAO_MS + 1000;
  const venc: any = await c.callTool({ name: 'appura_justificar_divergencias', arguments: { ...base, tipos: ['valor_divergente'], confirmacao: pv2.confirmacao } });
  assert.equal(venc.isError, true); assert.match(venc.content[0].text, /venceu/);

  // Procuração: prévia com o custo; execução segue mesmo se uma empresa falhar
  const pp = ler(await c.callTool({ name: 'appura_verificar_procuracao', arguments: { empresas: ['98.765.432/0001-11', 'farma'] } }));
  assert.match(pp.custo, /2 consultas cobradas pelo SERPRO/);
  assert.deepEqual(pp.empresas.map((e: any) => e.situacao_atual).sort(), ['ausente', 'não verificada']);
  assert.equal(verificadas.length, 0);
  const pe = ler(await c.callTool({ name: 'appura_verificar_procuracao', arguments: { empresas: ['98.765.432/0001-11', 'farma'], confirmacao: pp.confirmacao } }));
  assert.equal(pe.verificadas, 1);
  assert.deepEqual(pe.resultados.map((r: any) => [r.razao_social, r.situacao]).sort(), [['DROGARIA CENTRAL LTDA', 'erro'], ['FARMA DIGITAL LTDA', 'ativa']]);
  assert.match(pe.resultados.find((r: any) => r.situacao === 'erro').mensagem, /SERPRO não respondeu/, 'mensagem do serviço chega à IA');

  // Guias à Acessórias
  const pg = ler(await c.callTool({ name: 'appura_enviar_guias_acessorias', arguments: { competencia: '2026-09' } }));
  assert.equal(pg.ja_enviadas, 1); assert.deepEqual(pg.guias.map((g: any) => g.total), [312.4, 75.9]);
  assert.equal(enviadas.length, 0);
  const pg1 = ler(await c.callTool({ name: 'appura_enviar_guias_acessorias', arguments: { competencia: '2026-09', empresas: ['farma'] } }));
  const errado: any = await c.callTool({ name: 'appura_enviar_guias_acessorias', arguments: { competencia: '2026-09', confirmacao: pg1.confirmacao } });
  assert.equal(errado.isError, true, 'código da prévia de 1 empresa não envia todas');
  const eg = ler(await c.callTool({ name: 'appura_enviar_guias_acessorias', arguments: { competencia: '2026-09', confirmacao: pg.confirmacao } }));
  assert.deepEqual(enviadas, [[51, 52]]);
  assert.deepEqual([eg.enviadas, eg.com_erro], [1, 1]);

  // Tudo registrado com o usuário e o app
  const reg = deps.registro.filter((r: any) => ACOES.includes(r.ferramenta));
  assert.ok(reg.length >= 12 && reg.every((r: any) => r.email === 'ana@x.com'));
  assert.ok(reg.some((r: any) => r.clientId === 'app1' && r.sucesso === false), 'falhas também ficam registradas');
  await c.close();
  console.log('ok  ações: só com escopo + perfil, prévia sem efeito, código preso aos argumentos e ao alvo, execução, reuso/vencimento recusados, registro');
}

(async () => {
  await testeFerramentas();
  console.log('\nTestes das ações do MCP passaram.');
})().catch((e) => { console.error(e); process.exit(1); });
