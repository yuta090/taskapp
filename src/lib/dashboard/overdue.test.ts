import { describe, it, expect } from 'vitest'
import type { Task } from '@/types/database'
import { daysOverdue, groupOverdueTasks, overdueKindOf } from './overdue'

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? 't',
    title: overrides.title ?? 'タスク',
    status: 'todo',
    ball: 'internal',
    due_date: null,
    ...overrides,
  } as Task
}

const TODAY = '2026-09-16'

describe('overdueKindOf — どの見出しに入れるか', () => {
  it('社内承認中（in_review）は「承認待ち」', () => {
    expect(overdueKindOf(task({ status: 'in_review' }), new Set())).toBe('review')
  })

  it('状態が変わっていなくても、返事待ちの承認依頼があれば「承認待ち」', () => {
    // 依頼で状態が自動で付くようになる前（2026-09-14 より前）に作った依頼が残っているため
    expect(overdueKindOf(task({ id: 'a', status: 'in_progress' }), new Set(['a']))).toBe('review')
  })

  it('ボールが相手先にあれば「クライアント確認待ち」', () => {
    expect(overdueKindOf(task({ ball: 'client' }), new Set())).toBe('client')
  })

  it('承認待ちとクライアント確認待ちの両方に当たるときは「承認待ち」に1回だけ入れる', () => {
    expect(overdueKindOf(task({ status: 'in_review', ball: 'client' }), new Set())).toBe('review')
  })

  it('どちらでもなければ「タスク」', () => {
    expect(overdueKindOf(task({ ball: 'internal', status: 'backlog' }), new Set())).toBe('task')
  })
})

describe('daysOverdue — 何日過ぎたか', () => {
  it('昨日が期限なら1日', () => {
    expect(daysOverdue('2026-09-15', TODAY)).toBe(1)
  })

  it('月をまたいでも日数で数える', () => {
    expect(daysOverdue('2026-08-30', TODAY)).toBe(17)
  })

  it('時刻つきの値でも日付の部分だけで数える', () => {
    expect(daysOverdue('2026-09-13T00:00:00+09:00', TODAY)).toBe(3)
  })
})

describe('groupOverdueTasks — 期限切れを3つに分ける', () => {
  it('期限が今日より前で、完了していないものだけを拾う', () => {
    const groups = groupOverdueTasks(
      [
        task({ id: 'yesterday', due_date: '2026-09-15' }),
        task({ id: 'today', due_date: '2026-09-16' }),
        task({ id: 'tomorrow', due_date: '2026-09-17' }),
        task({ id: 'done', due_date: '2026-09-01', status: 'done' }),
        task({ id: 'no-date', due_date: null }),
      ],
      TODAY
    )
    expect(groups.task.map((i) => i.task.id)).toEqual(['yesterday'])
    expect(groups.total).toBe(1)
  })

  it('承認待ち・クライアント確認待ち・タスクに振り分け、過ぎた日数を付ける', () => {
    const groups = groupOverdueTasks(
      [
        task({ id: 'r', status: 'in_review', due_date: '2026-09-14' }),
        task({ id: 'c', ball: 'client', due_date: '2026-09-10' }),
        task({ id: 't', due_date: '2026-09-15' }),
      ],
      TODAY
    )
    expect(groups.review).toEqual([expect.objectContaining({ kind: 'review', daysOverdue: 2 })])
    expect(groups.client).toEqual([expect.objectContaining({ kind: 'client', daysOverdue: 6 })])
    expect(groups.task).toEqual([expect.objectContaining({ kind: 'task', daysOverdue: 1 })])
    expect(groups.total).toBe(3)
  })

  it('それぞれの見出しの中は、長く過ぎているものから並べる', () => {
    const groups = groupOverdueTasks(
      [
        task({ id: 'recent', due_date: '2026-09-15' }),
        task({ id: 'oldest', due_date: '2026-08-01' }),
        task({ id: 'middle', due_date: '2026-09-01' }),
      ],
      TODAY
    )
    expect(groups.task.map((i) => i.task.id)).toEqual(['oldest', 'middle', 'recent'])
  })

  it('返事待ちの承認依頼のタスク id を渡すと、状態が古いままでも承認待ちに入る', () => {
    const groups = groupOverdueTasks(
      [task({ id: 'legacy', status: 'in_progress', due_date: '2026-09-01' })],
      TODAY,
      new Set(['legacy'])
    )
    expect(groups.review.map((i) => i.task.id)).toEqual(['legacy'])
    expect(groups.task).toEqual([])
  })
})
