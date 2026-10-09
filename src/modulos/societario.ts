/**
 * Societário: cadastro societário de cada cliente (sócios, capital, CNAE…), documentos com vencimento (alvarás,
 * licenças, certidões, procurações) e processos (abertura, alteração, baixa) com etapas. Também cadastra cliente
 * sem certificado (empresa que o escritório atende mas cuja captação de notas ainda não está ligada).
 */
import { Db, ok } from '../db';
import { Armazenamento } from '../armazenamento';
import { codigoUf } from '../uf';
import { Escopo, ErroModulo, dataOpcional, empresasDoEscopo, exigirEmpresaNoEscopo, hojeSP, numeroOpcional, so, somarDias, txt } from './comum';

export const TIPOS_DOCUMENTO: Record<string, string> = {
  alvara: 'Alvará de funcionamento', licenca_sanitaria: 'Licença sanitária', bombeiros: 'Bombeiros (AVCB/CLCB)', licenca_ambiental: 'Licença ambiental',
  crf: 'CRF (Conselho de Farmácia)', certidao_federal: 'CND federal', certidao_estadual: 'CND estadual', certidao_municipal: 'CND municipal',
  certidao_fgts: 'CRF do FGTS', certidao_trabalhista: 'CNDT (trabalhista)', procuracao: 'Procuração', contrato_social: 'Contrato social / alteração', outro: 'Outro',
};
export const QUALIFICACOES: Record<string, string> = { socio: 'Sócio', socio_administrador: 'Sócio-administrador', administrador: 'Administrador', titular: 'Titular', procurador: 'Procurador' };
export const TIPOS_PROCESSO: Record<string, string> = { abertura: 'Abertura', alteracao: 'Alteração contratual', baixa: 'Baixa', transformacao: 'Transformação', outro: 'Outro' };
export const STATUS_PROCESSO: Record<string, string> = { aberto: 'Aberto', em_andamento: 'Em andamento', aguardando_cliente: 'Aguardando cliente', aguardando_orgao: 'Aguardando órgão', concluido: 'Concluído', cancelado: 'Cancelado' };
/** Etapas sugeridas ao criar um processo (editáveis). */
export const ETAPAS_PADRAO: Record<string, string[]> = {
  abertura: ['Viabilidade na prefeitura', 'DBE / CNPJ na Receita', 'Registro na Junta', 'Inscrição estadual', 'Inscrição municipal e alvará', 'Licenças (sanitária, bombeiros)', 'Cadastro no Appura'],
  alteracao: ['Minuta da alteração', 'Assinaturas', 'Registro na Junta', 'Atualização na Receita (DBE)', 'Atualização estadual e municipal'],
  baixa: ['Distrato', 'Registro na Junta', 'Baixa na Receita', 'Baixa estadual', 'Baixa municipal', 'Encerramento no Appura'],
  transformacao: ['Ato de transformação', 'Registro na Junta', 'Atualização nos órgãos'],
  outro: [],
};

/** Situação de um documento pela validade. */
export function situacaoValidade(validade: string | null, hoje = hojeSP(), avisoDias = 30): 'sem_validade' | 'vencido' | 'vencendo' | 'em_dia' {
  if (!validade) return 'sem_validade';
  if (validade < hoje) return 'vencido';
  if (validade <= somarDias(hoje, avisoDias)) return 'vencendo';
  return 'em_dia';
}

export class ServicoSocietario {
  constructor(private readonly db: Db, private readonly arm: Armazenamento) {}

  async clientes(escopo: Escopo) {
    const emps = await empresasDoEscopo(this.db, escopo);
    const [cad, soc, docs, procs] = await Promise.all([
      this.db.from('soc_cadastro').select('empresa_id,natureza_juridica,capital_social,cnae_principal').limit(10000),
      this.db.from('soc_socios').select('empresa_id').is('saida', null).limit(50000),
      this.db.from('soc_documentos').select('empresa_id,validade').limit(50000),
      this.db.from('soc_processos').select('empresa_id,status').in('status', ['aberto', 'em_andamento', 'aguardando_cliente', 'aguardando_orgao']).limit(10000),
    ]);
    const c = new Map((ok(cad, 'cadastro') as any[]).map((x) => [x.empresa_id, x]));
    const conta = (l: any[], f: (x: any) => boolean = () => true) => { const m = new Map<string, number>(); for (const x of l) if (f(x)) m.set(x.empresa_id, (m.get(x.empresa_id) ?? 0) + 1); return m; };
    const s = conta(ok(soc, 'sócios') as any[]);
    const d = ok(docs, 'documentos') as any[];
    const venc = conta(d, (x) => situacaoValidade(x.validade) === 'vencido');
    const proxim = conta(d, (x) => situacaoValidade(x.validade) === 'vencendo');
    const p = conta(ok(procs, 'processos') as any[]);
    return emps.map((e) => ({ ...e, cadastro: c.get(e.id) ?? null, socios: s.get(e.id) ?? 0, documentosVencidos: venc.get(e.id) ?? 0, documentosVencendo: proxim.get(e.id) ?? 0, processosAbertos: p.get(e.id) ?? 0 }));
  }

  async ficha(empresaId: string, escopo: Escopo) {
    exigirEmpresaNoEscopo(escopo, empresaId);
    const e = ok(await this.db.from('empresas').select('id,cnpj,razao_social,nome_fantasia,uf,municipio,regime,ie,im,ativo,criado_em').eq('id', empresaId).maybeSingle(), 'empresa') as any;
    if (!e) throw new ErroModulo(404, 'Empresa não encontrada.');
    const [cad, soc, docs, procs] = await Promise.all([
      this.db.from('soc_cadastro').select('*').eq('empresa_id', empresaId).maybeSingle(),
      this.db.from('soc_socios').select('*').eq('empresa_id', empresaId).order('nome'),
      this.db.from('soc_documentos').select('id,tipo,descricao,numero,emissao,validade,arquivo_nome,criado_em,criado_por').eq('empresa_id', empresaId).order('validade', { ascending: true }),
      this.db.from('soc_processos').select('*').eq('empresa_id', empresaId).order('criado_em', { ascending: false }),
    ]);
    return {
      empresa: e, cadastro: ok(cad, 'cadastro') ?? null, socios: ok(soc, 'sócios'),
      documentos: (ok(docs, 'documentos') as any[]).map((x) => ({ ...x, situacao: situacaoValidade(x.validade) })), processos: ok(procs, 'processos'),
    };
  }

  async salvarCadastro(por: string, escopo: Escopo, empresaId: string, d: Record<string, unknown>) {
    exigirEmpresaNoEscopo(escopo, empresaId);
    const cnaes = Array.isArray(d.cnaes_secundarios) ? d.cnaes_secundarios : String(d.cnaes_secundarios ?? '').split(/[,;\s]+/);
    ok(await this.db.from('soc_cadastro').upsert({
      empresa_id: empresaId, natureza_juridica: txt(d.natureza_juridica, 120), capital_social: numeroOpcional(d.capital_social, 'Capital social'),
      data_abertura: dataOpcional(d.data_abertura, 'Data de abertura'), nire: txt(d.nire, 30), cnae_principal: txt(so(d.cnae_principal) || d.cnae_principal, 20),
      cnaes_secundarios: cnaes.map((x) => String(x).trim()).filter(Boolean).slice(0, 99), objeto_social: txt(d.objeto_social, 4000),
      atualizado_em: new Date().toISOString(), atualizado_por: por,
    }, { onConflict: 'empresa_id' }), 'gravar cadastro societário');
  }

  async salvarSocio(por: string, escopo: Escopo, d: Record<string, unknown>) {
    const empresa = String(d.empresa_id ?? '');
    exigirEmpresaNoEscopo(escopo, empresa);
    const nome = txt(d.nome, 200);
    if (!nome) throw new ErroModulo(400, 'Informe o nome.');
    const doc = so(d.documento);
    if (doc && doc.length !== 11 && doc.length !== 14) throw new ErroModulo(400, 'CPF/CNPJ inválido.');
    const qual = String(d.qualificacao ?? 'socio');
    if (!QUALIFICACOES[qual]) throw new ErroModulo(400, 'Qualificação inválida.');
    const part = numeroOpcional(d.participacao, 'Participação');
    if (part !== null && (part < 0 || part > 100)) throw new ErroModulo(400, 'Participação entre 0 e 100%.');
    const linha = { empresa_id: empresa, nome, documento: doc || null, qualificacao: qual, participacao: part, entrada: dataOpcional(d.entrada, 'Entrada'), saida: dataOpcional(d.saida, 'Saída') };
    if (d.id) { ok(await this.db.from('soc_socios').update(linha).eq('id', Number(d.id)).eq('empresa_id', empresa), 'editar sócio'); return { id: Number(d.id) }; }
    const r = ok(await this.db.from('soc_socios').insert({ ...linha, criado_por: por }).select('id'), 'incluir sócio') as any[];
    // Participação somada acima de 100% é aviso (não bloqueia: pode haver sócio saindo no mesmo ato)
    const todos = ok(await this.db.from('soc_socios').select('participacao').eq('empresa_id', empresa).is('saida', null), 'sócios') as any[];
    const soma = todos.reduce((t, s) => t + Number(s.participacao ?? 0), 0);
    return { id: r[0]?.id, aviso: soma > 100.0001 ? `A soma das participações dos sócios ativos é ${soma.toFixed(2)}%.` : null };
  }

  async excluirSocio(escopo: Escopo, id: number) {
    const s = ok(await this.db.from('soc_socios').select('empresa_id').eq('id', id).maybeSingle(), 'sócio') as any;
    if (!s) throw new ErroModulo(404, 'Sócio não encontrado.');
    exigirEmpresaNoEscopo(escopo, s.empresa_id);
    ok(await this.db.from('soc_socios').delete().eq('id', id), 'excluir sócio');
  }

  /** Documento com validade; o PDF (opcional) vai cifrado para o armazenamento. */
  async salvarDocumento(por: string, escopo: Escopo, d: Record<string, unknown>, pdf?: { nome: string; conteudo: Buffer }) {
    const empresa = String(d.empresa_id ?? '');
    exigirEmpresaNoEscopo(escopo, empresa);
    const tipo = String(d.tipo ?? '');
    if (!TIPOS_DOCUMENTO[tipo]) throw new ErroModulo(400, 'Tipo de documento inválido.');
    const linha: Record<string, unknown> = { empresa_id: empresa, tipo, descricao: txt(d.descricao, 200), numero: txt(d.numero, 60), emissao: dataOpcional(d.emissao, 'Emissão'), validade: dataOpcional(d.validade, 'Validade') };
    let id = d.id ? Number(d.id) : null;
    if (id) ok(await this.db.from('soc_documentos').update(linha).eq('id', id).eq('empresa_id', empresa), 'editar documento');
    else id = Number((ok(await this.db.from('soc_documentos').insert({ ...linha, criado_por: por }).select('id'), 'incluir documento') as any[])[0].id);
    if (pdf && pdf.conteudo.length) {
      if (pdf.conteudo.length > 15 * 1024 * 1024) throw new ErroModulo(413, 'Arquivo maior que 15 MB.');
      if (pdf.conteudo.subarray(0, 4).toString('latin1') !== '%PDF' && !/\.(jpe?g|png)$/i.test(pdf.nome)) throw new ErroModulo(422, 'Envie PDF, JPG ou PNG.');
      const caminho = await this.arm.salvar(`societario/${empresa}/${id}_${pdf.nome.replace(/[^\w.\- ]+/g, '_').slice(0, 120)}`, pdf.conteudo);
      ok(await this.db.from('soc_documentos').update({ arquivo_caminho: caminho, arquivo_nome: pdf.nome.slice(0, 200) }).eq('id', id), 'anexar arquivo');
    }
    return { id };
  }

  async excluirDocumento(escopo: Escopo, id: number) {
    const x = ok(await this.db.from('soc_documentos').select('empresa_id').eq('id', id).maybeSingle(), 'documento') as any;
    if (!x) throw new ErroModulo(404, 'Documento não encontrado.');
    exigirEmpresaNoEscopo(escopo, x.empresa_id);
    ok(await this.db.from('soc_documentos').delete().eq('id', id), 'excluir documento');
  }

  async baixarDocumento(escopo: Escopo, id: number) {
    const x = ok(await this.db.from('soc_documentos').select('empresa_id,arquivo_caminho,arquivo_nome').eq('id', id).maybeSingle(), 'documento') as any;
    if (!x?.arquivo_caminho) throw new ErroModulo(404, 'Documento sem arquivo.');
    exigirEmpresaNoEscopo(escopo, x.empresa_id);
    return { nome: x.arquivo_nome as string, conteudo: await this.arm.ler(x.arquivo_caminho) };
  }

  /** Documentos vencidos e a vencer (todas as empresas do escopo). */
  async vencimentos(escopo: Escopo, dias = 60) {
    const ate = somarDias(hojeSP(), Math.min(365, Math.max(1, dias)));
    const docs = ok(await this.db.from('soc_documentos').select('id,empresa_id,tipo,descricao,numero,validade,arquivo_nome').not('validade', 'is', null).lte('validade', ate).order('validade').limit(5000), 'vencimentos') as any[];
    const emps = new Map((await empresasDoEscopo(this.db, escopo)).map((e) => [e.id, e]));
    return docs.filter((x) => emps.has(x.empresa_id)).map((x) => ({ ...x, empresa: emps.get(x.empresa_id)!.razao_social, cnpj: emps.get(x.empresa_id)!.cnpj, situacao: situacaoValidade(x.validade) }));
  }

  async processos(escopo: Escopo, abertos = true) {
    let q = this.db.from('soc_processos').select('*').order('prazo', { ascending: true, nullsFirst: false }).limit(2000);
    if (abertos) q = q.in('status', ['aberto', 'em_andamento', 'aguardando_cliente', 'aguardando_orgao']);
    const l = ok(await q, 'processos') as any[];
    const emps = new Map((await empresasDoEscopo(this.db, escopo)).map((e) => [e.id, e]));
    return l.filter((p) => (p.empresa_id ? emps.has(p.empresa_id) : !escopo)).map((p) => ({ ...p, empresa: p.empresa_id ? emps.get(p.empresa_id)?.razao_social : p.cliente_nome }));
  }

  async salvarProcesso(por: string, escopo: Escopo, d: Record<string, unknown>) {
    const empresa = d.empresa_id ? String(d.empresa_id) : null;
    if (empresa) exigirEmpresaNoEscopo(escopo, empresa); else if (escopo) throw new ErroModulo(403, 'Processo sem empresa só para quem vê todas as empresas.');
    const tipo = String(d.tipo ?? '');
    if (!TIPOS_PROCESSO[tipo]) throw new ErroModulo(400, 'Tipo de processo inválido.');
    const titulo = txt(d.titulo, 200) ?? TIPOS_PROCESSO[tipo];
    const status = String(d.status ?? 'aberto');
    if (!STATUS_PROCESSO[status]) throw new ErroModulo(400, 'Situação inválida.');
    const etapasIn = Array.isArray(d.etapas) ? d.etapas : null;
    const linha: Record<string, unknown> = {
      empresa_id: empresa, cliente_nome: empresa ? null : txt(d.cliente_nome, 200), tipo, titulo, status, responsavel: txt(d.responsavel, 200), prazo: dataOpcional(d.prazo, 'Prazo'),
      observacao: txt(d.observacao, 4000), atualizado_em: new Date().toISOString(), concluido_em: status === 'concluido' ? new Date().toISOString() : null,
    };
    if (!empresa && !linha.cliente_nome) throw new ErroModulo(400, 'Escolha a empresa ou informe o nome do cliente (abertura).');
    if (etapasIn) linha.etapas = etapasIn.slice(0, 50).map((e: any) => ({ nome: String(e?.nome ?? '').slice(0, 120), feito: e?.feito === true, feito_em: e?.feito ? e.feito_em ?? new Date().toISOString() : null, feito_por: e?.feito ? e.feito_por ?? por : null })).filter((e: any) => e.nome);
    if (d.id) {
      const ex = ok(await this.db.from('soc_processos').select('empresa_id').eq('id', Number(d.id)).maybeSingle(), 'processo') as any;
      if (!ex) throw new ErroModulo(404, 'Processo não encontrado.');
      if (ex.empresa_id) exigirEmpresaNoEscopo(escopo, ex.empresa_id);
      ok(await this.db.from('soc_processos').update(linha).eq('id', Number(d.id)), 'editar processo');
      return { id: Number(d.id) };
    }
    if (!etapasIn) linha.etapas = (ETAPAS_PADRAO[tipo] ?? []).map((nome) => ({ nome, feito: false, feito_em: null, feito_por: null }));
    const r = ok(await this.db.from('soc_processos').insert({ ...linha, criado_por: por }).select('id'), 'criar processo') as any[];
    return { id: r[0]?.id };
  }

  /** Cliente sem certificado (a captação de notas fica desligada até cadastrar o certificado). */
  async criarCliente(por: string, d: Record<string, unknown>) {
    const cnpj = so(d.cnpj);
    if (cnpj.length !== 14 && cnpj.length !== 11) throw new ErroModulo(400, 'CNPJ/CPF inválido.');
    const razao = txt(d.razao_social, 200);
    if (!razao) throw new ErroModulo(400, 'Informe a razão social.');
    const uf = String(d.uf ?? '').toUpperCase();
    let cUf: number;
    try { cUf = codigoUf(uf); } catch { throw new ErroModulo(400, 'UF inválida.'); }
    const regime = d.regime && ['simples', 'mei', 'presumido', 'real'].includes(String(d.regime)) ? String(d.regime) : null;
    const ja = ok(await this.db.from('empresas').select('id').eq('cnpj', cnpj).limit(1), 'empresa existente') as any[];
    if (ja.length) throw new ErroModulo(409, 'Já existe empresa com este CNPJ.');
    const r = ok(await this.db.from('empresas').insert({ cnpj, razao_social: razao, uf, c_uf: cUf, regime, captar_nfe: false, captar_cte: false, ativo: true, cadastro_atualizado_por: por, cadastro_atualizado_em: new Date().toISOString() }).select('id'), 'criar empresa') as any[];
    return { id: r[0]?.id };
  }
}
