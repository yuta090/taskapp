import { describe, it, expect } from 'vitest'
import { PRIMARY_AUTHOR, isKnownAuthorName } from '@/lib/task6/authors'

/**
 * TASK6 著者情報（E-E-A-T）
 * - 表示名「高橋ゆうこ」・登記名「高橋木綿子」の両表記で同一人物として扱う
 * - プロフィールは事実のみ（bio・肩書き・裏付けURLが欠けていないこと）
 */

describe('PRIMARY_AUTHOR', () => {
  it('表示名は高橋ゆうこ・登記名は高橋木綿子', () => {
    expect(PRIMARY_AUTHOR.name).toBe('高橋ゆうこ')
    expect(PRIMARY_AUTHOR.legalName).toBe('高橋木綿子')
  })

  it('肩書き・経歴・裏付けURLが埋まっている', () => {
    expect(PRIMARY_AUTHOR.title).toContain('ソレカラ')
    expect(PRIMARY_AUTHOR.bio.length).toBeGreaterThanOrEqual(2)
    for (const para of PRIMARY_AUTHOR.bio) {
      expect(para.length).toBeGreaterThan(0)
    }
    expect(PRIMARY_AUTHOR.sameAs).toContain('https://skara.co.jp/company')
  })
})

describe('isKnownAuthorName', () => {
  it('表示名・登記名のどちらでもtrue', () => {
    expect(isKnownAuthorName('高橋ゆうこ')).toBe(true)
    expect(isKnownAuthorName('高橋木綿子')).toBe(true)
  })

  it('別名・空・null はfalse', () => {
    expect(isKnownAuthorName('山田太郎')).toBe(false)
    expect(isKnownAuthorName('')).toBe(false)
    expect(isKnownAuthorName(null)).toBe(false)
    expect(isKnownAuthorName(undefined)).toBe(false)
  })
})
