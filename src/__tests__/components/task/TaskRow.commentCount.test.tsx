import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskRow } from '@/components/task/TaskRow'
import type { Task } from '@/types/database'

/**
 * タスク一覧の各行に、コメント数を吹き出しアイコンで出す。0件・未指定では何も出さない
 * （既存のBillingPageClient等、commentCountを渡さない呼び出し元に影響しないため）。
 */

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
    due_date: '2026-03-01',
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

describe('TaskRow — コメント数の吹き出しアイコン', () => {
  it('デスクトップ: 1件以上なら吹き出しアイコンと数字を出す', () => {
    render(<TaskRow task={makeTask()} commentCount={3} />)
    const el = screen.getByTestId('task-row-comment-count')
    expect(el).toHaveTextContent('3')
    expect(el).toHaveAttribute('title', 'コメント 3件')
    expect(el).toHaveAttribute('aria-label', 'コメント 3件')
  })

  it('デスクトップ: 0件では出さない', () => {
    render(<TaskRow task={makeTask()} commentCount={0} />)
    expect(screen.queryByTestId('task-row-comment-count')).not.toBeInTheDocument()
  })

  it('デスクトップ: 未指定では出さない', () => {
    render(<TaskRow task={makeTask()} />)
    expect(screen.queryByTestId('task-row-comment-count')).not.toBeInTheDocument()
  })

  it('モバイル: 1件以上なら2行目に出す', () => {
    render(<TaskRow task={makeTask()} commentCount={5} isMobile />)
    const el = screen.getByTestId('task-row-comment-count')
    expect(el).toHaveTextContent('5')
  })

  it('モバイル: 0件では出さない', () => {
    render(<TaskRow task={makeTask()} commentCount={0} isMobile />)
    expect(screen.queryByTestId('task-row-comment-count')).not.toBeInTheDocument()
  })
})
