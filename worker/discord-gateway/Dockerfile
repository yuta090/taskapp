# AI秘書 Discord受信 Gatewayワーカー（常駐WS接続 → app ingest への HMAC POST）
# Railway / Fly.io などの常駐プロセス基盤にデプロイする。単一インスタンス運用。
FROM node:20-slim AS build
WORKDIR /app
COPY package.json ./
# lockfile はコミット後に COPY 対象へ追加する（現状は package.json のみで解決）
RUN npm install --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# 秘密は環境変数で注入する（イメージに焼き込まない）:
#   DISCORD_BOT_TOKEN / INGEST_URL / INGEST_HMAC_SECRET
#   任意: BATCH_MAX_SIZE(既定20) / FLUSH_INTERVAL_MS(既定2000)
CMD ["node", "dist/index.js"]
