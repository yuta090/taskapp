/**
 * Portal unified label constants
 * Single source of truth for status/ball labels across all portal pages.
 */

/** Status labels for client-facing display */
export const PORTAL_STATUS_LABELS: Record<string, string> = {
  considering: '要確認',
  open: '未着手',
  in_progress: '進行中',
  todo: 'Todo',
  done: '完了',
  backlog: 'バックログ',
  in_review: '承認確認中',
}

/** Ball labels for client-facing display */
export const PORTAL_BALL_LABELS: Record<string, string> = {
  client: '要確認',
  internal: 'チーム対応中',
}

/** Get status label with fallback */
export function getPortalStatusLabel(status: string): string {
  return PORTAL_STATUS_LABELS[status] || status
}

/** Get ball label with fallback */
export function getPortalBallLabel(ball: string): string {
  return PORTAL_BALL_LABELS[ball] || ball
}
