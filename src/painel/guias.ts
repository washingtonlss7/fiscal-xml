import { Armazenamento } from '../armazenamento';
import { Certificado, criarAgente, lerPfx } from '../cert';
import { cifrar, decifrar } from '../cripto';
import { buscarTodos, Db, ok } from '../db';
import { log } from '../log';
import { Ambiente, ConfigIntegra, Contratante, ErroIntegra, IntegraContador, RegistroChamada } from '../integra/cliente';
import type { ServicoAcessorias } from '../integra/acessorias';
import { Guia, lerGuias, lerProcuracoes, lerUltimaDeclaracao, periodoApuracao, situacaoProcuracao, temErro, textoMensagens } from '../integra/respostas';

/**
 * Guias pelo Integra Contador (Fase Fiscal 2, etapa 1):
 * - procuração eletrônica de cada cliente para o escritório (PROCURACOES / OBTERPROCURACAO41);
 * - última declaração do PGDAS-D do mês (PGDASD / CONSULTIMADECREC14);
 * - DAS do Simples Nacional (PGDASD / GERARDAS12) e do MEI (PGMEI / GERARDASPDF21), com o PDF guardado criptografado.
 *
 * Nada aqui inventa dado: sem as chaves do SERPRO o módulo fica "não configurado"; no ambiente de
 * teste do SERPRO (trial, dados fictícios) só o teste de conexão funciona e nada é gravado.
 */

export const ErroGuias = ErroIntegra;
export type OrigemChaves = 'painel' | 'servidor' | null;

export const TIPO_GUIA: Record<string, { tipo: string; sistema: string; servico: string; rotulo: string }> = {
  simples: { tipo: 'das_simples', sistema: 'PGDASD', servico: 'GERARDAS12', rotulo: 'DAS do Simples Nacional' },
  mei: { tipo: 'das_mei', sistema: 'PGMEI', servico: 'GERARDASPDF21', rotulo: 'DAS do MEI' },
};
const LOTE_MAX = 100;

const hojeSP = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const mesAtualSP = () => hojeSP().slice(0, 7);

interface EmpresaGuia { id: string; cnpj: string; razao_social: string; regime: string | null; ativo: boolean; escritorio: boolean }

export class ServicoGuias {
  private certCache: { id: string; c: Contratante; validoAte: string } | null = null;
  /** Cliente do SERPRO em uso e a versão da configuração que o criou (recriado quando as chaves mudam). */
  private clienteCache: { versao: string; integra: IntegraContador | null; origem: OrigemChaves; lidoEm: number } | null = null;
  /** Envio das guias ao Sistema Acessórias (opcional). */
  acessorias: ServicoAcessorias | null = null;

  constructor(
    private readonly db: Db,
    private readonly arm: Armazenamento,
    private readonly masterKey: string,
    private readonly criar: (cfg: ConfigIntegra, contratante: () => Promise<Contratante>, registrar: (r: RegistroChamada) => Promise<void>) => IntegraContador,
    /** Chaves das variáveis do servidor (opcional): valem só se o painel não tiver chaves cadastradas. */
    private readonly cfgServidor: ConfigIntegra | null = null,
  ) {}

  /* ---------- chaves do SERPRO (cadastradas no painel, cifradas com a MASTER_KEY) ---------- */

  private async configPainel() {
    return ok(await this.db.from('integra_config').select('*').eq('id', 1).maybeSingle(), 'chaves do Integra Contador') as
      { ambiente: Ambiente; consumer_key_cifrada: string | null; consumer_secret_cifrada: string | null; final_chave: string | null; atualizado_em: string; atualizado_por: string } | null;
  }

  /** Cliente do Integra Contador: chaves do painel; se não houver, as do servidor; senão, não configurado. Relê a configuração a cada 30 s. */
  async cliente(): Promise<{ integra: IntegraContador | null; origem: OrigemChaves }> {
    if (this.clienteCache && Date.now() - this.clienteCache.lidoEm < 30_000) return this.clienteCache;
    const p = await this.configPainel();
    let versao = 'nenhuma'; let cfg: ConfigIntegra | null = null; let origem: OrigemChaves = null;
    if (p && (p.ambiente === 'trial' || (p.consumer_key_cifrada && p.consumer_secret_cifrada))) {
      versao = `painel:${p.atualizado_em}`; origem = 'painel';
      try {
        cfg = {
          ambiente: p.ambiente,
          consumerKey: p.consumer_key_cifrada ? decifrar(p.consumer_key_cifrada, this.masterKey).toString('utf8') : '',
          consumerSecret: p.consumer_secret_cifrada ? decifrar(p.consumer_secret_cifrada, this.masterKey).toString('utf8') : '',
        };
      } catch {
        log.error('não foi possível decifrar as chaves do Integra Contador (MASTER_KEY diferente?)');
        cfg = null; origem = null;
      }
    } else if (this.cfgServidor) {
      versao = 'servidor'; cfg = this.cfgServidor; origem = 'servidor';
    }
    if (!this.clienteCache || this.clienteCache.versao !== versao) {
      this.clienteCache = { versao, origem, lidoEm: Date.now(), integra: cfg ? this.criar(cfg, () => this.contratante(), (r) => this.registrar(r)) : null };
    } else this.clienteCache.lidoEm = Date.now();
    return this.clienteCache;
  }

  async salvarChaves(dados: { consumerKey?: unknown; consumerSecret?: unknown; ambiente?: unknown }, email: string) {
    const ambiente: Ambiente = dados.ambiente === 'trial' ? 'trial' : 'producao';
    const key = String(dados.consumerKey ?? '').trim();
    const secret = String(dados.consumerSecret ?? '').trim();
    if (ambiente === 'producao') {
      if (!key || !secret) throw new ErroIntegra(422, 'Informe a Consumer Key e a Consumer Secret.');
      if (/\s/.test(key) || /\s/.test(secret) || key.length < 8 || secret.length < 8 || key.length > 200 || secret.length > 200) {
        throw new ErroIntegra(422, 'Chave em formato inválido: copie a Consumer Key e a Consumer Secret exatamente como aparecem na área do cliente do SERPRO.');
      }
    }
    ok(await this.db.from('integra_config').upsert({
      id: 1, ambiente,
      consumer_key_cifrada: key ? cifrar(Buffer.from(key, 'utf8'), this.masterKey) : null,
      consumer_secret_cifrada: secret ? cifrar(Buffer.from(secret, 'utf8'), this.masterKey) : null,
      final_chave: key ? key.slice(-4) : null,
      atualizado_em: new Date().toISOString(), atualizado_por: email,
    }, { onConflict: 'id' }), 'gravar chaves do Integra Contador');
    this.clienteCache = null;
    log.info('chaves do Integra Contador atualizadas', { ambiente, por: email });
    return this.situacao();
  }

  async removerChaves(email: string) {
    ok(await this.db.from('integra_config').delete().eq('id', 1), 'remover chaves do Integra Contador');
    this.clienteCache = null;
    log.info('chaves do Integra Contador removidas', { por: email });
    return this.situacao();
  }

  /** Empresa marcada como escritório, com certificado ativo (é o contratante do SERPRO). */
  private async escritorio() {
    const e = ok(await this.db.from('empresas').select('id,cnpj,razao_social,uf').eq('escritorio', true).eq('ativo', true).order('razao_social').limit(10), 'empresa do escritório') as { id: string; cnpj: string; razao_social: string; uf: string }[];
    if (!e.length) return null;
    const c = ok(await this.db.from('certificados').select('id,pfx_cifrado,senha_cifrada,valido_ate,titular').eq('empresa_id', e[0].id).eq('ativo', true)
      .order('criado_em', { ascending: false }).limit(1), 'certificado do escritório') as { id: string; pfx_cifrado: string; senha_cifrada: string; valido_ate: string; titular: string | null }[];
    return { ...e[0], certificado: c[0] ?? null, outros: e.slice(1).map((x) => x.razao_social) };
  }

  private async contratante(): Promise<Contratante> {
    const e = await this.escritorio();
    if (!e) throw new ErroIntegra(422, 'Cadastre o escritório em Administração › Escritório, com o e-CNPJ usado no contrato do SERPRO.');
    if (!e.certificado) throw new ErroIntegra(422, 'A empresa do escritório está sem certificado ativo: cadastre o e-CNPJ do contrato do SERPRO.');
    if (new Date(e.certificado.valido_ate).getTime() < Date.now()) throw new ErroIntegra(422, 'O certificado do escritório está vencido: o SERPRO não autentica com ele.');
    if (this.certCache?.id !== e.certificado.id) {
      let cert: Certificado;
      try {
        cert = lerPfx(decifrar(e.certificado.pfx_cifrado, this.masterKey), decifrar(e.certificado.senha_cifrada, this.masterKey).toString('utf8'));
      } catch (err) {
        throw new ErroIntegra(422, `Não foi possível abrir o certificado do escritório: ${(err as Error).message}`);
      }
      this.certCache = { id: e.certificado.id, c: { cnpj: e.cnpj, agente: criarAgente(cert) }, validoAte: e.certificado.valido_ate };
    }
    return this.certCache.c;
  }

  private async registrar(r: RegistroChamada) {
    const { error } = await this.db.from('integra_chamadas').insert({
      em: new Date().toISOString(), empresa_id: r.empresaId, cnpj: r.cnpj, metodo: r.metodo, sistema: r.sistema, servico: r.servico, status_http: r.statusHttp,
      sucesso: r.sucesso, mensagem: r.mensagem || null, por: r.por, ambiente: r.ambiente, duracao_ms: r.duracaoMs,
    });
    if (error) log.warn('não registrou chamada do Integra Contador', { erro: error.message });
  }

  private async exigirIntegra(real = true): Promise<IntegraContador> {
    const { integra } = await this.cliente();
    if (!integra) throw new ErroIntegra(503, 'Integra Contador não configurado: cadastre a Consumer Key e a Consumer Secret em Administração › Escritório.');
    if (real && integra.cfg.ambiente === 'trial') throw new ErroIntegra(409, 'O Appura está no ambiente de teste do SERPRO (dados fictícios): só o teste de conexão funciona e nada é gravado.');
    return integra;
  }

  private async empresa(id: string): Promise<EmpresaGuia> {
    const e = ok(await this.db.from('empresas').select('id,cnpj,razao_social,regime,ativo,escritorio').eq('id', id).maybeSingle(), 'ler empresa') as EmpresaGuia | null;
    if (!e) throw new ErroIntegra(404, 'Empresa não encontrada.');
    return e;
  }

  /* ---------- situação do módulo ---------- */

  async situacao() {
    const [e, { integra, origem }, painel] = await Promise.all([this.escritorio(), this.cliente(), this.configPainel()]);
    const ini = `${mesAtualSP()}-01T03:00:00Z`;
    const chamadas = ok(await this.db.from('integra_chamadas').select('servico,sucesso').gte('em', ini).limit(100000), 'chamadas do mês') as { servico: string; sucesso: boolean }[];
    const porServico: Record<string, number> = {};
    for (const c of chamadas) porServico[c.servico] = (porServico[c.servico] ?? 0) + 1;
    const pendencias: string[] = [];
    if (!integra) pendencias.push('Cadastrar a Consumer Key e a Consumer Secret do contrato do SERPRO em Administração › Escritório.');
    if (!e) pendencias.push('Cadastrar o escritório (Administração › Escritório) com o certificado e-CNPJ do contrato do SERPRO.');
    else if (!e.certificado) pendencias.push('Cadastrar o certificado e-CNPJ da empresa do escritório.');
    else if (new Date(e.certificado.valido_ate).getTime() < Date.now()) pendencias.push('Renovar o certificado e-CNPJ do escritório (vencido).');
    return {
      configurado: !!integra,
      ambiente: integra?.cfg.ambiente ?? null,
      chaves: {
        origem,
        finalChave: origem === 'painel' ? painel?.final_chave ?? null : null,
        atualizadoEm: origem === 'painel' ? painel?.atualizado_em ?? null : null,
        atualizadoPor: origem === 'painel' ? painel?.atualizado_por ?? null : null,
      },
      escritorio: e ? {
        id: e.id, cnpj: e.cnpj, razao_social: e.razao_social, uf: e.uf, titular: e.certificado?.titular ?? null,
        certificadoValidoAte: e.certificado?.valido_ate ?? null, outros: e.outros,
      } : null,
      chamadasMes: { total: chamadas.length, comErro: chamadas.filter((c) => !c.sucesso).length, porServico },
      pendencias,
      pronto: !!integra && integra.cfg.ambiente === 'producao' && !pendencias.length,
    };
  }

  /** Teste de conexão: em produção, só a autenticação (não gera cobrança de serviço); no trial, uma consulta de demonstração. */
  async testarConexao(email: string) {
    const integra = await this.exigirIntegra(false);
    if (integra.cfg.ambiente === 'producao') {
      await integra.autenticar(true);
      log.info('Integra Contador: autenticação testada', { por: email });
      return { ok: true, mensagem: 'O SERPRO autenticou o escritório com o certificado e as chaves configuradas.' };
    }
    const r = await integra.chamar({ metodo: 'Consultar', contribuinte: '00000000000100', idSistema: 'PGDASD', idServico: 'CONSULTIMADECREC14', dados: { periodoApuracao: '201801' }, por: email });
    return { ok: !temErro(r), mensagem: temErro(r) ? `O ambiente de teste respondeu com erro: ${textoMensagens(r.mensagens) || `status ${r.status}`}` : 'O ambiente de teste do SERPRO respondeu (dados fictícios, nada foi gravado).' };
  }

  /* ---------- procurações ---------- */

  async verificarProcuracao(empresaId: string, email: string) {
    const integra = await this.exigirIntegra();
    const e = await this.empresa(empresaId);
    const esc = await this.contratante();
    const r = await integra.chamar({
      metodo: 'Consultar', contribuinte: e.cnpj, idSistema: 'PROCURACOES', idServico: 'OBTERPROCURACAO41', versaoSistema: '1',
      dados: { outorgante: e.cnpj, tipoOutorgante: '2', outorgado: esc.cnpj, tipoOutorgado: '2' }, empresaId: e.id, por: email,
    });
    const msg = textoMensagens(r.mensagens);
    let linha;
    if (temErro(r) && !/n[aã]o (foi )?encontrad|n[aã]o existe|inexistente/i.test(msg)) {
      linha = { situacao: 'erro', expira_em: null, sistemas: [] as string[], mensagem: msg || `Status ${r.status}` };
    } else {
      const s = situacaoProcuracao(lerProcuracoes(r.dados), hojeSP());
      linha = { situacao: s.situacao, expira_em: s.expiraEm, sistemas: s.sistemas, mensagem: s.situacao === 'ausente' ? (msg || 'Nenhuma procuração do cliente para o escritório.') : null };
    }
    const salvo = ok(await this.db.from('integra_procuracoes').upsert({ empresa_id: e.id, ...linha, verificado_em: new Date().toISOString(), verificado_por: email }, { onConflict: 'empresa_id' })
      .select('*').single(), 'gravar procuração');
    log.info('procuração verificada', { cnpj: e.cnpj, situacao: linha.situacao, por: email });
    return salvo;
  }

  /* ---------- PGDAS-D: declaração do mês ---------- */

  async consultarDeclaracao(empresaId: string, competencia: string, email: string) {
    const integra = await this.exigirIntegra();
    const e = await this.empresa(empresaId);
    if (e.regime !== 'simples') throw new ErroIntegra(422, 'A declaração do PGDAS-D é do Simples Nacional. Confira o regime da empresa.');
    const pa = periodoApuracao(competencia);
    const r = await integra.chamar({ metodo: 'Consultar', contribuinte: e.cnpj, idSistema: 'PGDASD', idServico: 'CONSULTIMADECREC14', dados: { periodoApuracao: pa }, empresaId: e.id, por: email });
    const msg = textoMensagens(r.mensagens);
    const d = lerUltimaDeclaracao(r.dados);
    if (temErro(r) && !d && !/n[aã]o (h[aá]|foi|existe)|nenhuma|inexistente/i.test(msg)) throw new ErroIntegra(502, msg || `O SERPRO respondeu com status ${r.status}.`);
    const linha = {
      empresa_id: e.id, competencia: `${competencia.slice(0, 7)}-01`, situacao: d ? 'transmitida' : 'nao_transmitida',
      numero: d?.numero ?? null, mensagem: d ? null : (msg || 'Nenhuma declaração transmitida para o período.'),
      consultado_em: new Date().toISOString(), consultado_por: email,
    };
    return ok(await this.db.from('pgdas_declaracoes').upsert(linha, { onConflict: 'empresa_id,competencia' }).select('*').single(), 'gravar declaração');
  }

  /* ---------- DAS ---------- */

  async gerarDas(empresaId: string, competencia: string, email: string, forcar = false) {
    const integra = await this.exigirIntegra();
    const e = await this.empresa(empresaId);
    const t = TIPO_GUIA[e.regime ?? ''];
    if (!t) throw new ErroIntegra(422, 'Pelo Integra Contador, esta etapa gera o DAS do Simples Nacional e do MEI. Para outros regimes (DCTFWeb/DARF), aguarde a próxima etapa.');
    const comp = competencia.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(comp)) throw new ErroIntegra(400, 'Competência inválida.');
    if (comp > mesAtualSP()) throw new ErroIntegra(422, 'Não dá para gerar guia de competência futura.');
    const proc = ok(await this.db.from('integra_procuracoes').select('situacao,verificado_em').eq('empresa_id', e.id).maybeSingle(), 'procuração') as { situacao: string } | null;
    if (proc && (proc.situacao === 'ausente' || proc.situacao === 'vencida')) {
      throw new ErroIntegra(422, `A procuração do cliente para o escritório está ${proc.situacao === 'ausente' ? 'ausente' : 'vencida'}. Peça ao cliente para outorgar no e-CAC e verifique de novo.`);
    }
    if (!forcar) {
      const ja = ok(await this.db.from('guias').select('id,gerado_em,vencimento,total').eq('empresa_id', e.id).eq('competencia', `${comp}-01`).eq('tipo', t.tipo)
        .order('gerado_em', { ascending: false }).limit(1), 'guia existente') as { id: number; gerado_em: string; vencimento: string | null }[];
      if (ja.length && (!ja[0].vencimento || ja[0].vencimento >= hojeSP())) {
        throw new ErroIntegra(409, 'Já existe um DAS desta competência ainda dentro do vencimento. Gerar de novo faz outra chamada cobrada pelo SERPRO.', 'DAS_EXISTENTE');
      }
    }
    const r = await integra.chamar({ metodo: 'Emitir', contribuinte: e.cnpj, idSistema: t.sistema, idServico: t.servico, dados: { periodoApuracao: periodoApuracao(comp) }, empresaId: e.id, por: email });
    const guias = lerGuias(r.dados).filter((g) => g.pdf || g.numeroDocumento);
    if (temErro(r) || !guias.length) {
      throw new ErroIntegra(422, textoMensagens(r.mensagens) || 'O SERPRO não devolveu o DAS. Confira se a declaração do período foi transmitida.');
    }
    const salvas = [];
    for (const g of guias) salvas.push(await this.gravarGuia(e, comp, t.tipo, g, email));
    log.info('DAS gerado', { cnpj: e.cnpj, competencia: comp, tipo: t.tipo, guias: salvas.length, por: email });
    // Envio automático à Acessórias: falha no envio não desfaz a guia (fica "Reenviar" na tela)
    if (this.acessorias && await this.acessorias.envioAutomaticoAtivo().catch(() => false)) {
      for (const g of salvas as any[]) {
        if (!g.caminho) continue;
        try { g.envio = await this.acessorias.enviarGuia(g.id, email); } catch (err) { g.envio = { status: 'erro', mensagem: (err as Error).message }; }
      }
    }
    return { guias: salvas, avisos: r.mensagens.filter((m) => /aviso/i.test(m.codigo)).map((m) => m.texto) };
  }

  private async gravarGuia(e: EmpresaGuia, comp: string, tipo: string, g: Guia, email: string) {
    const caminho = g.pdf ? await this.arm.salvar(`guias/${e.cnpj}/${comp}/${tipo}-${g.numeroDocumento || Date.now()}.pdf`, g.pdf) : null;
    return ok(await this.db.from('guias').insert({
      empresa_id: e.id, competencia: `${comp}-01`, tipo, numero_documento: g.numeroDocumento || null,
      vencimento: g.vencimento, limite_acolhimento: g.limiteAcolhimento, principal: g.principal, multa: g.multa, juros: g.juros, total: g.total,
      composicao: g.composicao, observacoes: g.observacoes, codigo_barras: g.codigoBarras, caminho, tamanho: g.pdf?.length ?? null, gerado_por: email,
    }).select(COLUNAS_GUIA).single(), 'gravar guia');
  }

  async pdf(guiaId: number): Promise<{ nome: string; conteudo: Buffer }> {
    const g = ok(await this.db.from('guias').select('id,caminho,tipo,numero_documento,competencia,empresa_id').eq('id', guiaId).maybeSingle(), 'ler guia') as any;
    if (!g) throw new ErroIntegra(404, 'Guia não encontrada.');
    if (!g.caminho) throw new ErroIntegra(404, 'O SERPRO não devolveu o PDF desta guia.');
    return { nome: `${g.tipo === 'das_mei' ? 'DAS-MEI' : 'DAS'}-${String(g.competencia).slice(0, 7)}-${g.numero_documento ?? g.id}.pdf`, conteudo: await this.arm.ler(g.caminho) };
  }

  /* ---------- leitura para as telas ---------- */

  async daEmpresa(empresaId: string, competencia: string) {
    const comp = `${competencia.slice(0, 7)}-01`;
    const [procuracao, declaracao, guias, situacao] = await Promise.all([
      this.db.from('integra_procuracoes').select('*').eq('empresa_id', empresaId).maybeSingle().then((r) => ok(r, 'procuração')),
      this.db.from('pgdas_declaracoes').select('*').eq('empresa_id', empresaId).eq('competencia', comp).maybeSingle().then((r) => ok(r, 'declaração')),
      this.db.from('guias').select(COLUNAS_GUIA).eq('empresa_id', empresaId).order('gerado_em', { ascending: false }).limit(60).then((r) => ok(r, 'guias')),
      this.situacao(),
    ]);
    const envios = this.acessorias ? await this.acessorias.ultimosEnvios((guias as any[]).map((x) => x.id)) : new Map();
    for (const x of guias as any[]) x.envio = envios.get(x.id) ?? null;
    return { integra: situacao, procuracao, declaracao, guias, acessorias: this.acessorias ? await this.acessorias.situacao() : null };
  }

  /** Todas as empresas ativas com procuração, declaração e guia da competência (tela Guias). */
  async painel(competencia: string) {
    const comp = `${competencia.slice(0, 7)}-01`;
    const [empresas, procs, decls, guias, situacao] = await Promise.all([
      buscarTodos<EmpresaGuia>((de, ate) => this.db.from('empresas').select('id,cnpj,razao_social,regime,ativo,escritorio').eq('ativo', true).order('razao_social').range(de, ate), 'empresas'),
      buscarTodos<any>((de, ate) => this.db.from('integra_procuracoes').select('empresa_id,situacao,expira_em,verificado_em,mensagem').range(de, ate), 'procurações'),
      buscarTodos<any>((de, ate) => this.db.from('pgdas_declaracoes').select('empresa_id,situacao,numero,consultado_em').eq('competencia', comp).range(de, ate), 'declarações'),
      buscarTodos<any>((de, ate) => this.db.from('guias').select('id,empresa_id,tipo,numero_documento,vencimento,total,gerado_em,gerado_por').eq('competencia', comp).order('gerado_em', { ascending: false }).range(de, ate), 'guias'),
      this.situacao(),
    ]);
    const porEmpresa = <T extends { empresa_id: string }>(l: T[]) => { const m = new Map<string, T>(); for (const x of l) if (!m.has(x.empresa_id)) m.set(x.empresa_id, x); return m; };
    const p = porEmpresa(procs); const d = porEmpresa(decls); const g = porEmpresa(guias);
    if (this.acessorias) {
      const envios = await this.acessorias.ultimosEnvios([...g.values()].map((x: any) => x.id));
      for (const x of g.values()) (x as any).envio = envios.get((x as any).id) ?? null;
    }
    return {
      competencia: comp.slice(0, 7), integra: situacao, acessorias: this.acessorias ? await this.acessorias.situacao() : null,
      empresas: empresas.filter((e) => !e.escritorio).map((e) => ({
        id: e.id, cnpj: e.cnpj, razao_social: e.razao_social, regime: e.regime,
        procuracao: p.get(e.id) ?? null, declaracao: d.get(e.id) ?? null, guia: g.get(e.id) ?? null,
      })),
    };
  }

  /* ---------- lote (sequencial: respeita o SERPRO e mostra o resultado de cada empresa) ---------- */

  async lote(acao: 'procuracao' | 'das', ids: string[], competencia: string, email: string) {
    await this.exigirIntegra();
    const unicos = [...new Set(ids)].slice(0, LOTE_MAX);
    const resultados: { id: string; ok: boolean; mensagem: string }[] = [];
    for (const id of unicos) {
      try {
        if (acao === 'procuracao') {
          const r = await this.verificarProcuracao(id, email) as any;
          resultados.push({ id, ok: r.situacao === 'ativa', mensagem: ({ ativa: 'Procuração ativa', vencida: 'Procuração vencida', ausente: 'Sem procuração', erro: r.mensagem ?? 'Erro' } as Record<string, string>)[r.situacao] });
        } else {
          const r = await this.gerarDas(id, competencia, email);
          resultados.push({ id, ok: true, mensagem: `DAS gerado (${r.guias.length})` });
        }
      } catch (e) {
        resultados.push({ id, ok: false, mensagem: (e as Error).message });
        // Sem chave/certificado, as próximas também vão falhar: para aqui
        if (e instanceof ErroIntegra && (e.status === 401 || e.status === 503 || /certificado do escritório|empresa do escritório/.test(e.message))) break;
      }
    }
    return { resultados, limite: LOTE_MAX, ignoradas: Math.max(0, new Set(ids).size - unicos.length) };
  }
}

export const COLUNAS_GUIA = 'id,empresa_id,competencia,tipo,numero_documento,vencimento,limite_acolhimento,principal,multa,juros,total,composicao,observacoes,codigo_barras,caminho,gerado_em,gerado_por';
