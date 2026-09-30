/**
 * Cliente do Integra Contador (API oficial da Receita Federal, operada pelo SERPRO).
 *
 * Autenticação (documentação "Como autenticar na API"):
 *   POST https://autenticacao.sapi.serpro.gov.br/authenticate
 *     Authorization: Basic base64(consumerKey:consumerSecret) · Role-Type: TERCEIROS
 *     corpo grant_type=client_credentials · mTLS com o e-CNPJ do CONTRATANTE (o escritório)
 *   -> { access_token, jwt_token, expires_in }
 * Chamadas: POST {gateway}/{Apoiar|Consultar|Declarar|Emitir|Monitorar}
 *     Authorization: Bearer access_token · jwt_token: jwt_token
 *     { contratante, autorPedidoDados, contribuinte, pedidoDados: { idSistema, idServico, versaoSistema, dados } }
 *
 * O escritório é contratante e autor do pedido; o cliente é o contribuinte e precisa ter dado
 * procuração eletrônica (e-CAC) ao CNPJ do escritório. Cada chamada é cobrada pelo SERPRO: todas ficam registradas.
 * As chaves (Consumer Key/Secret) vêm só do ambiente do servidor (Easypanel), nunca do banco nem da tela.
 */
import https from 'https';
import { URL } from 'url';
import { lerResposta, RespostaGateway, temErro, textoMensagens } from './respostas';

export type Ambiente = 'producao' | 'trial';
export type Metodo = 'Apoiar' | 'Consultar' | 'Declarar' | 'Emitir' | 'Monitorar';

export const URL_AUTENTICACAO = 'https://autenticacao.sapi.serpro.gov.br/authenticate';
export const GATEWAY: Record<Ambiente, string> = {
  producao: 'https://gateway.apiserpro.serpro.gov.br/integra-contador/v1',
  trial: 'https://gateway.apiserpro.serpro.gov.br/integra-contador-trial/v1',
};
/** Token público do ambiente de demonstração do SERPRO (dados fictícios, sem certificado). */
const TOKEN_TRIAL = '06aef429-a981-3ec5-a1f8-71d38d86481e';

export interface ConfigIntegra { ambiente: Ambiente; consumerKey: string; consumerSecret: string }

/** Lê a configuração do ambiente. Sem chaves (e fora do trial), o Integra Contador fica "não configurado". */
export function configIntegra(env: NodeJS.ProcessEnv = process.env): ConfigIntegra | null {
  const ambiente: Ambiente = String(env.SERPRO_AMBIENTE ?? '').trim().toLowerCase() === 'trial' ? 'trial' : 'producao';
  const consumerKey = String(env.SERPRO_CONSUMER_KEY ?? '').trim();
  const consumerSecret = String(env.SERPRO_CONSUMER_SECRET ?? '').trim();
  if (ambiente === 'producao' && (!consumerKey || !consumerSecret)) return null;
  return { ambiente, consumerKey, consumerSecret };
}

export interface Transporte {
  post(url: string, headers: Record<string, string>, corpo: string, agente?: https.Agent): Promise<{ status: number; corpo: string }>;
}

/** Transporte real (HTTPS do Node, com o agente mTLS do certificado do escritório). */
export const transporteHttps: Transporte = {
  post(url, headers, corpo, agente) {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = https.request({
        method: 'POST', hostname: u.hostname, path: u.pathname + u.search, port: 443, agent: agente,
        headers: { ...headers, 'Content-Length': Buffer.byteLength(corpo) }, timeout: 60_000,
      }, (res) => {
        const partes: Buffer[] = [];
        res.on('data', (c) => partes.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo: Buffer.concat(partes).toString('utf8') }));
      });
      req.on('timeout', () => req.destroy(new Error('O SERPRO não respondeu em 60 segundos.')));
      req.on('error', reject);
      req.end(corpo);
    });
  },
};

export class ErroIntegra extends Error {
  constructor(public readonly status: number, mensagem: string, public readonly codigo = '') { super(mensagem); }
}

/** Certificado do contratante: CNPJ e agente mTLS (o e-CNPJ do escritório cadastrado no Appura). */
export interface Contratante { cnpj: string; agente?: https.Agent }

export interface RegistroChamada {
  empresaId: string | null; cnpj: string; metodo: Metodo; sistema: string; servico: string;
  statusHttp: number; sucesso: boolean; mensagem: string; por: string; ambiente: Ambiente; duracaoMs: number;
}

export interface Pedido {
  metodo: Metodo;
  contribuinte: string; // CNPJ (14) ou CPF (11)
  idSistema: string;
  idServico: string;
  versaoSistema?: string;
  dados: Record<string, unknown> | string;
  empresaId?: string | null;
  por: string;
}

export class IntegraContador {
  private token: { acesso: string; jwt: string; ate: number } | null = null;
  private obtendo: Promise<{ acesso: string; jwt: string }> | null = null;

  constructor(
    readonly cfg: ConfigIntegra,
    private readonly contratante: () => Promise<Contratante>,
    private readonly transporte: Transporte = transporteHttps,
    private readonly registrar: (r: RegistroChamada) => Promise<void> = async () => {},
    private readonly agora: () => number = Date.now,
  ) {}

  /** Token de acesso em cache até 1 minuto antes de expirar (uma autenticação para várias chamadas). */
  async autenticar(forcar = false): Promise<{ acesso: string; jwt: string }> {
    if (this.cfg.ambiente === 'trial') return { acesso: TOKEN_TRIAL, jwt: TOKEN_TRIAL };
    if (!forcar && this.token && this.token.ate > this.agora()) return this.token;
    if (!this.obtendo) {
      this.obtendo = (async () => {
        const c = await this.contratante();
        const basic = Buffer.from(`${this.cfg.consumerKey}:${this.cfg.consumerSecret}`).toString('base64');
        let r: { status: number; corpo: string };
        try {
          r = await this.transporte.post(URL_AUTENTICACAO, {
            Authorization: `Basic ${basic}`, 'Role-Type': 'TERCEIROS', 'Content-Type': 'application/x-www-form-urlencoded',
          }, 'grant_type=client_credentials', c.agente);
        } catch (e) {
          throw new ErroIntegra(503, `Não foi possível conectar ao SERPRO: ${(e as Error).message}`);
        }
        let j: any = null;
        try { j = JSON.parse(r.corpo); } catch { /* corpo não é JSON */ }
        if (r.status !== 200 || !j?.access_token || !j?.jwt_token) {
          throw new ErroIntegra(r.status === 401 || r.status === 403 ? 401 : 502,
            r.status === 401 || r.status === 403
              ? 'O SERPRO recusou a autenticação: confira a Consumer Key, a Consumer Secret e se o certificado do escritório é o mesmo e-CNPJ do contrato.'
              : `O SERPRO não autenticou (HTTP ${r.status}).`);
        }
        const segundos = Math.max(60, Number(j.expires_in) || 0);
        this.token = { acesso: String(j.access_token), jwt: String(j.jwt_token), ate: this.agora() + (segundos - 60) * 1000 };
        return this.token;
      })().finally(() => { this.obtendo = null; });
    }
    return this.obtendo;
  }

  /** Uma chamada ao gateway. Renova o token uma vez se o SERPRO devolver 401. Toda chamada é registrada. */
  async chamar(p: Pedido): Promise<RespostaGateway> {
    const inicio = this.agora();
    const c = this.cfg.ambiente === 'trial' ? { cnpj: '00000000000000' } as Contratante : await this.contratante();
    const tipo = (n: string) => (n.length === 11 ? 1 : 2);
    const corpo = JSON.stringify({
      contratante: { numero: c.cnpj, tipo: 2 },
      autorPedidoDados: { numero: c.cnpj, tipo: 2 },
      contribuinte: { numero: p.contribuinte, tipo: tipo(p.contribuinte) },
      pedidoDados: {
        idSistema: p.idSistema, idServico: p.idServico, versaoSistema: p.versaoSistema ?? '1.0',
        dados: typeof p.dados === 'string' ? p.dados : JSON.stringify(p.dados),
      },
    });
    const url = `${GATEWAY[this.cfg.ambiente]}/${p.metodo}`;
    let resposta: RespostaGateway | null = null;
    let statusHttp = 0;
    let falha: ErroIntegra | null = null;
    try {
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        const t = await this.autenticar(tentativa > 0);
        let r: { status: number; corpo: string };
        try {
          r = await this.transporte.post(url, { Authorization: `Bearer ${t.acesso}`, jwt_token: t.jwt, 'Content-Type': 'application/json', Accept: 'application/json' }, corpo, c.agente);
        } catch (e) {
          throw new ErroIntegra(503, `Não foi possível conectar ao SERPRO: ${(e as Error).message}`);
        }
        statusHttp = r.status;
        if (r.status === 401 && tentativa === 0 && this.cfg.ambiente !== 'trial') { this.token = null; continue; }
        resposta = lerResposta(r.status, r.corpo);
        break;
      }
      if (!resposta) throw new ErroIntegra(401, 'O SERPRO recusou o token de acesso.');
      if (statusHttp === 429) throw new ErroIntegra(429, 'O SERPRO limitou as chamadas por excesso de requisições. Tente de novo em alguns minutos.');
      if (statusHttp >= 500 && !resposta.mensagens.length) throw new ErroIntegra(502, `O SERPRO está indisponível agora (HTTP ${statusHttp}).`);
      return resposta;
    } catch (e) {
      falha = e instanceof ErroIntegra ? e : new ErroIntegra(500, (e as Error).message);
      throw falha;
    } finally {
      const sucesso = !falha && !!resposta && !temErro(resposta);
      await this.registrar({
        empresaId: p.empresaId ?? null, cnpj: p.contribuinte, metodo: p.metodo, sistema: p.idSistema, servico: p.idServico,
        statusHttp, sucesso, mensagem: (falha ? falha.message : resposta ? textoMensagens(resposta.mensagens) : '').slice(0, 500),
        por: p.por, ambiente: this.cfg.ambiente, duracaoMs: this.agora() - inicio,
      }).catch(() => { /* registrar nunca derruba a chamada */ });
    }
  }
}
