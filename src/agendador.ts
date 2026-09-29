/**
 * Agendador contínuo das consultas à SEFAZ.
 *
 * Em vez de rodadas fixas que varrem todas as empresas (e que, com 1.000 empresas, se atropelam),
 * mantém sempre até N empresas sincronizando ao mesmo tempo. Quando uma termina, a vaga vai
 * para a próxima empresa cuja consulta já venceu (a mais atrasada primeiro).
 */

export interface Trabalho {
  id: string;
  rodar: () => Promise<void>;
}

/** Busca até `limite` trabalhos prontos, ignorando os ids em `excluir`. */
export type FonteTrabalhos = (limite: number, excluir: string[]) => Promise<Trabalho[]>;

export class Agendador {
  private readonly emCurso = new Map<string, Promise<void>>();
  /** Empresas que acabaram de rodar: ficam de fora por um tempo, para nunca girar em falso. */
  private readonly recentes = new Map<string, number>();
  private abastecendo = false;
  private repetir = false;
  private parado = false;

  constructor(
    private readonly limite: number,
    private readonly fonte: FonteTrabalhos,
    private readonly aoErro: (e: unknown) => void = () => {},
    private readonly pausaMs = 60_000,
    private readonly idsExternos: () => Iterable<string> = () => [],
  ) {}

  get ativos(): number {
    return this.emCurso.size;
  }

  /** Preenche as vagas livres. Pode ser chamado a qualquer momento; chamadas simultâneas se juntam. */
  async abastecer(): Promise<void> {
    if (this.parado) return;
    if (this.abastecendo) {
      this.repetir = true;
      return;
    }
    this.abastecendo = true;
    try {
      do {
        this.repetir = false;
        const livres = this.limite - this.emCurso.size;
        if (livres <= 0) break;

        const agora = Date.now();
        for (const [id, fim] of this.recentes) if (agora - fim >= this.pausaMs) this.recentes.delete(id);
        const excluir = [...new Set([...this.emCurso.keys(), ...this.recentes.keys(), ...this.idsExternos()])];

        const trabalhos = await this.fonte(livres, excluir);
        for (const t of trabalhos) {
          if (this.parado || this.emCurso.size >= this.limite) break;
          if (this.emCurso.has(t.id) || this.recentes.has(t.id)) continue;
          const p = Promise.resolve()
            .then(t.rodar)
            .catch(this.aoErro)
            .finally(() => {
              this.emCurso.delete(t.id);
              this.recentes.set(t.id, Date.now());
              void this.abastecer();
            });
          this.emCurso.set(t.id, p);
        }
      } while (this.repetir && !this.parado);
    } catch (e) {
      this.aoErro(e);
    } finally {
      this.abastecendo = false;
    }
  }

  /** Para de iniciar novas empresas e espera as que estão em andamento terminarem. */
  async parar(): Promise<void> {
    this.parado = true;
    await Promise.allSettled([...this.emCurso.values()]);
  }
}
