/**
 * Telas dos módulos do escritório: funções puras e rotas (#/auditoria, #/folha, #/societario…).
 *
 *   npx tsx test/escritorio-tela.test.ts
 */
import assert from 'assert';
import fs from 'fs';
import path from 'path';
/* eslint-disable @typescript-eslint/no-var-requires */
const es = require('../public/escritorio.js');
const fo = require('../public/folha.js');
const so = require('../public/societario.js');
const fn = require('../public/financeiro.js');
const at = require('../public/atendimento.js');
const n = require('../public/nucleo.js');
/* eslint-enable @typescript-eslint/no-var-requires */

// escritorio.js
assert.equal(es.esNumero('1.234,56'), 1234.56);
assert.equal(es.esNumero('1234.56'), 1234.56);
assert.equal(es.esNumero(''), null);
assert.ok(Number.isNaN(es.esNumero('abc')));
assert.equal(es.esDias(0), 'vence hoje');
assert.equal(es.esDias(1), 'vence em 1 dia');
assert.equal(es.esDias(12), 'vence em 12 dias');
assert.equal(es.esDias(-3), 'venceu há 3 dias');
assert.equal(es.esDias(null), '');
assert.equal(es.esData('2026-10-09'), '09/10/2026');
assert.equal(es.esData(null), '—');
for (const s of ['vencido', 'vencendo', 'sem_certificado', 'sem_validade', 'em_dia']) assert.ok(es.ES_SITUACAO[s].texto && es.ES_SITUACAO[s].tom, s);

// folha.js
assert.equal(fo.foProximo('pendente'), 'feito');
assert.equal(fo.foProximo('feito'), 'nao_se_aplica');
assert.equal(fo.foProximo('nao_se_aplica'), 'pendente');
const linhas = [
  { empresa: { razao_social: 'Alfa', cnpj: '111' }, feitas: 6, total: 6 },
  { empresa: { razao_social: 'Beta', cnpj: '222' }, feitas: 2, total: 6 },
];
assert.deepEqual(fo.foFiltrar(linhas, 'pendentes').map((l: any) => l.empresa.razao_social), ['Beta']);
assert.deepEqual(fo.foFiltrar(linhas, 'concluidas').map((l: any) => l.empresa.razao_social), ['Alfa']);
assert.equal(fo.foFiltrar(linhas, 'todas', 'bet').length, 1);
assert.equal(fo.foFiltrar(linhas, 'todas', '111').length, 1);

// societario.js
assert.deepEqual(so.soProgresso([{ feito: true }, { feito: false }, { feito: true }]), { feitas: 2, total: 3, pct: 67 });
assert.deepEqual(so.soProgresso(null), { feitas: 0, total: 0, pct: 0 });
assert.equal(so.soSomaParticipacao([{ participacao: '60.5' }, { participacao: 39.5 }, { participacao: 20, saida: '2026-01-01' }]), 100);

// financeiro.js
assert.equal(fn.fnPercentual(850, 1150), 73.9);
assert.equal(fn.fnPercentual(10, 0), 0);
assert.equal(fn.fnPercentual(2000, 1000), 100);
assert.equal(fn.fnDiasAtraso('2026-09-10', '2026-10-09'), 29);
assert.equal(fn.fnDiasAtraso('2026-10-10', '2026-10-09'), 0);

// atendimento.js
assert.equal(at.atEhHistorico('[Situação: Aberto → Resolvido]'), true);
assert.equal(at.atEhHistorico('Guia enviada [ok]'), false);
assert.equal(at.atNome('ana.souza@x.com'), 'ana.souza');
assert.equal(at.atNome('ana@x.com', [{ email: 'ana@x.com', nome: 'Ana Souza' }]), 'Ana Souza');
assert.equal(at.atNome(null), '—');

// Rotas
const todos = () => true;
assert.deepEqual(n.resolverRota('#/auditoria', todos), { tela: 'auditoria-esc', base: '#/auditoria' });
assert.deepEqual(n.resolverRota('#/icms-st', todos), { tela: 'st-esc', base: '#/icms-st' });
assert.deepEqual(n.resolverRota('#/folha', todos), { tela: 'folha', base: '#/folha' });
assert.deepEqual(n.resolverRota('#/societario', todos), { redirecionar: '#/societario/clientes' });
assert.deepEqual(n.resolverRota('#/societario/vencimentos', todos), { tela: 'societario', base: '#/societario', aba: 'vencimentos', id: null });
const ficha = n.resolverRota('#/societario/clientes/11111111-1111-1111-1111-111111111111', todos);
assert.equal(ficha.tela, 'societario'); assert.equal(ficha.id, '11111111-1111-1111-1111-111111111111');
assert.deepEqual(n.resolverRota('#/financeiro', todos), { redirecionar: '#/financeiro/resumo' });
assert.equal(n.resolverRota('#/financeiro/contratos', todos).aba, 'contratos');
assert.deepEqual(n.resolverRota('#/atendimento/42', todos), { tela: 'atendimento', base: '#/atendimento', id: 42 });
assert.equal(n.resolverRota('#/atendimento', todos).id, null);
assert.equal(n.resolverRota('#/relatorios', todos).tela, 'relatorios');
assert.equal(n.resolverRota('#/certificados', todos).tela, 'certificados');
assert.equal(n.resolverRota('#/configuracoes', todos).tela, 'configuracoes');
// Sem permissão: volta para o início com aviso
const soFiscal = (p: string) => p === 'fiscal.ver' || p === 'algum.ver';
assert.deepEqual(n.resolverRota('#/folha', soFiscal), { redirecionar: '#/visao-geral', semPermissao: 'Folha' });
assert.deepEqual(n.resolverRota('#/financeiro/resumo', soFiscal), { redirecionar: '#/visao-geral', semPermissao: 'Financeiro' });
assert.deepEqual(n.resolverRota('#/certificados', soFiscal), { redirecionar: '#/visao-geral', semPermissao: 'Certificados' });
assert.equal(n.resolverRota('#/relatorios', soFiscal).tela, 'relatorios');

// Ligação: cada tela tem a seção no HTML, o script carregado, o arquivo servido e guardado no app instalado
const pub = (f: string) => fs.readFileSync(path.join(__dirname, '../public', f), 'utf8');
const html = pub('index.html'); const sw = pub('sw.js'); const app = pub('app.js');
const server = fs.readFileSync(path.join(__dirname, '../src/painel/server.ts'), 'utf8');
for (const t of ['auditoria-esc', 'st-esc', 'folha', 'societario', 'financeiro', 'atendimento', 'relatorios', 'certificados', 'configuracoes']) {
  assert.ok(html.includes(`id="tela-${t}"`), `seção tela-${t}`);
  assert.ok(app.includes(`'tela-${t}'`), `esconderTudo inclui tela-${t}`);
}
for (const js of ['escritorio', 'folha', 'societario', 'financeiro', 'atendimento']) {
  assert.ok(html.includes(`<script src="/${js}.js?v=__VERSAO__"></script>`), `script ${js}`);
  assert.ok(sw.includes(`'/${js}.js'`), `sw ${js}`);
  assert.ok(server.includes(`'/${js}.js': ['${js}.js'`), `servido ${js}`);
}
// Nada mais "Em breve" no menu: todo item sem filhos tem rota
const nav = app.slice(app.indexOf('const NAV = ['), app.indexOf('const NAV_RODAPE'));
assert.ok(!/\{ rotulo: '[^']+', permissao: '[^']+' \}/.test(nav), 'item sem rota no menu');
for (const id of ['auditoria', 'icms-st', 'folha', 'atendimento', 'relatorios', 'certificados', 'configuracoes']) assert.match(nav, new RegExp(`id: '${id}'[^}]*rota: '#/`), id);

console.log('escritorio-tela: ok');
