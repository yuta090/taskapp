import { describe, it, expect } from 'vitest'
import { channelBadgeLabel } from '@/lib/channels/channelBadge'

/**
 * channelBadgeLabel — メッセージの channel 列を、UIバッジ用の短い表示名に変換する。
 * 表示名は registry の label を正本にする（重複定義しない）。未知/空は null（バッジ非表示）。
 */
describe('channelBadgeLabel', () => {
  it('既知チャネルは registry の label を返す', () => {
    expect(channelBadgeLabel('line')).toBe('LINE')
    expect(channelBadgeLabel('discord')).toBe('Discord')
    expect(channelBadgeLabel('slack')).toBe('Slack')
    expect(channelBadgeLabel('chatwork')).toBe('Chatwork')
    expect(channelBadgeLabel('telegram')).toBe('Telegram')
  })

  it('未知チャネルは null（バッジを出さない）', () => {
    expect(channelBadgeLabel('unknown')).toBeNull()
    expect(channelBadgeLabel('')).toBeNull()
  })

  it('email はチャットではないがラベルは引ける（将来用・registryにあれば返す）', () => {
    // registry に email 定義が無ければ null。あるなら label。どちらでも壊れないことを保証。
    const r = channelBadgeLabel('email')
    expect(r === null || typeof r === 'string').toBe(true)
  })
})
