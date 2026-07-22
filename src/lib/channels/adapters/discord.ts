import type { OutboundAdapter, OutboundResult } from './types'
import { missingCredential, classifyStatus } from './types'
import { postWebhookUrl } from './webhookUrl'
import { sendDiscordChannelMessage } from '@/lib/channels/discord/client'

/**
 * Discord 送信アダプタ。2つの送信経路に両対応する:
 *   1. 共有Bot経路（credentials.bot_token）: 共有Bot(owner_type='platform')はこちらのみ
 *      保持する（docs/setup/DISCORD_GATEWAY_PROVISIONING.md L42-48・webhook_urlは持たない）。
 *      REST `POST /channels/{id}/messages` で送る（sendDiscordChannelMessage）。
 *   2. Webhook経路（credentials.webhook_url）: orgが自前で発行したチャンネルWebhook。
 * 優先順位は bot_token → webhook_url（bot_token があれば共有Bot経路を優先。org専有botで
 * webhook_urlも併存するケースは無い想定だが、両方あればbot_token側を使う）。
 * `to` はいずれの経路でもDiscordのchannelId（channel_groups.external_group_id、
 * ingestHandlerの契約）。bot_token経路はREST応答のmessageIdをexternalMessageIdに載せる
 * （provider_message_id保存の下地・将来の返信突合に使う）。
 */
const DISCORD_MAX = 2000

export const discordAdapter: OutboundAdapter = async (ctx): Promise<OutboundResult> => {
  const botToken = ctx.credentials.bot_token
  const webhookUrl = ctx.credentials.webhook_url

  if (botToken) {
    const result = await sendDiscordChannelMessage(botToken, ctx.to, ctx.text)
    if (!result.ok) {
      if (typeof result.status === 'number') {
        return {
          ok: false,
          status: result.status,
          ...classifyStatus(result.status),
          error: `discord http ${result.status}`,
        }
      }
      return { ok: false, permanent: false, error: 'discord network error' }
    }
    return { ok: true, status: result.status, externalMessageId: result.messageId }
  }

  if (webhookUrl) {
    const content = ctx.text.length > DISCORD_MAX ? ctx.text.slice(0, DISCORD_MAX - 1) + '…' : ctx.text
    return postWebhookUrl({
      url: webhookUrl,
      allowedHostSuffixes: ['discord.com', 'discordapp.com'],
      payload: { content },
      label: 'discord',
    })
  }

  return missingCredential('bot_token or webhook_url')
}
