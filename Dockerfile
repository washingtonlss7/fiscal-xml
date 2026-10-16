FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    TZ=America/Sao_Paulo \
    SEFAZ_CA_FILE=/app/certs/icp-brasil.pem

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl unzip openssl tzdata libxml2-utils \
 && rm -rf /var/lib/apt/lists/*

COPY scripts ./scripts
RUN sh scripts/baixar-cadeia-icp.sh /app/certs/icp-brasil.pem \
 && mkdir -p /app/backup && chown node:node /app/backup

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
COPY dados ./dados
# Cadeia ICP-Brasil: o pacote oficial do ITI (ACcompactado.zip) já convertido para PEM fica no projeto
# (dados/icp-brasil.pem). Se o download do build falhar (arquivo vazio), usa o do projeto; se der certo, junta os dois.
RUN if [ -s /app/certs/icp-brasil.pem ]; then cat /app/dados/icp-brasil.pem >> /app/certs/icp-brasil.pem; \
    else cp /app/dados/icp-brasil.pem /app/certs/icp-brasil.pem; fi \
 && echo "Cadeia ICP-Brasil: $(grep -c 'BEGIN CERTIFICATE' /app/certs/icp-brasil.pem) certificados"
COPY package.json ./

USER node
# O mesmo imagem serve o coletor (padrão) e o painel: node dist/painel/server.js
CMD ["node", "dist/worker.js"]
