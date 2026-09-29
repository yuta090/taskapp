/**
 * タスクの読み書き。Web のマイタスク（src/app/(internal)/my/MyTasksClient.tsx）と同じ問い合わせ・
 * 同じ条件で書く。見える範囲は RLS が決める（アプリ側で絞っても安全にはならない）。
 */
import { rpc } from '@/lib/supabase/rpc'
import { splitEmbeddedReviews, type EmbeddedReviews } from '@/lib/tasks/reviewStatus'
import type { BallSide, Milestone, ReviewStatus, Space, Task, TaskStatus } from '@/types/database'
import { ownerIdsBySide } from '~/lib/owners'
import { passBallToClient } from '~/lib/passToClient'
import { ensureUpdated } from '~/lib/taskRules'
import { supabase, typedSupabase } from './supabase'
import { notifySlack, postWebApi } from './webApi'

export interface MyTasksData {
  tasks: Task[]
  reviewStatuses: Record<string, ReviewStatus>
  spaces: Space[]
  milestones: Milestone[]
}

/** 自分が担当のタスク（assignee_id = 自分）と、見出しに使うプロジェクト・マイルストーン */
export async function fetchMyTasks(userId: string, orgId: string): Promise<MyTasksData> {
  const [tasksRes, spacesRes, milestonesRes] = await Promise.all([
    supabase.from('tasks').select('*, reviews(status, created_at)').eq('assignee_id', userId).eq('org_id', orgId),
    supabase.from('spaces').select('*').eq('org_id', orgId),
    supabase
      .from('milestones')
      .select('*')
      .eq('org_id', orgId)
      .order('due_date', { ascending: true, nullsFirst: false }),
  ])
  if (tasksRes.error) throw tasksRes.error
  if (spacesRes.error) throw spacesRes.error
  if (milestonesRes.error) throw milestonesRes.error

  const rows = (tasksRes.data ?? []) as unknown as (Task & { reviews?: EmbeddedReviews })[]
  const { tasks, reviewStatuses } = splitEmbeddedReviews<Task>(rows)
  return {
    tasks,
    reviewStatuses,
    spaces: (spacesRes.data ?? []) as Space[],
    milestones: (milestonesRes.data ?? []) as Milestone[],
  }
}

export interface TaskDetail {
  task: Task
  reviewStatus: ReviewStatus | undefined
  spaceName: string | null
}

/** 1件だけ読む（通知から開いたとき、マイタスクに無い＝他人担当のタスクもある） */
export async function fetchTask(taskId: string): Promise<TaskDetail | null> {
  const { data, error } = await supabase
    .from('tasks')
    .select('*, reviews(status, created_at), spaces(name)')
    .eq('id', taskId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as unknown as Task & { reviews?: EmbeddedReviews; spaces?: { name: string } | null }
  const { spaces, ...rest } = row
  const { tasks, reviewStatuses } = splitEmbeddedReviews<Task>([rest])
  return { task: tasks[0], reviewStatus: reviewStatuses[taskId], spaceName: spaces?.name ?? null }
}

/**
 * 状態を変える。Web のタスク詳細（useTasks.updateTask）と同じく、タスクの行を直接更新して Slack にも知らせる。
 * 完了にできない条件（社内承認が終わっていない等）は DB も拒否する。
 */
export async function updateTaskStatus(task: Pick<Task, 'id' | 'space_id' | 'status'>, status: TaskStatus): Promise<void> {
  const { data, error } = await supabase.from('tasks').update({ status }).eq('id', task.id).select('id')
  if (error) throw error
  ensureUpdated(data)
  notifySlack({ event: 'status_changed', taskId: task.id, spaceId: task.space_id, changes: { oldStatus: task.status, newStatus: status } })
}

async function fetchOwners(taskId: string) {
  const { data, error } = await supabase.from('task_owners').select('side, user_id').eq('task_id', taskId)
  if (error) throw error
  return (data ?? []) as { side: BallSide; user_id: string }[]
}

/** ボールを社内に戻す（自分たちの番にする）。担当者は今のまま（rpc_pass_ball は担当者を入れ替えるので全員渡す） */
export async function takeBallInternal(task: Pick<Task, 'id' | 'space_id'>): Promise<void> {
  const { clientOwnerIds, internalOwnerIds, hasOtherSides } = ownerIdsBySide(await fetchOwners(task.id))
  if (hasOtherSides) {
    throw new Error('代理店・ベンダーの担当者がいるタスクは、Web でボールを渡してください')
  }
  await rpc.passBall(typedSupabase, { taskId: task.id, ball: 'internal', clientOwnerIds, internalOwnerIds })
  notifySlack({ event: 'ball_passed', taskId: task.id, spaceId: task.space_id, changes: { newBall: 'internal' } })
}

/**
 * 相手先にボールを渡す（~/lib/passToClient.ts の順）。承認依頼メールは Web の /api/portal/notify-approval が
 * 送る（アプリのトークンで呼ぶ）。メールを送れなくてもボールは戻さない（Web と同じ）。
 */
export function passBallToClientTask(task: Pick<Task, 'id' | 'space_id'>) {
  return passBallToClient(task.id, {
    getOwners: fetchOwners,
    passBall: ({ clientOwnerIds, internalOwnerIds }) =>
      rpc.passBall(typedSupabase, { taskId: task.id, ball: 'client', clientOwnerIds, internalOwnerIds }).then(() => {}),
    notifyApproval: async (taskId) => {
      try {
        return (await postWebApi('/api/portal/notify-approval', { taskId })).ok
      } catch {
        return false
      }
    },
    notifySlack: (taskId) =>
      notifySlack({ event: 'ball_passed', taskId, spaceId: task.space_id, changes: { newBall: 'client' } }),
  })
}

/** 自分に届いた社内承認を承認する。そろえば DB がタスクを完了にする */
export async function approveReview(taskId: string) {
  return rpc.reviewApprove(typedSupabase, { taskId })
}

/** 自分に届いた社内承認を差し戻す（理由は依頼した人の受信トレイに届く。通知は DB 側で作られる） */
export async function blockReview(taskId: string, reason: string) {
  return rpc.reviewBlock(typedSupabase, { taskId, blockedReason: reason })
}

/** 自分が承認者で、まだ答えていない社内承認のあるタスク（Web の useMyPendingReviews と同じ） */
export async function fetchMyPendingReviewTaskIds(userId: string, orgId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('review_approvals')
    .select('reviews!inner(task_id, status)')
    .eq('reviewer_id', userId)
    .eq('state', 'pending')
    .eq('reviews.status', 'open')
    .eq('org_id', orgId)
  if (error) throw error
  const ids = new Set<string>()
  for (const row of (data ?? []) as unknown as { reviews: { task_id: string } | { task_id: string }[] }[]) {
    const reviews = Array.isArray(row.reviews) ? row.reviews : [row.reviews]
    for (const r of reviews) ids.add(r.task_id)
  }
  return [...ids]
}
