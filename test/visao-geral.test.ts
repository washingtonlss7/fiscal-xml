/**
 * Visão Geral: cálculo dos indicadores só com dados reais.
 *
 *   npx tsx test/visao-geral.test.ts
 */
import assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const vg = require('../public/visao-geral.js');

const emp = (x: Record<string, unknown>) => ({
  id: 'e', cnpj: '55885998000140', razao_social: 'Empresa', uf: 'ES', regime: 'simples', ativo: true, escritorio: false,
  criado_em: '2026-01-10T10:00:00Z', status: 'ok', certificado_valido_ate: '2027-01-01', dias_para_vencer: 90,
  ultima_sync_ok_em: '2026-09-29T05:00:00Z', notas_mes: 10, nao_auditadas: 0, ultima_nota_em: '2026-09-28T05:00:00Z',
  apont_abertos: 0, apont_total: 0, ...x,
});

const dados = {
  competencia: '2026-09-01',
  geradoEm: '2026-09-30T05:00:00Z',
  empresas: [
    emp({ id: 'a', razao_social: 'Alfa', status: 'ok', notas_mes: 100, apont_abertos: 3, apont_total: 10, criado_em: '2026-09-03T10:00:00Z' }),
    emp({ id: 'b', razao_social: 'Beta', status: 'certificado_vencido', regime: 'presumido', notas_mes: 0 }),
    emp({ id: 'c', razao_social: 'Gama', status: 'atrasada', notas_mes: 5 }),
    emp({ id: 'd', razao_social: 'Delta', status: 'certificado_vencendo', notas_mes: 8, nao_auditadas: 2, regime: null }),
    emp({ id: 'p', razao_social: 'Pausada', ativo: false, status: 'pausada' }),
  ],
  captacao: [{ empresa_id: 'a', dia: '2026-09-02' }, { empresa_id: 'c', dia: '2026-09-02' }, { empresa_id: 'd', dia: '2026-09-10' }, { empresa_id: 'p', dia: '2026-09-01' }],
  auditoria: [{ empresa_id: 'a', dia: '2026-09-05', n: 4 }, { empresa_id: 'a', dia: '2026-09-20', n: 3 }],
};

// 1) KPIs
{
  const c = vg.vgCalcular(dados, '', '2026-09-30');
  assert.equal(c.kpis.empresas, 4, 'pausada fora da base');
  assert.equal(c.kpis.novas, 1);
  assert.equal(c.kpis.xmlEmDia, 2, 'ok + vencendo contam como em dia');
  assert.equal(c.kpis.certVencidos, 1);
  assert.equal(c.kpis.certVencendo, 1);
  assert.equal(c.kpis.comPendencias, 3, 'bloqueada, atrasada e com auditoria aberta');
  console.log('ok  KPIs só com empresas ativas e situações reais');
}

// 2) Etapas: captação e auditoria reais; o resto indisponível
{
  const c = vg.vgCalcular(dados, '', '2026-09-30');
  const et = Object.fromEntries(c.etapas.map((e: any) => [e.id, e]));
  assert.deepEqual([et.xml.feito, et.xml.total], [2, 4]);
  assert.deepEqual([et.auditoria.feito, et.auditoria.total], [1, 3], 'Gama auditada; Alfa com pendência; Delta ainda auditando');
  assert.ok(et.st.indisponivel, 'st');
  assert.deepEqual([et.guias.feito, et.guias.total], [0, 2], 'DAS: Alfa e Gama (Simples) ativas, nenhuma guia gerada');
  assert.deepEqual([et.sped.feito, et.sped.total, et.validacao.feito], [0, 4, 0], 'nenhum SPED/SINTEGRA enviado: 0 de 4 ativas (Alfa e Gama entregam SINTEGRA, as outras SPED)');
  console.log('ok  etapas: captação, auditoria e SPED calculados; guias só de Simples/MEI; ICMS-ST sem número inventado');
}

// 2b) SPED guardado: etapas, pendências, status e atenção
{
  const comSped = {
    ...dados,
    cadastrosPendentes: 2,
    empresas: dados.empresas.map((e: any) =>
      e.id === 'c' ? { ...e, status: 'ok', sped: { erros: 0, alertas: 1, divergencias: 18 } }
        : e.id === 'd' ? { ...e, sped: { erros: 2, alertas: 0, divergencias: 0 } }
          : e.id === 'b' ? { ...e, sped: { erros: 0, alertas: 0, divergencias: 0 } } : e),
  };
  const c = vg.vgCalcular(comSped, '', '2026-09-30');
  const et = Object.fromEntries(c.etapas.map((e: any) => [e.id, e]));
  assert.deepEqual([et.sped.feito, et.sped.total], [2, 4], 'Beta e Gama sem erro no arquivo; Delta com 2 erros; Alfa (Simples) sem SINTEGRA');
  assert.deepEqual([et.validacao.feito, et.validacao.total], [2, 4], 'Beta e Delta sem divergência; Gama com 18; Alfa aguardando o SINTEGRA');
  const at = Object.fromEntries(c.atencao.map((a: any) => [a.id, a]));
  assert.equal(at.sped.n, 1); assert.equal(at.sped.breve, undefined);
  assert.equal(at['sped-erros'].n, 1);
  assert.equal(at.cadastros.n, 2);
  const gama = comSped.empresas.find((e: any) => e.id === 'c');
  assert.equal(vg.vgGeral(gama).chave, 'pendencias', 'divergência SPED × XML é pendência');
  assert.deepEqual(vg.vgPendencias(gama).map((p: any) => [p.etapa, p.n]), [['validacao', 18]]);
  assert.equal(vg.vgSped(gama).texto, 'Fiscal recebido · 1 alerta');
  const ambos = emp({ sped: { erros: 0, alertas: 0, divergencias: 0 }, contrib: { erros: 1, alertas: 1, divergencias: 3 } });
  assert.equal(vg.vgSped(ambos).texto, '1 erro no arquivo');
  assert.equal(vg.vgValidacao(ambos).texto, '3 divergências');
  assert.deepEqual(vg.vgPendencias(ambos).map((p: any) => [p.etapa, p.n]), [['sped', 1], ['validacao', 3]]);
  assert.equal(vg.vgSped(emp({ sped: { erros: 0, alertas: 0, divergencias: 0 }, contrib: { erros: 0, alertas: 0, divergencias: 0 } })).texto, 'Fiscal e Contrib.');
  assert.equal(vg.vgValidacao(emp({ contrib: { erros: 0, alertas: 0, divergencias: null } })).texto, 'Sem comparação', 'Contribuições sem SPED Fiscal para cruzar');
  assert.equal(vg.vgValidacao(gama).texto, '18 divergências');
  assert.equal(vg.vgSped(emp({ regime: 'presumido' })).texto, 'Não enviado');
  assert.equal(vg.vgSped(emp({})).texto, 'SINTEGRA não enviado', 'Simples sem SPED: SINTEGRA');
  assert.equal(vg.vgValidacao(emp({})).texto, 'Aguardando SINTEGRA');
  const si = emp({ sintegra: { erros: 1, alertas: 0, divergencias: 3 } });
  assert.equal(vg.vgSped(si).texto, 'SINTEGRA: 1 erro');
  assert.equal(vg.vgValidacao(si).texto, '3 divergências');
  assert.deepEqual(vg.vgPendencias(si).map((p: any) => [p.etapa, p.n]), [['sped', 1], ['validacao', 3]]);
  assert.equal(vg.vgSped(emp({ sintegra: { erros: 0, alertas: 2, divergencias: 0 } })).texto, 'SINTEGRA · 2 alertas');
  assert.equal(vg.vgValidacao(emp({ sintegra: { erros: 0, alertas: 0, divergencias: 0 } })).texto, 'XML e SINTEGRA conferem');
  assert.equal(vg.vgValidacao(emp({ sintegra: { erros: 0, alertas: 0, divergencias: null } })).texto, 'Sem comparação', 'SINTEGRA de cliente sem XMLs');
  assert.equal(vg.vgUsaSintegra(emp({ regime: 'presumido', sintegra: { erros: 0, alertas: 0, divergencias: 0 } })), true, 'quem enviou SINTEGRA entrega SINTEGRA');
  assert.equal(vg.vgUsaSintegra(emp({ sintegra: { erros: 0, alertas: 0, divergencias: 0 }, sped: { erros: 0, alertas: 0, divergencias: 0 } })), false, 'SPED enviado prevalece');
  assert.equal(vg.vgUsaSintegra(emp({ regime: 'mei' })), true);
  assert.equal(vg.vgUsaSintegra(emp({ regime: null })), false, 'regime não informado segue no SPED');
  assert.equal(vg.vgValidacao(emp({ sped: { erros: 0, alertas: 0, divergencias: 0 } })).tom, 'ok');
  assert.equal(vg.vgValidacao(emp({ sped: { erros: 0, alertas: 0, divergencias: null } })).texto, 'Sem comparação');
  assert.deepEqual(vg.fcFiltrar(c.lista, { etapa: 'validacao' }).map((e: any) => e.id), ['c']);
  assert.deepEqual(vg.fcFiltrar(c.lista, { etapa: 'sped' }).map((e: any) => e.id), ['d']);
  console.log('ok  SPED e SINTEGRA guardados: etapas, divergências na Central, pendências e cadastros para conferir');
}

// 3) Evolução acumulada até hoje; pausada não entra
{
  const c = vg.vgCalcular(dados, '', '2026-09-15');
  assert.equal(c.dias.length, 15);
  const xml = c.series.find((s: any) => s.id === 'xml');
  assert.equal(xml.valores[0], 0);
  assert.equal(xml.valores[1], 50, 'dia 2: 2 de 4');
  assert.equal(xml.valores[14], 75, 'dia 10: 3 de 4');
  const aud = c.series.find((s: any) => s.id === 'auditoria');
  assert.equal(aud.valores[4], 40, 'dia 5: 4 de 10 apontamentos');
  assert.equal(aud.valores[14], 40, 'dia 20 ainda não chegou');
  const fechado = vg.vgCalcular(dados, '', '2026-10-05');
  assert.equal(fechado.dias.length, 30, 'mês passado mostra o mês inteiro');
  const semHist = vg.vgCalcular({ ...dados, captacao: [], auditoria: [], empresas: dados.empresas.map((e: any) => ({ ...e, apont_total: 0 })) }, '', '2026-09-30');
  assert.equal(semHist.series.length, 0, 'sem histórico: nenhuma curva inventada');
  console.log('ok  evolução acumulada por dia, só com séries que têm dados');
}

// 4) Filtro de regime e da Central
{
  const c = vg.vgCalcular(dados, 'presumido', '2026-09-30');
  assert.equal(c.kpis.empresas, 1);
  assert.equal(vg.vgCalcular(dados, 'nao_informado', '2026-09-30').kpis.empresas, 1);
  const todas = vg.vgCalcular(dados, '', '2026-09-30').lista;
  assert.deepEqual(vg.vgFiltrarCentral(todas, { status: 'bloqueado' }).map((e: any) => e.id), ['b']);
  assert.deepEqual(vg.vgFiltrarCentral(todas, { status: 'pendencias' }).map((e: any) => e.id), ['a', 'c']);
  assert.deepEqual(vg.vgFiltrarCentral(todas, { foco: 'auditoria' }).map((e: any) => e.id), ['a']);
  assert.deepEqual(vg.vgFiltrarCentral(todas, { termo: '55.885' }).length, 5);
  assert.deepEqual(vg.vgFiltrarCentral(todas, { termo: 'gam' }).map((e: any) => e.id), ['c']);
  console.log('ok  filtros de regime, status, auditoria pendente e busca');
}

// 5) Situação por coluna
{
  assert.equal(vg.vgXml(emp({ status: 'sem_certificado' })).tom, 'problema');
  assert.equal(vg.vgXml(emp({ status: 'conflito_nsu' })).tom, 'atencao');
  assert.equal(vg.vgAuditoria(emp({ notas_mes: 0 })).texto, 'Sem notas');
  assert.equal(vg.vgAuditoria(emp({ apont_abertos: 1 })).texto, '1 pendência');
  assert.equal(vg.vgGeral(emp({})).chave, 'andamento', 'nunca "Concluído" sem SPED e guias');
  // Guias (DAS) e fechamento concluído
  assert.equal(vg.vgGuias(emp({ regime: 'presumido' })).texto, 'DCTFWeb · em breve');
  assert.equal(vg.vgGuias(emp({})).texto, 'DAS não gerado');
  assert.equal(vg.vgGuias(emp({ procuracao: 'ausente' })).texto, 'Sem procuração');
  assert.equal(vg.vgGuias(emp({ guia: { total: 1520.33, vencimento: '2026-10-20' } })).texto, 'DAS · vence 20/10');
  const semProc = emp({ procuracao: 'vencida' });
  assert.deepEqual(vg.vgPendencias(semProc).map((p: any) => p.etapa), ['guias']);
  assert.equal(vg.vgGeral(semProc).chave, 'pendencias');
  const pronta = emp({ notas_mes: 10, sintegra: { erros: 0, alertas: 0, divergencias: 0 }, guia: { total: 10, vencimento: '2026-10-20' }, procuracao: 'ativa' });
  assert.equal(vg.vgGeral(pronta).chave, 'concluido', 'SINTEGRA sem erro, XML confere e DAS gerado');
  assert.equal(vg.vgGeral({ ...pronta, guia: null }).chave, 'andamento');
  assert.equal(vg.vgGeral({ ...pronta, apont_abertos: 2 }).chave, 'pendencias');
  console.log('ok  situação de cada coluna, guias (DAS, procuração) e status geral com concluído');
}

// 6) Central de Fechamento: prioridade, contadores, filtros e ordenação
{
  const l = dados.empresas;
  const ordem = vg.fcOrdenar(vg.fcFiltrar(l, {}), 'criticidade').map((e: any) => e.id);
  assert.deepEqual(ordem, ['b', 'a', 'c', 'd'], 'Bloqueado → pendências (mais pendências primeiro) → andamento; pausada fora');
  assert.deepEqual(vg.fcContadores(l), { total: 4, bloqueado: 1, pendencias: 2, andamento: 1, concluido: 0, pausada: 1 });
  assert.deepEqual(vg.fcFiltrar(l, { status: 'pausada' }).map((e: any) => e.id), ['p']);
  assert.deepEqual(vg.fcFiltrar(l, { atencao: true }).map((e: any) => e.id).sort(), ['a', 'b', 'c']);
  assert.deepEqual(vg.fcFiltrar(l, { soBloqueados: true }).map((e: any) => e.id), ['b']);
  assert.deepEqual(vg.fcFiltrar(l, { etapa: 'auditoria' }).map((e: any) => e.id), ['a']);
  assert.deepEqual(vg.fcFiltrar(l, { etapa: 'xml' }).map((e: any) => e.id).sort(), ['b', 'c']);
  assert.deepEqual(vg.fcFiltrar(l, { regime: 'nao_informado' }).map((e: any) => e.id), ['d']);
  assert.equal(vg.fcFiltrar(l, { status: 'concluido' }).length, 0, 'nada "Concluído" sem SPED e guias');
  assert.deepEqual(vg.fcOrdenar(vg.fcFiltrar(l, {}), 'empresa').map((e: any) => e.razao_social), ['Alfa', 'Beta', 'Delta', 'Gama']);
  assert.deepEqual(vg.fcOrdenar(vg.fcFiltrar(l, {}), 'pendencias')[0].id, 'a', 'Alfa tem 3 apontamentos abertos');
  assert.equal(vg.vgQtdPendencias(l[0]), 3);
  assert.deepEqual(vg.vgPendencias(l[1]).map((p: any) => p.etapa), ['xml']);
  assert.equal(vg.vgQtdPendencias(l[4]), 0, 'pausada sem pendências');
  console.log('ok  Central: ordem por criticidade, contadores, filtros (atenção, bloqueadas, etapa, regime) e ordenações');
}

console.log('\nTestes da Visão Geral passaram.');
