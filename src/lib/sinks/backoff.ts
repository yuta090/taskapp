/**
 * 配送失敗の分類とバックオフ計算（AI_SECRETARY_STAGE3_INTEGRATIONS.md §2-2）。
 * DB側 rpc_complete_sink_delivery（supabase/migrations/..._integration_sinks.sql）にも
 * 同じ値を複製している（単一ラウンドトリップでの原子更新のため）。値を変える場合は両方直すこと。
 */

export type FailureOutcome = 'permanent' | 'temporary'

export interface FailureClassification {
  outcome: FailureOutcome
  /** true の場合のみ sink.consecutive_failures を加算する */
  countsTowardFailures: boolean
}

/**
 * 恒久失敗（400/404/422）はリトライせず即dead。毒delivery（壊れたペイロード等）が
 * consecutive_failuresを押し上げてsinkを止めてしまうのを防ぐためcountsTowardFailures=false。
 * 401/403は恒久失敗だが認証失効の可能性があるためcountsTowardFailuresはtrue。
 * 408/429/5xx/ネットワークエラー・タイムアウトは一時失敗としてバックオフ対象。
 * それ以外の未列挙ステータス（他の4xxや3xx未追跡等）は安全側に倒し恒久失敗+カウント対象とする。
 */
export function classifyDeliveryFailure(
  status: number | undefined,
  isNetworkError: boolean,
): FailureClassification {
  if (isNetworkError || status === undefined) {
    return { outcome: 'temporary', countsTowardFailures: true }
  }
  if (status === 408 || status === 429 || status >= 500) {
    return { outcome: 'temporary', countsTowardFailures: true }
  }
  if (status === 400 || status === 404 || status === 422) {
    return { outcome: 'permanent', countsTowardFailures: false }
  }
  return { outcome: 'permanent', countsTowardFailures: true }
}

/** 1分→5分→30分→2時間→6時間 */
export const BACKOFF_MINUTES = [1, 5, 30, 120, 360] as const

/**
 * 初回配達 + 5リトライ = 最大6試行。5回のリトライがすべて失敗したら6試行目でdead。
 * （設計書の「1分→5分→30分→2時間→6時間、5回でdead」は5つのバックオフ値をすべて
 *  使い切る解釈: attempts=1..5それぞれの失敗後にBACKOFF_MINUTES[i]で次を予約し、
 *  6回目の失敗でdeadにする）
 */
export const MAX_DELIVERY_ATTEMPTS = BACKOFF_MINUTES.length + 1

/**
 * attemptsAfterFailure: この失敗を含めた試行回数（1始まり）。
 * dead(リトライ終了)ならnullを返す。
 */
export function computeNextAttemptDelayMinutes(attemptsAfterFailure: number): number | null {
  if (attemptsAfterFailure >= MAX_DELIVERY_ATTEMPTS) return null
  const index = Math.min(attemptsAfterFailure, BACKOFF_MINUTES.length) - 1
  return BACKOFF_MINUTES[index]
}
