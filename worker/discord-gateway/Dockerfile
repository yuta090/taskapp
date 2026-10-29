# AI秘書 Discord受信 Gatewayワーカー（常駐WS接続 → app ingest への HMAC POST）
# Railway / Fly.io などの常駐プロセス基盤にデプロイする。単一インスタンス運用。
FROM node:20-slim AS build
WORKDIR /app
# lockfile どおりに入れる。package.json だけで解決すると、ビルドのたびに新しい版が入る
# （2026-10 に vitest 4.1.11 の依存解決で Node 20 の npm 10 が落ち、デプロイが止まった）
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
# 秘密は環境変数で注入する（イメージに焼き込まない）:
#   DISCORD_BOT_TOKEN / INGEST_URL / INGEST_HMAC_SECRET
#   任意: BATCH_MAX_SIZE(既定20) / FLUSH_INTERVAL_MS(既定2000)
CMD ["node", "dist/index.js"]
