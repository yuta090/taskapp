import type { OutboundAdapter } from './types'
import { missingCredential } from './types'
import { postWebhookUrl } from './webhookUrl'

/**
 * Discord 送信アダプタ（Channel Webhook）。
 * `to` はグループ選択で解決される表示用の識別子で、実送信先はcredentials.webhook_url。
 * 本文は content（2000文字上限）に載せる。
 */
const DISCORD_MAX = 2000

export const discordAdapter: OutboundAdapter = async (ctx) => {
  const url = ctx.credentials.webhook_url
  if (!url) return missingCredential('webhook_url')

  const content = ctx.text.length > DISCORD_MAX ? ctx.text.slice(0, DISCORD_MAX - 1) + '…' : ctx.text

  return postWebhookUrl({
    url,
    allowedHostSuffixes: ['discord.com', 'discordapp.com'],
    payload: { content },
    label: 'discord',
  })
}
