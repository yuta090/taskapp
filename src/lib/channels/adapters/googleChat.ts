import type { OutboundAdapter, OutboundResult } from './types'
import { postWebhookUrl } from './webhookUrl'
import { sendChatMessage } from '@/lib/channels/google-chat/client'

/**
 * Google Chat 送信アダプタ。2つの送信経路に両対応する:
 *   1. Incoming Webhook経路（credentials.webhook_url）: orgが自前で発行したスペースWebhook
 *      （owner_type='org'）。既存挙動を1バイトも変えない（後方互換）。
 *   2. SA(サービスアカウント)経路: 共有Bot(owner_type='platform')はwebhook_urlを保持せず
 *      env `GOOGLE_CHAT_SA_KEY` によるSA認証で送る（sendChatMessage・PR-f）。`ctx.to` は
 *      宛先スペース名（`spaces/XXX` = claimed group の external_group_id）。
 * webhook_url優先。webhook_urlが無ければSA経路にフォールバックする
 * （platformアカウントはSAが正・「拾い→報告」の報告が届かない穴を塞ぐ）。
 *
 * sendChatMessage は例外を投げず messageName:null で失敗を表す設計（client.ts内で
 * env欠落・HTTPエラー・network errorを全て握りつぶす）。ここではHTTPステータスを取得できず
 * 恒久/一時を判別できないため、保守的に一時失敗（permanent:false・再試行余地あり）として扱う
 * （念のため呼び出し自体が例外を投げるケースにもtry/catchで備え、route/cronを落とさない）。
 */
export const googleChatAdapter: OutboundAdapter = async (ctx): Promise<OutboundResult> => {
  const url = ctx.credentials.webhook_url
  if (url) {
    return postWebhookUrl({
      url,
      allowedHostSuffixes: ['chat.googleapis.com'],
      payload: { text: ctx.text },
      label: 'google_chat',
    })
  }

  try {
    const result = await sendChatMessage(ctx.to, ctx.text)
    if (!result.messageName) {
      return { ok: false, permanent: false, error: 'google_chat: SA send failed' }
    }
    return { ok: true, externalMessageId: result.messageName }
  } catch (e) {
    return { ok: false, permanent: false, error: `google_chat: SA send error: ${(e as Error).message}` }
  }
}
