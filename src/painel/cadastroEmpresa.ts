/**
 * Edição do cadastro da empresa pelo painel.
 * - CNPJ, razão social e UF não mudam aqui (vêm do certificado).
 * - Trocar o regime pede confirmação (muda o que o Appura calcula: apuração do Simples, SPED Contribuições, guias).
 * - Cada alteração fica em empresa_alteracoes (campo, antes, depois, quem, quando) e aparece no Histórico da empresa.
 */
import { Db, ok } from '../db';
import { log } from '../log';

export class ErroCadastro extends Error {
  constructor(public readonly status: number, msg: string, public readonly codigo?: string) { super(msg); }
}

type Tipo = 'texto' | 'regime' | 'ie' | 'cep' | 'ibge' | 'fone' | 'email' | 'bool';
interface Campo { rotulo: string; tipo: Tipo; max?: number }

/** Campos editáveis, na ordem do formulário. */
export const CAMPOS: Record<string, Campo> = {
  regime: { rotulo: 'Regime tributário', tipo: 'regime' },
  codigo_erp: { rotulo: 'Código ERP', tipo: 'texto', max: 30 },
  nome_fantasia: { rotulo: 'Nome fantasia', tipo: 'texto', max: 120 },
  ie: { rotulo: 'Inscrição estadual', tipo: 'ie' },
  im: { rotulo: 'Inscrição municipal', tipo: 'texto', max: 20 },
  logradouro: { rotulo: 'Logradouro', tipo: 'texto', max: 120 },
  numero: { rotulo: 'Número', tipo: 'texto', max: 10 },
  complemento: { rotulo: 'Complemento', tipo: 'texto', max: 60 },
  bairro: { rotulo: 'Bairro', tipo: 'texto', max: 60 },
  cep: { rotulo: 'CEP', tipo: 'cep' },
  municipio: { rotulo: 'Município', tipo: 'texto', max: 60 },
  cod_municipio: { rotulo: 'Código IBGE do município', tipo: 'ibge' },
  fone: { rotulo: 'Telefone', tipo: 'fone' },
  email: { rotulo: 'E-mail', tipo: 'email' },
  contador_nome: { rotulo: 'Contador', tipo: 'texto', max: 120 },
  contador_crc: { rotulo: 'CRC do contador', tipo: 'texto', max: 20 },
  contador_email: { rotulo: 'E-mail do contador', tipo: 'email' },
  contador_fone: { rotulo: 'Telefone do contador', tipo: 'fone' },
  captar_nfe: { rotulo: 'Captar NF-e', tipo: 'bool' },
  captar_cte: { rotulo: 'Captar CT-e', tipo: 'bool' },
};
export const REGIMES: Record<string, string> = { simples: 'Simples Nacional', mei: 'MEI', presumido: 'Lucro Presumido', real: 'Lucro Real' };
const COLUNAS = ['id', 'cnpj', 'razao_social', 'uf', ...Object.keys(CAMPOS)].join(',');

/** Normaliza e valida um valor; texto vazio vira null. */
export function normalizar(campo: string, v: unknown): string | boolean | null {
  const c = CAMPOS[campo];
  if (!c) throw new ErroCadastro(400, `Campo desconhecido: ${campo}.`);
  if (c.tipo === 'bool') {
    if (typeof v !== 'boolean') throw new ErroCadastro(400, `${c.rotulo}: valor inválido.`);
    return v;
  }
  const s = v == null ? '' : String(v).trim().replace(/\s+/g, ' ');
  if (!s) {
    if (c.tipo === 'regime') throw new ErroCadastro(422, 'Escolha o regime tributário.');
    return null;
  }
  switch (c.tipo) {
    case 'regime':
      if (!REGIMES[s]) throw new ErroCadastro(422, 'Regime inválido.');
      return s;
    case 'ie': {
      if (/^isento$/i.test(s)) return 'ISENTO';
      const d = s.replace(/\D/g, '');
      if (d.length < 2 || d.length > 14 || /[^\d.\-/ ]/.test(s)) throw new ErroCadastro(422, 'Inscrição estadual: use só números (ou ISENTO).');
      return d;
    }
    case 'cep': {
      const d = s.replace(/\D/g, '');
      if (d.length !== 8) throw new ErroCadastro(422, 'CEP deve ter 8 dígitos.');
      return d;
    }
    case 'ibge': {
      const d = s.replace(/\D/g, '');
      if (d.length !== 7) throw new ErroCadastro(422, 'Código IBGE do município deve ter 7 dígitos.');
      return d;
    }
    case 'fone': {
      const d = s.replace(/\D/g, '');
      if (d.length < 10 || d.length > 11) throw new ErroCadastro(422, `${c.rotulo}: informe DDD e número (10 ou 11 dígitos).`);
      return d;
    }
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 150) throw new ErroCadastro(422, `${c.rotulo} inválido.`);
      return s.toLowerCase();
    default:
      if (c.max && s.length > c.max) throw new ErroCadastro(422, `${c.rotulo}: no máximo ${c.max} caracteres.`);
      return s;
  }
}

export interface Alteracao { campo: string; rotulo: string; antes: string | boolean | null; depois: string | boolean | null }

/** Diferenças entre o cadastro atual e o enviado (só campos editáveis presentes no envio). */
export function diferencas(atual: Record<string, any>, novos: Record<string, unknown>): Alteracao[] {
  const saida: Alteracao[] = [];
  for (const campo of Object.keys(CAMPOS)) {
    if (!(campo in novos)) continue;
    const depois = normalizar(campo, novos[campo]);
    const antes = atual[campo] ?? null;
    if ((antes ?? null) === (depois ?? null)) continue;
    saida.push({ campo, rotulo: CAMPOS[campo].rotulo, antes, depois });
  }
  return saida;
}

export async function lerCadastro(db: Db, empresaId: string) {
  const e = ok(await db.from('empresas').select(COLUNAS).eq('id', empresaId).maybeSingle(), 'ler cadastro') as Record<string, any> | null;
  if (!e) throw new ErroCadastro(404, 'Empresa não encontrada.');
  return e;
}

/** Grava as alterações. Troca de regime só com `confirmarRegime: true`. */
export async function editarCadastro(db: Db, empresaId: string, corpo: Record<string, unknown>, email: string) {
  const atual = await lerCadastro(db, empresaId);
  const novos = (corpo.campos && typeof corpo.campos === 'object' ? corpo.campos : {}) as Record<string, unknown>;
  for (const k of Object.keys(novos)) if (!CAMPOS[k]) throw new ErroCadastro(400, `O campo "${k}" não pode ser alterado aqui.`);
  const alt = diferencas(atual, novos);
  if (!alt.length) return { alteracoes: [], cadastro: atual };
  const regime = alt.find((a) => a.campo === 'regime');
  if (regime && corpo.confirmarRegime !== true) {
    throw new ErroCadastro(409, `Trocar o regime de ${REGIMES[String(regime.antes)] ?? 'não informado'} para ${REGIMES[String(regime.depois)]} muda o que o Appura calcula para esta empresa: apuração do Simples, SPED Contribuições, guias e as regras da auditoria. Confirme para salvar.`, 'CONFIRMAR_REGIME');
  }
  const captar = { nfe: novos.captar_nfe ?? atual.captar_nfe, cte: novos.captar_cte ?? atual.captar_cte };
  if (captar.nfe === false && captar.cte === false) throw new ErroCadastro(422, 'Deixe ao menos NF-e ou CT-e para captar. Para parar tudo, pause a empresa.');
  const agora = new Date().toISOString();
  const update: Record<string, unknown> = Object.fromEntries(alt.map((a) => [a.campo, a.depois]));
  ok(await db.from('empresas').update({ ...update, cadastro_atualizado_em: agora, cadastro_atualizado_por: email }).eq('id', empresaId), 'gravar cadastro');
  ok(await db.from('empresa_alteracoes').insert({ empresa_id: empresaId, campos: alt, por: email, em: agora }), 'registrar alteração');
  log.info('cadastro da empresa editado', { empresa: empresaId, cnpj: atual.cnpj, campos: alt.map((a) => a.campo), por: email });
  return { alteracoes: alt, cadastro: await lerCadastro(db, empresaId) };
}
