import { describe, expect, it } from 'vitest'
import type { Task } from '@/types/database'
import { buildMyTaskListItems } from './myTaskList'

function task(over: Partial<Task>): Task {
  return {
    id: 't',
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

const data = {
  tasks: [
    task({ id: 'late', due_date: '2026-09-27', title: '遅れ' }),
    task({ id: 'today', due_date: '2026-09-28', title: '今日' }),
    task({ id: 'client', due_date: '2026-09-28', ball: 'client', title: '相手待ち' }),
    task({ id: 'done', status: 'done', title: '完了済み' }),
    task({ id: 'backlog', status: 'backlog', title: '未着手' }),
  ],
  reviewStatuses: {},
  spaces: [],
  milestones: [],
}

describe('buildMyTaskListItems', () => {
  it('期限別の見出しとタスクを1本に並べる（完了・未着手は出さない）', () => {
    const items = buildMyTaskListItems(data, { ball: 'all' }, '2026-09-28', new Set())
    expect(items.map((i) => (i.kind === 'header' ? `# ${i.label}` : i.task.id))).toEqual([
      '# 期限切れ',
      'late',
      '# 今日',
      'today',
      'client',
    ])
  })

  it('見出しに件数を付け、期限切れは強調する', () => {
    const items = buildMyTaskListItems(data, { ball: 'all' }, '2026-09-28', new Set())
    const late = items[0]
    expect(late).toMatchObject({ kind: 'header', count: 1, tone: 'danger' })
  })

  it('自分たちの番（ボールが社内）だけに絞れる', () => {
    const items = buildMyTaskListItems(data, { ball: 'internal' }, '2026-09-28', new Set())
    expect(items.filter((i) => i.kind === 'task').map((i) => (i.kind === 'task' ? i.task.id : ''))).toEqual([
      'late',
      'today',
    ])
  })

  it('自分が承認者のタスクに印を付ける', () => {
    const items = buildMyTaskListItems(data, { ball: 'all' }, '2026-09-28', new Set(['today']))
    const today = items.find((i) => i.kind === 'task' && i.task.id === 'today')
    expect(today).toMatchObject({ awaitingMyApproval: true })
  })

  it('タスクが無ければ空', () => {
    expect(buildMyTaskListItems({ ...data, tasks: [] }, { ball: 'all' }, '2026-09-28', new Set())).toEqual([])
  })
})
