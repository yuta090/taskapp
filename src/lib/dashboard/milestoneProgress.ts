import type { Milestone, Task } from '@/types/database'
import { daysUntil } from '@/lib/dashboard/followUps'

/**
 * ダッシュボードの「マイルストーン進捗」の数え方。Web（DashboardClient）とスマホアプリで同じものを使う。
 * React・Next.js に依存しない。
 */

export interface MilestoneProgressItem {
  milestone: Milestone
  /** 紐づくタスクのうち完了した数 */
  done: number
  /** 紐づくタスクの数 */
  total: number
  /** 完了の割合（0〜100・四捨五入。タスクが0件なら 0） */
  pct: number
  /** 期限まであと何日か（負 = 過ぎている）。期限が無ければ null */
  daysLeft: number | null
}

/** 完了していないマイルストーンについて、紐づくタスクの進み具合を数える。並びは渡された順 */
export function milestoneProgress(
  milestones: readonly Milestone[],
  tasks: readonly Task[],
  today: string
): MilestoneProgressItem[] {
  return milestones
    .filter((m) => !m.completed_at)
    .map((milestone) => {
      const msTasks = tasks.filter((t) => t.milestone_id === milestone.id)
      const done = msTasks.filter((t) => t.status === 'done').length
      const total = msTasks.length
      const pct = total > 0 ? Math.round((done / total) * 100) : 0
      const daysLeft = milestone.due_date ? daysUntil(milestone.due_date, today) : null
      return { milestone, done, total, pct, daysLeft }
    })
}
