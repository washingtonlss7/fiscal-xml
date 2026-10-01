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
import { ehExecucao, resumoArgumentos, usoMcp } from '../src/mcp/uso';

const ACOES = ['appura_enviar_guias_acessorias', 'appura_gerar_das', 'appura_justificar_divergencias', 'appura_reabrir_divergencias', 'appura_tratar_apontamentos', 'appura_verificar_procuracao'];
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
  const { db, t } = bancoFalso(['empresas', 'integra_procuracoes', 'pgdas_declaracoes', 'guias', 'apontamentos', 'documento_itens', 'mcp_chamadas', 'mcp_clientes']);
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
  const gerados: string[] = [];
  const guias = {
    gerarDas: async (id: string, comp: string, email: string, forcar: boolean) => {
      gerados.push(`${id}|${comp}|${email}|${forcar}`);
      return { guias: [{ id: 70, total: 412.55, vencimento: '2026-10-20', caminho: 'guias/x.pdf', envio: { status: 'enviado' } }], avisos: [] };
    },
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

  // Gerar DAS: competência obrigatória, bloqueios explicados na prévia, só as liberadas entram no código
  t.empresas.push({ id: '33333333-3333-3333-3333-333333333333', cnpj: '11222333000181', razao_social: 'MERCADO REAL LTDA', regime: 'real', uf: 'ES' });
  t.guias.push({ empresa_id: DROGA.id, competencia: '2026-08-01', total: 75.9, vencimento: '2099-01-20', gerado_em: '2026-09-02T10:00:00Z' });
  t.integra_procuracoes[0].situacao = 'ativa';
  const semComp: any = await c.callTool({ name: 'appura_gerar_das', arguments: { empresas: ['farma'] } });
  assert.equal(semComp.isError, true, 'competência é obrigatória para gerar DAS');
  const futuro: any = await c.callTool({ name: 'appura_gerar_das', arguments: { empresas: ['farma'], competencia: '2099-01' } });
  assert.match(futuro.content[0].text, /competência futura/);
  const pd = ler(await c.callTool({ name: 'appura_gerar_das', arguments: { empresas: ['farma', 'drogaria', 'mercado real'], competencia: '2026-08' } }));
  assert.match(pd.acao, /para 1 empresa/); assert.match(pd.custo, /1 emissão cobrada/);
  assert.deepEqual(pd.empresas.map((e: any) => [e.razao_social, e.vai_gerar]), [['FARMA DIGITAL LTDA', true], ['DROGARIA CENTRAL LTDA', false], ['MERCADO REAL LTDA', false]]);
  assert.match(pd.empresas[1].motivo, /Já tem DAS/); assert.match(pd.empresas[2].motivo, /Regime sem DAS/);
  assert.match(pd.atencao, /PGDAS-D/, 'Simples sem declaração confirmada: avisa');
  assert.equal(gerados.length, 0);
  const ed = ler(await c.callTool({ name: 'appura_gerar_das', arguments: { empresas: ['farma', 'drogaria', 'mercado real'], competencia: '2026-08', confirmacao: pd.confirmacao } }));
  assert.deepEqual(gerados, [`${FARMA.id}|2026-08|ana@x.com|false`], 'gera só a liberada e nunca força');
  assert.deepEqual([ed.geradas, ed.resultados[0].total, ed.resultados[0].acessorias], [1, 412.55, 'enviado']);
  const todasBloq: any = await c.callTool({ name: 'appura_gerar_das', arguments: { empresas: ['drogaria'], competencia: '2026-08' } });
  assert.equal(todasBloq.isError, true); assert.match(todasBloq.content[0].text, /Nenhuma das empresas/);

  // Tratar apontamentos: aplica só onde há sugestão, ignorar exige observação, reabrir
  t.apontamentos.push(
    { id: 1, empresa_id: FARMA.id, competencia: '2026-09-01', regra: 'CST_PIS_MONOFASICO', severidade: 'erro', mensagem: 'Monofásico com CST 01', chave: '6'.repeat(44), n_item: 1, sugestao: { campo: 'cst_pis_cofins_escrit', valor: '04' }, status: 'aberto' },
    { id: 2, empresa_id: FARMA.id, competencia: '2026-09-01', regra: 'CFOP_ENTRADA_INDEFINIDO', severidade: 'alerta', mensagem: 'CFOP sem regra', chave: '7'.repeat(44), n_item: 2, sugestao: null, status: 'aberto' },
    { id: 3, empresa_id: FARMA.id, competencia: '2026-09-01', regra: 'CST_PIS_MONOFASICO', severidade: 'erro', mensagem: 'Monofásico com CST 01', chave: '8'.repeat(44), n_item: 1, sugestao: { campo: 'cst_pis_cofins_escrit', valor: '04' }, status: 'aberto' },
  );
  t.documento_itens.push({ empresa_id: FARMA.id, chave: '6'.repeat(44), n_item: 1, cst_pis_escrit: '01', cst_cofins_escrit: '01' }, { empresa_id: FARMA.id, chave: '8'.repeat(44), n_item: 1, cst_pis_escrit: '01', cst_cofins_escrit: '01' });
  const ap = { empresa: 'farma', competencia: '2026-09' };
  const semAlvo: any = await c.callTool({ name: 'appura_tratar_apontamentos', arguments: { ...ap, acao: 'ignorar', observacao: 'teste de observação' } });
  assert.match(semAlvo.content[0].text, /informe regras ou ids/);
  const semObs: any = await c.callTool({ name: 'appura_tratar_apontamentos', arguments: { ...ap, acao: 'ignorar', ids: [2] } });
  assert.match(semObs.content[0].text, /escreva a observação/);
  const soCfop: any = await c.callTool({ name: 'appura_tratar_apontamentos', arguments: { ...ap, acao: 'aplicar_sugestao', ids: [2] } });
  assert.match(soCfop.content[0].text, /não tem|Nenhum desses/, 'sem sugestão: não aplica nada');
  const pa = ler(await c.callTool({ name: 'appura_tratar_apontamentos', arguments: { ...ap, acao: 'aplicar_sugestao', ids: [1, 2, 3] } }));
  assert.equal(pa.apontamentos.length, 2); assert.equal(pa.sem_sugestao_fora_da_acao, 1); assert.equal(pa.apontamentos[0].correcao, 'cst_pis_cofins_escrit → 04');
  assert.equal(t.apontamentos[0].status, 'aberto', 'prévia não altera');
  const ea = ler(await c.callTool({ name: 'appura_tratar_apontamentos', arguments: { ...ap, acao: 'aplicar_sugestao', ids: [1, 2, 3], confirmacao: pa.confirmacao } }));
  assert.equal(ea.tratados, 2);
  assert.deepEqual([t.apontamentos[0].status, t.apontamentos[0].resolvido_por, t.apontamentos[1].status], ['ajustado', 'ana@x.com', 'aberto']);
  assert.deepEqual([t.documento_itens[0].cst_pis_escrit, t.documento_itens[0].cst_cofins_escrit, t.documento_itens[0].ajustado_por], ['04', '04', 'ana@x.com'], 'grava a correção no item, como o painel');
  const pi = ler(await c.callTool({ name: 'appura_tratar_apontamentos', arguments: { ...ap, acao: 'ignorar', regras: ['CFOP_ENTRADA_INDEFINIDO'], observacao: 'Compra para uso e consumo, sem crédito.' } }));
  ler(await c.callTool({ name: 'appura_tratar_apontamentos', arguments: { ...ap, acao: 'ignorar', regras: ['CFOP_ENTRADA_INDEFINIDO'], observacao: 'Compra para uso e consumo, sem crédito.', confirmacao: pi.confirmacao } }));
  assert.deepEqual([t.apontamentos[1].status, t.apontamentos[1].observacao], ['ignorado', 'Compra para uso e consumo, sem crédito.']);
  const pr2 = ler(await c.callTool({ name: 'appura_tratar_apontamentos', arguments: { ...ap, acao: 'reabrir', ids: [2] } }));
  ler(await c.callTool({ name: 'appura_tratar_apontamentos', arguments: { ...ap, acao: 'reabrir', ids: [2], confirmacao: pr2.confirmacao } }));
  assert.equal(t.apontamentos[1].status, 'aberto');

  // Prompts prontos
  const prompts = (await c.listPrompts()).prompts.map((p) => p.name).sort();
  assert.deepEqual(prompts, ['clientes_sem_procuracao', 'fechamento_do_mes', 'guias_do_mes', 'revisar_empresa']);
  const pf: any = await c.getPrompt({ name: 'fechamento_do_mes', arguments: { competencia: '2026-09' } });
  assert.match(pf.messages[0].content.text, /appura_central_fechamento.*2026-09|2026-09[\s\S]*appura_central_fechamento/);
  assert.match(pf.messages[0].content.text, /PRÉVIA/, 'com ações: lembra da prévia');
  const pg2: any = await c.getPrompt({ name: 'guias_do_mes', arguments: {} });
  assert.match(pg2.messages[0].content.text, /appura_gerar_das/);
  const rev: any = await c.getPrompt({ name: 'revisar_empresa', arguments: { empresa: '55.885.998/0001-40' } });
  assert.match(rev.messages[0].content.text, /55\.885\.998\/0001-40/);

  // Consultas da apuração do Simples e do SPED gerado (só leitura, inclusive para o perfil Consulta)
  const depsLeitura: any = { ...deps,
    apuracao: { previa: async (id: string, comp: string) => ({ empresa: { razao_social: 'FARMA DIGITAL LTDA' }, competencia: comp, receita: 1000, comparacao: {},
      grupos: [{ titulo: 'Revenda com ICMS-ST', atividade: 2, valor: 1000, vendas: 1000, devolucoes: 0, ajustes: 0, ncms: [] }],
      estabelecimentos: [{ alertas: [{ nivel: 'alerta', titulo: 'Possível ICMS-ST não aplicado', detalhe: 'x', quantidade: 2, valor: 30 }], fora: [] }],
      apuracoes: [{ status: 'transmitida', tipo: 1, total_devido: '45.10', valores_devidos: [{ codigoTributo: 1001, valor: 5 }], simulado_em: 'x', transmitido_em: 'y', id_declaracao: '123', atual: true }] }) },
    gerarSped: { listar: async () => ({ regime: 'real', fiscal: [{ tipo: 'efd_icms_ipi', versao: 2, erros: 0, alertas: 1, resumo: { icms: { aRecolher: 10 } }, pendencias: [{ nivel: 'info', texto: 'i' }, { nivel: 'alerta', texto: 'a', quantidade: 3, exemplos: ['e1'] }] }], contribuicoes: [] }) } };
  const leitor3 = await conectar(depsLeitura, { email: 'ana@x.com', perfil: 'consulta', clientId: null, acoes: false });
  const nomes3 = (await leitor3.listTools()).tools.map((f) => f.name);
  assert.ok(nomes3.includes('appura_apuracao_simples') && nomes3.includes('appura_sped_gerado'));
  const apx = ler(await leitor3.callTool({ name: 'appura_apuracao_simples', arguments: { empresa: 'farma', competencia: '2026-09' } }));
  assert.deepEqual([apx.receita, apx.pgdas.situacao, apx.pgdas.total_das, apx.pontos_de_atencao[0].titulo], [1000, 'transmitida', 45.1, 'Possível ICMS-ST não aplicado']);
  const sgd = ler(await leitor3.callTool({ name: 'appura_sped_gerado', arguments: { empresa: 'farma', competencia: '2026-09' } }));
  assert.deepEqual([sgd.sped_fiscal.versao, sgd.sped_fiscal.pronto_para_o_pva, sgd.sped_fiscal.pendencias.length, sgd.sped_contribuicoes], [2, true, 1, 'não gerado']);
  await leitor3.close();

  // Tudo registrado com o usuário e o app
  const reg = deps.registro.filter((r: any) => ACOES.includes(r.ferramenta));
  assert.ok(reg.length >= 12 && reg.every((r: any) => r.email === 'ana@x.com'));
  assert.ok(reg.some((r: any) => r.clientId === 'app1' && r.sucesso === false), 'falhas também ficam registradas');
  assert.ok(reg.every((r: any) => !r.argumentos?.confirmacao || r.argumentos.confirmacao === 'informada'), 'o código de confirmação não vai para o registro');
  await c.close();
  const leitor2 = await conectar(deps, { email: 'ana@x.com', perfil: 'consulta', clientId: null, acoes: false });
  assert.doesNotMatch((await leitor2.getPrompt({ name: 'guias_do_mes', arguments: {} }) as any).messages[0].content.text, /appura_gerar_das/, 'sem ações: prompt não oferece ação');
  await leitor2.close();

  // Uso do MCP (administração)
  t.mcp_clientes.push({ client_id: 'app1', nome: 'Claude' });
  const agoraUso = Date.now();
  for (const r of deps.registro) t.mcp_chamadas.push({ id: t.mcp_chamadas.length + 1, em: new Date(agoraUso - 1000).toISOString(), email: r.email, client_id: r.clientId, ferramenta: r.ferramenta, argumentos: r.argumentos, sucesso: r.sucesso });
  t.mcp_chamadas.push({ id: 9999, em: new Date(agoraUso - 40 * 86_400_000).toISOString(), email: 'velho@x.com', client_id: null, ferramenta: 'appura_guias', argumentos: {}, sucesso: true });
  const uso = await usoMcp(db, 7, agoraUso);
  assert.equal(uso.totais.chamadas, deps.registro.length, 'só o período');
  assert.deepEqual(uso.porUsuario.map((p: any) => p.email), ['ana@x.com']);
  assert.ok(uso.totais.acoesExecutadas >= 8 && uso.acoes.every((a: any) => a.app === 'Claude' || a.app === 'Token pessoal'));
  assert.ok(uso.acoes.some((a: any) => a.ferramenta === 'appura_gerar_das' && a.sucesso && /competencia: 2026-08/.test(a.resumo)));
  assert.ok(uso.falhas.length > 0 && uso.falhas.every((f: any) => !f.sucesso));
  assert.equal((await usoMcp(db, 30, agoraUso)).dias, 30); assert.equal((await usoMcp(db, 999, agoraUso)).dias, 7);
  assert.ok(ehExecucao({ ferramenta: 'appura_gerar_das', argumentos: { confirmacao: 'informada' } }) && !ehExecucao({ ferramenta: 'appura_gerar_das', argumentos: {} }) && !ehExecucao({ ferramenta: 'appura_guias', argumentos: { confirmacao: 'informada' } }));
  assert.equal(resumoArgumentos({ empresas: ['a', 'b'], confirmacao: 'informada', x: null }), 'empresas: a, b');
  console.log('ok  DAS com bloqueios na prévia, apontamentos (sugestão, ignorar, reabrir), prompts prontos e uso do MCP');
  console.log('ok  ações: só com escopo + perfil, prévia sem efeito, código preso aos argumentos e ao alvo, execução, reuso/vencimento recusados, registro');
}

(async () => {
  await testeFerramentas();
  console.log('\nTestes das ações do MCP passaram.');
})().catch((e) => { console.error(e); process.exit(1); });
