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

  it('対象が画面下端寄りで、ビューポートより高さが大きいときは block:"start" で呼ばれる', () => {
    window.innerWidth = 390
    window.innerHeight = 844

    const raf = stubRaf()
    const el = document.createElement('div')
    el.setAttribute('data-testid', 'tall-target')
    // ビューポート(844)より縦に長い対象（例: アクションセクション全体）
    stubNonZeroRect(el, { top: 109, bottom: 1000, left: 16, right: 374, height: 891 })
    const scrollSpy = vi.fn()
    el.scrollIntoView = scrollSpy
    document.body.appendChild(el)

    renderHook(() => useSpotlightRect('[data-testid="tall-target"]', true))
    act(() => {
      raf.flush()
    })

    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }))
  })

  it('対象がビューポートより高さが小さいときは block:"center" で呼ばれる', () => {
    window.innerWidth = 390
    window.innerHeight = 844

    const raf = stubRaf()
    const el = document.createElement('div')
    el.setAttribute('data-testid', 'short-offscreen-target')
    stubNonZeroRect(el, { top: 1227, bottom: 1267, left: 16, right: 374, height: 40 })
    const scrollSpy = vi.fn()
    el.scrollIntoView = scrollSpy
    document.body.appendChild(el)

    renderHook(() => useSpotlightRect('[data-testid="short-offscreen-target"]', true))
    act(() => {
      raf.flush()
    })

    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }))
  })
})

describe('useSpotlightRect — スクロールは即座に移動する（smoothは使わない）', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('scrollIntoView は behavior:"auto" で呼ばれる（smoothはパネルの位置再計算と競合して跳ねるため使わない）', () => {
    window.innerWidth = 390
    window.innerHeight = 844

    const raf = stubRaf()
    const el = document.createElement('div')
    el.setAttribute('data-testid', 'instant-scroll-target')
    stubNonZeroRect(el, { top: 1227, bottom: 1267, left: 16, right: 374, height: 40 })
    const scrollSpy = vi.fn()
    el.scrollIntoView = scrollSpy
    document.body.appendChild(el)

    renderHook(() => useSpotlightRect('[data-testid="instant-scroll-target"]', true))
    act(() => {
      raf.flush()
    })

    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }))
  })
})

describe('useSpotlightRect — 仮想リストでの要素入れ替え（同一ステップ内の再スクロール抑止）', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.unstubAllGlobals()
  })

  it('同じセレクタのまま一致する要素が入れ替わっても、2回目は scrollIntoView を呼ばない', async () => {
    window.innerWidth = 390
    window.innerHeight = 844

    const raf = stubRaf()
    const selector = '[data-walkthrough="task-row-ball"]'

    // 仮想リストの1行目相当（画面外）
    const rowA = document.createElement('div')
    rowA.setAttribute('data-walkthrough', 'task-row-ball')
    stubNonZeroRect(rowA, { top: 1200, bottom: 1240, left: 16, right: 374, height: 40 })
    const scrollSpyA = vi.fn()
    rowA.scrollIntoView = scrollSpyA
    document.body.appendChild(rowA)

    const { result } = renderHook(() => useSpotlightRect(selector, true))
    act(() => {
      raf.flush()
    })

    expect(result.current.matchedSelector).toBe(selector)
    expect(scrollSpyA).toHaveBeenCalledTimes(1)

    // ユーザーがリスト内をスクロールし、仮想化により行Aがアンマウントされ、
    // 同じセレクタに一致する別の(オーバースキャンされた画面外の)行Bへ差し替わる。
    const rowB = document.createElement('div')
    rowB.setAttribute('data-walkthrough', 'task-row-ball')
    stubNonZeroRect(rowB, { top: 1500, bottom: 1540, left: 16, right: 374, height: 40 })
    const scrollSpyB = vi.fn()
    rowB.scrollIntoView = scrollSpyB
    document.body.removeChild(rowA)
    document.body.appendChild(rowB)

    // MutationObserver がこの差し替えを検知して update() をスケジュールする想定。
    await act(async () => {
      await Promise.resolve()
    })
    act(() => {
      raf.flush()
    })

    expect(result.current.matchedSelector).toBe(selector)
    // 同一ステップ・同一セレクタなので、要素が変わっても再スクロールしない。
    expect(scrollSpyB).not.toHaveBeenCalled()
  })

  it('要素が同じでも、ステップ（セレクタの組）が変わればスクロール判定はリセットされ、画面外なら再度スクロールする', () => {
    window.innerWidth = 390
    window.innerHeight = 844

    const raf = stubRaf()
    // ポータル側: 要対応0件のとき、step1〜3すべてが同じ「アクション一覧セクション」
    // 要素を対象にする（セレクタ配列は異なるが、一致するのは同じ要素）。
    const section = document.createElement('div')
    section.setAttribute('data-walkthrough', 'portal-action-section')
    stubNonZeroRect(section, { top: 1227, bottom: 1900, left: 16, right: 374, height: 673 })
    const scrollSpy = vi.fn()
    section.scrollIntoView = scrollSpy
    document.body.appendChild(section)

    const { rerender } = renderHook(
      ({ selectors }: { selectors: readonly string[] }) => useSpotlightRect(selectors, true),
      {
        initialProps: {
          selectors: ['[data-walkthrough="portal-action-section"]'] as readonly string[],
        },
      }
    )
    act(() => {
      raf.flush()
    })
    expect(scrollSpy).toHaveBeenCalledTimes(1)

    // 次のステップへ（セレクタの組が変わる＝新しいステップ）。一致する要素は同じ。
    rerender({
      selectors: [
        '[data-walkthrough="portal-action-card"]',
        '[data-walkthrough="portal-action-section"]',
      ],
    })
    act(() => {
      raf.flush()
    })

    // ステップが変わったのでスクロール判定はリセットされ、画面外のままなら再度呼ばれる。
    expect(scrollSpy).toHaveBeenCalledTimes(2)
  })
})
