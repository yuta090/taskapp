import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import {
  TaskFilterMenu,
  ActiveFilterChips,
  applyTaskFilters,
  defaultFilters,
} from '@/components/task/TaskFilterMenu'
import type { AssigneeOption } from '@/lib/tasks/taskAssignees'

describe('TaskFilterMenu — ステータスラベルの用語統一 (M-3)', () => {
  it('ステータスの選択肢に「着手予定」「社内承認中」を使う', () => {
    render(
      <TaskFilterMenu
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        milestones={[]}
        assignees={[]}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '詳細フィルター' }))
    fireEvent.click(screen.getByText('ステータス'))

    expect(screen.getByText('着手予定')).toBeInTheDocument()
    expect(screen.getByText('社内承認中')).toBeInTheDocument()
    expect(screen.queryByText('Todo')).not.toBeInTheDocument()
    expect(screen.queryByText('承認確認中')).not.toBeInTheDocument()
  })
})

describe('TaskFilterMenu — 入口はアイコンだけにする', () => {
  function renderMenu() {
    return render(
      <TaskFilterMenu
        filters={defaultFilters}
        onFiltersChange={vi.fn()}
        milestones={[]}
        assignees={[]}
      />
    )
  }

  it('ボタンに「フィルター」の文字を出さない（アイコンだけ）', () => {
    renderMenu()
    expect(screen.queryByText('フィルター')).not.toBeInTheDocument()
  })

  it('カーソルを合わせると「詳細フィルター」と出る', () => {
    renderMenu()
    expect(screen.getByRole('button', { name: '詳細フィルター' })).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent('詳細フィルター')
  })

  it('ツールチップはヘッダーで見切れないよう下に出す', () => {
    renderMenu()
    expect(screen.getByRole('tooltip').className).toContain('top-full')
  })
})

/**
 * 担当者の絞り込みで「未割り当て」しか選べなかった問題の対策。
 * 選択肢は呼び出し側が作った担当者の名簿（メンバー全員＋招待中の担当者）をそのまま並べる。
 */
describe('TaskFilterMenu — 担当者で絞り込む', () => {
  const assignees: AssigneeOption[] = [
    { id: 'u1', label: '高橋', side: 'internal' },
    { id: 'c1', label: '顧客 花子', side: 'client' },
    { id: 'inv1', label: '山田（招待中）', side: 'internal' },
  ]

  function openAssigneeMenu(onFiltersChange = vi.fn()) {
    render(
      <TaskFilterMenu
        filters={defaultFilters}
        onFiltersChange={onFiltersChange}
        milestones={[]}
        assignees={assignees}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '詳細フィルター' }))
    fireEvent.click(screen.getByText('担当者'))
    return screen.getByTestId('task-filter-assignee-options')
  }

  it('渡した担当者が全員並び、「未割り当て」も残る', () => {
    const list = openAssigneeMenu()
    expect(within(list).getByText('未割り当て')).toBeInTheDocument()
    expect(within(list).getByText('高橋')).toBeInTheDocument()
    expect(within(list).getByText('顧客 花子')).toBeInTheDocument()
    expect(within(list).getByText('山田（招待中）')).toBeInTheDocument()
    // 外部の人には印を付ける
    expect(within(list).getByText('外部')).toBeInTheDocument()
  })

  it('人を選ぶと、その人の id で絞り込む', () => {
    const onFiltersChange = vi.fn()
    const list = openAssigneeMenu(onFiltersChange)
    fireEvent.click(within(list).getByText('高橋'))
    expect(onFiltersChange).toHaveBeenCalledWith({ ...defaultFilters, assigneeId: ['u1'] })
  })

  it('絞り込み中の表示には名前で出る', () => {
    render(
      <ActiveFilterChips
        filters={{ ...defaultFilters, assigneeId: ['inv1', null] }}
        onFiltersChange={vi.fn()}
        milestones={[]}
        assignees={assignees}
      />
    )
    expect(screen.getByText('担当者: 山田（招待中）, 未割り当て')).toBeInTheDocument()
  })
})

describe('applyTaskFilters — 担当者', () => {
  const base = {
    status: 'todo',
    ball: 'internal',
    type: 'task',
    milestone_id: null,
    priority: null,
    due_date: null,
    decision_state: null,
  } as const
  const tasks = [
    { ...base, id: 'mine', assignee_id: 'u1', assignee_invite_id: null },
    { ...base, id: 'invited', assignee_id: null, assignee_invite_id: 'inv1' },
    { ...base, id: 'nobody', assignee_id: null, assignee_invite_id: null },
  ]

  it('本人を選ぶと、本人が担当のタスクだけ残る', () => {
    expect(applyTaskFilters(tasks, { ...defaultFilters, assigneeId: ['u1'] }).map((t) => t.id)).toEqual(['mine'])
  })

  it('招待中の人を選ぶと、その人が担当のタスクが残る', () => {
    expect(applyTaskFilters(tasks, { ...defaultFilters, assigneeId: ['inv1'] }).map((t) => t.id)).toEqual(['invited'])
  })

  it('「未割り当て」には、招待中の人が担当のタスクを含めない', () => {
    expect(applyTaskFilters(tasks, { ...defaultFilters, assigneeId: [null] }).map((t) => t.id)).toEqual(['nobody'])
  })
})
