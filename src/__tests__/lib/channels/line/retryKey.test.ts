import { describe, it, expect } from 'vitest'
import { toLineRetryKey } from '@/lib/channels/line/retryKey'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('toLineRetryKey', () => {
  it('任意シードを UUID v4 形状へ整形する(LINE X-Line-Retry-Key 要件)', () => {
    // ULID 風・プレフィックス付き文字列いずれも UUID 形状になる
    expect(toLineRetryKey('01J8ZZZZZZZZZZZZZZZZZZZZZZ')).toMatch(UUID_RE)
    expect(toLineRetryKey('connector-completion:task-1')).toMatch(UUID_RE)
  })

  it('決定的: 同一シードは同一キー(二重配信防止が効く)', () => {
    expect(toLineRetryKey('evt-99')).toBe(toLineRetryKey('evt-99'))
  })

  it('異なるシードは異なるキー', () => {
    expect(toLineRetryKey('evt-1')).not.toBe(toLineRetryKey('evt-2'))
  })
})
