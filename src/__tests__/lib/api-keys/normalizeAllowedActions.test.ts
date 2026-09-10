import { describe, it, expect } from 'vitest'
import { normalizeAllowedActions, formatApiKeyActions } from '@/lib/api-keys/actionOptions'

describe('formatApiKeyActions', () => {
  it('画面の名前で、画面の順に並べる', () => {
    expect(formatApiKeyActions(['bulk', 'read', 'write'])).toBe('読み取り・書き込み・一括操作')
  })

  it('知らない値はそのまま出す（DB に古い値が残っていても消えないように）', () => {
    expect(formatApiKeyActions(['read', 'admin'])).toBe('読み取り・admin')
  })
})

/**
 * 画面から届いた「許可する操作」を、DB の CHECK 制約に通る形にそろえる。
 * 知らない値は DB に渡さず呼び出し側で 400 にする（DB のエラー文を画面に漏らさない）。
 */
describe('normalizeAllowedActions', () => {
  it('未指定なら読み取りだけ', () => {
    expect(normalizeAllowedActions(undefined)).toEqual(['read'])
  })

  it('読み取りは必ず含め、並びは画面の順にそろえる', () => {
    expect(normalizeAllowedActions(['bulk', 'write'])).toEqual(['read', 'write', 'bulk'])
  })

  it('重複はまとめる', () => {
    expect(normalizeAllowedActions(['write', 'write', 'read'])).toEqual(['read', 'write'])
  })

  it('知らない操作が混ざっていたら null（呼び出し側で 400）', () => {
    expect(normalizeAllowedActions(['write', 'admin'])).toBeNull()
  })

  it('配列でなければ null', () => {
    expect(normalizeAllowedActions('write')).toBeNull()
  })
})
