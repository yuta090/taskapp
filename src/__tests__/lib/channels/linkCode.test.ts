import { describe, it, expect } from 'vitest'
import {
  generateLinkCode,
  normalizeLinkCode,
  normalizeClaimCode,
  LINK_CODE_REGEX,
  CLAIM_CODE_REGEX,
} from '@/lib/channels/linkCode'

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

/**
 * normalizeClaimCode（共有bot・shared_group_claim専用の受理フィルタ。Fable裁定・確定形状）
 *
 * 31文字集合(ALPHABET) × 26文字（≈128.8bit）。表示は `GC-` プレフィクス＋ハイフン区切り
 * （例 `GC-XXXXXX-XXXXX-XXXXX-XXXXX-XXXXX`）。正準形（HMAC対象・照合対象）はプレフィクス・
 * 区切りを除いた26文字本体。既存の顧問先突合コード（normalizeLinkCode・8文字）とは
 * 長さで完全に排他する。
 */
describe('normalizeClaimCode', () => {
  // 31文字集合(ALPHABET)のみで構成した26文字本体（正準形）
  const CANONICAL = 'ABCDEFGHJKMNPQRSTUVWXYZ234'

  it('テスト用正準形フィクスチャは26文字である（テストの前提確認）', () => {
    expect(CANONICAL).toHaveLength(26)
  })

  it('26文字本体そのままなら正準形を返す', () => {
    expect(normalizeClaimCode(CANONICAL)).toBe(CANONICAL)
  })

  it('GC-プレフィクス＋ハイフン区切りの表示形式を正準形へ収束させる', () => {
    expect(normalizeClaimCode('GC-ABCDEF-GHJKM-NPQRS-TUVWX-YZ234')).toBe(CANONICAL)
  })

  it('小文字・前後空白・全角空白・全角英数を正準形へ収束させる', () => {
    expect(normalizeClaimCode(`  gc-abcdef-ghjkm-npqrs-tuvwx-yz234  `)).toBe(CANONICAL)
    expect(normalizeClaimCode('　GC-ABCDEF-GHJKM-NPQRS-TUVWX-YZ234　')).toBe(CANONICAL)
  })

  it('コード内に紛れた空白・改行も吸収する', () => {
    expect(normalizeClaimCode('GC-ABCDEF GHJKM\nNPQRS-TUVWX-YZ234')).toBe(CANONICAL)
  })

  it('GCプレフィクス無し（26文字本体のみ、ハイフン区切りだけ付いている）でも正準形を返す', () => {
    expect(normalizeClaimCode('ABCDEF-GHJKM-NPQRS-TUVWX-YZ234')).toBe(CANONICAL)
  })

  it('全角/小文字/空白(U+3000含む)/ハイフン/GC-プレフィクス有無の全組合せが同一26文字正準形に収束する', () => {
    const variants = [
      CANONICAL,
      `GC-${CANONICAL}`,
      CANONICAL.toLowerCase(),
      `gc-${CANONICAL.toLowerCase()}`,
      `  ${CANONICAL}  `,
      `　${CANONICAL}　`,
      'GC-ABCDEF-GHJKM-NPQRS-TUVWX-YZ234',
    ]
    for (const variant of variants) {
      expect(normalizeClaimCode(variant)).toBe(CANONICAL)
    }
  })

  it('コード形式でない通常メッセージ・空文字は null', () => {
    expect(normalizeClaimCode('領収書を送ります')).toBeNull()
    expect(normalizeClaimCode('')).toBeNull()
    expect(normalizeClaimCode('こんにちは')).toBeNull()
  })

  it('26文字に満たない・超える場合はnull（形状違反）', () => {
    expect(normalizeClaimCode(CANONICAL.slice(0, 25))).toBeNull()
    expect(normalizeClaimCode(`${CANONICAL}A`)).toBeNull()
  })

  it('8文字の顧問先突合コード(legacy)は絶対にマッチしない（長さで排他）', () => {
    expect(normalizeClaimCode('AB2CD3EF')).toBeNull()
    expect(LINK_CODE_REGEX.test('AB2CD3EF')).toBe(true) // 対照: normalizeLinkCode側では有効
  })

  it('26文字claimコードはnormalizeLinkCode(8文字)に絶対マッチしない（相互排他）', () => {
    expect(normalizeLinkCode(CANONICAL)).toBeNull()
    expect(CLAIM_CODE_REGEX.test(CANONICAL)).toBe(true) // 対照: normalizeClaimCode側では有効
  })
})
