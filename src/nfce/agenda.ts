/**
 * Regras puras de agenda do NFC-e Worker: datas pendentes (D-1..D-n + dias perdidos), hora de rodar,
 * backoff com variação aleatória e circuit breaker. Sem banco, sem rede: testadas em test/nfce-agenda.test.ts.
 */

/** Data (AAAA-MM-DD) no fuso de São Paulo. */
export function diaSP(d = new Date()): string {
  return d.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

export function somarDias(dia: string, n: number): string {
  const t = Date.parse(`${dia}T12:00:00Z`) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Datas a processar hoje, em ordem: os dias perdidos desde o último dia concluído (recuperação, até `maxRecuperar`)
 * e sempre a janela de reconciliação D-1..D-janela (a chave é deduplicada: reprocessar não duplica nada).
 * Nunca inclui hoje (o dia ainda não fechou).
 */
export function datasPendentes(ultimaDataOk: string | null, hoje: string, janelaDias: number, maxRecuperar = 31): string[] {
  const ontem = somarDias(hoje, -1);
  const datas = new Set<string>();
  for (let i = Math.max(1, janelaDias); i >= 1; i--) datas.add(somarDias(hoje, -i));
  if (ultimaDataOk && ultimaDataOk < ontem) {
    const limite = somarDias(hoje, -maxRecuperar);
    for (let d = somarDias(ultimaDataOk, 1); d <= ontem; d = somarDias(d, 1)) if (d >= limite) datas.add(d);
  }
  return [...datas].sort();
}

/** Instante (ISO) de hoje no horário "HH:MM" de São Paulo (UTC-3, sem horário de verão). */
export function instanteDoHorario(hoje: string, horario: string): string {
  return new Date(`${hoje}T${horario}:00-03:00`).toISOString();
}

/** A execução agendada de hoje já deveria ter começado e ainda não foi tentada? */
export function deveAgendar(horario: string, agora: Date, ultimaTentativaEm: string | null): boolean {
  const alvo = instanteDoHorario(diaSP(agora), horario);
  if (agora.toISOString() < alvo) return false;
  return !ultimaTentativaEm || ultimaTentativaEm < alvo;
}

/** Espera antes da tentativa `tentativa` (1, 2, 3…): base·2^(t−1) com ±50% de variação, no máximo 1 hora. */
export function backoffMs(tentativa: number, baseSeg: number, aleatorio: () => number = Math.random): number {
  const bruto = baseSeg * 1000 * 2 ** Math.max(0, tentativa - 1);
  return Math.round(Math.min(3600_000, bruto) * (0.5 + aleatorio()));
}

/**
 * Circuit breaker: se várias empresas seguidas falham com o mesmo código (ex.: SEFAZ fora do ar), para de chamar
 * por um tempo e depois deixa passar uma tentativa. Sucesso fecha; falha com outro código recomeça a contagem.
 */
export class CircuitBreaker {
  private falhas = 0;
  private codigo: string | null = null;
  private abertoAte = 0;
  private meioAberto = false;
  constructor(private readonly limite = 5, private readonly pausaMs = 10 * 60_000) {}

  /** Pode chamar agora? Depois da pausa, libera uma tentativa (meio aberto). */
  pode(agora = Date.now()): boolean {
    if (this.abertoAte === 0) return true;
    if (agora < this.abertoAte) return false;
    this.meioAberto = true;
    return true;
  }

  sucesso() { this.falhas = 0; this.codigo = null; this.abertoAte = 0; this.meioAberto = false; }

  falha(codigo: string, agora = Date.now()) {
    if (this.meioAberto) { this.abertoAte = agora + this.pausaMs; this.meioAberto = false; return; }
    this.falhas = this.codigo === codigo ? this.falhas + 1 : 1;
    this.codigo = codigo;
    if (this.falhas >= this.limite) this.abertoAte = agora + this.pausaMs;
  }

  estado(agora = Date.now()) {
    return { aberto: this.abertoAte > agora, codigo: this.codigo, falhasSeguidas: this.falhas, reabreEm: this.abertoAte > agora ? new Date(this.abertoAte).toISOString() : null };
  }
}
