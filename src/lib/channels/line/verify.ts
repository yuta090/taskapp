import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * LINE Messaging API webhook 署名検証。
 * x-line-signature = base64(HMAC-SHA256(channel secret, request raw body))
 *
 * 生ボディ文字列に対して検証する（JSON.parse 後の再シリアライズは不可）。
 */
export function verifyLineSignature(
  rawBody: string,
  signature: string | null,
  channelSecret: string,
): boolean {
  if (!signature || !channelSecret) return false

  const expected = createHmac('sha256', channelSecret).update(rawBody).digest()

  let provided: Buffer
  try {
    provided = Buffer.from(signature, 'base64')
  } catch {
    return false
  }

  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}
