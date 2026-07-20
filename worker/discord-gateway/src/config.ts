/**
 * worker の環境設定。秘密は 3 つだけ（bot_token / ingest_url / ingest_secret）。
 * app の DB/Supabase 資格情報は持たせない（worker は運搬役・最小権限）。
 * 必須が欠けたら fail-closed で throw（誤設定のまま起動して黙って取りこぼさない）。
 */
export interface WorkerConfig {
  botToken: string
  ingestUrl: string
  ingestSecret: string
  /** バッファがこの件数に達したら即 flush。既定 20。 */
  batchMaxSize: number
  /** 定期 flush 間隔(ms)。既定 2000。 */
  flushIntervalMs: number
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

export function loadConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const botToken = env.DISCORD_BOT_TOKEN ?? ''
  const ingestUrl = env.INGEST_URL ?? ''
  const ingestSecret = env.INGEST_HMAC_SECRET ?? ''

  const missing: string[] = []
  if (!botToken) missing.push('DISCORD_BOT_TOKEN')
  if (!ingestUrl) missing.push('INGEST_URL')
  if (!ingestSecret) missing.push('INGEST_HMAC_SECRET')
  if (missing.length > 0) {
    throw new Error(`discord-gateway worker: missing required env: ${missing.join(', ')}`)
  }

  return {
    botToken,
    ingestUrl,
    ingestSecret,
    batchMaxSize: parsePositiveInt(env.BATCH_MAX_SIZE, 20),
    flushIntervalMs: parsePositiveInt(env.FLUSH_INTERVAL_MS, 2000),
  }
}
