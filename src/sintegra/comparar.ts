/**
 * Comparação XML × SINTEGRA.
 *
 * O SINTEGRA não traz a chave de acesso: as notas (registro 50) são casadas pelo CNPJ do emitente,
 * modelo, série e número. As NFC-e (registro 61) vêm resumidas por dia e faixa de numeração:
 * a comparação é pela numeração (cada XML precisa estar numa faixa) e pelo valor do dia.
 */
import type { Nivel } from '../sped/efd';
import type { XmlDoc } from '../sped/comparar';
import { CANCELADO_SINTEGRA, Sintegra } from './sintegra';

export type TipoDivSintegra =
  | 'xml_sem_registro' | 'registro_sem_xml' | 'valor' | 'situacao' | 'saida_sem_registro'
  | 'nfce_fora_das_faixas' | 'nfce_valor_dia';

export interface DivergenciaSintegra {
  tipo: TipoDivSintegra;
  nivel: Nivel;
  chave: string; // chave de acesso quando há XML; senão, identificação da nota ou do dia
  modelo: string;
  numero: string;
  data: string;
  participante: string;
  valorXml: number | null;
  valorSintegra: number | null;
  detalhe: string;
}

export interface ComparacaoSintegra {
  periodo: string;
  cobertura: { desde: string | null; saidas: boolean; nfce: boolean };
  totais: {
    entradasXml: number; entradasSintegra: number; entradasConferidas: number;
    saidasXml: number; saidasSintegra: number; saidasConferidas: number;
    nfceXml: number; nfceSintegra: number; nfceValorXml: number; nfceValorSintegra: number;
  };
  contagem: Record<TipoDivSintegra, number>;
  divergencias: DivergenciaSintegra[];
  observacoes: string[];
}

const r2 = (n: number) => Math.round(Number((n * 100).toFixed(6))) / 100;
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const numChave = (ch: string) => String(Number(ch.slice(25, 34)));
const serieChave = (ch: string) => String(Number(ch.slice(22, 25)));

export function compararXmlSintegra(s: Sintegra, xmls: XmlDoc[], desdeCaptura?: string | null): ComparacaoSintegra {
  const cab = s.cabecalho!;
  const cnpj = cab.cnpj;
  const ini = cab.dtIni; const fim = cab.dtFin;
  const noPeriodo = (d: string) => d >= ini && d <= fim;
  const div: DivergenciaSintegra[] = [];
  const obs: string[] = [];
  const desde = desdeCaptura !== undefined ? desdeCaptura : xmls.length ? xmls.map((x) => x.data).sort()[0] : null;

  // Notas do registro 50 agrupadas (um 50 por CFOP/alíquota)
  type Nota = { cnpj: string; modelo: string; serie: string; numero: string; data: string; valor: number; cancelada: boolean; entrada: boolean; emitente: string };
  const notas = new Map<string, Nota>();
  for (const d of s.r50) {
    if (d.modelo !== '55') continue;
    const entrada = /^[123]/.test(d.cfop);
    const k = `${d.cnpj}|${Number(d.serie) || 0}|${d.numero}|${entrada ? 'E' : 'S'}`;
    const n = notas.get(k) ?? { cnpj: d.cnpj, modelo: d.modelo, serie: String(Number(d.serie) || 0), numero: d.numero, data: d.data, valor: 0, cancelada: CANCELADO_SINTEGRA.has(d.situacao), entrada, emitente: d.emitente };
    n.valor = r2(n.valor + d.valor);
    notas.set(k, n);
  }

  // Entradas: NF-e de terceiros para a empresa
  const entradasXml = xmls.filter((x) => x.modelo === '55' && x.emit !== cnpj && x.dest === cnpj && noPeriodo(x.data));
  const usadas = new Set<string>();
  let entradasConferidas = 0;
  for (const x of entradasXml) {
    const k = `${x.emit}|${serieChave(x.chave)}|${numChave(x.chave)}|E`;
    const n = notas.get(k);
    if (!n) {
      if (x.situacao !== 'autorizada') continue;
      div.push({ tipo: 'xml_sem_registro', nivel: 'alerta', chave: x.chave, modelo: '55', numero: x.numero, data: x.data, participante: x.nomeEmit,
        valorXml: x.valor, valorSintegra: null, detalhe: 'NF-e de entrada com XML no Appura e sem registro 50 no SINTEGRA do mês.' });
      continue;
    }
    usadas.add(k);
    entradasConferidas++;
    conferir(x, n, x.nomeEmit);
  }
  const entradasSintegra = [...notas.entries()].filter(([, n]) => n.entrada && n.emitente === 'T');
  for (const [k, n] of entradasSintegra) {
    if (usadas.has(k) || n.cancelada) continue;
    const dentro = !!desde && n.data >= desde;
    div.push({ tipo: 'registro_sem_xml', nivel: dentro ? 'alerta' : 'info', chave: `50|${n.cnpj}|${n.serie}|${n.numero}`, modelo: '55', numero: n.numero, data: n.data,
      participante: n.cnpj, valorXml: null, valorSintegra: n.valor,
      detalhe: dentro ? 'Registrada no SINTEGRA, mas o Appura não tem o XML desta NF-e. Confira CNPJ, série e número.' : 'Registrada no SINTEGRA; é de antes do início da captação no Appura.' });
  }

  // Saídas NF-e próprias (só se houver XML de saída)
  const saidasXml = xmls.filter((x) => x.modelo === '55' && x.emit === cnpj && noPeriodo(x.data));
  const saidasSintegra = [...notas.entries()].filter(([, n]) => !n.entrada && n.emitente === 'P');
  let saidasConferidas = 0;
  if (saidasXml.length) {
    for (const x of saidasXml) {
      const k = `${cnpj}|${serieChave(x.chave)}|${numChave(x.chave)}|S`;
      const n = notas.get(k) ?? [...notas.values()].find((v) => !v.entrada && v.serie === serieChave(x.chave) && v.numero === numChave(x.chave));
      if (!n) {
        if (x.situacao === 'autorizada') {
          div.push({ tipo: 'saida_sem_registro', nivel: 'erro', chave: x.chave, modelo: '55', numero: x.numero, data: x.data, participante: '',
            valorXml: x.valor, valorSintegra: null, detalhe: 'NF-e emitida pela empresa e ausente do registro 50.' });
        }
        continue;
      }
      saidasConferidas++;
      conferir(x, n, '');
    }
  } else if (saidasSintegra.length) {
    obs.push(`Saídas não comparadas: o SINTEGRA tem ${saidasSintegra.length} NF-e de saída, mas o Appura não tem os XMLs de saída. Importe os XMLs (ou o ZIP do sistema da loja).`);
  }

  // NFC-e: numeração dentro das faixas do 61 e valor por dia
  const nfceXml = xmls.filter((x) => x.modelo === '65' && x.emit === cnpj && noPeriodo(x.data));
  const r61 = s.r61.filter((r) => r.modelo === '65');
  const nfceSintegra = r61.reduce((t, r) => t + Math.max(0, r.final - r.inicial + 1), 0);
  const valor61 = r2(r61.reduce((t, r) => t + r.valor, 0));
  let valorNfceXml = 0;
  if (nfceXml.length) {
    const dentroFaixa = (serie: string, num: number) => r61.some((r) => (Number(r.serie) || 0) === Number(serie) && num >= r.inicial && num <= r.final);
    const porDiaXml = new Map<string, number>();
    for (const x of nfceXml) {
      if (x.situacao !== 'autorizada') continue;
      valorNfceXml += x.valor;
      porDiaXml.set(x.data, r2((porDiaXml.get(x.data) ?? 0) + x.valor));
      if (!dentroFaixa(serieChave(x.chave), Number(numChave(x.chave)))) {
        div.push({ tipo: 'nfce_fora_das_faixas', nivel: 'alerta', chave: x.chave, modelo: '65', numero: x.numero, data: x.data, participante: '',
          valorXml: x.valor, valorSintegra: null, detalhe: 'NFC-e autorizada cujo número não está em nenhuma faixa do registro 61.' });
      }
    }
    const porDia61 = new Map<string, number>();
    for (const r of r61) porDia61.set(r.data, r2((porDia61.get(r.data) ?? 0) + r.valor));
    for (const dia of new Set([...porDiaXml.keys(), ...porDia61.keys()])) {
      const vx = porDiaXml.get(dia) ?? 0; const vs = porDia61.get(dia) ?? 0;
      if (Math.abs(vx - vs) > 0.05) {
        div.push({ tipo: 'nfce_valor_dia', nivel: 'alerta', chave: `61|${dia}`, modelo: '65', numero: '', data: dia, participante: '',
          valorXml: r2(vx), valorSintegra: r2(vs), detalhe: `Total das NFC-e do dia no XML difere do registro 61 em ${brl(Math.abs(r2(vx - vs)))}.` });
      }
    }
  } else if (r61.length) {
    obs.push(`NFC-e não comparadas: o SINTEGRA tem ${nfceSintegra} NFC-e (${brl(valor61)}), mas o Appura não tem os XMLs de saída do mês. Importe o ZIP das NFC-e para conferir numeração e valor por dia.`);
  }

  function conferir(x: XmlDoc, n: Nota, part: string) {
    const canceladaXml = x.situacao === 'cancelada' || x.situacao === 'denegada';
    if (canceladaXml !== n.cancelada) {
      div.push({ tipo: 'situacao', nivel: 'erro', chave: x.chave, modelo: x.modelo, numero: x.numero, data: x.data, participante: part,
        valorXml: x.valor, valorSintegra: n.valor,
        detalhe: canceladaXml ? `O XML está ${x.situacao} na SEFAZ, mas o SINTEGRA registra como regular.` : 'O SINTEGRA registra como cancelada, mas o XML está autorizado.' });
      return;
    }
    if (!canceladaXml && Math.abs(r2(x.valor - n.valor)) > 0.05) {
      div.push({ tipo: 'valor', nivel: 'alerta', chave: x.chave, modelo: x.modelo, numero: x.numero, data: x.data, participante: part,
        valorXml: x.valor, valorSintegra: n.valor, detalhe: `Valor no SINTEGRA difere do XML em ${brl(Math.abs(r2(x.valor - n.valor)))}.` });
    }
  }

  if (s.r88.some((r) => r.subtipo === 'SME')) {
    const compras = entradasXml.filter((x) => x.situacao === 'autorizada');
    if (compras.length) obs.push(`O SINTEGRA declara "sem movimento de entradas" (88SME), mas o Appura tem ${compras.length} NF-e de entrada no mês (${brl(r2(compras.reduce((t, x) => t + x.valor, 0)))}).`);
  }
  if (!desde) obs.push('O Appura ainda não tem XMLs desta empresa: a comparação fica disponível depois da primeira captação ou importação.');
  else if (desde > ini) obs.push(`A captação no Appura começa em ${desde.split('-').reverse().join('/')}: notas anteriores aparecem só como informação.`);

  const contagem = { xml_sem_registro: 0, registro_sem_xml: 0, valor: 0, situacao: 0, saida_sem_registro: 0, nfce_fora_das_faixas: 0, nfce_valor_dia: 0 } as Record<TipoDivSintegra, number>;
  for (const d of div) contagem[d.tipo]++;
  const ordem: Record<Nivel, number> = { erro: 0, alerta: 1, info: 2 };
  div.sort((a, b) => ordem[a.nivel] - ordem[b.nivel] || a.data.localeCompare(b.data));
  return {
    periodo: ini.slice(0, 7),
    cobertura: { desde, saidas: saidasXml.length > 0, nfce: nfceXml.length > 0 },
    totais: {
      entradasXml: entradasXml.length, entradasSintegra: entradasSintegra.length, entradasConferidas,
      saidasXml: saidasXml.length, saidasSintegra: saidasSintegra.length, saidasConferidas,
      nfceXml: nfceXml.filter((x) => x.situacao === 'autorizada').length, nfceSintegra, nfceValorXml: r2(valorNfceXml), nfceValorSintegra: valor61,
    },
    contagem,
    divergencias: div,
    observacoes: obs,
  };
}
