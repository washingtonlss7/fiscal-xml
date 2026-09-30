/**
 * Tela Conexões de IA: textos de uso e configuração JSON (funções puras de public/ia.js).
 *
 *   npx tsx test/ia-tela.test.ts
 */
import assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ia = require('../public/ia.js');

const agora = Date.parse('2026-09-30T18:00:00Z');
assert.equal(ia.iaUltimoUso(null, agora), 'Ainda não usado');
assert.equal(ia.iaUltimoUso('2026-09-30T17:30:00Z', agora), 'Usado há menos de 1 hora');
assert.equal(ia.iaUltimoUso('2026-09-30T13:00:00Z', agora), 'Usado há 5 h');
assert.equal(ia.iaUltimoUso('2026-09-20T13:00:00Z', agora), 'Usado em 20/09/2026');
const cfg = JSON.parse(ia.iaConfigJson('https://fiscal.x.com.br/mcp', 'appura_pt_abc'));
assert.deepEqual(cfg.mcpServers.appura, { type: 'http', url: 'https://fiscal.x.com.br/mcp', headers: { Authorization: 'Bearer appura_pt_abc' } });
console.log('ok  último uso e configuração JSON do MCP');
assert.deepEqual(ia.iaAcesso(false, true), { texto: 'Leitura', classe: 'neutro' });
assert.deepEqual(ia.iaAcesso(true, true), { texto: 'Leitura e ações', classe: 'pendente' });
assert.equal(ia.iaAcesso(true, false).texto, 'Leitura (ações bloqueadas pelo perfil)', 'perfil Consulta: o selo não promete ações');
console.log('ok  selo de acesso das conexões');
console.log('\nTestes da tela Conexões de IA passaram.');
