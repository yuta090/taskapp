import { describe, it, expect } from 'vitest'
import type { Milestone, Task } from '@/types/database'
import { milestoneProgress } from './milestoneProgress'

const TODAY = '2026-09-16'

function ms(overrides: Partial<Milestone>): Milestone {
  return { id: 'm', name: 'マイルストーン', due_date: null, completed_at: null, ...overrides } as Milestone
}

function task(overrides: Partial<Task>): Task {
  return { id: 't', status: 'todo', milestone_id: null, ...overrides } as Task
}

describe('milestoneProgress — マイルストーンの進み具合', () => {
  it('完了していないマイルストーンだけを、渡された順に出す', () => {
    const items = milestoneProgress([ms({ id: 'a' }), ms({ id: 'b', completed_at: '2026-09-01T00:00:00Z' }), ms({ id: 'c' })], [], TODAY)
    expect(items.map((i) => i.milestone.id)).toEqual(['a', 'c'])
  })

  it('紐づくタスクのうち done の数と割合（四捨五入）を数える', () => {
    const [item] = milestoneProgress(
      [ms({ id: 'a' })],
      [
        task({ id: '1', milestone_id: 'a', status: 'done' }),
        task({ id: '2', milestone_id: 'a', status: 'todo' }),
        task({ id: '3', milestone_id: 'a', status: 'todo' }),
        task({ id: '4', milestone_id: 'other', status: 'done' }),
      ],
      TODAY
    )
    expect(item).toMatchObject({ done: 1, total: 3, pct: 33 })
  })

  it('タスクが0件なら 0/0・0%', () => {
    const [item] = milestoneProgress([ms({ id: 'a' })], [], TODAY)
    expect(item).toMatchObject({ done: 0, total: 0, pct: 0 })
  })

  it('期限までの日数。期限なしは null', () => {
    const items = milestoneProgress(
      [ms({ id: 'a', due_date: '2026-09-18' }), ms({ id: 'b', due_date: '2026-09-10' }), ms({ id: 'c', due_date: null })],
      [],
      TODAY
    )
    expect(items.map((i) => i.daysLeft)).toEqual([2, -6, null])
  })
})
