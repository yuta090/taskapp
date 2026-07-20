import { describe, it, expect } from 'vitest'
import { normalizeMessage, type RawMessageLike } from '../src/normalize.js'

function msg(over: Partial<RawMessageLike> = {}): RawMessageLike {
  return {
    id: 'M1',
    content: 'こんにちは',
    guildId: 'G1',
    channelId: 'C1',
    createdAt: new Date('2026-07-20T00:00:00.000Z'),
    author: { id: 'U1', bot: false, username: 'kokyaku', globalName: 'Kokyaku', displayName: '客先担当' },
    member: { displayName: '山田(サーバー表示名)' },
    ...over,
  }
}

describe('normalizeMessage', () => {
  it('app の DiscordIngestEvent 形状に落とす', () => {
    expect(normalizeMessage(msg())).toEqual({
      type: 'message_create',
      guildId: 'G1',
      channelId: 'C1',
      messageId: 'M1',
      author: { id: 'U1', isBot: false, displayName: '山田(サーバー表示名)' },
      content: 'こんにちは',
      timestamp: '2026-07-20T00:00:00.000Z',
    })
  })

  it('表示名は member.displayName を最優先する（サーバー内ニックネーム）', () => {
    const e = normalizeMessage(msg({ member: { displayName: 'ニックネーム' } }))
    expect(e.author.displayName).toBe('ニックネーム')
  })

  it('member 無しは author.displayName → globalName → username の順にフォールバック', () => {
    expect(normalizeMessage(msg({ member: null, author: { id: 'U', bot: false, username: 'uname', globalName: 'gname', displayName: 'dname' } })).author.displayName).toBe('dname')
    expect(normalizeMessage(msg({ member: null, author: { id: 'U', bot: false, username: 'uname', globalName: 'gname' } })).author.displayName).toBe('gname')
    expect(normalizeMessage(msg({ member: null, author: { id: 'U', bot: false, username: 'uname' } })).author.displayName).toBe('uname')
  })

  it('bot 発言も正規化はする（除外は呼び出し側/handler の責務）', () => {
    const e = normalizeMessage(msg({ author: { id: 'B', bot: true, username: 'bot' } }))
    expect(e.author.isBot).toBe(true)
  })

  it('guildId 欠落(DM)は null にする', () => {
    expect(normalizeMessage(msg({ guildId: null })).guildId).toBeNull()
    expect(normalizeMessage(msg({ guildId: undefined })).guildId).toBeNull()
  })

  it('createdAt が文字列でも Date でも ISO 瞬時値に正規化', () => {
    expect(normalizeMessage(msg({ createdAt: '2026-01-02T03:04:05.000Z' })).timestamp).toBe('2026-01-02T03:04:05.000Z')
  })

  it('不正な createdAt は epoch フォールバック（NaN を投げない）', () => {
    expect(normalizeMessage(msg({ createdAt: 'not-a-date' })).timestamp).toBe('1970-01-01T00:00:00.000Z')
  })
})
