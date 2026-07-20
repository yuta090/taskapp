# Discord Gateway ワーカー（AI秘書 Discord受信）

AI秘書の「つなぐ先」に Discord を追加するための**常駐プロセス**。Discord はメッセージ受信を
HTTP webhook で取得できず、`Message Content Intent`（privileged）付きの Gateway(WebSocket)
接続が必要なため、この薄い運搬プロセスを別デプロイで置く。

```
Discord ──(Gateway/WS)──> [このワーカー] ──(HTTPS + HMAC)──> app: POST /api/channels/discord/ingest
                                                              └ 帰属/claim償還/課金ゲートは app 側
```

## 責務（運搬だけ）
- `messageCreate` を受け、`normalizeMessage` で app の `DiscordIngestEvent` 形状へ正規化。
- 自己/他bot・DM（guild 無し）は第1層で除外（app 側 handler も多層で弾く）。
- バッファして `POST /api/channels/discord/ingest` へ HMAC 付きで送る。
- 失敗（5xx/429/ネットワーク）は指数バックオフで再送。恒久4xx（401/400）は即中断しログ。
- **落とさない**: flush 失敗分はバッファに戻す。重複は downstream が snowflake で dedupe。

DB/Supabase 資格情報は**持たない**（最小権限）。秘密は `DISCORD_BOT_TOKEN` /
`INGEST_URL` / `INGEST_HMAC_SECRET` の3つだけ。

## セットアップ
1. Discord Developer Portal で共有プラットフォームBotを作成し、`Message Content Intent` を有効化。
   Bot をサーバーに招待（`Read Messages/View Channels` + `Send Messages` 権限）。
2. app 側の共有Bot `channel_accounts(platform, channel='discord')` 行をプロビジョニング
   （手順は `docs/setup/DISCORD_GATEWAY_PROVISIONING.md`）。app 環境に
   `DISCORD_INGEST_HMAC_SECRET` を設定。
3. このワーカーに `.env`（`.env.example` 参照）を用意。`INGEST_HMAC_SECRET` は app と同一値。

## 開発
```bash
npm install
npm test          # vitest（normalize / ingestClient / config）
npm run typecheck
npm run build && npm start
```

## デプロイ（Railway / Fly.io）
- 同梱の `Dockerfile` で常駐プロセスとして起動。**単一インスタンス**運用を推奨
  （多重起動は同一メッセージを二重POSTするが、downstream dedupe で実害なし）。
- 環境変数で秘密を注入（イメージに焼き込まない）。
- Fly: `fly launch --dockerfile Dockerfile`（`min_machines_running = 1`・常時起動）。
- Railway: リポジトリのこのディレクトリを root に指定してデプロイ。

## テスト方針
`normalize` / `ingestClient` / `config` は discord.js に依存しない純ロジックとして切り出し、
Vitest で網羅する（署名は app 側 `ingestAuth` と同一契約であることを検証）。`index.ts`（discord.js
配線）は結合部のため統合確認に委ねる。
