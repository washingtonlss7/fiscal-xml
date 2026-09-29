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

/** Janela de horário (minutos do dia, fuso de São Paulo). Pode atravessar a meia-noite (ex.: 23h às 6h). */
export interface Janela {
  inicio: number;
  fim: number;
  texto: string;
}

/** Lê "23-6", "23:00-06:00" ou "22:30-05:45". Vazio ou "0-24" = sem restrição (devolve null). */
export function lerJanela(valor: string | undefined): Janela | null {
  const v = (valor ?? '').trim();
  if (!v || v === '0-24' || /^(sempre|livre|off)$/i.test(v)) return null;
  const m = v.match(/^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/);
  if (!m) throw new Error(`JANELA_SINCRONIZACAO inválida: "${v}". Use, por exemplo, 23-6 ou 23:00-06:00.`);
  const inicio = Number(m[1]) * 60 + Number(m[2] ?? 0);
  const fim = Number(m[3]) * 60 + Number(m[4] ?? 0);
  if (inicio > 1440 || fim > 1440 || inicio === fim) throw new Error(`JANELA_SINCRONIZACAO inválida: "${v}".`);
  const hh = (n: number) => `${Math.floor(n / 60)}h${n % 60 ? String(n % 60).padStart(2, '0') : ''}`;
  return { inicio, fim, texto: `${hh(inicio)} às ${hh(fim)}` };
}

/** Minutos do dia no horário de Brasília. */
export function minutoDoDiaSP(d = new Date()): number {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d);
  const n = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return n('hour') * 60 + n('minute');
}

/** A janela está aberta agora? Sem janela configurada, sempre. */
export function dentroDaJanela(janela: Janela | null, d = new Date()): boolean {
  if (!janela) return true;
  const m = minutoDoDiaSP(d);
  return janela.inicio < janela.fim ? m >= janela.inicio && m < janela.fim : m >= janela.inicio || m < janela.fim;
}
