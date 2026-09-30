import type { Efd } from './efd';
import type { EfdContrib } from './contribuicoes';
import municipios from './municipios.json';

/**
 * Pré-cadastro pelo SPED: dados do contribuinte (0000 e 0005) e do contador (0100).
 * O Appura só sugere; quem grava no cadastro é o escritório, ao conferir e aprovar.
 */

export type CampoCadastro =
  | 'razao_social' | 'nome_fantasia' | 'ie' | 'cod_municipio' | 'logradouro' | 'numero' | 'complemento' | 'bairro' | 'cep'
  | 'fone' | 'email' | 'perfil_sped' | 'contador_nome' | 'contador_crc' | 'contador_cnpj' | 'contador_email' | 'contador_fone';

export const CAMPOS_CADASTRO: { campo: CampoCadastro; rotulo: string; grupo: 'empresa' | 'endereco' | 'contador' }[] = [
  { campo: 'razao_social', rotulo: 'Razão social', grupo: 'empresa' },
  { campo: 'nome_fantasia', rotulo: 'Nome fantasia', grupo: 'empresa' },
  { campo: 'ie', rotulo: 'Inscrição estadual', grupo: 'empresa' },
  { campo: 'perfil_sped', rotulo: 'Perfil do SPED', grupo: 'empresa' },
  { campo: 'fone', rotulo: 'Telefone', grupo: 'empresa' },
  { campo: 'email', rotulo: 'E-mail', grupo: 'empresa' },
  { campo: 'cod_municipio', rotulo: 'Município', grupo: 'endereco' },
  { campo: 'logradouro', rotulo: 'Logradouro', grupo: 'endereco' },
  { campo: 'numero', rotulo: 'Número', grupo: 'endereco' },
  { campo: 'complemento', rotulo: 'Complemento', grupo: 'endereco' },
  { campo: 'bairro', rotulo: 'Bairro', grupo: 'endereco' },
  { campo: 'cep', rotulo: 'CEP', grupo: 'endereco' },
  { campo: 'contador_nome', rotulo: 'Contador', grupo: 'contador' },
  { campo: 'contador_crc', rotulo: 'CRC', grupo: 'contador' },
  { campo: 'contador_cnpj', rotulo: 'CNPJ do escritório contábil', grupo: 'contador' },
  { campo: 'contador_email', rotulo: 'E-mail do contador', grupo: 'contador' },
  { campo: 'contador_fone', rotulo: 'Telefone do contador', grupo: 'contador' },
];
const NOMES_CAMPOS = new Set<string>(CAMPOS_CADASTRO.map((c) => c.campo));
export const campoValido = (c: string): c is CampoCadastro => NOMES_CAMPOS.has(c);

/** Dados propostos: campos do cadastro + identificação (cnpj, uf e nome do município). */
export type DadosCadastro = Partial<Record<CampoCadastro, string>> & { cnpj: string; uf: string; municipio?: string };

export function nomeMunicipio(cod: string | null | undefined): string | null {
  return (cod && (municipios as Record<string, string>)[cod]) || null;
}

const espacos = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/** Lê do SPED os dados de cadastro, já limpos. Campos vazios ficam de fora. */
export function dadosDoSped(efd: Efd): DadosCadastro | null {
  const cab = efd.cabecalho;
  if (!cab) return null;
  const c = efd.complemento;
  const k = efd.contador;
  const d: DadosCadastro = { cnpj: cab.cnpj || cab.cpf, uf: cab.uf };
  const por = (campo: CampoCadastro, v: string) => { if (v) d[campo] = v; };
  por('razao_social', espacos(cab.nome));
  por('ie', espacos(cab.ie).toUpperCase());
  por('perfil_sped', espacos(cab.perfil).toUpperCase());
  if (/^\d{7}$/.test(cab.codMun)) {
    d.cod_municipio = cab.codMun;
    const nome = nomeMunicipio(cab.codMun);
    if (nome) d.municipio = nome;
  }
  if (c) {
    por('nome_fantasia', espacos(c.fantasia));
    por('logradouro', espacos(c.endereco));
    por('numero', espacos(c.numero));
    por('complemento', espacos(c.complemento));
    por('bairro', espacos(c.bairro));
    por('cep', digitos(c.cep).length === 8 ? digitos(c.cep) : '');
    por('fone', digitos(c.fone));
    por('email', espacos(c.email).toLowerCase());
  }
  if (k) {
    por('contador_nome', espacos(k.nome));
    por('contador_crc', espacos(k.crc).toUpperCase());
    por('contador_cnpj', digitos(k.cnpj).length === 14 ? digitos(k.cnpj) : '');
    por('contador_email', espacos(k.email).toLowerCase());
    por('contador_fone', digitos(k.fone));
  }
  return d;
}

/** Dados de cadastro do SPED Contribuições: 0000 (nome, município), 0140 (IE do estabelecimento) e 0100 (contador). */
export function dadosDoContribuicoes(efd: EfdContrib): DadosCadastro | null {
  const cab = efd.cabecalho;
  if (!cab) return null;
  const d: DadosCadastro = { cnpj: cab.cnpj, uf: cab.uf };
  const por = (campo: CampoCadastro, v: string) => { if (v) d[campo] = v; };
  por('razao_social', espacos(cab.nome));
  const est = efd.estabelecimentos.find((e) => e.cnpj === cab.cnpj);
  if (est) por('ie', espacos(est.ie).toUpperCase());
  if (/^\d{7}$/.test(cab.codMun)) {
    d.cod_municipio = cab.codMun;
    const nome = nomeMunicipio(cab.codMun);
    if (nome) d.municipio = nome;
  }
  const k = efd.contador;
  if (k) {
    por('contador_nome', espacos(k.nome));
    por('contador_crc', espacos(k.crc).toUpperCase());
    por('contador_cnpj', digitos(k.cnpj).length === 14 ? digitos(k.cnpj) : '');
    por('contador_email', espacos(k.email).toLowerCase());
    por('contador_fone', digitos(k.fone));
  }
  return d;
}

/** Chave de comparação: ignora maiúsculas, acentos, pontuação e espaços ("LTDA." = "Ltda"). */
export function chaveComparacao(v: string | null | undefined): string {
  return (v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9@]/g, '');
}

export interface Diferenca {
  campo: CampoCadastro;
  rotulo: string;
  grupo: string;
  atual: string | null;
  proposto: string;
}

/** Campos em que o SPED traz um valor e o cadastro está vazio ou diferente. */
export function diferencasCadastro(atual: Partial<Record<string, string | null>>, proposto: DadosCadastro): Diferenca[] {
  const lista: Diferenca[] = [];
  for (const { campo, rotulo, grupo } of CAMPOS_CADASTRO) {
    const p = proposto[campo];
    if (!p) continue;
    const a = atual[campo] ?? null;
    if (chaveComparacao(a) === chaveComparacao(p)) continue;
    lista.push({ campo, rotulo, grupo, atual: a || null, proposto: p });
  }
  return lista;
}

/**
 * Monta a alteração do cadastro com os campos aprovados. O nome do município acompanha o código IBGE.
 * `campos` vazio = nada a gravar.
 */
export function alteracaoAprovada(proposto: DadosCadastro, campos: string[]): Record<string, string> {
  const alt: Record<string, string> = {};
  for (const c of campos) {
    if (!campoValido(c)) continue;
    const v = proposto[c];
    if (!v) continue;
    alt[c] = v;
    if (c === 'cod_municipio') {
      const nome = proposto.municipio || nomeMunicipio(v);
      if (nome) alt.municipio = nome;
    }
  }
  return alt;
}
