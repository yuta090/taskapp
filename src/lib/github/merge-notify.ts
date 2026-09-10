// PR が取り込まれた（マージされた）ときの社内通知。
//
// 方針（GITHUB_ISSUES_LINK_SPEC.md §6 §12・Fable裁定）: GitHub 由来の処理は
// タスク行(tasks)を更新しない／ボールを動かさない／お客さん・制作会社に通知しない。
// ここでは「タスクに紐づく社内の担当者・責任者に知らせるだけ」を行う。
//
// 宛先の決定・文面の組み立ては副作用の無い純粋関数にして単体テストしやすくし、
// notifyTasksForMergedPR はそれらを使って DB を読み書きするだけにする。
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildTaskDeepLink } from '@/lib/taskLinks'

/** org_memberships.role のうち「社内メンバー」とみなす役割（channels/authz.ts の INTERNAL_ROLES と同じ考え方） */
const INTERNAL_ROLES = ['owner', 'admin', 'member'] as const

export interface ResolveMergeNotifyRecipientsInput {
  assigneeId: string | null
  internalOwnerIds: readonly string[]
  createdBy: string | null
  defaultReviewerIds: readonly string[]
  /** そのタスクの org で「社内メンバー」(owner/admin/member) と判定された user_id の集合 */
  internalMemberIds: ReadonlySet<string>
}

/**
 * 通知の宛先を決める（純粋関数）。優先度:
 *   1. 担当者(assignee_id) + 社内側の責任者(task_owners side='internal') の和集合（社内メンバーのみ）
 *   2. ↑が空なら created_by（社内メンバーなら）
 *   3. ↑も空ならスペースの既定の承認者(default_reviewer_ids)（社内メンバーのみ）
 *   4. それも空なら0人（送らない）
 */
export function resolveMergeNotifyRecipients(
  input: ResolveMergeNotifyRecipientsInput,
): string[] {
  const isInternal = (id: string | null | undefined): id is string =>
    !!id && input.internalMemberIds.has(id)

  const primary = new Set<string>()
  if (isInternal(input.assigneeId)) primary.add(input.assigneeId)
  for (const id of input.internalOwnerIds) {
    if (isInternal(id)) primary.add(id)
  }
  if (primary.size > 0) return [...primary]

  if (isInternal(input.createdBy)) return [input.createdBy]

  const reviewers = new Set(input.defaultReviewerIds.filter(isInternal))
  if (reviewers.size > 0) return [...reviewers]

  return []
}

export interface MergeNotifyMessageInput {
  taskTitle: string
  prNumber: number
  prTitle: string
  /** そのタスクに紐づく PR のうち、取り込み済み(merged)の件数 */
  mergedCount: number
  /** そのタスクに紐づく PR の全件数 */
  totalCount: number
}

/**
 * 通知の見出し・本文を組み立てる（純粋関数）。
 *
 * 注意（ユーザー絶対条件・2026-09-11）: GitHub のリポジトリ名は、GitHub を
 * 接続した本人以外に一切見せない（制作会社の顧客名が類推されるため）。この
 * 通知は接続した本人以外にも届くため、宛先によらず一律でリポジトリ名・
 * GitHub の URL を文面に入れない。
 */
export function buildMergeNotifyMessage(
  input: MergeNotifyMessageInput,
): { title: string; message: string } {
  const title = `「${input.taskTitle}」の変更（PR）が取り込まれました`
  const message =
    `PR #${input.prNumber}「${input.prTitle}」が取り込まれました` +
    `（このタスクの関連PR: 取り込み済み ${input.mergedCount} / 全 ${input.totalCount}）。` +
    `お客さんに確認をお願いする場合は、タスクからボールを渡してください。`
  return { title, message }
}

export interface MergedPRInfo {
  orgId: string
  prId: string
  prNumber: number
  prTitle: string
}

interface TaskRow {
  id: string
  org_id: string
  space_id: string
  title: string
  status: string
  assignee_id: string | null
  created_by: string | null
}

/**
 * 取り込まれた PR に紐づく全タスクへ、社内の担当者・責任者に通知する。
 * ベストエフォート（失敗しても webhook 応答を止めないよう、ここで必ず飲み込む）。
 */
export async function notifyTasksForMergedPR(
  supabase: SupabaseClient,
  pr: MergedPRInfo,
): Promise<void> {
  try {
    const { data: linkRows } = await supabase
      .from('task_github_links')
      .select('task_id')
      .eq('github_pr_id', pr.prId)

    const taskIds = [...new Set(((linkRows ?? []) as Array<{ task_id: string }>).map((r) => r.task_id))]
    if (taskIds.length === 0) return

    const { data: memberRows } = await supabase
      .from('org_memberships')
      .select('user_id')
      .eq('org_id', pr.orgId)
      .in('role', [...INTERNAL_ROLES])

    const internalMemberIds = new Set(
      ((memberRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id),
    )

    for (const taskId of taskIds) {
      await notifySingleTask(supabase, pr, taskId, internalMemberIds)
    }
  } catch (error) {
    console.error('[github] Failed to notify merged PR:', error)
  }
}

async function notifySingleTask(
  supabase: SupabaseClient,
  pr: MergedPRInfo,
  taskId: string,
  internalMemberIds: ReadonlySet<string>,
): Promise<void> {
  try {
    const { data: task } = await supabase
      .from('tasks')
      .select('id, org_id, space_id, title, status, assignee_id, created_by')
      .eq('id', taskId)
      .single()

    const taskRow = task as TaskRow | null
    if (!taskRow || taskRow.status === 'done') return

    const { data: ownerRows } = await supabase
      .from('task_owners')
      .select('user_id')
      .eq('task_id', taskId)
      .eq('side', 'internal')
    const internalOwnerIds = ((ownerRows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)

    const { data: space } = await supabase
      .from('spaces')
      .select('default_reviewer_ids')
      .eq('id', taskRow.space_id)
      .single()
    const defaultReviewerIds =
      ((space as { default_reviewer_ids?: string[] } | null)?.default_reviewer_ids) ?? []

    const recipients = resolveMergeNotifyRecipients({
      assigneeId: taskRow.assignee_id,
      internalOwnerIds,
      createdBy: taskRow.created_by,
      defaultReviewerIds,
      internalMemberIds,
    })

    if (recipients.length === 0) {
      console.log(`[github] merged PR notification: no internal recipient for task ${taskId}`)
      return
    }

    const { data: allLinks } = await supabase
      .from('task_github_links')
      .select('github_pr_id')
      .eq('task_id', taskId)
    const prIds = [...new Set(((allLinks ?? []) as Array<{ github_pr_id: string }>).map((r) => r.github_pr_id))]

    const { data: prRows } = await supabase
      .from('github_pull_requests')
      .select('id, pr_state')
      .in('id', prIds)
    const mergedCount = ((prRows ?? []) as Array<{ pr_state: string }>).filter(
      (r) => r.pr_state === 'merged',
    ).length
    const totalCount = prIds.length

    const { title, message } = buildMergeNotifyMessage({
      taskTitle: taskRow.title,
      prNumber: pr.prNumber,
      prTitle: pr.prTitle,
      mergedCount,
      totalCount,
    })

    const link = buildTaskDeepLink(taskRow.org_id, taskRow.space_id, taskRow.id)

    const rows = recipients.map((toUserId) => ({
      org_id: taskRow.org_id,
      space_id: taskRow.space_id,
      to_user_id: toUserId,
      channel: 'in_app',
      type: 'github_pr_merged',
      dedupe_key: `github_pr_merged:${taskId}:${pr.prId}`,
      payload: {
        task_id: taskId,
        task_title: taskRow.title,
        title,
        message,
        link,
        pr_number: pr.prNumber,
      },
    }))

    const { error } = await supabase
      .from('notifications')
      .upsert(rows, { onConflict: 'to_user_id,channel,dedupe_key', ignoreDuplicates: true })

    if (error) {
      console.error('[github] Failed to insert merged PR notifications:', error)
    }
  } catch (error) {
    console.error(`[github] Failed to notify merged PR for task ${taskId}:`, error)
  }
}
