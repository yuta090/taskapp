/**
 * 画面が使う読み書き（react-query）。キーに userId と orgId を必ず入れる
 * （組織を切り替えたとき・別の人がログインしたときに、前のデータを出さないため）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CommentVisibility, TaskStatus } from '@/types/database'
import { addComment, fetchComments } from '~/api/comments'
import { fetchInbox, markAllRead, markRead } from '~/api/notifications'
import {
  approveReview,
  fetchMyPendingReviewTaskIds,
  fetchMyTasks,
  fetchTask,
  takeBallInternal,
  updateTaskStatus,
  type MyTasksData,
} from '~/api/tasks'
import { toInboxItem } from '~/lib/inbox'
import { useReadyContext } from './useSession'

export const keys = {
  myTasks: (userId: string, orgId: string) => ['myTasks', userId, orgId] as const,
  pendingReviews: (userId: string, orgId: string) => ['pendingReviews', userId, orgId] as const,
  inbox: (userId: string, orgId: string) => ['inbox', userId, orgId] as const,
  task: (taskId: string) => ['task', taskId] as const,
  comments: (taskId: string) => ['comments', taskId] as const,
}

export function useMyTasks() {
  const ctx = useReadyContext()
  return useQuery({
    queryKey: keys.myTasks(ctx?.userId ?? '', ctx?.orgId ?? ''),
    queryFn: () => fetchMyTasks(ctx!.userId, ctx!.orgId),
    enabled: !!ctx,
  })
}

export function usePendingReviewTaskIds() {
  const ctx = useReadyContext()
  return useQuery({
    queryKey: keys.pendingReviews(ctx?.userId ?? '', ctx?.orgId ?? ''),
    queryFn: () => fetchMyPendingReviewTaskIds(ctx!.userId, ctx!.orgId),
    enabled: !!ctx,
    select: (ids) => new Set(ids),
  })
}

export function useInbox() {
  const ctx = useReadyContext()
  return useQuery({
    queryKey: keys.inbox(ctx?.userId ?? '', ctx?.orgId ?? ''),
    queryFn: () => fetchInbox(ctx!.userId, ctx!.orgId),
    enabled: !!ctx,
    select: (rows) => rows.map(toInboxItem),
  })
}

export function useTaskDetail(taskId: string) {
  return useQuery({ queryKey: keys.task(taskId), queryFn: () => fetchTask(taskId) })
}

export function useComments(task: { id: string; org_id: string; space_id: string } | undefined) {
  return useQuery({
    queryKey: keys.comments(task?.id ?? ''),
    queryFn: () => fetchComments(task!),
    enabled: !!task,
  })
}

/** タスクを変えたら、そのタスク・マイタスク・承認待ちを読み直す */
function useInvalidateTask() {
  const queryClient = useQueryClient()
  return (taskId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.task(taskId) }),
      queryClient.invalidateQueries({ queryKey: ['myTasks'] }),
      queryClient.invalidateQueries({ queryKey: ['pendingReviews'] }),
    ])
}

/** 状態を変える。一覧には先に反映し（保存ボタンなし）、失敗したら元に戻す */
export function useUpdateStatus() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateTask()
  const ctx = useReadyContext()
  return useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) => updateTaskStatus(taskId, status),
    onMutate: async ({ taskId, status }) => {
      if (!ctx) return undefined
      const key = keys.myTasks(ctx.userId, ctx.orgId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<MyTasksData>(key)
      if (previous) {
        queryClient.setQueryData<MyTasksData>(key, {
          ...previous,
          tasks: previous.tasks.map((t) => (t.id === taskId ? { ...t, status } : t)),
        })
      }
      return { key, previous }
    },
    onError: (_e, _v, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
    },
    onSettled: (_d, _e, { taskId }) => invalidate(taskId),
  })
}

export function useTakeBall() {
  const invalidate = useInvalidateTask()
  return useMutation({
    mutationFn: (taskId: string) => takeBallInternal(taskId),
    onSettled: (_d, _e, taskId) => invalidate(taskId),
  })
}

export function useApproveReview() {
  const invalidate = useInvalidateTask()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) => approveReview(taskId),
    onSettled: (_d, _e, taskId) =>
      Promise.all([invalidate(taskId), queryClient.invalidateQueries({ queryKey: ['inbox'] })]),
  })
}

export function useAddComment(task: { id: string; org_id: string; space_id: string } | undefined) {
  const queryClient = useQueryClient()
  const ctx = useReadyContext()
  return useMutation({
    mutationFn: ({ body, visibility }: { body: string; visibility: CommentVisibility }) =>
      addComment(task!, ctx!.userId, body, visibility),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.comments(task?.id ?? '') }),
  })
}

export function useMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (notificationId: string) => markRead(notificationId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  })
}

export function useMarkAllRead() {
  const queryClient = useQueryClient()
  const ctx = useReadyContext()
  return useMutation({
    mutationFn: () => markAllRead(ctx!.userId, ctx!.orgId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  })
}
