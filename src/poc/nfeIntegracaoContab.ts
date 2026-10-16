/**
 * Prova de conceito (isolada): webservice NFeIntegracao / nfeIntegracaoContab da SVRS para NFC-e modelo 65.
 *
 * Nada aqui é usado pelo coletor. Funções puras (testadas em test/poc-nfe-integracao.test.ts) para:
 * - conferir a chave de acesso;
 * - ler o contrato real (WSDL e XSD baixados na hora, sem inventar elementos);
 * - montar a solicitação distNFeRS exatamente na ordem do XSD;
 * - ler a resposta SOAP, abrir o loteDistComp (base64 + gzip) e separar os documentos sem reformatar os bytes;
 * - classificar cada documento e verificar a assinatura com uma biblioteca independente (xml-crypto).
 */
import crypto from 'crypto';
import zlib from 'zlib';
import { XMLParser } from 'fast-xml-parser';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

export const NS_NFE = 'http://www.portalfiscal.inf.br/nfe';
export const NS_SOAP12 = 'http://www.w3.org/2003/05/soap-envelope';
const NS_WSDL_SOAP12 = 'http://schemas.xmlsoap.org/wsdl/soap12/';
const NS_DSIG = 'http://www.w3.org/2000/09/xmldsig#';

export const sha256 = (b: Buffer | string) => crypto.createHash('sha256').update(b).digest('hex');
export const mascararChave = (c: string) => (c.length === 44 ? `${c.slice(0, 6)}…${c.slice(-6)}` : '(inválida)');
export const mascararDoc = (d: string | null | undefined) => {
  const s = String(d ?? '').replace(/\D/g, '');
  if (s.length === 14) return `${s.slice(0, 2)}.***.***/${s.slice(8, 12)}-${s.slice(12)}`;
  if (s.length === 11) return `***.${s.slice(3, 6)}.***-${s.slice(9)}`;
  return s ? '***' : '';
};

/* ---------- chave de acesso ---------- */

export function dvChave(chave43: string): number {
  let soma = 0; let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) { soma += Number(chave43[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

export interface ConferenciaChave { ok: boolean; problemas: string[]; cUF: string; aamm: string; cnpj: string; modelo: string; serie: string; numero: string }

/** 44 dígitos, DV, modelo 65, UF 32 (ES) e CNPJ do emitente igual ao da empresa escolhida. */
export function conferirChave(chave: string, cnpjEsperado: string, ufEsperada = '32', modeloEsperado = '65'): ConferenciaChave {
  const c = String(chave ?? '').trim();
  const p: string[] = [];
  if (!/^\d{44}$/.test(c)) return { ok: false, problemas: ['A chave precisa ter 44 dígitos.'], cUF: '', aamm: '', cnpj: '', modelo: '', serie: '', numero: '' };
  const r = { cUF: c.slice(0, 2), aamm: c.slice(2, 6), cnpj: c.slice(6, 20), modelo: c.slice(20, 22), serie: c.slice(22, 25), numero: c.slice(25, 34) };
  if (dvChave(c.slice(0, 43)) !== Number(c[43])) p.push('Dígito verificador da chave não confere.');
  if (r.modelo !== modeloEsperado) p.push(`Modelo ${r.modelo} na chave (esperado ${modeloEsperado}).`);
  if (r.cUF !== ufEsperada) p.push(`UF ${r.cUF} na chave (esperado ${ufEsperada}).`);
  if (r.cnpj !== cnpjEsperado) p.push('CNPJ do emitente na chave é diferente do CNPJ da empresa escolhida.');
  return { ok: !p.length, problemas: p, ...r };
}

/* ---------- certificado ---------- */

export type TipoCertificado = 'e-CNPJ' | 'e-CPF' | 'desconhecido';
/** Tipo pelo CN do certificado ICP-Brasil ("NOME:14 dígitos" = e-CNPJ, "NOME:11 dígitos" = e-CPF). */
export function tipoCertificado(cnOuTitularComDoc: string): { tipo: TipoCertificado; documento: string | null } {
  const m = String(cnOuTitularComDoc).match(/:(\d{11}|\d{14})\b/);
  if (!m) return { tipo: 'desconhecido', documento: null };
  return { tipo: m[1].length === 14 ? 'e-CNPJ' : 'e-CPF', documento: m[1] };
}

/* ---------- WSDL ---------- */

export interface ContratoWsdl {
  targetNamespace: string;
  operacao: string;
  soapAction: string | null;
  endereco: string | null;
  /** Elemento do corpo SOAP (wrapper do .NET ou o próprio parâmetro). */
  elementoEntrada: string;
  /** Nome do parâmetro com a mensagem (esperado: nfeDadosMsgDownload). */
  parametro: string;
  /** O parâmetro é o próprio elemento do corpo (true) ou vem dentro do wrapper (false). */
  parametroEhCorpo: boolean;
  /** Conteúdo do parâmetro: XML (xs:any / mixed) ou texto (xs:string, precisa ser escapado). */
  conteudo: 'xml' | 'texto';
  elementoSaida: string | null;
  operacoesDisponiveis: string[];
}

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const local = (q: string | undefined) => String(q ?? '').replace(/^.*:/, '');

/** Lê o WSDL do serviço (SOAP 1.2) e devolve o contrato do método pedido. Falha se algo não estiver no contrato. */
export function lerWsdl(wsdl: string, operacao: string, parametroEsperado = 'nfeDadosMsgDownload'): ContratoWsdl {
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: false, parseTagValue: false });
  const j = p.parse(wsdl);
  const raizNome = Object.keys(j).find((k) => local(k) === 'definitions');
  if (!raizNome) throw new Error('WSDL sem <definitions>.');
  const raiz = j[raizNome];
  const ns: Record<string, string> = {};
  for (const [k, v] of Object.entries(raiz)) if (k.startsWith('@_xmlns:')) ns[k.slice(8)] = String(v);
  const prefixoSoap12 = Object.entries(ns).find(([, uri]) => uri === NS_WSDL_SOAP12)?.[0];
  if (!prefixoSoap12) throw new Error('O WSDL não declara SOAP 1.2 (wsdl/soap12).');
  const filho = (o: any, nome: string) => {
    const k = Object.keys(o ?? {}).find((x) => local(x) === nome && !x.startsWith('@_'));
    return k ? o[k] : undefined;
  };
  const tns = String(raiz['@_targetNamespace'] ?? '');

  const portTypes = arr(filho(raiz, 'portType'));
  const ops = portTypes.flatMap((pt: any) => arr(filho(pt, 'operation')));
  const operacoesDisponiveis = [...new Set(ops.map((o: any) => String(o['@_name'])))];
  const op = ops.find((o: any) => o['@_name'] === operacao);
  if (!op) throw new Error(`O WSDL não tem a operação ${operacao}. Operações: ${operacoesDisponiveis.join(', ')}`);
  const msgEntrada = local(filho(op, 'input')?.['@_message']);
  const msgSaida = local(filho(op, 'output')?.['@_message']);

  // Binding SOAP 1.2 da operação
  const bindings = arr(filho(raiz, 'binding')).filter((b: any) => b[`${prefixoSoap12}:binding`] !== undefined);
  if (!bindings.length) throw new Error('O WSDL não tem binding SOAP 1.2.');
  let soapAction: string | null = null; let nomeBinding = '';
  for (const b of bindings) {
    const o = arr(filho(b, 'operation')).find((x: any) => x['@_name'] === operacao);
    if (o) { soapAction = o[`${prefixoSoap12}:operation`]?.['@_soapAction'] ?? null; nomeBinding = String(b['@_name']); break; }
  }
  if (!nomeBinding) throw new Error(`A operação ${operacao} não está no binding SOAP 1.2.`);
  let endereco: string | null = null;
  for (const s of arr(filho(raiz, 'service'))) for (const port of arr(filho(s, 'port'))) {
    if (local(port['@_binding']) === nomeBinding) endereco = port[`${prefixoSoap12}:address`]?.['@_location'] ?? endereco;
  }

  const mensagens = arr(filho(raiz, 'message'));
  const parteEl = (nome: string) => local(arr(filho(mensagens.find((m: any) => m['@_name'] === nome), 'part'))[0]?.['@_element']);
  const elementoEntrada = parteEl(msgEntrada);
  if (!elementoEntrada) throw new Error(`Mensagem de entrada ${msgEntrada} sem elemento.`);
  const elementoSaida = msgSaida ? parteEl(msgSaida) || null : null;

  // Tipos: procura o elemento de entrada nos schemas embutidos
  const types = filho(raiz, 'types');
  const schemas = arr(filho(types, 'schema'));
  const acharEl = (nome: string): any => {
    for (const s of schemas) { const e = arr(filho(s, 'element')).find((x: any) => x['@_name'] === nome); if (e) return e; }
    return undefined;
  };
  const conteudoDe = (el: any): 'xml' | 'texto' => {
    if (!el) return 'xml';
    if (local(el['@_type']) === 'string') return 'texto';
    const ct = filho(el, 'complexType');
    if (ct && (filho(filho(ct, 'sequence'), 'any') !== undefined || ct['@_mixed'] === 'true')) return 'xml';
    return 'xml';
  };
  const elEntrada = acharEl(elementoEntrada);
  if (elementoEntrada === parametroEsperado) {
    return { targetNamespace: tns, operacao, soapAction, endereco, elementoEntrada, parametro: parametroEsperado, parametroEhCorpo: true, conteudo: conteudoDe(elEntrada), elementoSaida, operacoesDisponiveis };
  }
  const seq = filho(filho(elEntrada, 'complexType'), 'sequence');
  const filhos = arr(filho(seq, 'element'));
  const par = filhos.find((x: any) => x['@_name'] === parametroEsperado);
  if (!par) throw new Error(`O elemento ${elementoEntrada} não tem o parâmetro ${parametroEsperado}. Filhos: ${filhos.map((x: any) => x['@_name']).join(', ') || '(nenhum)'}`);
  return { targetNamespace: tns, operacao, soapAction, endereco, elementoEntrada, parametro: parametroEsperado, parametroEhCorpo: false, conteudo: conteudoDe(par), elementoSaida, operacoesDisponiveis };
}

const escapar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Envelope SOAP 1.2 conforme o contrato (o XML da solicitação entra como XML ou como texto escapado). */
export function montarEnvelope(c: ContratoWsdl, xmlSolicitacao: string): string {
  const dados = c.conteudo === 'texto' ? escapar(xmlSolicitacao) : xmlSolicitacao;
  const corpo = c.parametroEhCorpo
    ? `<${c.parametro} xmlns="${c.targetNamespace}">${dados}</${c.parametro}>`
    : `<${c.elementoEntrada} xmlns="${c.targetNamespace}"><${c.parametro}>${dados}</${c.parametro}></${c.elementoEntrada}>`;
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="${NS_SOAP12}"><soap12:Body>${corpo}</soap12:Body></soap12:Envelope>`;
}

/* ---------- XSD da solicitação ---------- */

export interface NoXsd {
  tipo: 'element' | 'choice';
  nome?: string;
  min: number;
  doc: string;
  filhos: NoXsd[];
  /** Valores permitidos (enumeration), quando houver. */
  valores?: string[];
}
export interface EstruturaXsd { raiz: string; versao: string | null; atributos: string[]; filhos: NoXsd[]; arquivo: string; includes: string[] }

/** Nó do parser com ordem preservada: { tag: filhos[], ':@': atributos }. */
type NoOrd = Record<string, any>;
const tagDe = (n: NoOrd) => Object.keys(n).find((k) => k !== ':@' && k !== '#text') ?? '';
const attrs = (n: NoOrd): Record<string, string> => n[':@'] ?? {};
const filhosDe = (n: NoOrd): NoOrd[] => (Array.isArray(n[tagDe(n)]) ? n[tagDe(n)] : []);
const achar1 = (lista: NoOrd[], t: string) => lista.find((x) => tagDe(x) === t);
const todos = (lista: NoOrd[], t: string) => lista.filter((x) => tagDe(x) === t);

/** Lê a definição de um elemento raiz (ex.: distNFeRS) nos XSD carregados (nome do arquivo → conteúdo), na ordem do XSD. */
export function lerEstruturaXsd(arquivos: Record<string, string>, raiz: string): EstruturaXsd {
  const p = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: true, parseTagValue: false, preserveOrder: true });
  const docs = Object.entries(arquivos).map(([nome, txt]) => {
    const r = p.parse(txt) as NoOrd[];
    const schema = r.find((x) => tagDe(x) === 'schema');
    return { nome, filhos: schema ? filhosDe(schema) : [] };
  }).filter((d) => d.filhos.length);
  const complexos = new Map<string, NoOrd>(); const simples = new Map<string, NoOrd>();
  for (const d of docs) {
    for (const t of todos(d.filhos, 'complexType')) complexos.set(attrs(t)['@_name'], t);
    for (const t of todos(d.filhos, 'simpleType')) simples.set(attrs(t)['@_name'], t);
  }
  const alvo = docs.find((d) => todos(d.filhos, 'element').some((e) => attrs(e)['@_name'] === raiz));
  if (!alvo) throw new Error(`Nenhum XSD define o elemento ${raiz}. Arquivos: ${Object.keys(arquivos).join(', ')}`);
  const elRaiz = todos(alvo.filhos, 'element').find((e) => attrs(e)['@_name'] === raiz)!;
  const texto = (n: NoOrd | undefined): string => !n ? '' : filhosDe(n).map((x) => (x['#text'] !== undefined ? String(x['#text']) : texto(x))).join(' ');
  const documentacao = (n: NoOrd) => {
    const ann = achar1(filhosDe(n), 'annotation');
    return ann ? todos(filhosDe(ann), 'documentation').map(texto).join(' ').replace(/\s+/g, ' ').trim() : '';
  };
  const enumeracoes = (n: NoOrd): string[] | undefined => {
    const st = achar1(filhosDe(n), 'simpleType') ?? (attrs(n)['@_type'] ? simples.get(local(attrs(n)['@_type'])) : undefined);
    const rest = st ? achar1(filhosDe(st), 'restriction') : undefined;
    const v = rest ? todos(filhosDe(rest), 'enumeration').map((e) => String(attrs(e)['@_value'])) : [];
    return v.length ? v : undefined;
  };
  const complexoDe = (n: NoOrd): NoOrd | undefined => achar1(filhosDe(n), 'complexType') ?? (attrs(n)['@_type'] ? complexos.get(local(attrs(n)['@_type'])) : undefined);
  const visitarLista = (lista: NoOrd[], prof: number): NoXsd[] => {
    const out: NoXsd[] = [];
    for (const item of lista) {
      const t = tagDe(item);
      if (t === 'element') out.push(noElemento(item, prof));
      else if (t === 'sequence') out.push(...visitarLista(filhosDe(item), prof));
      else if (t === 'choice') {
        const opcoes: NoXsd[] = [];
        for (const o of filhosDe(item)) {
          if (tagDe(o) === 'element') opcoes.push(noElemento(o, prof));
          else if (tagDe(o) === 'sequence') opcoes.push({ tipo: 'element', nome: '(sequência)', min: 1, doc: '', filhos: visitarLista(filhosDe(o), prof + 1) });
        }
        out.push({ tipo: 'choice', min: Number(attrs(item)['@_minOccurs'] ?? 1), doc: documentacao(item), filhos: opcoes });
      }
    }
    return out;
  };
  const visitarComplexo = (ct: NoOrd | undefined, prof: number): NoXsd[] => {
    if (!ct || prof > 6) return [];
    const corpo = filhosDe(ct).filter((x) => ['sequence', 'choice', 'all'].includes(tagDe(x)));
    return visitarLista(corpo.flatMap((c) => (tagDe(c) === 'choice' ? [c] : filhosDe(c))), prof + 1);
  };
  const noElemento = (e: NoOrd, prof: number): NoXsd => ({
    tipo: 'element', nome: attrs(e)['@_name'], min: Number(attrs(e)['@_minOccurs'] ?? 1), doc: documentacao(e),
    filhos: visitarComplexo(complexoDe(e), prof), valores: enumeracoes(e),
  });
  const ctRaiz = complexoDe(elRaiz);
  if (!ctRaiz) throw new Error(`Tipo de ${raiz} não encontrado nos XSD carregados (falta algum include?).`);
  const atributosNos = todos(filhosDe(ctRaiz), 'attribute');
  const attrVersao = atributosNos.find((a) => attrs(a)['@_name'] === 'versao');
  let versao: string | null = attrVersao ? attrs(attrVersao)['@_fixed'] ?? null : null;
  if (!versao && attrVersao) { const v = enumeracoes(attrVersao); versao = v?.length === 1 ? v[0] : null; }
  const includes = [...todos(alvo.filhos, 'include'), ...todos(alvo.filhos, 'import')].map((i) => String(attrs(i)['@_schemaLocation'] ?? '')).filter(Boolean);
  return { raiz, versao, atributos: atributosNos.map((a) => String(attrs(a)['@_name'])), filhos: visitarComplexo(ctRaiz, 0), arquivo: alvo.nome, includes };
}

/* ---------- montagem da solicitação ---------- */

export interface DadosSolicitacao {
  tpAmb: '1' | '2';
  cUF: string; // fixo 43 pelo contrato
  modelo: string; // 65
  cnpjConsultado: string; // CNPJ da empresa (emitente)
  docSolicitante: string; // CNPJ ou CPF do certificado usado
  versao: string;
  modo: { tipo: 'solDFe'; chave: string } | { tipo: 'solRel'; indXML: '1'; indEmit: '1'; indDest: '0'; ultNSU: string };
}

/** Elementos que identificam alguém: decide pela documentação do XSD se é o consultado ou o solicitante. */
function quemIdentifica(no: NoXsd, contextoDoc: string): 'consultado' | 'solicitante' | null {
  const t = `${no.doc} ${contextoDoc}`.toLowerCase();
  if (/contabil|solicitante|requisitante|certificado|autor/.test(t)) return 'solicitante';
  if (/contribuinte|interessad|emitente|consultad|empresa|cliente/.test(t)) return 'consultado';
  return null;
}

/**
 * Monta a solicitação na ordem do XSD. Só preenche o que se sabe preencher com segurança; qualquer elemento obrigatório
 * desconhecido (ou identidade sem documentação clara) interrompe com a lista do que falta — nada é inventado.
 */
export function montarSolicitacao(e: EstruturaXsd, d: DadosSolicitacao): { xml: string } | { erro: string; detalhes: string[] } {
  const faltas: string[] = [];
  const doc = (n: string | null | undefined) => String(n ?? '').replace(/\D/g, '');
  const preencherFolha = (no: NoXsd, ctx: string): string | null => {
    const nome = no.nome!;
    if (nome === 'tpAmb') return d.tpAmb;
    if (nome === 'cUF') return d.cUF;
    if (nome === 'mod') return d.modelo;
    if (nome === 'chAcesso' || nome === 'chNFe') return d.modo.tipo === 'solDFe' ? d.modo.chave : null;
    if (d.modo.tipo === 'solRel') {
      if (nome === 'indXML') return d.modo.indXML;
      if (nome === 'indEmit') return d.modo.indEmit;
      if (nome === 'indDest') return d.modo.indDest;
      if (nome === 'ultNSU') return d.modo.ultNSU;
    }
    if (nome === 'CNPJ' || nome === 'CPF') {
      const quem = quemIdentifica(no, ctx);
      const valor = quem === 'consultado' ? doc(d.cnpjConsultado) : quem === 'solicitante' ? doc(d.docSolicitante) : null;
      if (!quem) { faltas.push(`${nome}: a documentação do XSD não diz se é o contribuinte consultado ou o solicitante ("${no.doc || 'sem documentação'}").`); return null; }
      if ((nome === 'CNPJ' && valor?.length !== 14) || (nome === 'CPF' && valor?.length !== 11)) return null; // outro ramo da escolha
      return valor;
    }
    return null;
  };
  const gerar = (nos: NoXsd[], ctx: string): string => {
    let out = '';
    for (const no of nos) {
      if (no.tipo === 'choice') {
        // Escolha: solRel x solDFe pelo modo; CNPJ x CPF pelo que tiver valor
        const nomes = no.filhos.map((f) => f.nome);
        if (nomes.includes('solRel') || nomes.includes('solDFe')) {
          const escolhido = no.filhos.find((f) => f.nome === d.modo.tipo);
          if (!escolhido) { faltas.push(`Escolha ${nomes.join('/')}: o XSD não tem ${d.modo.tipo}.`); continue; }
          out += `<${escolhido.nome}>${gerar(escolhido.filhos, `${ctx} ${escolhido.doc}`)}</${escolhido.nome}>`;
          continue;
        }
        let ok = false;
        for (const f of no.filhos) {
          if (f.filhos.length) continue;
          const v = preencherFolha(f, `${ctx} ${no.doc}`);
          if (v) { out += `<${f.nome}>${v}</${f.nome}>`; ok = true; break; }
        }
        if (!ok && no.min > 0) faltas.push(`Escolha obrigatória ${nomes.join('/')} sem valor conhecido.`);
        continue;
      }
      if (no.filhos.length) { out += `<${no.nome}>${gerar(no.filhos, `${ctx} ${no.doc}`)}</${no.nome}>`; continue; }
      const v = preencherFolha(no, ctx);
      if (v !== null && v !== '') {
        if (no.valores && !no.valores.includes(v)) faltas.push(`${no.nome}=${v} fora dos valores do XSD (${no.valores.join(', ')}).`);
        out += `<${no.nome}>${v}</${no.nome}>`;
      } else if (no.min > 0) faltas.push(`${no.nome}: obrigatório no XSD e sem valor conhecido para este teste ("${no.doc || 'sem documentação'}").`);
    }
    return out;
  };
  const corpo = gerar(e.filhos, '');
  if (faltas.length) return { erro: 'A solicitação não pôde ser montada só com o que o contrato define.', detalhes: faltas };
  const versao = e.versao ?? d.versao;
  return { xml: `<${e.raiz} xmlns="${NS_NFE}" versao="${versao}">${corpo}</${e.raiz}>` };
}

/* ---------- resposta ---------- */

const desescapar = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tag = (xml: string, nome: string): string | null => {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${nome}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${nome}>`));
  return m ? m[1].trim() : null;
};

export interface RespostaDist {
  fault: string | null;
  retorno: string | null; // XML de retDistNFeRS (bruto)
  cStat: string | null;
  xMotivo: string | null;
  campos: Record<string, string>;
  loteBase64: string | null;
}

/** Lê o envelope de resposta: SOAP Fault, retDistNFeRS (como XML ou texto escapado), cStat/xMotivo e o lote. */
export function lerResposta(soap: string, raizRetorno = 'retDistNFeRS'): RespostaDist {
  const fault = /<(?:\w+:)?Fault\b/.test(soap)
    ? [tag(soap, 'Value'), tag(soap, 'Text'), tag(soap, 'faultstring')].filter(Boolean).map((x) => desescapar(String(x)).replace(/<[^>]+>/g, ' ').trim()).join(' - ') || 'SOAP Fault'
    : null;
  let retorno: string | null = null;
  const direto = soap.match(new RegExp(`<(?:\\w+:)?${raizRetorno}\\b[\\s\\S]*?</(?:\\w+:)?${raizRetorno}>`));
  if (direto) retorno = direto[0];
  else if (soap.includes(`&lt;${raizRetorno}`)) {
    const m = soap.match(new RegExp(`&lt;(?:\\w+:)?${raizRetorno}\\b[\\s\\S]*?&lt;/(?:\\w+:)?${raizRetorno}&gt;`));
    if (m) retorno = desescapar(m[0]);
  }
  const campos: Record<string, string> = {};
  if (retorno) {
    for (const n of ['tpAmb', 'verAplic', 'cStat', 'xMotivo', 'dhResp', 'ultNSU', 'ultNSURet', 'maxNSU', 'maxNSURet', 'qtdDocs', 'indCont']) {
      const v = tag(retorno, n); if (v !== null && !v.includes('<')) campos[n] = v;
    }
  }
  return { fault, retorno, cStat: campos.cStat ?? null, xMotivo: campos.xMotivo ?? null, campos, loteBase64: retorno ? tag(retorno, 'loteDistComp') : null };
}

export interface DocExtraido { indice: number; bytes: Buffer; texto: string; origem: 'xml' | 'base64' | 'base64-gzip' }

/** Abre o loteDistComp (base64 + gzip) e separa os <proc> sem reformatar o conteúdo. */
export function abrirLote(loteBase64: string): { bruto: Buffer; texto: string; docs: DocExtraido[]; tags: string[] } {
  const comp = Buffer.from(loteBase64.replace(/\s+/g, ''), 'base64');
  const bruto = comp[0] === 0x1f && comp[1] === 0x8b ? zlib.gunzipSync(comp) : comp;
  const texto = bruto.toString('utf8');
  const docs: DocExtraido[] = [];
  const re = /<proc\b[^>]*>([\s\S]*?)<\/proc>/g;
  let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(texto))) {
    const interno = m[1];
    if (interno.trim().startsWith('<')) {
      const t = interno.trim();
      docs.push({ indice: i++, bytes: Buffer.from(t, 'utf8'), texto: t, origem: 'xml' });
    } else {
      const b = Buffer.from(interno.replace(/\s+/g, ''), 'base64');
      const g = b[0] === 0x1f && b[1] === 0x8b;
      const conteudo = g ? zlib.gunzipSync(b) : b;
      docs.push({ indice: i++, bytes: conteudo, texto: conteudo.toString('utf8'), origem: g ? 'base64-gzip' : 'base64' });
    }
  }
  const tags = [...new Set([...texto.matchAll(/<([A-Za-z][\w]*)\b/g)].map((x) => x[1]))].slice(0, 30);
  return { bruto, texto, docs, tags };
}

/* ---------- classificação e assinatura ---------- */

export type Classe = 'nfce_completa' | 'nfe_completa_outro_modelo' | 'nota_sem_protocolo' | 'resumo' | 'evento' | 'situacao' | 'desconhecido';

export interface Classificacao { classe: Classe; chave: string | null; modelo: string | null; emitente: string | null; itens: number; protocolo: boolean; protocoloConfere: boolean; motivos: string[] }

/** Só é "NFC-e completa" com NFe/infNFe modelo 65, emitente e chave esperados, itens det e protNFe da mesma chave. */
export function classificar(xml: string, chaveEsperada: string | null, cnpjEsperado: string): Classificacao {
  const motivos: string[] = [];
  const idInf = xml.match(/<infNFe\b[^>]*\bId="NFe(\d{44})"/)?.[1] ?? null;
  if (/<(?:\w+:)?NFe\b/.test(xml) && idInf) {
    const modelo = tag(xml, 'mod');
    const emit = xml.match(/<emit>\s*<CNPJ>(\d{14})<\/CNPJ>/)?.[1] ?? null;
    const itens = (xml.match(/<det\b[^>]*nItem=/g) ?? []).length;
    const prot = /<protNFe\b/.test(xml);
    const chProt = prot ? tag(xml, 'chNFe') : null;
    const protOk = prot && chProt === idInf && /<cStat>(100|150)<\/cStat>/.test(xml.slice(xml.indexOf('<protNFe')));
    if (modelo !== '65') motivos.push(`modelo ${modelo}`);
    if (emit !== cnpjEsperado) motivos.push('emitente diferente do esperado');
    if (chaveEsperada && idInf !== chaveEsperada) motivos.push('chave diferente da pedida');
    if (!itens) motivos.push('sem itens det');
    if (!prot) motivos.push('sem protNFe');
    else if (!protOk) motivos.push('protNFe não confere com a chave ou não está autorizado (cStat 100/150)');
    const completa = modelo === '65' && emit === cnpjEsperado && (!chaveEsperada || idInf === chaveEsperada) && itens > 0 && protOk;
    return { classe: completa ? 'nfce_completa' : !prot ? 'nota_sem_protocolo' : modelo !== '65' ? 'nfe_completa_outro_modelo' : 'desconhecido', chave: idInf, modelo, emitente: emit, itens, protocolo: prot, protocoloConfere: !!protOk, motivos };
  }
  if (/<(?:\w+:)?resNFe\b/.test(xml)) return { classe: 'resumo', chave: tag(xml, 'chNFe'), modelo: null, emitente: tag(xml, 'CNPJ'), itens: 0, protocolo: false, protocoloConfere: false, motivos: ['resumo da nota (sem itens)'] };
  if (/<(?:\w+:)?(procEventoNFe|resEvento|evento)\b/.test(xml)) return { classe: 'evento', chave: tag(xml, 'chNFe'), modelo: null, emitente: null, itens: 0, protocolo: false, protocoloConfere: false, motivos: [] };
  if (/<(?:\w+:)?retConsSitNFe\b/.test(xml)) return { classe: 'situacao', chave: tag(xml, 'chNFe'), modelo: null, emitente: null, itens: 0, protocolo: false, protocoloConfere: false, motivos: ['resposta de situação, não é o documento'] };
  return { classe: 'desconhecido', chave: null, modelo: null, emitente: null, itens: 0, protocolo: false, protocoloConfere: false, motivos: ['estrutura não reconhecida'] };
}

export interface ResultadoAssinatura { presente: boolean; verificada: boolean | null; titular: string | null; erro: string | null }

/** Verifica a assinatura da NFe (Signature dentro de NFe, referência #NFe...) com o certificado do próprio XML. */
export function verificarAssinatura(xml: string): ResultadoAssinatura {
  if (!/<(?:\w+:)?Signature\b/.test(xml)) return { presente: false, verificada: null, titular: null, erro: null };
  try {
    const d = new DOMParser().parseFromString(xml, 'text/xml');
    const assinaturas = d.getElementsByTagNameNS(NS_DSIG, 'Signature');
    let alvo: any = null;
    for (let i = 0; i < assinaturas.length; i++) {
      const s: any = assinaturas[i];
      if (s.parentNode && s.parentNode.localName === 'NFe') { alvo = s; break; }
    }
    if (!alvo) return { presente: true, verificada: null, titular: null, erro: 'Signature fora de <NFe> (não é a assinatura do emitente).' };
    const x509 = alvo.getElementsByTagNameNS(NS_DSIG, 'X509Certificate')[0]?.textContent?.replace(/\s+/g, '');
    if (!x509) return { presente: true, verificada: null, titular: null, erro: 'Assinatura sem X509Certificate.' };
    const pem = `-----BEGIN CERTIFICATE-----\n${x509.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
    const titular = new crypto.X509Certificate(pem).subject.split('\n').find((l) => l.startsWith('CN='))?.slice(3) ?? null;
    const sx = new SignedXml({ publicCert: pem });
    sx.loadSignature(alvo);
    const ok = sx.checkSignature(xml);
    return { presente: true, verificada: ok, titular, erro: ok ? null : 'Assinatura não confere (digest ou valor).' };
  } catch (e) {
    return { presente: true, verificada: false, titular: null, erro: (e as Error).message };
  }
}

/** Mensagens dos códigos do manual consultado (só para orientar; o xMotivo real é sempre registrado). */
export const CODIGOS_MANUAL: Record<string, string> = {
  '117': 'nenhum DF-e localizado',
  '118': 'DF-e localizado',
  '8002': 'requisitante não é contabilista do CNPJ',
  '8003': 'ausência de autorização eletrônica',
  '8004': 'CNPJ sem vínculo com a chave',
  '632': 'documento fora do prazo',
  '656': 'consumo indevido',
};
