/**
 * Agency Mode labels for 3-way ball management.
 * Only used when space.agency_mode = true.
 */
import type { BallSide } from '@/types/database'

/** Ball labels for agency mode (3-way) */
export const AGENCY_BALL_LABELS: Record<string, string> = {
  client: 'クライアント',
  agency: '代理店',
  internal: '代理店', // alias
  vendor: '制作会社',
}

/** Ball status labels for agency mode */
export const AGENCY_BALL_STATUS_LABELS: Record<string, string> = {
  client: 'クライアント確認待ち',
  agency: '代理店対応中',
  internal: '代理店対応中', // alias
  vendor: '制作会社対応中',
}

/** Standard ball labels (2-way, non-agency) */
export const STANDARD_BALL_LABELS: Record<string, string> = {
  client: 'クライアント',
  internal: 'チーム',
}

/** Standard ball status labels */
export const STANDARD_BALL_STATUS_LABELS: Record<string, string> = {
  client: 'クライアント確認待ち',
  internal: 'チーム対応中',
}

/** Get ball label based on agency mode */
export function getBallLabel(ball: BallSide, agencyMode: boolean): string {
  const labels = agencyMode ? AGENCY_BALL_LABELS : STANDARD_BALL_LABELS
  return labels[ball] || ball
}

/** Get ball status label based on agency mode */
export function getBallStatusLabel(ball: BallSide, agencyMode: boolean): string {
  const labels = agencyMode ? AGENCY_BALL_STATUS_LABELS : STANDARD_BALL_STATUS_LABELS
  return labels[ball] || ball
}

/** Valid ball sides for agency mode */
export const AGENCY_BALL_SIDES: BallSide[] = ['client', 'agency', 'vendor']

/** Valid ball sides for standard mode */
export const STANDARD_BALL_SIDES: BallSide[] = ['client', 'internal']
