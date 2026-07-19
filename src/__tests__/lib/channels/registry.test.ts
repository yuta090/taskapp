import { describe, it, expect } from 'vitest'
import {
  CHANNELS,
  ALL_CHANNEL_IDS,
  listChannels,
  chatChannels,
  outboundChannels,
  getChannel,
  isChannelId,
  canSendTo,
} from '@/lib/channels/registry'
import { OUTBOUND_ADAPTERS } from '@/lib/channels/adapters'

describe('channel registry', () => {
  it('各定義の id はキーと一致する', () => {
    for (const [key, def] of Object.entries(CHANNELS)) {
      expect(def.id).toBe(key)
    }
  })

  it('ALL_CHANNEL_IDS は CHANNELS の全キーを重複なく含む', () => {
    const keys = Object.keys(CHANNELS).sort()
    expect([...ALL_CHANNEL_IDS].sort()).toEqual(keys)
    expect(new Set(ALL_CHANNEL_IDS).size).toBe(ALL_CHANNEL_IDS.length)
  })

  it('主要チャットが全て登録されている', () => {
    for (const id of ['line', 'slack', 'chatwork', 'google_chat', 'discord', 'telegram', 'teams', 'whatsapp']) {
      expect(getChannel(id)).not.toBeNull()
    }
  })

  it('listChannels は表示順(ALL_CHANNEL_IDS)を保つ', () => {
    expect(listChannels().map((c) => c.id)).toEqual([...ALL_CHANNEL_IDS])
  })

  it('chatChannels は email を除外する', () => {
    expect(chatChannels().some((c) => c.id === 'email')).toBe(false)
    expect(chatChannels().every((c) => c.kind === 'chat')).toBe(true)
  })

  it('outboundChannels は outbound=true のみ', () => {
    expect(outboundChannels().every((c) => c.outbound)).toBe(true)
    // messenger/email は planned で送信不可
    expect(outboundChannels().some((c) => c.id === 'messenger')).toBe(false)
    expect(outboundChannels().some((c) => c.id === 'email')).toBe(false)
  })

  it('isChannelId / canSendTo が正しく判定する', () => {
    expect(isChannelId('line')).toBe(true)
    expect(isChannelId('nope')).toBe(false)
    expect(canSendTo('slack')).toBe(true)
    expect(canSendTo('messenger')).toBe(false) // planned
    expect(canSendTo('unknown')).toBe(false)
  })

  it('outbound=true のチャネルには必ず送信アダプタが存在する（レジストリと実装の整合）', () => {
    for (const def of outboundChannels()) {
      expect(OUTBOUND_ADAPTERS[def.id], `adapter missing for ${def.id}`).toBeTypeOf('function')
    }
  })

  it('全チャネルに資格情報フィールドの定義がある（emailを除く）', () => {
    for (const def of chatChannels()) {
      expect(def.credentialFields.length).toBeGreaterThan(0)
    }
  })
})
