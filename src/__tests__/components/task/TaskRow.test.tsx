import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  } as Task
}

describe('TaskRow — 用語統一 (M-1, M-3)', () => {
  it('ball=client のとき「クライアント確認待ち」バッジを表示する', () => {
    render(<TaskRow task={makeTask({ ball: 'client' })} />)
    expect(screen.getByText('クライアント確認待ち')).toBeInTheDocument()
    expect(screen.queryByText('外部確認待ち')).not.toBeInTheDocument()
  })

  it('ステータスドロップダウンの選択肢が「着手予定」「社内承認中」を使う', () => {
    render(<TaskRow task={makeTask()} onStatusChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /ステータスを変更/ }))
    expect(screen.getByText('着手予定')).toBeInTheDocument()
    expect(screen.getByText('社内承認中')).toBeInTheDocument()
    expect(screen.queryByText('ToDo')).not.toBeInTheDocument()
    expect(screen.queryByText('Todo')).not.toBeInTheDocument()
    expect(screen.queryByText('承認確認中')).not.toBeInTheDocument()
  })

  it('ステータスを変更（現在: 〜）の aria-label が新ラベルを使う', () => {
    render(<TaskRow task={makeTask({ status: 'in_review' })} onStatusChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'ステータスを変更（現在: 社内承認中）' })).toBeInTheDocument()
  })

  it('reviewStatus バッジが社内承認の用語を使う', () => {
    const { rerender } = render(<TaskRow task={makeTask()} reviewStatus="open" />)
    expect(screen.getByText('社内承認待ち')).toBeInTheDocument()

    rerender(<TaskRow task={makeTask()} reviewStatus="approved" />)
    expect(screen.getByText('社内承認済み')).toBeInTheDocument()
  })

  it('in_review タスクのクイックアクションが「社内承認を依頼」を使う', () => {
    render(<TaskRow task={makeTask({ status: 'in_review' })} onClick={vi.fn()} />)
    expect(screen.getByText('社内承認を依頼')).toBeInTheDocument()
  })
})

describe('TaskRow — hover アクション (M-6)', () => {
  it('一括選択チェックボックスは hover/focus 時のみ表示するクラスを持つ（非バルクモード）', () => {
    render(<TaskRow task={makeTask()} onCheckChange={vi.fn()} />)
    const checkbox = screen.getByRole('button', { name: '選択' })
    expect(checkbox.className).toContain('opacity-0')
    expect(checkbox.className).toContain('group-hover:opacity-100')
    expect(checkbox.className).toContain('focus-within:opacity-100')
  })

  it('クイック完了チェックボックスは hover/focus 時のみ表示するクラスを持つ', () => {
    render(<TaskRow task={makeTask()} onStatusChange={vi.fn()} />)
    const quickDone = screen.getByRole('button', { name: '完了にする' })
    expect(quickDone.className).toContain('opacity-0')
    expect(quickDone.className).toContain('group-hover:opacity-100')
    expect(quickDone.className).toContain('focus-within:opacity-100')
  })
})
