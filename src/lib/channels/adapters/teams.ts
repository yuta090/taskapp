import type { OutboundAdapter } from './types'
import { missingCredential } from './types'
import { postWebhookUrl } from './webhookUrl'

/**
 * Microsoft Teams 送信アダプタ（Incoming Webhook）。
 * Adaptive Card を包んで送る（新方式 Workflows / 旧経路の双方で解釈可能）。
 *
 * 許可ホスト（受信先の変遷・2026-07時点）:
 *   - api.powerplatform.com  … 現行。Power Automate の HTTP/Teams webhook トリガーURLの新ドメイン
 *     （実体は <...>.environment.api.powerplatform.com）。2025-11-30 に logic.azure.com から移行。
 *   - logic.azure.com        … 旧 Workflows URL。2025-11-30 で失効済みだが移行猶予の残存URL向けに残置。
 *   - webhook.office.com      … 旧 O365 コネクタ。2026-05 に廃止済み。後方互換のためのみ残置。
 * 新規接続は必ず Power Automate Workflows（api.powerplatform.com）を使う。
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
    allowedHostSuffixes: ['api.powerplatform.com', 'logic.azure.com', 'webhook.office.com'],
    payload,
    label: 'teams',
  })
}
