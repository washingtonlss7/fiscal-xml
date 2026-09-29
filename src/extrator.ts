import { Armazenamento } from './armazenamento';
import { Db, ok } from './db';
import { log } from './log';
import { acharTag, parser } from './sefaz/distDFe';
import { emParalelo } from './util';

/* Extração de cabeçalho, itens, tributos e duplicatas do XML completo (NF-e/NFC-e e CT-e). */

type Obj = Record<string, any>;
const lista = <T>(v: T | T[] | undefined): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const txt = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v));
const num = (v: unknown): number | null => {
  const t = txt(v);
  if (t === null) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};
/** Primeiro subgrupo de um grupo com filho variável (ex.: <ICMS><ICMS00>, <PIS><PISAliq>). */
const primeiroFilho = (g: Obj | undefined): Obj => {
  if (!g || typeof g !== 'object') return {};
  const k = Object.keys(g).find((x) => !x.startsWith('@_'));
  return k && typeof g[k] === 'object' ? g[k] : {};
};

export interface ItemExtraido {
  n_item: number;
  [coluna: string]: unknown;
}

export interface NotaExtraida {
  cabecalho: Record<string, unknown>;
  itens: ItemExtraido[];
  duplicatas: { n_dup: string; vencimento: string | null; valor: number | null }[];
}

function extrairItemNFe(det: Obj): ItemExtraido {
  const prod: Obj = det.prod ?? {};
  const imp: Obj = det.imposto ?? {};
  const icms = primeiroFilho(imp.ICMS);
  const ipiGrupo: Obj = imp.IPI ?? {};
  const ipi: Obj = ipiGrupo.IPITrib ?? ipiGrupo.IPINT ?? {};
  const pis = primeiroFilho(imp.PIS);
  const cofins = primeiroFilho(imp.COFINS);
  const ibscbs: Obj = imp.IBSCBS ?? {};
  const g: Obj = ibscbs.gIBSCBS ?? {};
  const csosn = icms.CSOSN !== undefined;

  return {
    n_item: int(det['@_nItem']) ?? 0,
    c_prod: txt(prod.cProd),
    ean: txt(prod.cEAN) === 'SEM GTIN' ? null : txt(prod.cEAN),
    x_prod: txt(prod.xProd),
    ncm: txt(prod.NCM),
    cest: txt(prod.CEST),
    cfop: txt(prod.CFOP),
    u_com: txt(prod.uCom),
    q_com: num(prod.qCom),
    v_un_com: num(prod.vUnCom),
    v_prod: num(prod.vProd),
    v_desc: num(prod.vDesc),
    v_frete: num(prod.vFrete),
    v_seg: num(prod.vSeg),
    v_outro: num(prod.vOutro),
    orig: int(icms.orig),
    cst_icms: txt(csosn ? icms.CSOSN : icms.CST),
    csosn,
    mod_bc: int(icms.modBC),
    p_red_bc: num(icms.pRedBC),
    v_bc_icms: num(icms.vBC),
    p_icms: num(icms.pICMS),
    v_icms: num(icms.vICMS),
    v_icms_deson: num(icms.vICMSDeson),
    v_bc_fcp: num(icms.vBCFCP),
    p_fcp: num(icms.pFCP),
    v_fcp: num(icms.vFCP),
    v_bc_st: num(icms.vBCST),
    p_mva_st: num(icms.pMVAST),
    p_icms_st: num(icms.pICMSST),
    v_icms_st: num(icms.vICMSST),
    v_fcp_st: num(icms.vFCPST),
    cst_ipi: txt(ipi.CST),
    v_bc_ipi: num(ipi.vBC),
    p_ipi: num(ipi.pIPI),
    v_ipi: num(ipi.vIPI),
    cst_pis: txt(pis.CST),
    v_bc_pis: num(pis.vBC),
    p_pis: num(pis.pPIS),
    v_pis: num(pis.vPIS),
    cst_cofins: txt(cofins.CST),
    v_bc_cofins: num(cofins.vBC),
    p_cofins: num(cofins.pCOFINS),
    v_cofins: num(cofins.vCOFINS),
    cst_ibscbs: txt(ibscbs.CST),
    c_class_trib: txt(ibscbs.cClassTrib),
    v_bc_ibscbs: num(g.vBC),
    p_ibs_uf: num(g.gIBSUF?.pIBSUF),
    v_ibs_uf: num(g.gIBSUF?.vIBSUF),
    p_ibs_mun: num(g.gIBSMun?.pIBSMun),
    v_ibs_mun: num(g.gIBSMun?.vIBSMun),
    v_ibs: num(g.vIBS),
    p_cbs: num(g.gCBS?.pCBS),
    v_cbs: num(g.gCBS?.vCBS),
  };
}

export function extrairNFe(xml: string): NotaExtraida {
  const o = parser.parse(xml);
  const inf: Obj = acharTag(o, 'infNFe');
  if (!inf) throw new Error('infNFe não encontrado');
  const ide: Obj = inf.ide ?? {};
  const emit: Obj = inf.emit ?? {};
  const dest: Obj = inf.dest ?? {};
  const tot: Obj = inf.total?.ICMSTot ?? {};
  const ibsTot: Obj = inf.total?.IBSCBSTot ?? {};
  const itens = lista<Obj>(inf.det).map(extrairItemNFe);

  const cfops = [...new Set(itens.map((i) => i.cfop).filter(Boolean))];
  return {
    cabecalho: {
      tp_nf: int(ide.tpNF),
      nat_op: txt(ide.natOp),
      fin_nfe: int(ide.finNFe),
      ind_final: int(ide.indFinal),
      crt_emit: int(emit.CRT),
      uf_emit: txt(emit.enderEmit?.UF),
      uf_dest: txt(dest.enderDest?.UF),
      cfop: cfops.length ? cfops.join(',').slice(0, 200) : null,
      v_prod: num(tot.vProd),
      v_desc: num(tot.vDesc),
      v_frete: num(tot.vFrete),
      v_seg: num(tot.vSeg),
      v_outro: num(tot.vOutro),
      v_bc_icms: num(tot.vBC),
      v_icms: num(tot.vICMS),
      v_icms_deson: num(tot.vICMSDeson),
      v_fcp: num(tot.vFCP),
      v_bc_st: num(tot.vBCST),
      v_st: num(tot.vST),
      v_fcp_st: num(tot.vFCPST),
      v_ipi: num(tot.vIPI),
      v_pis: num(tot.vPIS),
      v_cofins: num(tot.vCOFINS),
      v_bc_ibscbs: num(ibsTot.vBCIBSCBS),
      v_ibs: num(ibsTot.gIBS?.vIBS),
      v_cbs: num(ibsTot.gCBS?.vCBS),
    },
    itens,
    duplicatas: lista<Obj>(inf.cobr?.dup).map((d, i) => ({
      n_dup: txt(d.nDup) ?? String(i + 1).padStart(3, '0'),
      vencimento: txt(d.dVenc),
      valor: num(d.vDup),
    })),
  };
}

export function extrairCTe(xml: string): NotaExtraida {
  const o = parser.parse(xml);
  const inf: Obj = acharTag(o, 'infCte');
  if (!inf) throw new Error('infCte não encontrado');
  const ide: Obj = inf.ide ?? {};
  // Tomador: toma3 indica o papel (0 remetente, 1 expedidor, 2 recebedor, 3 destinatário); toma4 traz o CNPJ.
  const papeis: Record<string, Obj | undefined> = { '0': inf.rem, '1': inf.exped, '2': inf.receb, '3': inf.dest };
  const toma3 = ide.toma3 ?? ide.toma;
  const tomador: Obj | undefined = ide.toma4 ?? (toma3 ? papeis[String(toma3.toma)] : undefined);
  const icms = primeiroFilho(inf.imp?.ICMS);
  const ibs: Obj = inf.imp?.IBSCBS?.gIBSCBS ?? {};
  return {
    cabecalho: {
      cfop: txt(ide.CFOP),
      nat_op: txt(ide.natOp),
      uf_ini: txt(ide.UFIni),
      uf_fim: txt(ide.UFFim),
      uf_emit: txt(inf.emit?.enderEmit?.UF),
      toma_doc: txt(tomador?.CNPJ) ?? txt(tomador?.CPF),
      v_prod: num(inf.vPrest?.vTPrest),
      v_bc_icms: num(icms.vBC),
      v_icms: num(icms.vICMS),
      v_bc_ibscbs: num(ibs.vBC),
      v_ibs: num(ibs.vIBS),
      v_cbs: num(ibs.gCBS?.vCBS),
    },
    itens: [],
    duplicatas: [],
  };
}

/** Grava o resultado da extração para uma nota (substitui itens e duplicatas anteriores). */
export async function gravarExtracao(db: Db, empresaId: string, chave: string, modelo: string, xml: string): Promise<void> {
  const r = modelo === '57' ? extrairCTe(xml) : extrairNFe(xml);

  ok(await db.from('documento_itens').delete().eq('empresa_id', empresaId).eq('chave', chave), 'limpar itens');
  ok(await db.from('documento_duplicatas').delete().eq('empresa_id', empresaId).eq('chave', chave), 'limpar duplicatas');
  if (r.itens.length) {
    for (let i = 0; i < r.itens.length; i += 500) {
      ok(
        await db.from('documento_itens').insert(r.itens.slice(i, i + 500).map((it) => ({ empresa_id: empresaId, chave, ...it }))),
        'gravar itens',
      );
    }
  }
  if (r.duplicatas.length) {
    // nDup pode se repetir em notas mal emitidas; mantém a última ocorrência.
    const unicas = [...new Map(r.duplicatas.map((d) => [d.n_dup, d])).values()];
    ok(
      await db.from('documento_duplicatas').insert(unicas.map((d) => ({ empresa_id: empresaId, chave, ...d }))),
      'gravar duplicatas',
    );
  }
  ok(
    await db
      .from('documentos')
      .update({ ...r.cabecalho, itens_extraidos: true, extracao_erro: null })
      .eq('empresa_id', empresaId)
      .eq('chave', chave),
    'atualizar documento',
  );
}

/**
 * Extrai notas completas que ainda não foram detalhadas (histórico ou falhas anteriores),
 * lendo o XML do Storage. Roda em segundo plano no coletor.
 */
export async function extrairPendentes(db: Db, arm: Armazenamento, limite = 100): Promise<number> {
  const pendentes = ok(
    await db
      .from('documentos')
      .select('empresa_id,chave,modelo,xml_path')
      .eq('completo', true)
      .eq('itens_extraidos', false)
      .is('extracao_erro', null)
      .not('xml_path', 'is', null)
      .order('capturado_em')
      .limit(limite),
    'listar notas para extrair',
  ) as { empresa_id: string; chave: string; modelo: string; xml_path: string }[];

  let feitos = 0;
  await emParalelo(pendentes, 5, async (d) => {
    try {
      const xml = (await arm.ler(d.xml_path)).toString('utf8');
      await gravarExtracao(db, d.empresa_id, d.chave, d.modelo, xml);
      feitos++;
    } catch (e) {
      const msg = (e as Error).message.slice(0, 500);
      log.warn('falha ao extrair nota', { chave: d.chave, erro: msg });
      await db.from('documentos').update({ extracao_erro: msg }).eq('empresa_id', d.empresa_id).eq('chave', d.chave);
    }
  });
  return feitos;
}
