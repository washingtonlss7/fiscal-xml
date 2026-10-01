'use strict';
/*
 * Aba Apuração para Lucro Real e Presumido: ICMS e PIS/COFINS do mês, lado a lado,
 * "Appura" (o que o gerador de SPED apurou dos XMLs) × "SPED do mês" (o arquivo enviado, normalmente o do ERP).
 * Usa os utilitários globais do app.js (h, $, chamar, icone, empresaNotas, mesSelecionado, trocarAba)
 * e do nucleo.js (moeda, formatarData, formatarHora, textoCompetencia).
 */

/* ---------- funções puras (testadas em test/apuracao-real-tela.test.ts) ---------- */

/** Tom da diferença: até R$ 0,05 é arredondamento. */
function arTom(dif) {
  if (dif == null) return 'neutro';
  return Math.abs(dif) <= 0.05 ? 'ok' : 'problema';
}

/** Resumo da comparação de um imposto: quantas linhas batem, quantas diferem e se falta um lado. */
function arSituacao(linhas) {
  const ambos = linhas.filter((l) => l.appura != null && l.sped != null);
  if (!linhas.some((l) => l.appura != null) && !linhas.some((l) => l.sped != null)) return { tom: 'neutro', texto: 'Sem dados' };
  if (!linhas.some((l) => l.appura != null)) return { tom: 'neutro', texto: 'Só o SPED enviado' };
  if (!linhas.some((l) => l.sped != null)) return { tom: 'neutro', texto: 'Só o gerado pelo Appura' };
  const dif = ambos.filter((l) => arTom(l.diferenca) === 'problema').length;
  return dif ? { tom: 'problema', texto: `${dif} diferença${dif === 1 ? '' : 's'}` } : { tom: 'ok', texto: 'Batem' };
}

/** Dia (AAAA-MM-DD) → DD/MM/AAAA, sem fuso. */
function arDia(d) { return d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—'; }

if (typeof module !== 'undefined') module.exports = { arTom, arSituacao, arDia };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  let arChave = null;

  async function arCarregar(alvo) {
    const id = empresaNotas.id; const mes = mesSelecionado(); const chave = `${id}|${mes}`;
    if (arChave !== chave) { arChave = chave; alvo.replaceChildren(h('section', { class: 'vg-card' }, h('div', { class: 'vg-skel', 'aria-hidden': 'true' }), h('div', { class: 'vg-skel', 'aria-hidden': 'true' }))); }
    let d;
    try { d = await chamar(`/api/empresas/${id}/apuracao-real?mes=${mes}`); } catch (e) {
      if (arChave !== chave) return;
      alvo.replaceChildren(h('div', { class: 'vg-erro', role: 'alert' }, h('strong', { text: 'Não foi possível montar a apuração.' }), h('span', { text: e.message })));
      return;
    }
    if (arChave !== chave) return;
    const quando = (iso) => `${formatarData(iso)} às ${formatarHora(iso)}`;
    const fontes = (x) => h('ul', { class: 'ar-fontes' },
      h('li', {}, h('strong', { text: 'Appura: ' }), x.appura ? `SPED gerado, versão ${x.appura.versao}, ${quando(x.appura.geradoEm)}${x.appura.erros ? ` · ${x.appura.erros} pendência${x.appura.erros === 1 ? '' : 's'} que impede${x.appura.erros === 1 ? '' : 'm'} a transmissão` : ''}` : 'ainda não gerado neste mês'),
      h('li', {}, h('strong', { text: 'SPED do mês: ' }), x.sped ? `${x.sped.nome}, enviado ${quando(x.sped.enviadoEm)} por ${x.sped.enviadoPor}${x.sped.doAppura ? ' (é o próprio arquivo do Appura)' : ''}` : 'nenhum arquivo enviado'));
    const tabela = (linhas) => h('div', { class: 'rolagem' }, h('table', { class: 'notas ar-tabela' },
      h('thead', {}, h('tr', {}, h('th', { text: '' }), h('th', { class: 'num', text: 'Appura' }), h('th', { class: 'num', text: 'SPED do mês' }), h('th', { class: 'num', text: 'Diferença' }))),
      h('tbody', {}, ...linhas.map((l) => h('tr', { class: l.campo === 'aRecolher' ? 'ar-destaque' : '' },
        h('td', { text: l.rotulo }), h('td', { class: 'num', text: l.appura == null ? '—' : moeda(l.appura) }), h('td', { class: 'num', text: l.sped == null ? '—' : moeda(l.sped) }),
        h('td', { class: 'num' }, l.diferenca == null ? '—' : h('span', { class: `selo ${arTom(l.diferenca)}`, text: arTom(l.diferenca) === 'ok' ? 'Bate' : moeda(l.diferenca) })))))));
    const cartao = (titulo, sub, linhas, extra) => {
      const s = arSituacao(linhas);
      return h('section', { class: 'vg-card ar-card' },
        h('div', { class: 'vg-card-topo' }, h('div', {}, h('h2', { class: 'vg-card-titulo', text: titulo }), sub ? h('p', { class: 'meta', text: sub }) : null), h('span', { class: `selo ${s.tom}`, text: s.texto })),
        tabela(linhas), extra || null);
    };
    const semGerado = !d.icms.appura;
    alvo.replaceChildren(
      h('section', { class: 'vg-card' },
        h('div', { class: 'vg-card-topo' }, h('div', {},
          h('h2', { class: 'vg-card-titulo', text: `Apuração de ${textoCompetencia(d.competencia)} · ${d.regime === 'presumido' ? 'Lucro Presumido' : 'Lucro Real'}` }),
          h('p', { class: 'meta', text: 'ICMS e PIS/COFINS do mês. "Appura" é o que o gerador de SPED apurou a partir dos XMLs e do SPED do mês anterior; "SPED do mês" é o arquivo enviado na aba SPED (normalmente o do ERP). A diferença aponta o que conferir antes de transmitir.' })),
          h('button', { type: 'button', class: `botao ${semGerado ? 'primario' : ''} pequeno`, onclick: () => trocarAba('sped') }, icone('file-spreadsheet'), h('span', { text: semGerado ? 'Gerar SPED' : 'Ver SPED' }))),
        d.avisos.length ? h('ul', { class: 'ap-alertas' }, ...d.avisos.map((a) => h('li', {}, h('span', { class: 'selo atencao', text: 'Atenção' }), h('div', {}, h('span', { text: a }))))) : null,
        h('p', { class: 'meta', text: 'IRPJ e CSLL ainda não: no Lucro Real dependem do resultado contábil (em breve, com a integração com o sistema contábil).' })),
      cartao('ICMS', 'Registro E110 do SPED Fiscal.', d.icms.linhas, fontes(d.icms)),
      cartao('PIS', `Registro M200 do SPED Contribuições · vence em ${arDia(d.vencimentoPisCofins)} (DARF 6912 no não cumulativo).`, d.pis.linhas, fontes(d.pis)),
      cartao('COFINS', `Registro M600 do SPED Contribuições · vence em ${arDia(d.vencimentoPisCofins)} (DARF 5856 no não cumulativo).`, d.cofins.linhas, null));
  }

  window.arCarregar = arCarregar;
}
