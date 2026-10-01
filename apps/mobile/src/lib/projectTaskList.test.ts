import { describe, expect, it } from 'vitest'
import { QUICK_FILTER_KEYS } from '@/lib/tasks/quickFilters'
import type { Task } from '@/types/database'
import { buildProjectTaskList, PROJECT_TASK_FILTERS } from './projectTaskList'

function task(over: Partial<Task>): Task {
  return {
    id: 't1',
    org_id: 'o1',
    space_id: 's1',
    title: 'タスク',
    status: 'todo',
    due_date: null,
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    created_at: '2026-09-01T00:00:00Z',
    ...over,
  } as Task
}

const TODAY = '2026-10-01'

const data = {
  tasks: [
    task({ id: 'todo', status: 'todo' }),
    task({ id: 'backlog', status: 'backlog' }),
    task({ id: 'done', status: 'done', ball: 'client' }),
    task({ id: 'late', status: 'in_progress', due_date: '2026-09-20' }),
    task({ id: 'review', status: 'in_review' }),
    task({ id: 'openReview', status: 'in_progress' }),
    task({ id: 'wait', status: 'todo', ball: 'client' }),
    task({ id: 'fromClient', status: 'todo', origin: 'client' }),
  ],
  reviewStatuses: { openReview: 'open', todo: 'approved' } as Record<string, 'open' | 'approved'>,
}

const ids = (filter: Parameters<typeof buildProjectTaskList>[1]) =>
  buildProjectTaskList(data, filter, TODAY).map((t) => t.id)

describe('buildProjectTaskList', () => {
  it('all は全件を取得順のまま返す', () => {
    expect(ids('all')).toEqual(data.tasks.map((t) => t.id))
  })

  it('active は未着手と完了を除く', () => {
    expect(ids('active')).toEqual(['todo', 'late', 'review', 'openReview', 'wait', 'fromClient'])
  })

  it('backlog は未着手だけ', () => {
    expect(ids('backlog')).toEqual(['backlog'])
  })

  it('overdue は期限を過ぎた未完了だけ', () => {
    expect(ids('overdue')).toEqual(['late'])
  })

  it('in_review は状態が確認待ちのものと、open の承認依頼があるものを拾う', () => {
    expect(ids('in_review')).toEqual(['review', 'openReview'])
  })

  it('open でない承認依頼（承認済み）は in_review に入れない', () => {
    expect(ids('in_review')).not.toContain('todo')
  })

  it('client_wait は相手先の番で、完了していないもの', () => {
    expect(ids('client_wait')).toEqual(['wait'])
    expect(ids('client_wait')).not.toContain('done')
  })

  it('client_origin は相手先が起案したもの', () => {
    expect(ids('client_origin')).toEqual(['fromClient'])
  })

  it('入力の配列を並べ替えない', () => {
    const before = data.tasks.map((t) => t.id)
    ids('all')
    expect(data.tasks.map((t) => t.id)).toEqual(before)
  })
})

describe('PROJECT_TASK_FILTERS', () => {
  it('Web の表示順で、QUICK_FILTER_KEYS を過不足なく並べる', () => {
    expect(PROJECT_TASK_FILTERS.map((f) => f.key)).toEqual([
      'active',
      'all',
      'backlog',
      'overdue',
      'in_review',
      'client_wait',
      'client_origin',
    ])
    expect([...PROJECT_TASK_FILTERS.map((f) => f.key)].sort()).toEqual([...QUICK_FILTER_KEYS].sort())
  })
})
