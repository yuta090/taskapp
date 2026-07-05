import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskCreateSheet } from '@/components/task/TaskCreateSheet'

const mockMembers = [
  { id: 'c1', displayName: '鈴木（クライアント）', avatarUrl: null, role: 'client' },
  { id: 'c2', displayName: '高橋（クライアント）', avatarUrl: null, role: 'client' },
  { id: 'i1', displayName: '田中（社内）', avatarUrl: null, role: 'admin' },
]

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: mockMembers,
    clientMembers: mockMembers.filter((m) => m.role === 'client'),
    internalMembers: mockMembers.filter((m) => m.role !== 'client'),
    loading: false,
    error: null,
    getMemberName: (id: string) => mockMembers.find((m) => m.id === id)?.displayName ?? id,
  }),
}))

vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({ pages: [] }),
}))

function renderSheet(onSubmit = vi.fn()) {
  return render(
    <TaskCreateSheet
      spaceId="s1"
      orgId="o1"
      spaceName="テストプロジェクト"
      isOpen
      onClose={vi.fn()}
      onSubmit={onSubmit}
    />
  )
}

describe('TaskCreateSheet — 担当者/関係者・外部 の同期とバリデーション (M-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('担当者にクライアントメンバーを選ぶと関係者・外部が自動選択される', () => {
    renderSheet()

    fireEvent.click(screen.getByTestId('task-create-ball-client'))
    fireEvent.change(screen.getByTestId('task-create-assignee'), { target: { value: 'c1' } })

    expect(screen.getByTestId('task-create-client-owner-c1')).toHaveClass('bg-amber-100')
  })

  it('担当者を社内メンバーに変更しても既存の関係者・外部選択は解除しない', () => {
    renderSheet()

    fireEvent.click(screen.getByTestId('task-create-ball-client'))
    fireEvent.change(screen.getByTestId('task-create-assignee'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('task-create-assignee'), { target: { value: 'i1' } })

    expect(screen.getByTestId('task-create-client-owner-c1')).toHaveClass('bg-amber-100')
  })

  it('関係者・外部が未選択のまま作成すると赤字のインラインエラーを表示しフィールドへフォーカスする', () => {
    renderSheet()

    fireEvent.click(screen.getByTestId('task-create-ball-client'))
    fireEvent.change(screen.getByTestId('task-create-title'), { target: { value: '新規タスク' } })
    fireEvent.click(screen.getByTestId('task-create-submit'))

    expect(screen.getByTestId('task-create-client-owner-error')).toHaveTextContent(
      'クライアント側の担当者を選択してください'
    )
    expect(document.activeElement).toBe(screen.getByTestId('task-create-client-owner-field'))
  })

  it('関係者・外部を選択するとインラインエラーが消える', () => {
    renderSheet()

    fireEvent.click(screen.getByTestId('task-create-ball-client'))
    fireEvent.change(screen.getByTestId('task-create-title'), { target: { value: '新規タスク' } })
    fireEvent.click(screen.getByTestId('task-create-submit'))
    expect(screen.getByTestId('task-create-client-owner-error')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('task-create-client-owner-c1'))

    expect(screen.queryByTestId('task-create-client-owner-error')).not.toBeInTheDocument()
  })

  it('関係者・外部を選択していれば作成でき、onSubmit にクライアント担当者が渡る', async () => {
    const onSubmit = vi.fn()
    renderSheet(onSubmit)

    fireEvent.click(screen.getByTestId('task-create-ball-client'))
    fireEvent.change(screen.getByTestId('task-create-title'), { target: { value: '新規タスク' } })
    fireEvent.change(screen.getByTestId('task-create-assignee'), { target: { value: 'c1' } })
    fireEvent.click(screen.getByTestId('task-create-submit'))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ ball: 'client', clientOwnerIds: ['c1'] })
    )
  })
})
