/**
 * Contratos do NFC-e Worker. Cada UF tem o seu conector de descoberta (lista as NFC-e emitidas num dia) e,
 * quando houver, o serviço de download do XML pela chave. Nada de "if UF" espalhado: o worker pede ao registro.
 * Fase 1: o registro de produção fica VAZIO (nenhum acesso à SEFAZ). Os testes registram conectores falsos.
 */

export interface EmpresaNfce { id: string; cnpj: string; uf: string; razao_social: string }

export interface NotaDescoberta { chave: string; numero?: string | null; serie?: string | null; emitidaEm?: string | null; valor?: number | null }

/** Erro de conector: `temporario` = vale tentar de novo (rede, SEFAZ fora do ar); senão é definitivo (credencial, CAPTCHA). */
export class ErroConector extends Error {
  constructor(public readonly codigo: string, mensagem: string, public readonly temporario = true) { super(mensagem); }
}

export interface ContextoConector { empresa: EmpresaNfce; sinal: AbortSignal }

export interface NFCeDiscoveryConnector {
  readonly uf: string;
  /** NFC-e (modelo 65) emitidas pela empresa no dia (AAAA-MM-DD). */
  descobrir(ctx: ContextoConector, data: string): Promise<NotaDescoberta[]>;
}

export interface NFCeDownloadService {
  readonly uf: string;
  /** XML (nfeProc) da NFC-e pela chave. */
  baixar(ctx: ContextoConector, chave: string): Promise<Buffer>;
}

export class RegistroConectores {
  private readonly descoberta = new Map<string, NFCeDiscoveryConnector>();
  private readonly download = new Map<string, NFCeDownloadService>();
  registrarDescoberta(c: NFCeDiscoveryConnector) { this.descoberta.set(c.uf.toUpperCase(), c); return this; }
  registrarDownload(c: NFCeDownloadService) { this.download.set(c.uf.toUpperCase(), c); return this; }
  descobertaDe(uf: string) { return this.descoberta.get(uf.toUpperCase()) ?? null; }
  downloadDe(uf: string) { return this.download.get(uf.toUpperCase()) ?? null; }
  ufs() { return [...this.descoberta.keys()]; }
}

/** A chave é de uma NFC-e (modelo 65) emitida por este CNPJ? Posições da chave: cUF(2) AAMM(4) CNPJ(14) mod(2)… */
export function chaveDaEmpresa(chave: string, cnpj: string): boolean {
  return /^\d{44}$/.test(chave) && chave.slice(20, 22) === '65' && chave.slice(6, 20) === cnpj;
}
