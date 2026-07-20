/**
 * 送信アダプタのディスパッチ。registry の outbound=true チャネルを実アダプタに繋ぐ。
 *
 * ここに載っていないチャネル（planned=messenger/email）は canSendTo=false として弾かれる。
 * 新チャネル追加時は registry に 1 エントリ＋ここに 1 行足すだけで送信可能になる。
 */
import type { ChannelId } from '@/lib/channels/registry'
import { getChannel } from '@/lib/channels/registry'
import type { OutboundAdapter, OutboundContext, OutboundResult } from './types'
import { lineAdapter } from './line'
import { slackAdapter } from './slack'
import { chatworkAdapter } from './chatwork'
import { telegramAdapter } from './telegram'
import { discordAdapter } from './discord'
import { googleChatAdapter } from './googleChat'
import { teamsAdapter } from './teams'
import { whatsappAdapter } from './whatsapp'

export const OUTBOUND_ADAPTERS: Partial<Record<ChannelId, OutboundAdapter>> = {
  line: lineAdapter,
  slack: slackAdapter,
  chatwork: chatworkAdapter,
  telegram: telegramAdapter,
  discord: discordAdapter,
  google_chat: googleChatAdapter,
  teams: teamsAdapter,
  whatsapp: whatsappAdapter,
}

export function getOutboundAdapter(channel: string): OutboundAdapter | null {
  const def = getChannel(channel)
  if (!def || !def.outbound) return null
  return OUTBOUND_ADAPTERS[def.id] ?? null
}

/**
 * 指定チャネルへ 1 メッセージ送信する。未対応チャネルは permanent 失敗を返す
 * （呼び出し側の配達ループが恒久失敗として扱えるように）。
 */
export async function deliverToChannel(channel: string, ctx: OutboundContext): Promise<OutboundResult> {
  const adapter = getOutboundAdapter(channel)
  if (!adapter) {
    return { ok: false, permanent: true, error: `no outbound adapter for channel: ${channel}` }
  }
  return adapter(ctx)
}

export type { OutboundContext, OutboundResult, OutboundAdapter } from './types'
