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

/** Stubs getBoundingClientRect for elements matched by `selector` (and the walkthrough panel). */
function mockRects(rects: {
  target?: Partial<DOMRect>
  panel?: Partial<DOMRect>
}) {
  const original = HTMLElement.prototype.getBoundingClientRect
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    if (rects.panel && this.dataset.testid === 'walkthrough-panel') {
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {}, ...rects.panel }
    }
    if (rects.target && this.hasAttribute('data-walkthrough')) {
      return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {}, ...rects.target }
    }
    return original.call(this)
  }
  return () => {
    HTMLElement.prototype.getBoundingClientRect = original
  }
}

describe('PortalOnboardingWalkthrough spotlight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('calls markDone (server + localStorage) when the walkthrough is completed', async () => {
    render(<PortalOnboardingWalkthrough />)

    await waitFor(() => screen.getByRole('dialog'))

    fireEvent.click(screen.getByText('次へ'))
    await waitFor(() => screen.getByText('クリックして詳細を見る'))
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
    let restoreRects: (() => void) | undefined

    afterEach(() => {
      restoreRects?.()
      restoreRects = undefined
    })

    it('clamps the panel inside the viewport when the target sits near the bottom-right corner', async () => {
      // Small viewport, target flush against the bottom-right, and a panel
      // larger than the remaining space in every direction — without
      // clamping this would place the panel (and its buttons) off-screen.
      window.innerWidth = 500
      window.innerHeight = 400

      restoreRects = mockRects({
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
        expect(screen.getByText('クリックして詳細を見る')).toBeInTheDocument()
      })
    })
  })
})
