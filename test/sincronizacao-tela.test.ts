/**
 * Barra de status do "Sincronizar": textos por etapa, porcentagem e fim. E o cálculo de NSU restantes.
 *
 *   npx tsx test/sincronizacao-tela.test.ts
 */
import assert from 'assert';
import { nsuRestantes } from '../src/sync';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { scLinhaModelo, scEstado } = require('../public/sincronizacao.js');

assert.equal(nsuRestantes('000000000001200', '000000000001650'), 450);
assert.equal(nsuRestantes('000000000001700', '000000000001650'), 0);
assert.equal(nsuRestantes('000000000001200', null), null);

assert.equal(scLinhaModelo({ modelo: 'nfe', etapa: 'consultando', chamadas: 3, localizados: 150, baixados: 120, restantes: 430 }),
  'NF-e: consultando a SEFAZ (lote 3) · 150 localizados · 120 baixados · cerca de 430 ainda na SEFAZ');
assert.equal(scLinhaModelo({ modelo: 'cte', etapa: 'concluido', chamadas: 1, localizados: 0, baixados: 0, restantes: 0 }), 'CT-e: concluído · nenhum documento novo');
assert.match(scLinhaModelo({ modelo: 'nfe', etapa: 'aguardando', mensagem: 'A SEFAZ só libera nova consulta 1 hora depois da anterior (às 17:05).' }), /às 17:05/);
assert.deepEqual(scEstado({ status: 'pendente' }).titulo, 'Na fila');
const meio = scEstado({ status: 'processando', progresso: { modelos: { nfe: { modelo: 'nfe', etapa: 'consultando', chamadas: 2, localizados: 100, baixados: 100, restantes: 300 }, cte: { modelo: 'cte', etapa: 'processando', chamadas: 1, localizados: 0, baixados: 0, restantes: 0 } } } });
assert.deepEqual([meio.pct, meio.fim, meio.linhas.length], [25, false, 2]);
assert.equal(scEstado({ status: 'processando', progresso: { modelos: { nfe: { modelo: 'nfe', etapa: 'consultando', baixados: 50, restantes: 150 }, cte: { modelo: 'cte', etapa: 'aguardando', restantes: null } } } }).pct, 25, 'modelo aguardando não trava a porcentagem');
assert.equal(scEstado({ status: 'processando', progresso: null }).linhas[0], 'Abrindo o certificado e preparando a consulta…');
const fim = scEstado({ status: 'concluido', mensagem: '230 documento(s) recebido(s).', progresso: { modelos: {} } });
assert.deepEqual([fim.fim, fim.pct, fim.tom, fim.linhas[0]], [true, 100, 'ok', '230 documento(s) recebido(s).']);
assert.equal(scEstado({ status: 'erro', mensagem: 'Certificado vencido.' }).tom, 'problema');
console.log('ok  barra de sincronização: fila, consultando (lote, localizados, baixados, restantes), porcentagem, fim e erro');
console.log('\nTestes da barra de sincronização passaram.');
