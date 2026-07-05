import { describe, it, expect } from 'vitest'
import { clampPanelPosition } from './usePanelPosition'

const viewport = { width: 1440, height: 900 }

describe('clampPanelPosition', () => {
  it('places the panel below the target when there is room', () => {
    const targetRect = { top: 100, bottom: 140, left: 200, width: 100 }
    const { top, left } = clampPanelPosition(targetRect, { width: 320, height: 200 }, viewport)

    expect(top).toBe(156) // targetRect.bottom + margin(16)
    expect(left).toBe(90) // centered under target: 200 + 100/2 - 320/2
  })

  it('flips above the target when there is not enough room below', () => {
    const targetRect = { top: 750, bottom: 800, left: 200, width: 100 }
    const { top } = clampPanelPosition(targetRect, { width: 320, height: 200 }, viewport)

    expect(top).toBe(534) // targetRect.top - panelHeight(200) - margin(16)
  })

  it('clamps the top so the panel never renders above the viewport', () => {
    // Target near the very top with a panel taller than the space above it.
    const targetRect = { top: 20, bottom: 60, left: 200, width: 100 }
    const { top } = clampPanelPosition(targetRect, { width: 320, height: 900 }, viewport)

    expect(top).toBeGreaterThanOrEqual(16)
  })

  it('clamps the top so the panel never renders below the viewport', () => {
    // Target flush against the bottom with a panel taller than remaining space.
    const targetRect = { top: 860, bottom: 895, left: 200, width: 100 }
    const { top } = clampPanelPosition(targetRect, { width: 320, height: 400 }, viewport)

    expect(top + 400).toBeLessThanOrEqual(viewport.height)
    expect(top).toBeGreaterThanOrEqual(0)
  })

  it('clamps the left edge so the panel never renders off the left of the viewport', () => {
    const targetRect = { top: 100, bottom: 140, left: 0, width: 20 }
    const { left } = clampPanelPosition(targetRect, { width: 320, height: 200 }, viewport)

    expect(left).toBeGreaterThanOrEqual(16)
  })

  it('clamps the right edge so the panel never renders off the right of the viewport', () => {
    const targetRect = { top: 100, bottom: 140, left: 1400, width: 30 }
    const { left } = clampPanelPosition(targetRect, { width: 320, height: 200 }, viewport)

    expect(left + 320).toBeLessThanOrEqual(viewport.width)
  })

  it('keeps the whole panel on-screen for a target pinned to the bottom-right corner', () => {
    const smallViewport = { width: 500, height: 400 }
    const targetRect = { top: 370, bottom: 395, left: 460, width: 35 }
    const panelSize = { width: 320, height: 260 }

    const { top, left } = clampPanelPosition(targetRect, panelSize, smallViewport)

    expect(top).toBeGreaterThanOrEqual(0)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top + panelSize.height).toBeLessThanOrEqual(smallViewport.height)
    expect(left + panelSize.width).toBeLessThanOrEqual(smallViewport.width)
  })
})
