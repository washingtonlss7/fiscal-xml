'use strict';
/*
 * "Editar cadastro" da empresa (card Dados da empresa, na Visão Geral da Empresa 360°).
 * Gaveta com regime, código ERP, IE, IM, nome fantasia, endereço, contato, contador e captação.
 * CNPJ, razão social e UF ficam fixos (vêm do certificado). Troca de regime pede confirmação.
 * Cada alteração vai para o Histórico da empresa. Só para quem tem a permissão de cadastrar empresas.
 * Usa os utilitários globais do app.js (h, $, chamar, icone, avisar, pode) e do nucleo.js (formatarCnpj).
 */

/* ---------- funções puras (testadas em test/cadastro-tela.test.ts) ---------- */

const CD_SECOES = [
  ['Fiscal', ['regime', 'codigo_erp', 'nome_fantasia', 'ie', 'im']],
  ['Endereço', ['logradouro', 'numero', 'complemento', 'bairro', 'cep', 'municipio', 'cod_municipio']],
  ['Contato', ['fone', 'email']],
  ['Contador (SPED)', ['contador_nome', 'contador_crc', 'contador_email', 'contador_fone']],
];

/** Valor do campo para o formulário (CEP e telefone com máscara). */
function cdParaTela(campo, v) {
  if (v == null) return '';
  const d = String(v);
  if (campo === 'cep' && /^\d{8}$/.test(d)) return `${d.slice(0, 5)}-${d.slice(5)}`;
  if (/fone$/.test(campo) && /^\d{10,11}$/.test(d)) return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
}

/** Comparação aproximada (só para a tela: o servidor valida e normaliza de verdade). */
function cdNormal(campo, v) {
  if (typeof v === 'boolean') return v;
  const s = v == null ? '' : String(v).trim().replace(/\s+/g, ' ');
  if (['cep', 'cod_municipio', 'fone', 'contador_fone'].includes(campo) || (campo === 'ie' && !/^isento$/i.test(s))) return s.replace(/\D/g, '');
  if (campo === 'ie') return 'ISENTO';
  if (/email$/.test(campo)) return s.toLowerCase();
  return s;
}

/** Campos alterados no formulário em relação ao cadastro atual. */
function cdAlterados(atual, form) {
  return Object.keys(form).filter((k) => cdNormal(k, form[k]) !== cdNormal(k, atual[k] == null ? (typeof form[k] === 'boolean' ? false : '') : atual[k]));
}

/** Texto de uma alteração no Histórico. */
function cdTextoAlteracao(a, regimes) {
  const fmt = (v) => (v === true ? 'sim' : v === false ? 'não' : v == null || v === '' ? 'vazio' : a.campo === 'regime' ? (regimes[v] || v) : cdParaTela(a.campo, v));
  return `${a.rotulo}: ${fmt(a.antes)} → ${fmt(a.depois)}`;
}

if (typeof module !== 'undefined') module.exports = { CD_SECOES, cdParaTela, cdNormal, cdAlterados, cdTextoAlteracao };

/* ---------- tela ---------- */
if (typeof window !== 'undefined') {
  const CD_REGIMES = { simples: 'Simples Nacional', mei: 'MEI', presumido: 'Lucro Presumido', real: 'Lucro Real' };
  let cdAberta = null;

  function cdFechar() {
    if (!cdAberta) return;
    cdAberta.fundo.remove(); cdAberta.gaveta.remove();
    document.body.classList.remove('com-dialogo');
    document.removeEventListener('keydown', cdTecla);
    const volta = cdAberta.volta; cdAberta = null;
    if (volta && volta.focus) volta.focus();
  }
  function cdTecla(ev) { if (ev.key === 'Escape') cdFechar(); }

  async function cdAbrir(empresa, aoSalvar) {
    if (!pode('administracao.empresas')) { avisar('Seu perfil não pode editar o cadastro. Fale com um supervisor.', { tipo: 'erro' }); return; }
    let d;
    try { d = await chamar(`/api/empresas/${empresa.id}/cadastro`); } catch (e) { avisar(e.message, { tipo: 'erro' }); return; }
    const atual = d.cadastro; const campos = d.campos;
    const inputs = {};
    const campo = (k) => {
      const c = campos[k];
      let el;
      if (k === 'regime') {
        el = h('select', { id: `cd-${k}` }, ...(atual.regime ? [] : [h('option', { value: '', text: 'Não informado' })]),
          ...Object.entries(CD_REGIMES).map(([v, t]) => h('option', { value: v, text: t, selected: v === atual.regime })));
      } else {
        const tipo = /email$/.test(k) ? 'email' : /fone$/.test(k) ? 'tel' : 'text';
        el = h('input', { id: `cd-${k}`, type: tipo, value: cdParaTela(k, atual[k]), autocomplete: 'off', maxlength: c.max ? String(c.max) : (k === 'cep' ? '9' : k === 'cod_municipio' ? '7' : '150'),
          inputmode: ['cep', 'cod_municipio', 'fone', 'contador_fone'].includes(k) ? 'numeric' : null, placeholder: k === 'ie' ? 'Só números ou ISENTO' : '' });
      }
      inputs[k] = el;
      return h('label', { class: `campo cd-${k}` }, h('span', { text: c.rotulo }), el);
    };
    const nfe = h('input', { type: 'checkbox', id: 'cd-captar_nfe' }); nfe.checked = atual.captar_nfe !== false;
    const cte = h('input', { type: 'checkbox', id: 'cd-captar_cte' }); cte.checked = atual.captar_cte !== false;
    const erro = h('p', { class: 'erro', role: 'alert', hidden: true });
    const confirma = h('div', { class: 'cd-confirma', hidden: true });
    const salvar = h('button', { type: 'submit', class: 'botao primario' }, 'Salvar');

    const lerForm = () => {
      const f = {};
      for (const [k, el] of Object.entries(inputs)) f[k] = el.value;
      f.captar_nfe = nfe.checked; f.captar_cte = cte.checked;
      return f;
    };
    const enviar = async (confirmarRegime) => {
      erro.hidden = true;
      const f = lerForm();
      const mudou = cdAlterados(atual, f);
      if (!mudou.length) { avisar('Nada foi alterado.'); return; }
      if (mudou.includes('regime') && !confirmarRegime) {
        confirma.replaceChildren(icone('triangle-alert'), h('div', {},
          h('strong', { text: `Trocar o regime para ${CD_REGIMES[f.regime]}?` }),
          h('span', { text: `Hoje está ${CD_REGIMES[atual.regime] || 'não informado'}. O regime muda o que o Appura calcula para esta empresa: apuração do Simples, SPED Contribuições, guias e as regras da auditoria. Confira antes de salvar.` }),
          h('span', { class: 'gu-botoes' },
            h('button', { type: 'button', class: 'botao pequeno fantasma', onclick: () => { inputs.regime.value = atual.regime || ''; confirma.hidden = true; } }, 'Manter o regime'),
            h('button', { type: 'button', class: 'botao pequeno primario', onclick: () => enviar(true) }, 'Confirmar e salvar'))));
        confirma.hidden = false; confirma.scrollIntoView({ block: 'nearest' });
        return;
      }
      const corpo = { campos: Object.fromEntries(mudou.map((k) => [k, f[k]])), confirmarRegime: !!confirmarRegime };
      salvar.disabled = true; salvar.textContent = 'Salvando…';
      try {
        const r = await chamar(`/api/empresas/${empresa.id}/cadastro`, { method: 'PATCH', body: corpo });
        const n = r.alteracoes.length;
        avisar(n ? `Cadastro atualizado (${n} campo${n === 1 ? '' : 's'}). A alteração ficou no Histórico.` : 'Nada foi alterado.', { tipo: 'ok' });
        cdFechar();
        if (aoSalvar) aoSalvar(r.cadastro);
      } catch (e) {
        erro.textContent = e.message; erro.hidden = false; confirma.hidden = true;
        salvar.disabled = false; salvar.textContent = 'Salvar';
      }
    };

    const fundo = h('div', { class: 'gaveta-fundo', onclick: cdFechar });
    const gaveta = h('aside', { class: 'gaveta cd-gaveta', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cd-titulo', tabindex: '-1' },
      h('div', { class: 'gaveta-topo' }, h('h2', { id: 'cd-titulo', text: 'Editar cadastro' }),
        h('button', { type: 'button', class: 'botao fantasma icone', 'aria-label': 'Fechar', onclick: cdFechar }, '✕')),
      h('form', { class: 'gaveta-corpo', novalidate: true, onsubmit: (ev) => { ev.preventDefault(); enviar(false); } },
        h('div', { class: 'cd-fixo' }, h('strong', { text: atual.razao_social }), h('span', { class: 'meta mono', text: `${formatarCnpj(atual.cnpj)} · ${atual.uf}` }),
          h('span', { class: 'meta', text: 'CNPJ, razão social e UF vêm do certificado e não mudam aqui.' })),
        ...CD_SECOES.map(([titulo, lista]) => h('fieldset', { class: 'cd-secao' }, h('legend', { text: titulo }), h('div', { class: 'cd-grade' }, ...lista.map(campo)))),
        h('fieldset', { class: 'cd-secao' }, h('legend', { text: 'Captação na SEFAZ' }),
          h('label', { class: 'marcar' }, nfe, ' Captar NF-e (entradas e notas em que a empresa aparece)'),
          h('label', { class: 'marcar' }, cte, ' Captar CT-e (fretes em que a empresa é tomadora)')),
        confirma, erro,
        h('div', { class: 'gaveta-acoes' }, h('button', { type: 'button', class: 'botao fantasma', onclick: cdFechar }, 'Cancelar'), salvar)));
    document.body.append(fundo, gaveta);
    document.body.classList.add('com-dialogo');
    document.addEventListener('keydown', cdTecla);
    cdAberta = { fundo, gaveta, volta: document.activeElement };
    inputs.regime.focus();
  }

  window.cdAbrir = cdAbrir;
  window.cdTextoAlteracao = (a) => cdTextoAlteracao(a, CD_REGIMES);
}
