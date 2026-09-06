import { describe, it, expect } from 'vitest'
import { mapWithConcurrency } from '@/lib/admin/concurrency'

describe('mapWithConcurrency', () => {
  it('順序を保って全件を処理する', async () => {
    const out = await mapWithConcurrency([3, 1, 2], 2, async (n) => {
      await new Promise((r) => setTimeout(r, n * 5))
      return n * 10
    })
    expect(out).toEqual([30, 10, 20])
  })

  it('同時に走る数が上限を超えない', async () => {
    let running = 0
    let peak = 0
    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async () => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 2))
      running -= 1
    })
    expect(peak).toBeLessThanOrEqual(4)
    expect(peak).toBeGreaterThan(1)
  })

  it('空配列なら空を返す', async () => {
    expect(await mapWithConcurrency([], 3, async (x: number) => x)).toEqual([])
  })
})
