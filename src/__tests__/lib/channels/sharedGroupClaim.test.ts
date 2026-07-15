import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  hashSharedGroupClaimCode,
  generateGroupClaimChallengeLabel,
} from '@/lib/channels/sharedGroupClaim'

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
