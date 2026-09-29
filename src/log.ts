type Nivel = 'debug' | 'info' | 'warn' | 'error';

const ordem: Record<Nivel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minimo = ordem[(process.env.LOG_LEVEL as Nivel) ?? 'info'] ?? 20;

function escrever(nivel: Nivel, msg: string, extra?: Record<string, unknown>) {
  if (ordem[nivel] < minimo) return;
  const linha = JSON.stringify({ t: new Date().toISOString(), nivel, msg, ...extra });
  if (nivel === 'error' || nivel === 'warn') console.error(linha);
  else console.log(linha);
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => escrever('debug', msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => escrever('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => escrever('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => escrever('error', msg, extra),
};
