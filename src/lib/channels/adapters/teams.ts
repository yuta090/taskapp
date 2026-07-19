import type { OutboundAdapter } from './types'
import { missingCredential } from './types'
import { postWebhookUrl } from './webhookUrl'

/**
 * Microsoft Teams 送信アダプタ（Incoming Webhook）。
 * 新方式(Workflows)/旧O365コネクタの双方で解釈できるよう Adaptive Card を包んで送る。
 * 許可ホスト: webhook.office.com（旧）/ logic.azure.com（Workflows）/ powerplatform 系。
 */
export const teamsAdapter: OutboundAdapter = async (ctx) => {
  const url = ctx.credentials.webhook_url
  if (!url) return missingCredential('webhook_url')

  const payload = {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [{ type: 'TextBlock', text: ctx.text, wrap: true }],
        },
      },
    ],
  }

  return postWebhookUrl({
    url,
    allowedHostSuffixes: ['webhook.office.com', 'logic.azure.com', 'azure.com'],
    payload,
    label: 'teams',
  })
}
