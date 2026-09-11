import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskRow } from '@/components/task/TaskRow'
import type { Task } from '@/types/database'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    org_id: 'o1',
    space_id: 's1',
    milestone_id: null,
    parent_task_id: null,
    title: 'サンプルタスク',
    description: null,
    status: 'todo',
    priority: null,
    assignee_id: null,
    start_date: null,
    due_date: null,
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
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  } as Task
}

/**
 * 一覧で「誰のタスクか」が分からなかった。以前は頭文字1文字の丸だけで、
 * 同じ頭文字の人がいると見分けられなかった。名前そのものを出す。
 */
describe('TaskRow — 担当者の名前を出す', () => {
  it('デスクトップ行に、頭文字だけでなく担当者の名前を出す', () => {
    render(<TaskRow task={makeTask()} assigneeName="高橋 雄太" />)
    const el = screen.getByTestId('task-row-assignee')
    expect(el).toHaveTextContent('高橋 雄太')
    // 長い名前は途中で切れるので、カーソルを合わせると全部読める
    expect(el).toHaveAttribute('title', '担当: 高橋 雄太')
  })

  it('モバイル行にも名前を出す', () => {
    render(<TaskRow task={makeTask()} assigneeName="高橋 雄太" isMobile />)
    expect(screen.getByTestId('task-row-assignee')).toHaveTextContent('高橋 雄太')
  })

  it('担当者がいなければ何も出さない', () => {
    render(<TaskRow task={makeTask()} assigneeName={null} />)
    expect(screen.queryByTestId('task-row-assignee')).not.toBeInTheDocument()
  })
})
