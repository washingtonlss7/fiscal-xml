/**
 * Gerador da EFD ICMS/IPI (SPED Fiscal) de um estabelecimento comercial (varejo), a partir dos XMLs do mês
 * e do SPED do mês anterior. Especificação: docs/sped/gerador-icms-spec.md.
 *
 * Escopo: Bloco 0 (0000, 0005, 0100, 0150, 0190, 0200, 0220), C100/C170/C190 (entradas de terceiros com itens;
 * NF-e própria e NFC-e só com C190; canceladas próprias), D100/D190 (CT-e tomado), E100/E110/E116, blocos
 * B/G/H/K vazios, 1010 e Bloco 9. O que estiver fora do escopo vira pendência (erro = o PVA vai recusar).
 */
import { cfopEntrada } from '../../auditoria/tabelas';
import { AnteriorIcms } from './anterior';
import { Arquivo, c, d8, dataLocal, dig, n, nc, Pendencias, t, ultimoDiaMes } from './escrita';
import { codVerIcms, DocFiscal, Estabelecimento, ItemDoc, ResultadoGeracao } from './tipos';
import type { ParticipanteXml } from './xml';

const UNIDADES: Record<string, string> = {
  UN: 'UNIDADE', UND: 'UNIDADE', UNID: 'UNIDADE', CX: 'CAIXA', CXA: 'CAIXA', FR: 'FRASCO', FRS: 'FRASCO', PC: 'PECA', PCT: 'PACOTE', KG: 'QUILOGRAMA',
  G: 'GRAMA', L: 'LITRO', LT: 'LITRO', ML: 'MILILITRO', M: 'METRO', CJ: 'CONJUNTO', DZ: 'DUZIA', FD: 'FARDO', BL: 'BLISTER', TB: 'TUBO', AMP: 'AMPOLA',
  ENV: 'ENVELOPE', SC: 'SACO', GL: 'GALAO', PAR: 'PAR', KIT: 'KIT', BD: 'BALDE', RL: 'ROLO', DP: 'DISPLAY', EMB: 'EMBALAGEM', FL: 'FOLHA',
};
export const normUnid = (u: string | null | undefined) => (String(u ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || 'UN');
const descrUnid = (u: string, ant?: Map<string, string>) => ant?.get(u) || UNIDADES[u] || `UNIDADE ${u}`;
const serie3 = (s: string | null) => String(Number(s ?? '0') || 0).padStart(3, '0');
const num0 = (v: number | null | undefined) => Number(v) || 0;

/** CST próprio (2 dígitos de tributação) na entrada, pelo CST/CSOSN do fornecedor (gerador-icms-spec §5, icms_blocoC_1 §11.3). */
export function cstEntrada(i: Pick<ItemDoc, 'cst_icms' | 'csosn'>): string {
  const x = String(i.cst_icms ?? '');
  if (i.csosn) return ['201', '202', '203', '500'].includes(x) ? '60' : '90';
  return ({ '00': '00', '10': '60', '20': '20', '30': '60', '40': '40', '41': '41', '50': '50', '51': '51', '60': '60', '70': '60', '90': '90' } as Record<string, string>)[x] ?? '90';
}

/** CFOP próprio de entrada: o do escritório (auditoria), ou a conversão pelo CFOP do emitente. */
export function cfopEntradaItem(i: Pick<ItemDoc, 'cfop' | 'cfop_escrit'>, mesmaUf: boolean): string | null {
  if (i.cfop_escrit && /^[123]\d{3}$/.test(i.cfop_escrit)) return `${mesmaUf ? '1' : '2'}${i.cfop_escrit.slice(1)}`;
  const c0 = String(i.cfop ?? '');
  // Devolução de venda feita pelo cliente (o CFOP dele é de devolução de compra)
  const dev: Record<string, string> = { '202': '202', '201': '201', '411': '411', '410': '410' };
  if (/^[56]\d{3}$/.test(c0) && dev[c0.slice(1)]) return `${mesmaUf ? '1' : '2'}${dev[c0.slice(1)]}`;
  const r = cfopEntrada(c0);
  return r ? `${mesmaUf ? '1' : '2'}${r.slice(1)}` : null;
}

const CFOP_COM_CREDITO = /^[12](102|101|117|118|120|121|122|201|202|251|252|253|254|255|256|257|551|552|553|554|555|556|557)$/;
const SEM_CREDITO_ICMS = /^[12](556|407|551|406)$/; // uso e consumo e ativo: sem crédito por aqui (ativo vai para o CIAP)

interface LinhaC190 { cst: string; cfop: string; aliq: number; opr: number; bc: number; icms: number; bcSt: number; icmsSt: number; redBc: number; ipi: number }

export interface OpcoesIcms {
  competencia: string;          // AAAA-MM
  anterior: AnteriorIcms | null;
  finalidade?: '0' | '1';
}

export function gerarEfdIcms(est: Estabelecimento, o: OpcoesIcms): ResultadoGeracao {
  const p = new Pendencias();
  const a = new Arquivo();
  const ant = o.anterior;
  const dtIni = `${o.competencia}-01`; const dtFin = ultimoDiaMes(o.competencia);
  const noPeriodo = (iso: string) => iso >= dtIni && iso <= dtFin;
  const cnpj = est.cnpj;
  const codVer = codVerIcms(dtFin);
  if (!codVer) p.add('erro', 'versao', `Sem versão de leiaute cadastrada para ${o.competencia}.`);

  // Mês anterior: só vale como "anterior" se for o mês imediatamente antes
  const [ay, am] = o.competencia.split('-').map(Number);
  const compAnt = am === 1 ? `${ay - 1}-12` : `${ay}-${String(am - 1).padStart(2, '0')}`;
  const antDoMesAnterior = !!ant?.dtFin && ant.dtFin.length === 8 && `${ant.dtFin.slice(4, 8)}-${ant.dtFin.slice(2, 4)}` === compAnt;
  if (!ant) p.add('alerta', 'sem_anterior', 'Sem o SPED Fiscal do mês anterior no Appura: contabilista, perfil, códigos próprios dos itens, saldo credor, código de receita do ICMS e o 1010 não puderam ser aproveitados. Envie o SPED anterior na aba SPED.');
  else if (!antDoMesAnterior) p.add('alerta', 'anterior_outro_mes', `O último SPED Fiscal no Appura não é de ${compAnt}: o saldo credor anterior ficou zerado.`);

  /* ---------- participantes, itens e unidades usados ---------- */
  const participantes = new Map<string, ParticipanteXml & { cod: string }>();
  const usarPart = (px: ParticipanteXml | null | undefined, ref: string): string => {
    if (!px || !px.doc) { p.add('erro', 'participante', 'Documento sem participante identificado (CNPJ/CPF): o C100/D100 exige COD_PART.', ref); return ''; }
    const cod = ant?.partPorDoc.get(px.doc) ?? px.doc;
    participantes.set(cod, { ...px, cod });
    return cod;
  };
  interface Item0200 { cod: string; descr: string; ean: string | null; unidInv: string; tipo: string; ncm: string | null; cest: string | null; conversoes: Map<string, number> }
  const itens0200 = new Map<string, Item0200>();
  const unidades = new Set<string>();

  /* ---------- classificação dos documentos ---------- */
  const docs = [...est.docs].sort((x, y) => (x.emitida_em < y.emitida_em ? -1 : x.emitida_em > y.emitida_em ? 1 : x.chave < y.chave ? -1 : 1));
  const c100: { doc: DocFiscal; linhas: () => void }[] = [];
  const resumo = { entradas: 0, saidasNfe: 0, nfce: 0, canceladas: 0, entradasProprias: 0, cte: 0, ignorados: 0 };
  const debitos = { normal: 0, especial: 0 }; let creditos = 0;
  const totaisC190: LinhaC190[] = [];

  const fecharC190 = (l: LinhaC190[]) => {
    for (const x of l) {
      a.add('C190', x.cst, x.cfop, n(x.aliq), nc(x.opr), nc(x.bc), nc(x.icms), nc(x.bcSt), nc(x.icmsSt), nc(x.redBc), nc(x.ipi), '');
      totaisC190.push(x);
      if (x.bcSt > 0 || x.icmsSt > 0) p.add('erro', 'st_e200', 'Documento com ICMS-ST debitado ou creditado: o E200/E210 (apuração da ST) é obrigatório e ainda não é gerado pelo Appura.', x.cfop);
    }
  };
  const agrupar = (lista: LinhaC190[]) => {
    const m = new Map<string, LinhaC190>();
    for (const x of lista) {
      const k = `${x.cst}|${x.cfop}|${x.aliq.toFixed(2)}`;
      const g = m.get(k);
      if (!g) m.set(k, { ...x });
      else { g.opr += x.opr; g.bc += x.bc; g.icms += x.icms; g.bcSt += x.bcSt; g.icmsSt += x.icmsSt; g.redBc += x.redBc; g.ipi += x.ipi; }
    }
    return [...m.values()].sort((x, y) => (x.cst + x.cfop + x.aliq).localeCompare(y.cst + y.cfop + y.aliq));
  };
  const oprItem = (i: ItemDoc) => c(i.v_prod) + c(i.v_frete) + c(i.v_seg) + c(i.v_outro) + c(i.v_icms_st) + c(i.v_fcp_st) + c(i.v_ipi) - c(i.v_desc);

  for (const doc of docs) {
    const data = dataLocal(doc.emitida_em);
    const propria = doc.emit_cnpj === cnpj;
    const ref = `${doc.modelo === '65' ? 'NFC-e' : doc.modelo === '57' ? 'CT-e' : 'NF-e'} ${doc.numero ?? ''} (${doc.chave})`;
    if (!noPeriodo(data)) { resumo.ignorados++; continue; }

    /* ----- CT-e: só o tomado pelo estabelecimento ----- */
    if (doc.modelo === '57') {
      if (doc.toma_doc !== cnpj || propria) { resumo.ignorados++; continue; }
      if (doc.situacao !== 'autorizada') continue; // CT-e de terceiro cancelado não é escriturado
      continue; // D100 é escrito depois (bloco D)
    }
    if (doc.modelo !== '55' && doc.modelo !== '65') { resumo.ignorados++; continue; }

    /* ----- documentos próprios cancelados: C100 só com a identificação ----- */
    if (propria && doc.situacao !== 'autorizada') {
      if (doc.situacao === 'denegada') { resumo.ignorados++; continue; }
      resumo.canceladas++;
      c100.push({ doc, linhas: () => a.add('C100', doc.tp_nf === 0 ? '0' : '1', '0', '', doc.modelo, '02', serie3(doc.serie), String(Number(doc.numero)), doc.chave, ...Array(20).fill('')) });
      continue;
    }
    if (!propria && doc.situacao !== 'autorizada') { resumo.ignorados++; continue; }
    if (!doc.completo || !doc.itens.length) { p.add('erro', 'so_resumo', 'Nota sem o XML completo (só o resumo): não dá para escriturar os itens. Baixe o XML completo (manifestação) ou importe o arquivo.', ref); continue; }

    /* ----- entrada de terceiros: C100 + C170 + C190 ----- */
    if (!propria) {
      if (doc.modelo !== '55') { resumo.ignorados++; continue; }
      if (doc.dest_doc && doc.dest_doc !== cnpj) { resumo.ignorados++; continue; }
      resumo.entradas++;
      const x = doc.extraNfe;
      if (!x) p.add('erro', 'xml_ausente', 'XML da NF-e não pôde ser lido do armazenamento: participante, frete e pagamento ficaram sem dados.', ref);
      const codPart = usarPart(x?.emit ?? (doc.emit_cnpj ? { doc: doc.emit_cnpj } as any : null), ref);
      const mesmaUf = (doc.uf_emit ?? x?.emit?.uf ?? 'ES') === est.uf;
      const c170: string[][] = []; const grupos: LinhaC190[] = [];
      let somaItens = 0;
      for (const i of [...doc.itens].sort((u, v) => u.n_item - v.n_item)) {
        // Item próprio: de-para pelo GTIN com o 0200 do SPED anterior; senão, código do fornecedor
        const codAnt = i.ean ? ant?.itemPorEan.get(i.ean) : undefined;
        const itAnt = codAnt ? ant!.itens.get(codAnt) : undefined;
        const unid = normUnid(i.u_com);
        let cod: string;
        if (itAnt) cod = itAnt.cod;
        else { cod = t(`${doc.emit_cnpj}-${i.c_prod ?? i.n_item}`, 60); p.add('info', 'sem_depara', 'Itens sem código próprio (não achados pelo GTIN no SPED anterior): foram escriturados com o código do fornecedor (CNPJ-código).', `${i.x_prod ?? ''} (${i.ean ?? 'sem GTIN'})`); }
        let it = itens0200.get(cod);
        if (!it) {
          it = itAnt
            ? { cod, descr: itAnt.descr, ean: itAnt.ean, unidInv: itAnt.unidInv, tipo: itAnt.tipo, ncm: itAnt.ncm ?? i.ncm, cest: itAnt.cest ?? i.cest, conversoes: new Map(itAnt.conversoes.map((v) => [v.unid, v.fator])) }
            : { cod, descr: t(i.x_prod || cod), ean: i.ean, unidInv: unid, tipo: '00', ncm: i.ncm, cest: i.cest, conversoes: new Map() };
          itens0200.set(cod, it);
        }
        unidades.add(unid); unidades.add(it.unidInv);
        if (unid !== it.unidInv && it.tipo !== '07' && !it.conversoes.has(unid)) {
          p.add('erro', 'conversao', 'Unidade da compra diferente da unidade de estoque sem fator de conversão (0220): informe o fator no SPED do mês ou no cadastro do item.', `${it.descr}: ${unid} → ${it.unidInv}`);
          it.conversoes.set(unid, 0);
        }
        // CST e CFOP próprios: os da última escrituração do item, ou a conversão
        const escAnt = itAnt ? ant!.escrituracaoItem.get(itAnt.cod) : undefined;
        let cfop = cfopEntradaItem(i, mesmaUf);
        if (!i.cfop_escrit && escAnt && /^[123]\d{3}$/.test(escAnt.cfop)) cfop = `${mesmaUf ? '1' : '2'}${escAnt.cfop.slice(1)}`;
        if (!cfop) { cfop = `${mesmaUf ? '1' : '2'}949`; p.add('alerta', 'cfop_entrada', 'CFOP do fornecedor sem conversão definida: escriturado como x.949. Ajuste o CFOP de escrituração na auditoria.', `${ref} item ${i.n_item} (CFOP ${i.cfop})`); }
        let trib = cstEntrada(i);
        if (escAnt && escAnt.cst.length === 3 && !i.cfop_escrit) trib = escAnt.cst.slice(1);
        if (SEM_CREDITO_ICMS.test(cfop)) trib = trib === '60' ? '60' : '90';
        const cst = `${i.orig ?? 0}${trib}`;
        const credito = CFOP_COM_CREDITO.test(cfop) && ['00', '20', '90', '51'].includes(trib) && num0(i.v_icms) > 0 && !SEM_CREDITO_ICMS.test(cfop);
        if (i.csosn && String(i.cst_icms) === '101') p.add('info', 'credito_sn', 'Compra de fornecedor do Simples com CSOSN 101: o crédito (pCredSN) não é lançado automaticamente.', ref);
        const vlItem = c(i.v_prod) + c(i.v_icms_st) + c(i.v_fcp_st) + c(i.v_ipi); // sem crédito de ST/IPI: compõem o custo
        somaItens += vlItem;
        const bc = credito ? c(i.v_bc_icms) : 0; const icms = credito ? c(i.v_icms) + c(i.v_fcp) : 0; const aliq = credito ? num0(i.p_icms) : 0;
        const redBc = credito && /20$|70$/.test(cst) ? Math.max(0, c(i.v_prod) + c(i.v_frete) + c(i.v_seg) + c(i.v_outro) - c(i.v_desc) - c(i.v_bc_icms)) : 0;
        c170.push([String(i.n_item), cod, t(i.x_prod ?? ''), n(num0(i.q_com), 5), unid, nc(vlItem), nc(c(i.v_desc)), '0', cst, cfop, '',
          credito ? nc(bc) : '', credito ? n(aliq) : '', credito ? nc(icms) : '', '', '', '', '', '', '', '', '', '',
          '', '', '', '', '', '', '', '', '', '', '', '', '', nc(0)]);
        grupos.push({ cst, cfop, aliq, opr: oprItem(i), bc, icms, bcSt: 0, icmsSt: 0, redBc, ipi: 0 });
        if (/20$|70$/.test(cst) && credito && redBc === 0) p.add('alerta', 'red_bc', 'Item com CST de redução de base (x20/x70) sem valor de redução calculado: confira o VL_RED_BC.', ref);
      }
      // Primeiro dígito do CFOP igual em todo o documento
      const prefixos = new Set(c170.map((l) => l[9][0]));
      if (prefixos.size > 1) p.add('erro', 'cfop_misto', 'Documento de entrada com CFOP de prefixos diferentes (1 e 2).', ref);
      const g = agrupar(grupos);
      creditos += g.reduce((s, x) => s + x.icms, 0);
      const vlBc = g.reduce((s, x) => s + x.bc, 0); const vlIcms = g.reduce((s, x) => s + x.icms, 0);
      c100.push({ doc, linhas: () => {
        a.add('C100', '0', '1', codPart, '55', doc.fin_nfe === 2 ? '06' : '00', serie3(doc.serie), String(Number(doc.numero)), doc.chave, d8(data), d8(data),
          nc(c(doc.valor)), x?.indPgto ?? '2', nc(c(doc.v_desc)), nc(0), nc(somaItens), x?.modFrete ?? '9', nc(c(doc.v_frete)), nc(c(doc.v_seg)), nc(c(doc.v_outro)),
          nc(vlBc), nc(vlIcms), nc(0), nc(0), nc(0), '', '', '', '');
        for (const l of c170) a.add('C170', ...l);
        fecharC190(g);
      } });
      continue;
    }

    /* ----- documento próprio (NF-e de saída/entrada própria e NFC-e): C100 + C190 ----- */
    const entradaPropria = doc.tp_nf === 0;
    if (doc.modelo === '65') resumo.nfce++; else if (entradaPropria) resumo.entradasProprias++; else resumo.saidasNfe++;
    const grupos: LinhaC190[] = [];
    for (const i of doc.itens) {
      if (i.csosn) { p.add('erro', 'csosn', 'Nota própria com CSOSN (regime do Simples) em empresa do regime normal: confira o regime da empresa ou a emissão.', ref); }
      const cst = `${i.orig ?? 0}${String(i.cst_icms ?? '90').slice(-2)}`;
      const bc = c(i.v_bc_icms); const icms = c(i.v_icms) + c(i.v_fcp);
      const redBc = /20$|70$/.test(cst) ? Math.max(0, c(i.v_prod) + c(i.v_frete) + c(i.v_seg) + c(i.v_outro) - c(i.v_desc) - bc) : 0;
      const st = doc.modelo === '65' ? 0 : c(i.v_icms_st) + c(i.v_fcp_st);
      grupos.push({ cst, cfop: String(i.cfop ?? ''), aliq: num0(i.p_icms), opr: oprItem(i), bc, icms, bcSt: doc.modelo === '65' ? 0 : c(i.v_bc_st), icmsSt: st, redBc, ipi: 0 });
      if (doc.modelo === '65' && !/^5/.test(String(i.cfop))) p.add('erro', 'nfce_cfop', 'NFC-e com CFOP que não começa com 5.', ref);
    }
    const g = agrupar(grupos);
    for (const x of g) {
      const saida = /^[567]/.test(x.cfop);
      if (saida) { if (x.cfop !== '5605') debitos.normal += x.icms; else creditos += x.icms; }
      else if (x.cfop === '1605') debitos.normal += x.icms; else creditos += x.icms;
    }
    const x = doc.extraNfe;
    const vlBc = g.reduce((s, y) => s + y.bc, 0); const vlIcms = g.reduce((s, y) => s + y.icms, 0);
    const vlBcSt = g.reduce((s, y) => s + y.bcSt, 0); const vlSt = g.reduce((s, y) => s + y.icmsSt, 0);
    if (doc.modelo === '65') {
      c100.push({ doc, linhas: () => {
        a.add('C100', '1', '0', '', '65', '00', serie3(doc.serie), String(Number(doc.numero)), doc.chave, d8(data), '', nc(c(doc.valor)), '0', nc(c(doc.v_desc)), nc(0), nc(c(doc.v_prod)),
          '9', nc(c(doc.v_frete)), nc(c(doc.v_seg)), nc(c(doc.v_outro)), nc(vlBc), nc(vlIcms), '', '', '', '', '', '', '');
        fecharC190(g);
      } });
    } else {
      if (!x) p.add('erro', 'xml_ausente', 'XML da NF-e não pôde ser lido do armazenamento: participante, frete e pagamento ficaram sem dados.', ref);
      // Entrada própria: o participante é o remetente (dest do XML); saída: o destinatário
      const codPart = usarPart(x?.dest ?? (doc.dest_doc ? { doc: doc.dest_doc } as any : null), ref);
      const dtSai = !entradaPropria && x?.dataSaiEnt && noPeriodo(dataLocal(x.dataSaiEnt)) ? d8(dataLocal(x.dataSaiEnt)) : entradaPropria ? d8(data) : '';
      c100.push({ doc, linhas: () => {
        a.add('C100', entradaPropria ? '0' : '1', '0', codPart, '55', doc.fin_nfe === 2 ? '06' : '00', serie3(doc.serie), String(Number(doc.numero)), doc.chave, d8(data), dtSai,
          nc(c(doc.valor)), x?.indPgto ?? '2', nc(c(doc.v_desc)), nc(0), nc(c(doc.v_prod)), x?.modFrete ?? '9', nc(c(doc.v_frete)), nc(c(doc.v_seg)), nc(c(doc.v_outro)),
          nc(vlBc), nc(vlIcms), nc(vlBcSt), nc(vlSt), nc(0), '', '', '', '');
        fecharC190(g);
      } });
    }
  }

  /* ---------- CT-e tomados (bloco D) ---------- */
  const ctes = docs.filter((d) => d.modelo === '57' && d.toma_doc === cnpj && d.emit_cnpj !== cnpj && d.situacao === 'autorizada' && noPeriodo(dataLocal(d.emitida_em)));
  const d100: (() => void)[] = [];
  for (const doc of ctes) {
    resumo.cte++;
    const ref = `CT-e ${doc.numero ?? ''} (${doc.chave})`;
    const x = doc.extraCte;
    if (!x) { p.add('erro', 'xml_ausente', 'XML do CT-e não pôde ser lido do armazenamento.', ref); continue; }
    const codPart = usarPart(x.emit, ref);
    const data = dataLocal(doc.emitida_em);
    const credito = !!ant?.creditoFrete && x.icms.vICMS > 0;
    if (x.icms.vICMS > 0 && !credito) p.add('info', 'frete_sem_credito', 'CT-e com ICMS destacado escriturado sem crédito (o SPED anterior não tinha crédito de frete). Se a empresa credita o frete, ajuste.', ref);
    const cst = credito ? `0${x.icms.cst}` : '090';
    const pref = { '5': '1', '6': '2', '7': '3' }[String(doc.cfop ?? '5')[0]] ?? (x.cMunIni.slice(0, 2) === x.cMunFim.slice(0, 2) ? '1' : '2');
    const cfop = `${pref}353`;
    const indFrt = ({ '0': '0', '3': '1', '1': '2', '2': '2', '4': '2' } as Record<string, string>)[x.toma] ?? '2';
    const vServ = c(x.vTPrest); const bc = credito ? c(x.icms.vBC) : 0; const icms = credito ? c(x.icms.vICMS) : 0;
    creditos += icms;
    d100.push(() => {
      a.add('D100', '0', '1', codPart, '57', x.tpCTe === '1' ? '06' : '00', serie3(x.serie), '', String(Number(doc.numero)), doc.chave, d8(data), d8(data), x.tpCTe,
        ['3', '6'].includes(x.tpCTe) ? x.chaveSubstituida : '', nc(vServ), nc(0), indFrt, nc(vServ), nc(bc), nc(icms), nc(0), '', '', x.cMunIni, x.cMunFim);
      a.add('D190', cst, cfop, n(credito ? x.icms.pICMS : 0), nc(vServ), nc(bc), nc(icms), nc(credito && /20$/.test(cst) ? Math.max(0, vServ - bc) : 0), '');
    });
  }

  /* ---------- apuração (E110) ---------- */
  const sldAnt = antDoMesAnterior ? c(ant!.sldCredorTransportar) : 0;
  const deb = debitos.normal; const cred = creditos + sldAnt;
  const X = deb - cred;
  const sldApurado = Math.max(X, 0); const recolher = sldApurado; const transportar = Math.max(-X, 0);

  /* ---------- escrita ---------- */
  const r0005 = ant?.r0005;
  a.add('0000', codVer ?? '', o.finalidade ?? '0', d8(dtIni), d8(dtFin), t(est.razao_social, 100), cnpj, '', est.uf, dig(est.ie || ant?.ie || ''), dig(est.cod_municipio || ant?.codMun || ''),
    t(ant?.im ?? ''), '', (est.perfil_sped || ant?.perfil || 'A').toUpperCase(), '1');
  if (!est.ie && !ant?.ie) p.add('erro', 'ie', 'Inscrição estadual do estabelecimento não cadastrada.');
  if (!est.cod_municipio && !ant?.codMun) p.add('erro', 'municipio', 'Código do município (IBGE) do estabelecimento não cadastrado.');
  if (!est.perfil_sped && !ant?.perfil) p.add('alerta', 'perfil', 'Perfil do SPED (A/B/C) não informado: gerado como "A". Se a SEFAZ definiu outro perfil, o PVA recusa.');
  a.abrir('0', '0');
  a.add('0005', t(est.nome_fantasia || r0005?.[1] || est.razao_social, 60), dig(est.cep || r0005?.[2] || ''), t(est.logradouro || r0005?.[3] || '', 60), t(est.numero || r0005?.[4] || '', 10),
    t(est.complemento || r0005?.[5] || '', 60), t(est.bairro || r0005?.[6] || '', 60), dig(est.fone || r0005?.[7] || '').slice(-11), '', t(est.email || r0005?.[9] || ''));
  if (!(est.cep || r0005?.[2]) || !(est.logradouro || r0005?.[3]) || !(est.bairro || r0005?.[6])) p.add('erro', 'endereco', 'Endereço do estabelecimento incompleto (CEP, logradouro e bairro são obrigatórios no 0005).');
  if (ant?.r0100) a.add('0100', ...ant.r0100.slice(1, 14).concat(Array(Math.max(0, 13 - ant.r0100.slice(1, 14).length)).fill('')));
  else {
    p.add('erro', 'contabilista', 'Dados do contabilista (0100) vêm do SPED anterior: falta o CPF do contador. Envie o SPED do mês anterior.');
    a.add('0100', t(est.contador_nome ?? '', 100), '', t(est.contador_crc ?? '', 15), dig(est.contador_cnpj ?? ''), '', '', '', '', '', dig(est.contador_fone ?? '').slice(-11), '', t(est.contador_email ?? ''), dig(est.cod_municipio ?? ''));
  }
  for (const pt of [...participantes.values()].sort((x, y) => x.cod.localeCompare(y.cod))) {
    const brasil = !pt.codPais || pt.codPais === '1058' || pt.codPais === '01058';
    if (brasil && !pt.codMun) p.add('erro', 'participante_mun', 'Participante sem município (cMun) no XML.', pt.nome);
    a.add('0150', pt.cod, t(pt.nome || pt.cod, 100), String(Number(pt.codPais || '1058')).padStart(5, '0'), pt.cnpj, pt.cnpj ? '' : pt.cpf, pt.ie, brasil ? pt.codMun : '', t(pt.suframa, 9),
      t(pt.end || 'NAO INFORMADO', 60), t(pt.num, 10), t(pt.compl, 60), t(pt.bairro, 60));
  }
  for (const u of [...unidades].sort()) a.add('0190', u, t(descrUnid(u, ant?.unidades)));
  for (const it of [...itens0200.values()].sort((x, y) => x.cod.localeCompare(y.cod))) {
    a.add('0200', it.cod, t(it.descr || it.cod), it.ean && /^\d{8,14}$/.test(it.ean) ? it.ean : '', '', it.unidInv, it.tipo || '00', it.ncm && /^\d{8}$/.test(it.ncm) ? it.ncm : '', '',
      it.ncm && /^\d{8}$/.test(it.ncm) ? it.ncm.slice(0, 2) : '', '', '', it.cest && /^\d{7}$/.test(it.cest) ? it.cest : '');
    for (const [unid, fator] of it.conversoes) if (unid !== it.unidInv && fator > 0) a.add('0220', unid, n(fator, 6), '');
  }
  a.fechar();

  a.abrir('B', '1'); a.fechar();
  a.abrir('C', c100.length ? '0' : '1');
  for (const x of c100) x.linhas();
  a.fechar();
  a.abrir('D', d100.length ? '0' : '1');
  for (const f of d100) f();
  a.fechar();

  a.abrir('E', '0');
  a.add('E100', d8(dtIni), d8(dtFin));
  a.add('E110', nc(deb), nc(0), nc(0), nc(0), nc(creditos), nc(0), nc(0), nc(0), nc(sldAnt), nc(sldApurado), nc(0), nc(recolher), nc(transportar), nc(debitos.especial));
  if (recolher > 0) {
    const e = ant?.e116;
    const [y, m] = o.competencia.split('-').map(Number);
    const prox = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
    let venc = '';
    if (e?.dtVcto && /^\d{8}$/.test(e.dtVcto)) {
      const dia = Math.min(Number(e.dtVcto.slice(0, 2)), Number(ultimoDiaMes(prox).slice(8)));
      venc = d8(`${prox}-${String(dia).padStart(2, '0')}`);
    }
    if (!e?.codRec) p.add('erro', 'e116', 'ICMS a recolher sem código de receita e vencimento (E116): eles vêm do SPED anterior. Envie o SPED do mês anterior.');
    a.add('E116', '000', nc(recolher), venc, t(e?.codRec ?? ''), '', '', '', '', `${o.competencia.slice(5, 7)}${o.competencia.slice(0, 4)}`);
  }
  a.fechar();
  a.abrir('G', '1'); a.fechar();
  a.abrir('H', '1'); a.fechar();
  if (o.competencia.endsWith('-02')) p.add('erro', 'inventario', 'Fevereiro: o inventário de 31/12 (H005/H010) é obrigatório e ainda não é gerado pelo Appura.');
  a.abrir('K', '1'); a.fechar();
  a.abrir('1', '0');
  const r1010 = ant?.r1010 && ant.r1010.length === 14 ? ant.r1010.slice(1) : Array(13).fill('N');
  if (r1010[6] === 'S') p.add('erro', '1601', 'O 1010 indica vendas com cartão/PIX (IND_CART = S): o 1601 ainda não é gerado pelo Appura.');
  a.add('1010', ...r1010);
  a.fechar();

  const linhas = a.encerrar();
  return {
    linhas,
    pendencias: p.lista(),
    resumo: {
      tipo: 'efd_icms_ipi', competencia: o.competencia, cnpj, codVer, documentos: resumo,
      icms: { debitos: deb / 100, creditos: creditos / 100, saldoCredorAnterior: sldAnt / 100, aRecolher: recolher / 100, saldoCredorTransportar: transportar / 100 },
      registros: { C100: a.quantidade('C100'), C170: a.quantidade('C170'), C190: a.quantidade('C190'), D100: a.quantidade('D100'), '0150': a.quantidade('0150'), '0200': a.quantidade('0200') },
      linhas: linhas.length,
    },
  };
}
