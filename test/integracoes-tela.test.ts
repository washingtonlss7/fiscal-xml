/** Tela de integrações: nomes de modelos e direções, selo do webhook e exemplo de chamada. npx tsx test/integracoes-tela.test.ts */
import assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { itNomesModelos, itNomesDirecoes, itSituacaoWebhook, itExemploCurl } = require('../public/integracoes.js');
assert.equal(itNomesModelos(['55', '65']), 'NF-e e NFC-e');
assert.equal(itNomesDirecoes(['entrada', 'saida']), 'entrada e saída');
assert.equal(itSituacaoWebhook({}, null).texto, 'Sem webhook');
assert.equal(itSituacaoWebhook({ falhas7d: 0, pendentes: 0 }, 'https://x').tom, 'ok');
assert.equal(itSituacaoWebhook({ falhas7d: 0, pendentes: 3 }, 'https://x').texto, '3 na fila');
assert.equal(itSituacaoWebhook({ falhas7d: 2, pendentes: 1 }, 'https://x').tom, 'problema');
assert.match(itExemploCurl('https://fiscal.x', 'apk_1'), /Bearer apk_1" "https:\/\/fiscal\.x\/api\/integracao\/v1\/documentos/);
console.log('ok  tela de integrações: textos, selo do webhook e exemplo de chamada');
