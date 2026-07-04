'use client'

import { useEffect, useState } from 'react'

/**
 * Tracks the bounding rect of the element matched by `targetSelector` while
 * `active`, updating on resize/scroll. Returns null when there is no
 * selector, `active` is false, or no element currently matches — callers
 * should fall back to a non-spotlight (e.g. centered) layout in that case.
 */
export function useSpotlightRect(
  targetSelector: string | undefined,
  active: boolean
): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!active || !targetSelector) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets to the no-spotlight state when deactivated/selector cleared
      setRect(null)
      return
    }

    const update = () => {
      const el = document.querySelector(targetSelector)
      setRect(el ? el.getBoundingClientRect() : null)
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [targetSelector, active])

  return rect
}
