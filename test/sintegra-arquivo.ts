/** Monta arquivos SINTEGRA sintéticos para os testes (126 posições, registros 90 corretos). */
export const CNPJ = '20368691000198';
export const FORN = '11222333000181';
const pad = (s: string | number, n: number) => String(s).padEnd(n, ' ').slice(0, n);
const num = (v: number, n: number) => String(Math.round(v * 100)).padStart(n, '0');

export const r10 = (fin = '1') => `10${CNPJ}${pad('0023702760067', 14)}${pad('BABY KIDS ABREU LTDA', 35)}${pad('JANUARIA', 30)}MG${pad('', 10)}2026080120260831${'3'}${'3'}${fin}`;
export const r11 = () => `11${pad('AVENIDA CONEGO RAMIRO LEITE,780', 34)}00001${pad('', 22)}${pad('CENTRO', 15)}39480000${pad('KEILA', 28)}${pad('038362149160', 12)}`;
export const r50 = (o: { cnpj?: string; data?: string; serie?: string; numero: number; cfop: string; emit?: string; valor: number; bc?: number; icms?: number; isenta?: number; outras?: number; aliq?: number; sit?: string }) =>
  `50${o.cnpj ?? FORN}${pad('ISENTO', 14)}${o.data ?? '20260805'}MG55${pad(o.serie ?? '1', 3)}${String(o.numero).padStart(6, '0')}${o.cfop}${o.emit ?? 'T'}` +
  `${num(o.valor, 13)}${num(o.bc ?? 0, 13)}${num(o.icms ?? 0, 13)}${num(o.isenta ?? 0, 13)}${num(o.outras ?? o.valor, 13)}${num(o.aliq ?? 0, 4)}${o.sit ?? 'N'}`;
export const r61 = (data: string, ini: number, fim: number, valor: number, outras = valor) =>
  `61${pad('', 28)}${data}65${pad('01', 3)}${pad('', 2)}${String(ini).padStart(6, '0')}${String(fim).padStart(6, '0')}${num(valor, 13)}${num(0, 13)}${num(0, 12)}${num(0, 13)}${num(outras, 13)}${num(0, 4)} `;
export const r88 = (sub: string, texto: string) => `88${sub}${CNPJ}${pad(texto, 107)}`;

/** Monta o arquivo com os registros 90 corretos. */
export function montar(corpo: string[], opts: { quebrar90?: boolean } = {}) {
  const linhas = [r10(), r11(), ...corpo];
  const cont = new Map<string, number>();
  for (const l of linhas) { const tp = l.slice(0, 2); if (!['10', '11'].includes(tp)) cont.set(tp, (cont.get(tp) ?? 0) + 1); }
  if (opts.quebrar90 && cont.has('61')) cont.set('61', cont.get('61')! + 1);
  const pares = [...cont.entries()].sort().map(([k, v]) => `${k}${String(v).padStart(8, '0')}`);
  const grupos: string[][] = [];
  for (let i = 0; i < pares.length + 1; i += 9) grupos.push(pares.slice(i, i + 9));
  if (!grupos.length) grupos.push([]);
  const qtd90 = grupos.length;
  const total = linhas.length + qtd90;
  const ultimo = grupos[grupos.length - 1];
  if (ultimo.length < 9) ultimo.push(`99${String(total).padStart(8, '0')}`); else grupos.push([`99${String(total).padStart(8, '0')}`]);
  const l90 = grupos.map((g) => `90${CNPJ}${pad('0023702760067', 14)}${pad(g.join(''), 95)}${grupos.length}`);
  return Buffer.from([...linhas, ...l90].join('\r\n') + '\r\n', 'latin1');
}

