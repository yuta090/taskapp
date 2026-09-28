import { describe, it, expect } from 'vitest'
import { applyQuickFilter, parseQuickFilter, quickFilterHref } from '@/lib/tasks/quickFilters'
import type { Task } from '@/types/database'

/**
 * タスク一覧の上のタブ（絞り込み）。ダッシュボードの数字と同じ判定を使うので、ここで1か所にまとめる。
 */

function task(overrides: Partial<Task>): Task {
  return {
    id: 't',
    title: 'タスク',
    status: 'todo',
    ball: 'internal',
    origin: 'internal',
    due_date: null,
    ...overrides,
  } as Task
}

const TODAY = '2026-09-16'
const ctx = (openReviewTaskIds: string[] = []) => ({ today: TODAY, openReviewTaskIds: new Set(openReviewTaskIds) })
const ids = (tasks: Task[]) => tasks.map((t) => t.id)

describe('parseQuickFilter', () => {
  it('知っている名前はそのまま、知らない名前と未指定は既定の「アクティブ」にする', () => {
    expect(parseQuickFilter('overdue')).toBe('overdue')
    expect(parseQuickFilter('in_review')).toBe('in_review')
    expect(parseQuickFilter('client_wait')).toBe('client_wait')
    expect(parseQuickFilter('nope')).toBe('active')
    expect(parseQuickFilter(null)).toBe('active')
  })
})

describe('applyQuickFilter — 期限切れ', () => {
  it('期限が日本時間の今日より前で、完了していないものだけ', () => {
    const tasks = [
      task({ id: 'past', due_date: '2026-09-15' }),
      task({ id: 'today', due_date: '2026-09-16' }),
      task({ id: 'done', status: 'done', due_date: '2026-09-01' }),
      task({ id: 'backlog', status: 'backlog', due_date: '2026-09-01' }),
      task({ id: 'none' }),
    ]
    expect(ids(applyQuickFilter(tasks, 'overdue', ctx()))).toEqual(['past', 'backlog'])
  })
})

describe('applyQuickFilter — レビュー待ち', () => {
  it('状態が「確認待ち」か、返事待ちの承認依頼があるもの。完了したものは入れない', () => {
    const tasks = [
      task({ id: 'status', status: 'in_review' }),
      task({ id: 'open-review', status: 'in_progress' }),
      task({ id: 'done-with-open', status: 'done' }),
      task({ id: 'plain' }),
    ]
    expect(ids(applyQuickFilter(tasks, 'in_review', ctx(['open-review', 'done-with-open'])))).toEqual([
      'status',
      'open-review',
    ])
  })
})

describe('applyQuickFilter — 前からあるタブ', () => {
  it('アクティブ・未着手・クライアント確認待ち・クライアント起案・すべて', () => {
    const tasks = [
      task({ id: 'a', status: 'in_progress' }),
      task({ id: 'b', status: 'backlog' }),
      task({ id: 'c', ball: 'client' }),
      task({ id: 'd', status: 'done', ball: 'client', origin: 'client' }),
    ]
    expect(ids(applyQuickFilter(tasks, 'active', ctx()))).toEqual(['a', 'c'])
    expect(ids(applyQuickFilter(tasks, 'backlog', ctx()))).toEqual(['b'])
    expect(ids(applyQuickFilter(tasks, 'client_wait', ctx()))).toEqual(['c'])
    expect(ids(applyQuickFilter(tasks, 'client_origin', ctx()))).toEqual(['d'])
    expect(ids(applyQuickFilter(tasks, 'all', ctx()))).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('quickFilterHref', () => {
  it('既定の「アクティブ」は URL に付けない。ほかは ?filter= を付ける', () => {
    expect(quickFilterHref('/o/project/s', 'active')).toBe('/o/project/s')
    expect(quickFilterHref('/o/project/s', 'overdue')).toBe('/o/project/s?filter=overdue')
  })
})
