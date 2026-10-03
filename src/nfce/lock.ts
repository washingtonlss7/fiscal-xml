/**
 * Lock por arrendamento no Postgres (tabela nfce_locks + funções nfce_lock_*). Seguro com o pool de conexões da
 * API do Supabase: quem pega renova de tempo em tempo; se o processo morrer, o lock vence sozinho.
 */
import { Db } from '../db';

export class Lock {
  private timer: ReturnType<typeof setInterval> | null = null;
  private perdido = false;
  constructor(private readonly db: Db, readonly chave: string, readonly dono: string, private readonly segundos = 120) {}

  async adquirir(): Promise<boolean> {
    const { data, error } = await this.db.rpc('nfce_lock_adquirir', { p_chave: this.chave, p_dono: this.dono, p_segundos: this.segundos });
    if (error) throw new Error(`lock: ${error.message}`);
    if (data !== true) return false;
    // Renova a cada 1/4 do prazo; se não conseguir renovar, marca como perdido (quem usa deve parar)
    this.timer = setInterval(() => {
      void this.db.rpc('nfce_lock_renovar', { p_chave: this.chave, p_dono: this.dono, p_segundos: this.segundos })
        .then((r: any) => { if (r.error || r.data !== true) this.perdido = true; });
    }, Math.max(1000, (this.segundos * 1000) / 4));
    if (typeof (this.timer as any).unref === 'function') (this.timer as any).unref();
    return true;
  }

  /** O lock ainda é deste dono? (falhou ao renovar = outro pode ter pegado) */
  get valido() { return this.timer !== null && !this.perdido; }

  async liberar(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.db.rpc('nfce_lock_liberar', { p_chave: this.chave, p_dono: this.dono });
  }
}
