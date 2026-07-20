/**
 * Discord Gateway 常駐ワーカー（PR3・Fable設計の第3段）。
 *
 * discord.js の Gateway(WebSocket) で共有プラットフォームBotのメッセージを受け、正規化して
 * app の内部 ingest エンドポイントへ HMAC 付きで POST する。Discord は受信を HTTP webhook で
 * 取れない（Message Content Intent が要る＝常駐 WS 接続が必須）ため、この薄い運搬プロセスを置く。
 *
 * 責務は「受ける・正規化する・運ぶ・落とさない」だけ。帰属/claim/課金ゲートは全て app 側。
 * 起動には bot_token / ingest_url / ingest_secret の 3 つだけ（DB 資格情報は持たない）。
 *
 * デプロイ: Railway / Fly.io（Dockerfile 同梱）。単一インスタンス運用を前提（多重起動すると
 * 同一メッセージを二重 POST するが、downstream が snowflake で dedupe するため実害は無い）。
 */
import {
  Client,
  Events,
  GatewayIntentBits,
  type Message,
  type OmitPartialGroupDMChannel,
} from 'discord.js'
import { loadConfig } from './config.js'
import { normalizeMessage, type IngestEvent, type RawMessageLike } from './normalize.js'
import { postIngestBatch } from './ingestClient.js'

const config = loadConfig(process.env)

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged: 100サーバー未満は審査不要（プロビジョニングdoc参照）
  ],
})

// 送信待ちバッファ。flush 失敗時は先頭へ戻して次回再送する（落とさない）。
const buffer: IngestEvent[] = []
let flushing = false

client.on(Events.MessageCreate, (msg: OmitPartialGroupDMChannel<Message>) => {
  try {
    // 第1層フィルタ（app 側 handler も多層で弾く）: 自己/他bot は取り込まない。
    if (msg.author?.bot) return
    // グループ運用のみ対象。DM（guild 無し）は拾わない。
    if (!msg.guildId) return
    buffer.push(normalizeMessage(msg as unknown as RawMessageLike))
    if (buffer.length >= config.batchMaxSize) void flush()
  } catch (err) {
    console.error('[discord-gateway] normalize failed', err)
  }
})

async function flush(): Promise<void> {
  if (flushing || buffer.length === 0) return
  flushing = true
  const batch = buffer.splice(0, buffer.length)
  try {
    const res = await postIngestBatch(batch, {
      url: config.ingestUrl,
      secret: config.ingestSecret,
    })
    if (!res.ok) {
      // 恒久4xx(401/400)も含め、失敗分は戻して次回再送（順序は厳密でなくてよい・downstream dedupe）。
      // 401 が続くなら鍵誤設定なので運用が気づけるようログを残す。
      buffer.unshift(...batch)
      console.error(`[discord-gateway] ingest post failed status=${res.status} attempts=${res.attempts}`)
    }
  } catch (err) {
    buffer.unshift(...batch)
    console.error('[discord-gateway] ingest post threw', err)
  } finally {
    flushing = false
  }
}

const flushTimer = setInterval(() => void flush(), config.flushIntervalMs)

client.once(Events.ClientReady, (c) => {
  console.log(`[discord-gateway] ready as ${c.user.tag} (batchMax=${config.batchMaxSize}, flushMs=${config.flushIntervalMs})`)
})

function shutdown(signal: string): void {
  console.log(`[discord-gateway] ${signal} received, flushing and shutting down`)
  clearInterval(flushTimer)
  void flush().finally(() => {
    void client.destroy()
    process.exit(0)
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

void client.login(config.botToken)
