import { buscarTodos, Db, ok } from '../db';
import { Aba } from '../painel/xlsx';
import { calcularST, ItemST, NotaST, RegraST, ResultadoST, UF_DESTINO } from './st';

const COLUNAS_ITEM =
  'chave,n_item,x_prod,ncm,cest,cfop,orig,q_com,u_com,v_prod,v_desc,v_frete,v_seg,v_outro,v_ipi,v_icms,p_icms,v_icms_st';

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function lerRegrasST(db: Db): Promise<RegraST[]> {
  const linhas = await buscarTodos<any>(
    (de, ate) => db.from('st_es_regras').select('id,cest,ncm,descricao,mva,pmpf,aliquota_interna').order('id').range(de, ate),
    'ler tabela de ST',
  );
  return linhas.map((r) => ({ ...r, mva: num(r.mva), pmpf: num(r.pmpf), aliquota_interna: Number(r.aliquota_interna) }));
}

export interface RelatorioST extends ResultadoST {
  empresa: { cnpj: string; razao_social: string; uf: string };
  notasForaDoEstado: number;
  regrasCadastradas: number;
}

/** Carrega as entradas de outros estados do período e calcula o ST a recolher. */
export async function relatorioST(db: Db, empresaId: string, de: string, ate: string, ajustarMva: boolean): Promise<RelatorioST> {
  const empresa = ok(
    await db.from('empresas').select('cnpj,razao_social,uf').eq('id', empresaId).maybeSingle(),
    'ler empresa',
  ) as RelatorioST['empresa'] | null;
  if (!empresa) throw new Error('Empresa não encontrada.');

  const regras = await lerRegrasST(db);
  const vazio = { linhas: [], semRegra: [], jaRetidos: 0, total: 0 };
  if (empresa.uf !== UF_DESTINO) return { ...vazio, empresa, notasForaDoEstado: 0, regrasCadastradas: regras.length };

  const notas = await buscarTodos<NotaST>(
    (a, b) => db.from('documentos').select('chave,numero,serie,emitida_em,emit_cnpj,emit_nome,uf_emit')
      .eq('empresa_id', empresaId).eq('modelo', '55').eq('direcao', 'entrada').eq('situacao', 'autorizada').eq('completo', true)
      .neq('uf_emit', UF_DESTINO).not('uf_emit', 'is', null)
      .gte('emitida_em', de).lt('emitida_em', ate).order('emitida_em').range(a, b),
    'ler notas de fora do estado',
  );

  const itens: ItemST[] = [];
  const chaves = notas.map((x) => x.chave);
  for (let i = 0; i < chaves.length; i += 150) {
    const lote = chaves.slice(i, i + 150);
    const r = await buscarTodos<any>(
      (a, b) => db.from('documento_itens').select(COLUNAS_ITEM).eq('empresa_id', empresaId).in('chave', lote).range(a, b),
      'ler itens',
    );
    for (const it of r) {
      itens.push({
        ...it,
        orig: it.orig === null ? null : Number(it.orig),
        q_com: num(it.q_com), v_prod: Number(it.v_prod ?? 0), v_desc: num(it.v_desc), v_frete: num(it.v_frete), v_seg: num(it.v_seg),
        v_outro: num(it.v_outro), v_ipi: num(it.v_ipi), v_icms: num(it.v_icms), p_icms: num(it.p_icms), v_icms_st: num(it.v_icms_st),
      });
    }
  }

  return { ...calcularST(notas, itens, regras, ajustarMva), empresa, notasForaDoEstado: notas.length, regrasCadastradas: regras.length };
}

const cnpjFmt = (c: string | null) => (c ?? '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

/** Monta as abas da planilha. */
export function abasST(r: RelatorioST, mes: string, ajustarMva: boolean): Aba[] {
  const [a, m] = mes.split('-');
  const cab = [
    `ICMS-ST a recolher nas entradas de outros estados — ${m}/${a}`,
    `${r.empresa.razao_social} — CNPJ ${cnpjFmt(r.empresa.cnpj)}`,
    `Base ST = (mercadoria + frete + seguro + IPI + outras − desconto) × (1 + MVA${ajustarMva ? ' ajustada' : ''}), ou PMPF × quantidade. ` +
      'ICMS-ST = Base ST × alíquota interna − ICMS próprio (base da operação × alíquota interestadual).',
    `Total a recolher: R$ ${r.total.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
  ];

  const itens: Aba = {
    nome: 'ST por item',
    cabecalho: cab,
    colunas: [
      { titulo: 'Emissão', tipo: 'data', largura: 11 },
      { titulo: 'Nota', tipo: 'texto', largura: 9 },
      { titulo: 'Fornecedor', tipo: 'texto', largura: 30 },
      { titulo: 'UF', tipo: 'texto', largura: 5 },
      { titulo: 'Item', tipo: 'inteiro', largura: 6 },
      { titulo: 'Produto', tipo: 'texto', largura: 34 },
      { titulo: 'NCM', tipo: 'texto', largura: 10 },
      { titulo: 'CEST', tipo: 'texto', largura: 9 },
      { titulo: 'CFOP', tipo: 'texto', largura: 7 },
      { titulo: 'Qtde', tipo: 'numero', largura: 9 },
      { titulo: 'Valor mercadoria', tipo: 'moeda', total: true },
      { titulo: 'Frete + seguro + outras − desc.', tipo: 'moeda', total: true },
      { titulo: 'IPI', tipo: 'moeda', total: true },
      { titulo: 'Base da operação', tipo: 'moeda', total: true },
      { titulo: 'MVA %', tipo: 'pct', largura: 9 },
      { titulo: 'PMPF', tipo: 'moeda', largura: 10 },
      { titulo: 'Base ST', tipo: 'moeda', total: true },
      { titulo: 'Alíq. interna %', tipo: 'pct', largura: 9 },
      { titulo: 'ICMS-ST bruto', tipo: 'moeda', total: true },
      { titulo: 'Alíq. interestadual %', tipo: 'pct', largura: 10 },
      { titulo: 'ICMS próprio', tipo: 'moeda', total: true },
      { titulo: 'ICMS destacado na nota', tipo: 'moeda', total: true },
      { titulo: 'ICMS-ST a recolher', tipo: 'moeda', largura: 14, total: true },
      { titulo: 'Observação', tipo: 'texto', largura: 40 },
      { titulo: 'Chave de acesso', tipo: 'texto', largura: 46 },
    ],
    linhas: r.linhas.map((l) => {
      const outras = Math.round((Number(l.item.v_frete ?? 0) + Number(l.item.v_seg ?? 0) + Number(l.item.v_outro ?? 0) - Number(l.item.v_desc ?? 0)) * 100) / 100;
      const obs = [
        l.usouPmpf ? 'Base pelo PMPF × quantidade' : null,
        l.divergenciaIcms ? `ICMS destacado (${Number(l.item.v_icms).toFixed(2)}) difere do calculado a ${l.aliqInterestadual}%` : null,
        l.regra.descricao ? `Regra: ${l.regra.descricao}` : null,
      ].filter(Boolean).join('. ');
      return [
        l.nota.emitida_em, l.nota.numero, l.nota.emit_nome, l.nota.uf_emit, l.item.n_item, l.item.x_prod, l.item.ncm, l.item.cest, l.item.cfop,
        l.item.q_com, l.item.v_prod, outras, Number(l.item.v_ipi ?? 0), l.baseOperacao, l.mvaUsada, l.usouPmpf ? l.regra.pmpf : null,
        l.baseST, l.aliqInterna, Math.round(l.baseST * l.aliqInterna) / 100, l.aliqInterestadual, l.icmsProprio, Number(l.item.v_icms ?? 0),
        l.icmsST, obs, l.nota.chave,
      ];
    }),
  };

  // Resumo por nota
  const porNota = new Map<string, { l: (typeof r.linhas)[number]; base: number; st: number; itens: number }>();
  for (const l of r.linhas) {
    const x = porNota.get(l.nota.chave) ?? { l, base: 0, st: 0, itens: 0 };
    x.base += l.baseST;
    x.st += l.icmsST;
    x.itens++;
    porNota.set(l.nota.chave, x);
  }
  const notas: Aba = {
    nome: 'Resumo por nota',
    cabecalho: cab.slice(0, 2),
    colunas: [
      { titulo: 'Emissão', tipo: 'data', largura: 11 },
      { titulo: 'Nota', tipo: 'texto', largura: 9 },
      { titulo: 'Série', tipo: 'texto', largura: 6 },
      { titulo: 'Fornecedor', tipo: 'texto', largura: 34 },
      { titulo: 'CNPJ fornecedor', tipo: 'texto', largura: 19 },
      { titulo: 'UF', tipo: 'texto', largura: 5 },
      { titulo: 'Itens com ST', tipo: 'inteiro', largura: 9 },
      { titulo: 'Base ST', tipo: 'moeda', total: true },
      { titulo: 'ICMS-ST a recolher', tipo: 'moeda', largura: 14, total: true },
      { titulo: 'Chave de acesso', tipo: 'texto', largura: 46 },
    ],
    linhas: [...porNota.values()].map(({ l, base, st, itens: q }) => [
      l.nota.emitida_em, l.nota.numero, l.nota.serie, l.nota.emit_nome, cnpjFmt(l.nota.emit_cnpj), l.nota.uf_emit, q,
      Math.round(base * 100) / 100, Math.round(st * 100) / 100, l.nota.chave,
    ]),
  };

  const sem: Aba = {
    nome: 'Sem regra na tabela',
    cabecalho: [
      'Itens com CEST (indício de ST) que não têm MVA/PMPF na tabela de ST do ES',
      'Cadastre o CEST ou o NCM na tabela e gere a planilha de novo para incluí-los no cálculo.',
    ],
    colunas: [
      { titulo: 'Emissão', tipo: 'data', largura: 11 },
      { titulo: 'Nota', tipo: 'texto', largura: 9 },
      { titulo: 'Fornecedor', tipo: 'texto', largura: 30 },
      { titulo: 'UF', tipo: 'texto', largura: 5 },
      { titulo: 'Item', tipo: 'inteiro', largura: 6 },
      { titulo: 'Produto', tipo: 'texto', largura: 34 },
      { titulo: 'NCM', tipo: 'texto', largura: 10 },
      { titulo: 'CEST', tipo: 'texto', largura: 9 },
      { titulo: 'CFOP', tipo: 'texto', largura: 7 },
      { titulo: 'Valor mercadoria', tipo: 'moeda', total: true },
      { titulo: 'Chave de acesso', tipo: 'texto', largura: 46 },
    ],
    linhas: r.semRegra.map(({ nota, item }) => [
      nota.emitida_em, nota.numero, nota.emit_nome, nota.uf_emit, item.n_item, item.x_prod, item.ncm, item.cest, item.cfop, item.v_prod, nota.chave,
    ]),
  };

  return [itens, notas, sem];
}
