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
  if (typeof window === 'undefined') return SIDEBAR_WIDTH_DEFAULT
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
 * The stored width is read in the lazy initializer, so the very first client
 * render already uses it (no 240px → stored-width jump). GanttChart is only
 * mounted behind a client-side loading gate, so there is no SSR/hydration
 * mismatch to worry about; on the server the default is returned.
 */
export function useGanttSidebarWidth(): UseGanttSidebarWidthResult {
  const [width, setWidthState] = useState<number>(readStored)
  const [isResizing, setIsResizing] = useState(false)
  // Mirror of `width` for event handlers registered once (pointer listeners).
  // Written only through `setWidth` below, never during render.
  const widthRef = useRef(width)
  // Detach handler for an in-flight drag, so unmounting mid-drag leaves no listeners.
  const stopDragRef = useRef<(() => void) | null>(null)

  const setWidth = useCallback((next: number) => {
    widthRef.current = next
    setWidthState(next)
  }, [])

  useEffect(() => {
    return () => {
      stopDragRef.current?.()
    }
  }, [])

  const startResize = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    stopDragRef.current?.()
    const startX = e.clientX
    const startWidth = widthRef.current
    setIsResizing(true)
    // Keep receiving moves even if the pointer leaves the window / enters an iframe.
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId)
    } catch {
      // jsdom / older browsers: window listeners below still cover the normal case
    }

    const onMove = (ev: PointerEvent | MouseEvent) => {
      setWidth(clampSidebarWidth(startWidth + (ev.clientX - startX)))
    }
    const detach = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      stopDragRef.current = null
    }
    const onUp = () => {
      detach()
      setIsResizing(false)
      writeStored(widthRef.current)
    }
    stopDragRef.current = detach
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
