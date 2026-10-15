/**
 * NFS-e no painel: captação por empresa (liga/desliga e situação) e consulta das notas captadas no ADN, com download
 * do XML, ZIP e planilha. Tudo filtrado pelo escopo de empresas de quem consulta.
 */
import { Db, buscarTodos, ok } from '../db';
import { Aba } from './xlsx';

export class ErroNfse extends Error {
  constructor(public readonly status: number, msg: string) { super(msg); }
}

type Escopo = Set<string> | null;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
export const MAX_ZIP_NFSE = 5000;

export const PAPEIS: Record<string, string> = { prestador: 'Emitidas (prestador)', tomador: 'Recebidas (tomador)', intermediario: 'Intermediário' };
export const SITUACOES_NFSE: Record<string, string> = { autorizada: 'Autorizada', cancelada: 'Cancelada', substituida: 'Substituída' };

export interface FiltroNfse { mes?: string | null; empresa?: string | null; papel?: string | null; situacao?: string | null; busca?: string | null }

/** Situação da captação para a tela (texto e tom). */
export function situacaoCaptacao(c: { ativo: boolean; ultimo_status: string | null; erros_consecutivos: number; ultima_sync_ok_em: string | null } | null, temCert: boolean): { texto: string; tom: string } {
  if (!c || !c.ativo) return { texto: 'Desligada', tom: 'neutro' };
  if (!temCert) return { texto: 'Sem certificado', tom: 'problema' };
  if (c.erros_consecutivos > 0 || c.ultimo_status === 'erro' || c.ultimo_status === 'rejeicao') return { texto: 'Com erro', tom: 'problema' };
  if (c.ultimo_status === 'aguardando_adn') return { texto: 'Aguardando o ADN', tom: 'atencao' };
  if (!c.ultima_sync_ok_em) return { texto: 'Aguardando a primeira consulta', tom: 'pendente' };
  return { texto: 'Em dia', tom: 'ok' };
}

export class ServicoNfsePainel {
  constructor(private readonly db: Db, private readonly lerXml: (caminho: string) => Promise<Buffer>) {}

  private async empresas(escopo: Escopo) {
    const l = ok(await this.db.from('empresas').select('id,cnpj,razao_social,ativo').eq('escritorio', false).order('razao_social').limit(10000), 'empresas') as { id: string; cnpj: string; razao_social: string; ativo: boolean }[];
    return escopo ? l.filter((e) => escopo.has(e.id)) : l;
  }

  private exigir(escopo: Escopo, id: string | null | undefined) {
    if (escopo && (!id || !escopo.has(id))) throw new ErroNfse(403, 'Esta empresa não está no seu acesso. Fale com um administrador.');
  }

  /** Captação de cada empresa: ligada, situação, NSU, último contato e total de notas. */
  async captacao(escopo: Escopo) {
    const emps = await this.empresas(escopo);
    const [cap, certs] = await Promise.all([
      this.db.from('nfse_captacao').select('*').limit(10000),
      this.db.from('certificados').select('empresa_id,valido_ate').eq('ativo', true).limit(20000),
    ]);
    const porEmp = new Map((ok(cap, 'captação da NFS-e') as any[]).map((c) => [c.empresa_id, c]));
    const comCert = new Map((ok(certs, 'certificados') as any[]).map((c) => [c.empresa_id, c.valido_ate]));
    const agora = Date.now();
    const lista = emps.map((e) => {
      const c = porEmp.get(e.id) ?? null;
      const cert = comCert.get(e.id);
      const certOk = !!cert && Date.parse(cert) > agora;
      return {
        empresa_id: e.id, cnpj: e.cnpj, razao_social: e.razao_social, empresa_ativa: e.ativo, ativo: !!c?.ativo, certificado: certOk,
        ult_nsu: c ? Number(c.ult_nsu) : 0, ultima_consulta_em: c?.ultima_consulta_em ?? null, ultima_sync_ok_em: c?.ultima_sync_ok_em ?? null,
        proxima_consulta_em: c?.ativo ? c.proxima_consulta_em : null, ultimo_motivo: c?.ultimo_motivo ?? null, documentos_total: c ? Number(c.documentos_total ?? 0) : 0,
        situacao: situacaoCaptacao(c, certOk),
      };
    });
    return {
      empresas: lista,
      totais: { ligadas: lista.filter((x) => x.ativo).length, comErro: lista.filter((x) => x.ativo && x.situacao.tom === 'problema').length, emDia: lista.filter((x) => x.situacao.tom === 'ok').length },
    };
  }

  /** Liga ou desliga a captação de uma ou várias empresas. Ligar agenda a primeira consulta para já. */
  async definirCaptacao(por: string, escopo: Escopo, ids: string[], ativo: boolean) {
    if (!ids.length) throw new ErroNfse(400, 'Escolha ao menos uma empresa.');
    for (const id of ids) this.exigir(escopo, id);
    const atuais = new Set((ok(await this.db.from('nfse_captacao').select('empresa_id').in('empresa_id', ids), 'captação atual') as any[]).map((c) => c.empresa_id));
    const agora = new Date().toISOString();
    const novas = ids.filter((id) => !atuais.has(id)).map((id) => ({ empresa_id: id, ativo, proxima_consulta_em: agora, atualizado_em: agora, atualizado_por: por }));
    if (novas.length) ok(await this.db.from('nfse_captacao').insert(novas), 'ligar captação da NFS-e');
    const existentes = ids.filter((id) => atuais.has(id));
    if (existentes.length) {
      ok(await this.db.from('nfse_captacao').update({ ativo, atualizado_em: agora, atualizado_por: por, ...(ativo ? { proxima_consulta_em: agora, erros_consecutivos: 0 } : {}) }).in('empresa_id', existentes), 'atualizar captação da NFS-e');
    }
    return { alteradas: ids.length };
  }

  private consulta(f: FiltroNfse, ids: string[] | null, colunas: string) {
    let q = this.db.from('nfse_documentos').select(colunas);
    if (ids) q = q.in('empresa_id', ids);
    if (f.mes) {
      const [a, m] = f.mes.split('-').map(Number);
      const prox = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
      q = q.gte('emitida_em', `${f.mes}-01T00:00:00-03:00`).lt('emitida_em', `${prox}-01T00:00:00-03:00`);
    }
    if (f.papel && PAPEIS[f.papel]) q = q.eq('papel', f.papel);
    if (f.situacao && SITUACOES_NFSE[f.situacao]) q = q.eq('situacao', f.situacao);
    if (f.busca) {
      const b = f.busca.replace(/[%_,()]/g, ' ').trim();
      const dig = b.replace(/\D/g, '');
      if (dig.length >= 44) q = q.eq('chave', dig);
      else if (dig.length >= 11 && dig.length === b.replace(/[.\-/\s]/g, '').length) q = q.or(`prestador_doc.eq.${dig},tomador_doc.eq.${dig}`);
      else if (b) q = q.or(`prestador_nome.ilike.%${b}%,tomador_nome.ilike.%${b}%,descricao.ilike.%${b}%${/^\d{1,15}$/.test(b) ? `,numero.eq.${b}` : ''}`);
    }
    return q;
  }

  private idsDaConsulta(escopo: Escopo, f: FiltroNfse): string[] | null {
    if (f.empresa) { this.exigir(escopo, f.empresa); return [f.empresa]; }
    return escopo ? [...escopo] : null;
  }

  private validar(f: FiltroNfse) {
    if (f.mes && !MES.test(f.mes)) throw new ErroNfse(400, 'Competência inválida. Use AAAA-MM.');
    if (!f.mes && !f.empresa && !f.busca) throw new ErroNfse(400, 'Informe o mês, a empresa ou o texto da busca.');
  }

  /** Lista das notas (até 2.000) com totais por papel. */
  async listar(escopo: Escopo, f: FiltroNfse) {
    this.validar(f);
    const ids = this.idsDaConsulta(escopo, f);
    if (ids && !ids.length) return { notas: [], total: 0, totais: {}, limitado: false };
    const notas = ok(await this.consulta(f, ids, 'id,empresa_id,chave,papel,numero,competencia,emitida_em,prestador_doc,prestador_nome,tomador_doc,tomador_nome,cod_trib_nac,descricao,valor_servico,valor_iss,iss_retido,valor_liquido,situacao,mun_incidencia')
      .order('emitida_em', { ascending: false }).limit(2001), 'NFS-e') as any[];
    const limitado = notas.length > 2000;
    const lista = notas.slice(0, 2000).map((n) => ({ ...n, valor_servico: n.valor_servico == null ? null : Number(n.valor_servico), valor_iss: n.valor_iss == null ? null : Number(n.valor_iss), valor_liquido: n.valor_liquido == null ? null : Number(n.valor_liquido) }));
    const emps = new Map((await this.empresas(escopo)).map((e) => [e.id, e.razao_social]));
    const totais: Record<string, { quantidade: number; valor: number; iss: number }> = {};
    for (const n of lista) {
      if (n.situacao !== 'autorizada') continue;
      const t = totais[n.papel] ?? { quantidade: 0, valor: 0, iss: 0 };
      t.quantidade++; t.valor = Math.round((t.valor + (n.valor_servico ?? 0)) * 100) / 100; t.iss = Math.round((t.iss + (n.valor_iss ?? 0)) * 100) / 100;
      totais[n.papel] = t;
    }
    return { notas: lista.map((n) => ({ ...n, empresa: emps.get(n.empresa_id) ?? '' })), total: lista.length, totais, limitado };
  }

  /** XML de uma nota. */
  async xml(escopo: Escopo, id: number) {
    const n = ok(await this.db.from('nfse_documentos').select('empresa_id,chave,xml_path').eq('id', id).maybeSingle(), 'NFS-e') as any;
    if (!n) throw new ErroNfse(404, 'NFS-e não encontrada.');
    this.exigir(escopo, n.empresa_id);
    if (!n.xml_path) throw new ErroNfse(404, 'XML não disponível.');
    return { nome: `NFSe_${n.chave}.xml`, conteudo: await this.lerXml(n.xml_path) };
  }

  /** Notas para o ZIP (até 5.000). */
  async paraZip(escopo: Escopo, f: FiltroNfse) {
    this.validar(f);
    const ids = this.idsDaConsulta(escopo, f);
    if (ids && !ids.length) throw new ErroNfse(404, 'Nenhuma NFS-e com esses filtros.');
    const l = await buscarTodos<any>((a, b) => this.consulta(f, ids, 'empresa_id,chave,papel,situacao,xml_path').not('xml_path', 'is', null).order('emitida_em').range(a, b), 'NFS-e para o ZIP');
    if (!l.length) throw new ErroNfse(404, 'Nenhuma NFS-e com esses filtros.');
    if (l.length > MAX_ZIP_NFSE) throw new ErroNfse(413, `São ${l.length.toLocaleString('pt-BR')} notas: o ZIP tem limite de ${MAX_ZIP_NFSE.toLocaleString('pt-BR')}. Filtre por empresa ou papel.`);
    const cnpj = new Map((await this.empresas(escopo)).map((e) => [e.id, e.cnpj]));
    const variasEmpresas = new Set(l.map((n) => n.empresa_id)).size > 1;
    const pasta: Record<string, string> = { prestador: 'emitidas', tomador: 'recebidas', intermediario: 'intermediario' };
    return l.map((n) => ({
      caminho: n.xml_path as string,
      nome: `${variasEmpresas ? `${cnpj.get(n.empresa_id) ?? n.empresa_id}/` : ''}NFSe/${pasta[n.papel]}${n.situacao !== 'autorizada' ? '/canceladas' : ''}/${n.chave}.xml`,
    }));
  }

  /** Planilha das notas do filtro. */
  async planilha(escopo: Escopo, f: FiltroNfse): Promise<{ nome: string; abas: Aba[] }> {
    const r = await this.listar(escopo, f);
    const doc = (d: string | null) => (d && d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d && d.length === 11 ? d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4') : d ?? '');
    return {
      nome: `nfse_${f.mes ?? 'busca'}.xlsx`,
      abas: [{
        nome: 'NFS-e', cabecalho: ['NFS-e (padrão nacional)', `${r.total} nota(s)${r.limitado ? ' — limitado a 2.000: filtre mais' : ''}`],
        colunas: [
          { titulo: 'Empresa', tipo: 'texto', largura: 32 }, { titulo: 'Papel', tipo: 'texto', largura: 12 }, { titulo: 'Número', tipo: 'texto', largura: 10 },
          { titulo: 'Emissão', tipo: 'data', largura: 12 }, { titulo: 'Competência', tipo: 'data', largura: 12 },
          { titulo: 'Prestador', tipo: 'texto', largura: 32 }, { titulo: 'CNPJ/CPF prestador', tipo: 'texto', largura: 20 },
          { titulo: 'Tomador', tipo: 'texto', largura: 32 }, { titulo: 'CNPJ/CPF tomador', tipo: 'texto', largura: 20 },
          { titulo: 'Código de tributação', tipo: 'texto', largura: 10 }, { titulo: 'Descrição', tipo: 'texto', largura: 40 },
          { titulo: 'Valor do serviço', tipo: 'moeda', total: true, largura: 15 }, { titulo: 'ISS', tipo: 'moeda', total: true, largura: 12 },
          { titulo: 'ISS retido', tipo: 'texto', largura: 9 }, { titulo: 'Valor líquido', tipo: 'moeda', total: true, largura: 15 },
          { titulo: 'Situação', tipo: 'texto', largura: 12 }, { titulo: 'Chave', tipo: 'texto', largura: 54 },
        ],
        linhas: r.notas.map((n: any) => [n.empresa, n.papel === 'prestador' ? 'Emitida' : n.papel === 'tomador' ? 'Recebida' : 'Intermediário', n.numero ?? '',
          n.emitida_em ? String(n.emitida_em).slice(0, 10) : null, n.competencia, n.prestador_nome ?? '', doc(n.prestador_doc), n.tomador_nome ?? '', doc(n.tomador_doc),
          n.cod_trib_nac ?? '', n.descricao ?? '', n.valor_servico, n.valor_iss, n.iss_retido == null ? '' : n.iss_retido ? 'Sim' : 'Não', n.valor_liquido,
          SITUACOES_NFSE[n.situacao] ?? n.situacao, n.chave]),
      }],
    };
  }
}
