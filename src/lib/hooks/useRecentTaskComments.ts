'use client'

import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_STALE_TIME_MS } from '@/lib/query/constants'
import {
  RECENT_COMMENT_BODY_MAX,
  RECENT_COMMENT_FETCH_LIMIT,
  type RecentCommentRow,
} from '@/lib/dashboard/recentComments'

/**
 * ダッシュボードの「最近のコメント」向けに、プロジェクトの新しいコメントを読む。
 *
 * - 見える範囲は RLS（task_comments_select）に任せる。社内は社内のみのコメントも含めて読める
 * - 1タスク1行への絞り込みとタスク名の突き合わせは画面側で行う（タスク一覧は useTasks が全件持っている）
 * - 索引 idx_task_comments_space_recent（space_id, created_at desc・消していないものだけ）で、新しい順に
 *   読み始めて件数の上限で止まる。条件を変えるときは索引の条件（deleted_at is null）と合わせる
 */

export const recentTaskCommentsQueryKey = (spaceId: string) => ['recentTaskComments', spaceId] as const

// 読み込み中に毎レンダー新しい [] を作ると、呼び出し側の useMemo が毎回無効化されるため共有定数にする
const EMPTY_COMMENTS: RecentCommentRow[] = []

export function useRecentTaskComments(
  spaceId: string,
  /** 「最近のコメント」を隠しているあいだは false を渡し、読みに行かない */
  options: { enabled: boolean }
): { comments: RecentCommentRow[]; loading: boolean; error: unknown } {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const { data, isPending, error } = useQuery<RecentCommentRow[]>({
    queryKey: recentTaskCommentsQueryKey(spaceId),
    queryFn: async () => {
      const { data, error } = await (supabase as SupabaseClient)
        .from('task_comments')
        .select('id, task_id, actor_id, body, created_at')
        .eq('space_id', spaceId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(RECENT_COMMENT_FETCH_LIMIT)
      if (error) throw error
      return ((data ?? []) as RecentCommentRow[]).map((row) =>
        row.body.length > RECENT_COMMENT_BODY_MAX ? { ...row, body: row.body.slice(0, RECENT_COMMENT_BODY_MAX) } : row
      )
    },
    staleTime: DEFAULT_STALE_TIME_MS,
    enabled: !!spaceId && options.enabled,
  })

  return {
    comments: data ?? EMPTY_COMMENTS,
    loading: options.enabled && isPending && !data,
    error: error ?? null,
  }
}
