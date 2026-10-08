/**
 * Saídas do Contábil:
 *  - Planilha de conferência (colunas do item 31 da especificação): é o que o Contábil valida antes de importar.
 *  - TXT "Lançamentos Contábeis em Lote" do Domínio (Utilitários → Importação), leiaute posicional:
 *      01 cabeçalho (55) · 02 lançamento (165) + 03 partida (664) por lançamento · 99 rodapé ("9" × 100)
 *    Latin-1, sem BOM, CRLF (inclusive na última linha), valores em centavos, datas dd/mm/aaaa, contas com 7 dígitos.
 *    Leiaute descrito a partir de um arquivo exportado pelo Domínio; campos do cabeçalho (lote e o "1" final) e o
 *    histórico ainda precisam ser confirmados com um export real do escritório. Por isso o arquivo só é marcado
 *    "definitivo" (e trava os lançamentos) quando o usuário pede.
 */
import crypto from 'crypto';
import { Aba } from '../painel/xlsx';

export interface LancamentoSaida {
  data: string; conta_debito: string; conta_credito: string; valor: number; historico: string; historico_codigo: string | null;
  origem: string; documento: string | null; competencia: string; regra?: string | null;
}

export class ErroDominio extends Error {}

const pad0 = (v: string | number, n: number) => String(v).padStart(n, '0');
const padR = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const so = (s: string) => String(s ?? '').replace(/\D/g, '');
const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Texto para o campo posicional: maiúsculas, sem quebras e só caracteres do Latin-1. */
export function textoLatin1(t: string): string {
  return String(t ?? '').toUpperCase().replace(/[\r\n\t]+/g, ' ').replace(/[–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x20-\xFF]/g, '');
}

export function arquivoDominio(e: { codigo_dominio: string; cnpj: string }, inicio: string, fim: string, lote: number, lancs: LancamentoSaida[]) {
  if (!lancs.length) throw new ErroDominio('Nenhum lançamento para exportar.');
  const empresa = so(e.codigo_dominio);
  if (!empresa || empresa.length > 7) throw new ErroDominio('Empresa sem código do Domínio válido.');
  const cnpj = so(e.cnpj);
  for (const l of lancs) {
    for (const c of [l.conta_debito, l.conta_credito]) if (!/^\d{1,7}$/.test(c)) throw new ErroDominio(`Conta inválida para o Domínio: ${c}`);
    if (l.historico_codigo && !/^\d{1,7}$/.test(l.historico_codigo)) throw new ErroDominio(`Código de histórico inválido: ${l.historico_codigo}`);
    if (!(l.valor > 0)) throw new ErroDominio('Lançamento com valor zero ou negativo.');
  }
  const emp7 = pad0(empresa, 7);
  const linhas: string[] = [];
  linhas.push(`01${emp7}${pad0(cnpj, 14)}${br(inicio)}${br(fim)}N05${pad0(lote, 8)}1`);
  const ordenados = [...lancs].sort((a, b) => a.data.localeCompare(b.data));
  let seq = 0; let total = 0;
  for (const l of ordenados) {
    const centavos = Math.round(l.valor * 100);
    total += centavos;
    linhas.push(padR(`02${pad0(++seq, 7)}X${br(l.data)}${' '.repeat(45)}N`, 165));
    linhas.push(padR(`03${pad0(++seq, 7)}${pad0(l.conta_debito, 7)}${pad0(l.conta_credito, 7)}${pad0(centavos, 15)}${pad0(l.historico_codigo || '0', 7)}${padR(textoLatin1(l.historico), 512)}${emp7}`, 664));
  }
  linhas.push('9'.repeat(100));
  const conteudo = Buffer.from(linhas.join('\r\n') + '\r\n', 'latin1');
  return { conteudo, sha256: crypto.createHash('sha256').update(conteudo).digest('hex'), lancamentos: lancs.length, total: total / 100 };
}

/** Planilha de conferência (uma aba de lançamentos e uma de totais por conta). */
export function abasConferencia(titulo: string, empresa: { codigo_dominio: string; razao_social: string }, lancs: LancamentoSaida[]): Aba[] {
  const ord = [...lancs].sort((a, b) => a.data.localeCompare(b.data) || a.origem.localeCompare(b.origem));
  const lanc: Aba = {
    nome: 'Lançamentos', cabecalho: [titulo, `${empresa.codigo_dominio} · ${empresa.razao_social}`],
    colunas: [
      { titulo: 'Empresa', tipo: 'texto', largura: 9 }, { titulo: 'Data', tipo: 'data', largura: 12 }, { titulo: 'Débito', tipo: 'texto', largura: 10 },
      { titulo: 'Crédito', tipo: 'texto', largura: 10 }, { titulo: 'Valor', tipo: 'moeda', largura: 14, total: true }, { titulo: 'Histórico', tipo: 'texto', largura: 60 },
      { titulo: 'Origem', tipo: 'texto', largura: 9 }, { titulo: 'Documento', tipo: 'texto', largura: 22 }, { titulo: 'Competência', tipo: 'texto', largura: 11 },
      { titulo: 'Regra', tipo: 'texto', largura: 22 },
    ],
    linhas: ord.map((l) => [empresa.codigo_dominio, l.data, l.conta_debito, l.conta_credito, l.valor, l.historico, l.origem.toUpperCase(), l.documento ?? '', `${l.competencia.slice(5, 7)}/${l.competencia.slice(0, 4)}`, l.regra ?? '']),
  };
  const porConta = new Map<string, { d: number; c: number }>();
  for (const l of lancs) {
    const d = porConta.get(l.conta_debito) ?? { d: 0, c: 0 }; d.d += l.valor; porConta.set(l.conta_debito, d);
    const c = porConta.get(l.conta_credito) ?? { d: 0, c: 0 }; c.c += l.valor; porConta.set(l.conta_credito, c);
  }
  const contas: Aba = {
    nome: 'Totais por conta', cabecalho: [titulo, 'Total de débitos = total de créditos (conferência do lote)'],
    colunas: [{ titulo: 'Conta', tipo: 'texto', largura: 10 }, { titulo: 'Débitos', tipo: 'moeda', largura: 16, total: true }, { titulo: 'Créditos', tipo: 'moeda', largura: 16, total: true }, { titulo: 'Saldo (D − C)', tipo: 'moeda', largura: 16 }],
    linhas: [...porConta.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => [k, Math.round(v.d * 100) / 100, Math.round(v.c * 100) / 100, Math.round((v.d - v.c) * 100) / 100]),
  };
  return [lanc, contas];
}
