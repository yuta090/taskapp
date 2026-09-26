import { describe, it, expect } from 'vitest'
import { describeError } from '@/lib/cli-usage/describeError'

/**
 * describeError — 失敗したエラーを cli_usage_logs.error_detail 用の JSON に変換する。
 *
 * 呼んだ人（CLI / 外部チャット）には返さない、運営画面専用の記録。
 * - name / message / cause チェーン（最大3段）を拾う
 * - 想定外の値（文字列・null・循環参照）でも例外を投げない
 * - 長い文字列は truncate する
 */
describe('describeError', () => {
  it('null / undefined は null を返す', () => {
    expect(describeError(null)).toBeNull()
    expect(describeError(undefined)).toBeNull()
  })

  it('Error インスタンスは name と message を持つ', () => {
    const detail = describeError(new Error('unexpected internal failure'))
    expect(detail).toMatchObject({ name: 'Error', message: 'unexpected internal failure' })
  })

  it('文字列やその他の値でも例外を投げず message に入れる', () => {
    expect(describeError('plain string failure')).toMatchObject({ message: 'plain string failure' })
    expect(describeError(42)).toMatchObject({ message: '42' })
  })

  it('cause が supabase の DB エラー（code/message/details/hint）なら拾う', () => {
    const dbError = { code: '42501', message: 'permission denied for table x', details: null, hint: null }
    const err = new Error('アクティビティログの検索に失敗しました', { cause: dbError })

    const detail = describeError(err)

    expect(detail).toMatchObject({
      name: 'Error',
      message: 'アクティビティログの検索に失敗しました',
      cause: { code: '42501', message: 'permission denied for table x' },
    })
  })

  it('cause チェーンは最大3段までたどる', () => {
    const level3 = { code: 'L3', message: 'level3' }
    const level2 = new Error('level2', { cause: level3 })
    const level1 = new Error('level1', { cause: level2 })
    const top = new Error('top', { cause: level1 })

    const detail = describeError(top) as Record<string, unknown>

    // top -> level1 -> level2 -> level3（3段）
    const c1 = detail.cause as Record<string, unknown>
    const c2 = c1.cause as Record<string, unknown>
    const c3 = c2.cause as Record<string, unknown> | undefined
    expect(c3).toMatchObject({ code: 'L3', message: 'level3' })
  })

  it('循環した cause でも無限ループにならない', () => {
    const a: Error & { cause?: unknown } = new Error('a')
    const b: Error & { cause?: unknown } = new Error('b', { cause: a })
    a.cause = b // a -> b -> a の循環

    expect(() => describeError(a)).not.toThrow()
  })

  it('長い message は truncate する', () => {
    const longMessage = 'x'.repeat(2000)
    const detail = describeError(new Error(longMessage)) as Record<string, unknown>
    expect((detail.message as string).length).toBeLessThan(1100)
  })

  it('includeStack を渡さなければ stack を含まない', () => {
    const detail = describeError(new Error('boom')) as Record<string, unknown>
    expect(detail.stack).toBeUndefined()
  })

  it('includeStack: true なら stack の先頭数行を含む', () => {
    const detail = describeError(new Error('boom'), { includeStack: true }) as Record<string, unknown>
    expect(typeof detail.stack).toBe('string')
    expect((detail.stack as string).split('\n').length).toBeLessThanOrEqual(5)
  })
})
