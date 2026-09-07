'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  GANTT_SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_WIDTH_DEFAULT,
  clampSidebarWidth,
  parseStoredSidebarWidth,
} from '@/lib/gantt/sidebarWidth'

export interface UseGanttSidebarWidthResult {
  width: number
  isResizing: boolean
  /** Attach to the resize handle's onPointerDown. */
  startResize: (e: React.PointerEvent<HTMLElement>) => void
  /** Keyboard / button nudges. Persists immediately. */
  adjustBy: (delta: number) => void
  /** Back to the default width and forget the stored value. */
  reset: () => void
}

function readStored(): number {
  try {
    return parseStoredSidebarWidth(localStorage.getItem(GANTT_SIDEBAR_WIDTH_STORAGE_KEY))
  } catch {
    return SIDEBAR_WIDTH_DEFAULT
  }
}

function writeStored(width: number) {
  try {
    localStorage.setItem(GANTT_SIDEBAR_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // Private mode / blocked storage: the width still applies for this session.
  }
}

function clearStored() {
  try {
    localStorage.removeItem(GANTT_SIDEBAR_WIDTH_STORAGE_KEY)
  } catch {
    // ignore
  }
}

/**
 * Width of the Gantt task-name column, user-adjustable by dragging the column
 * edge. Persisted per browser in localStorage.
 *
 * Starts at the default on the server and swaps to the stored value after
 * mount so SSR and the first client render agree (no hydration mismatch).
 */
export function useGanttSidebarWidth(): UseGanttSidebarWidthResult {
  const [width, setWidthState] = useState<number>(SIDEBAR_WIDTH_DEFAULT)
  const [isResizing, setIsResizing] = useState(false)
  // Mirror of `width` for event handlers registered once (pointer listeners).
  // Written only through `setWidth` below, never during render.
  const widthRef = useRef(SIDEBAR_WIDTH_DEFAULT)

  const setWidth = useCallback((next: number) => {
    widthRef.current = next
    setWidthState(next)
  }, [])

  useEffect(() => {
    const stored = readStored()
    if (stored !== SIDEBAR_WIDTH_DEFAULT) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from localStorage after mount so SSR and first client render agree
      setWidth(stored)
    }
  }, [setWidth])

  const startResize = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = widthRef.current
    setIsResizing(true)

    const onMove = (ev: PointerEvent | MouseEvent) => {
      setWidth(clampSidebarWidth(startWidth + (ev.clientX - startX)))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      setIsResizing(false)
      writeStored(widthRef.current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [setWidth])

  const adjustBy = useCallback((delta: number) => {
    const next = clampSidebarWidth(widthRef.current + delta)
    setWidth(next)
    writeStored(next)
  }, [setWidth])

  const reset = useCallback(() => {
    setWidth(SIDEBAR_WIDTH_DEFAULT)
    clearStored()
  }, [setWidth])

  return { width, isResizing, startResize, adjustBy, reset }
}
