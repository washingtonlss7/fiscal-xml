/**
 * Captação (Monitor, Lacunas/NSU, Importações, Histórico): avaliação da empresa, limites do mês e montagem a partir do banco.
 *
 *   npx tsx test/captacao.test.ts
 */
import assert from 'assert';
import { avaliarEmpresa, historico, importacoes, lacunas, limitesMes, monitor } from '../src/painel/captacao';
import { Consulta, Linha } from './banco-falso';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { cpQuando, cpFiltrar, cpResumoSefaz, cpLargura } = require('../public/captacao.js');

const agora = Date.parse('2026-10-05T13:00:00Z');
const sefaz = (o: any = {}) => ({ modelo: 'nfe', ultNsu: 10, maxNsu: 10, restantes: 0, ultimaConsultaEm: '2026-10-05T08:00:00Z', ultimaSyncOkEm: '2026-10-05T08:00:00Z', proximaConsultaEm: null, cstat: '137', motivo: 'ok', erros: 0, ...o });
assert.equal(avaliarEmpresa({ certificadoValidoAte: '2027-01-01', sefaz: [sefaz()], maquinas: [], agora }).tom, 'ok');
assert.equal(avaliarEmpresa({ certificadoValidoAte: null, sefaz: [sefaz()], maquinas: [], agora }).tom, 'problema');
assert.equal(avaliarEmpresa({ certificadoValidoAte: '2026-10-01', sefaz: [sefaz()], maquinas: [], agora }).motivos[0], 'Certificado vencido: a SEFAZ não é consultada.');
assert.match(avaliarEmpresa({ certificadoValidoAte: '2026-10-20', sefaz: [sefaz()], maquinas: [], agora }).motivos[0], /vence em 15 dias/);
const fila = avaliarEmpresa({ certificadoValidoAte: '2027-01-01', sefaz: [sefaz({ restantes: 23111, erros: 1, cstat: '656' })], maquinas: [], agora });
assert.deepEqual([fila.tom, fila.motivos], ['atencao', ['NF-e: 23.111 documentos ainda na fila da SEFAZ.']], '656 (esperar 1 hora) não conta como erro');
assert.equal(avaliarEmpresa({ certificadoValidoAte: '2027-01-01', sefaz: [sefaz({ erros: 3, cstat: '999' })], maquinas: [], agora }).tom, 'problema');
assert.equal(avaliarEmpresa({ certificadoValidoAte: '2027-01-01', sefaz: [sefaz({ ultimaSyncOkEm: '2026-10-04T05:00:00Z' })], maquinas: [], agora }).tom, 'atencao', '32 h sem consulta boa');
assert.equal(avaliarEmpresa({ certificadoValidoAte: '2027-01-01', sefaz: [sefaz({ ultimaSyncOkEm: '2026-10-02T05:00:00Z' })], maquinas: [], agora }).tom, 'problema');
assert.equal(avaliarEmpresa({ certificadoValidoAte: '2027-01-01', sefaz: [sefaz({ ultimaSyncOkEm: '2026-10-05T05:00:00Z' })], maquinas: [], agora }).tom, 'ok', 'de dia, 8 h sem consulta é normal');
assert.equal(avaliarEmpresa({ certificadoValidoAte: '2027-01-01', sefaz: [], maquinas: [{ situacao: 'sem_sinal' }], agora }).tom, 'problema');
assert.deepEqual(limitesMes('2026-09'), { inicio: '2026-09-01T03:00:00.000Z', fim: '2026-10-01T03:00:00.000Z' });
assert.deepEqual(limitesMes('2026-12').fim, '2027-01-01T03:00:00.000Z');
assert.throws(() => limitesMes('2026-13'));
console.log('ok  avaliação da empresa (certificado, erros, fila da SEFAZ, horário noturno, coletor) e limites do mês');

assert.equal(cpQuando(null), 'nunca');
assert.equal(cpQuando('2026-10-05T12:55:00Z', agora), 'há 5 min');
assert.equal(cpQuando('2026-10-05T03:00:00Z', agora), 'há 10 h');
assert.equal(cpQuando('2026-10-01T05:00:00Z', agora), 'em 01/10 às 02:00');
const L = [{ razaoSocial: 'FARMA DIGITAL', cnpj: '55885998000140', tom: 'ok' }, { razaoSocial: 'Contabilize', cnpj: '11222333000181', tom: 'atencao' }];
assert.equal(cpFiltrar(L, 'atencao', '').length, 1);
assert.equal(cpFiltrar(L, 'todas', '55.885').length, 1);
assert.equal(cpFiltrar(L, 'todas', 'contab')[0].cnpj, '11222333000181');
assert.equal(cpResumoSefaz(sefaz({ restantes: 5 }), agora).tom, 'atencao');
assert.equal(cpResumoSefaz(sefaz({ erros: 1, cstat: '656' }), agora).tom, 'ok');
assert.equal(cpResumoSefaz(null).texto, 'Nunca consultado');
assert.equal(cpLargura(5, 100), 5); assert.equal(cpLargura(1, 1000), 2); assert.equal(cpLargura(0, 10), 0);
console.log('ok  tela: tempo relativo, filtro do monitor, resumo da SEFAZ e barras do histórico');

(async () => {
  const t: Record<string, Linha[]> = { empresas: [], sync_state: [], certificados: [], coletor_maquinas: [], coletor_instalacao_empresas: [], coletor_instalacoes: [], sync_requests: [], sistema_status: [], importacoes_xml: [], coletor_envios: [], logs_sefaz: [] };
  let n = 0; const seq = () => ++n;
  const rpcs: Record<string, any> = {
    captacao_ultimas: [{ empresa_id: 'e1', ultima_captura: '2026-10-05T12:00:00Z', ultimas_24h: 46 }],
    captacao_lacunas_nsu: [{ empresa_id: 'e2', modelo: 'nfe', ult_nsu: 650, max_nsu: 23761, de: null, recebidos: 0, lacunas: 0 }, { empresa_id: 'e1', modelo: 'nfe', ult_nsu: 17296, max_nsu: 17296, de: 13554, recebidos: 3740, lacunas: 3 }],
    captacao_numeracao: [{ empresa_id: 'e1', modelo: '65', serie: '1', menor: 93998, maior: 100075, emitidas: 4634, faltam: 1444, rejeitadas: 1440 }],
    captacao_por_dia: [{ dia: '2026-10-03', recebido_via: 'importacao', modelo: '65', qtd: 8677 }, { dia: '2026-10-03', recebido_via: 'proprio', modelo: '55', qtd: 8 }, { dia: '2026-10-04', recebido_via: 'proprio', modelo: '57', qtd: 4 }],
  };
  const db = { from: (nome: string) => new Consulta(t[nome], seq), rpc: async (f: string) => ({ data: rpcs[f], error: null }) } as any;
  t.empresas.push({ id: 'e1', cnpj: '55885998000140', razao_social: 'FARMA', uf: 'ES', ativo: true }, { id: 'e2', cnpj: '11222333000181', razao_social: 'CONTABILIZE', uf: 'ES', ativo: true });
  t.certificados.push({ empresa_id: 'e1', valido_ate: '2027-01-01', ativo: true }, { empresa_id: 'e2', valido_ate: '2027-01-01', ativo: true });
  t.sync_state.push({ empresa_id: 'e1', modelo: 'nfe', ult_nsu: '000000000017296', max_nsu: '000000000017296', ultima_consulta_em: '2026-10-05T08:15:00Z', ultima_sync_ok_em: '2026-10-05T08:15:00Z', ultimo_cstat: '137', erros_consecutivos: 0 },
    { empresa_id: 'e2', modelo: 'nfe', ult_nsu: '000000000000650', max_nsu: '000000000023761', ultima_consulta_em: '2026-10-05T08:00:00Z', ultima_sync_ok_em: '2026-10-05T05:00:00Z', ultimo_cstat: '656', erros_consecutivos: 1 });
  t.coletor_instalacoes.push({ id: 'i1', nome: 'FARMA' });
  t.coletor_maquinas.push({ id: 'm1', instalacao_id: 'i1', nome: 'Servidor', revogado_em: null, pareado_em: 'x', ultimo_contato_em: '2026-10-05T12:59:00Z', ultimo_envio_em: '2026-10-05T12:50:00Z', pendentes: 0 });
  t.coletor_instalacao_empresas.push({ instalacao_id: 'i1', empresa_id: 'e1' });
  t.sistema_status.push({ chave: 'coletor', valor: { iniciado_em: '2026-10-03T14:03:42Z', horario_consultas: '23h às 6h' }, atualizado_em: '2026-10-03T14:03:42Z' });
  const m = await monitor(db, agora);
  const farma = m.empresas.find((e) => e.id === 'e1')!; const cont = m.empresas.find((e) => e.id === 'e2')!;
  assert.deepEqual([farma.tom, farma.capturas24h, farma.maquinas[0].situacao], ['ok', 46, 'ok']);
  assert.deepEqual([cont.tom, cont.sefaz[0].restantes], ['atencao', 23111]);
  assert.deepEqual([m.resumo.empresas, m.resumo.atencao, m.resumo.naFilaSefaz, m.resumo.coletoresAtivos, m.servicos.coletorSefaz.ultimaConsultaEm], [2, 1, 23111, 1, '2026-10-05T08:15:00Z']);
  const lc = await lacunas(db, '2026-09');
  assert.deepEqual([lc.sefaz[0].razaoSocial, lc.sefaz[0].naFila, lc.totais.lacunasNsu, lc.numeracao[0].semExplicacao, lc.totais.numerosFaltando], ['CONTABILIZE', 23111, 3, 4, 1444]);
  t.importacoes_xml.push({ id: 1, empresa_id: 'e1', email: 'a@x', arquivo: 'lote.zip', arquivos: 50, importadas: 40, completou_resumo: 0, ja_existiam: 10, rejeitadas: 0, em: '2026-10-04T10:00:00Z' });
  t.coletor_envios.push({ id: 1, maquina_id: 'm1', recebido_em: '2026-10-05T10:00:00Z', arquivos: 200, importadas: 150, completou_resumo: 0, ja_existiam: 0, rejeitadas: 1, rejeitadas_sefaz: 49, fora_da_instalacao: 0, erro: null });
  const imp = await importacoes(db, { desde: '2026-09-01T00:00:00Z', empresa: null, origem: null });
  assert.deepEqual(imp.itens.map((i) => i.origem), ['coletor', 'manual'], 'mais novo primeiro');
  assert.deepEqual([imp.totais.arquivos, imp.totais.novas, imp.totais.rejeitadasSefaz], [250, 190, 49]);
  assert.equal(imp.itens[0].empresas[0].razaoSocial, 'FARMA');
  assert.equal((await importacoes(db, { desde: '2026-09-01T00:00:00Z', empresa: 'e2', origem: null })).itens.length, 0);
  assert.equal((await importacoes(db, { desde: '2026-09-01T00:00:00Z', empresa: null, origem: 'manual' })).itens.length, 1);
  t.logs_sefaz.push({ id: 1, empresa_id: 'e2', modelo: 'nfe', cstat: '656', motivo: 'Consumo Indevido', qtd_docs: 0, criado_em: '2026-10-05T08:00:00Z', erro: null },
    { id: 2, empresa_id: 'e1', modelo: 'nfe', cstat: '138', motivo: 'Documento localizado', qtd_docs: 50, max_nsu: '000000000017296', ult_nsu_retornado: '000000000017296', criado_em: '2026-10-05T08:15:00Z', erro: null });
  const hi = await historico(db, { desde: '2026-09-01T00:00:00Z', empresa: null, soErros: false });
  assert.deepEqual(hi.dias.map((d) => [d.dia, d.total, d.importacao, d.sefaz, d.nfce, d.cte]), [['2026-10-04', 4, 0, 4, 0, 4], ['2026-10-03', 8685, 8677, 8, 8677, 0]]);
  assert.deepEqual(hi.consultas.map((c) => c.tom).sort(), ['atencao', 'ok']);
  assert.equal(hi.totais.comErro, 1);
  console.log('ok  montagem: monitor (fila da SEFAZ, coletor, capturas 24 h), lacunas e numeração, importações (manual + coletor, filtros) e histórico por dia');
})().catch((e) => { console.error(e); process.exit(1); });
