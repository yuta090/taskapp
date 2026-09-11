import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PortalOnboardingWalkthrough } from '@/components/portal/PortalOnboardingWalkthrough'

const mockMarkDone = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/hooks/useOnboardingFlag', () => ({
  useOnboardingFlag: () => ({ shouldShow: true, markDone: mockMarkDone }),
}))

// Step 1 ("確認が必要なタスク") targets `[data-walkthrough="portal-action-section"]`
// in the live app (see src/components/portal/dashboard/ActionSection.tsx).
function renderWithTarget() {
  return render(
    <>
      <div data-walkthrough="portal-action-section">action list</div>
      <PortalOnboardingWalkthrough />
    </>
  )
}

// jsdomはレイアウトを計算せず getBoundingClientRect() は既定で全0のDOMRectを
// 返す。useSpotlightRect は0サイズの一致要素を「非表示」とみなしてスキップする
// ため、実際に画面上に存在するという体で書かれたテストには現実的な非ゼロサイズを
// 与える必要がある。target/panel を個別に上書きできるようにしつつ、既定値は
// 「表示されている」を表す非ゼロ矩形にする。
const nativeGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
const DEFAULT_TARGET_RECT: Partial<DOMRect> = {
  top: 100,
  left: 20,
  right: 320,
  bottom: 140,
  width: 300,
  height: 40,
}
const DEFAULT_PANEL_RECT: Partial<DOMRect> = { width: 320, height: 200 }

/** Stubs getBoundingClientRect for elements matched by `selector` (and the walkthrough panel). */
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
}

describe('PortalOnboardingWalkthrough spotlight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRects()
  })

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = nativeGetBoundingClientRect
  })

  it('falls back to the centered dialog when targetSelector matches no element (regression guard)', async () => {
    render(<PortalOnboardingWalkthrough />)

    await waitFor(() => {
      expect(screen.getByText('確認が必要なタスク')).toBeInTheDocument()
    })

    expect(screen.queryByTestId('walkthrough-spotlight-ring')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('renders a spotlight ring around the target element when it exists', async () => {
    renderWithTarget()

    await waitFor(() => {
      expect(screen.getByTestId('walkthrough-spotlight-ring')).toBeInTheDocument()
    })
  })

  it('要対応タスクが0件でも step2/3 はアクション一覧セクションにフォールバックしてハイライトする', async () => {
    render(
      <>
        {/* action-card / action-buttons は存在しない（要対応0件） */}
        <div data-walkthrough="portal-action-section">action list</div>
        <PortalOnboardingWalkthrough />
      </>
    )

    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('次へ'))

    await waitFor(() => {
      expect(screen.getByText('カードを押して詳細を見る')).toBeInTheDocument()
    })
    expect(screen.getByTestId('walkthrough-spotlight-ring')).toBeInTheDocument()

    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => {
      expect(screen.getByText('承認・修正依頼')).toBeInTheDocument()
    })
    expect(screen.getByTestId('walkthrough-spotlight-ring')).toBeInTheDocument()
  })

  it('要対応タスクが0件のとき、step2/3はカードが無い状態向けの説明文にフォールバックする（「右側」は使わない）', async () => {
    render(
      <>
        {/* action-card / action-buttons は存在しない（要対応0件） */}
        <div data-walkthrough="portal-action-section">action list</div>
        <PortalOnboardingWalkthrough />
      </>
    )

    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('次へ'))

    await waitFor(() => {
      expect(
        screen.getByText(
          '確認が必要なものが届くと、ここにカードが並びます。カードを押すと、詳しい説明や期限が開きます。'
        )
      ).toBeInTheDocument()
    })
    expect(screen.queryByText(/右側/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => {
      expect(
        screen.getByText('カードを開くと、承認するか修正を依頼するかを選べます。')
      ).toBeInTheDocument()
    })
    expect(screen.queryByText(/右側/)).not.toBeInTheDocument()
  })

  it('カードが存在するときは通常の説明文を使う（フォールバックしない）', async () => {
    render(
      <>
        <div data-walkthrough="portal-action-section">
          action list
          <div data-walkthrough="portal-action-card">card</div>
          <div data-walkthrough="portal-action-buttons">buttons</div>
        </div>
        <PortalOnboardingWalkthrough />
      </>
    )

    await waitFor(() => screen.getByRole('dialog'))
    fireEvent.click(screen.getByText('次へ'))

    await waitFor(() => {
      expect(screen.getByText('カードを押すと、詳しい説明や期限が開きます。')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => {
      expect(
        screen.getByText('問題なければ承認、修正が必要なら修正依頼を選びます。')
      ).toBeInTheDocument()
    })
  })

  it('パネル幅はビューポート幅を超えないクラス(calc(100vw-2rem))で制御される', async () => {
    render(<PortalOnboardingWalkthrough />)

    await waitFor(() => screen.getByRole('dialog'))
    expect(screen.getByTestId('walkthrough-panel').className).toContain('w-[calc(100vw-2rem)]')
  })

  it('calls markDone (server + localStorage) when the walkthrough is completed', async () => {
    render(<PortalOnboardingWalkthrough />)

    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('カードを押して詳細を見る'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('承認・修正依頼'))
    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('準備完了です！'))
    fireEvent.click(screen.getByText('始めましょう'))

    await waitFor(() => {
      expect(mockMarkDone).toHaveBeenCalledTimes(1)
    })
  })

  describe('viewport clamping, escape hatches, and target interaction', () => {
    it('clamps the panel inside the viewport when the target sits near the bottom-right corner', async () => {
      // Small viewport, target flush against the bottom-right, and a panel
      // larger than the remaining space in every direction — without
      // clamping this would place the panel (and its buttons) off-screen.
      window.innerWidth = 500
      window.innerHeight = 400

      mockRects({
        target: { top: 370, bottom: 395, left: 460, right: 495, width: 35, height: 25 },
        panel: { width: 320, height: 260 },
      })

      renderWithTarget()

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
      render(<PortalOnboardingWalkthrough />)
      await waitFor(() => screen.getByRole('dialog'))

      fireEvent.keyDown(document, { key: 'Escape' })

      await waitFor(() => {
        expect(mockMarkDone).toHaveBeenCalledTimes(1)
      })
    })

    it('closes the tour when clicking the dimmed backdrop', async () => {
      renderWithTarget()
      await waitFor(() => screen.getByTestId('walkthrough-spotlight-ring'))

      // The dimmed area is made of blocking rects that close the tour.
      fireEvent.click(screen.getAllByTestId('walkthrough-backdrop')[0])

      await waitFor(() => {
        expect(mockMarkDone).toHaveBeenCalledTimes(1)
      })
    })

    it('does not close the tour on clicks that reach elements under the dimmed area', async () => {
      // Clicks on the page outside the backdrop rects (e.g. dispatched
      // programmatically) must neither close nor advance the tour: the
      // dimmed area itself blocks real pointer events.
      renderWithTarget()
      await waitFor(() => screen.getByTestId('walkthrough-spotlight-ring'))

      fireEvent.click(document.body)

      expect(mockMarkDone).not.toHaveBeenCalled()
    })

    it('renders the dimmed area with pointer-events enabled so it blocks the UI underneath', async () => {
      renderWithTarget()
      await waitFor(() => screen.getByTestId('walkthrough-spotlight-ring'))

      for (const el of screen.getAllByTestId('walkthrough-backdrop')) {
        expect(el.className).toContain('pointer-events-auto')
      }
    })

    it('advances to the next step when the spotlighted target is clicked', async () => {
      renderWithTarget()
      await waitFor(() => screen.getByTestId('walkthrough-spotlight-ring'))

      fireEvent.click(screen.getByText('action list'))

      await waitFor(() => {
        expect(screen.getByText('カードを押して詳細を見る')).toBeInTheDocument()
      })
    })
  })
})
