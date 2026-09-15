import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TaskRow } from '@/components/task/TaskRow'
import type { Task } from '@/types/database'

/**
 * マイタスクの行に、未読のコメントの数（「未読 N」）と、プロジェクトをまたぐ一覧でのプロジェクト名を出す。
 * どちらも渡さない呼び出し元（プロジェクトのタスク一覧など）の見た目は変えない。
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

describe('TaskRow — 未読コメント', () => {
  it('デスクトップ: 未読があれば「未読 N」を出し、吹き出しの説明に書いた人を添える', () => {
    render(<TaskRow task={makeTask()} commentCount={5} unreadCommentCount={2} unreadCommentFrom={['田中', '佐藤']} />)

    expect(screen.getByTestId('task-row-unread-comments')).toHaveTextContent('未読 2')
    const badge = screen.getByTestId('task-row-comment-count')
    expect(badge).toHaveTextContent('5')
    expect(badge).toHaveAttribute('title', 'コメント 5件（未読 2件: 田中、佐藤）')
    expect(badge).toHaveAttribute('aria-label', 'コメント 5件（未読 2件: 田中、佐藤）')
  })

  it('書いた人の名前が分からなければ、件数だけを添える', () => {
    render(<TaskRow task={makeTask()} commentCount={5} unreadCommentCount={2} />)

    expect(screen.getByTestId('task-row-comment-count')).toHaveAttribute('title', 'コメント 5件（未読 2件）')
  })

  it('未読が0なら「未読」は出さず、説明も今までどおり', () => {
    render(<TaskRow task={makeTask()} commentCount={3} unreadCommentCount={0} />)

    expect(screen.queryByTestId('task-row-unread-comments')).not.toBeInTheDocument()
    expect(screen.getByTestId('task-row-comment-count')).toHaveAttribute('title', 'コメント 3件')
  })

  it('コメント数がまだ読めていなくても、未読があれば未読の数で出す', () => {
    render(<TaskRow task={makeTask()} unreadCommentCount={1} />)

    expect(screen.getByTestId('task-row-comment-count')).toHaveTextContent('1')
    expect(screen.getByTestId('task-row-unread-comments')).toHaveTextContent('未読 1')
  })

  it('モバイルでも「未読 N」を出す', () => {
    render(<TaskRow task={makeTask()} commentCount={4} unreadCommentCount={3} isMobile />)

    expect(screen.getByTestId('task-row-unread-comments')).toHaveTextContent('未読 3')
  })
})

describe('TaskRow — プロジェクト名', () => {
  it('デスクトップ: 渡すと行に出す。渡さなければ出さない', () => {
    const { rerender } = render(<TaskRow task={makeTask()} projectName="A案件" />)
    expect(screen.getByTestId('task-row-project-name')).toHaveTextContent('A案件')

    rerender(<TaskRow task={makeTask()} />)
    expect(screen.queryByTestId('task-row-project-name')).not.toBeInTheDocument()
  })

  it('モバイルでも出す', () => {
    render(<TaskRow task={makeTask()} projectName="A案件" isMobile />)

    expect(screen.getByTestId('task-row-project-name')).toHaveTextContent('A案件')
  })
})
