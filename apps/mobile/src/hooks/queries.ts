/**
 * 画面が使う読み書き（react-query）。キーに userId と orgId を必ず入れる
 * （組織を切り替えたとき・別の人がログインしたときに、前のデータを出さないため）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CommentVisibility, Space, Task, TaskStatus } from '@/types/database'
import { addComment, fetchComments } from '~/api/comments'
import { fetchInbox, markAllRead, markRead } from '~/api/notifications'
import { fetchSpaces } from '~/api/spaces'
import { fetchSpaceTasks, type SpaceTasksData } from '~/api/spaceTasks'
import {
  approveReview,
  blockReview,
  fetchMyPendingReviewTaskIds,
  fetchMyTasks,
  fetchTask,
  passBallToClientTask,
  takeBallInternal,
  updateTaskStatus,
  type MyTasksData,
} from '~/api/tasks'
import { toInboxItem } from '~/lib/inbox'
import { taskDetailFromSources } from '~/lib/taskDetailFromList'
import { useReadyContext, useSession } from './useSession'

export const keys = {
  myTasks: (userId: string, orgId: string) => ['myTasks', userId, orgId] as const,
  pendingReviews: (userId: string, orgId: string) => ['pendingReviews', userId, orgId] as const,
  inbox: (userId: string, orgId: string) => ['inbox', userId, orgId] as const,
  spaces: (userId: string, orgId: string) => ['spaces', userId, orgId] as const,
  // 先頭の3つ（'spaceTasks', userId, orgId）で、その組織のプロジェクトのタスクすべてを前方一致で探せる
  spaceTasks: (userId: string, orgId: string, spaceId: string) => ['spaceTasks', userId, orgId, spaceId] as const,
  // 1件ものにも userId を入れる（同じ端末で別の人がログインしたとき、前の人の取り置きを出さない）
  task: (userId: string, taskId: string) => ['task', userId, taskId] as const,
  comments: (userId: string, taskId: string) => ['comments', userId, taskId] as const,
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

/** プロジェクト一覧。マイタスクの取り置きが持っている spaces があれば、それで先に描く */
export function useSpaces() {
  const ctx = useReadyContext()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: keys.spaces(ctx?.userId ?? '', ctx?.orgId ?? ''),
    queryFn: () => fetchSpaces(ctx!.orgId),
    enabled: !!ctx,
    placeholderData: () =>
      ctx ? queryClient.getQueryData<MyTasksData>(keys.myTasks(ctx.userId, ctx.orgId))?.spaces : undefined,
  })
}

/** プロジェクトのタスクの読み方。画面（useSpaceTasks）と、行を押す前の先読み（prefetchSpaceTasks）で同じものを使う */
function spaceTasksOptions(userId: string, orgId: string, spaceId: string) {
  return {
    queryKey: keys.spaceTasks(userId, orgId, spaceId),
    queryFn: () => fetchSpaceTasks(orgId, spaceId),
  }
}

export function useSpaceTasks(spaceId: string) {
  const ctx = useReadyContext()
  return useQuery({
    ...spaceTasksOptions(ctx?.userId ?? '', ctx?.orgId ?? '', spaceId),
    enabled: !!ctx,
  })
}

/** 行を押した瞬間に読み始める（遷移するころには手元に来ている）。失敗は画面を開いたときに読み直すので無視する */
export function usePrefetchSpaceTasks() {
  const ctx = useReadyContext()
  const queryClient = useQueryClient()
  return (spaceId: string) => {
    if (!ctx) return
    void queryClient.prefetchQuery(spaceTasksOptions(ctx.userId, ctx.orgId, spaceId))
  }
}

/** マイタスクとプロジェクトのタスクの取り置きが持っていれば、通信を待たずにそれで先に描く（押したらすぐ出す） */
export function useTaskDetail(taskId: string) {
  const { userId } = useSession()
  const ctx = useReadyContext()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: keys.task(userId ?? '', taskId),
    queryFn: () => fetchTask(taskId),
    enabled: !!userId,
    placeholderData: () => {
      if (!ctx) return undefined
      return taskDetailFromSources(
        queryClient.getQueryData<MyTasksData>(keys.myTasks(ctx.userId, ctx.orgId)),
        queryClient
          .getQueriesData<SpaceTasksData>({ queryKey: ['spaceTasks', ctx.userId, ctx.orgId] })
          .map(([, data]) => data),
        queryClient.getQueryData<Space[]>(keys.spaces(ctx.userId, ctx.orgId)),
        taskId
      )
    },
  })
}

export function useComments(task: { id: string; org_id: string; space_id: string } | undefined) {
  const { userId } = useSession()
  return useQuery({
    queryKey: keys.comments(userId ?? '', task?.id ?? ''),
    queryFn: () => fetchComments(task!),
    enabled: !!task && !!userId,
  })
}

/** タスクを変えたら、そのタスク・マイタスク・プロジェクトのタスク・承認待ちを読み直す */
function useInvalidateTask() {
  const queryClient = useQueryClient()
  return (taskId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'task' && q.queryKey[2] === taskId }),
      // 承認・差し戻しのあと、詳細の「社内承認」の欄（承認者ごとの状態）も読み直す
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'taskReview' && q.queryKey[2] === taskId }),
      queryClient.invalidateQueries({ queryKey: ['myTasks'] }),
      queryClient.invalidateQueries({ queryKey: ['spaceTasks'] }),
      queryClient.invalidateQueries({ queryKey: ['pendingReviews'] }),
    ])
}

/** 状態を変える。一覧には先に反映し（保存ボタンなし）、失敗したら元に戻す */
export function useUpdateStatus() {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateTask()
  const ctx = useReadyContext()
  return useMutation({
    mutationFn: ({ task, status }: { task: Pick<Task, 'id' | 'space_id' | 'status'>; status: TaskStatus }) =>
      updateTaskStatus(task, status),
    onMutate: async ({ task, status }) => {
      if (!ctx) return undefined
      const key = keys.myTasks(ctx.userId, ctx.orgId)
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<MyTasksData>(key)
      if (previous) {
        queryClient.setQueryData<MyTasksData>(key, {
          ...previous,
          tasks: previous.tasks.map((t) => (t.id === task.id ? { ...t, status } : t)),
        })
      }
      return { key, previous }
    },
    onError: (_e, _v, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
    },
    onSettled: (_d, _e, { task }) => invalidate(task.id),
  })
}

export function useTakeBall() {
  const invalidate = useInvalidateTask()
  return useMutation({
    mutationFn: (task: Pick<Task, 'id' | 'space_id'>) => takeBallInternal(task),
    onSettled: (_d, _e, task) => invalidate(task.id),
  })
}

export function usePassBallToClient() {
  const invalidate = useInvalidateTask()
  return useMutation({
    mutationFn: (task: Pick<Task, 'id' | 'space_id'>) => passBallToClientTask(task),
    onSettled: (_d, _e, task) => invalidate(task.id),
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

export function useBlockReview() {
  const invalidate = useInvalidateTask()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ taskId, reason }: { taskId: string; reason: string }) => blockReview(taskId, reason),
    onSettled: (_d, _e, { taskId }) =>
      Promise.all([invalidate(taskId), queryClient.invalidateQueries({ queryKey: ['inbox'] })]),
  })
}

export function useAddComment(task: { id: string; org_id: string; space_id: string } | undefined) {
  const queryClient = useQueryClient()
  const ctx = useReadyContext()
  return useMutation({
    mutationFn: ({ body, visibility }: { body: string; visibility: CommentVisibility }) => {
      // ログアウトした直後などに押されたら、送らずに失敗として返す
      if (!task || !ctx) throw new Error('ログインし直してから、もう一度お試しください')
      return addComment(task, ctx.userId, body, visibility)
    },
    onSettled: () =>
      queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'comments' && q.queryKey[2] === task?.id }),
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
    mutationFn: () => {
      if (!ctx) throw new Error('ログインし直してから、もう一度お試しください')
      return markAllRead(ctx.userId, ctx.orgId)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['inbox'] }),
  })
}
