#!/usr/bin/env python3
"""
Sanitiza um arquivo HAR antes de enviá-lo (Fase 2 do NFC-e Worker).

Mantém: URLs (sem valores de parâmetros sensíveis), métodos, status, nomes de campos, tipos de conteúdo e a
estrutura das páginas. Mascara: cookies, cabeçalhos de autenticação, tokens, senhas, ViewState/EventValidation,
CPF/CNPJ completos, e-mails, e qualquer campo cujo NOME pareça segredo. Não remove nada que permita entender o fluxo.

Uso:
    python3 sanitizar-har.py entrada.har saida-sanitizada.har

Depois de rodar, ABRA o arquivo de saída e procure (Ctrl+F) por: sua senha, seu CPF, "senha", "password",
"token", "cookie". Se algo aparecer, não envie: avise para ajustarmos o script.
Nunca envie o certificado (.pfx) nem a senha dele.
"""
import json
import re
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

MASCARA = '***'
# Cabeçalhos que sempre carregam sessão/credencial
CABECALHOS = {'cookie', 'set-cookie', 'authorization', 'proxy-authorization', 'x-csrf-token', 'x-xsrf-token',
              'x-auth-token', 'x-api-key', 'x-requestverificationtoken', 'requestverificationtoken'}
# Nomes de campos (formulário, query string, JSON) que parecem segredo
SEGREDO = re.compile(r'(senha|password|passwd|pwd|pass\b|token|secret|segredo|session|sessao|sessão|sid\b|jsessionid|'
                     r'aspsessionid|asp\.net_sessionid|auth|cookie|csrf|xsrf|viewstate|eventvalidation|captcha|otp|pin\b|'
                     r'certificado|pfx|chave_privada|private)', re.I)
CPF_CNPJ = re.compile(r'(?<!\d)(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2})(?!\d)')
EMAIL = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')
JWT = re.compile(r'eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{5,}')
LONGO = re.compile(r'(?<![\w/])[A-Za-z0-9+/=_-]{60,}(?![\w/])')  # blobs (tokens, viewstate) soltos no texto


def limpar_texto(s):
    if not isinstance(s, str):
        return s
    s = JWT.sub(MASCARA, s)
    s = EMAIL.sub('***@***', s)
    # CPF/CNPJ: mantém só os 4 primeiros dígitos (dá para saber de quem é sem expor o número inteiro)
    s = CPF_CNPJ.sub(lambda m: m.group(0)[:4] + re.sub(r'\d', '*', m.group(0)[4:]), s)
    return s


def limpar_par(nome, valor):
    if SEGREDO.search(nome or ''):
        return MASCARA
    return limpar_texto(valor)


def limpar_url(url):
    try:
        p = urlsplit(url)
    except ValueError:
        return limpar_texto(url)
    q = urlencode([(k, limpar_par(k, v)) for k, v in parse_qsl(p.query, keep_blank_values=True)], safe='*@')
    return urlunsplit((p.scheme, p.netloc, limpar_texto(p.path), q, ''))


def limpar_json(o):
    if isinstance(o, dict):
        return {k: (MASCARA if SEGREDO.search(k) else limpar_json(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [limpar_json(x) for x in o]
    return limpar_texto(o)


def limpar_corpo(texto, mime):
    if not texto:
        return texto
    mime = (mime or '').lower()
    if 'json' in mime:
        try:
            return json.dumps(limpar_json(json.loads(texto)), ensure_ascii=False)
        except ValueError:
            pass
    if 'x-www-form-urlencoded' in mime:
        return urlencode([(k, limpar_par(k, v)) for k, v in parse_qsl(texto, keep_blank_values=True)], safe='*@')
    # HTML: mascara value="" de inputs sensíveis (senha, viewstate, tokens) e blobs longos
    texto = re.sub(r'(<input[^>]*?(?:name|id)\s*=\s*["\']([^"\']*)["\'][^>]*?value\s*=\s*["\'])([^"\']*)(["\'])',
                   lambda m: m.group(1) + (MASCARA if SEGREDO.search(m.group(2)) or 'password' in m.group(0).lower() else m.group(3)) + m.group(4),
                   texto, flags=re.I)
    texto = re.sub(r'(<input[^>]*?value\s*=\s*["\'])([^"\']*)(["\'][^>]*?(?:name|id)\s*=\s*["\']([^"\']*)["\'])',
                   lambda m: m.group(1) + (MASCARA if SEGREDO.search(m.group(4)) or 'password' in m.group(0).lower() else m.group(2)) + m.group(3),
                   texto, flags=re.I)
    texto = LONGO.sub(MASCARA, texto)
    return limpar_texto(texto)


def limpar_entrada(e):
    req, resp = e.get('request', {}), e.get('response', {})
    for r in (req, resp):
        r['headers'] = [{'name': h.get('name'), 'value': MASCARA if (h.get('name', '').lower() in CABECALHOS or SEGREDO.search(h.get('name', ''))) else limpar_texto(h.get('value'))}
                        for h in r.get('headers', [])]
        r['cookies'] = [{'name': c.get('name'), 'value': MASCARA} for c in r.get('cookies', [])]
    req['url'] = limpar_url(req.get('url', ''))
    req['queryString'] = [{'name': q.get('name'), 'value': limpar_par(q.get('name'), q.get('value'))} for q in req.get('queryString', [])]
    pd = req.get('postData')
    if pd:
        if pd.get('params'):
            pd['params'] = [{**p, 'value': limpar_par(p.get('name'), p.get('value'))} for p in pd['params']]
        pd['text'] = limpar_corpo(pd.get('text'), pd.get('mimeType'))
    if resp.get('redirectURL'):
        resp['redirectURL'] = limpar_url(resp['redirectURL'])
    c = resp.get('content', {})
    if c.get('text'):
        if c.get('encoding') == 'base64':
            c['text'] = '[binário removido]'
            c.pop('encoding', None)
        else:
            c['text'] = limpar_corpo(c['text'], c.get('mimeType'))[:200_000]
    # Certificado de cliente / conexão TLS: não interessa e pode identificar a máquina
    e.pop('_securityDetails', None)
    e.pop('serverIPAddress', None)
    return e


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    with open(sys.argv[1], encoding='utf-8-sig') as f:
        har = json.load(f)
    log = har.get('log', {})
    log['entries'] = [limpar_entrada(e) for e in log.get('entries', [])]
    for p in log.get('pages', []):
        p['title'] = limpar_url(p.get('title', ''))
    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        json.dump(har, f, ensure_ascii=False, indent=1)
    print(f'OK: {len(log["entries"])} requisições sanitizadas em {sys.argv[2]}. Confira o arquivo antes de enviar.')


if __name__ == '__main__':
    main()
