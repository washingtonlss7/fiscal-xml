/**
 * PROVA DE CONCEITO ISOLADA — NFeIntegracao / nfeIntegracaoContab (SVRS) para NFC-e modelo 65 do ES.
 * Não altera o coletor, o banco (só leitura), NSUs de produção, agendamentos nem cadastros.
 *
 * Uso (no container do coletor, onde já existem SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e MASTER_KEY):
 *   node dist/cli/poc-nfe-integracao.js --empresa <id ou CNPJ> [--chave <44 dígitos>] [--certificado empresa|escritorio]
 *        [--pacote /caminho/pacote.zip] [--versao 1.00] [--saida /app/backup/poc-nfeintegracao] [--so-preparar]
 *
 * - O certificado e a senha vêm do cadastro cifrado (tabela certificados + MASTER_KEY); nada de segredo em argumento ou log.
 * - Sem --chave, usa a NFC-e de saída autorizada mais recente da empresa já gravada no Appura (modelo 65, UF 32).
 * - Limite: 3 chamadas SOAP no total por empresa (contadas no estado desta prova, não do coletor).
 * - Resultados (bytes recebidos, XML extraídos, relatório) em pasta protegida (0700/0600), fora do Git.
 */
import 'dotenv/config';
import { execFileSync } from 'child_process';
import fs from 'fs';
import https from 'https';
import tls from 'tls';
import path from 'path';
import { criarAgente, lerPfx } from '../cert';
import { decifrar } from '../cripto';
import { criarDb, ok } from '../db';
import {
  abrirLote, classificar, CODIGOS_MANUAL, conferirChave, ContratoWsdl, lerEstruturaXsd, lerResposta, lerWsdl, mascararChave, mascararDoc,
  montarEnvelope, montarSolicitacao, sha256, tipoCertificado, verificarAssinatura,
} from '../poc/nfeIntegracaoContab';

const ENDPOINT = 'https://dfe-servico.svrs.rs.gov.br/WS/NFeIntegracao/NFeIntegracao.asmx';
const WSDL = `${ENDPOINT}?WSDL`;
const PACOTE_OFICIAL = 'https://atendimento.receita.rs.gov.br/upload/arquivos/202608/18134028-cte-bt-rs2015-001-v1-00-integracao-contabilista.zip';
const OPERACAO = 'nfeIntegracaoContab';
const MAX_SOAP = 3;
const TIMEOUT_MS = 60_000;

/* ---------- argumentos ---------- */
function args() {
  const a = process.argv.slice(2); const o: Record<string, string | boolean> = {};
  for (let i = 0; i < a.length; i++) {
    if (!a[i].startsWith('--')) continue;
    const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
    o[k] = v;
  }
  return o;
}

/* ---------- registro ---------- */
const agoraSP = () => new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).replace(' ', 'T') + '-03:00';
interface Etapa { etapa: string; quando: string; [k: string]: unknown }
const relatorio: { inicio: string; etapas: Etapa[]; conclusao?: string; explicacao?: string } = { inicio: agoraSP(), etapas: [] };
const registrar = (etapa: string, dados: Record<string, unknown>) => {
  const e = { etapa, quando: agoraSP(), ...dados };
  relatorio.etapas.push(e);
  console.log(`\n[${e.quando}] ${etapa}`);
  for (const [k, v] of Object.entries(dados)) console.log(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
};
let pastaExec = '';
const gravar = (nome: string, conteudo: Buffer | string) => {
  const f = path.join(pastaExec, nome);
  fs.writeFileSync(f, conteudo, { mode: 0o600 });
  return f;
};

/* ---------- HTTPS com registro de TLS ---------- */
interface RespHttp { status: number; corpo: Buffer; ms: number; tls: { autorizado: boolean; erroAutorizacao: string | null; protocolo: string | null; servidor: string | null; emissor: string | null; validoAte: string | null } }
function requisitar(url: string, agent: https.Agent | undefined, metodo: 'GET' | 'POST', corpo?: string, cabecalhos: Record<string, string> = {}): Promise<RespHttp> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: metodo, agent, timeout: TIMEOUT_MS, rejectUnauthorized: true, headers: { ...cabecalhos, ...(corpo ? { 'Content-Length': Buffer.byteLength(corpo) } : {}) } }, (res) => {
      const sock: any = res.socket;
      const peer = sock?.getPeerCertificate ? sock.getPeerCertificate() : null;
      const partes: Buffer[] = [];
      res.on('data', (p) => partes.push(p));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0, corpo: Buffer.concat(partes), ms: Date.now() - t0,
        tls: { autorizado: !!sock?.authorized, erroAutorizacao: sock?.authorizationError ? String(sock.authorizationError) : null, protocolo: sock?.getProtocol?.() ?? null, servidor: peer?.subject?.CN ?? null, emissor: peer?.issuer?.CN ?? null, validoAte: peer?.valid_to ?? null },
      }));
    });
    req.on('timeout', () => req.destroy(new Error(`Tempo esgotado (${TIMEOUT_MS} ms)`)));
    req.on('error', reject);
    if (corpo) req.write(corpo);
    req.end();
  });
}

/* ---------- estado exclusivo desta prova ---------- */
interface Estado { chamadasSoap: number; ultNSU: string; proximaDistribuicaoEm: string | null; historico: { quando: string; tipo: string; cStat: string | null; xMotivo: string | null }[] }

async function main() {
  const a = args();
  if (!a.empresa || a.empresa === true) throw new Error('Informe --empresa <id ou CNPJ>.');
  const saidaBase = String(a.saida && a.saida !== true ? a.saida : '/app/backup/poc-nfeintegracao');
  const soPreparar = a['so-preparar'] === true;

  for (const v of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MASTER_KEY']) if (!process.env[v]?.trim()) throw new Error(`Variável ${v} não definida neste ambiente (rode no container do coletor).`);
  const db = criarDb(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const tpAmb = (process.env.TP_AMB?.trim() || '1') as '1' | '2';
  if (tpAmb !== '1') throw new Error('Esta prova é para produção (TP_AMB=1).');

  /* 1. Empresa e certificado */
  const filtro = /^\d{14}$/.test(String(a.empresa).replace(/\D/g, '')) && !String(a.empresa).includes('-') ? { col: 'cnpj', v: String(a.empresa).replace(/\D/g, '') } : { col: 'id', v: String(a.empresa) };
  const empresa = ok(await db.from('empresas').select('id,cnpj,razao_social,uf,escritorio,ativo').eq(filtro.col, filtro.v).maybeSingle(), 'empresa') as any;
  if (!empresa) throw new Error('Empresa não encontrada.');
  if (empresa.uf !== 'ES') throw new Error('A empresa escolhida não é do ES.');
  if (empresa.escritorio) throw new Error('Escolha a empresa cliente (emitente), não o escritório.');

  const origemCert = a.certificado === 'escritorio' ? 'escritorio' : 'empresa';
  let donoCert = empresa;
  if (origemCert === 'escritorio') {
    donoCert = ok(await db.from('empresas').select('id,cnpj,razao_social,uf,escritorio').eq('escritorio', true).eq('ativo', true).limit(1).maybeSingle(), 'escritório') as any;
    if (!donoCert) throw new Error('Nenhuma empresa do escritório cadastrada.');
  }
  const certRow = ok(await db.from('certificados').select('id,pfx_cifrado,senha_cifrada,valido_ate').eq('empresa_id', donoCert.id).eq('ativo', true).maybeSingle(), 'certificado') as any;
  if (!certRow) throw new Error('Sem certificado ativo cadastrado para o dono escolhido.');
  const cert = lerPfx(decifrar(certRow.pfx_cifrado, process.env.MASTER_KEY!), decifrar(certRow.senha_cifrada, process.env.MASTER_KEY!).toString('utf8'));
  const cn = new (await import('crypto')).X509Certificate(cert.certPem).subject.split('\n').find((l) => l.startsWith('CN='))?.slice(3) ?? cert.titular;
  const tipo = tipoCertificado(cn);
  const papel = tipo.documento === empresa.cnpj ? 'emitente (próprio contribuinte)' : origemCert === 'escritorio' ? 'escritório de contabilidade' : 'outro titular';

  pastaExec = path.join(saidaBase, empresa.cnpj, new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(pastaExec, { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(saidaBase), 0o700);
  const arqEstado = path.join(saidaBase, empresa.cnpj, 'estado-poc.json');
  const estado: Estado = fs.existsSync(arqEstado) ? JSON.parse(fs.readFileSync(arqEstado, 'utf8')) : { chamadasSoap: 0, ultNSU: '0', proximaDistribuicaoEm: null, historico: [] };
  const salvarEstado = () => fs.writeFileSync(arqEstado, JSON.stringify(estado, null, 2), { mode: 0o600 });

  registrar('1. Empresa e certificado', {
    empresa: `${empresa.razao_social} (${mascararDoc(empresa.cnpj)})`,
    certificado: `${tipo.tipo} de ${mascararDoc(tipo.documento)} — ${papel}`,
    armazenamento: 'A1 cifrado no cadastro do Appura (sem dispositivo local)',
    valido_de: cert.validoDe.toISOString(), valido_ate: cert.validoAte.toISOString(),
    vencido: cert.validoAte.getTime() < Date.now(),
    chamadas_soap_ja_feitas_nesta_prova: estado.chamadasSoap,
  });
  if (cert.validoAte.getTime() < Date.now()) return concluir('Teste inconclusivo por problema técnico', 'Certificado vencido.');

  /* 2. Chave */
  let chave = typeof a.chave === 'string' ? a.chave.replace(/\D/g, '') : '';
  if (!chave) {
    const desde = new Date(Date.now() - 45 * 86400_000).toISOString();
    const n = ok(await db.from('documentos').select('chave,emitida_em').eq('empresa_id', empresa.id).eq('modelo', '65').eq('direcao', 'saida').eq('situacao', 'autorizada')
      .gte('emitida_em', desde).order('emitida_em', { ascending: false }).limit(1), 'chave recente') as any[];
    if (!n.length) return concluir('Teste inconclusivo por problema técnico', 'Nenhuma NFC-e de saída autorizada recente no Appura para esta empresa. Informe --chave.');
    chave = String(n[0].chave).trim();
  }
  const conf = conferirChave(chave, empresa.cnpj);
  registrar('2. Chave de acesso', { chave: mascararChave(chave), aamm: conf.aamm, modelo: conf.modelo, uf: conf.cUF, conferencia: conf.ok ? 'ok (44 dígitos, DV, modelo 65, UF 32, CNPJ da empresa)' : conf.problemas });
  if (!conf.ok) return concluir('Teste inconclusivo por problema técnico', `Chave não serve para o teste: ${conf.problemas.join(' ')}`);

  /* 3. Contrato: WSDL (com o certificado) e XSD do pacote oficial */
  const agente = criarAgente(cert);
  let contrato: ContratoWsdl;
  try {
    const r = await requisitar(WSDL, agente, 'GET');
    const f = gravar('contrato.wsdl', r.corpo);
    registrar('3a. Acesso HTTP à documentação (WSDL)', { url: WSDL, http: r.status, ms: r.ms, tls_servidor_verificado: r.tls.autorizado, tls_erro: r.tls.erroAutorizacao, protocolo: r.tls.protocolo, servidor: r.tls.servidor, emissor: r.tls.emissor, sha256: sha256(r.corpo), arquivo: f });
    if (r.status !== 200) return concluir('Teste inconclusivo por problema técnico', `WSDL respondeu HTTP ${r.status}.`);
    contrato = lerWsdl(r.corpo.toString('utf8'), OPERACAO);
    registrar('3b. Contrato (WSDL)', { ...contrato });
  } catch (e) {
    registrar('3a. Acesso HTTP à documentação (WSDL)', { url: WSDL, erro: (e as Error).message });
    return concluir('Teste inconclusivo por problema técnico', `Não foi possível obter ou ler o WSDL: ${(e as Error).message}`);
  }

  const pastaXsd = path.join(pastaExec, 'xsd');
  fs.mkdirSync(pastaXsd, { recursive: true, mode: 0o700 });
  let zip: Buffer;
  if (typeof a.pacote === 'string') zip = fs.readFileSync(a.pacote);
  else {
    // Sem certificado do cliente (é só um download público), mas com as raízes ICP-Brasil
    const caFile = process.env.SEFAZ_CA_FILE;
    const ca = caFile && fs.existsSync(caFile) && fs.statSync(caFile).size ? [...tls.rootCertificates, fs.readFileSync(caFile, 'utf8')] : undefined;
    const r = await requisitar(PACOTE_OFICIAL, ca ? new https.Agent({ ca }) : undefined, 'GET');
    if (r.status !== 200) return concluir('Teste inconclusivo por problema técnico', `Pacote oficial respondeu HTTP ${r.status}. Baixe-o e use --pacote.`);
    zip = r.corpo;
  }
  const arqZip = gravar('pacote-oficial.zip', zip);
  execFileSync('unzip', ['-o', '-q', arqZip, '-d', pastaXsd]);
  const xsds: Record<string, string> = {};
  const listar = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => (x.isDirectory() ? listar(path.join(d, x.name)) : [path.join(d, x.name)]));
  for (const f of listar(pastaXsd)) if (f.toLowerCase().endsWith('.xsd')) xsds[path.relative(pastaXsd, f)] = fs.readFileSync(f, 'utf8');
  const versaoPedida = typeof a.versao === 'string' ? a.versao : null;
  const candidatos = Object.keys(xsds).filter((n) => /distnfers/i.test(n) && !/ret/i.test(path.basename(n)));
  const porVersao = candidatos.map((n) => ({ n, v: n.match(/v?(\d+\.\d+)/i)?.[1] ?? null }));
  registrar('3c. Pacote de schemas', { sha256_zip: sha256(zip), xsd_encontrados: Object.keys(xsds), candidatos_distNFeRS: porVersao });
  const escolhido = porVersao.find((c) => (versaoPedida ? c.v === versaoPedida : c.v === '1.00')) ?? porVersao[0];
  if (!escolhido) return concluir('Teste inconclusivo por problema técnico', 'O pacote não tem XSD de distNFeRS.');
  // Carrega o XSD escolhido e o que ele incluir (só o que existir no pacote)
  const dir = path.dirname(escolhido.n);
  const conjunto: Record<string, string> = {};
  const faltando: string[] = [];
  const carregar = (rel: string) => {
    if (conjunto[rel] !== undefined) return;
    if (xsds[rel] === undefined) { faltando.push(rel); return; }
    conjunto[rel] = xsds[rel];
    for (const m of xsds[rel].matchAll(/schemaLocation="([^"]+)"/g)) carregar(path.normalize(path.join(path.dirname(rel), m[1])));
  };
  carregar(escolhido.n);
  const estrutura = lerEstruturaXsd(conjunto, 'distNFeRS');
  registrar('3d. Estrutura da solicitação (XSD)', { arquivo: escolhido.n, versao_no_xsd: estrutura.versao, includes: estrutura.includes, includes_ausentes: faltando, elementos: JSON.stringify(estrutura.filhos, (k, v) => (k === 'doc' && !v ? undefined : v)) });
  if (faltando.length) return concluir('Teste inconclusivo por problema técnico', `O XSD ${escolhido.n} inclui arquivos que não estão no pacote: ${faltando.join(', ')}. Nada foi inventado; escolha outra versão com --versao.`);
  const versao = estrutura.versao ?? escolhido.v ?? versaoPedida;
  if (!versao) return concluir('Teste inconclusivo por problema técnico', 'O XSD não fixa a versão e nenhuma foi informada (--versao).');

  const validarXsd = (xml: string, nome: string): string => {
    const f = gravar(nome, xml);
    try { execFileSync('xmllint', ['--noout', '--schema', path.join(pastaXsd, escolhido.n), f], { stdio: 'pipe' }); return 'válido pelo XSD (xmllint)'; }
    catch (e: any) {
      if (e.code === 'ENOENT') return 'xmllint indisponível: só conferência estrutural pela ordem do XSD';
      throw new Error(`Solicitação inválida pelo XSD: ${String(e.stderr ?? e.message).slice(0, 800)}`);
    }
  };

  /* 4. Primeira consulta: a chave */
  const docSolicitante = tipo.documento ?? '';
  const sol = montarSolicitacao(estrutura, { tpAmb, cUF: '43', modelo: '65', cnpjConsultado: empresa.cnpj, docSolicitante, versao, modo: { tipo: 'solDFe', chave } });
  if ('erro' in sol) { registrar('4a. Solicitação por chave', { erro: sol.erro, detalhes: sol.detalhes }); return concluir('Teste inconclusivo por problema técnico', `${sol.erro} ${sol.detalhes.join(' ')}`); }
  let validacao: string;
  try { validacao = validarXsd(sol.xml, 'solicitacao-1-chave.xml'); } catch (e) { registrar('4a. Solicitação por chave', { validacao: (e as Error).message }); return concluir('Teste inconclusivo por problema técnico', (e as Error).message); }
  registrar('4a. Solicitação por chave', { versao, cUF: '43 (fixo no contrato)', modo: 'solDFe/chAcesso', chave: mascararChave(chave), validacao, xml_mascarado: sol.xml.replace(chave, mascararChave(chave)).replace(/\d{11,14}/g, (d) => mascararDoc(d)) });
  if (soPreparar) return concluir('Teste inconclusivo por problema técnico', 'Executado com --so-preparar: contrato conferido e solicitação montada; nenhuma chamada SOAP feita.');

  const chamar = async (rotulo: string, xml: string) => {
    if (estado.chamadasSoap >= MAX_SOAP) throw new Error(`Limite de ${MAX_SOAP} chamadas SOAP desta prova atingido para a empresa.`);
    const envelope = montarEnvelope(contrato, xml);
    estado.chamadasSoap++; salvarEstado();
    const endpoint = contrato.endereco ?? ENDPOINT;
    const cab: Record<string, string> = { 'Content-Type': `application/soap+xml; charset=utf-8${contrato.soapAction ? `; action="${contrato.soapAction}"` : ''}` };
    let r: RespHttp;
    try { r = await requisitar(endpoint, agente, 'POST', envelope, cab); } catch (e) {
      registrar(`${rotulo} — transporte`, { endpoint, erro: (e as Error).message });
      throw e;
    }
    const arq = gravar(`resposta-${estado.chamadasSoap}.soap.xml`, r.corpo);
    const resp = lerResposta(r.corpo.toString('utf8'));
    estado.historico.push({ quando: agoraSP(), tipo: rotulo, cStat: resp.cStat, xMotivo: resp.xMotivo }); salvarEstado();
    registrar(rotulo, {
      endpoint, soap_action: contrato.soapAction, http: r.status, duracao_ms: r.ms,
      tls: `${r.tls.autorizado ? 'servidor verificado' : `servidor NÃO verificado (${r.tls.erroAutorizacao})`}; certificado do cliente apresentado; ${r.tls.protocolo}`,
      soap_fault: resp.fault, cStat: resp.cStat, xMotivo: resp.xMotivo, significado_no_manual: resp.cStat ? CODIGOS_MANUAL[resp.cStat] ?? '(código fora da lista do manual)' : null,
      campos: resp.campos, lote: resp.loteBase64 ? `${resp.loteBase64.length} caracteres base64` : 'sem loteDistComp',
      resposta_bruta: arq, sha256_resposta: sha256(r.corpo),
    });
    return { r, resp };
  };

  const processarLote = (rotulo: string, loteB64: string, chaveEsperada: string | null) => {
    const l = abrirLote(loteB64);
    const fl = gravar(`${rotulo}-lote.bin`, l.bruto);
    const docs = l.docs.map((d) => {
      const c = classificar(d.texto, chaveEsperada, empresa.cnpj);
      const f = gravar(`${rotulo}-doc-${d.indice}-${c.classe}.xml`, d.bytes);
      const ass = c.classe === 'nfce_completa' || c.classe === 'nfe_completa_outro_modelo' ? verificarAssinatura(d.texto) : null;
      return { indice: d.indice, origem: d.origem, classe: c.classe, chave: c.chave ? mascararChave(c.chave) : null, modelo: c.modelo, emitente_esperado: c.emitente === empresa.cnpj, itens: c.itens, protNFe: c.protocolo, protocolo_confere: c.protocoloConfere, motivos: c.motivos, assinatura: ass, sha256: sha256(d.bytes), arquivo: f };
    });
    registrar(`${rotulo} — documentos do lote`, { lote_descompactado: fl, sha256_lote: sha256(l.bruto), tags_no_lote: l.tags, documentos: docs.length, detalhes: docs });
    return docs;
  };

  let primeira;
  try { primeira = await chamar('4b. Consulta por chave (solDFe)', sol.xml); } catch (e) { return concluir('Teste inconclusivo por problema técnico', (e as Error).message); }
  const { resp } = primeira;
  if (resp.fault) return concluir('Teste inconclusivo por problema técnico', `SOAP Fault: ${resp.fault}`);
  if (!resp.retorno) return concluir('Teste inconclusivo por problema técnico', `HTTP ${primeira.r.status} sem retDistNFeRS na resposta.`);
  if (['8002', '8003', '8004'].includes(String(resp.cStat))) return concluir('Acesso rejeitado para as credenciais testadas', `cStat ${resp.cStat} — ${resp.xMotivo}`);
  if (resp.cStat === '656') return concluir('Teste inconclusivo por problema técnico', `Consumo indevido (656): ${resp.xMotivo}. Encerrado sem novas chamadas.`);
  if (resp.cStat === '117') return concluir('Nenhum documento localizado', `cStat 117 — ${resp.xMotivo}`);
  if (resp.cStat !== '118' || !resp.loteBase64) return concluir('Teste inconclusivo por problema técnico', `cStat ${resp.cStat} — ${resp.xMotivo}`);
  const docs1 = processarLote('consulta-chave', resp.loteBase64, chave);
  const completa = docs1.find((d) => d.classe === 'nfce_completa');
  if (!completa) return concluir('Teste inconclusivo por problema técnico', `cStat 118, mas nenhum documento é NFC-e completa (classes: ${docs1.map((d) => d.classe).join(', ') || 'nenhuma'}).`);

  /* 5. Distribuição (no máximo 2 páginas, respeitando a espera) */
  if (estado.proximaDistribuicaoEm && Date.parse(estado.proximaDistribuicaoEm) > Date.now()) {
    return concluir('XML completo obtido', `Consulta por chave trouxe a NFC-e completa. Distribuição não feita: aguardar até ${estado.proximaDistribuicaoEm} (regra de 15 min do manual).`);
  }
  let paginas = 0; let docsDist = 0;
  while (paginas < 2 && estado.chamadasSoap < MAX_SOAP) {
    const s2 = montarSolicitacao(estrutura, { tpAmb, cUF: '43', modelo: '65', cnpjConsultado: empresa.cnpj, docSolicitante, versao, modo: { tipo: 'solRel', indXML: '1', indEmit: '1', indDest: '0', ultNSU: estado.ultNSU } });
    if ('erro' in s2) { registrar('5. Distribuição', { erro: s2.erro, detalhes: s2.detalhes }); break; }
    try { registrar(`5.${paginas + 1}a Solicitação de distribuição`, { ultNSU: estado.ultNSU, validacao: validarXsd(s2.xml, `solicitacao-${estado.chamadasSoap + 1}-distribuicao.xml`) }); } catch (e) { registrar('5. Distribuição', { validacao: (e as Error).message }); break; }
    let ret;
    try { ret = await chamar(`5.${paginas + 1}b Distribuição (solRel, página ${paginas + 1})`, s2.xml); } catch (e) { registrar('5. Distribuição', { erro: (e as Error).message }); break; }
    paginas++;
    const rr = ret.resp;
    if (rr.fault || !rr.retorno || rr.cStat !== '118') {
      if (rr.cStat === '117') estado.proximaDistribuicaoEm = new Date(Date.now() + 15 * 60_000).toISOString();
      salvarEstado(); break;
    }
    const d = rr.loteBase64 ? processarLote(`distribuicao-p${paginas}`, rr.loteBase64, null) : [];
    docsDist += d.length;
    const ultRet = rr.campos.ultNSURet ?? rr.campos.ultNSU;
    if (ultRet) estado.ultNSU = ultRet;
    if (d.length < 50) { estado.proximaDistribuicaoEm = new Date(Date.now() + 15 * 60_000).toISOString(); salvarEstado(); break; }
    salvarEstado();
  }
  return concluir('XML completo obtido', `Consulta por chave (solDFe, mod 65, cUF 43) trouxe a NFC-e completa com protocolo (${completa.sha256}). Distribuição: ${paginas} página(s), ${docsDist} documento(s).`);
}

function concluir(conclusao: string, explicacao: string) {
  relatorio.conclusao = conclusao; relatorio.explicacao = explicacao;
  console.log(`\n=== CONCLUSÃO: ${conclusao} ===\n${explicacao}`);
  if (pastaExec) {
    const f = path.join(pastaExec, 'relatorio.json');
    fs.writeFileSync(f, JSON.stringify(relatorio, null, 2), { mode: 0o600 });
    console.log(`\nRelatório: ${f}`);
  }
}

main().catch((e) => {
  console.error(`Falha: ${(e as Error).message}`);
  concluir('Teste inconclusivo por problema técnico', (e as Error).message);
  process.exitCode = 1;
});
