import type { HealthStatus } from '@/components/portal'

export interface ComputeHealthStatusParams {
  /** Client-facing tasks whose own due_date has already passed */
  overdueTaskCount: number
  /** Total number of tasks currently waiting on the client */
  totalActionTaskCount: number
  /** Days the next milestone / delivery date is overdue (0 or negative = not overdue) */
  milestoneOverdueDays: number
  milestoneName?: string
}

export interface HealthStatusResult {
  status: HealthStatus
  reason: string
}

/**
 * H-2: the dashboard previously computed "現在のステータス" only from
 * per-task due dates, ignoring the next-milestone/delivery overdue days shown
 * a few cards over — so "順調に進行中" could sit right next to "127日超過".
 * This folds milestone overdue into the same status so they can never
 * contradict each other.
 */
export function computeHealthStatus({
  overdueTaskCount,
  totalActionTaskCount,
  milestoneOverdueDays,
  milestoneName,
}: ComputeHealthStatusParams): HealthStatusResult {
  if (overdueTaskCount > 0) {
    return {
      status: 'needs_attention',
      reason: `${overdueTaskCount}件のタスクが期限を過ぎています`,
    }
  }

  if (milestoneOverdueDays > 0) {
    return {
      status: 'needs_attention',
      reason: milestoneName
        ? `マイルストーン「${milestoneName}」の期限を${milestoneOverdueDays}日超過しています`
        : `マイルストーンの期限を${milestoneOverdueDays}日超過しています`,
    }
  }

  if (totalActionTaskCount > 5) {
    return {
      status: 'at_risk',
      reason: '確認待ちタスクが多くなっています',
    }
  }

  return {
    status: 'on_track',
    reason: '全タスクが予定通りに進行中です',
  }
}
