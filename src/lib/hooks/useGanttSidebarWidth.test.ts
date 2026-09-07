import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useGanttSidebarWidth } from './useGanttSidebarWidth'
import {
  GANTT_SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
} from '@/lib/gantt/sidebarWidth'

function pointerDown(clientX: number) {
  return {
    clientX,
    pointerId: 1,
    button: 0,
    preventDefault: () => {},
  } as unknown as React.PointerEvent<HTMLElement>
}

function firePointerMove(clientX: number) {
  window.dispatchEvent(new MouseEvent('pointermove', { clientX, bubbles: true }))
}

function firePointerUp() {
  window.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
}

describe('useGanttSidebarWidth', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('starts with the default width when nothing is stored', () => {
    const { result } = renderHook(() => useGanttSidebarWidth())
    expect(result.current.width).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(result.current.isResizing).toBe(false)
  })

  it('restores a previously stored width on mount', () => {
    localStorage.setItem(GANTT_SIDEBAR_WIDTH_STORAGE_KEY, '360')
    const { result } = renderHook(() => useGanttSidebarWidth())
    expect(result.current.width).toBe(360)
  })

  it('widens while dragging to the right and persists on release', () => {
    const { result } = renderHook(() => useGanttSidebarWidth())

    act(() => result.current.startResize(pointerDown(100)))
    expect(result.current.isResizing).toBe(true)

    act(() => firePointerMove(180))
    expect(result.current.width).toBe(SIDEBAR_WIDTH_DEFAULT + 80)

    act(() => firePointerUp())
    expect(result.current.isResizing).toBe(false)
    expect(localStorage.getItem(GANTT_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(SIDEBAR_WIDTH_DEFAULT + 80))
  })

  it('narrows while dragging to the left but never below the minimum', () => {
    const { result } = renderHook(() => useGanttSidebarWidth())

    act(() => result.current.startResize(pointerDown(500)))
    act(() => firePointerMove(0))
    expect(result.current.width).toBe(SIDEBAR_WIDTH_MIN)
    act(() => firePointerUp())
    expect(localStorage.getItem(GANTT_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(SIDEBAR_WIDTH_MIN))
  })

  it('never exceeds the maximum when dragged far right', () => {
    const { result } = renderHook(() => useGanttSidebarWidth())

    act(() => result.current.startResize(pointerDown(0)))
    act(() => firePointerMove(5000))
    expect(result.current.width).toBe(SIDEBAR_WIDTH_MAX)
    act(() => firePointerUp())
  })

  it('ignores pointer moves after release', () => {
    const { result } = renderHook(() => useGanttSidebarWidth())

    act(() => result.current.startResize(pointerDown(0)))
    act(() => firePointerMove(40))
    act(() => firePointerUp())
    const settled = result.current.width

    act(() => firePointerMove(400))
    expect(result.current.width).toBe(settled)
  })

  it('adjusts by keyboard step and persists', () => {
    const { result } = renderHook(() => useGanttSidebarWidth())

    act(() => result.current.adjustBy(16))
    expect(result.current.width).toBe(SIDEBAR_WIDTH_DEFAULT + 16)
    expect(localStorage.getItem(GANTT_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(SIDEBAR_WIDTH_DEFAULT + 16))

    act(() => result.current.adjustBy(-32))
    expect(result.current.width).toBe(SIDEBAR_WIDTH_DEFAULT - 16)
  })

  it('reset returns to the default and clears storage', () => {
    localStorage.setItem(GANTT_SIDEBAR_WIDTH_STORAGE_KEY, '400')
    const { result } = renderHook(() => useGanttSidebarWidth())
    expect(result.current.width).toBe(400)

    act(() => result.current.reset())
    expect(result.current.width).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(localStorage.getItem(GANTT_SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull()
  })
})
