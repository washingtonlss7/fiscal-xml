/**
 * Empresa 360°: etapas, pendências, certificado e histórico só com dados reais.
 *
 *   npx tsx test/empresa-360.test.ts
 */
import assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const e3 = require('../public/empresa-360.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const vg = require('../public/visao-geral.js');

const hoje = new Date('2026-09-30T12:00:00Z');
const base = (x: Record<string, any> = {}) => ({
  competencia: '2026-09-01',
  empresa: { id: 'e', cnpj: '55885998000140', razao_social: 'FARMA', uf: 'ES', regime: 'simples', ativo: true, status: 'ok', ...(x.empresa || {}) },
  certificado: 'certificado' in x ? x.certificado : { titular: 'FARMA', valido_ate: '2027-05-10T00:00:00Z' },
  captacao: [],
  documentos: x.documentos ?? [
    { modelo: '55', direcao: 'entrada', n: 283, canceladas: 1, so_resumo: 4, nao_auditadas: 0 },
    { modelo: '55', direcao: 'saida', n: 10, canceladas: 0, so_resumo: 0, nao_auditadas: 0 },
    { modelo: '65', direcao: 'saida', n: 50, canceladas: 2, so_resumo: 0, nao_auditadas: 0 },
    { modelo: '57', direcao: 'entrada', n: 79, canceladas: 0, so_resumo: 0, nao_auditadas: 0 },
  ],
  auditoria: x.auditoria ?? [
    { status: 'aberto', severidade: 'alerta', n: 17 }, { status: 'aberto', severidade: 'info', n: 6 },
    { status: 'ajustado', severidade: 'alerta', n: 6 }, { status: 'ignorado', severidade: 'erro', n: 1 },
  ],
  historico: x.historico ?? [],
  sped: x.sped ?? null,
  sintegra: x.sintegra ?? null,
  guia: x.guia ?? null,
  procuracao: x.procuracao ?? null,
  sugestao: x.sugestao ?? null,
  contrib: x.contrib ?? null,
});

// 1) Números da competência
{
  const d = base();
  assert.deepEqual(e3.e360Documentos(d), { total: 422, nfeEntrada: 283, nfeSaida: 10, nfce: 50, cte: 79, canceladas: 3, soResumo: 4, naoAuditadas: 0 });
  assert.deepEqual(e3.e360Auditoria(d), { total: 30, abertos: 23, erro: 0, alerta: 17, info: 6, tratados: 6, ignorados: 1 });
  console.log('ok  documentos por tipo e auditoria pela severidade gravada (erro, alerta, info)');
}

// 2) Certificado
{
  assert.equal(e3.e360Certificado(base({ certificado: null }), hoje).situacao, 'ausente');
  assert.equal(e3.e360Certificado(base({ certificado: { valido_ate: '2026-09-01T00:00:00Z' } }), hoje).situacao, 'vencido');
  const v = e3.e360Certificado(base({ certificado: { valido_ate: '2026-10-24T13:41:00Z' } }), hoje);
  assert.equal(v.situacao, 'vencendo'); assert.equal(v.dias, 24);
  assert.equal(e3.e360Certificado(base(), hoje).situacao, 'valido');
  console.log('ok  certificado: ausente, vencido, vencendo em 30 dias, válido');
}

// 3) Etapas e status igual ao da Central
{
  const et = Object.fromEntries(e3.e360Etapas(base()).map((x: any) => [x.id, x.estado]));
  assert.deepEqual(et, { xml: 'andamento', auditoria: 'pendencia', st: 'nao_iniciado', sped: 'nao_iniciado', validacao: 'nao_iniciado', guias: 'nao_iniciado' });
  assert.equal(e3.e360Etapas(base())[5].texto, 'DAS não gerado');
  assert.equal(e3.e360Etapas(base({ empresa: { regime: 'presumido' } }))[5].estado, 'indisponivel', 'DCTFWeb ainda não');
  assert.equal(e3.e360Etapas(base({ procuracao: { situacao: 'ausente' } }))[5].texto, 'Sem procuração no e-CAC');
  const comDas = e3.e360Etapas(base({ guia: { total: 1520.33, vencimento: '2026-10-20' } }))[5];
  assert.deepEqual([comDas.estado, comDas.texto.replace(/\u00a0/g, ' ')], ['concluido', 'DAS R$ 1.520,33 · vence 20/10/2026']);
  assert.deepEqual(e3.e360Atencao(base({ auditoria: [], documentos: [], procuracao: { situacao: 'vencida' } }), null, hoje).map((x: any) => x.id), ['procuracao']);
  assert.equal(e3.e360LinhaCentral(base({ procuracao: { situacao: 'ausente' } })).procuracao, 'ausente');
  assert.equal(e3.e360Etapas(base())[3].nome, 'SINTEGRA', 'Simples sem SPED: a etapa é o SINTEGRA');
  assert.equal(e3.e360Etapas(base())[3].texto, 'Nenhum SINTEGRA enviado');
  const si = Object.fromEntries(e3.e360Etapas(base({ auditoria: [], sintegra: { id: 5, erros: 1, alertas: 0, divergencias: 2 } })).map((x: any) => [x.id, x]));
  assert.equal(si.sped.texto, 'SINTEGRA · 1 erro no arquivo'); assert.equal(si.validacao.texto, '2 divergências com os XMLs');
  assert.deepEqual(e3.e360Atencao(base({ auditoria: [], documentos: [], sintegra: { erros: 1, alertas: 0, divergencias: 2 } }), null, hoje).map((x: any) => x.id), ['sintegra-erros', 'sintegra']);
  assert.equal(vg.vgGeral(e3.e360LinhaCentral(base({ auditoria: [], sintegra: { erros: 0, alertas: 0, divergencias: 2 } }))).chave, 'pendencias', 'divergência do SINTEGRA conta na Central');
  assert.equal(e3.e360Etapas(base({ sintegra: { erros: 0, alertas: 0, divergencias: 0 } }))[4].texto, 'XML e SINTEGRA conferem');
  assert.equal(e3.e360Etapas(base({ empresa: { regime: 'presumido' } }))[3].estado, 'nao_iniciado');
  const bloq = e3.e360Etapas(base({ empresa: { status: 'certificado_vencido' } }));
  assert.equal(bloq[0].estado, 'bloqueado');
  const semNotas = e3.e360Etapas(base({ documentos: [], auditoria: [] }));
  assert.equal(semNotas[1].estado, 'nao_iniciado');
  const auditada = e3.e360Etapas(base({ auditoria: [{ status: 'ajustado', severidade: 'alerta', n: 3 }] }));
  assert.equal(auditada[1].estado, 'concluido');
  assert.equal(e3.e360Etapas(base({ empresa: { uf: 'MG' } }))[2].estado, 'indisponivel');
  assert.equal(vg.vgGeral(e3.e360LinhaCentral(base())).chave, 'pendencias', 'mesma regra da Central');
  assert.equal(vg.vgGeral(e3.e360LinhaCentral(base({ auditoria: [] }))).chave, 'andamento');
  const comSped = base({ auditoria: [], sped: { id: 1, erros: 0, alertas: 0, divergencias: 18 } });
  const es = Object.fromEntries(e3.e360Etapas(comSped).map((x: any) => [x.id, x]));
  assert.equal(es.sped.estado, 'concluido'); assert.equal(es.validacao.estado, 'pendencia');
  assert.equal(es.validacao.texto, '18 divergências com os XMLs'); assert.equal(es.validacao.aba, 'sped');
  assert.equal(vg.vgGeral(e3.e360LinhaCentral(comSped)).chave, 'pendencias', 'divergência do SPED também conta na Central');
  const ok = Object.fromEntries(e3.e360Etapas(base({ sped: { erros: 0, alertas: 0, divergencias: 0 } })).map((x: any) => [x.id, x.estado]));
  assert.equal(ok.validacao, 'concluido');
  assert.equal(e3.e360Etapas(base({ sped: { erros: 3, alertas: 0, divergencias: 0 } }))[3].estado, 'pendencia');
  const comContrib = base({ auditoria: [], sped: { erros: 0, alertas: 0, divergencias: 0 }, contrib: { erros: 1, alertas: 0, divergencias: 2 } });
  const ec = Object.fromEntries(e3.e360Etapas(comContrib).map((x: any) => [x.id, x]));
  assert.equal(ec.sped.texto, 'Fiscal e Contribuições · 1 erro no arquivo');
  assert.equal(ec.validacao.texto, '2 divergências Fiscal × Contribuições');
  assert.equal(vg.vgGeral(e3.e360LinhaCentral(comContrib)).chave, 'pendencias');
  assert.deepEqual(e3.e360Atencao(comContrib, null, hoje).map((x: any) => x.id).filter((i: string) => i.startsWith('contrib')), ['contrib-erros', 'contrib']);
  console.log('ok  etapas do fechamento (com SPED guardado) e status geral pela mesma regra da Central');
}

// 4) Precisa de atenção
{
  const ids = (d: any, st?: any) => e3.e360Atencao(d, st, hoje).map((x: any) => x.id);
  assert.deepEqual(ids(base()), ['auditoria', 'resumo']);
  assert.deepEqual(ids(base({ empresa: { status: 'certificado_vencido' }, certificado: { valido_ate: '2026-09-01T00:00:00Z' } })), ['cert', 'auditoria', 'resumo']);
  assert.deepEqual(ids(base({ empresa: { status: 'atrasada' }, auditoria: [], documentos: [] })), ['captacao']);
  assert.deepEqual(ids(base({ auditoria: [], documentos: [], sped: { erros: 1, alertas: 0, divergencias: 4 }, sugestao: { id: 9 } })), ['sped-erros', 'sped', 'cadastro']);
  assert.deepEqual(ids(base({ auditoria: [], documentos: [] }), { uf: 'ES', total: 141.9 }), ['st']);
  assert.deepEqual(ids(base({ empresa: { ativo: false } })), [], 'pausada não gera pendência');
  assert.deepEqual(ids(base({ auditoria: [], documentos: [] })), [], 'sem nada: estado positivo');
  console.log('ok  precisa de atenção com destino real e estado positivo quando não há nada');
}

// 5) Histórico só com registros reais
{
  const h = e3.e360Historico(base({ historico: [
    { tipo: 'sefaz', em: '2026-09-30T05:14:00Z', dados: { modelo: 'nfe', cstat: '138', motivo: 'Documento localizado', qtd: 12 } },
    { tipo: 'auditoria', em: '2026-09-29T19:32:00Z', por: 'fiscal03@contabilfarma.com.br', dados: { status: 'ajustado', n: 3, competencia: '2026-09-01' } },
    { tipo: 'importacao', em: '2026-09-29T18:07:00Z', dados: { n: 124 } },
    { tipo: 'certificado', em: '2026-09-28T12:12:00Z', dados: { titular: 'FARMA', valido_ate: '2027-05-10', ativo: true } },
    { tipo: 'sped', em: '2026-09-27T12:00:00Z', por: 'fiscal03@contabilfarma.com.br', dados: { nome: 'sped.txt', competencia: '2026-07-01', erros: 0, divergencias: 18 } },
    { tipo: 'cadastro', em: '2026-09-27T13:00:00Z', por: 'gustavo@contabilfarma.com.br', dados: { status: 'aprovado', campos: ['ie', 'cep'] } },
    { tipo: 'justificativa', em: '2026-09-27T14:00:00Z', por: 'fiscal03@contabilfarma.com.br', dados: { n: 3, tipo_arquivo: 'sintegra', competencia: '2026-08-01', observacao: 'Notas lançadas em setembro' } },
    { tipo: 'sped', em: '2026-09-27T15:00:00Z', por: 'fiscal03@contabilfarma.com.br', dados: { nome: 'NFS.TXT', tipo: 'sintegra', competencia: '2026-08-01', erros: 1, divergencias: 0 } },
  ] }));
  assert.equal(h[6].titulo, '3 divergências justificadas');
  assert.equal(h[6].detalhe, 'SINTEGRA · Competência 08/2026 · "Notas lançadas em setembro"');
  assert.equal(h[6].por, 'fiscal03@contabilfarma.com.br');
  assert.equal(h[7].titulo, 'SINTEGRA enviado: NFS.TXT');
  const hg = e3.e360Historico(base({ historico: [
    { tipo: 'guia', em: '2026-09-30T12:00:00Z', por: 'fiscal03@contabilfarma.com.br', dados: { tipo: 'das_simples', competencia: '2026-09-01', total: 1520.33, vencimento: '2026-10-20', numero: '0720' } },
    { tipo: 'procuracao', em: '2026-09-30T11:00:00Z', por: 'fiscal03@contabilfarma.com.br', dados: { situacao: 'ativa', expira_em: '2027-03-15' } },
  ] }));
  assert.equal(hg[0].titulo.replace(/\u00a0/g, ' '), 'DAS do Simples gerado: R$ 1.520,33');
  assert.equal(hg[0].detalhe, 'Competência 09/2026 · vence 20/10/2026 · nº 0720');
  assert.equal(hg[1].titulo, 'Procuração ativa (Integra Contador)');
  assert.equal(hg[1].detalhe, 'Válida até 15/03/2027');
  assert.equal(h[4].titulo, 'SPED Fiscal enviado: sped.txt');
  assert.equal(h[4].detalhe, 'Competência 07/2026 · sem erros · 18 divergências');
  assert.equal(h[5].titulo, 'Cadastro atualizado pelo arquivo fiscal (2 campos)');
  assert.equal(h[0].titulo, 'Consulta SEFAZ (NF-e): 12 documentos recebidos');
  assert.equal(h[1].titulo, '3 apontamentos da auditoria tratados');
  assert.equal(h[1].por, 'fiscal03@contabilfarma.com.br');
  assert.equal(h[2].titulo, '124 documentos importados (XML/ZIP)');
  assert.equal(h[2].por, null, 'importação não registra usuário: não inventa');
  assert.match(h[3].titulo, /Certificado A1 cadastrado/);
  console.log('ok  histórico traduz consultas SEFAZ, auditoria (com quem fez), importações, certificados, SINTEGRA e justificativas');
}

console.log('\nTestes da Empresa 360° passaram.');
