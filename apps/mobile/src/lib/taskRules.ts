/**
 * タスクを変えるときの決まり（Web の useTasks と同じ意味。あちらは hook の中に閉じているので、
 * 同じ文言・同じ条件をここに持つ）。
 */
import { STATUS_CHANGE_NO_ROWS } from '@/lib/tasks/completeFailure'
import type { ReviewStatus, Task, TaskStatus } from '@/types/database'

export const STATUS_CHOICES: readonly { value: TaskStatus; label: string }[] = [
  { value: 'backlog', label: '未着手' },
  { value: 'todo', label: '着手予定' },
  { value: 'in_progress', label: '進行中' },
  { value: 'done', label: '完了' },
]

/** 完了にできない理由（できるなら null）。DB も同じ条件で拒否するが、先に分かる理由を出す */
export function completionBlocker(
  reviewStatus: ReviewStatus | undefined,
  task: Pick<Task, 'type' | 'decision_state'>
): string | null {
  if (reviewStatus === 'open' || reviewStatus === 'changes_requested') {
    return '社内承認が完了するまでタスクを完了できません'
  }
  if (task.type === 'spec' && task.decision_state === 'considering') {
    return '決定事項が未決のため完了できません'
  }
  return null
}

/** RLS に弾かれた更新はエラーにならず 0 行で返るので、ここで失敗にする */
export function ensureUpdated(rows: readonly unknown[] | null): void {
  if (!rows || rows.length === 0) throw new Error(STATUS_CHANGE_NO_ROWS)
}
