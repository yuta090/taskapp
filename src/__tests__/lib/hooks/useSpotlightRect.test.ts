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

// jsdom はレイアウトを計算しないため getBoundingClientRect() は既定で
// 全フィールド0のDOMRectを返す。フックは 0サイズを「非表示」とみなして
// スキップするため、「実際に表示されている」ことを表すテストでは、この
// ヘルパーで対象要素に現実的な非ゼロサイズを個別に持たせる。
function stubNonZeroRect(el: Element, overrides: Partial<DOMRect> = {}) {
  el.getBoundingClientRect = () =>
    ({
      top: 100,
      left: 20,
      right: 320,
      bottom: 140,
      width: 300,
      height: 40,
      x: 20,
      y: 100,
      toJSON() {},
      ...overrides,
    }) as DOMRect
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
      stubNonZeroRect(el)
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
    stubNonZeroRect(el)
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

describe('useSpotlightRect — 0サイズ要素のスキップ', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('先頭セレクタが0サイズ(非表示)なら、次のセレクタにフォールスルーする', () => {
    const raf = stubRaf()
    const hidden = document.createElement('div')
    hidden.setAttribute('data-testid', 'hidden-primary')
    // display:none相当。あえて非ゼロにスタブしない = jsdom既定の全0矩形のまま。
    document.body.appendChild(hidden)

    const visible = document.createElement('div')
    visible.setAttribute('data-testid', 'visible-fallback')
    stubNonZeroRect(visible)
    document.body.appendChild(visible)

    const { result } = renderHook(() =>
      useSpotlightRect(
        ['[data-testid="hidden-primary"]', '[data-testid="visible-fallback"]'],
        true
      )
    )
    act(() => {
      raf.flush()
    })

    expect(result.current.matchedSelector).toBe('[data-testid="visible-fallback"]')
    expect(result.current.rect).not.toBeNull()
  })

  it('フォールバック先も0サイズなら null を返す（中央ダイアログにフォールバック）', () => {
    const raf = stubRaf()
    const hidden = document.createElement('div')
    hidden.setAttribute('data-testid', 'hidden-only')
    document.body.appendChild(hidden)

    const { result } = renderHook(() => useSpotlightRect('[data-testid="hidden-only"]', true))
    act(() => {
      raf.flush()
    })

    expect(result.current.rect).toBeNull()
    expect(result.current.matchedSelector).toBeNull()
  })
})

describe('useSpotlightRect — 画面外ターゲットのスクロール追従', () => {
  const originalInnerWidth = window.innerWidth
  const originalInnerHeight = window.innerHeight

  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
    window.innerWidth = originalInnerWidth
    window.innerHeight = originalInnerHeight
  })

  it('対象がビューポート外なら scrollIntoView が一度だけ呼ばれる', () => {
    window.innerWidth = 390
    window.innerHeight = 844

    const raf = stubRaf()
    const el = document.createElement('div')
    el.setAttribute('data-testid', 'offscreen-target')
    // モバイルでアクションセクションがビューポート外にある状況を再現(y≈1227)
    stubNonZeroRect(el, { top: 1227, bottom: 1267, left: 16, right: 374 })
    const scrollSpy = vi.fn()
    el.scrollIntoView = scrollSpy
    document.body.appendChild(el)

    const { result } = renderHook(() => useSpotlightRect('[data-testid="offscreen-target"]', true))
    act(() => {
      raf.flush()
    })

    expect(result.current.matchedSelector).toBe('[data-testid="offscreen-target"]')
    expect(scrollSpy).toHaveBeenCalledTimes(1)

    // 同一ステップ内でscroll/resizeが再発火しても再度は呼ばれない
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    act(() => {
      raf.flush()
    })
    expect(scrollSpy).toHaveBeenCalledTimes(1)
  })

  it('対象が既にビューポート内なら scrollIntoView は呼ばれない', () => {
    window.innerWidth = 390
    window.innerHeight = 844

    const raf = stubRaf()
    const el = document.createElement('div')
    el.setAttribute('data-testid', 'visible-target')
    stubNonZeroRect(el, { top: 100, bottom: 140, left: 16, right: 374 })
    const scrollSpy = vi.fn()
    el.scrollIntoView = scrollSpy
    document.body.appendChild(el)

    const { result } = renderHook(() => useSpotlightRect('[data-testid="visible-target"]', true))
    act(() => {
      raf.flush()
    })

    expect(result.current.matchedSelector).toBe('[data-testid="visible-target"]')
    expect(scrollSpy).not.toHaveBeenCalled()
  })
})
