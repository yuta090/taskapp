/**
 * Gantt Chart Configuration
 *
 * Design: Precision & Density (Linear-inspired)
 * - Cool foundation with functional color coding
 * - 4px grid system
 * - Tight spacing for data density
 */

export const GANTT_CONFIG = {
  // Layout (4px grid)
  ROW_HEIGHT: 36,
  HEADER_HEIGHT: 48,
  BAR_HEIGHT: 20,
  BAR_VERTICAL_PADDING: 8,
  SIDEBAR_WIDTH: 240,
  DAY_WIDTH: 40,
  WEEK_WIDTH: 28, // per day when in week mode
  MONTH_WIDTH: 8, // per day when in month mode
  MIN_BAR_WIDTH: 4,

  // Colors - Cool foundation with semantic accents
  COLORS: {
    // Ball ownership (functional meaning)
    CLIENT: '#F59E0B',      // Amber-500 - client visible
    INTERNAL: '#3B82F6',    // Blue-500 - internal

    // Status
    DONE: '#6B7280',        // Gray-500
    IN_PROGRESS: '#3B82F6', // Blue-500
    BACKLOG: '#9CA3AF',     // Gray-400

    // Timeline
    TODAY: '#EF4444',       // Red-500
    WEEKEND: '#F9FAFB',     // Gray-50
    GRID_LINE: '#E5E7EB',   // Gray-200
    HEADER_BG: '#F9FAFB',   // Gray-50

    // Milestones - urgency based colors
    MILESTONE: '#60A5FA',        // Blue-400 - normal (8+ days)
    MILESTONE_BG: '#EFF6FF',     // Blue-50
    MILESTONE_WARN: '#F59E0B',   // Amber-500 - warning (4-7 days)
    MILESTONE_WARN_BG: '#FEF3C7', // Amber-100
    MILESTONE_URGENT: '#EF4444', // Red-500 - urgent (0-3 days)
    MILESTONE_URGENT_BG: '#FEE2E2', // Red-100
    MILESTONE_PAST: '#6B7280',   // Gray-500 - overdue
    MILESTONE_PAST_BG: '#F3F4F6', // Gray-100

    // Parent task summary bar
    PARENT_BAR: '#6366F1',       // Indigo-500
    PARENT_BAR_BG: '#E0E7FF',    // Indigo-100

    // Text
    TEXT_PRIMARY: '#111827',   // Gray-900
    TEXT_SECONDARY: '#6B7280', // Gray-500
    TEXT_MUTED: '#9CA3AF',     // Gray-400
  },

  // Typography
  FONT: {
    FAMILY: 'inherit',
    SIZE_XS: 10,
    SIZE_SM: 11,
    SIZE_BASE: 12,
    SIZE_LG: 13,
  },

  // Animation
  TRANSITION: {
    DURATION: '150ms',
    EASING: 'cubic-bezier(0.25, 1, 0.5, 1)',
  },

  // Border radius (sharp system for technical feel)
  RADIUS: {
    SM: 4,
    MD: 6,
    LG: 8,
  },
} as const

export type ViewMode = 'day' | 'week' | 'month'

export const VIEW_MODE_CONFIG: Record<ViewMode, { dayWidth: number; label: string }> = {
  day: { dayWidth: GANTT_CONFIG.DAY_WIDTH, label: '日' },
  week: { dayWidth: GANTT_CONFIG.WEEK_WIDTH, label: '週' },
  month: { dayWidth: GANTT_CONFIG.MONTH_WIDTH, label: '月' },
}
