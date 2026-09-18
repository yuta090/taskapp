import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import type { TaskStatus } from '@/types/database'

// 一覧で完了にしたときの案内の文言。プロジェクトのタスク一覧とマイタスクで同じにするため、
// 文言はここだけに置く（タスク詳細の中の案内は TaskInspector のバナー）
export const REVIEW_REQUEST_NUDGE_TITLE = '完了にしました'
export const REVIEW_REQUEST_NUDGE_BODY = '誰かに結論を確認してもらうなら、確認依頼を子タスクで出せます。'
export const REVIEW_REQUEST_NUDGE_ACTION_LABEL = '確認依頼を出す'

/**
 * 一覧のチェックボックス・行の状態メニューで完了にしたときに、確認依頼を子タスクで出すことを
 * 案内する（運用ルール「確認依頼は子タスクで出す」2026-09-15 確定）。
 *
 * タスク詳細を開いていないので、案内は画面の通知に出す。押されたら onAccept で詳細と
 * 確認依頼の入力欄まで開く。すでに完了だったものを完了にし直したときは出さない。
 */
export function suggestReviewRequestOnDone(params: {
  previousStatus?: TaskStatus | null
  nextStatus: TaskStatus
  onAccept: () => void
}): boolean {
  const { previousStatus, nextStatus, onAccept } = params
  if (nextStatus !== 'done' || previousStatus === 'done') return false

  toast.success(REVIEW_REQUEST_NUDGE_TITLE, {
    description: REVIEW_REQUEST_NUDGE_BODY,
    // 既定の3秒だと、読んで「出す／出さない」を決める前に消えてしまう
    duration: 8000,
    action: { label: REVIEW_REQUEST_NUDGE_ACTION_LABEL, onClick: onAccept },
  })
  return true
}

/**
 * 案内から詳細を開いたタスクを覚えておく仕組み。プロジェクトのタスク一覧とマイタスクで同じものを使う。
 *
 * そのタスクを離れたら忘れる — あとで同じタスクを普通に開いたときに、確認依頼の入力欄が
 * 勝手に出ないようにするため。ただし「いったん開いた」ことを見てから見張り始める:
 * プロジェクトのタスク一覧は選択中のタスクを URL から読んでおり、案内を押した直後の
 * 描き直しではまだ前の値のままなので、すぐ見張ると立てた目印をその場で消してしまう。
 *
 * 調整は描画中に行う（React の「上から来た値が変わったら state をそろえる」型）。
 * effect にすると描き直しが1回増えるうえ、入力欄が一瞬出てから消えることがある。
 */
export function useReviewRequestTarget(selectedTaskId: string | null) {
  const [reviewRequestTaskId, setReviewRequestTaskId] = useState<string | null>(null)
  const [openedTaskId, setOpenedTaskId] = useState<string | null>(null)

  if (reviewRequestTaskId) {
    if (selectedTaskId === reviewRequestTaskId) {
      if (openedTaskId !== reviewRequestTaskId) setOpenedTaskId(reviewRequestTaskId)
    } else if (openedTaskId === reviewRequestTaskId) {
      setReviewRequestTaskId(null)
      setOpenedTaskId(null)
    }
  }

  const markReviewRequest = useCallback((taskId: string) => {
    setOpenedTaskId(null)
    setReviewRequestTaskId(taskId)
  }, [])

  return { reviewRequestTaskId, markReviewRequest }
}
