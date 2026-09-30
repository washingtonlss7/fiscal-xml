/**
 * Aba Apuração (funções puras da tela).
 *
 *   npx tsx test/apuracao-tela.test.ts
 */
import assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ap = require('../public/apuracao.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
import { GRUPOS } from '../src/fiscal/simples';

assert.deepEqual(ap.AP_GRUPOS.map((g: any) => [g.chave, g.atividade, g.st, g.monofasico, g.titulo]),
  Object.entries(GRUPOS).map(([k, g]) => [k, g.atividade, g.st, g.monofasico, g.titulo]), 'grupos da tela iguais aos do motor');
assert.equal(ap.apParticipacao(25, 100), '25%'); assert.equal(ap.apParticipacao(1.25, 100), '1,3%'); assert.equal(ap.apParticipacao(5, 0), '—');
assert.deepEqual(ap.apVariacao(150, 100), { texto: '+50%', fora: true });
assert.deepEqual(ap.apVariacao(90, 100), { texto: '-10%', fora: false });
assert.equal(ap.apVariacao(90, 0), null);
assert.deepEqual(ap.apSituacao({ estabelecimentos: [{ alertas: [{ nivel: 'erro' }, { nivel: 'alerta' }] }] }), { tom: 'problema', texto: '1 bloqueio' });
assert.deepEqual(ap.apSituacao({ estabelecimentos: [{ alertas: [{ nivel: 'alerta' }, { nivel: 'alerta' }, { nivel: 'info' }] }] }), { tom: 'atencao', texto: '2 pontos para conferir' });
assert.equal(ap.apSituacao({ estabelecimentos: [{ alertas: [{ nivel: 'info' }] }] }).tom, 'ok');
assert.deepEqual(ap.apCorpoAjuste('a2_st_mono', '1.250,50', '  NFS-e 12  ', '2026-09'),
  { mes: '2026-09', valor: 1250.5, atividade: 2, st: true, monofasico: true, justificativa: 'NFS-e 12' });
assert.equal(ap.apCorpoAjuste('a1', '-300,00', 'x', '2026-09').valor, -300);
console.log('ok  grupos iguais ao motor, participação, variação, situação e corpo do ajuste');
console.log('\nTestes da aba Apuração passaram.');
