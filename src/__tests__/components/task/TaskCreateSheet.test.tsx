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

describe('TaskCreateSheet — ball=client ⟹ client_scope=deliverable 不変条件 (S4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('外部（ball=client）を選択すると client_scope が自動的に deliverable になり、トグルが disabled になる', () => {
    renderSheet()

    fireEvent.click(screen.getByTestId('task-create-ball-client'))
    fireEvent.click(screen.getByText('詳細オプション'))

    const toggle = screen.getByTestId('task-create-client-scope-toggle')
    expect(toggle).toBeDisabled()
    expect(toggle).toHaveClass('bg-amber-500')
  })

  it('社内（ball=internal）に戻すとトグルの操作が再び可能になる', () => {
    renderSheet()

    fireEvent.click(screen.getByTestId('task-create-ball-client'))
    fireEvent.click(screen.getByTestId('task-create-ball-internal'))
    fireEvent.click(screen.getByText('詳細オプション'))

    const toggle = screen.getByTestId('task-create-client-scope-toggle')
    expect(toggle).not.toBeDisabled()
  })

  it('コンパクト表示（詳細オプション未展開）でも ball=client 選択時にクライアント公開の注記が見える', () => {
    renderSheet()

    fireEvent.click(screen.getByTestId('task-create-ball-client'))

    expect(screen.getByTestId('task-create-scope-auto-note')).toBeInTheDocument()
  })

  it('ball=client で作成すると onSubmit に clientScope=deliverable が渡る', async () => {
    const onSubmit = vi.fn()
    renderSheet(onSubmit)

    fireEvent.click(screen.getByTestId('task-create-ball-client'))
    fireEvent.change(screen.getByTestId('task-create-title'), { target: { value: '新規タスク' } })
    fireEvent.click(screen.getByTestId('task-create-client-owner-c1'))
    fireEvent.click(screen.getByTestId('task-create-submit'))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ ball: 'client', clientScope: 'deliverable' })
    )
  })
})

describe('TaskCreateSheet — モバイル: 高さ制約とスクロール構造 (PR4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('シートは高さ制約付きのflex-colコンテナで、本文がスクロール・フッタが固定される', () => {
    renderSheet()
    const sheet = screen.getByTestId('task-create-sheet')
    // 縦積み＋高さ制約（長いフォームでもビューポートに収まりスクロール）
    expect(sheet.className).toMatch(/\bflex\b/)
    expect(sheet.className).toMatch(/\bflex-col\b/)
    expect(sheet.className).toMatch(/max-h-\[/)

    // スクロール可能な本文が存在する
    expect(sheet.querySelector('.overflow-y-auto')).not.toBeNull()

    // 送信ボタンは固定フッタ（border-t区切り）内にあり、常に到達可能
    const submit = screen.getByTestId('task-create-submit')
    const footer = submit.parentElement!
    expect(footer.className).toMatch(/border-t/)
    expect(footer.className).toMatch(/flex-shrink-0/)
  })
})
