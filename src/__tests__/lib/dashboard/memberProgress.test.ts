import { describe, it, expect } from 'vitest'
import { summarizeByMember } from '@/lib/dashboard/memberProgress'
import type { Task } from '@/types/database'

/**
 * ダッシュボードの「メンバー別」。担当者ごとに、状態別の件数と期限切れの数を出す。
 */

function task(overrides: Partial<Task>): Task {
  return {
    id: 't',
    title: 'タスク',
    status: 'todo',
    ball: 'internal',
    assignee_id: null,
    due_date: null,
    ...overrides,
  } as Task
}

const TODAY = '2026-09-16'

describe('summarizeByMember', () => {
  it('担当者ごとに、未着手・着手予定・進行中・確認待ち・完了を数える', () => {
    const rows = summarizeByMember(
      [
        task({ id: '1', assignee_id: 'sato', status: 'backlog' }),
        task({ id: '2', assignee_id: 'sato', status: 'considering' }),
        task({ id: '3', assignee_id: 'sato', status: 'todo' }),
        task({ id: '4', assignee_id: 'sato', status: 'in_progress' }),
        task({ id: '5', assignee_id: 'sato', status: 'in_review' }),
        task({ id: '6', assignee_id: 'sato', status: 'done' }),
      ],
      TODAY,
      new Set()
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].assigneeId).toBe('sato')
    expect(rows[0].counts).toEqual({ backlog: 2, todo: 1, in_progress: 1, in_review: 1, done: 1 })
    expect(rows[0].open).toBe(5)
  })

  it('返事待ちの承認依頼があるタスクは、状態が古いままでも確認待ちに数える', () => {
    const rows = summarizeByMember([task({ id: 'r', assignee_id: 'sato', status: 'in_progress' })], TODAY, new Set(['r']))
    expect(rows[0].counts.in_review).toBe(1)
    expect(rows[0].counts.in_progress).toBe(0)
  })

  it('期限切れを数え、残りのタスクを期限の早い順に持つ（完了は持たない）', () => {
    const rows = summarizeByMember(
      [
        task({ id: 'late', assignee_id: 'sato', due_date: '2026-09-10' }),
        task({ id: 'soon', assignee_id: 'sato', due_date: '2026-09-20' }),
        task({ id: 'none', assignee_id: 'sato' }),
        task({ id: 'done', assignee_id: 'sato', status: 'done', due_date: '2026-09-01' }),
      ],
      TODAY,
      new Set()
    )
    expect(rows[0].overdue).toBe(1)
    expect(rows[0].openTasks.map((t) => t.id)).toEqual(['late', 'soon', 'none'])
  })

  it('残りの多い人から並べ、担当者のいないタスクは最後に1行でまとめる', () => {
    const rows = summarizeByMember(
      [
        task({ id: 'n1' }),
        task({ id: 'a1', assignee_id: 'a' }),
        task({ id: 'b1', assignee_id: 'b' }),
        task({ id: 'b2', assignee_id: 'b' }),
        task({ id: 'n2' }),
        task({ id: 'n3' }),
      ],
      TODAY,
      new Set()
    )
    expect(rows.map((r) => r.assigneeId)).toEqual(['b', 'a', null])
  })

  it('完了しか持っていない人も出す（今週の働きが見えなくならないように）', () => {
    const rows = summarizeByMember([task({ id: 'd', assignee_id: 'a', status: 'done' })], TODAY, new Set())
    expect(rows).toHaveLength(1)
    expect(rows[0].open).toBe(0)
  })
})
