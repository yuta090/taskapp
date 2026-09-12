import type { BallSide } from '@/types/database'

/**
 * Centralized label map for ball-side terminology.
 * DB values ('client'|'internal') remain unchanged.
 * Only user-facing labels are abstracted.
 */
export const BALL_LABELS: Record<BallSide, string> = {
  client: '外部',
  internal: '社内',
  vendor: 'ベンダー',
  agency: '代理店',
} as const

export const BALL_STATUS_LABELS: Record<BallSide, string> = {
  client: 'クライアント確認待ち',
  internal: '社内対応中',
  vendor: 'ベンダー対応中',
  agency: '代理店対応中',
} as const

export function getBallLabel(ball: BallSide): string {
  return BALL_LABELS[ball]
}

export function getBallStatusLabel(ball: BallSide): string {
  return BALL_STATUS_LABELS[ball]
}

/**
 * 他の人のプロフィール（表示名・アバター）が権限の都合で読めなかったときに出す一語。
 * DB 側で「一緒に仕事をしている人」の範囲に profiles の閲覧を絞る変更が入っても、
 * この画面はこのまま正しく動く（生の ID の一部を出したり、空欄のままにしない）。
 */
export const UNKNOWN_PROFILE_LABEL = '（メンバー外）'
