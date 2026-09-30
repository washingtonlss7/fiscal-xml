import crypto from 'crypto';
import { Armazenamento } from '../armazenamento';
import { buscarTodos, Db, ok } from '../db';
import { log } from '../log';
import { codigoUf } from '../uf';
import { analisarEfd, Efd, ResultadoEfd } from '../sped/efd';
import { Comparacao, compararXmlSped, XmlDoc } from '../sped/comparar';
import { analisarContribuicoes, Cruzamento, cruzarFiscalContribuicoes, EfdContrib, ehContribuicoes } from '../sped/contribuicoes';
import { dadosDoContribuicoes, alteracaoAprovada, CAMPOS_CADASTRO, campoValido, chaveComparacao, DadosCadastro, dadosDoSped, diferencasCadastro } from '../sped/cadastro';

/**
 * SPED Fiscal guardado: o arquivo vai criptografado para o armazenamento (R2) e o resultado
 * (resumo, validação e comparação XML × SPED) fica em sped_arquivos. O vigente de cada
 * competência é o mais recente enviado para a empresa.
 *
 * Pré-cadastro: os dados do 0000/0005/0100 que diferem do cadastro viram uma sugestão para o
 * escritório conferir (cadastro_sugestoes). CNPJ que ainda não é cliente vira sugestão de cliente novo.
 */

export class ErroSped extends Error {
  constructor(public readonly status: number, msg: string) { super(msg); }
}

const COLUNAS_CADASTRO = ['razao_social', 'uf', ...CAMPOS_CADASTRO.map((c) => c.campo).filter((c) => c !== 'razao_social')];
const MAX_DIVERGENCIAS = 2000;
const dataSP = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const mesVizinho = (comp: string, n: number) => {
  const [a, m] = comp.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
};

interface EmpresaSped { id: string; cnpj: string; razao_social: string; uf: string; [k: string]: unknown }

export interface ArquivoSped {
  id: number;
  tipo: string;
  empresa_id: string | null;
  cnpj: string;
  competencia: string;
  nome: string;
  tamanho: number;
  caminho: string;
  enviado_por: string;
  enviado_em: string;
  processado_em: string;
  erros: number;
  alertas: number;
  divergencias: number | null;
  divergencias_info: number | null;
  resumo: any;
  ocorrencias: ResultadoEfd['ocorrencias'];
  comparacao: any;
}

/** Chaves de entrada (C100 de entrada e D100): servem para não acusar nota escriturada no mês seguinte. */
function chavesEntrada(efd: Efd): string[] {
  return [...efd.c100.filter((d) => d.indOper === '0' && d.chave).map((d) => d.chave), ...efd.d100.filter((d) => d.chave).map((d) => d.chave)];
}

const TIPO_CONTRIB = 'efd_contribuicoes';
function contarCruzamento(c: Cruzamento | null): { divergencias: number | null; divergencias_info: number | null } {
  if (!c) return { divergencias: null, divergencias_info: null };
  const graves = c.divergencias.filter((d) => d.nivel !== 'info').length;
  return { divergencias: graves, divergencias_info: c.divergencias.length - graves };
}

function contarDivergencias(c: Comparacao | null): { divergencias: number | null; divergencias_info: number | null } {
  if (!c) return { divergencias: null, divergencias_info: null };
  const graves = c.divergencias.filter((d) => d.nivel !== 'info').length;
  return { divergencias: graves, divergencias_info: c.divergencias.length - graves };
}

export class ServicoSped {
  constructor(private readonly db: Db, private readonly arm: Armazenamento) {}

  private async empresaPorCnpj(cnpj: string): Promise<EmpresaSped | null> {
    return ok(await this.db.from('empresas').select(`id,cnpj,${COLUNAS_CADASTRO.join(',')}`).eq('cnpj', cnpj).maybeSingle(), 'ler empresa') as EmpresaSped | null;
  }

  /** Compara o SPED com os XMLs do período (e com as entradas escrituradas no SPED do mês seguinte, se houver). */
  async comparar(empresaId: string, efd: Efd): Promise<Comparacao> {
    const cab = efd.cabecalho!;
    const colunas = 'chave,modelo,numero,emitida_em,valor,situacao,emit_cnpj,dest_doc,toma_doc,emit_nome';
    const docs = await buscarTodos<any>(
      (de, ate) => this.db.from('documentos').select(colunas).eq('empresa_id', empresaId)
        .gte('emitida_em', `${cab.dtIni}T00:00:00-03:00`).lte('emitida_em', `${cab.dtFin}T23:59:59-03:00`).range(de, ate),
      'ler XMLs do período',
    );
    const primeiro = ok(await this.db.from('documentos').select('emitida_em').eq('empresa_id', empresaId).order('emitida_em').limit(1), 'primeiro XML') as { emitida_em: string }[];
    const seguinte = ok(
      await this.db.from('sped_arquivos').select('chaves_entrada').eq('empresa_id', empresaId).eq('tipo', 'efd_icms_ipi')
        .eq('competencia', mesVizinho(cab.dtIni, 1)).order('enviado_em', { ascending: false }).order('id', { ascending: false }).limit(1),
      'SPED do mês seguinte',
    ) as { chaves_entrada: string[] }[];
    // Entradas escrituradas neste SPED com XML emitido em outro mês (ex.: nota de 30/07 que entrou em 02/08)
    const noPeriodo = new Set(docs.map((d) => d.chave));
    const faltam = [...new Set([...efd.c100.filter((d) => d.indOper === '0' && d.chave).map((d) => d.chave), ...efd.d100.map((d) => d.chave)])]
      .filter((c) => c && !noPeriodo.has(c));
    for (let i = 0; i < faltam.length; i += 200) {
      docs.push(...ok(await this.db.from('documentos').select(colunas).eq('empresa_id', empresaId).in('chave', faltam.slice(i, i + 200)), 'XMLs de outros meses') as any[]);
    }
    const xmls: XmlDoc[] = docs.map((d) => ({
      chave: d.chave, modelo: d.modelo, data: dataSP(d.emitida_em), valor: Number(d.valor ?? 0), situacao: d.situacao ?? 'autorizada',
      emit: d.emit_cnpj ?? '', dest: d.dest_doc ?? '', toma: d.toma_doc ?? '', nomeEmit: d.emit_nome ?? '', numero: d.numero ?? '',
    }));
    return compararXmlSped(efd, xmls, new Set(seguinte[0]?.chaves_entrada ?? []), primeiro[0] ? dataSP(primeiro[0].emitida_em) : null);
  }

  /**
   * Recebe um SPED. `empresaEsperada`: quando o envio é pela tela da empresa, o CNPJ precisa ser o dela.
   * Sem empresa esperada (tela SPED), o arquivo vai para a empresa do CNPJ ou vira pré-cadastro de cliente novo.
   */
  async receber(nome: string, corpo: Buffer, email: string, empresaEsperada?: { id: string; cnpj: string }) {
    if (ehContribuicoes(corpo)) return this.receberContribuicoes(nome, corpo, email, empresaEsperada);
    const r = analisarEfd(corpo);
    const cab = r.efd.cabecalho;
    if (!cab) return { valido: false as const, arquivo: { nome, tamanho: corpo.length }, resumo: r.resumo, ocorrencias: r.ocorrencias };
    const cnpj = cab.cnpj || cab.cpf;
    if (empresaEsperada && cnpj !== empresaEsperada.cnpj) {
      throw new ErroSped(422, `Este SPED é de outro contribuinte (${cab.nome}, CNPJ ${cnpj}). Abra a empresa certa para enviar.`);
    }
    const empresa = await this.empresaPorCnpj(cnpj);
    const competencia = `${r.resumo.periodo}-01`;
    const sha256 = crypto.createHash('sha256').update(corpo).digest('hex');
    // Saldo credor anterior (E110) × saldo a transportar do SPED do mês anterior guardado no Appura
    if (empresa && r.resumo.apuracao) {
      const mesAnt = await this.vigente(empresa.id, mesVizinho(competencia, -1));
      const transp = mesAnt?.resumo?.apuracao?.saldoCredorTransportar;
      const ant = r.resumo.apuracao.saldoCredorAnterior;
      if (typeof transp === 'number' && Math.abs(transp - ant) > 0.05) {
        const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        r.ocorrencias.push({ nivel: 'alerta', codigo: 'E110_SALDO_ANTERIOR',
          mensagem: `O saldo credor anterior do E110 (${brl(ant)}) não bate com o saldo credor a transportar do SPED de ${String(mesAnt!.competencia).slice(5, 7)}/${String(mesAnt!.competencia).slice(0, 4)} guardado no Appura (${brl(transp)}). Diferença de ${brl(Math.abs(transp - ant))}.` });
      }
    }
    const nErros = r.ocorrencias.filter((o) => o.nivel === 'erro').length;
    const nAlertas = r.ocorrencias.filter((o) => o.nivel === 'alerta').length;

    // O mesmo arquivo enviado de novo: reaproveita o que está guardado e refaz a comparação.
    const igual = ok(
      await this.db.from('sped_arquivos').select('id,caminho').eq('cnpj', cnpj).eq('tipo', 'efd_icms_ipi').eq('competencia', competencia).eq('sha256', sha256).limit(1),
      'procurar SPED igual',
    ) as { id: number; caminho: string }[];
    const caminho = igual[0]?.caminho ?? await this.arm.salvar(`sped/${cnpj}/${r.resumo.periodo}/${sha256}.txt`, corpo);
    const comparacao = empresa ? await this.comparar(empresa.id, r.efd) : null;
    const linha = {
      empresa_id: empresa?.id ?? null, cnpj, tipo: 'efd_icms_ipi', competencia, nome: nome.slice(0, 200), tamanho: corpo.length, sha256, caminho,
      finalidade: r.resumo.finalidade, cod_ver: r.resumo.codVer, enviado_por: email, enviado_em: new Date().toISOString(), processado_em: new Date().toISOString(),
      erros: nErros, alertas: nAlertas, ...contarDivergencias(comparacao),
      resumo: r.resumo, ocorrencias: r.ocorrencias,
      comparacao: comparacao ? { ...comparacao, divergencias: comparacao.divergencias.slice(0, MAX_DIVERGENCIAS) } : null,
      chaves_entrada: chavesEntrada(r.efd),
    };
    const salvo = (igual[0]
      ? ok(await this.db.from('sped_arquivos').update(linha).eq('id', igual[0].id).select('*').single(), 'atualizar SPED')
      : ok(await this.db.from('sped_arquivos').insert(linha).select('*').single(), 'gravar SPED')) as ArquivoSped;

    // O SPED do mês anterior passa a enxergar as entradas escrituradas neste (nota de fim de mês)
    if (empresa) {
      const anterior = await this.vigente(empresa.id, mesVizinho(competencia, -1));
      if (anterior) await this.recomparar(anterior).catch((e) => log.warn('não foi possível refazer a comparação do mês anterior', { id: anterior.id, erro: (e as Error).message }));
      // O Contribuições do mesmo mês é cruzado de novo com este SPED Fiscal
      const contrib = await this.vigente(empresa.id, competencia, 'efd_contribuicoes');
      if (contrib) await this.recomparar(contrib, r.efd).catch((e) => log.warn('não foi possível refazer o cruzamento com o Contribuições', { id: contrib.id, erro: (e as Error).message }));
    }

    const sugestao = await this.sugerirCadastro(empresa, dadosDoSped(r.efd), salvo.id, competencia, email);
    log.info('SPED Fiscal recebido', { cnpj, competencia, por: email, id: salvo.id, erros: nErros, divergencias: salvo.divergencias, clienteNovo: !empresa, sugestao: sugestao?.id ?? null });
    return { valido: true as const, ...this.resposta(salvo), empresaId: empresa?.id ?? null, clienteNovo: !empresa, sugestao };
  }

  /** SPED Contribuições: guarda, valida e cruza com o SPED Fiscal do mesmo mês (se já estiver no Appura). */
  async receberContribuicoes(nome: string, corpo: Buffer, email: string, empresaEsperada?: { id: string; cnpj: string }) {
    const r = analisarContribuicoes(corpo);
    const cab = r.efd.cabecalho;
    if (!cab) return { valido: false as const, tipo: TIPO_CONTRIB, arquivo: { nome, tamanho: corpo.length }, resumo: r.resumo, ocorrencias: r.ocorrencias };
    const cnpj = cab.cnpj;
    if (empresaEsperada && cnpj !== empresaEsperada.cnpj) {
      throw new ErroSped(422, `Este SPED Contribuições é de outro contribuinte (${cab.nome}, CNPJ ${cnpj}). Abra a empresa certa para enviar.`);
    }
    const empresa = await this.empresaPorCnpj(cnpj);
    const competencia = `${r.resumo.periodo}-01`;
    const sha256 = crypto.createHash('sha256').update(corpo).digest('hex');
    const igual = ok(
      await this.db.from('sped_arquivos').select('id,caminho').eq('cnpj', cnpj).eq('tipo', TIPO_CONTRIB).eq('competencia', competencia).eq('sha256', sha256).limit(1),
      'procurar SPED Contribuições igual',
    ) as { id: number; caminho: string }[];
    const caminho = igual[0]?.caminho ?? await this.arm.salvar(`sped-contribuicoes/${cnpj}/${r.resumo.periodo}/${sha256}.txt`, corpo);
    const cruz = empresa ? await this.cruzar(empresa.id, competencia, r.efd) : null;
    const linha = {
      empresa_id: empresa?.id ?? null, cnpj, tipo: TIPO_CONTRIB, competencia, nome: nome.slice(0, 200), tamanho: corpo.length, sha256, caminho,
      finalidade: r.resumo.finalidade, cod_ver: r.resumo.codVer, enviado_por: email, enviado_em: new Date().toISOString(), processado_em: new Date().toISOString(),
      erros: r.ocorrencias.filter((o) => o.nivel === 'erro').length, alertas: r.ocorrencias.filter((o) => o.nivel === 'alerta').length,
      ...contarCruzamento(cruz), resumo: r.resumo, ocorrencias: r.ocorrencias, comparacao: cruz, chaves_entrada: [],
    };
    const salvo = (igual[0]
      ? ok(await this.db.from('sped_arquivos').update(linha).eq('id', igual[0].id).select('*').single(), 'atualizar SPED Contribuições')
      : ok(await this.db.from('sped_arquivos').insert(linha).select('*').single(), 'gravar SPED Contribuições')) as ArquivoSped;
    const sugestao = await this.sugerirCadastro(empresa, dadosDoContribuicoes(r.efd), salvo.id, competencia, email, 'sped_contribuicoes');
    log.info('SPED Contribuições recebido', { cnpj, competencia, por: email, id: salvo.id, erros: linha.erros, divergencias: salvo.divergencias, clienteNovo: !empresa });
    return { valido: true as const, ...this.resposta(salvo), empresaId: empresa?.id ?? null, clienteNovo: !empresa, sugestao };
  }

  /** Cruza o Contribuições com o SPED Fiscal vigente do mesmo mês. Sem SPED Fiscal, devolve null. */
  private async cruzar(empresaId: string, competencia: string, contrib: EfdContrib, fiscal?: Efd): Promise<Cruzamento | null> {
    let efdFiscal = fiscal;
    if (!efdFiscal) {
      const f = await this.vigente(empresaId, competencia);
      if (!f) return null;
      efdFiscal = analisarEfd(await this.arm.ler(f.caminho)).efd;
    }
    const c = cruzarFiscalContribuicoes(efdFiscal, contrib);
    return { ...c, divergencias: c.divergencias.slice(0, MAX_DIVERGENCIAS) };
  }

  async vigente(empresaId: string, competencia: string, tipo = 'efd_icms_ipi'): Promise<ArquivoSped | null> {
    const l = ok(
      await this.db.from('sped_arquivos').select('*').eq('empresa_id', empresaId).eq('tipo', tipo).eq('competencia', competencia)
        .order('enviado_em', { ascending: false }).order('id', { ascending: false }).limit(1),
      'ler SPED vigente',
    ) as ArquivoSped[];
    return l[0] ?? null;
  }

  async porId(id: number): Promise<ArquivoSped | null> {
    return ok(await this.db.from('sped_arquivos').select('*').eq('id', id).maybeSingle(), 'ler SPED') as ArquivoSped | null;
  }

  /** Lê de novo o arquivo guardado e refaz a comparação: Fiscal × XMLs de agora; Contribuições × SPED Fiscal do mês. */
  async recomparar(a: ArquivoSped, fiscal?: Efd): Promise<ArquivoSped> {
    if (!a.empresa_id) throw new ErroSped(422, 'Este SPED ainda não está ligado a uma empresa cadastrada.');
    if (a.tipo === TIPO_CONTRIB) {
      const rc = analisarContribuicoes(await this.arm.ler(a.caminho));
      const cruz = await this.cruzar(a.empresa_id, String(a.competencia).slice(0, 10), rc.efd, fiscal);
      return ok(await this.db.from('sped_arquivos').update({ processado_em: new Date().toISOString(), ...contarCruzamento(cruz), comparacao: cruz })
        .eq('id', a.id).select('*').single(), 'atualizar cruzamento') as ArquivoSped;
    }
    const r = analisarEfd(await this.arm.ler(a.caminho));
    const comparacao = await this.comparar(a.empresa_id, r.efd);
    return ok(await this.db.from('sped_arquivos').update({
      processado_em: new Date().toISOString(), ...contarDivergencias(comparacao),
      comparacao: { ...comparacao, divergencias: comparacao.divergencias.slice(0, MAX_DIVERGENCIAS) },
    }).eq('id', a.id).select('*').single(), 'atualizar comparação') as ArquivoSped;
  }

  async baixar(a: ArquivoSped): Promise<Buffer> {
    return this.arm.ler(a.caminho);
  }

  /** Formato devolvido para a tela (o mesmo no envio e na consulta). */
  resposta(a: ArquivoSped) {
    return {
      id: a.id,
      tipo: a.tipo,
      competencia: String(a.competencia).slice(0, 7),
      arquivo: { nome: a.nome, tamanho: a.tamanho, enviadoEm: a.enviado_em, enviadoPor: a.enviado_por, processadoEm: a.processado_em },
      resumo: a.resumo,
      ocorrencias: a.ocorrencias,
      comparacao: a.comparacao,
    };
  }

  /** Arquivos enviados de uma empresa numa competência (o primeiro é o vigente). */
  async historico(empresaId: string, competencia: string, tipo = 'efd_icms_ipi') {
    return ok(
      await this.db.from('sped_arquivos').select('id,nome,tamanho,enviado_em,enviado_por,erros,alertas,divergencias,finalidade')
        .eq('empresa_id', empresaId).eq('tipo', tipo).eq('competencia', competencia).order('enviado_em', { ascending: false }).order('id', { ascending: false }).limit(30),
      'histórico do SPED',
    ) as unknown[];
  }

  /* ---------- pré-cadastro ---------- */

  /**
   * Cria (ou atualiza) a sugestão de cadastro. Não sugere de novo o que o escritório já recusou,
   * nem troca dados por um SPED mais antigo que o da última sugestão.
   */
  async sugerirCadastro(empresa: EmpresaSped | null, dados: DadosCadastro | null, arquivoId: number, competencia: string, email: string, origem = 'sped') {
    if (!dados) return null;
    const diferencas = empresa ? diferencasCadastro(empresa as Record<string, string | null>, dados) : [];
    if (empresa && !diferencas.length) return null;
    const anteriores = ok(
      await this.db.from('cadastro_sugestoes').select('id,status,competencia,dados').eq('cnpj', dados.cnpj).in('status', ['pendente', 'aprovado', 'rejeitado'])
        .order('criado_em', { ascending: false }).limit(20),
      'sugestões anteriores',
    ) as { id: number; status: string; competencia: string | null; dados: DadosCadastro }[];
    // Compara só os campos que este arquivo traz (o Contribuições não tem endereço, por exemplo)
    const iguaisNoQueTraz = (d: DadosCadastro) => CAMPOS_CADASTRO.every(({ campo }) => !dados[campo] || chaveComparacao(d[campo]) === chaveComparacao(dados[campo]));
    if (anteriores.some((s) => s.status === 'rejeitado' && iguaisNoQueTraz(s.dados))) return null;
    const maisNova = anteriores.map((s) => s.competencia ?? '').sort().pop() ?? '';
    if (maisNova > competencia) return null;
    const pendente = anteriores.find((s) => s.status === 'pendente');
    let proposta = dados;
    if (pendente) {
      if (iguaisNoQueTraz(pendente.dados)) return { id: pendente.id, campos: diferencas.length || null };
      // Junta com a sugestão pendente: o que este arquivo traz prevalece, o resto continua
      proposta = { ...pendente.dados, ...Object.fromEntries(Object.entries(dados).filter(([, v]) => v)) } as DadosCadastro;
      ok(await this.db.from('cadastro_sugestoes').update({ status: 'substituido', decidido_em: new Date().toISOString() }).eq('id', pendente.id), 'substituir sugestão');
    }
    const nova = ok(await this.db.from('cadastro_sugestoes').insert({
      empresa_id: empresa?.id ?? null, cnpj: dados.cnpj, origem, sped_arquivo_id: arquivoId, competencia, dados: proposta, criado_por: email,
    }).select('id').single(), 'criar sugestão de cadastro') as { id: number };
    return { id: nova.id, campos: diferencas.length || null };
  }

  /** Sugestões pendentes (com o cadastro atual para mostrar a diferença) e as últimas decididas. */
  async listarSugestoes() {
    const pendentes = ok(
      await this.db.from('cadastro_sugestoes').select('id,empresa_id,cnpj,competencia,dados,criado_por,criado_em,sped_arquivo_id')
        .eq('status', 'pendente').order('criado_em', { ascending: false }).limit(200),
      'listar sugestões',
    ) as { id: number; empresa_id: string | null; cnpj: string; competencia: string; dados: DadosCadastro; criado_por: string; criado_em: string }[];
    const ids = [...new Set(pendentes.map((p) => p.empresa_id).filter(Boolean))] as string[];
    const empresas = ids.length
      ? ok(await this.db.from('empresas').select(`id,cnpj,${COLUNAS_CADASTRO.join(',')}`).in('id', ids), 'ler empresas das sugestões') as unknown as EmpresaSped[]
      : [];
    const porId = new Map(empresas.map((e) => [e.id, e]));
    const decididas = ok(
      await this.db.from('cadastro_sugestoes').select('id,empresa_id,cnpj,competencia,status,decidido_por,decidido_em,campos_aprovados,dados->>razao_social')
        .in('status', ['aprovado', 'rejeitado']).order('decidido_em', { ascending: false }).limit(20),
      'sugestões decididas',
    ) as unknown[];
    return {
      campos: CAMPOS_CADASTRO,
      pendentes: pendentes.map((p) => {
        const e = p.empresa_id ? porId.get(p.empresa_id) ?? null : null;
        return {
          ...p,
          clienteNovo: !p.empresa_id,
          empresa: e ? { id: e.id, razao_social: e.razao_social, uf: e.uf } : null,
          diferencas: e ? diferencasCadastro(e as Record<string, string | null>, p.dados)
            : CAMPOS_CADASTRO.filter((c) => p.dados[c.campo]).map((c) => ({ ...c, atual: null, proposto: p.dados[c.campo]! })),
        };
      }),
      decididas,
    };
  }

  /** Aprova os campos escolhidos. Para cliente novo, cria a empresa (ativa, aguardando o certificado A1). */
  async aprovar(id: number, email: string, campos: string[], regime: string | null) {
    const s = ok(await this.db.from('cadastro_sugestoes').select('*').eq('id', id).maybeSingle(), 'ler sugestão') as
      { id: number; empresa_id: string | null; cnpj: string; status: string; dados: DadosCadastro } | null;
    if (!s) throw new ErroSped(404, 'Sugestão não encontrada.');
    if (s.status !== 'pendente') throw new ErroSped(409, 'Esta sugestão já foi decidida.');
    const escolhidos = [...new Set(campos.filter(campoValido))];
    const agora = new Date().toISOString();
    const alt = alteracaoAprovada(s.dados, escolhidos);
    let empresaId = s.empresa_id;
    if (!empresaId) {
      const ja = await this.empresaPorCnpj(s.cnpj);
      if (ja) {
        empresaId = ja.id;
      } else {
        if (!s.dados.razao_social) throw new ErroSped(422, 'O SPED não trouxe a razão social.');
        let cUf: number;
        try { cUf = codigoUf(s.dados.uf); } catch { throw new ErroSped(422, `UF inválida no SPED: ${s.dados.uf}`); }
        if (regime && !['simples', 'presumido', 'real', 'mei'].includes(regime)) throw new ErroSped(400, 'Regime inválido.');
        const nova = ok(await this.db.from('empresas').insert({
          cnpj: s.cnpj, uf: s.dados.uf.toUpperCase(), c_uf: cUf, regime: regime || null, ...alt, razao_social: s.dados.razao_social,
          cadastro_atualizado_em: agora, cadastro_atualizado_por: email,
        }).select('id').single(), 'criar empresa') as { id: string };
        empresaId = nova.id;
        ok(await this.db.from('sped_arquivos').update({ empresa_id: empresaId }).eq('cnpj', s.cnpj).is('empresa_id', null), 'ligar SPEDs à empresa');
        ok(await this.db.from('cadastro_sugestoes').update({ empresa_id: empresaId }).eq('id', id), 'ligar sugestão');
        // Agora dá para comparar com os XMLs (que começam a chegar quando o certificado for cadastrado)
        const arquivos = ok(await this.db.from('sped_arquivos').select('*').eq('empresa_id', empresaId), 'SPEDs do cliente novo') as ArquivoSped[];
        for (const a of arquivos) await this.recomparar(a).catch((e) => log.warn('comparação do cliente novo', { id: a.id, erro: (e as Error).message }));
        await this.decidir(id, 'aprovado', email, agora, escolhidos);
        log.info('cliente pré-cadastrado pelo SPED', { cnpj: s.cnpj, empresa: empresaId, por: email });
        return { empresaId, criada: true };
      }
    }
    if (Object.keys(alt).length) {
      ok(await this.db.from('empresas').update({ ...alt, cadastro_atualizado_em: agora, cadastro_atualizado_por: email }).eq('id', empresaId), 'atualizar cadastro');
    }
    await this.decidir(id, 'aprovado', email, agora, escolhidos);
    log.info('cadastro atualizado pelo SPED', { cnpj: s.cnpj, campos: Object.keys(alt), por: email });
    return { empresaId, criada: false };
  }

  async rejeitar(id: number, email: string) {
    const s = ok(await this.db.from('cadastro_sugestoes').select('id,status').eq('id', id).maybeSingle(), 'ler sugestão') as { status: string } | null;
    if (!s) throw new ErroSped(404, 'Sugestão não encontrada.');
    if (s.status !== 'pendente') throw new ErroSped(409, 'Esta sugestão já foi decidida.');
    await this.decidir(id, 'rejeitado', email, new Date().toISOString(), []);
  }

  private async decidir(id: number, status: string, email: string, em: string, campos: string[]) {
    ok(await this.db.from('cadastro_sugestoes').update({ status, decidido_por: email, decidido_em: em, campos_aprovados: campos }).eq('id', id), 'decidir sugestão');
  }
}
