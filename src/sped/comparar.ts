import type { Efd, Nivel } from './efd';

/**
 * Comparação XML × SPED Fiscal por chave de acesso.
 *
 * - Entradas (NF-e de terceiros): todo XML emitido no período para a empresa deve estar num C100
 *   (neste arquivo ou, se a entrada efetiva foi no mês seguinte, no arquivo seguinte).
 * - Saídas próprias (NF-e/NFC-e): só são comparadas quando os XMLs de saída estão no Appura.
 * - CT-e: só é exigido D100 quando a empresa é a tomadora do serviço.
 * - Valor (VL_DOC × vNF/vTPrest) e situação (cancelada × regular).
 */

export interface XmlDoc {
  chave: string;
  modelo: string; // '55' | '65' | '57'
  data: string; // AAAA-MM-DD (emissão)
  valor: number;
  situacao: string; // autorizada | cancelada | denegada
  emit: string; // CNPJ/CPF do emitente
  dest: string; // CNPJ/CPF do destinatário
  toma: string; // CT-e: CNPJ/CPF do tomador
  nomeEmit: string;
  numero: string;
}

export type TipoDivergencia =
  | 'xml_sem_escrituracao' | 'escriturada_sem_xml' | 'valor' | 'situacao' | 'cte_sem_d100' | 'saida_sem_escrituracao';

export interface Divergencia {
  tipo: TipoDivergencia;
  nivel: Nivel;
  chave: string;
  modelo: string;
  numero: string;
  data: string;
  participante: string;
  valorXml: number | null;
  valorSped: number | null;
  detalhe: string;
}

export interface Comparacao {
  periodo: string;
  cobertura: { desde: string | null; saidas: boolean };
  totais: {
    entradasXml: number; entradasSped: number; entradasConferidas: number;
    saidasXml: number; saidasSped: number; saidasConferidas: number;
    cteTomador: number; d100: number;
  };
  contagem: Record<TipoDivergencia, number>;
  divergencias: Divergencia[];
  observacoes: string[];
}

const CANC_SPED = new Set(['02', '03', '04', '05']);
const r2 = (n: number) => Math.round(n * 100) / 100;
const MOD: Record<string, string> = { '55': 'NF-e', '65': 'NFC-e', '57': 'CT-e' };

/**
 * @param outrasChaves chaves escrituradas em arquivos de outros meses (para não acusar entrada
 *        que foi escriturada no mês seguinte pela data de entrada).
 */
export function compararXmlSped(efd: Efd, xmls: XmlDoc[], outrasChaves: Set<string> = new Set(), desdeCaptura?: string | null): Comparacao {
  const cab = efd.cabecalho!;
  const cnpj = cab.cnpj || cab.cpf;
  const ini = cab.dtIni; const fim = cab.dtFin;
  const noPeriodo = (d: string) => d >= ini && d <= fim;
  const div: Divergencia[] = [];
  const obs: string[] = [];

  const c100 = new Map(efd.c100.filter((d) => d.chave).map((d) => [d.chave, d]));
  const d100 = new Map(efd.d100.filter((d) => d.chave).map((d) => [d.chave, d]));
  const porChave = new Map(xmls.map((x) => [x.chave, x]));
  const desde = desdeCaptura !== undefined ? desdeCaptura : xmls.length ? xmls.map((x) => x.data).sort()[0] : null;
  const nomePart = (cod: string) => efd.participantes.get(cod)?.nome ?? '';

  // Entradas de NF-e (terceiros)
  const entradasXml = xmls.filter((x) => x.modelo === '55' && x.emit !== cnpj && x.dest === cnpj && noPeriodo(x.data));
  let entradasConferidas = 0;
  for (const x of entradasXml) {
    const d = c100.get(x.chave);
    if (!d) {
      if (outrasChaves.has(x.chave)) continue;
      if (x.situacao !== 'autorizada') continue; // cancelada/denegada não precisa ser escriturada como entrada
      div.push({ tipo: 'xml_sem_escrituracao', nivel: 'alerta', chave: x.chave, modelo: '55', numero: x.numero, data: x.data, participante: x.nomeEmit,
        valorXml: x.valor, valorSped: null, detalhe: 'NF-e de entrada com XML no Appura e sem C100 neste arquivo. Se a mercadoria entrou no mês seguinte, deve estar no SPED seguinte.' });
      continue;
    }
    entradasConferidas++;
    conferir(x, d.codSit, d.vlDoc, nomePart(d.codPart));
  }
  const entradasSped = efd.c100.filter((d) => d.indOper === '0' && d.indEmit === '1' && d.codMod === '55');
  for (const d of entradasSped) {
    if (!d.chave || porChave.has(d.chave) || CANC_SPED.has(d.codSit)) continue;
    const dentroCobertura = !!desde && d.dtDoc >= desde;
    div.push({ tipo: 'escriturada_sem_xml', nivel: dentroCobertura ? 'alerta' : 'info', chave: d.chave, modelo: d.codMod, numero: d.numero, data: d.dtDoc,
      participante: nomePart(d.codPart), valorXml: null, valorSped: d.vlDoc,
      detalhe: dentroCobertura ? 'Escriturada no SPED, mas o Appura não tem o XML (a SEFAZ não entregou ou a nota não é para este CNPJ). Confira a chave.'
        : 'Escriturada no SPED; o XML é de antes do início da captação no Appura.' });
  }

  // Saídas próprias (só se houver XML de saída no Appura)
  const saidasXml = xmls.filter((x) => (x.modelo === '55' || x.modelo === '65') && x.emit === cnpj && noPeriodo(x.data));
  const saidasSped = efd.c100.filter((d) => d.indEmit === '0' && (d.codMod === '55' || d.codMod === '65'));
  let saidasConferidas = 0;
  if (saidasXml.length) {
    for (const x of saidasXml) {
      const d = c100.get(x.chave);
      if (!d) {
        div.push({ tipo: 'saida_sem_escrituracao', nivel: 'erro', chave: x.chave, modelo: x.modelo, numero: x.numero, data: x.data, participante: '',
          valorXml: x.valor, valorSped: null, detalhe: `${MOD[x.modelo]} emitida pela empresa e ausente do SPED (inclusive canceladas devem constar com COD_SIT 02).` });
        continue;
      }
      saidasConferidas++;
      conferir(x, d.codSit, d.vlDoc, '');
    }
  } else if (saidasSped.length) {
    obs.push(`Saídas não comparadas: o SPED tem ${saidasSped.length} NF-e/NFC-e de emissão própria, mas o Appura não tem os XMLs de saída deste período. Importe os XMLs de saída (ou o ZIP do sistema da loja) para conferir.`);
  }

  // CT-e: só quando a empresa é a tomadora
  const cteTomador = xmls.filter((x) => x.modelo === '57' && x.toma === cnpj && noPeriodo(x.data));
  for (const x of cteTomador) {
    const d = d100.get(x.chave);
    if (!d) {
      if (outrasChaves.has(x.chave) || x.situacao !== 'autorizada') continue;
      div.push({ tipo: 'cte_sem_d100', nivel: 'alerta', chave: x.chave, modelo: '57', numero: x.numero, data: x.data, participante: x.nomeEmit,
        valorXml: x.valor, valorSped: null, detalhe: 'CT-e em que a empresa é tomadora e que não está no D100.' });
      continue;
    }
    conferir(x, d.codSit, d.vlDoc, nomePart(d.codPart));
  }
  const cteOutros = xmls.filter((x) => x.modelo === '57' && x.toma !== cnpj && noPeriodo(x.data)).length;
  if (cteOutros && !efd.d100.length) {
    obs.push(`${cteOutros} CT-e do período citam a empresa, mas ela não é a tomadora (frete pago pelo remetente): não precisam de D100.`);
  }

  function conferir(x: XmlDoc, codSit: string, vlSped: number, part: string) {
    const canceladaXml = x.situacao === 'cancelada' || x.situacao === 'denegada';
    const canceladaSped = CANC_SPED.has(codSit);
    if (canceladaXml !== canceladaSped) {
      div.push({ tipo: 'situacao', nivel: 'erro', chave: x.chave, modelo: x.modelo, numero: x.numero, data: x.data, participante: part || x.nomeEmit,
        valorXml: x.valor, valorSped: vlSped,
        detalhe: canceladaXml ? `O XML está ${x.situacao} na SEFAZ, mas o SPED escritura como regular (COD_SIT ${codSit}).` : `O SPED escritura como cancelada (COD_SIT ${codSit}), mas o XML está autorizado.` });
      return;
    }
    if (!canceladaXml && Math.abs(r2(x.valor - vlSped)) > 0.05) {
      div.push({ tipo: 'valor', nivel: 'alerta', chave: x.chave, modelo: x.modelo, numero: x.numero, data: x.data, participante: part || x.nomeEmit,
        valorXml: x.valor, valorSped: vlSped, detalhe: `Valor do documento no SPED difere do XML em ${Math.abs(r2(x.valor - vlSped)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.` });
    }
  }

  if (!desde) obs.push('O Appura ainda não tem XMLs desta empresa: a comparação fica disponível depois da primeira captação.');
  else if (desde > ini) obs.push(`A captação no Appura começa em ${desde.split('-').reverse().join('/')}: notas anteriores a essa data aparecem só como informação.`);

  const contagem = { xml_sem_escrituracao: 0, escriturada_sem_xml: 0, valor: 0, situacao: 0, cte_sem_d100: 0, saida_sem_escrituracao: 0 } as Record<TipoDivergencia, number>;
  for (const d of div) contagem[d.tipo]++;
  const ordem: Record<Nivel, number> = { erro: 0, alerta: 1, info: 2 };
  div.sort((a, b) => ordem[a.nivel] - ordem[b.nivel] || a.data.localeCompare(b.data));
  return {
    periodo: ini.slice(0, 7),
    cobertura: { desde, saidas: saidasXml.length > 0 },
    totais: {
      entradasXml: entradasXml.length, entradasSped: entradasSped.length, entradasConferidas,
      saidasXml: saidasXml.length, saidasSped: saidasSped.length, saidasConferidas,
      cteTomador: cteTomador.length, d100: efd.d100.length,
    },
    contagem,
    divergencias: div,
    observacoes: obs,
  };
}
