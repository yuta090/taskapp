import type { Task } from '@/types/database'

// ガントは描画のたびに今日を求めるので、書式は作り直さず使い回す
const JST_DATE_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' })

/**
 * JST（Asia/Tokyo）での今日を 'YYYY-MM-DD' で返す。
 * 実行環境のタイムゾーンに依存させない（UTC の本番/CI で1日ずれるのを防ぐ）。
 */
export function todayJstString(now: Date = new Date()): string {
  return JST_DATE_FORMAT.format(now)
}

/**
 * 期限を過ぎていて、まだ完了していないタスクか。期限当日はまだ期限切れにしない。
 * due_date は日付だけを比べる（Date を経由するとタイムゾーンで1日ずれるため文字列で比べる）。
 */
export function isTaskOverdue(task: Pick<Task, 'status' | 'due_date'>, todayJst: string): boolean {
  if (task.status === 'done' || !task.due_date) return false
  return task.due_date.slice(0, 10) < todayJst
}
