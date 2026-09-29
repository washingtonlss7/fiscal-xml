import {
  CFOP_ST, CFOP_VENDA_COMUM, CSOSN_COM_ST, CST_COM_ST, CST_PIS_MONOFASICO_REVENDA, cfopEntrada, monofasico,
} from './tabelas';

/* Regras da auditoria. Função pura: recebe as notas do mês e devolve apontamentos e sugestões por item. */

export type Severidade = 'erro' | 'alerta' | 'info';

export interface NotaAuditoria {
  chave: string;
  modelo: string;
  numero: string | null;
  serie: string | null;
  emitida_em: string | null;
  direcao: 'entrada' | 'saida';
  completo: boolean;
  situacao: string;
  emit_cnpj: string | null;
  emit_nome: string | null;
  dest_doc: string | null;
  crt_emit: number | null;
  uf_emit: string | null;
  uf_dest: string | null;
  v_prod: number | null;
  toma_doc: string | null;
  manifestacao_status: string | null;
  manifestacao_motivo: string | null;
  itens_extraidos: boolean;
}

export interface ItemAuditoria {
  chave: string;
  n_item: number;
  x_prod: string | null;
  ncm: string | null;
  cfop: string | null;
  cst_icms: string | null;
  csosn: boolean;
  v_prod: number | null;
  v_bc_icms: number | null;
  p_icms: number | null;
  v_icms: number | null;
  cst_pis: string | null;
  cst_cofins: string | null;
  cst_ibscbs: string | null;
}

export interface EmpresaAuditoria {
  cnpj: string;
  uf: string;
  regime: string | null;
}

export interface Apontamento {
  regra: string;
  severidade: Severidade;
  referencia: string;
  chave: string | null;
  n_item: number | null;
  mensagem: string;
  sugestao: { campo: string; valor: string } | null;
  quantidade: number;
}

export interface SugestaoItem {
  chave: string;
  n_item: number;
  cfop_escrit: string | null;
  cst_pis_escrit: string | null;
  cst_cofins_escrit: string | null;
  monofasico: boolean;
}

export interface ResultadoAuditoria {
  apontamentos: Apontamento[];
  sugestoes: SugestaoItem[];
  resumo: {
    notas: number;
    itens: number;
    comprasMonofasicas: number;
    comprasTotais: number;
    receitaMonofasica: number;
    receitaTotal: number;
  };
}

/** Descrição de cada regra, usada no painel. */
export const REGRAS: Record<string, { titulo: string; explicacao: string }> = {
  NOTA_CANCELADA: {
    titulo: 'Nota cancelada',
    explicacao: 'A nota foi cancelada pelo emitente. Não deve ser escriturada; se já foi, precisa ser estornada.',
  },
  SO_RESUMO: {
    titulo: 'XML completo indisponível',
    explicacao: 'Há mais de 3 dias a nota tem só o resumo. Sem o XML completo não há itens para escriturar nem auditar.',
  },
  SOMA_ITENS: {
    titulo: 'Soma dos itens diferente do total',
    explicacao: 'A soma do valor dos produtos dos itens não bate com o total de produtos da nota.',
  },
  CRT_CST: {
    titulo: 'Regime do emitente x CST/CSOSN',
    explicacao: 'Emitente do Simples (CRT 1) deve usar CSOSN; emitente do regime normal (CRT 3) deve usar CST.',
  },
  CFOP_ST_SEM_CST_ST: {
    titulo: 'CFOP de ST com CST sem ST',
    explicacao: 'O CFOP indica operação com substituição tributária, mas o CST/CSOSN não é de ST.',
  },
  CST_ST_EM_VENDA_COMUM: {
    titulo: 'CST de ST em venda comum',
    explicacao: 'O CST/CSOSN indica ST (retida ou já recolhida), mas o CFOP é de venda comum (x101 a x108).',
  },
  ICMS_CALCULO: {
    titulo: 'ICMS destacado diferente do cálculo',
    explicacao: 'Base de cálculo x alíquota não confere com o valor de ICMS destacado no item.',
  },
  MONO_RECEITA_TRIBUTADA: {
    titulo: 'Venda de produto monofásico tributada',
    explicacao:
      'Produto com PIS/COFINS monofásico vendido com CST de tributação normal. Na revenda a alíquota é zero (CST 04); no Simples, essa receita deve ser segregada no PGDAS-D para não pagar PIS/COFINS de novo.',
  },
  MONO_COMPRA_TRIBUTADA: {
    titulo: 'Compra de monofásico com PIS/COFINS tributado',
    explicacao:
      'O fornecedor informou CST 01 em produto da lista monofásica. Não muda a revenda (continua monofásica), mas vale confirmar o cadastro do produto com o fornecedor.',
  },
  CFOP_ENTRADA_INDEFINIDO: {
    titulo: 'CFOP de entrada a definir',
    explicacao: 'Não há conversão automática segura para o CFOP do fornecedor. Defina o CFOP de entrada da escrituração.',
  },
  INTERESTADUAL_REVENDA: {
    titulo: 'Compra interestadual para revenda',
    explicacao: 'Entrada de outra UF sem ST retida. Verifique antecipação parcial do ICMS ou DIFAL conforme a legislação do estado.',
  },
  NUMERACAO_FALTANTE: {
    titulo: 'Numeração de saída faltante',
    explicacao: 'Há números sem nota capturada na sequência da série. Pode ser nota não capturada ou numeração inutilizada.',
  },
  CTE_SEM_TOMADOR: {
    titulo: 'CT-e em que a empresa não é tomadora',
    explicacao: 'O frete foi contratado por outra parte (ex.: fornecedor, frete CIF). Não é frete próprio da empresa nem gera crédito.',
  },
  SEM_IBSCBS: {
    titulo: 'Nota sem destaque de IBS/CBS',
    explicacao: 'Nota de emitente do regime normal emitida em 2026 sem o grupo IBS/CBS preenchido.',
  },
};

const DIAS = 86_400_000;
const arred = (v: number) => Math.round(v * 100) / 100;
const ident = (n: NotaAuditoria) => `${n.modelo === '57' ? 'CT-e' : 'NF-e'} ${n.numero ?? '?'}${n.emit_nome ? ` de ${n.emit_nome}` : ''}`;

export function auditar(
  empresa: EmpresaAuditoria,
  notas: NotaAuditoria[],
  itens: ItemAuditoria[],
  agora = new Date(),
): ResultadoAuditoria {
  const ap: Apontamento[] = [];
  const sugestoes: SugestaoItem[] = [];
  const add = (a: Omit<Apontamento, 'quantidade' | 'sugestao' | 'n_item'> & Partial<Apontamento>) =>
    ap.push({ quantidade: 1, sugestao: null, n_item: null, ...a });
  const itensPorChave = new Map<string, ItemAuditoria[]>();
  for (const i of itens) {
    const l = itensPorChave.get(i.chave) ?? [];
    l.push(i);
    itensPorChave.set(i.chave, l);
  }
  const resumo = { notas: notas.length, itens: itens.length, comprasMonofasicas: 0, comprasTotais: 0, receitaMonofasica: 0, receitaTotal: 0 };

  let cteSemTomador = 0;
  let semIbsCbs = 0;

  for (const n of notas) {
    const doc = ident(n);

    if (n.situacao === 'cancelada') {
      add({ regra: 'NOTA_CANCELADA', severidade: 'alerta', referencia: n.chave, chave: n.chave, mensagem: `${doc} cancelada.` });
      continue; // nota cancelada não passa pelas demais regras
    }

    if (!n.completo) {
      const dias = n.emitida_em ? (agora.getTime() - new Date(n.emitida_em).getTime()) / DIAS : 0;
      if (dias > 3) {
        const rejeitada = n.manifestacao_status === 'rejeitada';
        add({
          regra: 'SO_RESUMO', severidade: rejeitada ? 'erro' : 'alerta', referencia: n.chave, chave: n.chave,
          mensagem: `${doc}: só resumo há ${Math.floor(dias)} dias${rejeitada ? ` (ciência rejeitada: ${n.manifestacao_motivo ?? ''})` : n.manifestacao_status === 'ciencia' ? ' (ciência já registrada)' : ''}.`,
        });
      }
      continue;
    }

    if (n.modelo === '57') {
      if (n.toma_doc && n.toma_doc !== empresa.cnpj) cteSemTomador++;
      continue;
    }

    const its = itensPorChave.get(n.chave) ?? [];
    if (!n.itens_extraidos || !its.length) continue;

    // Soma dos itens x total da nota
    const soma = arred(its.reduce((t, i) => t + (i.v_prod ?? 0), 0));
    if (n.v_prod !== null && Math.abs(soma - n.v_prod) > 0.05) {
      add({
        regra: 'SOMA_ITENS', severidade: 'erro', referencia: n.chave, chave: n.chave,
        mensagem: `${doc}: itens somam ${soma.toFixed(2)}, total de produtos ${n.v_prod.toFixed(2)}.`,
      });
    }

    // IBS/CBS em 2026 (emitente regime normal)
    if (n.crt_emit === 3 && n.emitida_em && n.emitida_em >= '2026-01-01' && its.every((i) => !i.cst_ibscbs)) semIbsCbs++;

    // Interestadual para revenda sem ST
    if (n.direcao === 'entrada' && n.uf_emit && n.uf_emit !== empresa.uf) {
      const revendaSemSt = its.some((i) => i.cfop && CFOP_VENDA_COMUM.has(i.cfop) && !(i.csosn ? CSOSN_COM_ST : CST_COM_ST).has(i.cst_icms ?? ''));
      if (revendaSemSt) {
        add({
          regra: 'INTERESTADUAL_REVENDA', severidade: 'info', referencia: n.chave, chave: n.chave,
          mensagem: `${doc} (${n.uf_emit} → ${empresa.uf}): compra para revenda sem ST retida.`,
        });
      }
    }

    for (const i of its) {
      const ref = `${n.chave}:${i.n_item}`;
      const item = `${doc}, item ${i.n_item}${i.x_prod ? ` (${i.x_prod.slice(0, 40)})` : ''}`;
      const comSt = (i.csosn ? CSOSN_COM_ST : CST_COM_ST).has(i.cst_icms ?? '');

      // Regime do emitente x CST/CSOSN
      if (n.crt_emit === 1 && !i.csosn && i.cst_icms) {
        add({ regra: 'CRT_CST', severidade: 'alerta', referencia: ref, chave: n.chave, n_item: i.n_item, mensagem: `${item}: emitente do Simples com CST ${i.cst_icms}.` });
      } else if (n.crt_emit === 3 && i.csosn) {
        add({ regra: 'CRT_CST', severidade: 'alerta', referencia: ref, chave: n.chave, n_item: i.n_item, mensagem: `${item}: emitente do regime normal com CSOSN ${i.cst_icms}.` });
      }

      // CFOP x ST
      if (i.cfop && CFOP_ST.has(i.cfop) && i.cst_icms && !comSt) {
        add({ regra: 'CFOP_ST_SEM_CST_ST', severidade: 'alerta', referencia: ref, chave: n.chave, n_item: i.n_item, mensagem: `${item}: CFOP ${i.cfop} com ${i.csosn ? 'CSOSN' : 'CST'} ${i.cst_icms}.` });
      }
      if (i.cfop && CFOP_VENDA_COMUM.has(i.cfop) && comSt) {
        add({ regra: 'CST_ST_EM_VENDA_COMUM', severidade: 'alerta', referencia: ref, chave: n.chave, n_item: i.n_item, mensagem: `${item}: CFOP ${i.cfop} com ${i.csosn ? 'CSOSN' : 'CST'} ${i.cst_icms}.` });
      }

      // Cálculo do ICMS próprio
      if ((i.v_bc_icms ?? 0) > 0 && (i.p_icms ?? 0) > 0 && i.v_icms !== null) {
        const esperado = arred((i.v_bc_icms! * i.p_icms!) / 100);
        if (Math.abs(esperado - i.v_icms) > 0.05) {
          add({
            regra: 'ICMS_CALCULO', severidade: 'alerta', referencia: ref, chave: n.chave, n_item: i.n_item,
            mensagem: `${item}: BC ${i.v_bc_icms!.toFixed(2)} × ${i.p_icms}% = ${esperado.toFixed(2)}, destacado ${i.v_icms.toFixed(2)}.`,
          });
        }
      }

      // Monofásico
      const mono = monofasico(i.ncm);
      const valor = i.v_prod ?? 0;
      if (n.direcao === 'entrada') {
        resumo.comprasTotais += valor;
        if (mono) resumo.comprasMonofasicas += valor;
        if (mono && i.cst_pis === '01') {
          add({
            regra: 'MONO_COMPRA_TRIBUTADA', severidade: 'info', referencia: ref, chave: n.chave, n_item: i.n_item,
            mensagem: `${item}: NCM ${i.ncm} (${mono.grupo}) com CST PIS 01.`,
          });
        }
      } else {
        resumo.receitaTotal += valor;
        if (mono) resumo.receitaMonofasica += valor;
        if (mono && i.cst_pis && !CST_PIS_MONOFASICO_REVENDA.has(i.cst_pis)) {
          add({
            regra: 'MONO_RECEITA_TRIBUTADA', severidade: 'alerta', referencia: ref, chave: n.chave, n_item: i.n_item,
            mensagem: `${item}: NCM ${i.ncm} (${mono.grupo}, ${mono.base}) vendido com CST PIS ${i.cst_pis}.`,
            sugestao: { campo: 'cst_pis_cofins_escrit', valor: '04' },
          });
        }
      }

      // Valores para escrituração
      const cfopEsc = n.direcao === 'entrada' ? cfopEntrada(i.cfop) : i.cfop;
      if (n.direcao === 'entrada' && i.cfop && !cfopEsc) {
        add({
          regra: 'CFOP_ENTRADA_INDEFINIDO', severidade: 'alerta', referencia: ref, chave: n.chave, n_item: i.n_item,
          mensagem: `${item}: CFOP do fornecedor ${i.cfop} sem conversão automática.`,
        });
      }
      let cstPisEsc: string | null = null;
      if (mono && n.direcao === 'saida') cstPisEsc = '04';
      else if (mono && n.direcao === 'entrada' && empresa.regime === 'real') cstPisEsc = '70'; // aquisição sem direito a crédito
      sugestoes.push({
        chave: n.chave, n_item: i.n_item, cfop_escrit: cfopEsc, cst_pis_escrit: cstPisEsc, cst_cofins_escrit: cstPisEsc, monofasico: !!mono,
      });
    }
  }

  // Numeração faltante nas saídas do próprio CNPJ (NF-e), por série
  const porSerie = new Map<string, number[]>();
  for (const n of notas) {
    if (n.modelo !== '55' || n.emit_cnpj !== empresa.cnpj || !n.numero) continue;
    const s = n.serie ?? '0';
    const l = porSerie.get(s) ?? [];
    l.push(Number(n.numero));
    porSerie.set(s, l);
  }
  for (const [serie, numeros] of porSerie) {
    const ord = [...new Set(numeros)].filter(Number.isFinite).sort((a, b) => a - b);
    for (let k = 1; k < ord.length; k++) {
      if (ord[k] - ord[k - 1] > 1) {
        const de = ord[k - 1] + 1;
        const ate = ord[k] - 1;
        add({
          regra: 'NUMERACAO_FALTANTE', severidade: 'alerta', referencia: `serie:${serie}:${de}-${ate}`, chave: null,
          mensagem: `Série ${serie}: ${de === ate ? `número ${de}` : `números ${de} a ${ate}`} sem nota capturada.`,
          quantidade: ate - de + 1,
        });
      }
    }
  }

  if (cteSemTomador) {
    add({
      regra: 'CTE_SEM_TOMADOR', severidade: 'info', referencia: 'mes', chave: null, quantidade: cteSemTomador,
      mensagem: `${cteSemTomador} CT-e em que a empresa é só destinatária (frete contratado por outra parte).`,
    });
  }
  if (semIbsCbs) {
    add({
      regra: 'SEM_IBSCBS', severidade: 'info', referencia: 'mes', chave: null, quantidade: semIbsCbs,
      mensagem: `${semIbsCbs} nota(s) de emitente do regime normal sem destaque de IBS/CBS.`,
    });
  }

  resumo.comprasMonofasicas = arred(resumo.comprasMonofasicas);
  resumo.comprasTotais = arred(resumo.comprasTotais);
  resumo.receitaMonofasica = arred(resumo.receitaMonofasica);
  resumo.receitaTotal = arred(resumo.receitaTotal);
  return { apontamentos: ap, sugestoes, resumo };
}
