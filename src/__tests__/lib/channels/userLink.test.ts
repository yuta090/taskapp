import { describe, it, expect } from 'vitest'
import {
  generateUserLinkCode,
  hashUserLinkCode,
  normalizeUserLinkCode,
  looksLikeUserLinkCode,
  maskUserLinkCode,
  USER_LINK_CODE_MASK,
} from '@/lib/channels/userLink'

describe('generateUserLinkCode', () => {
  it('TA- プレフィックス + Crockford Base32 26文字を返す', () => {
    const code = generateUserLinkCode()
    expect(code).toMatch(/^TA-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/)
  })

  it('紛らわしい文字(I/L/O/U)を含まない', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateUserLinkCode()).not.toMatch(/[ILOU]/)
    }
  })

  it('毎回異なる（衝突しない）', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateUserLinkCode()))
    expect(codes.size).toBe(200)
  })
})

describe('hashUserLinkCode', () => {
  it('sha256 hex を返す（平文を保持しない）', () => {
    const hash = hashUserLinkCode('TA-0123456789ABCDEFGHJKMNPQRS')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('同じコードは同じハッシュ、違うコードは違うハッシュ', () => {
    const a = generateUserLinkCode()
    const b = generateUserLinkCode()
    expect(hashUserLinkCode(a)).toBe(hashUserLinkCode(a))
    expect(hashUserLinkCode(a)).not.toBe(hashUserLinkCode(b))
  })

  it('正規化してからハッシュする（小文字・前後空白でも同じ）', () => {
    const code = 'TA-0123456789ABCDEFGHJKMNPQRS'
    expect(hashUserLinkCode(`  ${code.toLowerCase()}  `)).toBe(hashUserLinkCode(code))
  })
})

describe('normalizeUserLinkCode', () => {
  it('大文字化・トリムする', () => {
    expect(normalizeUserLinkCode('  ta-0123456789abcdefghjkmnpqrs ')).toBe(
      'TA-0123456789ABCDEFGHJKMNPQRS',
    )
  })
})

describe('looksLikeUserLinkCode', () => {
  it('内部ユーザー用コードを検出する', () => {
    expect(looksLikeUserLinkCode(generateUserLinkCode())).toBe(true)
    expect(looksLikeUserLinkCode('ta-0123456789abcdefghjkmnpqrs')).toBe(true)
  })

  it('顧客用の突合コード（channel_link_codes）とは形式が異なるので誤検出しない', () => {
    // 顧客用は TA- プレフィックスを持たない短い英数コード
    expect(looksLikeUserLinkCode('ABC123')).toBe(false)
    expect(looksLikeUserLinkCode('123456')).toBe(false)
  })

  it('通常の会話は検出しない', () => {
    expect(looksLikeUserLinkCode('明日までにお願いします')).toBe(false)
    expect(looksLikeUserLinkCode('')).toBe(false)
    expect(looksLikeUserLinkCode('TA-短すぎる')).toBe(false)
  })
})

describe('maskUserLinkCode', () => {
  // channel_messages は append-only（トリガー強制）。認証コードを平文で入れたら二度と消せない。
  // よって「保存する前に」マスクする必要がある。
  it('コードを含む本文はマスク文字列に置き換える', () => {
    const code = generateUserLinkCode()
    expect(maskUserLinkCode(code)).toBe(USER_LINK_CODE_MASK)
  })

  it('前後に文章があってもマスクする（コードが残らない）', () => {
    const code = generateUserLinkCode()
    const masked = maskUserLinkCode(`これです ${code} よろしく`)
    expect(masked).toBe(USER_LINK_CODE_MASK)
    expect(masked).not.toContain(code)
  })

  it('コードを含まない本文はそのまま返す', () => {
    expect(maskUserLinkCode('明日までにお願いします')).toBe('明日までにお願いします')
  })

  it('null/空文字は落ちない', () => {
    expect(maskUserLinkCode(null)).toBeNull()
    expect(maskUserLinkCode('')).toBe('')
  })
})
