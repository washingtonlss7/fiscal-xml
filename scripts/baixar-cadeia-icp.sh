#!/usr/bin/env sh
# Baixa as ACs da ICP-Brasil (repositório oficial do ITI) e gera um único arquivo PEM.
# Usado no build do Docker; também pode ser rodado à mão:  sh scripts/baixar-cadeia-icp.sh ./certs/icp-brasil.pem
set -e
DESTINO="${1:-/app/certs/icp-brasil.pem}"
URL="${ICP_ZIP_URL:-https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip}"
TMP="$(mktemp -d)"
mkdir -p "$(dirname "$DESTINO")"

if ! curl -fsSL --max-time 120 "$URL" -o "$TMP/ac.zip"; then
  echo "AVISO: não foi possível baixar a cadeia ICP-Brasil de $URL. O coletor vai usar só as raízes padrão." >&2
  : > "$DESTINO"
  exit 0
fi

unzip -qo "$TMP/ac.zip" -d "$TMP/ac"
: > "$DESTINO"
find "$TMP/ac" -type f \( -iname '*.crt' -o -iname '*.cer' -o -iname '*.pem' \) | while read -r f; do
  openssl x509 -in "$f" -inform DER -outform PEM 2>/dev/null >> "$DESTINO" \
    || openssl x509 -in "$f" -outform PEM 2>/dev/null >> "$DESTINO" \
    || true
done
echo "Cadeia ICP-Brasil gravada em $DESTINO ($(grep -c 'BEGIN CERTIFICATE' "$DESTINO") certificados)."
rm -rf "$TMP"
