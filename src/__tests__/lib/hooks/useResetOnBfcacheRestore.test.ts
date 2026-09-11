import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResetOnBfcacheRestore } from '@/lib/hooks/useResetOnBfcacheRestore'

/**
 * iPhone Safari 等が bfcache（swipe back で復元されるページ）からページをそのまま復元すると、
 * ページは実際には破棄されておらず、成功後にわざと維持しているローディング状態を戻す機会が
 * 無いままボタンが永久に押せなくなる。pageshow の event.persisted === true を検知したときだけ
 * reset() を呼ぶことを保証する。
 */

function dispatchPageShow(persisted: boolean) {
  const event = new Event('pageshow') as PageTransitionEvent
  Object.defineProperty(event, 'persisted', { value: persisted })
  window.dispatchEvent(event)
}

describe('useResetOnBfcacheRestore', () => {
  it('persisted: true の pageshow で reset() を呼ぶ（bfcache からの復元）', () => {
    const reset = vi.fn()
    renderHook(() => useResetOnBfcacheRestore(reset))

    act(() => { dispatchPageShow(true) })

    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('persisted: false の pageshow（通常の初回読み込み）では reset() を呼ばない', () => {
    const reset = vi.fn()
    renderHook(() => useResetOnBfcacheRestore(reset))

    act(() => { dispatchPageShow(false) })

    expect(reset).not.toHaveBeenCalled()
  })

  it('毎回の再レンダリングで渡された最新の reset を呼ぶ（呼び出し側の useCallback 不要）', () => {
    const resetA = vi.fn()
    const resetB = vi.fn()
    const { rerender } = renderHook(({ reset }) => useResetOnBfcacheRestore(reset), {
      initialProps: { reset: resetA },
    })

    rerender({ reset: resetB })
    act(() => { dispatchPageShow(true) })

    expect(resetA).not.toHaveBeenCalled()
    expect(resetB).toHaveBeenCalledTimes(1)
  })

  it('アンマウント後は pageshow を受けても reset() を呼ばない', () => {
    const reset = vi.fn()
    const { unmount } = renderHook(() => useResetOnBfcacheRestore(reset))

    unmount()
    act(() => { dispatchPageShow(true) })

    expect(reset).not.toHaveBeenCalled()
  })
})
