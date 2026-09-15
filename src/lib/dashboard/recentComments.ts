/**
 * ダッシュボードの「最近のコメント」。新しいコメントのあるタスクを、1タスク1行で出す。
 */

/** useRecentTaskComments が読むコメントの列 */
export interface RecentCommentRow {
  id: string
  task_id: string
  actor_id: string
  body: string
  created_at: string
}

/**
 * 読みに行くコメントの件数。同じタスクへの連投があっても出す行数が足りるよう、出す行数より多めに読む。
 * 連投が多くて足りないときは行が少なく出るだけ（古いタスクを取りこぼすが、壊れはしない）。
 */
export const RECENT_COMMENT_FETCH_LIMIT = 100

/** 画面に出すタスクの行数 */
export const RECENT_COMMENT_TASK_LIMIT = 10

/**
 * 持っておく本文の長さ。画面は2行で切るので全文は要らない。取得した控えは端末にも保存されるので、
 * 長文の貼り付けがあっても控えが大きくならないよう、読んだ直後に切る。
 */
export const RECENT_COMMENT_BODY_MAX = 300

/** 同じタスクのコメントは一番新しい1件だけを残し、新しい順に limit 件まで返す。 */
export function latestCommentPerTask(rows: readonly RecentCommentRow[], limit: number): RecentCommentRow[] {
  const sorted = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const seen = new Set<string>()
  const result: RecentCommentRow[] = []

  for (const row of sorted) {
    if (seen.has(row.task_id)) continue
    seen.add(row.task_id)
    result.push(row)
    if (result.length >= limit) break
  }

  return result
}
