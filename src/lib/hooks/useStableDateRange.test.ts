import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useStableDateRange } from './useStableDateRange'

describe('useStableDateRange', () => {
  it('値(getTime())が変わらなければ同じDateオブジェクト参照を返す', () => {
    const { result, rerender } = renderHook(
      ({ start, end }) => useStableDateRange({ start, end }),
      {
        initialProps: {
          start: new Date('2024-01-01'),
          end: new Date('2024-02-01'),
        },
      }
    )

    const first = result.current

    // 値は同じだが、呼び出し元(GanttChart側のuseMemo)が毎回新しいDateインスタンスを
    // 作って渡すケースを再現する。
    rerender({ start: new Date('2024-01-01'), end: new Date('2024-02-01') })

    expect(result.current.start).toBe(first.start)
    expect(result.current.end).toBe(first.end)
  })

  it('値が変わったときは新しい参照を返す', () => {
    const { result, rerender } = renderHook(
      ({ start, end }) => useStableDateRange({ start, end }),
      {
        initialProps: {
          start: new Date('2024-01-01'),
          end: new Date('2024-02-01'),
        },
      }
    )

    const first = result.current

    rerender({ start: new Date('2024-01-02'), end: new Date('2024-02-01') })

    expect(result.current.start).not.toBe(first.start)
    expect(result.current.start.getTime()).toBe(new Date('2024-01-02').getTime())
  })
})
