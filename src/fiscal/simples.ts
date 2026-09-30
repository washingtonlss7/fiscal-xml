/**
 * Apuração do Simples Nacional, etapa B: segregação da receita do mês a partir das notas de saída.
 * Funções puras (sem banco): recebem as notas e os itens e devolvem a receita por atividade e
 * qualificação, no formato do PGDAS-D, mais os alertas para o analista.
 *
 * O Appura NÃO calcula o imposto: isso fica com a Receita (simulação do PGDAS-D, etapa C).
 * Desenho completo em docs/apuracao-simples.md.
 */
import { monofasico } from '../auditoria/tabelas';

/* ---------- tabelas (listas-base, revisáveis pelo escritório) ---------- */

/** CFOPs de saída que são RECEITA (venda de mercadoria). O resto fica fora e aparece no quadro "Fora da receita". */
const CFOP_VENDA = new Set([
  // Venda de produção própria e revenda (5.101 a 5.125)
  ...['101', '102', '103', '104', '105', '106', '107', '108', '109', '110', '111', '112', '113', '114', '115', '116', '117', '118', '119', '120', '122', '123', '124', '125'],
  // Venda com ST (substituto e substituído)
  '401', '402', '403', '405',
  // Combustíveis
  '651', '652', '653', '654', '655', '656', '667',
]);
const CFOP_VENDA_EXPORTACAO = new Set(['7101', '7102', '7105', '7106', '7127', '7651', '7654', '7667']);

/** CFOPs de saída conhecidos que NÃO são receita (com o motivo para o quadro). */
const CFOP_FORA: [RegExp, string][] = [
  [/^[56]15[1-6]$|^[56]40[89]$|^[56]55[27]$|^[56]65[89]$/, 'Transferência entre estabelecimentos'],
  [/^[56]20[1-9]$|^[56]21\d$|^[56]41[0-3]$|^[56]50[3]$|^[56]55[3-6]$|^[56]66[0-2]$/, 'Devolução de compra'],
  [/^[56]9(0\d|1\d|2[0-4])$/, 'Remessa / retorno (consignação, conserto, demonstração, bonificação, brinde…)'],
  [/^[56]9(49)$/, 'Outra saída não especificada (5.949)'],
  [/^[56]92[5-9]$|^[56]93[0-2]$/, 'Outras saídas (lançamentos especiais)'],
  [/^[56]933$/, 'Prestação de serviço com ISS (não é revenda)'],
  [/^[56]55[01]$/, 'Venda de ativo imobilizado'],
  [/^[56]557$/, 'Transferência de material de uso e consumo'],
];

/** Devolução de venda: CFOP de quem devolve (NF-e do cliente) e CFOP de entrada da própria empresa. */
const CFOP_DEVOL_CLIENTE = new Set(['5202', '6202', '5411', '6411', '5201', '6201', '5410', '6410']);
const CFOP_DEVOL_PROPRIA = new Set(['1201', '1202', '2201', '2202', '1410', '1411', '2410', '2411']);
const CFOP_ST_VENDA = new Set(['5405', '6404', '5403', '6403', '5401', '6401', '5402', '6402']);

const CSOSN_ST_SUBSTITUIDO = new Set(['500']);
const CST_ST_SUBSTITUIDO = new Set(['60']);
const CSOSN_SUBSTITUTO = new Set(['201', '202', '203']);
const CST_PIS_TRIBUTADO = new Set(['01', '02', '03']);

/* ---------- tipos ---------- */

export interface ItemSaida {
  n_item: number; cfop: string | null; ncm: string | null; cest: string | null; ean: string | null; x_prod: string | null;
  cst_icms: string | null; csosn: boolean; cst_pis: string | null;
  v_prod: number | null; v_desc: number | null; v_frete: number | null; v_seg: number | null; v_outro: number | null;
}
export interface NotaSaida {
  chave: string; modelo: string; serie: string | null; numero: string | null; situacao: string; completo: boolean;
  tp_nf: number | null; fin_nfe: number | null; emit_cnpj: string | null; valor: number | null;
  itens: ItemSaida[];
}
export interface AjusteReceita { id?: number; valor: number; atividade: 1 | 2 | 3; st: boolean; monofasico: boolean; justificativa: string; por?: string; em?: string }

export interface ContextoApuracao {
  /** CNPJ do estabelecimento (para separar o que ele emitiu do que recebeu). */
  cnpj: string;
  /** Produto na tabela de ST do ES (por CEST/NCM). */
  naTabelaSt: (item: { ncm: string | null; cest: string | null }) => boolean;
  /** Produto comprado com ICMS-ST nos últimos meses (por EAN ou NCM). */
  compradoComSt: (item: { ncm: string | null; ean: string | null }) => boolean;
}

export type ChaveGrupo = 'a1' | 'a2_st' | 'a2_mono' | 'a2_st_mono' | 'a3';
export const GRUPOS: Record<ChaveGrupo, { atividade: 1 | 2 | 3; st: boolean; monofasico: boolean; titulo: string }> = {
  a1: { atividade: 1, st: false, monofasico: false, titulo: 'Revenda tributada normalmente' },
  a2_st: { atividade: 2, st: true, monofasico: false, titulo: 'Revenda com ICMS-ST' },
  a2_mono: { atividade: 2, st: false, monofasico: true, titulo: 'Revenda com PIS/COFINS monofásico' },
  a2_st_mono: { atividade: 2, st: true, monofasico: true, titulo: 'Revenda com ICMS-ST e PIS/COFINS monofásico' },
  a3: { atividade: 3, st: false, monofasico: false, titulo: 'Revenda para exportação' },
};

export interface Exemplo { chave: string; numero: string | null; n_item?: number; produto?: string | null; ncm?: string | null; cfop?: string | null; valor: number }
export interface Alerta { tipo: string; nivel: 'erro' | 'alerta' | 'info'; titulo: string; detalhe: string; quantidade: number; valor: number; exemplos: Exemplo[] }
export interface Grupo {
  chave: ChaveGrupo; atividade: 1 | 2 | 3; st: boolean; monofasico: boolean; titulo: string;
  vendas: number; devolucoes: number; ajustes: number; valor: number; itens: number;
  ncms: { ncm: string; produto: string | null; valor: number }[];
}
export interface ResultadoEstabelecimento {
  cnpj: string; receita: number; grupos: Grupo[];
  fora: { motivo: string; cfops: string[]; notas: number; valor: number }[];
  notas: { saida: number; canceladas: number; soResumo: number; devolucao: number };
  alertas: Alerta[];
}

/* ---------- utilitários ---------- */

const c2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (v === null || v === undefined || v === '' ? 0 : Number(v) || 0);
export const valorItem = (i: Pick<ItemSaida, 'v_prod' | 'v_desc' | 'v_frete' | 'v_seg' | 'v_outro'>) =>
  c2(num(i.v_prod) - num(i.v_desc) + num(i.v_frete) + num(i.v_seg) + num(i.v_outro));

/** Tipo do CFOP de saída para a apuração. */
export function tipoCfop(cfop: string | null): { tipo: 'venda' | 'exportacao' | 'fora' | 'desconhecido'; motivo?: string } {
  const c = String(cfop ?? '');
  if (!/^[5-7]\d{3}$/.test(c)) return { tipo: 'desconhecido' };
  if (c[0] === '7') return CFOP_VENDA_EXPORTACAO.has(c) ? { tipo: 'exportacao' } : { tipo: 'fora', motivo: 'Outras saídas para o exterior' };
  if (CFOP_VENDA.has(c.slice(1))) return { tipo: 'venda' };
  for (const [re, motivo] of CFOP_FORA) if (re.test(c)) return { tipo: 'fora', motivo };
  return { tipo: 'desconhecido' };
}

/** Qualificação do item vendido: ICMS-ST (substituído) e PIS/COFINS monofásico (pelo NCM). */
export function qualificar(i: Pick<ItemSaida, 'cst_icms' | 'csosn' | 'ncm'>): { st: boolean; monofasico: boolean; substituto: boolean } {
  const cst = String(i.cst_icms ?? '');
  const st = i.csosn || cst.length === 3 ? CSOSN_ST_SUBSTITUIDO.has(cst) : CST_ST_SUBSTITUIDO.has(cst);
  return { st, monofasico: !!monofasico(i.ncm), substituto: CSOSN_SUBSTITUTO.has(cst) || cst === '10' || cst === '30' || cst === '70' };
}

export const chaveGrupo = (atividade: 1 | 2 | 3, st: boolean, mono: boolean): ChaveGrupo =>
  atividade === 3 ? 'a3' : st && mono ? 'a2_st_mono' : st ? 'a2_st' : mono ? 'a2_mono' : 'a1';

/** Números que faltam na sequência de cada modelo/série emitida pela empresa. */
export function lacunasNumeracao(notas: Pick<NotaSaida, 'modelo' | 'serie' | 'numero'>[]): { modelo: string; serie: string; de: number; ate: number; faltam: number; exemplos: number[] }[] {
  const porSerie = new Map<string, number[]>();
  for (const n of notas) {
    const x = Number(n.numero);
    if (!Number.isInteger(x) || x <= 0) continue;
    const k = `${n.modelo}|${n.serie ?? '0'}`;
    (porSerie.get(k) ?? porSerie.set(k, []).get(k)!).push(x);
  }
  const r = [];
  for (const [k, l] of porSerie) {
    const s = [...new Set(l)].sort((a, b) => a - b);
    const faltando: number[] = [];
    let total = 0;
    for (let i = 1; i < s.length; i++) {
      const gap = s[i] - s[i - 1] - 1;
      if (gap <= 0) continue;
      total += gap;
      for (let x = s[i - 1] + 1; x < s[i] && faltando.length < 10; x++) faltando.push(x);
    }
    const [modelo, serie] = k.split('|');
    if (total) r.push({ modelo, serie, de: s[0], ate: s[s.length - 1], faltam: total, exemplos: faltando });
  }
  return r;
}

/* ---------- apuração de um estabelecimento ---------- */

export function apurarEstabelecimento(notas: NotaSaida[], devolucoesTerceiros: NotaSaida[], ajustes: AjusteReceita[], ctx: ContextoApuracao): ResultadoEstabelecimento {
  const grupos = new Map<ChaveGrupo, Grupo & { _ncm: Map<string, { produto: string | null; valor: number }> }>();
  const grupo = (k: ChaveGrupo) => {
    let g = grupos.get(k);
    if (!g) { g = { chave: k, ...GRUPOS[k], vendas: 0, devolucoes: 0, ajustes: 0, valor: 0, itens: 0, ncms: [], _ncm: new Map() }; grupos.set(k, g); }
    return g;
  };
  const fora = new Map<string, { motivo: string; cfops: Set<string>; notas: Set<string>; valor: number }>();
  const alertas = new Map<string, Alerta>();
  const alerta = (tipo: string, nivel: Alerta['nivel'], titulo: string, detalhe: string, ex?: Exemplo) => {
    let a = alertas.get(tipo);
    if (!a) { a = { tipo, nivel, titulo, detalhe, quantidade: 0, valor: 0, exemplos: [] }; alertas.set(tipo, a); }
    a.quantidade++;
    if (ex) { a.valor = c2(a.valor + ex.valor); if (a.exemplos.length < 10) a.exemplos.push(ex); }
    return a;
  };
  const cont = { saida: 0, canceladas: 0, soResumo: 0, devolucao: 0 };

  const somarNcm = (g: ReturnType<typeof grupo>, i: ItemSaida, v: number) => {
    const k = i.ncm || 'sem NCM';
    const x = g._ncm.get(k) ?? { produto: i.x_prod, valor: 0 };
    x.valor += v; g._ncm.set(k, x);
  };

  // Notas emitidas pelo próprio estabelecimento
  const emitidasSaida: NotaSaida[] = [];
  const numeradas: NotaSaida[] = [];
  for (const n of notas) {
    const propria = n.emit_cnpj === ctx.cnpj;
    // Cancelada/denegada usa o número: conta na sequência, mas não é receita
    if (propria && n.tp_nf !== 0) numeradas.push(n);
    if (n.situacao !== 'autorizada') { if (propria) cont.canceladas++; continue; }
    if (!propria) continue;
    if (n.tp_nf === 0) {
      // Entrada emitida pela própria empresa: devolução de venda (CFOP 1.202, 2.202, 1.411…)
      const dev = n.itens.filter((i) => CFOP_DEVOL_PROPRIA.has(String(i.cfop)));
      if (dev.length) { cont.devolucao++; deduzir(n, dev); }
      continue;
    }
    cont.saida++;
    emitidasSaida.push(n);
    if (!n.completo || !n.itens.length) {
      cont.soResumo++;
      const v = c2(num(n.valor));
      const g = grupo('a1'); g.vendas = c2(g.vendas + v);
      alerta('so_resumo', 'alerta', 'Notas sem itens (só o resumo)', 'Entraram como revenda tributada pelo valor total, porque sem os itens não dá para separar ST e monofásico. Importe o XML completo.', { chave: n.chave, numero: n.numero, valor: v });
      continue;
    }
    for (const i of n.itens) {
      const v = valorItem(i);
      const t = tipoCfop(i.cfop);
      const ex: Exemplo = { chave: n.chave, numero: n.numero, n_item: i.n_item, produto: i.x_prod, ncm: i.ncm, cfop: i.cfop, valor: v };
      if (t.tipo === 'fora' || t.tipo === 'desconhecido') {
        const motivo = t.tipo === 'fora' ? t.motivo! : 'CFOP sem classificação';
        const f = fora.get(motivo) ?? { motivo, cfops: new Set(), notas: new Set(), valor: 0 };
        f.cfops.add(String(i.cfop ?? '—')); f.notas.add(n.chave); f.valor += v; fora.set(motivo, f);
        if (t.tipo === 'desconhecido') alerta('cfop_desconhecido', 'alerta', 'CFOP fora da tabela de receita', 'Ficou FORA da receita. Se for venda, lance um ajuste com a justificativa (ou peça para incluir o CFOP na tabela).', ex);
        continue;
      }
      const q = qualificar(i);
      const atividade = t.tipo === 'exportacao' ? 3 : q.st || q.monofasico ? 2 : 1;
      const g = grupo(chaveGrupo(atividade, q.st, q.monofasico));
      g.vendas = c2(g.vendas + v); g.itens++; somarNcm(g, i, v);
      if (!i.ncm) alerta('sem_ncm', 'alerta', 'Itens sem NCM', 'Sem NCM não dá para saber se é monofásico: entraram como tributados.', ex);
      if (atividade !== 3 && !q.st) {
        if (q.substituto) alerta('substituto', 'info', 'Venda como substituto tributário (CSOSN 201/202/203)', 'O ICMS próprio segue no DAS; o ICMS-ST retido é recolhido fora (DUA/GNRE). Confira se a empresa é mesmo substituta.', ex);
        else if (CFOP_ST_VENDA.has(String(i.cfop))) alerta('cfop_st_sem_csosn', 'alerta', 'CFOP de venda com ST, mas CSOSN de tributado', 'O CFOP (5.405/6.404…) diz que a mercadoria já teve ST, mas o CSOSN diz tributado. Na dúvida, entrou como tributado (pagando ICMS no DAS).', ex);
        else if (ctx.naTabelaSt(i) || ctx.compradoComSt(i)) alerta('st_nao_aplicada', 'alerta', 'Possível ICMS-ST não aplicado', `Vendido como tributado, mas o produto ${ctx.compradoComSt(i) ? 'foi comprado com ST' : 'está na tabela de ST do ES'}. Se a ST já foi paga na compra, o ICMS está sendo pago de novo no DAS.`, ex);
      }
      if (q.monofasico && i.cst_pis && CST_PIS_TRIBUTADO.has(i.cst_pis)) alerta('mono_cst_tributado', 'info', 'Monofásico pelo NCM, CST de PIS de tributado', 'Entrou como monofásico (pelo NCM). O CST de PIS da nota diz tributado: vale corrigir o cadastro do produto no sistema de vendas.', ex);
    }
  }

  // Devoluções de venda (o cliente emitiu a NF-e de devolução para a empresa)
  for (const n of devolucoesTerceiros) {
    if (n.situacao !== 'autorizada' || n.emit_cnpj === ctx.cnpj) continue;
    const dev = n.itens.filter((i) => CFOP_DEVOL_CLIENTE.has(String(i.cfop)));
    if (dev.length) { cont.devolucao++; deduzir(n, dev); }
  }

  function deduzir(n: NotaSaida, itens: ItemSaida[]) {
    for (const i of itens) {
      const v = valorItem(i);
      const c = String(i.cfop);
      // Na devolução, a ST vem do CFOP (5.411/6.411, 1.411/2.411) ou do CST/CSOSN de ST
      const st = /^[1256]41[01]$/.test(c) || ['500', '60', '10', '30', '70', '201', '202', '203'].includes(String(i.cst_icms ?? ''));
      const mono = !!monofasico(i.ncm);
      const g = grupo(chaveGrupo(st || mono ? 2 : 1, st, mono));
      g.devolucoes = c2(g.devolucoes + v);
      alerta('devolucoes', 'info', 'Devoluções de venda deduzidas', 'Deduzidas da receita deste mês, no mesmo grupo do produto devolvido.', { chave: n.chave, numero: n.numero, n_item: i.n_item, produto: i.x_prod, ncm: i.ncm, cfop: i.cfop, valor: v });
    }
  }

  for (const a of ajustes) {
    const g = grupo(chaveGrupo(a.atividade, a.atividade === 2 && a.st, a.atividade === 2 && a.monofasico));
    g.ajustes = c2(g.ajustes + num(a.valor));
  }

  for (const l of lacunasNumeracao(numeradas)) {
    const a = alerta('numeracao', 'alerta', 'Falta nota na sequência', 'Pode ser nota que não foi importada (receita faltando) ou número inutilizado. Confira no sistema de vendas.');
    a.quantidade += l.faltam - 1;
    a.exemplos.push({ chave: '', numero: `${l.modelo === '65' ? 'NFC-e' : 'NF-e'} série ${l.serie}: faltam ${l.faltam} entre ${l.de} e ${l.ate} (ex.: ${l.exemplos.join(', ')})`, valor: 0 });
  }
  if (!cont.saida) alerta('sem_notas', 'erro', 'Nenhuma nota de saída no mês', 'Sem as notas de venda (NFC-e/NF-e) não há o que apurar. Importe os XMLs do mês ou aguarde a integração com a Sieg/Jettax.');

  const lista = [...grupos.values()].map(({ _ncm, ...g }) => ({
    ...g, valor: c2(g.vendas - g.devolucoes + g.ajustes),
    ncms: [..._ncm.entries()].map(([ncm, x]) => ({ ncm, produto: x.produto, valor: c2(x.valor) })).sort((a, b) => b.valor - a.valor).slice(0, 5),
  })).sort((a, b) => Object.keys(GRUPOS).indexOf(a.chave) - Object.keys(GRUPOS).indexOf(b.chave));
  for (const g of lista) {
    if (g.valor < 0) alerta('grupo_negativo', 'erro', 'Grupo com receita negativa', `"${g.titulo}" ficou negativo (devoluções maiores que as vendas do mês). O PGDAS-D não aceita valor negativo: confira as devoluções e os ajustes.`);
  }
  const ordem = { erro: 0, alerta: 1, info: 2 };
  return {
    cnpj: ctx.cnpj,
    receita: c2(lista.reduce((t, g) => t + g.valor, 0)),
    grupos: lista,
    fora: [...fora.values()].map((f) => ({ motivo: f.motivo, cfops: [...f.cfops].sort(), notas: f.notas.size, valor: c2(f.valor) })).sort((a, b) => b.valor - a.valor),
    notas: cont,
    alertas: [...alertas.values()].sort((a, b) => ordem[a.nivel] - ordem[b.nivel] || b.valor - a.valor),
  };
}

/* ---------- declaração (formato do PGDAS-D) ---------- */

/** Monta o corpo `declaracao` do TRANSDECLARACAO11 a partir das apurações dos estabelecimentos. */
export function montarDeclaracao(estabs: ResultadoEstabelecimento[]) {
  const receitaInterna = c2(estabs.reduce((t, e) => t + e.grupos.filter((g) => g.atividade !== 3).reduce((s, g) => s + g.valor, 0), 0));
  const receitaExterna = c2(estabs.reduce((t, e) => t + e.grupos.filter((g) => g.atividade === 3).reduce((s, g) => s + g.valor, 0), 0));
  return {
    tipoDeclaracao: 1,
    receitaPaCompetenciaInterno: receitaInterna,
    receitaPaCompetenciaExterno: receitaExterna,
    estabelecimentos: estabs.map((e) => {
      const porAtividade = new Map<number, Grupo[]>();
      for (const g of e.grupos) if (g.valor > 0) (porAtividade.get(g.atividade) ?? porAtividade.set(g.atividade, []).get(g.atividade)!).push(g);
      const atividades = [...porAtividade.entries()].map(([idAtividade, gs]) => ({
        idAtividade,
        valorAtividade: c2(gs.reduce((t, g) => t + g.valor, 0)),
        receitasAtividade: gs.map((g) => ({
          valor: g.valor,
          ...(idAtividade === 2 ? {
            qualificacoesTributarias: [
              ...(g.st ? [{ codigoTributo: 1007, id: 8 }] : []),
              ...(g.monofasico ? [{ codigoTributo: 1004, id: 9 }, { codigoTributo: 1005, id: 9 }] : []),
            ],
          } : {}),
        })),
      }));
      return { cnpjCompleto: e.cnpj, ...(atividades.length ? { atividades } : {}) };
    }),
  };
}
