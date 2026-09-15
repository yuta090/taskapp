'use client'

import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_STALE_TIME_MS } from '@/lib/query/constants'

/**
 * タスク一覧・マイタスク一覧の吹き出しアイコンに出すコメント数。
 *
 * 一覧本体（fetchTasksQuery / fetchMyTasksData）の Promise.all には入れない —
 * コメント数の集計（rpc_task_comment_counts）は一覧の1ページ目より遅くなりうる
 * （実測: コメント8,000件の space で集計1.2〜2秒）ため、一覧の表示を待たせず、
 * 別の react-query クエリとして遅れて出す。
 *
 * これにより一覧側（fetchTasksQuery/fetchMyTasksData の戻り値・useTasks の
 * 楽観的更新・reviewStatusSync）はコメント数を一切知らなくてよくなる — 今後
 * 誰かが一覧のキャッシュを作り直しても、このフィールドを運び忘れて数が消える
 * という壊れ方がそもそも起こらない。
 */

/** rpc_task_comment_counts の1行 */
export interface TaskCommentCountRow {
  task_id: string
  comment_count: number
}

/** rpc_task_comment_counts の行配列を { taskId: 件数 } に変換する（0件のタスクは含まれない）。 */
export function commentCountsFromRows(
  rows: TaskCommentCountRow[] | null | undefined
): Record<string, number> {
  const result: Record<string, number> = {}
  for (const row of rows ?? []) {
    result[row.task_id] = row.comment_count
  }
  return result
}

// 読み込み中・失敗時に毎レンダー新しい {} を作ると、呼び出し側の useMemo 等が毎回無効化
// されるため共有定数にする（useSpaceMembers の EMPTY_MEMBERS と同じ考え方）
const EMPTY_COMMENT_COUNTS: Record<string, number> = {}

/**
 * プロジェクトのタスク一覧（TasksPageClient）向け。space 単位でコメント数を読む。
 */
export function useSpaceTaskCommentCounts(spaceId: string | null): Record<string, number> {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const { data } = useQuery<Record<string, number>>({
    queryKey: ['taskCommentCounts', 'space', spaceId],
    // 失敗は投げる。空の数を「成功」として返すと、表示中の数を {} で上書きし、端末の保存にも残る。
    // 投げれば react-query が前の数を残す（初めての読み込みなら data が無く、下で空オブジェクトになる）
    queryFn: async () => {
      const { data, error } = await (supabase as SupabaseClient).rpc('rpc_task_comment_counts', {
        p_space_id: spaceId,
      })
      if (error) {
        console.warn('[useSpaceTaskCommentCounts] rpc_task_comment_counts failed:', error)
        throw error
      }
      return commentCountsFromRows(data as TaskCommentCountRow[] | null)
    },
    // タスク一覧(useTasks)と同じ既定の間隔にする — コメント数は一覧本体と別読みだが、
    // 取り直しの頻度は揃える
    staleTime: DEFAULT_STALE_TIME_MS,
    enabled: !!spaceId,
  })

  return data ?? EMPTY_COMMENT_COUNTS
}

/**
 * マイタスク一覧（MyTasksClient）向け。担当者（＋組織）単位でコメント数を読む。
 */
export function useMyTaskCommentCounts(
  userId: string | null,
  orgId: string | null,
  /** 呼び出し側の読み込み条件。マイタスク本体と同じく、組織の判定が終わるまでは false を渡す */
  options: { enabled?: boolean } = {}
): Record<string, number> {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const { data } = useQuery<Record<string, number>>({
    queryKey: ['taskCommentCounts', 'assignee', userId, orgId ?? null],
    // 失敗は投げて前の数を残す（useSpaceTaskCommentCounts と同じ）
    queryFn: async () => {
      const { data, error } = await (supabase as SupabaseClient).rpc('rpc_task_comment_counts', {
        p_assignee_id: userId,
        p_org_id: orgId ?? null,
      })
      if (error) {
        console.warn('[useMyTaskCommentCounts] rpc_task_comment_counts failed:', error)
        throw error
      }
      return commentCountsFromRows(data as TaskCommentCountRow[] | null)
    },
    staleTime: DEFAULT_STALE_TIME_MS,
    enabled: !!userId && (options.enabled ?? true),
  })

  return data ?? EMPTY_COMMENT_COUNTS
}
