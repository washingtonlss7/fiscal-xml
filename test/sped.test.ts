/**
 * SPED Fiscal: leitura, validação e comparação XML × SPED (com um arquivo sintético).
 *
 *   npx tsx test/sped.test.ts
 */
import assert from 'assert';
import { analisarEfd, chaveValida, cnpjValido, decodificarSped } from '../src/sped/efd';
import { compararXmlSped, XmlDoc } from '../src/sped/comparar';

const CNPJ = '55885998000140';
const FORN = '11222333000181';

function dv(base43: string) {
  let soma = 0; let peso = 2;
  for (let i = 42; i >= 0; i--) { soma += Number(base43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return base43 + (r < 2 ? 0 : 11 - r);
}
const chave = (cnpjEmit: string, mod: string, num: number) => dv(`322607${cnpjEmit}${mod}001${String(num).padStart(9, '0')}1${String(num).padStart(8, '0')}`);

/** Monta um SPED com as contagens de bloco e 9900 corretas. */
function montar(corpo: string[], opts: { quebrar9999?: boolean; e110?: [number, number] } = {}) {
  const [deb, cred] = opts.e110 ?? [17, 12];
  const e110 = `|E110|${deb.toFixed(2).replace('.', ',')}|0|0|0|${cred.toFixed(2).replace('.', ',')}|0|0|0|0|${(deb - cred).toFixed(2).replace('.', ',')}|0|${(deb - cred).toFixed(2).replace('.', ',')}|0|0|`;
  const linhas = [
    `|0000|020|0|01072026|31072026|FARMA TESTE LTDA|${CNPJ}||ES|084358580|3201209|||A|1|`,
    '|0001|0|',
    '|0005|FARMA TESTE|29306306|RUA A|10||CENTRO|2835224869|||',
    `|0150|F1|FORNECEDOR SA|1058|${FORN}||123|3550308||RUA B|1|||`,
    ...corpo.filter((l) => l.startsWith('|C') || l.startsWith('|D')).length ? [] : [],
  ];
  const bloco0 = linhas.length + 1;
  linhas.push(`|0990|${bloco0}|`);
  const c = corpo.filter((l) => l.startsWith('|C'));
  linhas.push('|C001|0|', ...c, `|C990|${c.length + 2}|`);
  linhas.push('|D001|1|', '|D990|2|');
  linhas.push('|E001|0|', '|E100|01072026|31072026|', e110, '|E990|4|');
  // bloco 9
  const cont = new Map<string, number>();
  for (const l of linhas) { const r = l.split('|')[1]; cont.set(r, (cont.get(r) ?? 0) + 1); }
  const regs9 = ['9001', '9900', '9990', '9999'];
  const nomes = [...cont.keys(), ...regs9];
  const n9900 = nomes.length;
  cont.set('9001', 1); cont.set('9900', n9900); cont.set('9990', 1); cont.set('9999', 1);
  const l9 = ['|9001|0|', ...nomes.map((r) => `|9900|${r}|${cont.get(r)}|`)];
  const total = linhas.length + l9.length + 2;
  l9.push(`|9990|${l9.length + 2}|`, `|9999|${opts.quebrar9999 ? total + 5 : total}|`);
  return Buffer.from([...linhas, ...l9].join('\r\n') + '\r\n', 'latin1');
}

const chEnt = chave(FORN, '55', 101);
const chSai = chave(CNPJ, '65', 5);
const docs = [
  `|C100|0|1|F1|55|00|1|101|${chEnt}|05072026|06072026|100,00|1|0|0|100,00|9|0|0|0|100,00|12,00|0|0|0|0|0|0|0|`,
  '|C170|1|P1||1|UN|100,00|0|0|000|1102|||100,00|12,00|12|0|0|0|0|||||||||||||||',
  '|C190|000|1102|12,00|100,00|100,00|12,00|0|0|0|0||',
  `|C100|1|0||65|00|1|5|${chSai}|10072026|10072026|100,00|0|0|0|100,00|9|0|0|0|100,00|17,00|||||||`,
  '|C190|000|5102|17,00|100,00|100,00|17,00|0|0|0|0||',
];

// 1) Utilitários
{
  assert.ok(cnpjValido(CNPJ) && cnpjValido(FORN) && !cnpjValido('55885998000141'));
  assert.ok(chaveValida(chEnt) && !chaveValida(chEnt.slice(0, 43) + ((Number(chEnt[43]) + 1) % 10)));
  const dupla = Buffer.from('BAIRRO INDEPENDÃ\u008aNCIA', 'utf8');
  assert.equal(decodificarSped(dupla).texto, 'BAIRRO INDEPENDÊNCIA');
  assert.equal(decodificarSped(Buffer.from('INDEPENDÊNCIA', 'latin1')).texto, 'INDEPENDÊNCIA');
  console.log('ok  CNPJ, chave de acesso e codificação (Latin-1, UTF-8 e conversão dupla)');
}

// 2) Arquivo correto
{
  const r = analisarEfd(montar(docs));
  assert.deepEqual(r.ocorrencias.filter((o) => o.nivel !== 'info'), [], JSON.stringify(r.ocorrencias));
  assert.equal(r.resumo.periodo, '2026-07');
  assert.equal(r.resumo.empresa!.ie, '084358580');
  assert.equal(r.resumo.empresa!.fantasia, 'FARMA TESTE');
  assert.deepEqual(r.resumo.apuracaoCalculada, { debitos: 17, creditos: 12 });
  assert.deepEqual(r.resumo.documentos.map((d) => `${d.rotulo}:${d.qtd}`), ['NF-e de entrada:1', 'NFC-e de saída:1']);
  console.log('ok  arquivo correto: sem erros, resumo e apuração conferidos');
}

// 3) Erros e alertas
{
  const cod = (b: Buffer) => analisarEfd(b).ocorrencias.map((o) => o.codigo);
  assert.ok(cod(montar(docs, { quebrar9999: true })).includes('9999'));
  assert.ok(cod(montar(docs, { e110: [20, 12] })).includes('E110_DEBITOS'));
  const chaveRuim = docs.map((l) => l.replace(chEnt, chEnt.slice(0, 43) + ((Number(chEnt[43]) + 1) % 10)));
  assert.ok(cod(montar(chaveRuim)).includes('C100_CHAVE_DV'));
  const semC190 = docs.filter((l) => !l.startsWith('|C190|000|5102'));
  assert.ok(cod(montar(semC190)).includes('C100_SEM_C190'));
  const valorErrado = docs.map((l) => l.replace('|C190|000|1102|12,00|100,00|', '|C190|000|1102|12,00|90,00|'));
  assert.ok(cod(montar(valorErrado)).includes('C190_VL_OPR'));
  const dataFora = docs.map((l) => l.replace('|05072026|06072026|', '|05072026|02082026|'));
  assert.ok(cod(montar(dataFora)).includes('C100_DATA'));
  const partErrado = docs.map((l) => l.replace('|C100|0|1|F1|', '|C100|0|1|F9|'));
  assert.ok(cod(montar(partErrado)).includes('C100_PARTICIPANTE'));
  const duplicado = [...docs, ...docs.slice(0, 3)];
  assert.ok(cod(montar(duplicado)).includes('C100_DUPLICADO'));
  assert.ok(cod(Buffer.from('isto não é sped')).includes('0000'));
  console.log('ok  9999, E110 × documentos, chave inválida, C190 ausente, VL_OPR, datas, participante, duplicidade e arquivo inválido');
}

// 4) Comparação XML × SPED
{
  const efd = analisarEfd(montar(docs)).efd;
  const x = (c: string, extra: Partial<XmlDoc> = {}): XmlDoc => ({
    chave: c, modelo: c.slice(20, 22), data: '2026-07-05', valor: 100, situacao: 'autorizada', emit: c.slice(6, 20), dest: CNPJ, toma: '', nomeEmit: 'FORNECEDOR SA', numero: String(Number(c.slice(25, 34))), ...extra,
  });
  const falta = chave(FORN, '55', 202);
  const outroMes = chave(FORN, '55', 303);
  const cteTomado = chave(FORN, '57', 404);
  const cteNaoTomado = chave(FORN, '57', 505);
  const c = compararXmlSped(efd, [
    x(chEnt, { valor: 110 }), x(falta), x(outroMes, { data: '2026-07-30' }),
    x(cteTomado, { toma: CNPJ, dest: '' }), x(cteNaoTomado, { toma: FORN, dest: CNPJ }),
    x(chSai, { emit: CNPJ, dest: '', situacao: 'cancelada' }),
  ], new Set([outroMes]), '2026-07-01');
  assert.equal(c.contagem.valor, 1, 'valor XML 110 × SPED 100');
  assert.equal(c.contagem.xml_sem_escrituracao, 1, 'nota 202 fora do SPED; 303 está no arquivo do mês seguinte');
  assert.equal(c.contagem.cte_sem_d100, 1, 'só o CT-e em que a empresa é tomadora');
  assert.equal(c.contagem.situacao, 1, 'NFC-e cancelada no XML e regular no SPED');
  assert.equal(c.totais.entradasConferidas, 1);
  assert.equal(c.totais.saidasConferidas, 1);
  const semSaidas = compararXmlSped(efd, [x(chEnt)], new Set(), '2026-07-01');
  assert.match(semSaidas.observacoes.join(' '), /Saídas não comparadas/);
  const antes = compararXmlSped(efd, [], new Set(), '2026-09-01');
  assert.equal(antes.divergencias[0].nivel, 'info', 'nota anterior à captação vira informação');
  console.log('ok  comparação: entrada fora do SPED, valor, situação, CT-e tomado e cobertura da captação');
}

console.log('\nTestes do SPED passaram.');
