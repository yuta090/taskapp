import type { OutboundAdapter, OutboundResult } from './types'
import { classifyStatus } from './types'
import { postWebhookUrl } from './webhookUrl'
import { getAppToken, sendTeamsProactiveToChannel } from '@/lib/channels/teams/connectorClient'

/**
 * Microsoft Teams 送信アダプタ。2つの送信経路に両対応する（googleChatAdapter と同じ二経路
 * 構造。webhook_url優先・無ければplatform経路にフォールバック）:
 *   1. Incoming Webhook経路（credentials.webhook_url）: org自前の Power Automate Workflows
 *      （owner_type='org'）。既存挙動を1バイトも変えない（後方互換）。Adaptive Card を包んで送る。
 *   2. platform proactive経路: 共有Bot(owner_type='platform')はwebhook_urlを保持せず、
 *      Bot Framework Connector（sendTeamsProactiveToChannel・PR-3）で claimed グループの
 *      channel（ctx.to = external_group_id）へ能動送信する。google_chatのSA経路と異なり、
 *      per-groupの`serviceUrl`が別途要る（env静的値では表せない）ため ctx.providerContext から
 *      受け取る（PR-2でclaimed発言のたびにgroup.metadataへ保存済み・store.ts参照）。
 *
 * 許可ホスト（Workflows経路・受信先の変遷・2026-07時点）:
 *   - api.powerplatform.com  … 現行。Power Automate の HTTP/Teams webhook トリガーURLの新ドメイン
 *     （実体は <...>.environment.api.powerplatform.com）。2025-11-30 に logic.azure.com から移行。
 *   - logic.azure.com        … 旧 Workflows URL。2025-11-30 で失効済みだが移行猶予の残存URL向けに残置。
 *   - webhook.office.com      … 旧 O365 コネクタ。2026-05 に廃止済み。後方互換のためのみ残置。
 * 新規接続は必ず Power Automate Workflows（api.powerplatform.com）を使う。
 */
export const teamsAdapter: OutboundAdapter = async (ctx): Promise<OutboundResult> => {
  const url = ctx.credentials.webhook_url
  if (url) {
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

  // platform proactive経路。serviceUrlはclaim後の受信（PR-2 recordGroupMetadata）で初めて
  // group.metadataへ保存されるため、claim直後でまだ一度も受信していないグループでは無い場合が
  // ある。恒久失敗ではなく一時失敗にする（次回受信でserviceUrlが入れば送れるため・cronは
  // その回のこのグループだけスキップし、次回digestで再試行される）。
  const serviceUrl = ctx.providerContext?.serviceUrl
  if (!serviceUrl) {
    return {
      ok: false,
      permanent: false,
      error: 'teams: missing serviceUrl (group has not received any inbound message yet)',
    }
  }

  const appId = process.env.TEAMS_BOT_APP_ID
  const appPassword = process.env.TEAMS_BOT_APP_PASSWORD
  if (!appId || !appPassword) {
    // サーバー誤設定（env未設定）。orgの持ち出しではない当社側の設定待ちのため一時失敗にする
    // （route.tsのreply送信箇所と同じ思想: 500で落とさずログに残しcronを止めない）。
    return {
      ok: false,
      permanent: false,
      error: 'teams: TEAMS_BOT_APP_ID/TEAMS_BOT_APP_PASSWORD not configured',
    }
  }

  const result = await sendTeamsProactiveToChannel(
    { serviceUrl, channelId: ctx.to, text: ctx.text },
    { getToken: () => getAppToken(appId, appPassword) },
  )
  if (!result.ok) {
    // ステータスが取れていれば sinks と同じ分類ルールに従う（401/403/404等=恒久、429/5xx=一時）。
    // ステータス自体が取れない（token取得失敗・network error等）場合は保守的に一時失敗とする。
    const classification = result.status !== undefined ? classifyStatus(result.status) : { permanent: false }
    return { ok: false, permanent: classification.permanent, status: result.status, error: result.error }
  }
  return { ok: true, status: result.status, externalMessageId: result.externalMessageId }
}
