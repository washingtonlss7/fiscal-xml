/**
 * Tela do Appura Coletor: selos, "há quanto tempo", resumo da máquina, busca de empresas e filiais do mesmo grupo.
 *
 *   npx tsx test/coletores-tela.test.ts
 */
import assert from 'assert';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { clSituacao, clQuando, clResumoMaquina, clFiltrar, clMesmoGrupo, clNomesMaquinas } = require('../public/coletores.js');

const agora = Date.parse('2026-10-03T12:00:00Z');
assert.equal(clSituacao('ok').classe, 'ok');
assert.equal(clSituacao('sem_sinal').classe, 'problema');
assert.equal(clSituacao('xyz').texto, 'Aguardando instalação');
assert.equal(clQuando(null, agora), 'nunca');
assert.equal(clQuando('2026-10-03T11:55:00Z', agora), 'há 5 min');
assert.equal(clQuando('2026-10-03T09:00:00Z', agora), 'há 3 h');
assert.equal(clQuando('2026-10-01T12:00:00Z', agora), 'em 01/10/2026');
assert.equal(clResumoMaquina({ situacao: 'aguardando', prefixo: 'apc_abcdefgh', criadoEm: '2026-10-03T11:00:00Z' }, agora), 'Token apc_abcdefgh… gerado há 1 h · ainda não instalado');
assert.equal(clResumoMaquina({ situacao: 'ok', pareadoEm: 'x', ultimoContatoEm: '2026-10-03T11:58:00Z', hostname: 'SERVIDOR', versao: '0.1.0', pendentes: 3, ultimas24h: { novas: 1 } }, agora),
  'Último sinal há 2 min · SERVIDOR · versão 0.1.0 · 1 nota nova em 24 h · 3 na fila');
assert.match(clResumoMaquina({ situacao: 'revogada', prefixo: 'apc_x' }, agora), /revogado/);
const L = [{ id: 'a', cnpj: '55885998000140', razao_social: 'FARMA DIGITAL' }, { id: 'b', cnpj: '55885998000221', razao_social: 'FARMA FILIAL' }, { id: 'c', cnpj: '11222333000181', razao_social: 'Outra' }];
assert.deepEqual(clFiltrar(L, '55.885').map((e: any) => e.id), ['a', 'b']);
assert.deepEqual(clFiltrar(L, 'outra').map((e: any) => e.id), ['c']);
assert.equal(clFiltrar(L, '').length, 3);
assert.deepEqual(clMesmoGrupo(L, new Set(['a'])), ['a', 'b']);
assert.deepEqual(clNomesMaquinas(1), ['Servidor de notas']);
assert.deepEqual(clNomesMaquinas(3), ['Servidor de notas', 'Máquina 2', 'Máquina 3']);
console.log('ok  tela do coletor: selos, tempo do último sinal, resumo da máquina, busca e filiais do mesmo grupo');
