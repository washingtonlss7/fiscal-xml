/**
 * Geração do SPED pelo Appura: carrega os documentos do mês (banco + XML guardado), o SPED do mês anterior,
 * roda o gerador puro (src/sped/gerar), valida o arquivo com o MESMO leitor dos SPEDs recebidos, guarda a versão
 * (R2 cifrado) e, quando o escritório pede, "audita": envia a versão pelo caminho de um SPED recebido
 * (comparação XML × SPED, cruzamento Fiscal × Contribuições, monofásico, justificativas).
 */
import crypto from 'crypto';
import { buscarTodos, Db, ok } from '../db';
import type { Armazenamento } from '../armazenamento';
import { log } from '../log';
import { emParalelo } from '../util';
import { analisarEfd, decodificarSped } from '../sped/efd';
import { analisarContribuicoes } from '../sped/contribuicoes';
import { AnteriorContrib, AnteriorIcms, anteriorContrib, anteriorIcms } from '../sped/gerar/anterior';
import { gerarEfdIcms } from '../sped/gerar/icms';
import { gerarEfdContribuicoes } from '../sped/gerar/contribuicoes';
import { ErroGeracao, paraBuffer } from '../sped/gerar/escrita';
import { DocFiscal, Estabelecimento } from '../sped/gerar/tipos';
import { extraCTe, extraNFe } from '../sped/gerar/xml';
import type { ServicoSped } from './sped';

export class ErroGerarSped extends Error {
  constructor(public readonly status: number, msg: string) {
    super(msg);
  }
}

export type TipoSped = 'efd_icms_ipi' | 'efd_contribuicoes';
const COLUNAS_EMPRESA = 'id,cnpj,razao_social,uf,regime,ativo,ie,cod_municipio,nome_fantasia,cep,logradouro,numero,complemento,bairro,fone,email,perfil_sped,contador_nome,contador_crc,contador_cnpj,contador_email,contador_fone';
const COLUNAS_DOC = 'chave,modelo,serie,numero,situacao,completo,emitida_em,tp_nf,fin_nfe,emit_cnpj,dest_doc,toma_doc,uf_emit,cfop,valor,v_prod,v_desc,v_frete,v_seg,v_outro,xml_path,direcao';
const COLUNAS_ITEM = 'chave,n_item,c_prod,ean,x_prod,ncm,cest,cfop,u_com,q_com,v_prod,v_desc,v_frete,v_seg,v_outro,orig,cst_icms,csosn,p_red_bc,v_bc_icms,p_icms,v_icms,v_fcp,v_bc_st,p_icms_st,v_icms_st,v_fcp_st,v_ipi,cst_pis,cst_cofins,cfop_escrit';
const NUM_ITEM = ['q_com', 'v_prod', 'v_desc', 'v_frete', 'v_seg', 'v_outro', 'p_red_bc', 'v_bc_icms', 'p_icms', 'v_icms', 'v_fcp', 'v_bc_st', 'p_icms_st', 'v_icms_st', 'v_fcp_st', 'v_ipi'];
const COLUNAS_GERADO = 'id,empresa_id,competencia,tipo,versao,nome,tamanho,resumo,pendencias,validacao,erros,alertas,gerado_por,gerado_em,auditado_arquivo_id';

const intervalo = (comp: string) => {
  const [y, m] = comp.split('-').map(Number);
  const prox = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  // Um dia de folga nas pontas: o filtro exato pela data local é feito no gerador
  const ini = new Date(Date.UTC(y, m - 1, 1) - 86_400_000).toISOString();
  const fim = new Date(Date.UTC(Number(prox.slice(0, 4)), Number(prox.slice(5, 7)) - 1, 1) + 86_400_000).toISOString();
  return { ini, fim };
};

export class ServicoGerarSped {
  constructor(private db: Db, private arm: Armazenamento, private sped: ServicoSped | null = null, private lerXml: ((caminho: string) => Promise<Buffer>) | null = null) {}

  private async empresa(id: string) {
    const e = ok(await this.db.from('empresas').select(COLUNAS_EMPRESA).eq('id', id).maybeSingle(), 'empresa') as any;
    if (!e) throw new ErroGerarSped(404, 'Empresa não encontrada.');
    return e;
  }

  /** Documentos do mês com itens e os campos extras do XML (NF-e 55 e CT-e). */
  async documentos(empresaId: string, competencia: string): Promise<{ docs: DocFiscal[]; xmlFalhou: number }> {
    const { ini, fim } = intervalo(competencia);
    const notas = await buscarTodos<any>((a, b) => this.db.from('documentos').select(COLUNAS_DOC).eq('empresa_id', empresaId).gte('emitida_em', ini).lt('emitida_em', fim)
      .order('chave').range(a, b), 'documentos do mês');
    const comItens = notas.filter((n) => n.completo && n.modelo !== '57').map((n) => n.chave);
    const itens = new Map<string, any[]>();
    for (let i = 0; i < comItens.length; i += 150) {
      const l = await buscarTodos<any>((a, b) => this.db.from('documento_itens').select(COLUNAS_ITEM).eq('empresa_id', empresaId).in('chave', comItens.slice(i, i + 150))
        .order('chave').order('n_item').range(a, b), 'itens do mês');
      for (const it of l) {
        for (const k of NUM_ITEM) it[k] = it[k] === null || it[k] === undefined ? null : Number(it[k]);
        (itens.get(it.chave) ?? itens.set(it.chave, []).get(it.chave)!).push(it);
      }
    }
    let xmlFalhou = 0;
    const docs: DocFiscal[] = notas.map((n) => ({
      ...n, valor: n.valor === null ? null : Number(n.valor), v_prod: Number(n.v_prod ?? 0), v_desc: Number(n.v_desc ?? 0), v_frete: Number(n.v_frete ?? 0),
      v_seg: Number(n.v_seg ?? 0), v_outro: Number(n.v_outro ?? 0), itens: itens.get(n.chave) ?? [], extraNfe: null, extraCte: null,
    }));
    // Campos do XML que não estão no banco: só para NF-e 55 e CT-e (as NFC-e não precisam)
    const precisam = docs.filter((d) => (d.modelo === '55' || d.modelo === '57') && d.situacao === 'autorizada' && (notas.find((n) => n.chave === d.chave)?.xml_path));
    const ler = this.lerXml ?? ((c: string) => this.arm.ler(c));
    await emParalelo(precisam, 8, async (d) => {
      const caminho = notas.find((n) => n.chave === d.chave)!.xml_path;
      try {
        const xml = (await ler(caminho)).toString('utf8');
        if (d.modelo === '57') d.extraCte = extraCTe(xml); else d.extraNfe = extraNFe(xml);
      } catch (e) {
        xmlFalhou++;
        log.warn('SPED: XML não lido', { chave: d.chave, erro: (e as Error).message });
      }
    });
    return { docs, xmlFalhou };
  }

  /** Último SPED do tipo recebido antes da competência (o "mês anterior"). */
  private async anterior(empresaId: string, competencia: string, tipo: TipoSped): Promise<{ texto: string; competencia: string } | null> {
    const l = ok(await this.db.from('sped_arquivos').select('caminho,competencia').eq('empresa_id', empresaId).eq('tipo', tipo).lt('competencia', `${competencia}-01`)
      .order('competencia', { ascending: false }).order('enviado_em', { ascending: false }).limit(1), 'SPED anterior') as { caminho: string; competencia: string }[];
    if (!l.length) return null;
    try {
      return { texto: decodificarSped(await this.arm.ler(l[0].caminho)).texto, competencia: String(l[0].competencia).slice(0, 7) };
    } catch (e) {
      log.warn('SPED anterior não lido', { empresaId, erro: (e as Error).message });
      return null;
    }
  }

  async gerar(empresaId: string, competencia: string, tipo: TipoSped, email: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw new ErroGerarSped(400, 'Competência inválida (AAAA-MM).');
    const e = await this.empresa(empresaId);
    let resultado; let dono = e; let xmlFalhou = 0;
    try {
      if (tipo === 'efd_icms_ipi') {
        if (!['real', 'presumido'].includes(e.regime)) throw new ErroGerarSped(422, 'O SPED Fiscal é gerado para empresas do Lucro Real e Presumido. Confira o regime no cadastro.');
        const d = await this.documentos(e.id, competencia); xmlFalhou = d.xmlFalhou;
        const ant = await this.anterior(e.id, competencia, 'efd_icms_ipi');
        const anteriorI: AnteriorIcms | null = ant ? anteriorIcms(ant.texto) : null;
        resultado = gerarEfdIcms({ ...e, docs: d.docs } as Estabelecimento, { competencia, anterior: anteriorI });
      } else {
        if (e.regime !== 'real') throw new ErroGerarSped(422, e.regime === 'presumido' ? 'SPED Contribuições do Lucro Presumido (regime cumulativo) ainda não é gerado: por enquanto só o Lucro Real (não cumulativo).' : 'O SPED Contribuições é gerado para empresas do Lucro Real. Confira o regime no cadastro.');
        // A EFD-Contribuições é da matriz, com todas as filiais do Lucro Real
        const irmas = ok(await this.db.from('empresas').select(COLUNAS_EMPRESA).like('cnpj', `${e.cnpj.slice(0, 8)}%`), 'filiais') as any[];
        const estabs = irmas.filter((x) => x.regime === 'real' && (x.ativo || x.id === e.id))
          .sort((x, y) => (x.cnpj.slice(8, 12) === '0001' ? -1 : y.cnpj.slice(8, 12) === '0001' ? 1 : x.cnpj.localeCompare(y.cnpj)));
        if (estabs[0]?.cnpj.slice(8, 12) !== '0001') throw new ErroGerarSped(422, 'Cadastre a matriz (CNPJ 0001) no Appura: a EFD-Contribuições é entregue pela matriz, com todas as filiais.');
        dono = estabs[0];
        const comDocs: Estabelecimento[] = [];
        for (const x of estabs) { const d = await this.documentos(x.id, competencia); xmlFalhou += d.xmlFalhou; comDocs.push({ ...x, docs: d.docs }); }
        const ant = await this.anterior(dono.id, competencia, 'efd_contribuicoes');
        const anteriorC: AnteriorContrib | null = ant ? anteriorContrib(ant.texto) : null;
        resultado = gerarEfdContribuicoes(comDocs, { competencia, anterior: anteriorC });
      }
    } catch (x) {
      if (x instanceof ErroGeracao) throw new ErroGerarSped(422, `Não foi possível gerar o arquivo: ${x.message}`);
      throw x;
    }
    if (xmlFalhou) resultado.pendencias.unshift({ nivel: 'erro', codigo: 'xml_ausente', texto: `${xmlFalhou} XML(s) não puderam ser lidos do armazenamento: os documentos foram escriturados sem participante, frete ou pagamento.`, quantidade: xmlFalhou });

    const buf = paraBuffer(resultado.linhas);
    // Validação com o mesmo leitor dos SPEDs recebidos
    const val = tipo === 'efd_icms_ipi' ? analisarEfd(buf) : analisarContribuicoes(buf);
    const validacao = val.ocorrencias;
    const erros = resultado.pendencias.filter((p) => p.nivel === 'erro').length + validacao.filter((o) => o.nivel === 'erro').length;
    const alertas = resultado.pendencias.filter((p) => p.nivel === 'alerta').length + validacao.filter((o) => o.nivel === 'alerta').length;
    const ultima = ok(await this.db.from('sped_gerados').select('versao').eq('empresa_id', dono.id).eq('competencia', `${competencia}-01`).eq('tipo', tipo)
      .order('versao', { ascending: false }).limit(1), 'versão') as { versao: number }[];
    const versao = (ultima[0]?.versao ?? 0) + 1;
    const aaaamm = competencia.replace('-', '');
    const nome = `${tipo === 'efd_icms_ipi' ? 'SPED-FISCAL' : 'SPED-CONTRIBUICOES'}_${dono.cnpj}_${aaaamm}_v${versao}.txt`;
    const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
    const caminho = await this.arm.salvar(`sped-gerado/${dono.cnpj}/${competencia}/${tipo}-v${versao}.txt`, buf);
    const linha = ok(await this.db.from('sped_gerados').insert({
      empresa_id: dono.id, competencia: `${competencia}-01`, tipo, versao, nome, caminho, tamanho: buf.length, sha256,
      resumo: { ...resultado.resumo, validacao: val.resumo }, pendencias: resultado.pendencias, validacao, erros, alertas, gerado_por: email,
    }).select(COLUNAS_GERADO).single(), 'gravar SPED gerado');
    log.info('SPED gerado', { tipo, cnpj: dono.cnpj, competencia, versao, linhas: resultado.linhas.length, erros, alertas, por: email });
    return linha;
  }

  /** Versões geradas da competência (a empresa e, no Contribuições, a matriz). */
  async listar(empresaId: string, competencia: string) {
    const e = await this.empresa(empresaId);
    const matriz = e.cnpj.slice(8, 12) === '0001' ? e : ((ok(await this.db.from('empresas').select('id').like('cnpj', `${e.cnpj.slice(0, 8)}0001%`).limit(1), 'matriz') as any[])[0] ?? null);
    const ids = [...new Set([e.id, ...(matriz?.id ? [matriz.id] : [])])];
    const l = ok(await this.db.from('sped_gerados').select(COLUNAS_GERADO).in('empresa_id', ids).eq('competencia', `${competencia}-01`)
      .order('versao', { ascending: false }).limit(40), 'SPEDs gerados') as any[];
    return {
      regime: e.regime, matriz: e.cnpj.slice(8, 12) === '0001',
      fiscal: l.filter((x) => x.tipo === 'efd_icms_ipi' && x.empresa_id === e.id),
      contribuicoes: l.filter((x) => x.tipo === 'efd_contribuicoes'),
    };
  }

  async baixar(id: number) {
    const g = ok(await this.db.from('sped_gerados').select('id,nome,caminho').eq('id', id).maybeSingle(), 'SPED gerado') as any;
    if (!g) throw new ErroGerarSped(404, 'Arquivo não encontrado.');
    return { nome: g.nome as string, conteudo: await this.arm.ler(g.caminho) };
  }

  /** Envia a versão gerada pela auditoria do mês (vira o SPED vigente da competência, com todas as comparações). */
  async auditar(id: number, email: string) {
    if (!this.sped) throw new ErroGerarSped(503, 'Auditoria indisponível neste servidor.');
    const g = ok(await this.db.from('sped_gerados').select('id,empresa_id,nome,caminho').eq('id', id).maybeSingle(), 'SPED gerado') as any;
    if (!g) throw new ErroGerarSped(404, 'Arquivo não encontrado.');
    const e = await this.empresa(g.empresa_id);
    const r = await this.sped.receber(g.nome, await this.arm.ler(g.caminho), email, { id: e.id, cnpj: e.cnpj }) as any;
    if (r.valido && r.id) ok(await this.db.from('sped_gerados').update({ auditado_arquivo_id: r.id }).eq('id', id), 'marcar auditado');
    log.info('SPED gerado enviado para a auditoria', { id, arquivo: r.id, por: email });
    return r;
  }
}
