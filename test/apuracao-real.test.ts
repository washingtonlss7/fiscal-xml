/**
 * Apuração do Lucro Real: comparação Appura × SPED enviado, vencimento do PIS/COFINS e montagem a partir do banco.
 *
 *   npx tsx test/apuracao-real.test.ts
 */
import assert from 'assert';
import { apuracaoReal, comparar, vencimentoPisCofins } from '../src/painel/apuracaoReal';
import { bancoFalso } from './banco-falso';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { arTom, arSituacao, arDia } = require('../public/apuracao-real.js');

assert.deepEqual(comparar([['aRecolher', 'A recolher'], ['debitos', 'Débitos']], { aRecolher: 100.005, debitos: 50 }, { aRecolher: 90 }),
  [{ campo: 'aRecolher', rotulo: 'A recolher', appura: 100.01, sped: 90, diferenca: 10.01 }, { campo: 'debitos', rotulo: 'Débitos', appura: 50, sped: null, diferenca: null }]);
assert.equal(vencimentoPisCofins('2026-09'), '2026-10-23', '25/10/2026 é domingo: antecipa para sexta');
assert.equal(vencimentoPisCofins('2026-12'), '2027-01-25');
assert.equal(vencimentoPisCofins('2026-03'), '2026-04-24', '25/04/2026 é sábado');
assert.equal(arTom(0.04), 'ok'); assert.equal(arTom(-3), 'problema'); assert.equal(arTom(null), 'neutro');
assert.deepEqual(arSituacao([{ appura: 1, sped: 1, diferenca: 0 }, { appura: 5, sped: 2, diferenca: 3 }]), { tom: 'problema', texto: '1 diferença' });
assert.equal(arSituacao([{ appura: 1, sped: null, diferenca: null }]).texto, 'Só o gerado pelo Appura');
assert.equal(arDia('2026-10-23'), '23/10/2026');
console.log('ok  comparação, arredondamento, vencimento do PIS/COFINS (dia 25, antecipa no fim de semana) e selos da tela');

(async () => {
  const { db, t } = bancoFalso(['empresas', 'sped_gerados', 'sped_arquivos']);
  const E = { id: '11111111-1111-1111-1111-111111111111', cnpj: '55885998000140', regime: 'real' };
  t.empresas.push(E, { id: '99', cnpj: '11222333000181', regime: 'real' });
  t.sped_gerados.push(
    { id: 1, empresa_id: E.id, tipo: 'efd_icms_ipi', competencia: '2026-09-01', versao: 1, erros: 0, gerado_em: '2026-10-01T10:00:00Z', resumo: { icms: { debitos: 900, creditos: 1000, saldoCredorAnterior: 0, aRecolher: 0, saldoCredorTransportar: 100 } } },
    { id: 2, empresa_id: E.id, tipo: 'efd_icms_ipi', competencia: '2026-09-01', versao: 2, erros: 1, gerado_em: '2026-10-01T11:00:00Z', resumo: { icms: { debitos: 1200, creditos: 1000, saldoCredorAnterior: 0, aRecolher: 200, saldoCredorTransportar: 0 } } },
    { id: 3, empresa_id: E.id, tipo: 'efd_contribuicoes', competencia: '2026-09-01', versao: 1, erros: 0, gerado_em: '2026-10-01T11:00:00Z', resumo: { pis: { debito: 165, credito: 65, aRecolher: 100 }, cofins: { debito: 760, credito: 300, aRecolher: 460 } } },
    { id: 4, empresa_id: '99', tipo: 'efd_icms_ipi', competencia: '2026-09-01', versao: 9, resumo: {} },
  );
  t.sped_arquivos.push(
    { id: 10, empresa_id: E.id, tipo: 'efd_icms_ipi', competencia: '2026-09-01', nome: 'erp.txt', enviado_em: '2026-10-01T12:00:00Z', enviado_por: 'a@x', resumo: { apuracao: { debitos: 1200, creditos: 950, saldoCredorAnterior: 0, recolher: 250, saldoCredorTransportar: 0 } } },
    { id: 11, empresa_id: E.id, tipo: 'efd_contribuicoes', competencia: '2026-09-01', nome: 'erp-c.txt', enviado_em: '2026-10-01T12:00:00Z', enviado_por: 'a@x', resumo: { apuracao: { pis: { contribuicao: 165, creditos: 65, recolher: 100 }, cofins: { contribuicao: 760, creditos: 300, recolher: 460 } } } },
  );
  const r = await apuracaoReal(db, E.id, '2026-09');
  assert.equal(r.icms.appura!.versao, 2, 'última versão gerada');
  assert.deepEqual(r.icms.linhas.find((l) => l.campo === 'aRecolher'), { campo: 'aRecolher', rotulo: 'ICMS a recolher', appura: 200, sped: 250, diferenca: -50 });
  assert.equal(r.icms.linhas.find((l) => l.campo === 'creditos')!.diferenca, 50);
  assert.ok(r.pis.linhas.every((l) => l.diferenca === 0) && r.cofins.linhas.every((l) => l.diferenca === 0));
  assert.match(r.avisos.join(' '), /1 pendência/);
  assert.equal(r.vencimentoPisCofins, '2026-10-23');
  console.log('ok  monta a partir do SPED gerado (última versão) e do enviado do mês, só da empresa');
  console.log('\nTestes da apuração do Lucro Real passaram.');
})().catch((e) => { console.error(e); process.exit(1); });
