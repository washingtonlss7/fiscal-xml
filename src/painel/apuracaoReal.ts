/**
 * Apuração do Lucro Real (e Presumido, no que der) na aba Apuração: ICMS e PIS/COFINS do mês.
 * Não calcula nada novo: junta o que o gerador de SPED do Appura apurou (E110, M200/M600) com o que está no SPED
 * enviado do mês (o do ERP) e mostra as diferenças, campo a campo. IRPJ/CSLL ainda não (dependem da contabilidade).
 */
import { Db, ok } from '../db';

export interface LinhaComparacao { campo: string; rotulo: string; appura: number | null; sped: number | null; diferenca: number | null }

const r2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : r2(Number(v)));

/** Linhas lado a lado; diferença = Appura − SPED (null quando falta um lado). */
export function comparar(campos: [string, string][], appura: Record<string, unknown> | null, sped: Record<string, unknown> | null): LinhaComparacao[] {
  return campos.map(([campo, rotulo]) => {
    const a = appura ? num(appura[campo]) : null; const s = sped ? num(sped[campo]) : null;
    return { campo, rotulo, appura: a, sped: s, diferenca: a != null && s != null ? r2(a - s) : null };
  });
}

/** Vencimento do PIS/COFINS no Lucro Real: dia 25 do mês seguinte, antecipado para sexta se cair no fim de semana (feriados não entram). */
export function vencimentoPisCofins(competencia: string): string {
  const [a, m] = competencia.split('-').map(Number);
  const d = new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 25));
  const dia = d.getUTCDay();
  if (dia === 6) d.setUTCDate(24); else if (dia === 0) d.setUTCDate(23);
  return d.toISOString().slice(0, 10);
}

const CAMPOS_ICMS: [string, string][] = [
  ['debitos', 'Débitos (saídas)'], ['creditos', 'Créditos (entradas)'], ['saldoCredorAnterior', 'Saldo credor do mês anterior'],
  ['aRecolher', 'ICMS a recolher'], ['saldoCredorTransportar', 'Saldo credor para o mês seguinte'],
];
const CAMPOS_CONTRIB: [string, string][] = [['debito', 'Contribuição do período'], ['credito', 'Créditos'], ['aRecolher', 'A recolher']];

export async function apuracaoReal(db: Db, empresaId: string, competencia: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(competencia)) throw new Error('Competência inválida.');
  const e = ok(await db.from('empresas').select('id,cnpj,regime').eq('id', empresaId).maybeSingle(), 'empresa') as { id: string; cnpj: string; regime: string | null } | null;
  if (!e) throw new Error('Empresa não encontrada.');
  const comp = `${competencia}-01`;
  const raiz = e.cnpj.slice(0, 8);
  // SPED gerado pelo Appura (última versão) e SPED enviado do mês (o vigente). O Contribuições é um só, na matriz.
  const doGrupo = new Set((ok(await db.from('empresas').select('id').like('cnpj', `${raiz}%`).limit(500), 'estabelecimentos') as { id: string }[]).map((x) => x.id));
  doGrupo.add(e.id);
  const gerados = ok(await db.from('sped_gerados').select('id,empresa_id,tipo,versao,resumo,erros,alertas,gerado_em,gerado_por,auditado_arquivo_id')
    .in('empresa_id', [...doGrupo]).eq('competencia', comp).order('versao', { ascending: false }).limit(200), 'SPEDs gerados') as any[];
  const gFiscal = gerados.find((g) => g.tipo === 'efd_icms_ipi' && g.empresa_id === e.id) ?? null;
  const gContrib = gerados.find((g) => g.tipo === 'efd_contribuicoes' && doGrupo.has(g.empresa_id)) ?? null;
  const enviados = ok(await db.from('sped_arquivos').select('id,empresa_id,tipo,nome,resumo,enviado_em,enviado_por,erros')
    .in('empresa_id', [...doGrupo]).eq('competencia', comp).in('tipo', ['efd_icms_ipi', 'efd_contribuicoes'])
    .order('enviado_em', { ascending: false }).order('id', { ascending: false }).limit(100), 'SPEDs enviados') as any[];
  // O SPED enviado que é o próprio arquivo do Appura (auditado) não serve de comparação: aí os dois lados seriam iguais
  const auditados = new Set([gFiscal?.auditado_arquivo_id, gContrib?.auditado_arquivo_id].filter(Boolean));
  const eFiscal = enviados.find((x) => x.tipo === 'efd_icms_ipi' && x.empresa_id === e.id) ?? null;
  const eContrib = enviados.find((x) => x.tipo === 'efd_contribuicoes') ?? null;

  const icmsAppura = gFiscal?.resumo?.icms ?? null;
  const ap = eFiscal?.resumo?.apuracao ?? null;
  const icmsSped = ap ? { debitos: ap.debitos, creditos: ap.creditos, saldoCredorAnterior: ap.saldoCredorAnterior, aRecolher: ap.recolher, saldoCredorTransportar: ap.saldoCredorTransportar } : null;
  const contribSped = (x: any) => (x ? { debito: x.contribuicao, credito: x.creditos, aRecolher: x.recolher } : null);
  const fonteGerado = (g: any) => (g ? { id: g.id, versao: g.versao, geradoEm: g.gerado_em, geradoPor: g.gerado_por, erros: g.erros, alertas: g.alertas } : null);
  const fonteEnviado = (x: any) => (x ? { id: x.id, nome: x.nome, enviadoEm: x.enviado_em, enviadoPor: x.enviado_por, erros: x.erros, doAppura: auditados.has(x.id) } : null);

  const avisos: string[] = [];
  if (e.regime !== 'real' && e.regime !== 'presumido') avisos.push('Esta empresa não está no Lucro Real nem no Presumido: confira o regime no cadastro.');
  if (!gFiscal && !eFiscal) avisos.push('Nenhum SPED Fiscal do mês: gere na aba SPED ou envie o do ERP.');
  if (e.regime === 'presumido') avisos.push('Lucro Presumido: o PIS/COFINS é cumulativo (0,65% e 3% sobre a receita). O gerador do SPED Contribuições do Appura ainda é só do Lucro Real; aparece aqui o que estiver no SPED enviado.');
  if (gFiscal?.erros) avisos.push(`O SPED Fiscal gerado tem ${gFiscal.erros} pendência(s) que impedem a transmissão: os valores podem mudar quando forem resolvidas.`);

  return {
    competencia, regime: e.regime,
    icms: { appura: fonteGerado(gFiscal), sped: fonteEnviado(eFiscal), linhas: comparar(CAMPOS_ICMS, icmsAppura, icmsSped) },
    pis: { appura: fonteGerado(gContrib), sped: fonteEnviado(eContrib), linhas: comparar(CAMPOS_CONTRIB, gContrib?.resumo?.pis ?? null, contribSped(eContrib?.resumo?.apuracao?.pis)) },
    cofins: { linhas: comparar(CAMPOS_CONTRIB, gContrib?.resumo?.cofins ?? null, contribSped(eContrib?.resumo?.apuracao?.cofins)) },
    vencimentoPisCofins: vencimentoPisCofins(competencia),
    avisos,
  };
}
