import type { OutboundAdapter } from './types'
import { missingCredential } from './types'
import { postWebhookUrl } from './webhookUrl'

/**
 * Google Chat 送信アダプタ（スペースの Incoming Webhook）。
 * ペイロードは {text}。webhook_url は chat.googleapis.com のみ許可。
 */
export const googleChatAdapter: OutboundAdapter = async (ctx) => {
  const url = ctx.credentials.webhook_url
  if (!url) return missingCredential('webhook_url')

  return postWebhookUrl({
    url,
    allowedHostSuffixes: ['chat.googleapis.com'],
    payload: { text: ctx.text },
    label: 'google_chat',
  })
}
