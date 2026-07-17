import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  hashSharedGroupClaimCode,
  generateGroupClaimChallengeLabel,
  generateSharedGroupClaimCode,
  formatGroupClaimCodeForDisplay,
  WEB_APPROVAL_CLAIM_TTL_MS,
} from '@/lib/channels/sharedGroupClaim'
import { normalizeClaimCode, CLAIM_CODE_REGEX } from '@/lib/channels/linkCode'

/**
 * 共有bot（platform account）グループ紐付けコードのハッシュ化（HMAC+pepper）と
 * チャレンジラベル生成（Stage 4 §2/§3）。
 */

const ORIGINAL_PEPPER = process.env.SHARED_GROUP_CLAIM_PEPPER
const ORIGINAL_SYS_KEY = process.env.SYSTEM_ENCRYPTION_KEY

beforeEach(() => {
  delete process.env.SHARED_GROUP_CLAIM_PEPPER
  delete process.env.SYSTEM_ENCRYPTION_KEY
})

afterEach(() => {
  if (ORIGINAL_PEPPER === undefined) delete process.env.SHARED_GROUP_CLAIM_PEPPER
  else process.env.SHARED_GROUP_CLAIM_PEPPER = ORIGINAL_PEPPER
  if (ORIGINAL_SYS_KEY === undefined) delete process.env.SYSTEM_ENCRYPTION_KEY
  else process.env.SYSTEM_ENCRYPTION_KEY = ORIGINAL_SYS_KEY
})

describe('hashSharedGroupClaimCode', () => {
  it('同じコード・同じpepperなら同じhashになる（照合可能）', () => {
    process.env.SHARED_GROUP_CLAIM_PEPPER = 'pepper-1'
    expect(hashSharedGroupClaimCode('ABCD1234')).toBe(hashSharedGroupClaimCode('ABCD1234'))
  })

  it('異なるコードは異なるhashになる', () => {
    process.env.SHARED_GROUP_CLAIM_PEPPER = 'pepper-1'
    expect(hashSharedGroupClaimCode('ABCD1234')).not.toBe(hashSharedGroupClaimCode('ZZZZ9999'))
  })

  it('平文コードを含まない16進文字列を返す（生保存しない）', () => {
    process.env.SHARED_GROUP_CLAIM_PEPPER = 'pepper-1'
    const hash = hashSharedGroupClaimCode('ABCD1234')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).not.toContain('ABCD1234')
  })

  it('SHARED_GROUP_CLAIM_PEPPER未設定時はSYSTEM_ENCRYPTION_KEYにフォールバックする', () => {
    process.env.SYSTEM_ENCRYPTION_KEY = 'sys-key'
    const withFallback = hashSharedGroupClaimCode('ABCD1234')

    process.env.SHARED_GROUP_CLAIM_PEPPER = 'sys-key'
    delete process.env.SYSTEM_ENCRYPTION_KEY
    const withExplicit = hashSharedGroupClaimCode('ABCD1234')

    expect(withFallback).toBe(withExplicit)
  })

  it('pepperが両方未設定なら例外を投げる（無秘密でのハッシュ化を許さない）', () => {
    expect(() => hashSharedGroupClaimCode('ABCD1234')).toThrow(/SHARED_GROUP_CLAIM_PEPPER/)
  })

  it('SHARED_GROUP_CLAIM_PEPPERが空文字（未設定でなく明示的に空）でも例外を投げる（fail-closed）', () => {
    process.env.SHARED_GROUP_CLAIM_PEPPER = ''
    process.env.SYSTEM_ENCRYPTION_KEY = 'valid-fallback-key'
    // 空文字は `??`（nullish coalescing）では未設定と判定されずSYSTEM_ENCRYPTION_KEYへ
    // フォールバックしない。空のHMAC鍵を黙って受け入れず、必ず例外にする。
    expect(() => hashSharedGroupClaimCode('ABCD1234')).toThrow(/SHARED_GROUP_CLAIM_PEPPER/)
  })

  it('フォールバック先のSYSTEM_ENCRYPTION_KEYが空文字でも例外を投げる（fail-closed）', () => {
    delete process.env.SHARED_GROUP_CLAIM_PEPPER
    process.env.SYSTEM_ENCRYPTION_KEY = ''
    expect(() => hashSharedGroupClaimCode('ABCD1234')).toThrow(/SHARED_GROUP_CLAIM_PEPPER/)
  })

  it('pepperが異なれば同じコードでも別のhashになる', () => {
    process.env.SHARED_GROUP_CLAIM_PEPPER = 'pepper-1'
    const a = hashSharedGroupClaimCode('ABCD1234')
    process.env.SHARED_GROUP_CLAIM_PEPPER = 'pepper-2'
    const b = hashSharedGroupClaimCode('ABCD1234')
    expect(a).not.toBe(b)
  })
})

describe('generateGroupClaimChallengeLabel', () => {
  it('4文字・紛らわしい文字(0/O/1/I/L)を含まない大文字英数を生成する', () => {
    for (let i = 0; i < 50; i++) {
      const label = generateGroupClaimChallengeLabel()
      expect(label).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/)
    }
  })

  it('毎回同じ値にはならない（ランダム性）', () => {
    const labels = new Set(Array.from({ length: 20 }, () => generateGroupClaimChallengeLabel()))
    expect(labels.size).toBeGreaterThan(1)
  })
})

/**
 * PR3a: web_approval コード発行（コンソール側）。
 * 発行→表示コード→normalizeClaimCode→hash が、発行時に計算した code_hash と一致すること
 * （往復一致。ここがずれると発行直後のコードが常にinvalid扱いになる＝MUST DOの回帰テスト）。
 */
describe('generateSharedGroupClaimCode', () => {
  it('26文字・claim用の許可文字集合のみで生成される', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateSharedGroupClaimCode()
      expect(code).toHaveLength(26)
      expect(code).toMatch(CLAIM_CODE_REGEX)
    }
  })

  it('紛らわしい文字(0,O,1,I,L)を含まない', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateSharedGroupClaimCode()).not.toMatch(/[01OIL]/)
    }
  })

  it('呼び出しごとに異なる（衝突しない）', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateSharedGroupClaimCode()))
    expect(codes.size).toBe(100)
  })
})

describe('formatGroupClaimCodeForDisplay', () => {
  const CANONICAL = 'ABCDEFGHJKMNPQRSTUVWXYZ234'

  it('GC-プレフィクス＋6-5-5-5-5のハイフン区切りで整形する', () => {
    expect(formatGroupClaimCodeForDisplay(CANONICAL)).toBe('GC-ABCDEF-GHJKM-NPQRS-TUVWX-YZ234')
  })

  it('26文字でない入力は例外を投げる', () => {
    expect(() => formatGroupClaimCodeForDisplay(CANONICAL.slice(0, 25))).toThrow()
    expect(() => formatGroupClaimCodeForDisplay(`${CANONICAL}A`)).toThrow()
  })

  it('許可文字集合外を含む入力は例外を投げる', () => {
    expect(() => formatGroupClaimCodeForDisplay('abcdefghjkmnpqrstuvwxyz234')).toThrow()
  })

  it('往復一致: 発行→表示→normalizeClaimCode が元の正準形に戻る', () => {
    for (let i = 0; i < 20; i++) {
      const canonical = generateSharedGroupClaimCode()
      const display = formatGroupClaimCodeForDisplay(canonical)
      expect(normalizeClaimCode(display)).toBe(canonical)
    }
  })

  it('往復一致: hash(表示コードをnormalizeClaimCodeした結果) が hash(発行時の正準形) と一致する', () => {
    process.env.SHARED_GROUP_CLAIM_PEPPER = 'pepper-round-trip'
    const canonical = generateSharedGroupClaimCode()
    const issuedHash = hashSharedGroupClaimCode(canonical)

    const display = formatGroupClaimCodeForDisplay(canonical)
    const redeemedCanonical = normalizeClaimCode(display)
    expect(redeemedCanonical).not.toBeNull()
    const redeemedHash = hashSharedGroupClaimCode(redeemedCanonical as string)

    expect(redeemedHash).toBe(issuedHash)
  })
})

describe('WEB_APPROVAL_CLAIM_TTL_MS', () => {
  it('30分（設計正本 §2の上限側）', () => {
    expect(WEB_APPROVAL_CLAIM_TTL_MS).toBe(30 * 60 * 1000)
  })
})
