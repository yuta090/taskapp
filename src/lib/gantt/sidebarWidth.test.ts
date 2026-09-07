import { describe, it, expect } from 'vitest'
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MIN,
  SIDEBAR_WIDTH_MAX,
  clampSidebarWidth,
  parseStoredSidebarWidth,
} from './sidebarWidth'

describe('clampSidebarWidth', () => {
  it('keeps a width inside the allowed range as-is', () => {
    expect(clampSidebarWidth(300)).toBe(300)
  })

  it('clamps below the minimum so the name column never collapses', () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_WIDTH_MIN)
    expect(clampSidebarWidth(-500)).toBe(SIDEBAR_WIDTH_MIN)
  })

  it('clamps above the maximum so the chart stays visible', () => {
    expect(clampSidebarWidth(5000)).toBe(SIDEBAR_WIDTH_MAX)
  })

  it('rounds fractional pixels to avoid blurry borders', () => {
    expect(clampSidebarWidth(300.6)).toBe(301)
  })

  it('falls back to the default for NaN / Infinity', () => {
    expect(clampSidebarWidth(Number.NaN)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(SIDEBAR_WIDTH_DEFAULT)
  })
})

describe('parseStoredSidebarWidth', () => {
  it('returns the default when nothing is stored', () => {
    expect(parseStoredSidebarWidth(null)).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(parseStoredSidebarWidth('')).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  it('parses a stored numeric string', () => {
    expect(parseStoredSidebarWidth('320')).toBe(320)
  })

  it('returns the default for garbage', () => {
    expect(parseStoredSidebarWidth('abc')).toBe(SIDEBAR_WIDTH_DEFAULT)
    expect(parseStoredSidebarWidth('{}')).toBe(SIDEBAR_WIDTH_DEFAULT)
  })

  it('clamps stored values that are out of range (e.g. edited by hand)', () => {
    expect(parseStoredSidebarWidth('1')).toBe(SIDEBAR_WIDTH_MIN)
    expect(parseStoredSidebarWidth('99999')).toBe(SIDEBAR_WIDTH_MAX)
  })

  it('default sits inside [min, max]', () => {
    expect(SIDEBAR_WIDTH_DEFAULT).toBeGreaterThanOrEqual(SIDEBAR_WIDTH_MIN)
    expect(SIDEBAR_WIDTH_DEFAULT).toBeLessThanOrEqual(SIDEBAR_WIDTH_MAX)
  })
})
