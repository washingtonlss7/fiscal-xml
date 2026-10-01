import { Armazenamento } from '../armazenamento';
import { Db, ok } from '../db';
import { parser, acharTag } from '../sefaz/distDFe';
import { processarDoc } from '../sync';
import { emParalelo } from '../util';
import { ArquivoZip, ehZip, lerZip } from './zipLeitor';

/**
 * Importação de XMLs enviados pelo escritório (NF-e e NFC-e de saída, que a SEFAZ não devolve
 * para o próprio emitente; também serve para entradas e CT-e que faltarem).
 */

export interface EmpresaImportacao {
  id: string;
  cnpj: string;
  c_uf: number;
}

export type Situacao = 'importada' | 'completou_resumo' | 'ja_existia' | 'rejeitada' | 'rejeitada_sefaz';

export interface ResultadoArquivo {
  arquivo: string;
  situacao: Situacao;
  chave?: string;
  modelo?: string;
  direcao?: 'entrada' | 'saida';
  motivo?: string;
}

export interface ResumoImportacao {
  arquivos: number;
  /** Notas que a SEFAZ rejeitou (não são documentos válidos): guardadas em notas_rejeitadas para conferência. */
  rejeitadasSefaz: number;
  importadas: number;
  completouResumo: number;
  jaExistiam: number;
  rejeitadas: number;
  porModelo: Record<string, number>;
  resultados: ResultadoArquivo[];
}

const AUTORIZADA = new Set(['100', '150']);
const DENEGADA = new Set(['110', '301', '302', '303', '304', '305', '306']);
/** Protocolo do cancelamento no lugar do da autorização (alguns sistemas de venda guardam assim): entra como cancelada. */
const CANCELADA = new Set(['101', '151', '155']);
const EVENTO_OK = new Set(['135', '136', '155']);

/** Decodifica o XML respeitando o encoding declarado e devolve texto UTF-8 com o prólogo ajustado. */
export function decodificarXml(b: Buffer): string {
  let bytes = b;
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) bytes = bytes.subarray(3);
  const cabeca = bytes.subarray(0, 200).toString('latin1');
  const enc = cabeca.match(/<\?xml[^>]*encoding=["']([^"']+)["']/i)?.[1]?.toLowerCase();
  const latin = enc && /^(iso-8859-1|latin1|windows-1252|cp1252)$/.test(enc);
  let texto = bytes.toString(latin ? 'latin1' : 'utf8');
  if (latin) texto = texto.replace(/(<\?xml[^>]*encoding=["'])[^"']+(["'])/i, '$1UTF-8$2');
  return texto.trim();
}

/** Nota que a SEFAZ rejeitou (protocolo com cStat de rejeição): não é documento fiscal, mas a venda precisa ser regularizada. */
export interface NotaRejeitada {
  chave: string; modelo: '55' | '65'; serie: string | null; numero: string | null; tpEmis: string | null; emitidaEm: string | null;
  valor: number | null; emit?: string; cStat: string; motivo: string;
}

export class RejeitadaSefaz extends Error {
  constructor(public readonly nota: NotaRejeitada) { super(`rejeitada pela SEFAZ (${nota.cStat}: ${nota.motivo})`); }
}

export interface XmlPreparado {
  schema: string;
  xml: string;
  chave: string;
  modelo: '55' | '57' | '65';
  emit?: string;
  dest?: string;
  evento: boolean;
}

/** Identifica o tipo do XML e confere se é um documento autorizado pela SEFAZ (com protocolo). */
export function prepararXml(texto: string): XmlPreparado {
  if (!texto.startsWith('<')) throw new Error('não é um arquivo XML.');
  let o: any;
  try {
    o = parser.parse(texto);
  } catch {
    throw new Error('XML malformado.');
  }
  const raiz = Object.keys(o).find((k) => !k.startsWith('?')) ?? '';
  const txt = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : String(v));

  if (raiz === 'nfeProc' || raiz === 'NFe') {
    const inf = acharTag(o, 'infNFe');
    if (!inf) throw new Error('NF-e sem o grupo infNFe.');
    const prot = acharTag(o, 'infProt');
    if (!prot) throw new Error('nota sem protocolo de autorização da SEFAZ (XML só assinado, não autorizado).');
    const cStat = txt(prot.cStat) ?? '';
    const chave = txt(prot.chNFe) ?? String(inf['@_Id'] ?? '').replace(/^\D+/, '');
    if (!/^\d{44}$/.test(chave)) throw new Error('chave de acesso inválida.');
    const mod = txt(inf.ide?.mod) === '65' ? '65' : '55';
    if (!AUTORIZADA.has(cStat) && !DENEGADA.has(cStat) && !CANCELADA.has(cStat)) {
      const v = Number(inf.total?.ICMSTot?.vNF);
      throw new RejeitadaSefaz({
        chave, modelo: mod, serie: txt(inf.ide?.serie) ?? null, numero: txt(inf.ide?.nNF) ?? null, tpEmis: txt(inf.ide?.tpEmis) ?? null,
        emitidaEm: txt(inf.ide?.dhEmi) ?? null, valor: Number.isFinite(v) ? v : null, emit: txt(inf.emit?.CNPJ) ?? txt(inf.emit?.CPF),
        cStat: cStat || '?', motivo: (txt(prot.xMotivo) ?? 'não autorizada').slice(0, 300),
      });
    }
    return {
      schema: 'procNFe_v4.00.xsd', xml: texto, chave, modelo: mod, evento: false,
      emit: txt(inf.emit?.CNPJ) ?? txt(inf.emit?.CPF),
      dest: txt(inf.dest?.CNPJ) ?? txt(inf.dest?.CPF),
    };
  }

  if (raiz === 'cteProc') {
    const inf = acharTag(o, 'infCte');
    const prot = acharTag(o, 'infProt');
    if (!inf || !prot) throw new Error('CT-e sem protocolo de autorização.');
    const cStat = txt(prot.cStat) ?? '';
    if (!AUTORIZADA.has(cStat)) throw new Error(`protocolo com situação ${cStat}.`);
    const chave = txt(prot.chCTe) ?? '';
    if (!/^\d{44}$/.test(chave)) throw new Error('chave de acesso inválida.');
    const partes = [inf.emit, inf.rem, inf.dest, inf.exped, inf.receb, inf.ide?.toma4].map((x: any) => txt(x?.CNPJ) ?? txt(x?.CPF));
    return { schema: 'procCTe_v4.00.xsd', xml: texto, chave, modelo: '57', evento: false, emit: partes[0], dest: partes.slice(1).filter(Boolean).join(',') };
  }

  if (raiz === 'procEventoNFe' || raiz === 'procEventoCTe') {
    const inf = acharTag(o, 'infEvento');
    const ret = acharTag(acharTag(o, 'retEvento') ?? {}, 'infEvento') ?? {};
    const cStat = txt(ret.cStat) ?? '';
    if (!EVENTO_OK.has(cStat)) throw new Error(`evento não registrado pela SEFAZ (situação ${cStat || 'desconhecida'}).`);
    const chave = txt(inf?.chNFe) ?? txt(inf?.chCTe) ?? '';
    if (!/^\d{44}$/.test(chave)) throw new Error('evento com chave inválida.');
    return {
      schema: raiz === 'procEventoNFe' ? 'procEventoNFe_v1.00.xsd' : 'procEventoCTe_v4.00.xsd', xml: texto, chave,
      modelo: chave.slice(20, 22) === '57' ? '57' : chave.slice(20, 22) === '65' ? '65' : '55', evento: true,
      emit: txt(inf?.CNPJ) ?? txt(inf?.CPF),
    };
  }

  throw new Error(`tipo de XML não reconhecido (<${raiz || '?'}>). Envie NF-e, NFC-e, CT-e ou eventos autorizados.`);
}

/** Abre o que foi enviado (XML solto ou ZIP) e devolve a lista de XMLs. */
export function abrirEnvio(nome: string, conteudo: Buffer): ArquivoZip[] {
  if (ehZip(conteudo)) {
    const itens = lerZip(conteudo, (n) => /\.xml$/i.test(n) || /\.zip$/i.test(n));
    // ZIP dentro de ZIP (um nível), comum em exportações de ERP
    return itens.flatMap((a) => (ehZip(a.conteudo) ? lerZip(a.conteudo, (n) => /\.xml$/i.test(n)).map((x) => ({ nome: `${a.nome}/${x.nome}`, conteudo: x.conteudo })) : [a]));
  }
  return [{ nome, conteudo }];
}

/** Importa os XMLs para a empresa. Só aceita documentos em que a empresa é emitente ou destinatária/participante. */
export async function importarXmls(
  db: Db,
  arm: Armazenamento,
  empresa: EmpresaImportacao,
  arquivos: ArquivoZip[],
): Promise<ResumoImportacao> {
  const resultados: ResultadoArquivo[] = [];
  const preparados: { arquivo: string; p: XmlPreparado }[] = [];
  const rejeitadasSefaz: { arquivo: string; nota: NotaRejeitada }[] = [];
  const vistas = new Set<string>();

  for (const a of arquivos) {
    try {
      const p = prepararXml(decodificarXml(a.conteudo));
      const participa = p.emit === empresa.cnpj || (p.dest ?? '').split(',').includes(empresa.cnpj);
      if (!participa && !p.evento) throw new Error(`o CNPJ da empresa não é emitente nem destinatário desta nota (emitente ${p.emit ?? '?'}).`);
      const id = `${p.chave}:${p.evento ? p.schema + p.xml.length : 'doc'}`;
      if (vistas.has(id)) {
        resultados.push({ arquivo: a.nome, situacao: 'ja_existia', chave: p.chave, modelo: p.modelo, motivo: 'repetida no mesmo envio' });
        continue;
      }
      vistas.add(id);
      preparados.push({ arquivo: a.nome, p });
    } catch (e) {
      if (e instanceof RejeitadaSefaz && e.nota.emit === empresa.cnpj) {
        if (!vistas.has(`rej:${e.nota.chave}`)) { vistas.add(`rej:${e.nota.chave}`); rejeitadasSefaz.push({ arquivo: a.nome, nota: e.nota }); }
        resultados.push({ arquivo: a.nome, situacao: 'rejeitada_sefaz', chave: e.nota.chave, modelo: e.nota.modelo, motivo: e.message });
      } else {
        resultados.push({ arquivo: a.nome, situacao: 'rejeitada', motivo: (e as Error).message });
      }
    }
  }

  // Notas rejeitadas pela SEFAZ do próprio emitente: guardadas para o escritório cobrar a regularização (não viram documento)
  for (let i = 0; i < rejeitadasSefaz.length; i += 500) {
    ok(await db.from('notas_rejeitadas').upsert(rejeitadasSefaz.slice(i, i + 500).map(({ nota: n }) => ({
      empresa_id: empresa.id, chave: n.chave, modelo: n.modelo, serie: n.serie, numero: n.numero, tp_emis: n.tpEmis, emitida_em: n.emitidaEm,
      valor: n.valor, cstat: n.cStat, motivo: n.motivo, importado_em: new Date().toISOString(),
    })), { onConflict: 'empresa_id,chave' }), 'gravar notas rejeitadas');
  }

  // O que já está no banco (completo = pula; só resumo = completa)
  const existentes = new Map<string, boolean>();
  const chavesDocs = [...new Set(preparados.filter((x) => !x.p.evento).map((x) => x.p.chave))];
  for (let i = 0; i < chavesDocs.length; i += 200) {
    const r = ok(
      await db.from('documentos').select('chave,completo').eq('empresa_id', empresa.id).in('chave', chavesDocs.slice(i, i + 200)),
      'conferir existentes',
    ) as { chave: string; completo: boolean }[];
    for (const d of r) existentes.set(d.chave, d.completo);
  }

  const ctx = { db, arm, clientes: undefined };
  const docs = preparados.filter((x) => !x.p.evento);
  const eventos = preparados.filter((x) => x.p.evento);
  const gravar = async ({ arquivo, p }: { arquivo: string; p: XmlPreparado }) => {
    const direcao = p.emit === empresa.cnpj ? 'saida' : 'entrada';
    if (!p.evento && existentes.get(p.chave) === true) {
      resultados.push({ arquivo, situacao: 'ja_existia', chave: p.chave, modelo: p.modelo, direcao });
      return;
    }
    try {
      await processarDoc(ctx, empresa, p.modelo === '57' ? 'cte' : 'nfe', { nsu: '', schema: p.schema, xml: p.xml }, 'importacao');
      resultados.push({
        arquivo, chave: p.chave, modelo: p.modelo, direcao: p.evento ? undefined : direcao,
        situacao: !p.evento && existentes.get(p.chave) === false ? 'completou_resumo' : 'importada',
      });
    } catch (e) {
      resultados.push({ arquivo, situacao: 'rejeitada', chave: p.chave, motivo: `erro ao gravar: ${(e as Error).message}` });
    }
  };
  // Notas em paralelo; eventos depois (o cancelamento precisa achar a nota já gravada)
  await emParalelo(docs, 8, gravar);
  for (const e of eventos) await gravar(e);

  const conta = (s: Situacao) => resultados.filter((r) => r.situacao === s).length;
  const porModelo: Record<string, number> = {};
  for (const r of resultados) {
    if (r.situacao !== 'importada' && r.situacao !== 'completou_resumo') continue;
    const k = `${r.modelo === '65' ? 'NFC-e' : r.modelo === '57' ? 'CT-e' : 'NF-e'}${r.direcao === 'saida' ? ' saída' : r.direcao === 'entrada' ? ' entrada' : ' evento'}`;
    porModelo[k] = (porModelo[k] ?? 0) + 1;
  }
  return {
    arquivos: arquivos.length,
    rejeitadasSefaz: conta('rejeitada_sefaz'),
    importadas: conta('importada'),
    completouResumo: conta('completou_resumo'),
    jaExistiam: conta('ja_existia'),
    rejeitadas: conta('rejeitada'),
    porModelo,
    resultados,
  };
}

/** Agrupa os motivos de recusa (números longos viram #) para o registro e a tela: [{ motivo, quantidade, exemplos }]. */
export function agruparMotivos(resultados: ResultadoArquivo[], limite = 20) {
  const g = new Map<string, { motivo: string; quantidade: number; exemplos: string[] }>();
  for (const r of resultados) {
    if (r.situacao !== 'rejeitada') continue;
    const chave = String(r.motivo ?? 'motivo não informado').replace(/\d{4,}/g, '#').slice(0, 160);
    const x = g.get(chave) ?? { motivo: chave, quantidade: 0, exemplos: [] };
    x.quantidade++;
    if (x.exemplos.length < 3) x.exemplos.push(r.arquivo);
    g.set(chave, x);
  }
  return [...g.values()].sort((a, b) => b.quantidade - a.quantidade).slice(0, limite);
}
