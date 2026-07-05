'use client'

import { useEffect, useState } from 'react'

/**
 * Tracks whether the viewport is below the `md` breakpoint (768px) — the same
 * breakpoint the mobile shell (AppShell) and portal use. SSR-safe: returns
 * `false` on the server / first paint, then syncs on mount and on resize.
 *
 * Kept in sync with Tailwind's `md` (768px). If that changes, update here too.
 */
const MOBILE_QUERY = '(max-width: 767px)'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mql = window.matchMedia(MOBILE_QUERY)
    const update = () => setIsMobile(mql.matches)
    update()
    mql.addEventListener('change', update)
    return () => mql.removeEventListener('change', update)
  }, [])

  return isMobile
}
