/**
 * Gerador da EFD-Contribuições (PIS/COFINS) — Lucro Real, regime NÃO cumulativo, varejo (matriz + filiais).
 * Especificação: docs/sped/gerador-contrib-spec.md.
 *
 * Saídas: NF-e 55 de venda (C100 + C170) e NFC-e (C100 + C175, agrupado por CFOP + CST + alíquota).
 * Entradas: NF-e 55 de compra para revenda e devolução de venda (C170 com CST do adquirente: 50 com crédito,
 * 70/98 sem crédito). Frete: CT-e tomado (D100/D101/D105). Apuração: M100/M105, M200/M205/M210, M400/M410 e
 * espelhos da COFINS; saldos de créditos (1100/1500) a partir do SPED anterior.
 */
import { monofasico } from '../../auditoria/tabelas';
import { AnteriorContrib, SaldoCredito } from './anterior';
import { Arquivo, c, d8, dataLocal, dig, n, nc, Pendencias, t, ultimoDiaMes } from './escrita';
import { cfopEntradaItem, normUnid } from './icms';
import { DocFiscal, Estabelecimento, ItemDoc, ResultadoGeracao } from './tipos';
import type { ParticipanteXml } from './xml';

export const ALIQ_PIS = 1.65;
export const ALIQ_COFINS = 7.6;
const serie3 = (s: string | null) => String(Number(s ?? '0') || 0).padStart(3, '0');
const cfopVenda = (cfop: string) => /^[567]1[0-2]\d$/.test(cfop) || /^[567]40[1235]$/.test(cfop) || /^[567]65[1-6]$|^[567]667$/.test(cfop);
const CFOP_CREDITO_ENTRADA = /^[12](102|101|403|401|117|118|121|122|201|202|410|411)$/;
const natBcCred = (cfop: string) => (/^[12](201|202|410|411)$/.test(cfop) ? '12' : /^[12](101|401)$/.test(cfop) ? '02' : '01');
const devolucaoVenda = (cfop: string) => /^[12](201|202|410|411)$/.test(cfop);
const pct = (base: number, aliq: number) => Math.round((base * aliq) / 100); // base em centavos → valor em centavos

/** NAT_REC (Tabela 4.3.10) da revenda monofásica pelo NCM. CONFERIR contra o arquivo oficial da tabela. */
export function natRecMonofasico(ncm: string | null): string | null {
  const ref = monofasico(ncm);
  if (!ref) return null;
  if (ref.grupo === 'Farmacêuticos') return '201';
  if (ref.grupo === 'Perfumaria e higiene') return '202';
  return null;
}

export interface OpcoesContrib {
  competencia: string;
  anterior: AnteriorContrib | null;
  /** Exclui o ICMS destacado da base das receitas (RE 574.706). Padrão: sim. */
  excluirIcmsReceita?: boolean;
  /** Ordem de uso dos créditos: saldos anteriores primeiro (padrão) ou do período primeiro. */
  creditosAnterioresPrimeiro?: boolean;
  finalidade?: '0' | '1';
}

interface LinhaApur { tributo: 'pis' | 'cofins'; cst: string; aliq: number; recBrt: number; bc: number; codCta: string; natRec?: string | null; natBc?: string; entrada: boolean }

export function gerarEfdContribuicoes(estabs: Estabelecimento[], o: OpcoesContrib): ResultadoGeracao {
  const p = new Pendencias();
  const a = new Arquivo();
  const ant = o.anterior;
  const excluirIcms = o.excluirIcmsReceita !== false;
  const dtIni = `${o.competencia}-01`; const dtFin = ultimoDiaMes(o.competencia);
  const noPeriodo = (iso: string) => iso >= dtIni && iso <= dtFin;
  const matriz = estabs[0];
  if (!matriz || matriz.cnpj.slice(8, 12) !== '0001') p.add('erro', 'matriz', 'A matriz (CNPJ 0001) precisa estar cadastrada: a EFD-Contribuições é entregue pela matriz, com todas as filiais.');
  const [ay, am] = o.competencia.split('-').map(Number);
  const compAnt = am === 1 ? `${ay - 1}-12` : `${ay}-${String(am - 1).padStart(2, '0')}`;
  const antDoMesAnterior = !!ant?.dtFin && ant.dtFin.length === 8 && `${ant.dtFin.slice(4, 8)}-${ant.dtFin.slice(2, 4)}` === compAnt;
  if (!ant) p.add('alerta', 'sem_anterior', 'Sem a EFD-Contribuições do mês anterior no Appura: contas contábeis (COD_CTA), contabilista e saldos de créditos (1100/1500) não puderam ser aproveitados. Envie o arquivo anterior na aba SPED.');
  else if (!antDoMesAnterior) p.add('alerta', 'anterior_outro_mes', `A última EFD-Contribuições no Appura não é de ${compAnt}: os saldos de créditos anteriores não foram trazidos.`);

  const contasUsadas = new Set<string>();
  const conta = (chaves: string[], ref: string): string => {
    for (const k of chaves) { const v = ant?.contaPor.get(k); if (v) { contasUsadas.add(v); return v; } }
    p.add('erro', 'cod_cta', 'Conta contábil (COD_CTA) obrigatória não encontrada no SPED anterior para esta operação. Envie a EFD-Contribuições anterior ou informe o plano de contas.', ref);
    return '';
  };

  const apur: LinhaApur[] = [];
  const resumo = { entradas: 0, saidasNfe: 0, nfce: 0, cte: 0, ignorados: 0 };
  type Bloco = { est: Estabelecimento; part: Map<string, ParticipanteXml & { cod: string }>; unid: Set<string>; itens: Map<string, { cod: string; descr: string; ean: string | null; unid: string; ncm: string | null }>; c: (() => void)[]; d: (() => void)[] };
  const blocos: Bloco[] = [];

  for (const est of estabs) {
    const b: Bloco = { est, part: new Map(), unid: new Set(), itens: new Map(), c: [], d: [] };
    blocos.push(b);
    const cnpj = est.cnpj;
    const usarPart = (px: ParticipanteXml | null | undefined, ref: string) => {
      if (!px || !px.doc) { p.add('erro', 'participante', 'Documento sem participante identificado.', ref); return ''; }
      const cod = ant?.partPorDoc.get(px.doc) ?? px.doc;
      b.part.set(cod, { ...px, cod });
      return cod;
    };
    const usarItem = (i: ItemDoc, doc: DocFiscal, entrada: boolean) => {
      const codAnt = entrada && i.ean ? ant?.itemPorEan.get(i.ean) : undefined;
      const cod = codAnt ?? t(entrada ? `${doc.emit_cnpj}-${i.c_prod ?? i.n_item}` : (i.c_prod ?? `ITEM${i.n_item}`), 60);
      const unid = normUnid(i.u_com);
      b.unid.add(unid);
      if (!b.itens.has(cod)) b.itens.set(cod, { cod, descr: t(i.x_prod || cod), ean: i.ean, unid, ncm: i.ncm });
      return { cod, unid };
    };

    const docs = [...est.docs].sort((x, y) => (x.emitida_em < y.emitida_em ? -1 : x.emitida_em > y.emitida_em ? 1 : x.chave < y.chave ? -1 : 1));
    for (const doc of docs) {
      const data = dataLocal(doc.emitida_em);
      if (!noPeriodo(data) || doc.situacao !== 'autorizada') { resumo.ignorados++; continue; }
      const ref = `${doc.modelo === '65' ? 'NFC-e' : doc.modelo === '57' ? 'CT-e' : 'NF-e'} ${doc.numero ?? ''} (${doc.chave})`;
      const propria = doc.emit_cnpj === cnpj;

      /* ----- CT-e tomado ----- */
      if (doc.modelo === '57') {
        if (doc.toma_doc !== cnpj || propria) { resumo.ignorados++; continue; }
        const x = doc.extraCte;
        if (!x) { p.add('erro', 'xml_ausente', 'XML do CT-e não pôde ser lido do armazenamento.', ref); continue; }
        resumo.cte++;
        const codPart = usarPart(x.emit, ref);
        const venda = x.remDoc === cnpj; const compra = x.destDoc === cnpj;
        const comCredito = venda;
        if (compra) p.add('alerta', 'frete_compra', 'Frete de compra escriturado sem crédito (CST 70): a farmácia compra muitos monofásicos. Se houver frete de mercadoria tributada, ajuste.', ref);
        const indNat = venda ? '0' : compra ? '3' : '9';
        const cst = comCredito ? '50' : '70';
        const vItem = c(x.vTPrest); const bc = comCredito ? Math.max(0, vItem - c(x.icms.vICMS)) : 0;
        const cta = conta([`F|${cst}`, 'F'], ref);
        if (comCredito) {
          apur.push({ tributo: 'pis', cst, aliq: ALIQ_PIS, recBrt: vItem, bc, codCta: cta, natBc: '07', entrada: true });
          apur.push({ tributo: 'cofins', cst, aliq: ALIQ_COFINS, recBrt: vItem, bc, codCta: cta, natBc: '07', entrada: true });
        }
        const vlBcIcms = c(x.icms.vBC); const vlIcms = c(x.icms.vICMS);
        b.d.push(() => {
          a.add('D100', '0', '1', codPart, '57', x.tpCTe === '1' ? '06' : '00', serie3(x.serie), '', String(Number(doc.numero)), doc.chave, d8(data), d8(data), x.tpCTe, '',
            nc(vItem), nc(0), venda ? '0' : compra ? '1' : '2', nc(vItem), nc(vlBcIcms), nc(vlIcms), nc(Math.max(0, vItem - vlBcIcms)), '', cta);
          a.add('D101', indNat, nc(vItem), cst, comCredito ? '07' : '', comCredito ? nc(bc) : '', comCredito ? n(ALIQ_PIS, 4) : '', comCredito ? nc(pct(bc, ALIQ_PIS)) : '', cta);
          a.add('D105', indNat, nc(vItem), cst, comCredito ? '07' : '', comCredito ? nc(bc) : '', comCredito ? n(ALIQ_COFINS, 4) : '', comCredito ? nc(pct(bc, ALIQ_COFINS)) : '', cta);
        });
        continue;
      }
      if (doc.modelo !== '55' && doc.modelo !== '65') { resumo.ignorados++; continue; }
      if (!doc.completo || !doc.itens.length) { p.add('erro', 'so_resumo', 'Nota sem o XML completo (só o resumo).', ref); continue; }
      const itensOrd = [...doc.itens].sort((u, v) => u.n_item - v.n_item);

      /* ----- NFC-e: C100 + C175 ----- */
      if (doc.modelo === '65') {
        if (!propria) { resumo.ignorados++; continue; }
        resumo.nfce++;
        const grupos = new Map<string, { cfop: string; cst: string; opr: number; desc: number; bc: number; cta: string }>();
        for (const i of itensOrd) {
          const cfop = String(i.cfop ?? '');
          const cst = cstSaida(i, p, ref);
          const opr = c(i.v_prod) + c(i.v_frete) + c(i.v_seg) + c(i.v_outro);
          const desc = c(i.v_desc) + (cst === '01' && excluirIcms ? c(i.v_icms) : 0);
          const k = `${cfop}|${cst}`;
          const g = grupos.get(k) ?? { cfop, cst, opr: 0, desc: 0, bc: 0, cta: conta([`S|${cst}|${cfop}`, `S|${cst}`, 'S'], ref) };
          g.opr += opr; g.desc += desc; if (cst === '01') g.bc += Math.max(0, opr - desc);
          grupos.set(k, g);
        }
        const linhas = [...grupos.values()].filter((g) => g.opr > 0).sort((x, y) => (x.cfop + x.cst).localeCompare(y.cfop + y.cst));
        for (const g of linhas) {
          const ncmItem = itensOrd.find((i) => String(i.cfop) === g.cfop && cstSaida(i, null, ref) === g.cst)?.ncm ?? null;
          registrarReceita(g.cst, g.opr, g.bc, g.cta, g.cst === '04' ? itensOrd.filter((i) => String(i.cfop) === g.cfop && cstSaida(i, null, ref) === '04') : [], ncmItem, ref);
        }
        b.c.push(() => {
          a.add('C100', '1', '0', '', '65', '00', serie3(doc.serie), String(Number(doc.numero)), doc.chave, d8(data), '', nc(c(doc.valor)), '0', nc(c(doc.v_desc)), '', nc(c(doc.v_prod)), '9',
            nc(c(doc.v_frete)), nc(c(doc.v_seg)), nc(c(doc.v_outro)), nc(sum(itensOrd, 'v_bc_icms')), nc(sum(itensOrd, 'v_icms')), '', '', '', '', '', '', '');
          for (const g of linhas) {
            const tem = g.cst === '01';
            a.add('C175', g.cfop, nc(g.opr), nc(g.desc), g.cst, nc(tem ? g.bc : 0), n(tem ? ALIQ_PIS : 0, 4), '', '', nc(tem ? pct(g.bc, ALIQ_PIS) : 0),
              g.cst, nc(tem ? g.bc : 0), n(tem ? ALIQ_COFINS : 0, 4), '', '', nc(tem ? pct(g.bc, ALIQ_COFINS) : 0), g.cta, '');
          }
        });
        continue;
      }

      /* ----- NF-e 55 ----- */
      const x = doc.extraNfe;
      if (!x) p.add('erro', 'xml_ausente', 'XML da NF-e não pôde ser lido do armazenamento.', ref);
      const entrada = !propria || doc.tp_nf === 0;
      if (entrada) {
        if (!propria && doc.dest_doc && doc.dest_doc !== cnpj) { resumo.ignorados++; continue; }
        const mesmaUf = (doc.uf_emit ?? x?.emit?.uf ?? est.uf) === est.uf;
        const cfopDe = (i: ItemDoc) => (propria ? String(i.cfop ?? '') : (cfopEntradaItem(i, mesmaUf) ?? `${mesmaUf ? '1' : '2'}949`));
        // Só entra documento com compra para revenda ou devolução de venda (uso e consumo, ativo e transferências ficam fora)
        if (!itensOrd.some((i) => CFOP_CREDITO_ENTRADA.test(cfopDe(i)))) { resumo.ignorados++; continue; }
        const linhasC170: string[][] = []; let vlPis = 0; let vlCofins = 0; let vlMerc = 0;
        for (const i of itensOrd) {
          const cfop = cfopDe(i);
          const elegivel = CFOP_CREDITO_ENTRADA.test(cfop);
          const mono = !!monofasico(i.ncm);
          const cst = !elegivel ? '98' : mono ? (devolucaoVenda(cfop) ? '98' : '70') : '50';
          const bc = cst === '50' ? Math.max(0, c(i.v_prod) - c(i.v_desc) + c(i.v_frete) + c(i.v_seg) + c(i.v_outro) + c(i.v_ipi) - c(i.v_icms)) : 0;
          const it = usarItem(i, doc, !propria);
          const cta = conta([`E|${cst}|${cfop}`, `E|${cst}`, 'E'], ref);
          const vp = cst === '50' ? pct(bc, ALIQ_PIS) : 0; const vc = cst === '50' ? pct(bc, ALIQ_COFINS) : 0;
          vlPis += vp; vlCofins += vc; vlMerc += c(i.v_prod);
          if (cst === '50') {
            apur.push({ tributo: 'pis', cst, aliq: ALIQ_PIS, recBrt: c(i.v_prod), bc, codCta: cta, natBc: natBcCred(cfop), entrada: true });
            apur.push({ tributo: 'cofins', cst, aliq: ALIQ_COFINS, recBrt: c(i.v_prod), bc, codCta: cta, natBc: natBcCred(cfop), entrada: true });
          }
          const cstIcms = i.csosn ? '' : `${i.orig ?? 0}${String(i.cst_icms ?? '90').slice(-2)}`;
          linhasC170.push([String(i.n_item), it.cod, '', n(Number(i.q_com) || 0, 5), it.unid, nc(c(i.v_prod)), nc(c(i.v_desc)), '0', cstIcms, cfop, '',
            nc(c(i.v_bc_icms)), n(Number(i.p_icms) || 0), nc(c(i.v_icms)), nc(c(i.v_bc_st)), n(Number(i.p_icms_st) || 0), nc(c(i.v_icms_st)), '', '', '', '', '', '',
            cst, cst === '50' ? nc(bc) : '', cst === '50' ? n(ALIQ_PIS, 4) : '', '', '', nc(vp),
            cst, cst === '50' ? nc(bc) : '', cst === '50' ? n(ALIQ_COFINS, 4) : '', '', '', nc(vc), cta]);
        }
        resumo.entradas++;
        const codPart = usarPart(propria ? x?.dest : (x?.emit ?? (doc.emit_cnpj ? { doc: doc.emit_cnpj } as any : null)), ref);
        b.c.push(() => {
          a.add('C100', '0', propria ? '0' : '1', codPart, '55', doc.fin_nfe === 2 ? '06' : '00', serie3(doc.serie), String(Number(doc.numero)), doc.chave, d8(data), d8(data),
            nc(c(doc.valor)), x?.indPgto ?? '2', nc(c(doc.v_desc)), '', nc(vlMerc), x?.modFrete ?? '9', nc(c(doc.v_frete)), nc(c(doc.v_seg)), nc(c(doc.v_outro)),
            nc(sum(itensOrd, 'v_bc_icms')), nc(sum(itensOrd, 'v_icms')), nc(sum(itensOrd, 'v_bc_st')), nc(sum(itensOrd, 'v_icms_st')), nc(sum(itensOrd, 'v_ipi')), nc(vlPis), nc(vlCofins), '', '');
          for (const l of linhasC170) a.add('C170', ...l);
        });
        continue;
      }
      // Saída própria: só documentos com venda (transferência, remessa, 5.929… ficam fora)
      if (!itensOrd.some((i) => cfopVenda(String(i.cfop ?? '')))) { resumo.ignorados++; continue; }
      resumo.saidasNfe++;
      const codPart = usarPart(x?.dest ?? (doc.dest_doc ? { doc: doc.dest_doc } as any : null), ref);
      const linhasC170: string[][] = []; let vlPis = 0; let vlCofins = 0;
      for (const i of itensOrd) {
        const cfop = String(i.cfop ?? '');
        const cst = cfopVenda(cfop) ? cstSaida(i, p, ref) : '49';
        const opr = c(i.v_prod) + c(i.v_frete) + c(i.v_seg) + c(i.v_outro);
        const bc = cst === '01' ? Math.max(0, opr - c(i.v_desc) - (excluirIcms ? c(i.v_icms) : 0)) : 0;
        const it = usarItem(i, doc, false);
        const cta = conta([`S|${cst}|${cfop}`, `S|${cst}`, 'S'], ref);
        const vp = cst === '01' ? pct(bc, ALIQ_PIS) : 0; const vc = cst === '01' ? pct(bc, ALIQ_COFINS) : 0;
        vlPis += vp; vlCofins += vc;
        if (cst !== '49') registrarReceita(cst, c(i.v_prod), bc, cta, cst === '04' ? [i] : [], i.ncm, ref);
        const zero = cst !== '01';
        linhasC170.push([String(i.n_item), it.cod, '', n(Number(i.q_com) || 0, 5), it.unid, nc(c(i.v_prod)), nc(c(i.v_desc)), '0', `${i.orig ?? 0}${String(i.cst_icms ?? '90').slice(-2)}`, cfop, '',
          nc(c(i.v_bc_icms)), n(Number(i.p_icms) || 0), nc(c(i.v_icms)), nc(c(i.v_bc_st)), n(Number(i.p_icms_st) || 0), nc(c(i.v_icms_st)), '', '', '', '', '', '',
          cst, nc(bc), n(zero ? 0 : ALIQ_PIS, 4), '', '', nc(vp), cst, nc(bc), n(zero ? 0 : ALIQ_COFINS, 4), '', '', nc(vc), cta]);
      }
      b.c.push(() => {
        a.add('C100', '1', '0', codPart, '55', doc.fin_nfe === 2 ? '06' : '00', serie3(doc.serie), String(Number(doc.numero)), doc.chave, d8(data),
          x?.dataSaiEnt && noPeriodo(dataLocal(x.dataSaiEnt)) ? d8(dataLocal(x.dataSaiEnt)) : '', nc(c(doc.valor)), x?.indPgto ?? '2', nc(c(doc.v_desc)), '', nc(c(doc.v_prod)), x?.modFrete ?? '9',
          nc(c(doc.v_frete)), nc(c(doc.v_seg)), nc(c(doc.v_outro)), nc(sum(itensOrd, 'v_bc_icms')), nc(sum(itensOrd, 'v_icms')), nc(sum(itensOrd, 'v_bc_st')), nc(sum(itensOrd, 'v_icms_st')),
          nc(sum(itensOrd, 'v_ipi')), nc(vlPis), nc(vlCofins), '', '');
        for (const l of linhasC170) a.add('C170', ...l);
      });
    }
  }

  function registrarReceita(cst: string, recBrt: number, bc: number, cta: string, itensMono: ItemDoc[], ncm: string | null, ref: string) {
    let natRec: string | null = null;
    if (cst === '04') {
      natRec = natRecMonofasico(itensMono[0]?.ncm ?? ncm);
      if (!natRec) p.add('erro', 'nat_rec', 'Receita monofásica (CST 04) com NCM sem natureza da receita (NAT_REC) mapeada: o M410/M810 fica incompleto.', `${ref} NCM ${itensMono[0]?.ncm ?? ncm ?? '—'}`);
    } else if (['06', '07', '08', '09'].includes(cst)) {
      p.add('erro', 'nat_rec', `Receita com CST ${cst}: a natureza da receita (tabelas 4.3.13 a 4.3.16) ainda não é mapeada pelo Appura.`, ref);
      if (cst === '06' && o.competencia >= '2026-04') p.add('alerta', 'lc224', 'CST 06 a partir de 04/2026: confira o ajuste da LC 224/2025 (redução linear de benefícios).', ref);
    }
    // Monofásico misto numa linha do C175: separa a receita pelo NAT_REC de cada item
    if (cst === '04' && itensMono.length > 1) {
      const porNat = new Map<string, number>();
      for (const i of itensMono) { const nr = natRecMonofasico(i.ncm) ?? natRec ?? ''; porNat.set(nr, (porNat.get(nr) ?? 0) + c(i.v_prod) + c(i.v_frete) + c(i.v_seg) + c(i.v_outro)); }
      let resto = recBrt; const ents = [...porNat.entries()];
      ents.forEach(([nr, v], k) => {
        const val = k === ents.length - 1 ? resto : Math.min(v, resto); resto -= val;
        for (const tr of ['pis', 'cofins'] as const) apur.push({ tributo: tr, cst, aliq: 0, recBrt: val, bc: 0, codCta: cta, natRec: nr || null, entrada: false });
      });
      return;
    }
    apur.push({ tributo: 'pis', cst, aliq: cst === '01' ? ALIQ_PIS : 0, recBrt, bc, codCta: cta, natRec, entrada: false });
    apur.push({ tributo: 'cofins', cst, aliq: cst === '01' ? ALIQ_COFINS : 0, recBrt, bc, codCta: cta, natRec, entrada: false });
  }

  /* ---------- apuração (Bloco M) ---------- */
  const m = { pis: apurar('pis'), cofins: apurar('cofins') };
  function apurar(tr: 'pis' | 'cofins') {
    const aliq = tr === 'pis' ? ALIQ_PIS : ALIQ_COFINS;
    const linhas = apur.filter((l) => l.tributo === tr);
    // Débito (M210/M610): CST 01 à alíquota básica
    const deb = linhas.filter((l) => !l.entrada && l.cst === '01');
    const recBrt = deb.reduce((s, l) => s + l.recBrt, 0); const bcDeb = deb.reduce((s, l) => s + l.bc, 0);
    const contApur = pct(bcDeb, aliq);
    // Crédito (M100/M105): CST 50 → COD_CRED 101, por NAT_BC_CRED
    const cred = linhas.filter((l) => l.entrada && l.cst === '50');
    const porNat = new Map<string, number>();
    for (const l of cred) porNat.set(l.natBc!, (porNat.get(l.natBc!) ?? 0) + l.bc);
    const bcCred = [...porNat.values()].reduce((s, v) => s + v, 0);
    const vlCred = pct(bcCred, aliq);
    // Receitas não tributadas (M400/M410)
    const nt = new Map<string, { total: number; cta: string; nats: Map<string, { v: number; cta: string }> }>();
    for (const l of linhas.filter((x) => !x.entrada && x.cst !== '01')) {
      const g = nt.get(l.cst) ?? { total: 0, cta: l.codCta, nats: new Map() };
      g.total += l.recBrt;
      const nr = l.natRec ?? '';
      const z = g.nats.get(nr) ?? { v: 0, cta: l.codCta }; z.v += l.recBrt; g.nats.set(nr, z);
      nt.set(l.cst, g);
    }
    // Créditos anteriores (1100/1500) do mês imediatamente anterior
    const saldosAnt: SaldoCredito[] = antDoMesAnterior ? (tr === 'pis' ? ant!.saldos1100 : ant!.saldos1500) : [];
    const anteriores = saldosAnt.map((s) => {
      const f = s.f; const v = (i: number) => c(Number((f[i] ?? '').replace(/\./g, '').replace(',', '.')) || 0);
      return { per: s.per, codCred: s.codCred, credApu: v(5), totApu: v(7), descAnt: v(8) + v(12), perAnt: v(9) + v(13), dcompAnt: v(10) + v(14), usado: 0 };
    }).sort((x, y) => (x.per.slice(2) + x.per.slice(0, 2)).localeCompare(y.per.slice(2) + y.per.slice(0, 2)) || x.codCred.localeCompare(y.codCred));
    let restante = contApur; let usadoAtual = 0;
    const usarAnteriores = () => { for (const r of anteriores) { const disp = r.totApu - r.descAnt - r.perAnt - r.dcompAnt; r.usado = Math.max(0, Math.min(disp, restante)); restante -= r.usado; } };
    const usarAtual = () => { usadoAtual = Math.min(vlCred, restante); restante -= usadoAtual; };
    if (o.creditosAnterioresPrimeiro === false) { usarAtual(); usarAnteriores(); } else { usarAnteriores(); usarAtual(); }
    const descAnt = anteriores.reduce((s, r) => s + r.usado, 0);
    const devido = contApur - usadoAtual - descAnt;
    return { aliq, recBrt, bcDeb, contApur, porNat, bcCred, vlCred, usadoAtual, sldCred: vlCred - usadoAtual, nt, anteriores, descAnt, devido };
  }

  // Contas do M400/M410 (e M800/M810) também vão para o 0500, que é escrito antes
  const contaNt = (reg: string, k: string, padrao: string) => { const v = ant?.contaPor.get(`${reg}|${k}`) ?? padrao; if (v) contasUsadas.add(v); return v; };
  const ctaNt = { pis: { pai: new Map<string, string>(), det: new Map<string, string>() }, cofins: { pai: new Map<string, string>(), det: new Map<string, string>() } };
  for (const tr of ['pis', 'cofins'] as const) {
    const [rp, rd] = tr === 'pis' ? ['M400', 'M410'] : ['M800', 'M810'];
    for (const [cst, g] of m[tr].nt) {
      ctaNt[tr].pai.set(cst, contaNt(rp, cst, g.cta));
      for (const [nat, z] of g.nats) ctaNt[tr].det.set(`${cst}|${nat}`, contaNt(rd, nat, z.cta));
    }
  }

  /* ---------- escrita ---------- */
  const r0100 = ant?.r0100;
  a.add('0000', '006', o.finalidade ?? '0', '', '', d8(dtIni), d8(dtFin), t(semAcento(matriz?.razao_social ?? ''), 100), matriz?.cnpj ?? '', matriz?.uf ?? 'ES', dig(matriz?.cod_municipio ?? ''), '', '00', '2');
  if (!matriz?.cod_municipio) p.add('erro', 'municipio', 'Código do município (IBGE) da matriz não cadastrado.');
  a.abrir('0', '0');
  if (r0100) a.add('0100', ...r0100.slice(1, 14).concat(Array(Math.max(0, 13 - r0100.slice(1, 14).length)).fill('')));
  else {
    p.add('erro', 'contabilista', 'Dados do contabilista (0100) vêm do SPED anterior: falta o CPF do contador. Envie a EFD-Contribuições do mês anterior.');
    a.add('0100', t(matriz?.contador_nome ?? '', 100), '', t(matriz?.contador_crc ?? '', 15), dig(matriz?.contador_cnpj ?? ''), '', '', '', '', '', dig(matriz?.contador_fone ?? '').slice(-11), '', t(matriz?.contador_email ?? ''), dig(matriz?.cod_municipio ?? ''));
  }
  a.add('0110', '1', '1', '1', '');
  const comMov = blocos.filter((b, k) => k === 0 || b.c.length || b.d.length);
  for (const b of comMov) {
    a.add('0140', '', t(b.est.razao_social, 100), b.est.cnpj, b.est.uf, dig(b.est.ie ?? ''), dig(b.est.cod_municipio ?? ''), '', '');
    for (const pt of [...b.part.values()].sort((x, y) => x.cod.localeCompare(y.cod))) {
      const brasil = !pt.codPais || pt.codPais === '1058' || pt.codPais === '01058';
      a.add('0150', pt.cod, t(pt.nome || pt.cod, 100), String(Number(pt.codPais || '1058')).padStart(5, '0'), pt.cnpj, pt.cnpj ? '' : pt.cpf, pt.ie, brasil ? pt.codMun : '', '',
        t(pt.end || 'NAO INFORMADO', 60), t(pt.num), t(pt.compl, 60), t(pt.bairro, 60));
    }
    for (const u of [...b.unid].sort()) a.add('0190', u, `UNIDADE ${u}`);
    for (const it of [...b.itens.values()].sort((x, y) => x.cod.localeCompare(y.cod))) {
      a.add('0200', it.cod, t(it.descr || it.cod), it.ean && /^\d{8,14}$/.test(it.ean) ? it.ean : '', '', it.unid, '00', it.ncm && /^\d{8}$/.test(it.ncm) ? it.ncm : '', '',
        it.ncm && /^\d{8}$/.test(it.ncm) ? it.ncm.slice(0, 2) : '', '', '');
    }
  }
  for (const cod of [...contasUsadas].sort()) {
    const ct = ant?.contas.get(cod);
    if (!ct) { p.add('erro', 'conta_0500', 'Conta usada sem cadastro no 0500 do SPED anterior.', cod); continue; }
    a.add('0500', ct.dtAlt, ct.natCc, ct.indCta, ct.nivel, ct.cod, t(ct.nome, 60), ct.codRef, ct.cnpjEst);
  }
  a.fechar();

  a.abrir('A', '1'); a.fechar();
  const temC = blocos.some((b) => b.c.length);
  a.abrir('C', temC ? '0' : '1');
  for (const b of blocos) if (b.c.length) { a.add('C010', b.est.cnpj, ''); for (const f of b.c) f(); }
  a.fechar();
  const temD = blocos.some((b) => b.d.length);
  a.abrir('D', temD ? '0' : '1');
  for (const b of blocos) if (b.d.length) { a.add('D010', b.est.cnpj); for (const f of b.d) f(); }
  a.fechar();
  a.abrir('F', '1'); a.fechar();
  a.abrir('I', '1'); a.fechar();

  a.abrir('M', '0');
  for (const tr of ['pis', 'cofins'] as const) {
    const x = m[tr];
    const R = tr === 'pis' ? { cred: 'M100', det: 'M105', cons: 'M200', rec: 'M205', cont: 'M210', nt: 'M400', ntDet: 'M410', codRec: '691201' } : { cred: 'M500', det: 'M505', cons: 'M600', rec: 'M605', cont: 'M610', nt: 'M800', ntDet: 'M810', codRec: '585601' };
    if (x.vlCred > 0) {
      a.add(R.cred, '101', '0', nc(x.bcCred), n(x.aliq, 4), '', '', nc(x.vlCred), nc(0), nc(0), nc(0), nc(x.vlCred), x.usadoAtual === x.vlCred ? '0' : '1', nc(x.usadoAtual), nc(x.sldCred));
      for (const [nat, bc] of [...x.porNat.entries()].sort()) a.add(R.det, nat, '50', nc(bc), '', nc(bc), nc(bc), '', '', '');
    }
    const nc08 = x.devido;
    a.add(R.cons, nc(x.contApur), nc(x.usadoAtual), nc(x.descAnt), nc(x.contApur - x.usadoAtual - x.descAnt), nc(0), nc(0), nc(nc08), nc(0), nc(0), nc(0), nc(0), nc(nc08));
    if (nc08 > 0) a.add(R.rec, '08', R.codRec, nc(nc08));
    if (x.bcDeb > 0 || x.recBrt > 0) a.add(R.cont, '01', nc(x.recBrt), nc(x.bcDeb), nc(0), nc(0), nc(x.bcDeb), n(x.aliq, 4), '', '', nc(x.contApur), nc(0), nc(0), nc(0), nc(0), nc(x.contApur));
    for (const [cst, g] of [...x.nt.entries()].sort()) {
      a.add(R.nt, cst, nc(g.total), ctaNt[tr].pai.get(cst) ?? g.cta, '');
      for (const [nat, z] of [...g.nats.entries()].sort()) a.add(R.ntDet, nat, nc(z.v), ctaNt[tr].det.get(`${cst}|${nat}`) ?? z.cta, '');
    }
  }
  a.fechar();
  a.abrir('P', '1'); a.fechar();

  // Bloco 1: controle dos créditos (saldos anteriores e saldo do período)
  const l1100: string[][] = []; const l1500: string[][] = [];
  const perAtual = `${o.competencia.slice(5, 7)}${o.competencia.slice(0, 4)}`;
  for (const tr of ['pis', 'cofins'] as const) {
    const x = m[tr]; const dest = tr === 'pis' ? l1100 : l1500;
    for (const r of x.anteriores) {
      const disp = r.totApu - r.descAnt - r.perAnt - r.dcompAnt;
      dest.push([r.per, '01', '', r.codCred, nc(r.credApu), '', nc(r.totApu), nc(r.descAnt), r.perAnt ? nc(r.perAnt) : '', r.dcompAnt ? nc(r.dcompAnt) : '', nc(disp), nc(r.usado), '', '', '', '', nc(disp - r.usado)]);
    }
    if (x.sldCred > 0) dest.push([perAtual, '01', '', '101', nc(x.vlCred), '', nc(x.vlCred), nc(x.usadoAtual), '', '', nc(x.sldCred), nc(0), '', '', '', '', nc(x.sldCred)]);
  }
  a.abrir('1', l1100.length || l1500.length ? '0' : '1');
  for (const l of l1100) a.add('1100', ...l);
  for (const l of l1500) a.add('1500', ...l);
  a.fechar();

  const linhas = a.encerrar();
  const v = (x: number) => x / 100;
  return {
    linhas,
    pendencias: p.lista(),
    resumo: {
      tipo: 'efd_contribuicoes', competencia: o.competencia, cnpj: matriz?.cnpj, estabelecimentos: comMov.length, documentos: resumo,
      pis: { receitaTributada: v(m.pis.recBrt), base: v(m.pis.bcDeb), debito: v(m.pis.contApur), credito: v(m.pis.vlCred), creditoAnteriorUsado: v(m.pis.descAnt), aRecolher: v(m.pis.devido), saldoCredor: v(m.pis.sldCred) },
      cofins: { receitaTributada: v(m.cofins.recBrt), base: v(m.cofins.bcDeb), debito: v(m.cofins.contApur), credito: v(m.cofins.vlCred), creditoAnteriorUsado: v(m.cofins.descAnt), aRecolher: v(m.cofins.devido), saldoCredor: v(m.cofins.sldCred) },
      receitasNaoTributadas: Object.fromEntries([...m.pis.nt.entries()].map(([cst, g]) => [cst, v(g.total)])),
      registros: { C100: a.quantidade('C100'), C170: a.quantidade('C170'), C175: a.quantidade('C175'), D100: a.quantidade('D100') },
      linhas: linhas.length,
    },
  };
}

/** CST de PIS/COFINS da venda: monofásico pelo NCM (04); senão o do XML quando for não tributado; senão 01. */
export function cstSaida(i: ItemDoc, p: Pendencias | null, ref: string): string {
  if (monofasico(i.ncm)) {
    if (p && i.cst_pis && i.cst_pis !== '04') p.add('alerta', 'cst_mono', 'Produto monofásico pelo NCM vendido com outro CST de PIS na nota: escriturado como 04 (alíquota zero na revenda). Corrija o cadastro no sistema de vendas.', `${ref} ${i.x_prod ?? ''} (NCM ${i.ncm}, CST ${i.cst_pis})`);
    return '04';
  }
  const x = String(i.cst_pis ?? '');
  if (['05', '06', '07', '08', '09'].includes(x)) return x;
  if (x === '04' && p) p.add('alerta', 'cst04_sem_ncm', 'Nota com CST 04 (monofásico) em produto cujo NCM não está na lista de monofásicos: escriturado como tributado (01).', `${ref} ${i.x_prod ?? ''} (NCM ${i.ncm ?? '—'})`);
  return '01';
}

const sum = (l: ItemDoc[], k: keyof ItemDoc) => l.reduce((s, i) => s + c(i[k] as number), 0);
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 /,.\-@:&*+_<>()!?'$%]/g, ' ');
