import { describe, it, expect } from 'vitest'
import { applyReviewChange } from '@/lib/tasks/reviewStatusSync'
import type { Task } from '@/types/database'

const task = (over: Partial<Task> & { id: string }): Task =>
  ({
    org_id: 'o1',
    space_id: 's1',
    title: 't',
    status: 'backlog',
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    ...over,
  }) as Task

const data = (tasks: Task[], reviewStatuses: Record<string, string> = {}) => ({
  tasks,
  owners: {},
  reviewStatuses: reviewStatuses as never,
})

describe('applyReviewChange: 依頼の状態', () => {
  it('依頼が open になったら reviewStatuses に入る', () => {
    const next = applyReviewChange(data([task({ id: 'a' })]), 'a', 'open')
    expect(next.reviewStatuses['a']).toBe('open')
  })

  it('null なら reviewStatuses から消える', () => {
    const next = applyReviewChange(data([task({ id: 'a' })], { a: 'open' }), 'a', null)
    expect(next.reviewStatuses['a']).toBeUndefined()
  })
})

describe('applyReviewChange: タスクの状態も揃える', () => {
  it('依頼が open になったら、そのタスクを社内承認中にする', () => {
    const next = applyReviewChange(data([task({ id: 'a', status: 'backlog' })]), 'a', 'open')
    expect(next.tasks[0].status).toBe('in_review')
  })

  it('完了済みのタスクは戻さない（DB 側のトリガーと同じ判断）', () => {
    const next = applyReviewChange(data([task({ id: 'a', status: 'done' })]), 'a', 'open')
    expect(next.tasks[0].status).toBe('done')
  })

  it('承認・差し戻しでは状態を動かさない', () => {
    for (const status of ['approved', 'changes_requested', 'cancelled']) {
      const next = applyReviewChange(data([task({ id: 'a', status: 'in_progress' })]), 'a', status)
      expect(next.tasks[0].status).toBe('in_progress')
    }
  })

  it('ほかのタスクには触らない', () => {
    const before = data([task({ id: 'a', status: 'backlog' }), task({ id: 'b', status: 'todo' })])
    const next = applyReviewChange(before, 'a', 'open')
    expect(next.tasks[1].status).toBe('todo')
    // 変える必要が無い行は同じ参照のまま（むだな再描画を増やさない）
    expect(next.tasks[1]).toBe(before.tasks[1])
  })

  it('一覧にまだ無いタスクでも落ちない', () => {
    const next = applyReviewChange(data([task({ id: 'a' })]), 'missing', 'open')
    expect(next.tasks).toHaveLength(1)
    expect(next.reviewStatuses['missing']).toBe('open')
  })

  it('状態を変えないときは tasks の配列ごと同じ参照を返す', () => {
    const before = data([task({ id: 'a', status: 'todo' })])
    const next = applyReviewChange(before, 'a', 'approved')
    expect(next.tasks).toBe(before.tasks)
  })
})

describe('applyReviewChange: 承認がそろって完了になったとき', () => {
  it('DB 側がタスクを完了にしたら、一覧のタスクも完了にする', () => {
    const next = applyReviewChange(
      data([task({ id: 'a', status: 'in_review' })], { a: 'open' }),
      'a',
      'approved',
      true
    )
    expect(next.tasks[0].status).toBe('done')
    expect(next.reviewStatuses['a']).toBe('approved')
  })

  it('完了になった印が無ければ、タスクの状態は動かさない（承認者がまだ残っている等）', () => {
    const next = applyReviewChange(
      data([task({ id: 'a', status: 'in_review' })], { a: 'open' }),
      'a',
      'open',
      false
    )
    expect(next.tasks[0].status).toBe('in_review')
  })

  it('完了にしたときは完了日時も入れる（一覧の並びが崩れないように）', () => {
    const next = applyReviewChange(
      data([task({ id: 'a', status: 'in_review', completed_at: null })], { a: 'open' }),
      'a',
      'approved',
      true
    )
    expect(next.tasks[0].completed_at).toBeTruthy()
  })
})
