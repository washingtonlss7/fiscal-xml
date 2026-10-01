/**
 * Documentos do mês que vão para a Acessórias além do DAS: recibos do SPED, DARF, DCTFWeb, Reinf, guia de ICMS
 * (enviados pelo escritório em PDF) e o recibo/declaração/MAED do PGDAS-D (guardados na transmissão).
 * O PDF fica cifrado no armazenamento; o mesmo arquivo (hash) não entra duas vezes na mesma empresa.
 * Com o envio automático ligado, o documento vai para a Acessórias assim que entra.
 */
import crypto from 'crypto';
import { Armazenamento } from '../armazenamento';
import { Db, ok } from '../db';
import { MAX_PDF, ServicoAcessorias, TIPOS_DOCUMENTO, TIPOS_UPLOAD } from '../integra/acessorias';
import { log } from '../log';

export class ErroDocumento extends Error {
  constructor(public readonly status: number, msg: string) { super(msg); }
}

const COLUNAS = 'id,empresa_id,competencia,tipo,descricao,nome,tamanho,origem,apuracao_id,criado_em,criado_por';

/** Nome do arquivo para o e-Contínuo: tipo, competência e descrição, só com caracteres seguros. */
export function nomeDocumento(tipo: string, competencia: string, original: string, descricao?: string | null) {
  const base = `${({ recibo_sped_fiscal: 'Recibo-SPED-Fiscal', recibo_sped_contribuicoes: 'Recibo-SPED-Contribuicoes', darf: 'DARF', dctfweb: 'DCTFWeb', reinf: 'Recibo-Reinf', icms: 'ICMS', pgdas_recibo: 'PGDAS-D-recibo', pgdas_declaracao: 'PGDAS-D-declaracao', maed: 'MAED', outro: 'Documento' } as Record<string, string>)[tipo] ?? 'Documento'}-${competencia}`;
  const extra = String(descricao || original.replace(/\.pdf$/i, '')).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
  return `${base}${extra ? `-${extra}` : ''}.pdf`;
}

export class ServicoDocumentosEntrega {
  constructor(private readonly db: Db, private readonly arm: Armazenamento, private readonly acessorias: ServicoAcessorias | null) {}

  /** Grava o documento e, com o envio automático ligado, manda à Acessórias. Arquivo repetido devolve o existente. */
  async registrar(empresaId: string, competencia: string, dados: { tipo: string; descricao?: string | null; nomeOriginal: string; pdf: Buffer; origem?: 'upload' | 'pgdas'; apuracaoId?: number | null; caminho?: string | null }, email: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw new ErroDocumento(400, 'Competência inválida (AAAA-MM).');
    if (!TIPOS_DOCUMENTO[dados.tipo]) throw new ErroDocumento(422, 'Escolha o tipo do documento.');
    if ((dados.origem ?? 'upload') === 'upload' && !TIPOS_UPLOAD.includes(dados.tipo)) throw new ErroDocumento(422, 'Este tipo de documento entra sozinho pela transmissão do PGDAS-D.');
    if (!dados.pdf.length) throw new ErroDocumento(400, 'Arquivo vazio.');
    if (dados.pdf.length > MAX_PDF) throw new ErroDocumento(413, 'PDF grande demais (máximo 15 MB).');
    if (dados.pdf.subarray(0, 1024).indexOf('%PDF') < 0) throw new ErroDocumento(422, 'Envie o documento em PDF: a Acessórias só lê PDF.');
    const descricao = dados.descricao ? String(dados.descricao).trim().slice(0, 120) || null : null;
    const e = ok(await this.db.from('empresas').select('id,cnpj').eq('id', empresaId).maybeSingle(), 'empresa') as { id: string; cnpj: string } | null;
    if (!e) throw new ErroDocumento(404, 'Empresa não encontrada.');
    const hash = crypto.createHash('sha256').update(dados.pdf).digest('hex');
    const existente = ok(await this.db.from('documentos_entrega').select(COLUNAS).eq('empresa_id', e.id).eq('hash', hash).maybeSingle(), 'documento existente') as any;
    if (existente) return { documento: existente, repetido: true, envio: null };
    const caminho = dados.caminho ?? await this.arm.salvar(`documentos/${e.cnpj}/${competencia}/${hash.slice(0, 16)}.pdf`, dados.pdf);
    const doc = ok(await this.db.from('documentos_entrega').insert({
      empresa_id: e.id, competencia: `${competencia}-01`, tipo: dados.tipo, descricao, nome: nomeDocumento(dados.tipo, competencia, dados.nomeOriginal, descricao),
      caminho, tamanho: dados.pdf.length, hash, origem: dados.origem ?? 'upload', apuracao_id: dados.apuracaoId ?? null, criado_em: new Date().toISOString(), criado_por: email,
    }).select(COLUNAS).single(), 'gravar documento') as any;
    log.info('documento do mês registrado', { id: doc.id, tipo: doc.tipo, empresa: e.id, por: email });
    let envio: any = null;
    if (this.acessorias && await this.acessorias.envioAutomaticoAtivo().catch(() => false)) {
      try { envio = await this.acessorias.enviarDocumento(doc.id, email); } catch (err) { envio = { status: 'erro', mensagem: (err as Error).message }; }
    }
    return { documento: doc, repetido: false, envio };
  }

  /** Recibo, declaração e MAED do PGDAS-D transmitido entram como documentos do mês (o PDF já está guardado). */
  async registrarPgdas(empresaId: string, competencia: string, apuracaoId: number, pdfs: { tipo: 'pgdas_recibo' | 'pgdas_declaracao' | 'maed'; caminho: string | null; pdf: Buffer | null }[], email: string) {
    const saida = [];
    for (const p of pdfs) {
      if (!p.caminho || !p.pdf) continue;
      try { saida.push(await this.registrar(empresaId, competencia, { tipo: p.tipo, nomeOriginal: '', pdf: p.pdf, origem: 'pgdas', apuracaoId, caminho: p.caminho }, email)); } catch (e) {
        log.warn('documento do PGDAS-D não registrado', { apuracao: apuracaoId, tipo: p.tipo, erro: (e as Error).message });
      }
    }
    return saida;
  }

  async listar(empresaId: string, competencia: string) {
    const docs = ok(await this.db.from('documentos_entrega').select(COLUNAS).eq('empresa_id', empresaId).eq('competencia', `${competencia}-01`).order('criado_em', { ascending: true }).limit(500), 'documentos') as any[];
    const envios = this.acessorias ? await this.acessorias.ultimosEnviosDocumentos(docs.map((d) => d.id)) : new Map();
    return docs.map((d) => ({ ...d, rotulo: TIPOS_DOCUMENTO[d.tipo] ?? d.tipo, envio: envios.get(d.id) ?? null }));
  }

  async porId(id: number) {
    return (ok(await this.db.from('documentos_entrega').select(`${COLUNAS},caminho`).eq('id', id).maybeSingle(), 'documento') as any) ?? null;
  }

  async baixar(id: number) {
    const d = await this.porId(id);
    if (!d) throw new ErroDocumento(404, 'Documento não encontrado.');
    return { nome: d.nome as string, conteudo: await this.arm.ler(d.caminho) };
  }

  /** Tira o documento do Appura (não apaga nada na Acessórias). Documento do PGDAS-D não sai: é o comprovante da transmissão. */
  async remover(id: number, email: string) {
    const d = await this.porId(id);
    if (!d) throw new ErroDocumento(404, 'Documento não encontrado.');
    if (d.origem === 'pgdas') throw new ErroDocumento(409, 'O comprovante do PGDAS-D não pode ser removido.');
    ok(await this.db.from('documentos_entrega').delete().eq('id', id), 'remover documento');
    log.info('documento do mês removido', { id, tipo: d.tipo, empresa: d.empresa_id, por: email });
    return { ok: true };
  }
}
