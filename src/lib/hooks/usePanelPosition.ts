'use client'

import { useLayoutEffect, useState, type RefObject } from 'react'

const MARGIN = 16

export interface PanelPosition {
  top: number
  left: number
}

/**
 * Computes a fixed top/left for the walkthrough panel that keeps it fully
 * inside the viewport: prefers placing it below the target, flips above when
 * there isn't enough room below (but there is above), and clamps both axes
 * so the panel (and its action buttons) never render off-screen regardless
 * of target position or window size.
 *
 * When the panel fits on NEITHER side (e.g. a tall spotlighted section on a
 * short mobile viewport), it docks to the bottom of the viewport instead of
 * naively flipping above — flipping above would push the panel up over the
 * target's top edge (its heading / first item), which is exactly the part
 * that should stay visible.
 */
export function clampPanelPosition(
  targetRect: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width'>,
  panelSize: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = MARGIN
): PanelPosition {
  const spaceBelow = viewport.height - targetRect.bottom
  const spaceAbove = targetRect.top
  const fitsBelow = spaceBelow >= panelSize.height + margin
  const fitsAbove = spaceAbove >= panelSize.height + margin

  let rawTop: number
  if (fitsBelow) {
    rawTop = targetRect.bottom + margin
  } else if (fitsAbove) {
    rawTop = targetRect.top - panelSize.height - margin
  } else {
    // Fits neither side: dock to the bottom of the viewport so the target's
    // top (heading / first item) stays uncovered instead of getting hidden
    // under the panel.
    rawTop = viewport.height - panelSize.height - margin
  }

  const maxTop = Math.max(margin, viewport.height - panelSize.height - margin)
  const top = Math.min(Math.max(rawTop, margin), maxTop)

  const rawLeft = targetRect.left + targetRect.width / 2 - panelSize.width / 2
  const maxLeft = Math.max(margin, viewport.width - panelSize.width - margin)
  const left = Math.min(Math.max(rawLeft, margin), maxLeft)

  return { top, left }
}

/**
 * Tracks a `position: fixed` style for `panelRef` that stays clamped inside
 * the viewport relative to `targetRect`. Returns undefined when there is no
 * target — callers should fall back to a centered dialog in that case.
 */
export function usePanelPosition(
  panelRef: RefObject<HTMLElement | null>,
  targetRect: DOMRect | null
): React.CSSProperties | undefined {
  const [style, setStyle] = useState<React.CSSProperties | undefined>(undefined)

  useLayoutEffect(() => {
    if (!targetRect) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets to the centered-dialog fallback when the target disappears
      setStyle(undefined)
      return
    }

    const measure = () => {
      const panelEl = panelRef.current
      if (!panelEl) return
      // getBoundingClientRect() はCSS transform(フェードイン時の scale-95)の
      // 影響を受け、アニメーション中は実寸より小さい値を返す。レイアウト上の
      // 実寸(transformの影響を受けない offsetWidth/offsetHeight)で計測する。
      const { top, left } = clampPanelPosition(
        targetRect,
        { width: panelEl.offsetWidth, height: panelEl.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
      setStyle({ position: 'fixed', top, left })
    }

    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [panelRef, targetRect])

  return style
}
