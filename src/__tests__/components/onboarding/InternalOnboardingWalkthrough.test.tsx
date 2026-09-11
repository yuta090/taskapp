import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { InternalOnboardingWalkthrough } from '@/components/onboarding/InternalOnboardingWalkthrough'

const mockMarkDone = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/hooks/useOnboardingFlag', () => ({
  useOnboardingFlag: () => ({ shouldShow: true, markDone: mockMarkDone }),
}))

// Step 2 ("ボールの概念") targets `[data-walkthrough="task-row-ball"]` in the
// live app (see src/components/task/TaskRow.tsx). These tests render that
// target element alongside the walkthrough to control whether it exists.
function renderWithTarget() {
  return render(
    <>
      <div data-walkthrough="task-row-ball">ball badge</div>
      <InternalOnboardingWalkthrough />
    </>
  )
}

// jsdomはレイアウトを計算せず getBoundingClientRect() は既定で全0のDOMRectを
// 返す。useSpotlightRect は0サイズの一致要素を「非表示」とみなしてスキップする
// ため、実際に画面上に存在するという体で書かれたテストには現実的な非ゼロサイズを
// 与える必要がある。target/panel を個別に上書きできるようにしつつ、既定値は
// 「表示されている」を表す非ゼロ矩形にする。
const nativeGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
// usePanelPosition はフェードイン中の transform(scale-95) に影響されないよう
// offsetWidth/offsetHeight でパネルを計測する（getBoundingClientRect は使わない）。
// このため、パネルサイズをテストで差し替えるには offsetWidth/offsetHeight 側も
// スタブする必要がある。
const nativeOffsetWidthDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetWidth'
)!
const nativeOffsetHeightDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetHeight'
)!
const DEFAULT_TARGET_RECT: Partial<DOMRect> = {
  top: 100,
  left: 20,
  right: 320,
  bottom: 140,
  width: 300,
  height: 40,
}
const DEFAULT_PANEL_RECT: Partial<DOMRect> = { width: 320, height: 200 }

/** Stubs getBoundingClientRect/offsetWidth/offsetHeight for elements matched by `selector` (and the walkthrough panel). */
function mockRects(rects: { target?: Partial<DOMRect>; panel?: Partial<DOMRect> } = {}) {
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (this.dataset.testid === 'walkthrough-panel') {
      return {
        top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {},
        ...DEFAULT_PANEL_RECT,
        ...rects.panel,
      } as DOMRect
    }
    if (this.hasAttribute('data-walkthrough')) {
      return {
        top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {},
        ...DEFAULT_TARGET_RECT,
        ...rects.target,
      } as DOMRect
    }
    return nativeGetBoundingClientRect.call(this)
  }

  const panelWidth = rects.panel?.width ?? DEFAULT_PANEL_RECT.width
  const panelHeight = rects.panel?.height ?? DEFAULT_PANEL_RECT.height
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.testid === 'walkthrough-panel') return panelWidth
      return nativeOffsetWidthDescriptor.get!.call(this)
    },
  })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.testid === 'walkthrough-panel') return panelHeight
      return nativeOffsetHeightDescriptor.get!.call(this)
    },
  })
}

function restoreRects() {
  HTMLElement.prototype.getBoundingClientRect = nativeGetBoundingClientRect
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', nativeOffsetWidthDescriptor)
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', nativeOffsetHeightDescriptor)
}

describe('InternalOnboardingWalkthrough spotlight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRects()
  })

  afterEach(() => {
    restoreRects()
  })

  it('renders a centered dialog (no spotlight) for a step without targetSelector', async () => {
    render(<InternalOnboardingWalkthrough />)

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('walkthrough-spotlight-ring')).not.toBeInTheDocument()
  })

  it('falls back to the centered dialog when targetSelector matches no element (regression guard)', async () => {
    render(<InternalOnboardingWalkthrough />)

    await waitFor(() => screen.getByRole('dialog'))

    // Step 0 -> Step 1 ("ボールの概念"), whose target does not exist in this render tree
    fireEvent.click(screen.getByText('次へ'))

    await waitFor(() => {
      expect(screen.getByText('ボールの概念')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('walkthrough-spotlight-ring')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renders a spotlight ring around the target element when it exists', async () => {
    renderWithTarget()

    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByText('次へ'))

    await waitFor(() => {
      expect(screen.getByText('ボールの概念')).toBeInTheDocument()
    })

    expect(screen.getByTestId('walkthrough-spotlight-ring')).toBeInTheDocument()
  })

  it('step1「タスク作成の流れ」は作成導線（task-create）をハイライトする', async () => {
    render(
      <>
        <div data-walkthrough="task-create">empty state</div>
        <InternalOnboardingWalkthrough />
      </>
    )

    await waitFor(() => screen.getByRole('dialog'))
    expect(screen.getByText('タスク作成の流れ')).toBeInTheDocument()
    expect(screen.getByTestId('walkthrough-spotlight-ring')).toBeInTheDocument()
  })

  it('タスク行が無い場合「ボールの概念」はクライアント確認待ちフィルタにフォールバックする', async () => {
    render(
      <>
        {/* task-row-ball は存在しない（新規プロジェクト相当） */}
        <button data-walkthrough="filter-client-wait">クライアント確認待ち</button>
        <InternalOnboardingWalkthrough />
      </>
    )

    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('次へ'))

    await waitFor(() => {
      expect(screen.getByText('ボールの概念')).toBeInTheDocument()
    })
    // フォールバック先がハイライトされる（中央カードに落ちない）
    expect(screen.getByTestId('walkthrough-spotlight-ring')).toBeInTheDocument()
  })

  it('フォールバック先のターゲットをクリックしても次のステップへ進む', async () => {
    render(
      <>
        <button data-walkthrough="filter-client-wait">クライアント確認待ち</button>
        <InternalOnboardingWalkthrough />
      </>
    )

    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('ボールの概念'))

    fireEvent.click(screen.getByText('クライアント確認待ち'))

    await waitFor(() => {
      expect(screen.getByText('クライアントに公開')).toBeInTheDocument()
    })
  })

  it('primaryのタスク行があればフォールバックではなくそちらを使う', async () => {
    render(
      <>
        <div data-walkthrough="task-row-ball">ball badge</div>
        <button data-walkthrough="filter-client-wait">クライアント確認待ち</button>
        <InternalOnboardingWalkthrough />
      </>
    )

    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('ボールの概念'))
    await waitFor(() => screen.getByTestId('walkthrough-spotlight-ring'))

    // primary（タスク行のボール）クリックで進む＝primaryがスポットライト対象
    fireEvent.click(screen.getByText('ball badge'))
    await waitFor(() => {
      expect(screen.getByText('クライアントに公開')).toBeInTheDocument()
    })
  })

  it('準備完了！ステップはLINE秘書連携（QR→コード送信で完了）に触れる', async () => {
    render(<InternalOnboardingWalkthrough />)

    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('ボールの概念'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('クライアントに公開'))
    fireEvent.click(screen.getByText('次へ'))

    await waitFor(() => screen.getByText('準備完了！'))
    expect(screen.getByText(/LINE秘書/)).toBeInTheDocument()
    expect(screen.getByText(/QRで.*追加/)).toBeInTheDocument()
    expect(screen.getByText(/コード送信/)).toBeInTheDocument()
  })

  it('パネル幅はビューポート幅を超えないクラス(calc(100vw-2rem))で制御される', async () => {
    render(<InternalOnboardingWalkthrough />)

    await waitFor(() => screen.getByRole('dialog'))
    expect(screen.getByTestId('walkthrough-panel').className).toContain('w-[calc(100vw-2rem)]')
  })

  it('calls markDone (server + localStorage) when the walkthrough is completed', async () => {
    render(<InternalOnboardingWalkthrough />)

    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('ボールの概念'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('クライアントに公開'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('準備完了！'))
    fireEvent.click(screen.getByText('始めましょう'))

    await waitFor(() => {
      expect(mockMarkDone).toHaveBeenCalledTimes(1)
    })
  })

  // 閲覧者（viewer）には「タスクを追加」ボタンが無いため、それを案内する最初の手順は飛ばす
  describe('編集できない人（canEdit=false）には手順1「タスク作成の流れ」を飛ばす', () => {
    it('最初から「ボールの概念」が出る（タスク作成の案内をしない）', async () => {
      render(<InternalOnboardingWalkthrough canEdit={false} />)

      await waitFor(() => screen.getByRole('dialog'))
      expect(screen.getByText('ボールの概念')).toBeInTheDocument()
      expect(screen.queryByText('タスク作成の流れ')).not.toBeInTheDocument()
    })

    it('canEdit を渡さない（既定）ときは、これまでどおり手順1から出る', async () => {
      render(<InternalOnboardingWalkthrough />)

      await waitFor(() => screen.getByRole('dialog'))
      expect(screen.getByText('タスク作成の流れ')).toBeInTheDocument()
    })
  })

  // 役割（canEdit）が確定する前にガイドを開くと、あとで手順の数が変わって
  // 表示中の内容がすり替わってしまう。役割が確定するまでは開かない。
  describe('役割が確定するまでガイドを開かない（roleResolved）', () => {
    it('roleResolved=false の間はダイアログが開かない', () => {
      render(<InternalOnboardingWalkthrough canEdit={false} roleResolved={false} />)

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('確定後（編集者）なら手順1「タスク作成の流れ」を含めて開く', async () => {
      const { rerender } = render(<InternalOnboardingWalkthrough canEdit={false} roleResolved={false} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      rerender(<InternalOnboardingWalkthrough canEdit={true} roleResolved={true} />)

      await waitFor(() => screen.getByRole('dialog'))
      expect(screen.getByText('タスク作成の流れ')).toBeInTheDocument()
    })

    it('確定後（閲覧者）なら手順1を飛ばして開く', async () => {
      const { rerender } = render(<InternalOnboardingWalkthrough canEdit={false} roleResolved={false} />)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

      rerender(<InternalOnboardingWalkthrough canEdit={false} roleResolved={true} />)

      await waitFor(() => screen.getByRole('dialog'))
      expect(screen.getByText('ボールの概念')).toBeInTheDocument()
      expect(screen.queryByText('タスク作成の流れ')).not.toBeInTheDocument()
    })

    it('roleResolved を渡さない（既定 true）ときは、これまでどおりすぐ開く', async () => {
      render(<InternalOnboardingWalkthrough />)

      await waitFor(() => screen.getByRole('dialog'))
    })
  })

  describe('viewport clamping, escape hatches, and target interaction', () => {
    it('clamps the panel inside the viewport when the target sits near the bottom-right corner', async () => {
      window.innerWidth = 500
      window.innerHeight = 400

      mockRects({
        target: { top: 370, bottom: 395, left: 460, right: 495, width: 35, height: 25 },
        panel: { width: 320, height: 260 },
      })

      renderWithTarget()
      fireEvent.click(screen.getByText('次へ'))

      await waitFor(() => {
        expect(screen.getByTestId('walkthrough-spotlight-ring')).toBeInTheDocument()
      })

      const panel = screen.getByTestId('walkthrough-panel')
      await waitFor(() => {
        expect(panel.style.position).toBe('fixed')
      })

      const top = parseFloat(panel.style.top)
      const left = parseFloat(panel.style.left)
      expect(top).toBeGreaterThanOrEqual(0)
      expect(left).toBeGreaterThanOrEqual(0)
      expect(top + 260).toBeLessThanOrEqual(window.innerHeight)
      expect(left + 320).toBeLessThanOrEqual(window.innerWidth)
    })

    it('closes the tour on Escape', async () => {
      render(<InternalOnboardingWalkthrough />)
      await waitFor(() => screen.getByRole('dialog'))

      fireEvent.keyDown(document, { key: 'Escape' })

      await waitFor(() => {
        expect(mockMarkDone).toHaveBeenCalledTimes(1)
      })
    })

    it('closes the tour when clicking the dimmed backdrop', async () => {
      renderWithTarget()
      fireEvent.click(screen.getByText('次へ'))
      await waitFor(() => screen.getByTestId('walkthrough-spotlight-ring'))

      // The dimmed area is made of blocking rects that close the tour.
      fireEvent.click(screen.getAllByTestId('walkthrough-backdrop')[0])

      await waitFor(() => {
        expect(mockMarkDone).toHaveBeenCalledTimes(1)
      })
    })

    it('does not close the tour on clicks that reach elements under the dimmed area', async () => {
      renderWithTarget()
      fireEvent.click(screen.getByText('次へ'))
      await waitFor(() => screen.getByTestId('walkthrough-spotlight-ring'))

      fireEvent.click(document.body)

      expect(mockMarkDone).not.toHaveBeenCalled()
    })

    it('renders the dimmed area with pointer-events enabled so it blocks the UI underneath', async () => {
      renderWithTarget()
      fireEvent.click(screen.getByText('次へ'))
      await waitFor(() => screen.getByTestId('walkthrough-spotlight-ring'))

      for (const el of screen.getAllByTestId('walkthrough-backdrop')) {
        expect(el.className).toContain('pointer-events-auto')
      }
    })

    it('advances to the next step when the spotlighted target is clicked', async () => {
      renderWithTarget()
      fireEvent.click(screen.getByText('次へ'))
      await waitFor(() => screen.getByTestId('walkthrough-spotlight-ring'))

      fireEvent.click(screen.getByText('ball badge'))

      await waitFor(() => {
        expect(screen.getByText('クライアントに公開')).toBeInTheDocument()
      })
    })
  })
})
