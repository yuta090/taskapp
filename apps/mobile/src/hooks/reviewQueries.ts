/**
 * 社内承認（レビュー）の依頼・状況の読み書き（react-query）。キーに userId を必ず入れる
 * （同じ端末で別の人がログインしたとき、前の人の取り置きを出さないため）。
 *
 * 読む側は enabled を呼び出し側が渡せる。タスク詳細を開いた時点でメンバーと既定の承認者を
 * 裏で先に読んでおけば、「社内承認を依頼」を押してから待たせずに選択欄を出せる。
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { cancelReview, fetchDefaultReviewerIds, fetchSpaceMembers, fetchTaskReview, openReview } from '~/api/reviews'
import type { TaskReviewData } from '~/lib/reviewers'
import { useSession } from './useSession'

export const reviewKeys = {
  taskReview: (userId: string, taskId: string) => ['taskReview', userId, taskId] as const,
  spaceMembers: (userId: string, spaceId: string) => ['spaceMembers', userId, spaceId] as const,
  defaultReviewerIds: (userId: string, spaceId: string) => ['defaultReviewerIds', userId, spaceId] as const,
}

export function useTaskReview(taskId: string, enabled = true) {
  const { userId } = useSession()
  return useQuery({
    queryKey: reviewKeys.taskReview(userId ?? '', taskId),
    queryFn: () => fetchTaskReview(taskId),
    enabled: enabled && !!userId,
  })
}

/** プロジェクトのメンバー。参加者は他人の操作で変わるので、既定（30秒）より長めに 2 分だけ使い回す */
export function useSpaceMembers(spaceId: string, enabled = true) {
  const { userId } = useSession()
  return useQuery({
    queryKey: reviewKeys.spaceMembers(userId ?? '', spaceId),
    queryFn: () => fetchSpaceMembers(spaceId),
    enabled: enabled && !!userId,
    staleTime: 2 * 60_000,
  })
}

/** 既定の承認者の顔ぶれは頻繁には変わらないので 5 分使い回す（Web の useDefaultReviewers と同じ） */
export function useDefaultReviewerIds(spaceId: string, enabled = true) {
  const { userId } = useSession()
  return useQuery({
    queryKey: reviewKeys.defaultReviewerIds(userId ?? '', spaceId),
    queryFn: () => fetchDefaultReviewerIds(spaceId),
    enabled: enabled && !!userId,
    staleTime: 5 * 60_000,
  })
}

/** 依頼・取り消しのあとに読み直すもの: そのタスクと承認、マイタスク、プロジェクトのタスク、承認待ち、受信トレイ */
function invalidateAfterReviewChange(queryClient: QueryClient, taskId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'taskReview' && q.queryKey[2] === taskId }),
    queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'task' && q.queryKey[2] === taskId }),
    queryClient.invalidateQueries({ queryKey: ['myTasks'] }),
    queryClient.invalidateQueries({ queryKey: ['spaceTasks'] }),
    queryClient.invalidateQueries({ queryKey: ['pendingReviews'] }),
    queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  ])
}

/** 依頼する。押した瞬間に「承認待ち」を画面へ出し（保存ボタンなし）、失敗したら元に戻す */
export function useOpenReview() {
  const queryClient = useQueryClient()
  const { userId } = useSession()
  return useMutation({
    mutationFn: ({ taskId, reviewerIds }: { taskId: string; reviewerIds: string[] }) => openReview(taskId, reviewerIds),
    onMutate: async ({ taskId, reviewerIds }) => {
      if (!userId) return undefined
      const key = reviewKeys.taskReview(userId, taskId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<TaskReviewData | null>(key)
      // id はまだ無い（サーバーが決める）。空の id のあいだは画面側で取り消しを出さない
      queryClient.setQueryData(key, {
        review: { id: '', status: 'open', created_by: userId },
        approvals: reviewerIds.map((reviewerId) => ({
          id: `pending-${reviewerId}`,
          reviewer_id: reviewerId,
          state: 'pending',
          blocked_reason: null,
        })),
      })
      return { key, previous }
    },
    onError: (_e, _v, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous)
    },
    onSettled: (_d, _e, { taskId }) => invalidateAfterReviewChange(queryClient, taskId),
  })
}

/** 取り消す。押した瞬間に「依頼なし」の表示にし、失敗したら元に戻す */
export function useCancelReview() {
  const queryClient = useQueryClient()
  const { userId } = useSession()
  return useMutation({
    mutationFn: ({ reviewId }: { taskId: string; reviewId: string }) => cancelReview(reviewId),
    onMutate: async ({ taskId }) => {
      if (!userId) return undefined
      const key = reviewKeys.taskReview(userId, taskId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<TaskReviewData | null>(key)
      // 取り消し済みは「依頼なし」と同じ扱い（Web と同じ）
      if (previous) queryClient.setQueryData(key, { ...previous, review: { ...previous.review, status: 'cancelled' } })
      return { key, previous }
    },
    onError: (_e, _v, context) => {
      if (context) queryClient.setQueryData(context.key, context.previous)
    },
    onSettled: (_d, _e, { taskId }) => invalidateAfterReviewChange(queryClient, taskId),
  })
}
