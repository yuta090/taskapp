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
  HEADER_HEIGHT: 72,
  BAR_HEIGHT: 20,
  BAR_VERTICAL_PADDING: 8,
  SIDEBAR_WIDTH: 240,
  DAY_WIDTH: 40,
  WEEK_WIDTH: 28, // per day when in week mode
  MONTH_WIDTH: 8, // per day when in month mode
  MIN_BAR_WIDTH: 4,

  // Colors - 実値は globals.css の :root / .dark（ダークで面と文字が入れ替わる）。
  // SVG には Tailwind の utility が効かないため、var() 参照をそのまま fill/stroke に渡す。
  COLORS: {
    // Ball ownership (functional meaning)
    CLIENT: 'var(--gantt-client)',      // Amber-500 - client visible
    INTERNAL: 'var(--gantt-internal)',

    // Status
    DONE: 'var(--gantt-done)',
    IN_PROGRESS: 'var(--gantt-in-progress)',
    BACKLOG: 'var(--gantt-backlog)',
    OVERDUE: 'var(--gantt-overdue)',    // 期限切れ・未完了のバーの枠（塗りはボールの色のまま）

    // Timeline
    TODAY: 'var(--gantt-today)',
    TODAY_COLUMN: 'var(--gantt-today-column)',
    WEEKEND: 'var(--gantt-weekend)',
    GRID_LINE: 'var(--gantt-grid-line)',
    HEADER_BG: 'var(--gantt-header-bg)',
    GROUP_HEADER_BG: 'var(--gantt-group-header-bg)',
    ROW_SELECTED: 'var(--gantt-row-selected)',

    // Milestones - urgency based colors
    MILESTONE: 'var(--gantt-milestone)',
    MILESTONE_BG: 'var(--gantt-milestone-bg)',
    MILESTONE_WARN: 'var(--gantt-milestone-warn)',
    MILESTONE_WARN_BG: 'var(--gantt-milestone-warn-bg)',
    MILESTONE_URGENT: 'var(--gantt-milestone-urgent)',
    MILESTONE_URGENT_BG: 'var(--gantt-milestone-urgent-bg)',
    MILESTONE_PAST: 'var(--gantt-milestone-past)',
    MILESTONE_PAST_BG: 'var(--gantt-milestone-past-bg)',

    // Parent task summary bar
    PARENT_BAR: 'var(--gantt-parent-bar)',
    PARENT_BAR_BG: 'var(--gantt-parent-bar-bg)',

    // Text
    TEXT_PRIMARY: 'var(--gantt-text-primary)',
    TEXT_SECONDARY: 'var(--gantt-text-secondary)',
    TEXT_MUTED: 'var(--gantt-text-muted)',

    // 親子のつなぎ線・リンクドラッグ中の線
    CONNECTOR: 'var(--gantt-connector)',
    LINK_CHILD: 'var(--gantt-link-child)',
    LINK_PARENT: 'var(--gantt-link-parent)',
    LINK_CHILD_TINT: 'var(--gantt-link-child-tint)',
    LINK_PARENT_TINT: 'var(--gantt-link-parent-tint)',
    LINK_CHILD_STRONG: 'var(--gantt-link-child-strong)',
    LINK_PARENT_STRONG: 'var(--gantt-link-parent-strong)',

    // バーの影・マイルストーンのひし形の縁（縁は背景と同色で抜く）
    BAR_SHADOW: 'var(--gantt-bar-shadow)',
    DIAMOND_STROKE: 'var(--gantt-diamond-stroke)',
    ON_ACCENT: 'var(--gantt-on-accent)',

    // ホバー時のポップアップ
    TOOLTIP_BG: 'var(--gantt-tooltip-bg)',
    TOOLTIP_FG: 'var(--gantt-tooltip-fg)',
    TOOLTIP_FG_MUTED: 'var(--gantt-tooltip-fg-muted)',
    TOOLTIP_FG_DIM: 'var(--gantt-tooltip-fg-dim)',
    TOOLTIP_LINE: 'var(--gantt-tooltip-line)',

    // 遅れの見込み（マイルストーンのバッジ）
    RISK_HIGH: 'var(--gantt-risk-high)',
    RISK_HIGH_BG: 'var(--gantt-risk-high-bg)',
    RISK_HIGH_BORDER: 'var(--gantt-risk-high-border)',
    RISK_MEDIUM: 'var(--gantt-risk-medium)',
    RISK_MEDIUM_BG: 'var(--gantt-risk-medium-bg)',
    RISK_MEDIUM_BORDER: 'var(--gantt-risk-medium-border)',
    RISK_LOW: 'var(--gantt-risk-low)',
    RISK_LOW_BG: 'var(--gantt-risk-low-bg)',
    RISK_LOW_BORDER: 'var(--gantt-risk-low-border)',
    RISK_NONE: 'var(--gantt-risk-none)',
    RISK_NONE_BG: 'var(--gantt-risk-none-bg)',
    RISK_NONE_BORDER: 'var(--gantt-risk-none-border)',
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
