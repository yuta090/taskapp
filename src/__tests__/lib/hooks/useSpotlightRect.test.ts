import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSpotlightRect } from '@/lib/hooks/useSpotlightRect'

// rAF をテストから同期的にフラッシュできるようにする
function stubRaf() {
  const callbacks: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    callbacks.push(cb)
    return callbacks.length
  })
  vi.stubGlobal('cancelAnimationFrame', () => {})
  return {
    flush: () => {
      const pending = callbacks.splice(0, callbacks.length)
      pending.forEach((cb) => cb(0))
    },
  }
}

describe('useSpotlightRect — DOM変化への追従', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('対象要素がDOM変化後に出現すると、resize/scrollなしでmatchが更新される', async () => {
    const raf = stubRaf()
    const { result } = renderHook(() => useSpotlightRect('[data-testid="late-target"]', true))

    expect(result.current.rect).toBeNull()
    expect(result.current.matchedSelector).toBeNull()

    // レイアウトシフト後に対象要素が後から追加されるケース（例: データ読込完了後）
    await act(async () => {
      const el = document.createElement('div')
      el.setAttribute('data-testid', 'late-target')
      document.body.appendChild(el)
      // MutationObserver のコールバックはマイクロタスクとしてキューされるため、
      // 1tick待ってから rAF をフラッシュする
      await Promise.resolve()
    })
    act(() => {
      raf.flush()
    })

    expect(result.current.matchedSelector).toBe('[data-testid="late-target"]')
    expect(result.current.rect).not.toBeNull()
  })

  it('非アクティブ化するとNO_MATCHに戻り、MutationObserverが切断される', () => {
    const raf = stubRaf()
    const disconnectSpy = vi.fn()
    const observeSpy = vi.fn()
    class FakeMutationObserver {
      constructor(private callback: MutationCallback) {}
      observe = observeSpy
      disconnect = disconnectSpy
      takeRecords = () => []
    }
    vi.stubGlobal('MutationObserver', FakeMutationObserver)

    const el = document.createElement('div')
    el.setAttribute('data-testid', 'existing-target')
    document.body.appendChild(el)

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useSpotlightRect('[data-testid="existing-target"]', active),
      { initialProps: { active: true } }
    )
    act(() => {
      raf.flush()
    })

    expect(observeSpy).toHaveBeenCalledTimes(1)
    expect(result.current.matchedSelector).toBe('[data-testid="existing-target"]')

    rerender({ active: false })

    expect(result.current.rect).toBeNull()
    expect(result.current.matchedSelector).toBeNull()
    expect(disconnectSpy).toHaveBeenCalled()
  })
})
