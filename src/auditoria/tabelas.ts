/**
 * Tabelas de referência da auditoria. São listas-base: o escritório deve revisá-las
 * conforme a atividade dos clientes e a legislação vigente.
 */

/** CFOPs de operações com substituição tributária do ICMS (saída do emitente). */
export const CFOP_ST = new Set([
  '5401', '5402', '5403', '5405', '5408', '5409', '5410', '5411', '5412', '5413', '5414', '5415',
  '6401', '6402', '6403', '6404', '6408', '6409', '6410', '6411', '6412', '6413', '6414', '6415',
]);

/** CFOPs de venda comum (sem ST), usados para detectar CST de ST em operação comum. */
export const CFOP_VENDA_COMUM = new Set([
  '5101', '5102', '5103', '5104', '5105', '5106', '6101', '6102', '6103', '6104', '6105', '6106', '6107', '6108',
]);

/** CST (regime normal) e CSOSN (Simples) compatíveis com ST (retida ou já recolhida). */
export const CST_COM_ST = new Set(['10', '30', '60', '70', '90']);
export const CSOSN_COM_ST = new Set(['201', '202', '203', '500', '900']);

/** CST de PIS/COFINS que indicam tributação monofásica/alíquota zero na revenda. */
export const CST_PIS_MONOFASICO_REVENDA = new Set(['04', '06']);

export interface ReferenciaMonofasico {
  prefixo: string;
  exceto?: string[];
  grupo: string;
  base: string;
}

/**
 * Produtos com PIS/COFINS monofásico (concentrado no fabricante/importador).
 * Lista-base por prefixo de NCM. Autopeças (Lei 10.485/2002, anexos) e combustíveis ainda não estão incluídos.
 */
export const NCM_MONOFASICO: ReferenciaMonofasico[] = [
  { prefixo: '3001', grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '3003', exceto: ['30039056'], grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '3004', exceto: ['30049046'], grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '3002101', grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '3002102', grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '3002103', grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '3002201', grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '3002202', grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '30029020', grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '30029092', grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '30029099', grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '30051010', grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '3006301', grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '3006302', grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '30066000', grupo: 'Farmacêuticos', base: 'Lei 10.147/2000, art. 1º, I' },
  { prefixo: '3303', grupo: 'Perfumaria e higiene', base: 'Lei 10.147/2000, art. 1º, II' },
  { prefixo: '3304', grupo: 'Perfumaria e higiene', base: 'Lei 10.147/2000, art. 1º, II' },
  { prefixo: '3305', grupo: 'Perfumaria e higiene', base: 'Lei 10.147/2000, art. 1º, II' },
  { prefixo: '3306', grupo: 'Perfumaria e higiene', base: 'Lei 10.147/2000, art. 1º, II' },
  { prefixo: '3307', grupo: 'Perfumaria e higiene', base: 'Lei 10.147/2000, art. 1º, II' },
  { prefixo: '34011190', grupo: 'Perfumaria e higiene', base: 'Lei 10.147/2000, art. 1º, II' },
  { prefixo: '34012010', grupo: 'Perfumaria e higiene', base: 'Lei 10.147/2000, art. 1º, II' },
  { prefixo: '96032100', grupo: 'Perfumaria e higiene', base: 'Lei 10.147/2000, art. 1º, II' },
  { prefixo: '2201', grupo: 'Bebidas frias', base: 'Lei 13.097/2015' },
  { prefixo: '2202', grupo: 'Bebidas frias', base: 'Lei 13.097/2015' },
  { prefixo: '2203', grupo: 'Bebidas frias', base: 'Lei 13.097/2015' },
  { prefixo: '4011', grupo: 'Pneus', base: 'Lei 10.485/2002, art. 5º' },
  { prefixo: '4013', grupo: 'Câmaras de ar', base: 'Lei 10.485/2002, art. 5º' },
];

export function monofasico(ncm: string | null | undefined): ReferenciaMonofasico | null {
  if (!ncm) return null;
  for (const r of NCM_MONOFASICO) {
    if (ncm.startsWith(r.prefixo) && !(r.exceto ?? []).some((e) => ncm.startsWith(e))) return r;
  }
  return null;
}

/**
 * CFOP de entrada sugerido a partir do CFOP de saída do fornecedor, para uma empresa comercial
 * que compra para revenda. Retorna null quando a operação exige decisão do contador
 * (ex.: uso e consumo, ativo imobilizado, industrialização).
 */
export function cfopEntrada(cfopSaida: string | null | undefined): string | null {
  if (!cfopSaida || !/^[567]\d{3}$/.test(cfopSaida)) return null;
  const prefixo = { '5': '1', '6': '2', '7': '3' }[cfopSaida[0]]!;
  const resto = cfopSaida.slice(1);
  const mapa: Record<string, string> = {
    // Vendas → compra para comercialização
    '101': '102', '102': '102', '103': '102', '104': '102', '105': '102', '106': '102', '107': '102', '108': '102',
    // Vendas com ST → compra para comercialização com ST
    '401': '403', '402': '403', '403': '403', '404': '403', '405': '403',
    // Transferências
    '151': '152', '152': '152', '409': '409',
    // Bonificação, amostra, brinde
    '910': '910', '911': '911',
    // Remessas e retornos simples
    '915': '915', '916': '916', '949': '949', '923': '923', '924': '924',
    // Conhecimento de transporte
    '351': '351', '352': '352', '353': '353', '354': '354', '355': '355', '356': '356', '357': '357', '359': '359', '360': '360',
  };
  const r = mapa[resto];
  return r ? `${prefixo}${r}` : null;
}
