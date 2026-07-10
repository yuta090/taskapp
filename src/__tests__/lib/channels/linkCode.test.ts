import { describe, it, expect } from 'vitest'
import { generateLinkCode, normalizeLinkCode, LINK_CODE_REGEX } from '@/lib/channels/linkCode'

/**
 * 顧問先突合用リンクコード
 *
 * - 事務所が顧問先に案内し、顧問先がLINEトークで送り返して本人特定する
 * - 人間が打てる: 紛らわしい文字(0/O, 1/I/L)を含まない大文字英数 8桁
 * - 受信テキストは前後空白・小文字・全角を許容して正規化マッチする
 */

describe('generateLinkCode', () => {
  it('8桁・許可文字のみで生成される', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateLinkCode()
      expect(code).toMatch(LINK_CODE_REGEX)
      expect(code).toHaveLength(8)
    }
  })

  it('紛らわしい文字(0,O,1,I,L)を含まない', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateLinkCode()).not.toMatch(/[01OIL]/)
    }
  })

  it('呼び出しごとに異なる（衝突しない）', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateLinkCode()))
    expect(codes.size).toBe(100)
  })
})

describe('normalizeLinkCode', () => {
  it('小文字・前後空白を正規化する', () => {
    expect(normalizeLinkCode('  ab2cd3ef ')).toBe('AB2CD3EF')
  })

  it('全角英数字を半角に正規化する', () => {
    expect(normalizeLinkCode('ＡＢ２ＣＤ３ＥＦ')).toBe('AB2CD3EF')
  })

  it('全角スペース・コード内の空白も吸収する', () => {
    expect(normalizeLinkCode('　AB2CD3EF　')).toBe('AB2CD3EF')
    expect(normalizeLinkCode('AB2C D3EF')).toBe('AB2CD3EF')
  })

  it('コード形式でない通常メッセージは null', () => {
    expect(normalizeLinkCode('領収書を送ります')).toBeNull()
    expect(normalizeLinkCode('こんにちは AB2CD3EF です')).toBeNull()
    expect(normalizeLinkCode('')).toBeNull()
  })
})
