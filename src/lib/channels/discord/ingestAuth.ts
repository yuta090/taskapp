/**
 * Discord 受信ワーカー → app の内部 ingest エンドポイントの認証（HMAC-SHA256）。
 *
 * このエンドポイントは実質「service role への公開入口」（取り込みで channel_messages に書く）なので、
 * 認証は静的 Bearer ではなくリプレイ耐性のある HMAC にする（Slack v0 / GitHub webhook と同型）。
 *   署名対象 = `${timestamp}.${rawBody}` を INGEST_HMAC_SECRET で HMAC-SHA256(hex)。
 *   ヘッダ = x-ingest-timestamp / x-ingest-signature。許容スキュー ±5分。定数時間比較。
 *   secret 未設定は fail-closed で throw（空鍵＝誰でも計算可能な既知鍵を黙って受け入れない）。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

const SKEW_SEC = 300

/** worker と app が同一に計算する署名（テスト・worker 実装の基準） */
export function signIngestPayload(rawBody: string, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function verifyIngestSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null,
  secret: string,
  nowSeconds: number,
): boolean {
  // fail-closed: 空/未設定の secret は例外（既知鍵で黙って通さない）
  if (!secret) {
    throw new Error('INGEST_HMAC_SECRET is not configured')
  }
  if (!timestamp || !signature) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > SKEW_SEC) return false
  const expected = signIngestPayload(rawBody, timestamp, secret)
  return safeEqualHex(expected, signature)
}
