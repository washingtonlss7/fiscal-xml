/**
 * Busca de XML em dois níveis: filtros, limites (12 meses, ZIP de 5.000), números/chaves, pastas do ZIP e permissão.
 *
 *   npx tsx test/busca-xml.test.ts
 */
import assert from 'assert';
import { caminhoNoZip, faixasNumeros, lerFiltro, listaChaves, MAX_ZIP, notasParaZip, parametroBusca, registrarDownload } from '../src/painel/buscaXml';
import { permissaoDaRota } from '../src/painel/usuarios';
import { vendasSemNota } from '../src/painel/rejeitadas';
import { bancoFalso } from './banco-falso';

const EMP = '11111111-1111-1111-1111-111111111111';
const CH = '32260955885998000140550010000012341000012340';

// 1) Filtros
{
  const f = lerFiltro({ empresa: 'todas', de: '2026-07-03', ate: '2026-10-01', uf: 'es', modelo: '55', direcao: 'saida', situacao: 'cancelada', por: 'numero', termo: '10001, 10002; 10010-10050' });
  assert.deepEqual([f.empresa, f.uf, f.modelo, f.direcao, f.situacao, f.por], [null, 'ES', '55', 'saida', 'cancelada', 'numero']);
  const p = parametroBusca(f);
  assert.deepEqual([p.de, p.ate, p.uf, p.limite, p.offset], ['2026-07-03T00:00:00-03:00', '2026-10-02T00:00:00-03:00', '32', 200, 0], 'até inclui o dia final; UF vira o código da chave');
  assert.deepEqual(p.numeros, [[10001, 10001], [10002, 10002], [10010, 10050]]);
  assert.equal(lerFiltro({ empresa: 'x', de: '2026-01-01', ate: '2026-01-31' }, EMP).empresa, EMP, 'aba da empresa trava a empresa');
  assert.throws(() => lerFiltro({ de: '2025-01-01', ate: '2026-01-02' }), /12 meses/);
  assert.doesNotThrow(() => lerFiltro({ de: '2025-01-02', ate: '2026-01-01' }));
  assert.throws(() => lerFiltro({ de: '2026-02-30', ate: '2026-03-01' }), /período/);
  assert.throws(() => lerFiltro({ de: '2026-03-02', ate: '2026-03-01' }), /anterior/);
  assert.throws(() => lerFiltro({ de: '2026-03-01', ate: '2026-03-02', uf: 'XX' }), /UF/);
  assert.throws(() => lerFiltro({ empresa: 'abc', de: '2026-03-01', ate: '2026-03-02' }), /Empresa/);
  assert.equal(lerFiltro({ de: '2026-03-01', ate: '2026-03-02', modelo: '99' }).modelo, null);
  assert.throws(() => faixasNumeros('10a'), /não é um número/);
  assert.deepEqual(faixasNumeros('50-10'), [[10, 50]]);
  assert.deepEqual(listaChaves(`${CH}\n${CH}, 32260955885998000140550010000012351000012351`).length, 2, 'sem repetidas');
  assert.throws(() => listaChaves('123'), /44 dígitos/);
  const doc = parametroBusca(lerFiltro({ de: '2026-03-01', ate: '2026-03-02', por: 'documento', termo: '55.885.998/0001-40' }));
  assert.equal(doc.doc, '55885998000140');
  assert.throws(() => parametroBusca(lerFiltro({ de: '2026-03-01', ate: '2026-03-02', por: 'documento', termo: '123' })), /CNPJ/);
  assert.equal(parametroBusca(lerFiltro({ de: '2026-03-01', ate: '2026-03-02', por: 'nome', termo: 'farma%_' })).nome, 'farma  ');
  assert.equal(parametroBusca(lerFiltro({ de: '2026-03-01', ate: '2026-03-02', por: 'chave', termo: CH })).chaves.length, 1);
  console.log('ok  filtros: período de até 12 meses, UF pela chave, números e faixas, chaves, CNPJ/CPF e nome');
}

// 2) ZIP: pastas e limite
{
  const n = { chave: CH, modelo: '55', direcao: 'entrada', situacao: 'cancelada', empresa_cnpj: '55885998000140', empresa_nome: 'FARMÁCIA São José/LTDA' };
  assert.equal(caminhoNoZip(n, false), `NFe/entrada/canceladas/${CH}.xml`);
  assert.equal(caminhoNoZip(n, true), `55885998000140 FARMACIA Sao JoseLTDA/NFe/entrada/canceladas/${CH}.xml`, 'escritório: uma pasta por empresa');
}

// 3) Vendas sem nota autorizada
{
  const r = (chave: string, numero: string, em: string) => ({ chave, modelo: '65', serie: '1', numero, emitida_em: em, valor: 10, cstat: '1023', motivo: 'Rejeicao: cClassTrib inexistente [nItem:1]' });
  const v = vendasSemNota([r('A1', '94005', '2026-09-01T10:00:00Z'), r('A9', '94005', '2026-09-01T09:59:00Z'), r('B1', '94006', '2026-09-01T11:00:00Z'), r('C1', '00094007', '2026-09-01T12:00:00Z')],
    [{ modelo: '65', serie: '001', numero: '94006' }, { modelo: '55', serie: '1', numero: '94007' }]);
  assert.deepEqual(v.map((x) => [x.numero, x.tentativas, x.emitida_em]), [['94005', 2, '2026-09-01T09:59:00Z'], ['00094007', 1, '2026-09-01T12:00:00Z']],
    'normal + contingência do mesmo número contam como uma venda; número com nota boa sai; modelo diferente não conta');
  console.log('ok  vendas sem nota: agrupa tentativas do mesmo número e tira as que têm nota autorizada');
}

(async () => {
  let pedido: any = null;
  const db = { rpc: async (_n: string, a: any) => { pedido = a.p; return { data: { total: MAX_ZIP + 1, notas: [] }, error: null }; } } as any;
  await assert.rejects(notasParaZip(db, lerFiltro({ de: '2026-01-01', ate: '2026-06-30' })), /limite de 5\.000/);
  assert.deepEqual([pedido.limite, pedido.caminhos], [MAX_ZIP + 1, 'sim']);
  const db2 = { rpc: async (_n: string, a: any) => { pedido = a.p; return { data: { total: 1, notas: [{ chave: CH }] }, error: null }; } } as any;
  await notasParaZip(db2, lerFiltro({ empresa: EMP, de: '2026-09-01', ate: '2026-09-30', modelo: '65' }), [CH]);
  assert.deepEqual([pedido.chaves, pedido.empresa, pedido.modelo, pedido.de], [[CH], EMP, undefined, '2000-01-01T00:00:00-03:00'], 'marcadas: só as chaves, sem cortar por período ou modelo');
  const { db: db3, t } = bancoFalso(['downloads_xml']);
  await registrarDownload(db3, { email: 'a@x.com', tipo: 'zip', empresaId: null, filtros: { de: '2026-09-01' }, quantidade: 12 });
  assert.deepEqual([t.downloads_xml[0].email, t.downloads_xml[0].tipo, t.downloads_xml[0].quantidade], ['a@x.com', 'zip', 12]);
  assert.equal(permissaoDaRota('POST', '/api/xml/zip'), null, 'Consulta também baixa');
  assert.equal(permissaoDaRota('POST', '/api/xml/excel'), null);
  assert.equal(permissaoDaRota('GET', '/api/xml/busca'), null);
  console.log('ok  ZIP: limite de 5.000, chaves marcadas, registro do download e permissão de leitura');
  console.log('\nTestes da busca de XML passaram.');
})().catch((e) => { console.error(e); process.exit(1); });
