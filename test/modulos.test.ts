/**
 * Módulos do escritório: Folha, Societário, Financeiro, Atendimento e visões do escritório (serviços com banco em memória)
 * e as permissões das rotas novas.
 *
 *   npx tsx test/modulos.test.ts
 */
import assert from 'assert';
import { bancoFalso } from './banco-falso';
import { ErroModulo, exigirMes, numeroOpcional } from '../src/modulos/comum';
import { ServicoFolha, progresso } from '../src/modulos/folha';
import { ServicoSocietario, situacaoValidade } from '../src/modulos/societario';
import { ServicoFinanceiro, contratoNoMes, situacaoTitulo, vencimentoNoMes } from '../src/modulos/financeiro';
import { ServicoAtendimento, atrasado } from '../src/modulos/atendimento';
import { certificados, gerarRelatorio, RELATORIOS } from '../src/modulos/escritorio';
import { exigenciaDaRota, MODULOS } from '../src/painel/acesso';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const so = new Set([A]);

async function rejeita(p: Promise<unknown>, status: number, trecho?: RegExp) {
  try { await p; } catch (e) {
    assert.ok(e instanceof ErroModulo, `esperava ErroModulo, veio ${(e as Error).message}`);
    assert.equal((e as ErroModulo).status, status, (e as Error).message);
    if (trecho) assert.match((e as Error).message, trecho);
    return;
  }
  assert.fail('deveria ter recusado');
}

function base(extra: string[] = []) {
  const b = bancoFalso(['empresas', 'certificados', 'folha_etapas', 'folha_empresas', 'folha_controle', 'ctb_empresas', 'ctb_movimentos', 'ctb_lancamentos',
    'soc_cadastro', 'soc_socios', 'soc_documentos', 'soc_processos', 'fin_contratos', 'fin_titulos', 'atd_chamados', 'atd_mensagens', ...extra]);
  b.t.empresas.push(
    { id: A, cnpj: '11222333000181', razao_social: 'Alfa Comércio', uf: 'ES', regime: 'simples', ativo: true, escritorio: false },
    { id: B, cnpj: '44555666000199', razao_social: 'Beta Serviços', uf: 'ES', regime: 'presumido', ativo: true, escritorio: false },
    { id: 'esc', cnpj: '99888777000166', razao_social: 'Escritório', uf: 'ES', regime: null, ativo: true, escritorio: true },
  );
  return b;
}

async function main() {
  /* ---------- comum ---------- */
  assert.equal(exigirMes('2026-09'), '2026-09');
  assert.throws(() => exigirMes('2026-13'), ErroModulo);
  assert.equal(numeroOpcional('1.234,56', 'x'), 1234.56);
  assert.equal(numeroOpcional('', 'x'), null);

  /* ---------- folha ---------- */
  {
    assert.deepEqual(progresso({ a: { status: 'feito' }, b: { status: 'nao_se_aplica' }, c: { status: 'pendente' } }, ['a', 'b', 'c', 'd']), { feitas: 2, total: 4 });
    const b = base();
    b.t.folha_etapas.push({ id: 'folha_fechada', nome: 'Folha fechada', ordem: 10, ativa: true }, { id: 'esocial', nome: 'eSocial', ordem: 20, ativa: true }, { id: 'contabilizada', nome: 'Contabilizada', ordem: 60, ativa: true }, { id: 'velha', nome: 'Velha', ordem: 99, ativa: false });
    const f = new ServicoFolha(b.db);
    await f.definirEmpresa('ana@x', null, { empresa_id: A, tem_folha: true, funcionarios: 7 });
    await rejeita(f.definirEmpresa('ana@x', so, { empresa_id: B, tem_folha: true }), 403);
    let p = await f.painel('2026-09', null);
    assert.equal(p.empresas.length, 1, 'só empresas com folha');
    assert.equal(p.etapas.length, 3, 'etapa inativa fora');
    assert.equal(p.totais.semConfiguracao, 1);
    assert.equal(p.empresas[0].feitas, 0);
    await f.marcar('ana@x', null, { empresa_id: A, mes: '2026-09', etapa_id: 'folha_fechada', status: 'feito' });
    await f.marcar('ana@x', null, { empresa_id: A, mes: '2026-09', etapa_id: 'esocial', status: 'nao_se_aplica' });
    await rejeita(f.marcar('ana@x', null, { empresa_id: A, mes: '2026-09', etapa_id: 'esocial', status: 'talvez' }), 400);
    await rejeita(f.marcar('ana@x', null, { empresa_id: A, mes: '2026-09', etapa_id: 'nao_existe', status: 'feito' }), 404);
    // Contabilizada automática: o Contábil gerou lançamentos da folha no mês
    b.t.ctb_empresas.push({ id: 'c1', empresa_id: A, codigo_dominio: '123' });
    b.t.ctb_movimentos.push({ ctb_empresa_id: 'c1', origem: 'folha', competencia: '2026-09-01', valor: 1000, status: 'ok', rubrica: '001' }, { ctb_empresa_id: 'c1', origem: 'folha', competencia: '2026-09-01', valor: 50.5, status: 'sem_regra', rubrica: '999' });
    b.t.ctb_lancamentos.push({ ctb_empresa_id: 'c1', origem: 'folha', competencia: '2026-09-01' });
    p = await f.painel('2026-09', null);
    const l = p.empresas[0];
    assert.equal(l.etapas.contabilizada.status, 'feito');
    assert.equal(l.etapas.contabilizada.automatico, true);
    assert.equal(l.feitas, 3);
    assert.equal(p.totais.concluidas, 1);
    assert.deepEqual(l.rubricas, { quantidade: 2, valor: 1050.5, pendentes: 1, lancamentos: 1 });
    // Mês seguinte começa zerado
    assert.equal((await f.painel('2026-10', null)).empresas[0].feitas, 0);
    const r = await f.rubricas(A, '2026-09', null);
    assert.equal(r.ligada, true); assert.equal(r.total, 1050.5);
    assert.deepEqual(await f.rubricas(B, '2026-09', null), { ligada: false, rubricas: [] });
    assert.equal((await f.salvarEtapa({ nome: 'Pró-labore conferido', ordem: 70 })).id, 'pro_labore_conferido');
  }

  /* ---------- societário ---------- */
  {
    assert.equal(situacaoValidade(null, '2026-10-09'), 'sem_validade');
    assert.equal(situacaoValidade('2026-10-08', '2026-10-09'), 'vencido');
    assert.equal(situacaoValidade('2026-11-01', '2026-10-09'), 'vencendo');
    assert.equal(situacaoValidade('2027-01-01', '2026-10-09'), 'em_dia');
    const b = base();
    const guardados = new Map<string, Buffer>();
    const arm = { salvar: async (c: string, d: Buffer) => { guardados.set(c, d); return c; }, ler: async (c: string) => guardados.get(c)! } as any;
    const s = new ServicoSocietario(b.db, arm);
    await s.salvarCadastro('ana@x', null, A, { natureza_juridica: '206-2 LTDA', capital_social: '50.000,00', cnae_principal: '47.71-7-01', cnaes_secundarios: '4772500, 4773300' });
    assert.equal(b.t.soc_cadastro[0].capital_social, 50000);
    assert.equal(b.t.soc_cadastro[0].cnae_principal, '4771701');
    assert.deepEqual(b.t.soc_cadastro[0].cnaes_secundarios, ['4772500', '4773300']);
    assert.equal((await s.salvarSocio('ana@x', null, { empresa_id: A, nome: 'João', documento: '123.456.789-09', qualificacao: 'socio_administrador', participacao: '60' })).aviso, null);
    const r2 = await s.salvarSocio('ana@x', null, { empresa_id: A, nome: 'Maria', documento: '98765432100', participacao: 50 });
    assert.match(String(r2.aviso), /110\.00%/);
    await rejeita(s.salvarSocio('ana@x', null, { empresa_id: A, nome: 'X', documento: '123' }), 400, /CPF/);
    await rejeita(s.salvarSocio('ana@x', so, { empresa_id: B, nome: 'X' }), 403);
    // Documento com PDF
    const pdf = Buffer.from('%PDF-1.4 teste');
    const d = await s.salvarDocumento('ana@x', null, { empresa_id: A, tipo: 'alvara', validade: '2026-10-20' }, { nome: 'alvará 2026.pdf', conteudo: pdf });
    assert.ok(b.t.soc_documentos[0].arquivo_caminho.startsWith(`societario/${A}/${d.id}_`));
    assert.deepEqual((await s.baixarDocumento(null, Number(d.id))).conteudo, pdf);
    await rejeita(s.baixarDocumento(new Set([B]), Number(d.id)), 403);
    await rejeita(s.salvarDocumento('ana@x', null, { empresa_id: A, tipo: 'alvara' }, { nome: 'x.exe', conteudo: Buffer.from('MZ') }), 422);
    await rejeita(s.salvarDocumento('ana@x', null, { empresa_id: A, tipo: 'nao_existe' }), 400);
    const venc = await s.vencimentos(null, 60);
    assert.equal(venc.length >= 1, true);
    assert.equal(venc[0].empresa, 'Alfa Comércio');
    assert.equal((await s.vencimentos(new Set([B]), 60)).length, 0, 'escopo filtra vencimentos');
    // Processo: etapas padrão do tipo
    const pr = await s.salvarProcesso('ana@x', null, { empresa_id: A, tipo: 'alteracao', titulo: 'Mudança de endereço' });
    const proc = b.t.soc_processos.find((x) => x.id === pr.id)!;
    assert.ok(proc.etapas.length > 1 && proc.etapas.every((e: any) => e.feito === false));
    await rejeita(s.salvarProcesso('ana@x', so, { tipo: 'abertura', cliente_nome: 'Nova' }), 403, /todas as empresas/);
    await s.salvarProcesso('ana@x', null, { tipo: 'abertura', cliente_nome: 'Nova Padaria' });
    assert.equal((await s.processos(null)).length, 2);
    assert.equal((await s.processos(so)).length, 1, 'processo sem empresa só para quem vê todas');
    // Ficha e lista
    const ficha = await s.ficha(A, null);
    assert.equal(ficha.socios.length, 2);
    assert.equal(ficha.documentos[0].situacao, situacaoValidade('2026-10-20'));
    const cli = await s.clientes(null);
    assert.equal(cli.length, 2, 'o escritório não entra');
    assert.equal(cli.find((c) => c.id === A)!.socios, 2);
    // Cliente sem certificado
    const novo = await s.criarCliente('ana@x', { cnpj: '12.345.678/0001-95', razao_social: 'Gama ME', uf: 'es', regime: 'mei' });
    const e = b.t.empresas.find((x) => x.id === novo.id)!;
    assert.equal(e.captar_nfe, false); assert.equal(e.captar_cte, false); assert.equal(e.uf, 'ES'); assert.equal(e.c_uf, 32);
    await rejeita(s.criarCliente('ana@x', { cnpj: '12345678000195', razao_social: 'Dup', uf: 'ES' }), 409);
    await rejeita(s.criarCliente('ana@x', { cnpj: '1', razao_social: 'X', uf: 'ES' }), 400);
    await rejeita(s.criarCliente('ana@x', { cnpj: '98765432000110', razao_social: 'X', uf: 'ZZ' }), 400, /UF/);
  }

  /* ---------- financeiro ---------- */
  {
    assert.equal(vencimentoNoMes('2026-02', 5), '2026-02-05');
    assert.equal(contratoNoMes({ inicio: '2026-09-15', fim: null, ativo: true }, '2026-09'), true);
    assert.equal(contratoNoMes({ inicio: '2026-10-01', fim: null, ativo: true }, '2026-09'), false);
    assert.equal(contratoNoMes({ inicio: '2026-01-01', fim: '2026-08-31', ativo: true }, '2026-09'), false);
    assert.equal(contratoNoMes({ inicio: '2026-01-01', fim: null, ativo: false }, '2026-09'), false);
    assert.equal(situacaoTitulo({ status: 'aberto', vencimento: '2026-09-10' }, '2026-10-09'), 'atrasado');
    assert.equal(situacaoTitulo({ status: 'aberto', vencimento: '2026-10-10' }, '2026-10-09'), 'aberto');
    assert.equal(situacaoTitulo({ status: 'pago', vencimento: '2026-09-10' }, '2026-10-09'), 'pago');
    const b = base();
    const f = new ServicoFinanceiro(b.db);
    await rejeita(f.salvarContrato('ana@x', null, { empresa_id: A, valor_mensal: 500, dia_vencimento: 31, inicio: '2026-01-01' }), 400, /1 e 28/);
    await rejeita(f.salvarContrato('ana@x', null, { empresa_id: A, valor_mensal: 0, dia_vencimento: 10, inicio: '2026-01-01' }), 400);
    await rejeita(f.salvarContrato('ana@x', so, { empresa_id: B, valor_mensal: 500, dia_vencimento: 10, inicio: '2026-01-01' }), 403);
    await f.salvarContrato('ana@x', null, { empresa_id: A, valor_mensal: '850,00', dia_vencimento: 10, inicio: '2026-01-01' });
    await f.salvarContrato('ana@x', null, { empresa_id: B, valor_mensal: 1200, dia_vencimento: 5, inicio: '2026-01-01', fim: '2026-08-31' });
    let g = await f.gerarCobrancas('ana@x', null, '2026-09');
    assert.deepEqual(g, { geradas: 1, jaExistiam: 0 }, 'contrato encerrado não gera');
    g = await f.gerarCobrancas('ana@x', null, '2026-09');
    assert.deepEqual(g, { geradas: 0, jaExistiam: 1 }, 'gerar de novo não duplica');
    const t = b.t.fin_titulos[0];
    assert.equal(t.vencimento, '2026-09-10'); assert.equal(t.valor, 850); assert.equal(t.status, 'aberto');
    await f.criarAvulso('ana@x', null, { empresa_id: B, descricao: 'IRPF do sócio', valor: '300', vencimento: '2026-09-20' });
    await rejeita(f.criarAvulso('ana@x', null, { empresa_id: B, valor: '300', vencimento: '2026-09-20' }), 400, /descrição/);
    let res = await f.resumo(null, '2026-09');
    assert.equal(res.previsto, 1150); assert.equal(res.recebido, 0);
    // Os dois venceram antes de hoje (relógio real), então estão atrasados
    assert.equal(res.inadimplentes.length, 2);
    assert.equal(res.inadimplentes[0].empresa, 'Alfa Comércio', 'maior valor primeiro');
    await f.baixar('ana@x', null, Number(t.id), { pago_em: '2026-09-12', valor_pago: 850, forma: 'pix' });
    await rejeita(f.baixar('ana@x', null, Number(t.id), {}), 409);
    res = await f.resumo(null, '2026-09');
    assert.equal(res.recebido, 850); assert.equal(res.emAberto, 300); assert.equal(res.inadimplentes.length, 1);
    assert.equal((await f.titulos(so, { mes: '2026-09' })).length, 1, 'escopo filtra cobranças');
    await rejeita(f.alterarStatus(so, Number(b.t.fin_titulos[1].id), 'cancelado'), 403);
    await f.alterarStatus(null, Number(t.id), 'aberto');
    assert.equal(b.t.fin_titulos[0].pago_em, null, 'reabrir apaga a baixa');
  }

  /* ---------- atendimento ---------- */
  {
    assert.equal(atrasado({ status: 'aberto', prazo: '2026-10-01' }, '2026-10-09'), true);
    assert.equal(atrasado({ status: 'resolvido', prazo: '2026-10-01' }, '2026-10-09'), false);
    assert.equal(atrasado({ status: 'aberto', prazo: null }, '2026-10-09'), false);
    const b = base();
    const a = new ServicoAtendimento(b.db);
    const c1 = await a.criar('ana@x', null, { assunto: 'Guia do DAS', empresa_id: A, departamento: 'fiscal', prioridade: 'alta', canal: 'whatsapp', status: 'aberto', mensagem: 'Cliente pediu a guia.', prazo: '2026-01-01' });
    await a.criar('bia@x', null, { assunto: 'Admissão', empresa_id: B, departamento: 'folha', status: 'aberto', responsavel: 'BIA@X' });
    await a.criar('bia@x', null, { assunto: 'Interno', status: 'aberto' });
    await rejeita(a.criar('ana@x', null, { assunto: '' }), 400);
    await rejeita(a.criar('ana@x', null, { assunto: 'x', departamento: 'marketing' }), 400);
    await rejeita(a.criar('ana@x', so, { assunto: 'x', empresa_id: B }), 403);
    assert.equal(b.t.atd_chamados[1].responsavel, 'bia@x', 'responsável em minúsculas');
    let l = await a.listar(null, { status: 'ativos' });
    assert.equal(l.length, 3);
    assert.equal((await a.listar(so, { status: 'ativos' })).length, 2, 'escopo: só a empresa A e os sem empresa');
    assert.equal((await a.listar(null, { status: 'ativos', responsavel: '__sem' })).length, 2);
    assert.equal((await a.listar(null, { status: 'ativos', departamento: 'folha' })).length, 1);
    assert.equal((await a.listar(null, { status: 'ativos', busca: 'das' })).length, 1);
    const r = await a.resumo(null, 'bia@x');
    assert.deepEqual([r.ativos, r.meus, r.semResponsavel, r.atrasados], [3, 1, 2, 1]);
    await a.atualizar('bia@x', null, Number(c1.id), { status: 'resolvido', responsavel: 'bia@x' });
    const d = await a.detalhe(null, Number(c1.id));
    assert.ok(d.resolvido_em, 'resolver grava a data');
    assert.equal(d.mensagens.length, 2);
    assert.match(d.mensagens[1].texto, /^\[Situação: Aberto → Resolvido · Responsável: ninguém → bia@x\]$/);
    await a.responder('ana@x', null, Number(c1.id), 'Guia enviada.');
    await rejeita(a.responder('ana@x', null, Number(c1.id), '  '), 400);
    await rejeita(a.detalhe(new Set([B]), Number(c1.id)), 403);
    await a.atualizar('bia@x', null, Number(c1.id), { status: 'em_andamento' });
    assert.equal(b.t.atd_chamados[0].resolvido_em, null, 'reabrir limpa a data de resolução');
    await a.excluir(null, Number(c1.id));
    await rejeita(a.detalhe(null, Number(c1.id)), 404);
    l = await a.listar(null, { status: 'ativos' });
    assert.equal(l.length, 2);
  }

  /* ---------- escritório: certificados e relatórios ---------- */
  {
    const b = base();
    b.t.certificados.push({ empresa_id: A, titular: 'ALFA', valido_ate: '2020-01-01T00:00:00Z', ativo: true });
    const c = await certificados(b.db, null);
    assert.deepEqual(c.totais, { vencidos: 1, vencendo: 0, sem: 1, emDia: 0 });
    assert.equal(c.certificados[0].situacao, 'vencido', 'vencidos primeiro');
    assert.equal((await certificados(b.db, new Set([B]))).certificados.length, 1);
    const deps = { folha: new ServicoFolha(b.db), societario: new ServicoSocietario(b.db, {} as any), financeiro: new ServicoFinanceiro(b.db), atendimento: new ServicoAtendimento(b.db) };
    const rel = await gerarRelatorio(b.db, deps, 'empresas', null, null);
    assert.match(rel.nome, /^empresas_\d{4}-\d{2}-\d{2}\.xlsx$/);
    assert.equal(rel.abas[0].linhas.length, 2);
    await rejeita(gerarRelatorio(b.db, deps, 'honorarios', null, null), 400);
    await rejeita(gerarRelatorio(b.db, deps, 'nao_existe', null, null), 404);
    for (const r of RELATORIOS) assert.ok(r.permissao === 'algum.ver' || /^[a-z]+\.[a-z]+$/.test(r.permissao), r.id);
  }

  /* ---------- permissões das rotas novas ---------- */
  {
    const e = exigenciaDaRota;
    assert.equal(e('GET', '/api/auditoria/resumo'), 'fiscal.ver');
    assert.equal(e('GET', '/api/st/resumo'), 'fiscal.ver');
    assert.equal(e('GET', '/api/folha/painel'), 'folha.ver');
    assert.equal(e('POST', '/api/folha/marcar'), 'folha.operar');
    assert.equal(e('POST', '/api/folha/etapas'), 'folha.configurar');
    assert.equal(e('GET', '/api/societario/clientes'), 'societario.ver');
    assert.equal(e('DELETE', '/api/societario/socios/3'), 'societario.operar');
    assert.equal(e('POST', '/api/financeiro/contratos'), 'financeiro.configurar');
    assert.equal(e('POST', '/api/financeiro/titulos/3/baixa'), 'financeiro.operar');
    assert.equal(e('GET', '/api/financeiro/titulos'), 'financeiro.ver');
    assert.equal(e('PATCH', '/api/atendimento/chamados/3'), 'atendimento.operar');
    assert.equal(e('DELETE', '/api/atendimento/chamados/3'), 'atendimento.configurar');
    assert.equal(e('GET', '/api/relatorios/folha'), 'algum.ver');
    assert.equal(e('GET', '/api/certificados'), 'administracao.empresas');
    assert.equal(e('POST', '/api/empresas/simples'), 'administracao.empresas');
    assert.equal(e('GET', '/api/configuracoes/resumo'), 'administracao.configuracoes');
    for (const id of ['folha', 'societario', 'financeiro', 'atendimento']) assert.equal(MODULOS.find((m) => m.id === id)?.disponivel, true, id);
  }

  console.log('modulos: ok');
}

main().catch((e) => { console.error(e); process.exit(1); });
