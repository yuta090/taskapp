'use client'

import { useState, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { resolvePortalConflictMessage } from '@/lib/portal/resolvePortalConflictMessage'

/** タスクごとの処理状態（楽観的UI用） */
export type PortalTaskActionState = 'processing' | 'done' | 'error'

/** ポータルからの承認系アクション。/api/portal/tasks/[taskId] の action に対応 */
export type PortalTaskAction =
  | 'approve'
  | 'request_changes'
  | 'estimate_approve'
  | 'estimate_reject'

interface UsePortalTaskActionsOptions {
  /** アクション開始時に呼ばれる。インスペクタを閉じる用途（省略可）。 */
  onActionStart?: () => void
}

/**
 * ポータル（相手先）画面から承認・修正依頼・見積もり承認/却下を送る共通フック。
 * 「要対応タスク」「タスク一覧」「送信したリクエスト」の各画面で同じ導線を使えるよう、
 * PortalTasksClient に散っていた fetch＋楽観的状態＋router.refresh を1か所に集約した。
 *
 * 返す handler を PortalTaskInspector の onApprove/onRequestChanges 等へ渡す。
 * ⚠ 承認パネルは handler を渡すと表示されるため、承認可能なタスク
 *   （ball='client' かつ未完了 等）に対してのみ handler を渡すこと。
 */
export function usePortalTaskActions({ onActionStart }: UsePortalTaskActionsOptions = {}) {
  const router = useRouter()
  const [taskStates, setTaskStates] = useState<Map<string, PortalTaskActionState>>(new Map())
  const [, startTransition] = useTransition()

  const setTaskState = useCallback((taskId: string, state: PortalTaskActionState | null) => {
    setTaskStates((prev) => {
      const next = new Map(prev)
      if (state === null) next.delete(taskId)
      else next.set(taskId, state)
      return next
    })
  }, [])

  const runAction = useCallback(
    async (taskId: string, action: PortalTaskAction, comment: string) => {
      // 二重送信ガード
      if (taskStates.get(taskId) === 'processing') return

      setTaskState(taskId, 'processing')
      onActionStart?.()

      try {
        const response = await fetch(`/api/portal/tasks/${taskId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, comment }),
        })

        if (!response.ok) {
          setTaskState(taskId, null)
          if (response.status === 409) {
            const errorData = await response.json().catch(() => ({}))
            toast.error(
              resolvePortalConflictMessage(errorData, 'タスクの状態が変更されました。ページを再読み込みします。')
            )
          } else if (response.status === 400) {
            const error = await response.json().catch(() => ({}))
            toast.error(error.error || 'コメントを入力してください。')
          }
          // 409 は reason: 'blocked'（業務ルール待ち）でも取り直す。この一覧は
          // 開いた時点の見積もり状態でボタンを出し分けているため、画面を開いた
          // 後に社内側が見積もりを送る等して状態が変わった場合、取り直さないと
          // 古いボタンが残ったまま先に進めなくなる。
          startTransition(() => router.refresh())
          return
        }

        setTaskState(taskId, 'done')
        startTransition(() => router.refresh())
      } catch (error) {
        console.error(`Portal task action failed (${action}):`, error)
        setTaskState(taskId, null)
        startTransition(() => router.refresh())
      }
    },
    [router, taskStates, setTaskState, onActionStart]
  )

  const handleApprove = useCallback(
    (taskId: string, comment: string) => runAction(taskId, 'approve', comment),
    [runAction]
  )
  const handleRequestChanges = useCallback(
    (taskId: string, comment: string) => runAction(taskId, 'request_changes', comment),
    [runAction]
  )
  const handleEstimateApprove = useCallback(
    (taskId: string, comment: string) => runAction(taskId, 'estimate_approve', comment),
    [runAction]
  )
  const handleEstimateReject = useCallback(
    (taskId: string, comment: string) => runAction(taskId, 'estimate_reject', comment),
    [runAction]
  )

  return {
    taskStates,
    setTaskState,
    handleApprove,
    handleRequestChanges,
    handleEstimateApprove,
    handleEstimateReject,
  }
}
