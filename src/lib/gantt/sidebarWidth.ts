/**
 * Gantt task-name column (sidebar) width.
 *
 * The user can drag the column edge; the chosen width is remembered per
 * browser in localStorage. Pure helpers live here so they can be unit-tested
 * without React.
 */
import { GANTT_CONFIG } from './constants'

export const GANTT_SIDEBAR_WIDTH_STORAGE_KEY = 'gantt:sidebarWidth'

export const SIDEBAR_WIDTH_DEFAULT = GANTT_CONFIG.SIDEBAR_WIDTH
/** Narrow enough to save space but still show the ball dot + a few characters + status badge. */
export const SIDEBAR_WIDTH_MIN = 160
/** Wide enough for long Japanese titles while keeping the timeline visible on a laptop. */
export const SIDEBAR_WIDTH_MAX = 640
/** Keyboard step (ArrowLeft / ArrowRight) on the resize handle. */
export const SIDEBAR_WIDTH_KEY_STEP = 16

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT
  const rounded = Math.round(width)
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, rounded))
}

export function parseStoredSidebarWidth(raw: string | null): number {
  if (raw == null || raw.trim() === '') return SIDEBAR_WIDTH_DEFAULT
  const n = Number(raw)
  if (!Number.isFinite(n)) return SIDEBAR_WIDTH_DEFAULT
  return clampSidebarWidth(n)
}
