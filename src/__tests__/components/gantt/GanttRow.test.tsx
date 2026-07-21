import type { ComponentProps } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GanttRow } from '@/components/gantt/GanttRow'
import type { Task } from '@/types/database'

/**
 * AI秘書 Stage5 期限リマインド PR-0(§2.1/§5.2): due_authority_connection_id 非NULL(external権威)の
 * タスクは、Gantt上のバードラッグ/リサイズによる期限(due_date)変更も無効化する(他タスクは従来通り)。
 * 開始日(start_date)は権威の対象外のため、左リサイズハンドルは引き続き有効。
 */

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    org_id: 'org-1',
    space_id: 'space-1',
    title: 'Test Task',
    description: null,
    status: 'todo',
    priority: null,
    assignee_id: null,
    start_date: '2024-01-01',
    due_date: '2024-01-10',
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
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
    ...overrides,
  }
}

function renderRow(task: Task, extra: Partial<ComponentProps<typeof GanttRow>> = {}) {
  return render(
    <svg>
      <GanttRow
        task={task}
        startDate={new Date('2023-12-25')}
        endDate={new Date('2024-01-20')}
        dayWidth={40}
        rowIndex={0}
        onDateChange={vi.fn()}
        onBarMove={vi.fn()}
        {...extra}
      />
    </svg>
  )
}

describe('GanttRow — 期限の正本境界(due_authority_connection_id)によるドラッグ/リサイズ無効化', () => {
  it('TaskApp正本(due_authority_connection_id=null)のタスクは開始/終了リサイズ・移動ハンドルをすべて出す(従来通り)', () => {
    renderRow(makeTask({ due_authority_connection_id: null }))
    expect(screen.getByTestId('gantt-bar-resize-start')).toBeInTheDocument()
    expect(screen.getByTestId('gantt-bar-resize-end')).toBeInTheDocument()
    expect(screen.getByTestId('gantt-bar-move')).toBeInTheDocument()
  })

  it('external権威タスク(due_authority_connection_id 非NULL)は終了(期限)リサイズ・移動ハンドルを出さない', () => {
    renderRow(makeTask({ due_authority_connection_id: 'conn-gtasks-1' }))
    expect(screen.queryByTestId('gantt-bar-resize-end')).not.toBeInTheDocument()
    expect(screen.queryByTestId('gantt-bar-move')).not.toBeInTheDocument()
  })

  it('external権威タスクでも開始日リサイズハンドルは引き続き出す(期限だけが対象)', () => {
    renderRow(makeTask({ due_authority_connection_id: 'conn-gtasks-1' }))
    expect(screen.getByTestId('gantt-bar-resize-start')).toBeInTheDocument()
  })
})
