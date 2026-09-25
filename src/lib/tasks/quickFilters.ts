import type { Task } from '@/types/database'
import { dueBucketOf } from '@/lib/tasks/myTaskViews'

/**
 * タスク一覧の上のタブ（絞り込み）。ダッシュボードの上の数字は、ここと同じ判定で数えてからタスク一覧へ飛ぶ。
 * 画面ごとに数え方を書くと、ダッシュボードの「3件」を押した先に2件しか並ばない、が起きるため1か所にまとめる。
 */

export const QUICK_FILTER_KEYS = [
  'all',
  'active',
  'backlog',
  'overdue',
  'in_review',
  'client_wait',
  'client_origin',
] as const

export type QuickFilterKey = (typeof QUICK_FILTER_KEYS)[number]

/** 何も指定がないときの絞り込み。既定なので URL には付けない（付けるのは他を選んだときだけ） */
export const DEFAULT_QUICK_FILTER: QuickFilterKey = 'active'

const KEYS: ReadonlySet<string> = new Set(QUICK_FILTER_KEYS)

export function parseQuickFilter(param: string | null): QuickFilterKey {
  return param != null && KEYS.has(param) ? (param as QuickFilterKey) : DEFAULT_QUICK_FILTER
}

export interface QuickFilterContext {
  /** 日本時間の今日（'YYYY-MM-DD'）。期限切れの判定に使う */
  today: string
  /** 返事待ち（open）の承認依頼があるタスクの id */
  openReviewTaskIds: ReadonlySet<string>
}

/**
 * レビュー待ちか。状態が「確認待ち」か、返事待ちの承認依頼があるもの。
 * 依頼すると状態が自動で in_review になるが、その仕組みより前（2026-09-14 より前）に作った依頼は
 * 状態が古いまま残っているので、依頼の側からも拾う。完了したものは入れない。
 */
export function isAwaitingReview(task: Pick<Task, 'id' | 'status'>, openReviewTaskIds: ReadonlySet<string>): boolean {
  if (task.status === 'done') return false
  return task.status === 'in_review' || openReviewTaskIds.has(task.id)
}

export function applyQuickFilter(tasks: readonly Task[], key: QuickFilterKey, ctx: QuickFilterContext): Task[] {
  switch (key) {
    case 'active':
      return tasks.filter((task) => task.status !== 'backlog' && task.status !== 'done')
    case 'backlog':
      return tasks.filter((task) => task.status === 'backlog')
    case 'overdue':
      // ダッシュボードの「期限切れ」・マイタスクの期限別と同じ判定
      return tasks.filter((task) => dueBucketOf(task, ctx.today) === 'overdue')
    case 'in_review':
      return tasks.filter((task) => isAwaitingReview(task, ctx.openReviewTaskIds))
    case 'client_wait':
      return tasks.filter((task) => task.ball === 'client' && task.status !== 'done')
    case 'client_origin':
      return tasks.filter((task) => task.origin === 'client')
    case 'all':
      return [...tasks]
  }
}

/** その絞り込みをかけたタスク一覧の URL。basePath はプロジェクトのタスク一覧（/[orgId]/project/[spaceId]） */
export function quickFilterHref(basePath: string, key: QuickFilterKey): string {
  return key === DEFAULT_QUICK_FILTER ? basePath : `${basePath}?filter=${key}`
}
