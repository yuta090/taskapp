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
 * there isn't enough room, and clamps both axes so the panel (and its action
 * buttons) never render off-screen regardless of target position or window
 * size.
 */
export function clampPanelPosition(
  targetRect: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'width'>,
  panelSize: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = MARGIN
): PanelPosition {
  const spaceBelow = viewport.height - targetRect.bottom
  const spaceAbove = targetRect.top
  const placeBelow = spaceBelow >= panelSize.height + margin || spaceBelow >= spaceAbove

  const rawTop = placeBelow
    ? targetRect.bottom + margin
    : targetRect.top - panelSize.height - margin

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
      const panelRect = panelEl.getBoundingClientRect()
      const { top, left } = clampPanelPosition(
        targetRect,
        { width: panelRect.width, height: panelRect.height },
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
