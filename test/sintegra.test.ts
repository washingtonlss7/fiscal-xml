/**
 * SINTEGRA: leitura, validação e comparação XML × SINTEGRA (com arquivo sintético).
 *
 *   npx tsx test/sintegra.test.ts
 */
import assert from 'assert';
import { analisarSintegra, codigoMunicipio, ehSintegra, lacunas61 } from '../src/sintegra/sintegra';
import { compararXmlSintegra } from '../src/sintegra/comparar';
import { dadosDoSintegra } from '../src/sped/cadastro';
import type { XmlDoc } from '../src/sped/comparar';

import { CNPJ, FORN, montar, r11, r50, r61, r88 } from './sintegra-arquivo';

const corpoBase = [
  r50({ numero: 101, cfop: '1102', valor: 100 }),
  r50({ numero: 102, cfop: '1403', valor: 50, outras: 40 }),
  r61('20260801', 32104, 32110, 2142.6),
  r61('20260815', 32122, 32134, 1370.9),
];

// 1) Arquivo correto
{
  const b = montar(corpoBase);
  assert.ok(ehSintegra(b));
  const r = analisarSintegra(b);
  const codigos = r.ocorrencias.map((o) => o.codigo);
  assert.deepEqual(codigos.filter((c) => !['61_LACUNA', '50_COMPOSICAO'].includes(c)), [], JSON.stringify(r.ocorrencias));
  assert.equal(r.resumo.periodo, '2026-08');
  assert.equal(r.resumo.empresa!.codMun, '3135209', 'Januária/MG pelo nome');
  assert.deepEqual(r.resumo.nfce, { registros: 2, notas: 20, valor: 3513.5, series: ['NFC-e série 01'] });
  assert.deepEqual(r.resumo.documentos.map((d) => `${d.rotulo}:${d.qtd}:${d.valor}`), ['NF-e de entrada:2:150']);
  assert.deepEqual(lacunas61(r.sintegra.r61)[0].numeros, [32111, 32112, 32113, 32114, 32115, 32116, 32117, 32118, 32119, 32120, 32121]);
  assert.ok(codigos.includes('50_COMPOSICAO'), 'nota 102: 50 = 0 + 0 + 40');
  console.log('ok  arquivo correto: estrutura, resumo, município pelo nome e numeração das NFC-e');
}

// 2) Erros e declarações
{
  const cod = (corpo: string[], o = {}) => analisarSintegra(montar(corpo, o)).ocorrencias.map((x) => x.codigo);
  assert.ok(cod(corpoBase, { quebrar90: true }).includes('90_TOTAIS'));
  assert.ok(cod([...corpoBase, r88('SME', 'Sem Movimento de Entradas')]).includes('88_SME'), '88SME com entradas no 50');
  assert.ok(cod([r61('20260801', 1, 2, 10), r88('SMS', 'Sem Movimento de Saídas')]).includes('88_SMS_NFCE'));
  assert.ok(cod([r50({ numero: 1, cfop: '1102', valor: 10, data: '20260905' })]).includes('DATA'));
  assert.ok(cod([r61('20260801', 1, 2, 10, 0)]).includes('61_COMPOSICAO'));
  const torto = montar(corpoBase).toString('latin1').replace(r11(), r11().slice(0, 120));
  assert.ok(analisarSintegra(Buffer.from(torto, 'latin1')).ocorrencias.some((o) => o.codigo === 'TAMANHO'));
  assert.ok(analisarSintegra(Buffer.from('|0000|020|x|\r\n')).ocorrencias.some((o) => o.codigo === '10'));
  assert.equal(codigoMunicipio('Vitória', 'ES'), '3205309');
  console.log('ok  totalizadores do 90, 88 SME/SMS, datas, composição do 61, tamanho da linha e arquivo inválido');
}

// 3) Pré-cadastro pelo registro 10/11
{
  const d = dadosDoSintegra(analisarSintegra(montar(corpoBase)).sintegra)!;
  assert.deepEqual({ ...d }, {
    cnpj: CNPJ, uf: 'MG', razao_social: 'BABY KIDS ABREU LTDA', ie: '0023702760067', cod_municipio: '3135209', municipio: 'Januária',
    logradouro: 'AVENIDA CONEGO RAMIRO LEITE,780', numero: '1', bairro: 'CENTRO', cep: '39480000', fone: '38362149160',
  });
  console.log('ok  pré-cadastro: razão social, IE, município (IBGE pelo nome), endereço e telefone');
}

// 4) Comparação XML × SINTEGRA
{
  const s = analisarSintegra(montar(corpoBase)).sintegra;
  const ch = (emit: string, mod: string, n: number, serie = 1) => `312608${emit}${mod}${String(serie).padStart(3, '0')}${String(n).padStart(9, '0')}1${String(n).padStart(8, '0')}`.slice(0, 43) + '0';
  const x = (chave: string, o: Partial<XmlDoc> = {}): XmlDoc => ({ chave, modelo: chave.slice(20, 22), data: '2026-08-05', valor: 100, situacao: 'autorizada', emit: chave.slice(6, 20), dest: CNPJ, toma: '', nomeEmit: 'FORNECEDOR', numero: String(Number(chave.slice(25, 34))), ...o });
  const c = compararXmlSintegra(s, [
    x(ch(FORN, '55', 101)), // confere
    x(ch(FORN, '55', 102), { valor: 55 }), // valor diferente (SINTEGRA 50)
    x(ch(FORN, '55', 103)), // sem registro 50
    x(ch(CNPJ, '65', 32104), { emit: CNPJ, dest: '', data: '2026-08-01', valor: 2142.6 }),
    x(ch(CNPJ, '65', 32200), { emit: CNPJ, dest: '', data: '2026-08-15', valor: 10 }), // fora das faixas
  ], '2026-08-01');
  assert.equal(c.totais.entradasConferidas, 2);
  assert.equal(c.contagem.valor, 1);
  assert.equal(c.contagem.xml_sem_registro, 1);
  assert.equal(c.contagem.nfce_fora_das_faixas, 1);
  assert.equal(c.contagem.nfce_valor_dia, 1, 'dia 15: XML 10,00 × SINTEGRA 1.370,90');
  const semXml = compararXmlSintegra(s, [], '2026-08-01');
  assert.equal(semXml.contagem.registro_sem_xml, 2);
  assert.match(semXml.observacoes.join(' '), /NFC-e não comparadas/);
  console.log('ok  comparação: entradas por CNPJ/série/número, valor, nota sem registro e NFC-e por faixa e por dia');
}

console.log('\nTestes do SINTEGRA passaram.');
