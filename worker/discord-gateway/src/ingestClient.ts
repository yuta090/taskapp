/**
 * app の内部 ingest エンドポイント（POST /api/channels/discord/ingest）への HMAC 付き送信。
 *
 * ★署名契約は app 側 src/lib/channels/discord/ingestAuth.ts と厳密に一致させること:
 *   signature = HMAC-SHA256(`${timestamp}.${rawBody}`, INGEST_HMAC_SECRET) を hex。
 *   ヘッダ = x-ingest-timestamp（unix秒）/ x-ingest-signature（hex）。許容スキュー ±5分。
 *
 * 再送方針: ネットワーク障害・5xx・429 は指数バックオフで再送（メッセージを落とさない）。
 *   4xx（署名不一致=401 / 不正JSON=400 等）は再送しても直らないので即中断（無限再送を避ける）。
 *   downstream は externalMessageId(snowflake) で dedupe するため、再送での重複は吸収される。
 */
import { createHmac } from 'node:crypto'
import type { IngestEvent } from './normalize.js'

/** app 側 signIngestPayload と同一計算（契約の単一定義）。 */
export function signIngestPayload(rawBody: string, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

export interface PostIngestDeps {
  url: string
  secret: string
  /** 現在時刻(ms)。テスト注入用。既定 Date.now。 */
  now?: () => number
  fetchImpl?: typeof fetch
  /** 最大再送回数（初回を除く）。既定 5。 */
  maxRetries?: number
  backoffMs?: (attempt: number) => number
  sleep?: (ms: number) => Promise<void>
}

export interface PostIngestResult {
  ok: boolean
  status: number
  attempts: number
}

export async function postIngestBatch(
  events: IngestEvent[],
  deps: PostIngestDeps,
): Promise<PostIngestResult> {
  if (events.length === 0) return { ok: true, status: 0, attempts: 0 }

  const fetchImpl = deps.fetchImpl ?? fetch
  const nowMs = deps.now ?? (() => Date.now())
  const maxRetries = deps.maxRetries ?? 5
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const backoff = deps.backoffMs ?? ((n: number) => Math.min(30_000, 500 * 2 ** n))

  const rawBody = JSON.stringify({ events })

  let attempt = 0
  let lastStatus = 0
  while (attempt <= maxRetries) {
    // 署名は毎回作り直す（再送でも timestamp を許容スキュー内に保つ）。
    const timestamp = String(Math.floor(nowMs() / 1000))
    const signature = signIngestPayload(rawBody, timestamp, deps.secret)
    try {
      const res = await fetchImpl(deps.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ingest-timestamp': timestamp,
          'x-ingest-signature': signature,
        },
        body: rawBody,
      })
      lastStatus = res.status
      if (res.status >= 200 && res.status < 300) {
        return { ok: true, status: res.status, attempts: attempt + 1 }
      }
      // 4xx（429 を除く）は恒久エラー＝再送で直らない。無限再送を避けて即中断。
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return { ok: false, status: res.status, attempts: attempt + 1 }
      }
      // それ以外（5xx / 429）は一時的とみなし再送へ。
    } catch {
      // ネットワーク例外は一時的として再送へ。
    }

    attempt += 1
    if (attempt <= maxRetries) await sleep(backoff(attempt))
  }
  return { ok: false, status: lastStatus, attempts: attempt }
}
