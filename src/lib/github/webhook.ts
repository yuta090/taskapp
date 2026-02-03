// GitHub Webhook Utilities
import { createHmac, timingSafeEqual } from 'crypto'
import { GITHUB_CONFIG } from './config'

/**
 * GitHub Webhook署名を検証
 * @see https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string | null
): boolean {
  if (!signature) {
    return false
  }

  const sigHashAlg = 'sha256'
  const sigPrefix = `${sigHashAlg}=`

  if (!signature.startsWith(sigPrefix)) {
    return false
  }

  const expectedSignature = createHmac(sigHashAlg, GITHUB_CONFIG.webhookSecret)
    .update(payload)
    .digest('hex')

  const expectedBuffer = Buffer.from(`${sigPrefix}${expectedSignature}`, 'utf8')
  const receivedBuffer = Buffer.from(signature, 'utf8')

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer)
}

/**
 * Webhookイベントのヘッダーを解析
 */
export function parseWebhookHeaders(headers: Headers): {
  event: string | null
  delivery: string | null
  signature: string | null
} {
  return {
    event: headers.get('x-github-event'),
    delivery: headers.get('x-github-delivery'),
    signature: headers.get('x-hub-signature-256'),
  }
}
