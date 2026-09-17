'use client'

/**
 * 議事録の「タスク作成済み」の印から、その場でタスクを完了・決定するための入り口。
 *
 * 読むのは**押したときだけ**（印は1つの議事録に何個もあるので、開く前に全部読むと
 * 取得が印の数だけ増える）。ただし一覧のキャッシュに在庫があればそれを先に使い、
 * 往復ゼロで出す。
 */
import { useCallback, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { rpc } from '@/lib/supabase/rpc'
import { invalidateSpecDecisionEvents } from '@/lib/hooks/useSpecDecisionEvents'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  classifyCompleteFailure,
  completeFailureMessage,
  type CompleteFailureKind,
  type MinutesTaskAction,
  type MinutesTaskState,
} from '@/lib/minutes/taskActions'
import type { MinutesTaskResolver } from '@/components/meeting/MinutesEditor'
import type { TasksQueryData } from '@/lib/supabase/queries'
import type { DecisionState, TaskStatus, TaskType } from '@/types/database'

interface UseMinutesTaskActionsOptions {
  orgId: string
  spaceId: string
}

interface TaskRow {
  title: string
  status: TaskStatus
  type: TaskType
  decision_state: DecisionState | null
}

/**
 * 完了にできなかったときの失敗。理由を持たせて、呼び出し側が「次にすること」を
 * 出せるようにする（決定していないだけなら、その場で決定して完了まで進められる）。
 */
export class MinutesCompleteError extends Error {
  readonly kind: CompleteFailureKind
  constructor(kind: CompleteFailureKind, message?: string) {
    super(message ?? completeFailureMessage(kind))
    this.name = 'MinutesCompleteError'
    this.kind = kind
  }
}

/** DB の enforce_review_gate と同じ判定（approved と cancelled は完了を妨げない） */
function isReviewPending(status: string | null): boolean {
  return status !== null && status !== 'approved' && status !== 'cancelled'
}

export function useMinutesTaskActions({
  orgId,
  spaceId,
}: UseMinutesTaskActionsOptions): MinutesTaskResolver {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current as SupabaseClient
  // QueryClientProvider の外で使われることもある（議事録の単体テストなど）。
  // そこで落とさず、キャッシュの読み書きだけを諦める
  let queryClient: QueryClient | null = null
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- try の中でも呼び出し回数は毎回1回で変わらない
    queryClient = useQueryClient()
  } catch {
    queryClient = null
  }

  const tasksKey = useMemo(() => ['tasks', orgId, spaceId] as const, [orgId, spaceId])

  const resolve = useCallback(
    async (taskId: string) => {
      // 一覧のキャッシュに在庫があれば往復ゼロで出す（tasks も reviewStatuses も同じ袋に入っている）
      const cached = queryClient?.getQueryData<TasksQueryData>(tasksKey)
      const hit = cached?.tasks.find((t) => t.id === taskId)
      if (hit) {
        return {
          title: hit.title,
          state: {
            status: hit.status,
            type: hit.type,
            decisionState: hit.decision_state,
            reviewPending: isReviewPending(cached?.reviewStatuses[taskId] ?? null),
          } satisfies MinutesTaskState,
        }
      }

      // 在庫が無いときだけ引く。2本に依存関係は無いので並列にする
      const [taskResult, reviewResult] = await Promise.all([
        supabase
          .from('tasks')
          .select('title, status, type, decision_state')
          .eq('id', taskId)
          .eq('org_id', orgId)
          .eq('space_id', spaceId)
          .maybeSingle(),
        // reviews は task_id が一意（20240101_000_schema.sql）なので maybeSingle でよい
        supabase.from('reviews').select('status').eq('task_id', taskId).maybeSingle(),
      ])

      if (taskResult.error) throw taskResult.error
      if (!taskResult.data) return null

      const row = taskResult.data as TaskRow
      const reviewStatus = (reviewResult.data as { status: string } | null)?.status ?? null

      return {
        title: row.title,
        state: {
          status: row.status,
          type: row.type,
          decisionState: row.decision_state,
          reviewPending: isReviewPending(reviewStatus),
        } satisfies MinutesTaskState,
      }
    },
    [supabase, orgId, spaceId, queryClient, tasksKey]
  )

  const run = useCallback(
    async (taskId: string, action: Exclude<MinutesTaskAction, 'open'>) => {
      if (action === 'decide') {
        await rpc.setSpecState(supabase, { taskId, decisionState: 'decided' })
        // ダッシュボードの「確定事項」に出す「決まった日」を取り直させる
        if (queryClient) invalidateSpecDecisionEvents(queryClient, spaceId)
      } else {
        // RLS で弾かれた更新は**エラーではなく0行**で返る（useTasks.updateTask と同じ守り）。
        // .select() を付けて0行なら投げる。投げないと、何も起きていないのにチェックが
        // 付いたままになり、「完了した」という誤解をそのまま作ってしまう。
        const { data, error } = await supabase
          .from('tasks')
          .update({ status: 'done' })
          .eq('id', taskId)
          .eq('org_id', orgId)
          .eq('space_id', spaceId)
          .select('id')
        // 完了できない理由（未決・社内承認）は DB のトリガーが**英語で**返す。
        // そのまま出すと「Cannot complete task: ...」と画面に出てしまうので、
        // 日本語と「次にすること」に置き換える
        if (error) throw new MinutesCompleteError(classifyCompleteFailure(error.message))
        if ((data ?? []).length === 0) {
          throw new MinutesCompleteError(
            'unknown',
            'このタスクを完了にできませんでした（権限が無いか、削除された可能性があります）'
          )
        }
      }
      // 一覧のキャッシュを捨てる。捨てないと「完了にしたのに一覧では終わっていない」が
      // 最大2分続く（QueryProvider の既定の staleTime）
      void queryClient?.invalidateQueries({ queryKey: tasksKey })
    },
    [supabase, orgId, spaceId, queryClient, tasksKey]
  )

  return useMemo(() => ({ resolve, run }), [resolve, run])
}
