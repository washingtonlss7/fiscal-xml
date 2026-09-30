/**
 * Uso do MCP para a administração: quem usou, quais ações executou e o que falhou.
 * Lê o registro de chamadas (mcp_chamadas). A prévia de uma ação conta como consulta; a execução
 * é a chamada com o código de confirmação ("confirmacao": "informada" no registro).
 */
import { Db, ok } from '../db';

export const FERRAMENTAS_ACAO = [
  'appura_justificar_divergencias', 'appura_reabrir_divergencias', 'appura_tratar_apontamentos',
  'appura_verificar_procuracao', 'appura_gerar_das', 'appura_enviar_guias_acessorias',
];

interface Chamada { id: number; em: string; email: string; client_id: string | null; ferramenta: string; argumentos: any; sucesso: boolean }

export const ehExecucao = (c: { ferramenta: string; argumentos: any }) => FERRAMENTAS_ACAO.includes(c.ferramenta) && !!c.argumentos && c.argumentos.confirmacao === 'informada';

/** Resumo curto dos argumentos para a tabela (sem o campo de confirmação). */
export function resumoArgumentos(a: any): string {
  if (!a || typeof a !== 'object') return '';
  const partes = Object.entries(a).filter(([k, v]) => k !== 'confirmacao' && v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`);
  const t = partes.join(' · ');
  return t.length > 180 ? `${t.slice(0, 177)}…` : t;
}

export async function usoMcp(db: Db, dias: number, agora = Date.now()) {
  const d = [7, 30, 90].includes(dias) ? dias : 7;
  const desde = new Date(agora - d * 86_400_000).toISOString();
  const l = ok(await db.from('mcp_chamadas').select('id,em,email,client_id,ferramenta,argumentos,sucesso').gte('em', desde).order('em', { ascending: false }).limit(20000), 'uso do MCP') as Chamada[];
  const ids = [...new Set(l.map((c) => c.client_id).filter(Boolean))] as string[];
  const apps = ids.length ? ok(await db.from('mcp_clientes').select('client_id,nome').in('client_id', ids), 'apps') as { client_id: string; nome: string }[] : [];
  const nomeApp = (id: string | null) => (id ? apps.find((a) => a.client_id === id)?.nome ?? 'App removido' : 'Token pessoal');

  const porUsuario = new Map<string, { email: string; chamadas: number; acoes: number; falhas: number; ultimoUso: string }>();
  const porFerramenta = new Map<string, { ferramenta: string; chamadas: number; falhas: number; acao: boolean }>();
  for (const c of l) {
    const u = porUsuario.get(c.email) ?? { email: c.email, chamadas: 0, acoes: 0, falhas: 0, ultimoUso: c.em };
    u.chamadas++; if (!c.sucesso) u.falhas++; if (ehExecucao(c) && c.sucesso) u.acoes++;
    porUsuario.set(c.email, u);
    const f = porFerramenta.get(c.ferramenta) ?? { ferramenta: c.ferramenta, chamadas: 0, falhas: 0, acao: FERRAMENTAS_ACAO.includes(c.ferramenta) };
    f.chamadas++; if (!c.sucesso) f.falhas++;
    porFerramenta.set(c.ferramenta, f);
  }
  const linha = (c: Chamada) => ({ id: c.id, em: c.em, email: c.email, app: nomeApp(c.client_id), ferramenta: c.ferramenta, resumo: resumoArgumentos(c.argumentos), sucesso: c.sucesso });
  return {
    dias: d,
    totais: { chamadas: l.length, acoesExecutadas: l.filter((c) => ehExecucao(c) && c.sucesso).length, falhas: l.filter((c) => !c.sucesso).length, usuarios: porUsuario.size },
    porUsuario: [...porUsuario.values()].sort((a, b) => b.chamadas - a.chamadas),
    porFerramenta: [...porFerramenta.values()].sort((a, b) => b.chamadas - a.chamadas),
    acoes: l.filter(ehExecucao).slice(0, 50).map(linha),
    falhas: l.filter((c) => !c.sucesso).slice(0, 20).map(linha),
    limitado: l.length >= 20000,
  };
}
