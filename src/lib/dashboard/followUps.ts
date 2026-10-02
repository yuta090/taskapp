import type { Task } from '@/types/database'
import { getClientWaitingDays } from '@/lib/tasks/clientWaitingDays'
import { daysOverdue } from '@/lib/dashboard/overdue'

/**
 * ダッシュボードの「クライアント確認が必要」と「期限が近いタスク」の判定。
 * Web（DashboardClient）とスマホアプリ（apps/mobile）で同じものを使う。React・Next.js に依存しない。
 */

/** Days since ball was passed to client before showing warning */
export const FOLLOW_UP_WARN_DAYS = 5
export const FOLLOW_UP_URGENT_DAYS = 7

/** 「期限が近いタスク」に出す最大件数 */
export const UPCOMING_DEADLINE_LIMIT = 8

/**
 * 期限まであと何日か（過ぎていれば負）。日本時間の今日の文字列と期限の日付だけで数える。
 * 「期限切れ」（src/lib/dashboard/overdue.ts）と同じ数え方にして、同じ画面で食い違わないようにする
 * （前は new Date(due_date) と今の時刻の差だったので、朝9時を過ぎると今日が期限のタスクが「1日超過」になった）。
 */
export function daysUntil(dueDate: string, today: string): number {
  // 0 - x にして、今日（0日）が -0 にならないようにする（数としては同じ）
  return 0 - daysOverdue(dueDate, today)
}

export type FollowUpLevel = 'urgent' | 'warn'

export interface ClientFollowUp {
  task: Task
  level: FollowUpLevel
  /** Days since task.updated_at (proxy for ball pass date) */
  staleDays: number
  /** Days until due (negative = overdue) */
  dueDaysLeft: number | null
}

export function classifyFollowUps(tasks: Task[], today: string, now: Date = new Date()): ClientFollowUp[] {
  const clientTasks = tasks.filter(
    (t) => t.ball === 'client' && t.status !== 'done'
  )

  const items: ClientFollowUp[] = []

  for (const task of clientTasks) {
    // Shared with TaskRow's "N日待ち" badge (B-4) so the two views can't disagree.
    const staleDays = getClientWaitingDays(task.updated_at, now)
    const dueDaysLeft = task.due_date ? daysUntil(task.due_date, today) : null

    // urgent: overdue OR stale 7+ days with due soon
    const isOverdue = dueDaysLeft !== null && dueDaysLeft < 0
    const isStaleUrgent =
      staleDays >= FOLLOW_UP_URGENT_DAYS && dueDaysLeft !== null && dueDaysLeft <= 3

    if (isOverdue || isStaleUrgent) {
      items.push({ task, level: 'urgent', staleDays, dueDaysLeft })
      continue
    }

    // warn: stale 5+ days OR due within a week
    const isStaleWarn = staleDays >= FOLLOW_UP_WARN_DAYS
    const isDueSoon = dueDaysLeft !== null && dueDaysLeft <= 7

    if (isStaleWarn || isDueSoon) {
      items.push({ task, level: 'warn', staleDays, dueDaysLeft })
    }
  }

  // Sort: urgent first, then by staleDays descending
  items.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'urgent' ? -1 : 1
    return b.staleDays - a.staleDays
  })

  return items
}

export function formatDueDays(days: number | null): string {
  if (days === null) return '期限なし'
  if (days < 0) return `${Math.abs(days)}日超過`
  if (days === 0) return '今日'
  return `${days}日後`
}

export interface UpcomingDeadline {
  task: Task
  /** 期限まであと何日か（負 = 過ぎている） */
  daysLeft: number
}

/** 期限が7日以内（過ぎているものも含む）の未完了タスクを、期限の近い順に最大8件 */
export function upcomingDeadlines(tasks: Task[], today: string): UpcomingDeadline[] {
  return tasks
    .filter((t) => t.status !== 'done' && t.due_date)
    .map((t) => ({
      task: t,
      daysLeft: daysUntil(t.due_date!, today),
    }))
    .filter((t) => t.daysLeft <= 7)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .slice(0, UPCOMING_DEADLINE_LIMIT)
}
