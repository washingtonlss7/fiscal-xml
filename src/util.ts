export const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Executa `fn` sobre os itens com no máximo `limite` tarefas ao mesmo tempo. */
export async function emParalelo<T>(itens: T[], limite: number, fn: (item: T) => Promise<void>): Promise<void> {
  let i = 0;
  const trabalhadores = Array.from({ length: Math.min(limite, itens.length) }, async () => {
    while (i < itens.length) {
      const item = itens[i++];
      await fn(item);
    }
  });
  await Promise.all(trabalhadores);
}

export const minutos = (n: number) => n * 60_000;
export const daquiA = (ms: number) => new Date(Date.now() + ms).toISOString();
