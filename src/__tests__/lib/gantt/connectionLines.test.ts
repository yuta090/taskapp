import { describe, it, expect } from 'vitest'
import { computeConnectionLines, type GanttRowDatum } from '@/lib/gantt/connectionLines'
import { GANTT_CONFIG } from '@/lib/gantt/constants'
import type { Task } from '@/types/database'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    org_id: 'org-1',
    space_id: 'space-1',
    title: 'Task',
    description: null,
    status: 'todo',
    priority: null,
    assignee_id: null,
    start_date: null,
    due_date: null,
    milestone_id: null,
    parent_task_id: null,
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    spec_path: null,
    wiki_page_id: null,
    decision_state: null,
    client_scope: 'internal',
    actual_hours: null,
    estimated_cost: null,
    estimate_status: 'none',
    completed_at: null,
    is_sample: false,
    due_authority_connection_id: null,
    short_id: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  }
}

const startDate = new Date('2024-01-01')
const dayWidth = 40

function row(rowIndex: number, task?: Task): GanttRowDatum {
  return { type: task ? 'task' : 'header', task, rowIndex }
}

describe('computeConnectionLines', () => {
  it('親が子より上の行にある場合、親の終了位置から子の開始位置への線を1本返す', () => {
    const parent = makeTask({ id: 'parent', due_date: '2024-01-10' })
    const child = makeTask({ id: 'child', parent_task_id: 'parent', start_date: '2024-01-11' })
    const rowData: GanttRowDatum[] = [row(0, parent), row(1, child)]

    const lines = computeConnectionLines(rowData, startDate, dayWidth)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual({
      childTaskId: 'child',
      parentEndX: 9 * dayWidth, // 2024-01-10 は startDateから9日目
      childStartX: 10 * dayWidth, // 2024-01-11 は10日目
      parentY: 0 * GANTT_CONFIG.ROW_HEIGHT + GANTT_CONFIG.ROW_HEIGHT / 2,
      childY: 1 * GANTT_CONFIG.ROW_HEIGHT + GANTT_CONFIG.ROW_HEIGHT / 2,
    })
  })

  it('親が子より下の行にある場合でも(グループ化などで並び替わっていても)線を返す', () => {
    const parent = makeTask({ id: 'parent', due_date: '2024-01-10' })
    const child = makeTask({ id: 'child', parent_task_id: 'parent', start_date: '2024-01-11' })
    // 子が親より先(rowIndexが小さい)行に描画されるケース
    const rowData: GanttRowDatum[] = [row(0, child), row(1, parent)]

    const lines = computeConnectionLines(rowData, startDate, dayWidth)

    expect(lines).toHaveLength(1)
    expect(lines[0].parentY).toBe(1 * GANTT_CONFIG.ROW_HEIGHT + GANTT_CONFIG.ROW_HEIGHT / 2)
    expect(lines[0].childY).toBe(0 * GANTT_CONFIG.ROW_HEIGHT + GANTT_CONFIG.ROW_HEIGHT / 2)
  })

  it('親タスクの行が見つからない場合は線を作らない', () => {
    const child = makeTask({ id: 'child', parent_task_id: 'missing-parent', start_date: '2024-01-11' })
    const rowData: GanttRowDatum[] = [row(0, child)]

    const lines = computeConnectionLines(rowData, startDate, dayWidth)

    expect(lines).toHaveLength(0)
  })

  it('parent_task_idが無いタスクは線を作らない', () => {
    const task = makeTask({ id: 'solo', parent_task_id: null })
    const rowData: GanttRowDatum[] = [row(0, task)]

    const lines = computeConnectionLines(rowData, startDate, dayWidth)

    expect(lines).toHaveLength(0)
  })

  it('親のdue_dateまたは子のstart_date/created_atが無い場合は線を作らない', () => {
    const parent = makeTask({ id: 'parent', due_date: null })
    const child = makeTask({ id: 'child', parent_task_id: 'parent', start_date: '2024-01-11' })
    const rowData: GanttRowDatum[] = [row(0, parent), row(1, child)]

    const lines = computeConnectionLines(rowData, startDate, dayWidth)

    expect(lines).toHaveLength(0)
  })

  it('ヘッダー行(グルーピング見出し)は無視する', () => {
    const parent = makeTask({ id: 'parent', due_date: '2024-01-10' })
    const child = makeTask({ id: 'child', parent_task_id: 'parent', start_date: '2024-01-11' })
    const rowData: GanttRowDatum[] = [row(0), row(1, parent), row(2, child)]

    const lines = computeConnectionLines(rowData, startDate, dayWidth)

    expect(lines).toHaveLength(1)
    expect(lines[0].childTaskId).toBe('child')
  })
})
