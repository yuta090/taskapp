/**
 * Burndown Chart Configuration
 *
 * Design: Consistent with GANTT_CONFIG (Linear-inspired precision)
 */

export const BURNDOWN_CONFIG = {
  // Layout
  CHART_HEIGHT: 320,
  CHART_PADDING: { top: 20, right: 20, bottom: 40, left: 50 },
  POINT_RADIUS: 4,
  POINT_RADIUS_HOVER: 6,

  // Colors (consistent with GANTT_CONFIG)
  COLORS: {
    IDEAL_LINE: '#9CA3AF',      // Gray-400
    ACTUAL_LINE: '#3B82F6',     // Blue-500
    ACTUAL_FILL: '#DBEAFE',     // Blue-100 (area under actual line)
    ADDED_TASKS: '#FEF3C7',     // Amber-100 (scope increase band)
    TODAY: '#EF4444',           // Red-500
    GRID: '#E2E8F0',           // Slate-200
    POINT: '#3B82F6',          // Blue-500
    POINT_HOVER: '#1D4ED8',    // Blue-700
    AXIS_TEXT: '#64748B',      // Slate-500
    LABEL_TEXT: '#0F172A',     // Slate-900
  },

  // Display
  GRID_LINES_Y: 5,
  DATE_LABEL_SKIP: 2,

  // Typography
  FONT: {
    FAMILY: 'inherit',
    SIZE_XS: 10,
    SIZE_SM: 11,
    SIZE_BASE: 12,
  },
} as const
