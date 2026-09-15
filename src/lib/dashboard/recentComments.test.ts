import { describe, it, expect } from 'vitest'
import { latestCommentPerTask, type RecentCommentRow } from './recentComments'

function row(id: string, taskId: string, createdAt: string): RecentCommentRow {
  return {
    id,
    task_id: taskId,
    actor_id: 'user-1',
    body: `本文 ${id}`,
    created_at: createdAt,
  }
}

describe('latestCommentPerTask — 1タスク1行にする', () => {
  // 取得は新しい順（created_at 降順）で届く
  const rows = [
    row('c5', 'task-a', '2026-09-16T05:00:00Z'),
    row('c4', 'task-b', '2026-09-16T04:00:00Z'),
    row('c3', 'task-a', '2026-09-16T03:00:00Z'),
    row('c2', 'task-c', '2026-09-16T02:00:00Z'),
    row('c1', 'task-b', '2026-09-16T01:00:00Z'),
  ]

  it('同じタスクのコメントは、いちばん新しい1件だけを残す', () => {
    expect(latestCommentPerTask(rows, 10).map((r) => r.id)).toEqual(['c5', 'c4', 'c2'])
  })

  it('件数の上限で切る（新しいコメントのタスクから）', () => {
    expect(latestCommentPerTask(rows, 2).map((r) => r.task_id)).toEqual(['task-a', 'task-b'])
  })

  it('届いた順が新しい順でなくても、新しい順に並べ直してから絞る', () => {
    const shuffled = [rows[4], rows[2], rows[0], rows[3], rows[1]]
    expect(latestCommentPerTask(shuffled, 10).map((r) => r.id)).toEqual(['c5', 'c4', 'c2'])
  })

  it('0件なら空', () => {
    expect(latestCommentPerTask([], 10)).toEqual([])
  })
})
