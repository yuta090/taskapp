import { getChannel } from '@/lib/channels/registry'

/**
 * メッセージの channel 列（'line'|'discord'|…）を、UIバッジ用の短い表示名に変換する。
 * 表示名の正本は registry の label（重複定義しない）。未知/空は null＝バッジを出さない。
 *
 * 用途: 秘書コンソールのタイムラインは space 単位で全チャネルを混在表示するため、
 * 各メッセージがどのチャット（LINE/Discord等）由来かを一目で分かるようにする。
 */
export function channelBadgeLabel(channel: string | null | undefined): string | null {
  if (!channel) return null
  return getChannel(channel)?.label ?? null
}
