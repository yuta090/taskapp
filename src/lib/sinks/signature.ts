import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Webhook署名（Stripe/Slack同型。AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-3）:
 *   X-AgentPM-Signature: t=<unix秒>,v1=<hex(hmac_sha256(secret, t + "." + body))>
 * 署名フォーマットは顧客の受信実装が依存する不可逆仕様。変更する場合はv2併記方式にすること。
 */

const REPLAY_WINDOW_SECONDS = 5 * 60

export function signSinkPayload(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function buildSignatureHeader(
  secret: string,
  body: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const v1 = signSinkPayload(secret, timestampSeconds, body)
  return `t=${timestampSeconds},v1=${v1}`
}

export type VerifySignatureResult =
  | { ok: true }
  | { ok: false; reason: 'malformed_header' | 'timestamp_out_of_window' | 'signature_mismatch' }

const HEADER_PATTERN = /^t=(\d+),v1=([0-9a-f]+)$/

/**
 * 受信側（顧客のwebhookエンドポイント）向けの参照実装。
 * dispatcher自体はこれを使わないが、公開ドキュメントに掲載する検証コードの正本として維持する。
 */
export function verifySinkSignature(
  secret: string,
  body: string,
  header: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): VerifySignatureResult {
  const match = HEADER_PATTERN.exec(header)
  if (!match) return { ok: false, reason: 'malformed_header' }

  const timestamp = Number(match[1])
  const providedSignature = match[2]

  if (Math.abs(nowSeconds - timestamp) > REPLAY_WINDOW_SECONDS) {
    return { ok: false, reason: 'timestamp_out_of_window' }
  }

  const expected = signSinkPayload(secret, timestamp, body)
  const expectedBuf = Buffer.from(expected, 'hex')
  const providedBuf = Buffer.from(providedSignature, 'hex')
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: 'signature_mismatch' }
  }

  return { ok: true }
}
