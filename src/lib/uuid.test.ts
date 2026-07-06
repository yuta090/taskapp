import { describe, it, expect } from 'vitest'
import { isValidUuid } from './uuid'

// 背景: 各API routeにv4限定のUUID正規表現が重複しており、
// デモ組織ID(00000000-0000-0000-0000-000000000001)のような
// 非v4の正規UUIDを400で弾く実バグがあった。
// バリデーションの目的はインジェクション対策・明白な不正値の排除であり、
// UUIDバージョンの強制ではない。
describe('isValidUuid', () => {
  it('v4 UUIDを受け付ける', () => {
    expect(isValidUuid('11111111-1111-4111-8111-111111111111')).toBe(true)
    expect(isValidUuid('a3bb189e-8bf9-4888-9912-ace4e6543002')).toBe(true)
  })

  it('非v4の正規フォーマットUUID(デモ組織ID等)を受け付ける', () => {
    expect(isValidUuid('00000000-0000-0000-0000-000000000001')).toBe(true)
    expect(isValidUuid('00000000-0000-0000-0000-000000000010')).toBe(true)
  })

  it('大文字も受け付ける', () => {
    expect(isValidUuid('A3BB189E-8BF9-4888-9912-ACE4E6543002')).toBe(true)
  })

  it('明白な不正値を弾く', () => {
    expect(isValidUuid('not-a-uuid')).toBe(false)
    expect(isValidUuid('')).toBe(false)
    expect(isValidUuid('11111111-1111-4111-8111-11111111111')).toBe(false) // 1桁足りない
    expect(isValidUuid('11111111-1111-4111-8111-1111111111112')).toBe(false) // 1桁多い
    expect(isValidUuid('11111111111141118111111111111111')).toBe(false) // ハイフンなし
    expect(isValidUuid("1' OR '1'='1")).toBe(false)
    expect(isValidUuid(null)).toBe(false)
    expect(isValidUuid(undefined)).toBe(false)
  })
})
