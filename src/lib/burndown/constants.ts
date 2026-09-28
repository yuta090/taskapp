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

  // Colors - 実値は globals.css の :root / .dark（ダークで面と文字が入れ替わる）。
  // SVG には Tailwind の utility が効かないため、var() 参照をそのまま fill/stroke に渡す。
  COLORS: {
    IDEAL_LINE: 'var(--burndown-ideal-line)',
    ACTUAL_LINE: 'var(--burndown-actual-line)',
    ACTUAL_FILL: 'var(--burndown-actual-fill)',   // area under actual line
    ADDED_TASKS: 'var(--burndown-added-tasks)',   // scope increase band
    TODAY: 'var(--burndown-today)',
    GRID: 'var(--burndown-grid)',
    POINT: 'var(--burndown-point)',
    POINT_HOVER: 'var(--burndown-point-hover)',
    POINT_STROKE: 'var(--burndown-point-stroke)',
    AXIS_TEXT: 'var(--burndown-axis-text)',
    LABEL_TEXT: 'var(--burndown-label-text)',

    // 記録が無い期間の帯
    ESTIMATE_BAND: 'var(--burndown-estimate-band)',
    ESTIMATE_TEXT: 'var(--burndown-estimate-text)',

    // ホバーで出る吹き出し
    TOOLTIP_BG: 'var(--burndown-tooltip-bg)',
    TOOLTIP_FG: 'var(--burndown-tooltip-fg)',
    TOOLTIP_FG_MUTED: 'var(--burndown-tooltip-fg-muted)',
    TOOLTIP_ADDED: 'var(--burndown-tooltip-added)',
    TOOLTIP_REOPENED: 'var(--burndown-tooltip-reopened)',
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
