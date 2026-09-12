import type { Task } from '../supabase/client.js'

/**
 * 実績工数(actual_hours)は社内専用の別表 task_internal_metrics（task_id が主キー・
 * tasks と1:1）にある。tasks.actual_hours（旧列。C3で削除予定のつなぎ経由）ではなく、
 * 埋め込みで読んだ新表の値を actual_hours として使う（呼び出し元から見える形は変えない）。
 * `select('*, task_internal_metrics (actual_hours)')` で一緒に読んだ行に適用する。
 */
export function flattenTaskInternalMetrics(row: Task): Task {
  const { task_internal_metrics, ...rest } = row as unknown as Record<string, unknown>
  const metrics = (
    Array.isArray(task_internal_metrics) ? task_internal_metrics[0] : task_internal_metrics
  ) as { actual_hours: number | null } | null | undefined
  return { ...rest, actual_hours: metrics?.actual_hours ?? null } as Task
}
