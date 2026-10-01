/** Entrada dos geradores de SPED: estabelecimento, documentos do mês (do banco + campos do XML) e opções. */
import type { ExtraCTe, ExtraNFe } from './xml';

export interface ItemDoc {
  n_item: number; c_prod: string | null; ean: string | null; x_prod: string | null; ncm: string | null; cest: string | null; cfop: string | null;
  u_com: string | null; q_com: number | null; v_prod: number | null; v_desc: number | null; v_frete: number | null; v_seg: number | null; v_outro: number | null;
  orig: number | null; cst_icms: string | null; csosn: boolean; p_red_bc: number | null; v_bc_icms: number | null; p_icms: number | null; v_icms: number | null;
  v_fcp: number | null; v_bc_st: number | null; p_icms_st: number | null; v_icms_st: number | null; v_fcp_st: number | null; v_ipi: number | null;
  cst_pis: string | null; cst_cofins: string | null; cfop_escrit: string | null;
}

export interface DocFiscal {
  chave: string; modelo: string; serie: string | null; numero: string | null; situacao: string; completo: boolean;
  emitida_em: string; tp_nf: number | null; fin_nfe: number | null; emit_cnpj: string | null; dest_doc: string | null; toma_doc: string | null;
  uf_emit: string | null; cfop: string | null;
  valor: number | null; v_prod: number | null; v_desc: number | null; v_frete: number | null; v_seg: number | null; v_outro: number | null;
  itens: ItemDoc[];
  extraNfe?: ExtraNFe | null;
  extraCte?: ExtraCTe | null;
}

export interface Estabelecimento {
  id: string; cnpj: string; razao_social: string; uf: string; regime: string | null;
  ie: string | null; cod_municipio: string | null; nome_fantasia: string | null; cep: string | null; logradouro: string | null; numero: string | null;
  complemento: string | null; bairro: string | null; fone: string | null; email: string | null; perfil_sped: string | null;
  contador_nome: string | null; contador_crc: string | null; contador_cnpj: string | null; contador_email: string | null; contador_fone: string | null;
  docs: DocFiscal[];
}

export interface ResultadoGeracao {
  linhas: string[];
  pendencias: import('./escrita').Pendencia[];
  resumo: Record<string, unknown>;
}

/** Versão do leiaute da EFD ICMS/IPI pela data final do período. */
export function codVerIcms(dtFin: string): string | null {
  const ano = Number(dtFin.slice(0, 4));
  return ({ 2023: '017', 2024: '018', 2025: '019' } as Record<number, string>)[ano] ?? (ano >= 2026 ? '020' : null);
}
