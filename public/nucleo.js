'use strict';
/*
 * Núcleo do painel: formatação pt-BR e rotas. Funções puras, carregadas antes do app.js
 * e testadas em test/nucleo.test.ts.
 */

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/* ---------- formatação (padrão do Design System) ---------- */
/** R$ 18.420,35 ("—" quando não há valor). */
const moeda = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? '—' : MOEDA.format(Number(v)));
/** 00.000.000/0001-00 */
const formatarCnpj = (c) => String(c || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
/** 30/09/2026 */
const formatarData = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—');
/** 02:48 */
const formatarHora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—');
/** 69,6% (uma casa decimal no máximo) */
const formatarPercentual = (v) => `${Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
/** Setembro / 2026 */
function textoCompetencia(v) {
  const [a, m] = String(v).split('-').map(Number);
  return `${MESES[m - 1]} / ${a}`;
}

/* ---------- rotas ---------- */
/** Abas da Empresa 360° e o pedaço do endereço de cada uma. */
const ABA_NO_ENDERECO = { visao: '', notas: '/notas', auditoria: '/auditoria', st: '/icms-st', sped: '/sped', apuracao: '/apuracao', guias: '/guias', documentos: '/documentos', arquivos: '/arquivos', historico: '/historico' };
const ABA_DO_ENDERECO = { notas: 'notas', auditoria: 'auditoria', 'icms-st': 'st', sped: 'sped', apuracao: 'apuracao', guias: 'guias', documentos: 'documentos', arquivos: 'arquivos', historico: 'historico' };

/**
 * Traduz o endereço (#/...) na tela a abrir. Endereço desconhecido ou sem permissão volta para a Visão Geral,
 * nunca abre página em branco.
 *   #/visao-geral · #/fechamento?filtros · #/empresas · #/empresas/<id>[/aba] · #/usuarios · #/sped?cadastro=<id>
 */
function resolverRota(hash, pode = () => true) {
  const r = hash || '#/visao-geral';
  const consulta = (x) => (x.includes('?') ? x.slice(x.indexOf('?') + 1) : '');
  if (/^#\/fechamento(\?.*)?$/.test(r)) return { tela: 'fechamento', base: '#/fechamento', consulta: consulta(r) };
  if (/^#\/sped(\?.*)?$/.test(r)) return { tela: 'sped', base: '#/sped', consulta: consulta(r) };
  if (r === '#/guias') return { tela: 'guias', base: '#/guias' };
  if (r === '#/ia') return { tela: 'ia', base: '#/ia' };
  if (/^#\/notas(\?.*)?$/.test(r)) return { tela: 'xml', base: '#/notas', consulta: consulta(r) };
  if (r === '#/escritorio') return pode('certificados') ? { tela: 'escritorio', base: '#/escritorio' } : { redirecionar: '#/visao-geral', semPermissao: 'Escritório' };
  if (r === '#/visao-geral') return { tela: 'visao', base: '#/visao-geral' };
  if (r === '#/usuarios') return pode('usuarios') ? { tela: 'usuarios', base: '#/usuarios' } : { redirecionar: '#/visao-geral', semPermissao: 'Usuários' };
  if (r === '#/empresas') return { tela: 'empresas', base: '#/empresas' };
  const emp = r.match(/^#\/empresas\/([0-9a-f-]{36})(?:\/([a-z-]+))?$/);
  if (emp) {
    if (emp[2] && !ABA_DO_ENDERECO[emp[2]]) return { redirecionar: `#/empresas/${emp[1]}` };
    return { tela: 'empresa', base: '#/empresas', id: emp[1], aba: ABA_DO_ENDERECO[emp[2]] || 'visao' };
  }
  return { redirecionar: '#/visao-geral' };
}

/** Endereço de uma aba da empresa (o inverso de resolverRota). */
const enderecoEmpresa = (id, aba = 'visao') => `#/empresas/${id}${ABA_NO_ENDERECO[aba] ?? ''}`;

/* ---------- tema (Automático segue o sistema; Claro/Escuro ficam salvos neste navegador) ---------- */
function aplicarTema(tema) {
  if (typeof document === 'undefined') return;
  const t = tema === 'claro' || tema === 'escuro' ? tema : 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-tema'); else document.documentElement.setAttribute('data-tema', t);
  const escuro = t === 'escuro' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', escuro ? '#111a2b' : '#ffffff');
  for (const b of document.querySelectorAll('.menu-tema [data-tema]')) b.setAttribute('aria-checked', String(b.dataset.tema === t));
  try { if (t === 'auto') localStorage.removeItem('appura-tema'); else localStorage.setItem('appura-tema', t); } catch { /* sem armazenamento */ }
}
if (typeof document !== 'undefined') {
  let salvo = null;
  try { salvo = localStorage.getItem('appura-tema'); } catch { /* sem armazenamento */ }
  if (salvo) aplicarTema(salvo);
}

if (typeof module !== 'undefined') {
  module.exports = { MESES, moeda, formatarCnpj, formatarData, formatarHora, formatarPercentual, textoCompetencia, resolverRota, enderecoEmpresa, ABA_NO_ENDERECO };
}
