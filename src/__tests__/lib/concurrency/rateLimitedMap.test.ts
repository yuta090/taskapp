import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mapWithRateLimit } from '@/lib/concurrency/rateLimitedMap'

/**
 * cron の一斉送信（メール送信サービスの1秒あたりの回数の上限に合わせる）ために、
 * concurrency 件ずつ・intervalMs おきに実行する。
 */
describe('mapWithRateLimit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('全件を1回ずつ処理し、結果を入力の順番で返す', async () => {
    const promise = mapWithRateLimit([1, 2, 3], async (n) => n * 10, {
      concurrency: 2,
      intervalMs: 1000,
    })
    await vi.runAllTimersAsync()
    const results = await promise

    expect(results).toEqual([
      { status: 'fulfilled', value: 10 },
      { status: 'fulfilled', value: 20 },
      { status: 'fulfilled', value: 30 },
    ])
  })

  it('concurrency件数までは間隔をあけずに一斉に実行する', async () => {
    const started: number[] = []
    const promise = mapWithRateLimit([1, 2], async (n) => {
      started.push(n)
      return n
    }, { concurrency: 2, intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual([1, 2])

    await vi.runAllTimersAsync()
    await promise
  })

  it('concurrencyを超える分は intervalMs だけ待ってから次を実行する', async () => {
    const started: number[] = []
    const promise = mapWithRateLimit([1, 2, 3], async (n) => {
      started.push(n)
      return n
    }, { concurrency: 2, intervalMs: 1000 })

    await vi.advanceTimersByTimeAsync(0)
    expect(started).toEqual([1, 2])

    // intervalMs 未満ではまだ3件目が始まらない
    await vi.advanceTimersByTimeAsync(500)
    expect(started).toEqual([1, 2])

    await vi.advanceTimersByTimeAsync(500)
    expect(started).toEqual([1, 2, 3])

    await vi.runAllTimersAsync()
    await promise
  })

  it('1件が失敗しても他の件は続ける（allSettledと同じ形）', async () => {
    const promise = mapWithRateLimit([1, 2, 3], async (n) => {
      if (n === 2) throw new Error('boom')
      return n
    }, { concurrency: 2, intervalMs: 1000 })
    await vi.runAllTimersAsync()
    const results = await promise

    expect(results[0]).toEqual({ status: 'fulfilled', value: 1 })
    expect(results[1]).toMatchObject({ status: 'rejected' })
    expect(results[2]).toEqual({ status: 'fulfilled', value: 3 })
  })

  it('空配列なら何もせず空配列を返す', async () => {
    const results = await mapWithRateLimit([], async (n: number) => n, {
      concurrency: 2,
      intervalMs: 1000,
    })
    expect(results).toEqual([])
  })

  it('onChunkSettledは、かたまりの送信が終わるたびに（次のかたまりを待たずに）呼ばれる', async () => {
    const chunks: number[][] = []
    const promise = mapWithRateLimit(
      [1, 2, 3],
      async (n) => n,
      {
        concurrency: 2,
        intervalMs: 1000,
        onChunkSettled: async (results) => {
          chunks.push(results.map((r) => (r.status === 'fulfilled' ? r.value : -1)))
        },
      }
    )

    // 1かたまり目（2件）が終わった時点で、2かたまり目（間隔待ち中）を待たずに呼ばれている
    await vi.advanceTimersByTimeAsync(0)
    expect(chunks).toEqual([[1, 2]])

    await vi.advanceTimersByTimeAsync(1000)
    expect(chunks).toEqual([[1, 2], [3]])

    await promise
  })

  it('onChunkSettledを渡さなくても、これまでどおり動く', async () => {
    const promise = mapWithRateLimit([1, 2], async (n) => n, { concurrency: 2, intervalMs: 1000 })
    await vi.runAllTimersAsync()
    const results = await promise
    expect(results).toEqual([
      { status: 'fulfilled', value: 1 },
      { status: 'fulfilled', value: 2 },
    ])
  })
})
