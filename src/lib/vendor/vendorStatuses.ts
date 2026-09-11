/**
 * 協力会社（vendor-portal）のタスク一覧が選べるステータス。
 * `VendorTasksClient.tsx` の `<select>` の選択肢と、ステータス変更API
 * (`/api/vendor-portal/tasks/[taskId]/status`) の検査の両方がここを見る。
 */
export const VENDOR_TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review'] as const

export type VendorTaskStatus = (typeof VENDOR_TASK_STATUSES)[number]

export function isVendorTaskStatus(value: unknown): value is VendorTaskStatus {
  return typeof value === 'string' && (VENDOR_TASK_STATUSES as readonly string[]).includes(value)
}
