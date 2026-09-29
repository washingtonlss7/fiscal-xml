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
 && apt-get install -y --no-install-recommends ca-certificates curl unzip openssl tzdata \
 && rm -rf /var/lib/apt/lists/*

COPY scripts ./scripts
RUN sh scripts/baixar-cadeia-icp.sh /app/certs/icp-brasil.pem \
 && mkdir -p /app/backup && chown node:node /app/backup

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
COPY dados ./dados
COPY package.json ./

USER node
# O mesmo imagem serve o coletor (padrão) e o painel: node dist/painel/server.js
CMD ["node", "dist/worker.js"]
