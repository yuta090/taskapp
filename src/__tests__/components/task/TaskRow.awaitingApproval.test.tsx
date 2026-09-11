import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskRow } from '@/components/task/TaskRow'
import type { Task } from '@/types/database'

/**
 * 自分が社内承認を頼まれているタスクは、一覧で見て分かるようにする（2026-09-11 ユーザー要望）。
 * 「社内承認待ち」だけでは、誰の承認を待っているのか分からない。自分の番なら「あなたの承認待ち」にする。
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
    status: 'in_review',
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

describe('TaskRow — あなたの承認待ち', () => {
  it('自分が承認を頼まれていれば「あなたの承認待ち」を出し、「社内承認待ち」は出さない', () => {
    render(<TaskRow task={makeTask()} reviewStatus="open" awaitingMyApproval />)
    expect(screen.getByText('あなたの承認待ち')).toBeInTheDocument()
    expect(screen.queryByText('社内承認待ち')).not.toBeInTheDocument()
  })

  it('スマホの2行表示でも「あなたの承認待ち」を出す', () => {
    render(<TaskRow task={makeTask()} reviewStatus="open" awaitingMyApproval isMobile />)
    expect(screen.getByText('あなたの承認待ち')).toBeInTheDocument()
    expect(screen.queryByText('社内承認待ち')).not.toBeInTheDocument()
  })

  it('頼まれていなければ、これまでどおり「社内承認待ち」', () => {
    render(<TaskRow task={makeTask()} reviewStatus="open" />)
    expect(screen.getByText('社内承認待ち')).toBeInTheDocument()
    expect(screen.queryByText('あなたの承認待ち')).not.toBeInTheDocument()
  })

  it('一覧側の承認の状態がまだ届いていなくても、頼まれていれば「社内承認を依頼」ボタンは出さない', () => {
    render(<TaskRow task={makeTask()} awaitingMyApproval />)
    expect(screen.getByText('あなたの承認待ち')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '社内承認を依頼' })).not.toBeInTheDocument()
  })

  it('承認済み・差し戻しになった依頼には出さない（自分の番は終わっている）', () => {
    const { rerender } = render(<TaskRow task={makeTask()} reviewStatus="approved" awaitingMyApproval />)
    expect(screen.getByText('社内承認済み')).toBeInTheDocument()
    expect(screen.queryByText('あなたの承認待ち')).not.toBeInTheDocument()

    rerender(<TaskRow task={makeTask()} reviewStatus="changes_requested" awaitingMyApproval />)
    expect(screen.getByText('差し戻し')).toBeInTheDocument()
    expect(screen.queryByText('あなたの承認待ち')).not.toBeInTheDocument()
  })

  it('取り消された依頼には出さず、「社内承認を依頼」ボタンを出す（自分の承認待ちの一覧が古いままでも）', () => {
    render(<TaskRow task={makeTask()} reviewStatus="cancelled" awaitingMyApproval />)
    expect(screen.queryByText('あなたの承認待ち')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '社内承認を依頼' })).toBeInTheDocument()
  })
})
