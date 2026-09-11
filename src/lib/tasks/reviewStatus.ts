/**
 * タスクの社内承認（reviews）の状態を、一覧で使える形にする。
 */
import type { ReviewStatus } from '@/types/database'

export interface EmbeddedReview {
  status: string
  created_at?: string | null
}

/**
 * tasks に `reviews(...)` を埋め込んで読んだときの形。reviews は task_id が一意（1タスク1行・
 * 依頼し直しは同じ行を上書き）なので、Supabase の自動APIは1対1とみなして「オブジェクト or null」で
 * 返す（本番で確認済み）。配列を前提にすると一覧の読み込みごと落ちる。一意が外れたときに備えて、
 * 配列でも扱えるようにしておく。
 */
export type EmbeddedReviews = EmbeddedReview | EmbeddedReview[] | null | undefined

function latestReview(reviews: EmbeddedReviews): EmbeddedReview | undefined {
  if (!reviews) return undefined
  if (!Array.isArray(reviews)) return reviews
  let latest: EmbeddedReview | undefined
  for (const review of reviews) {
    if (!latest || (review.created_at ?? '') > (latest.created_at ?? '')) latest = review
  }
  return latest
}

/** 埋め込んで読んだ結果から、タスク本体と「タスクごとの社内承認の状態」を取り出す */
export function splitEmbeddedReviews<T extends { id: string }>(
  rows: ReadonlyArray<T & { reviews?: EmbeddedReviews }>
): { tasks: T[]; reviewStatuses: Record<string, ReviewStatus> } {
  const tasks: T[] = []
  const reviewStatuses: Record<string, ReviewStatus> = {}
  for (const row of rows) {
    const { reviews, ...task } = row
    tasks.push(task as unknown as T)
    const latest = latestReview(reviews)
    if (latest) reviewStatuses[row.id] = latest.status as ReviewStatus
  }
  return { tasks, reviewStatuses }
}
