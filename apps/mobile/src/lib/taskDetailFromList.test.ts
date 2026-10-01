import { describe, expect, it } from 'vitest'
import type { Space, Task } from '@/types/database'
import { taskDetailFromList } from './taskDetailFromList'

function task(over: Partial<Task>): Task {
  return {
    id: 't1',
    org_id: 'o1',
    space_id: 's1',
    milestone_id: null,
    parent_task_id: null,
    title: 'タスク',
    description: null,
    status: 'todo',
    priority: null,
    assignee_id: 'u1',
    start_date: null,
    due_date: null,
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    spec_path: null,
    wiki_page_id: null,
    decision_state: null,
    client_scope: 'deliverable',
    estimated_cost: null,
    estimate_status: 'none',
    completed_at: null,
    is_sample: false,
    short_id: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    actual_hours: null,
    ...over,
  } as Task
}

function space(over: Partial<Space>): Space {
  return { id: 's1', org_id: 'o1', name: 'A社サイト', ...over } as Space
}

describe('taskDetailFromList', () => {
  it('一覧にあるタスクをタスク詳細の形にする', () => {
    const data = {
      tasks: [task({ id: 't1' })],
      reviewStatuses: { t1: 'approved' as const },
      spaces: [space({})],
      milestones: [],
    }
    expect(taskDetailFromList(data, 't1')).toEqual({
      task: data.tasks[0],
      reviewStatus: 'approved',
      spaceName: 'A社サイト',
    })
  })

  it('一覧がまだ無ければ undefined', () => {
    expect(taskDetailFromList(undefined, 't1')).toBeUndefined()
  })

  it('一覧に無いタスク（他人の担当など）は undefined', () => {
    const data = { tasks: [task({ id: 'other' })], reviewStatuses: {}, spaces: [], milestones: [] }
    expect(taskDetailFromList(data, 't1')).toBeUndefined()
  })

  it('承認状況が無いタスクは reviewStatus が undefined', () => {
    const data = { tasks: [task({ id: 't1' })], reviewStatuses: {}, spaces: [space({})], milestones: [] }
    expect(taskDetailFromList(data, 't1')?.reviewStatus).toBeUndefined()
  })

  it('プロジェクトが見つからなければ spaceName が null', () => {
    const data = { tasks: [task({ id: 't1', space_id: 's9' })], reviewStatuses: {}, spaces: [space({})], milestones: [] }
    expect(taskDetailFromList(data, 't1')?.spaceName).toBeNull()
  })
})
