'use strict';
/*
 * Barra de status do botão "Sincronizar": acompanha o pedido no coletor e mostra o que está acontecendo
 * (na fila, consultando a SEFAZ, documentos localizados, baixados, restantes) até terminar.
 * Usa os utilitários globais do app.js (h, chamar, icone, areaFlutuante, empresaNotas, recarregarAba).
 */

/* ---------- funções puras (testadas em test/sincronizacao-tela.test.ts) ---------- */

const SC_MODELO = { nfe: 'NF-e', cte: 'CT-e' };
const fmtN = (n) => Number(n || 0).toLocaleString('pt-BR');

/** Linha de um modelo (NF-e ou CT-e) a partir do progresso gravado pelo coletor. */
function scLinhaModelo(p) {
  const m = SC_MODELO[p.modelo] || p.modelo;
  const nums = [p.localizados ? `${fmtN(p.localizados)} localizado${p.localizados === 1 ? '' : 's'}` : '', p.baixados ? `${fmtN(p.baixados)} baixado${p.baixados === 1 ? '' : 's'}` : '',
    p.restantes ? `cerca de ${fmtN(p.restantes)} ainda na SEFAZ` : ''].filter(Boolean).join(' · ');
  switch (p.etapa) {
    case 'consultando': return `${m}: consultando a SEFAZ${p.chamadas > 1 ? ` (lote ${p.chamadas})` : ''}${nums ? ` · ${nums}` : ''}`;
    case 'processando': return `${m}: baixando e lendo os XMLs${nums ? ` · ${nums}` : ''}`;
    case 'lacunas': return `${m}: procurando documentos que ficaram para trás${nums ? ` · ${nums}` : ''}`;
    case 'aguardando': return `${m}: ${p.mensagem || 'a SEFAZ só libera nova consulta 1 hora depois da anterior'}`;
    case 'erro': return `${m}: erro na consulta${p.mensagem ? ` (${p.mensagem})` : ''}`;
    case 'concluido': return `${m}: concluído · ${p.baixados ? `${fmtN(p.baixados)} documento${p.baixados === 1 ? '' : 's'} novo${p.baixados === 1 ? '' : 's'}` : 'nenhum documento novo'}`;
    default: return m;
  }
}

/** O que mostrar para um pedido: título, linhas, porcentagem (quando dá para saber) e se terminou. */
function scEstado(pedido) {
  if (!pedido) return { titulo: 'Sincronização', linhas: ['Nenhum pedido encontrado.'], pct: null, fim: true, tom: 'neutro' };
  const modelos = Object.values((pedido.progresso && pedido.progresso.modelos) || {});
  if (pedido.status === 'pendente') return { titulo: 'Na fila', linhas: ['O coletor começa em alguns segundos…'], pct: null, fim: false, tom: 'info' };
  if (pedido.status === 'concluido' || pedido.status === 'erro') {
    return { titulo: pedido.status === 'erro' ? 'Sincronização com erro' : 'Sincronização concluída', linhas: [pedido.mensagem || '', ...modelos.map(scLinhaModelo)].filter(Boolean),
      pct: pedido.status === 'erro' ? null : 100, fim: true, tom: pedido.status === 'erro' ? 'problema' : 'ok' };
  }
  // Porcentagem só com os modelos em que a SEFAZ já disse quanto falta (o que está aguardando a 1 hora fica de fora)
  const conhecidos = modelos.filter((p) => p.restantes != null && p.etapa !== 'aguardando');
  const baixados = conhecidos.reduce((t, p) => t + (p.baixados || 0), 0);
  const restantes = conhecidos.reduce((t, p) => t + (p.restantes || 0), 0);
  const pct = conhecidos.length && baixados + restantes > 0 ? Math.min(99, Math.round((baixados / (baixados + restantes)) * 100)) : null;
  return { titulo: 'Sincronizando com a SEFAZ', linhas: modelos.length ? modelos.map(scLinhaModelo) : ['Abrindo o certificado e preparando a consulta…'], pct, fim: false, tom: 'info' };
}

if (typeof module !== 'undefined') module.exports = { scLinhaModelo, scEstado };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  const acompanhando = new Map();

  function scAcompanhar(empresa) {
    if (!empresa || acompanhando.has(empresa.id)) return;
    const barra = h('span'); barra.style.width = '0%';
    const titulo = h('strong'); const corpo = h('div', { class: 'sc-linhas' });
    const fechar = h('button', { type: 'button', class: 'botao fantasma pequeno', 'aria-label': 'Fechar', onclick: () => parar(true) }, icone('x'));
    const caixa = h('div', { class: 'imp-flutuante sc-flutuante', role: 'status' },
      h('div', { class: 'imp-flutuante-topo' }, h('div', { class: 'sc-titulo' }, titulo, h('span', { class: 'meta', text: empresa.razao_social })), fechar),
      h('div', { class: 'barra sc-barra' }, barra), corpo,
      h('a', { href: `#/empresas/${empresa.id}/notas`, class: 'imp-flutuante-link', text: 'Ver as notas' }));
    areaFlutuante().append(caixa);
    let timer = null; let falhas = 0;
    const parar = (remover) => { clearTimeout(timer); acompanhando.delete(empresa.id); if (remover) caixa.remove(); };
    const tique = async () => {
      let pedido;
      try { pedido = (await chamar(`/api/empresas/${empresa.id}/sincronizacao`)).pedido; falhas = 0; } catch { if (++falhas > 5) { parar(false); corpo.replaceChildren(h('span', { class: 'meta', text: 'Não foi possível acompanhar agora. O coletor continua trabalhando.' })); return; } }
      if (pedido) {
        const e = scEstado(pedido);
        titulo.textContent = e.titulo;
        corpo.replaceChildren(...e.linhas.map((l) => h('span', { class: 'meta', text: l })));
        barra.classList.toggle('indeterminada', e.pct == null && !e.fim);
        barra.style.width = e.pct == null ? (e.fim ? '0%' : '35%') : `${e.pct}%`;
        caixa.dataset.tom = e.tom;
        if (e.fim) {
          parar(false);
          // Documentos novos: a empresa aberta recarrega sozinha
          if (empresaNotas && empresaNotas.id === empresa.id && e.tom === 'ok') { window.e360Chave = null; recarregarAba(); }
          setTimeout(() => caixa.remove(), 60_000);
          return;
        }
      }
      timer = setTimeout(tique, 2000);
    };
    acompanhando.set(empresa.id, true);
    titulo.textContent = 'Na fila'; corpo.replaceChildren(h('span', { class: 'meta', text: 'O coletor começa em alguns segundos…' }));
    barra.classList.add('indeterminada'); barra.style.width = '35%';
    tique();
  }

  /** Ao abrir uma empresa com sincronização em andamento (pedida por qualquer pessoa), mostra a barra. */
  async function scVerificar(empresa) {
    try {
      const p = (await chamar(`/api/empresas/${empresa.id}/sincronizacao`)).pedido;
      if (p && (p.status === 'pendente' || p.status === 'processando')) scAcompanhar(empresa);
    } catch { /* sem barra */ }
  }

  window.scAcompanhar = scAcompanhar;
  window.scVerificar = scVerificar;
}
