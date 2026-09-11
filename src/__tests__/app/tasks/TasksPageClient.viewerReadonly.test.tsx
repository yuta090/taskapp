import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TasksPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient'
import type { Task } from '@/types/database'

// 閲覧者（viewer）・相手先には、押しても失敗するだけの編集操作を出さない。
// canEditSpaceContent が false を返す状況（useCanEditSpace の canEdit:false）を
// 直接差し替えて確かめる（判定そのものの単体テストは spaceRoles.test.ts / useCanEditSpace.test.ts）。

const mockSetInspector = vi.fn()

// next/navigation の useSearchParams は静的なモックで、クリックでは再評価されない
// （clientWaitFilter テストと同じ理由）。選択中タスクの検証は、最初から
// `?task=t1` を付けた状態で描画して確かめる。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('task=t1'),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: mockSetInspector }),
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    org_id: 'org-1',
    space_id: 'space-1',
    milestone_id: null,
    parent_task_id: null,
    title: '閲覧者にも見えるタスク',
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
    due_authority_connection_id: null,
    short_id: null,
    created_at: '2026-07-01T00:00:00',
    updated_at: '2026-07-01T00:00:00',
    ...overrides,
  }
}

const mockTasks: Task[] = [makeTask()]

vi.mock('@/lib/hooks/useTasks', () => ({
  useTasks: () => ({
    tasks: mockTasks,
    owners: {},
    reviewStatuses: {},
    loading: false,
    error: null,
    fetchTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    passBall: vi.fn(),
    handleReviewChange: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: [] }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ getMemberName: () => null, members: [], loading: false, error: null }),
}))

vi.mock('@/lib/hooks/useRiskForecast', () => ({
  useRiskForecast: () => ({ forecasts: new Map() }),
}))

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({
    announcements: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

vi.mock('@/components/task/TaskCreateSheet', () => ({
  TaskCreateSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="task-create-sheet">新規タスク作成</div> : null,
}))

// jsdom はレイアウトを持たず、実物の virtualizer は「高さ0のコンテナに何も見えない」と
// 判断して行を描かない。テストでは全件を単純に並べたことにする。
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 40,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 40, size: 40 })),
    measure: () => {},
  }),
}))

// このファイル専用: 編集できない（閲覧者）として振る舞う
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: false, loading: false }),
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TasksPageClient orgId="org-1" spaceId="space-1" />
    </QueryClientProvider>
  )
}

describe('TasksPageClient — 閲覧者（viewer）には編集操作を出さない', () => {
  it('ヘッダーの「タスクを追加」ボタンが出ない', () => {
    renderPage()
    expect(screen.queryByTestId('task-create-button')).not.toBeInTheDocument()
  })

  it('「n」キーを押しても作成シートが開かない', () => {
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
    renderPage()
    fireEvent.keyDown(document, { key: 'n' })
    expect(replaceStateSpy).not.toHaveBeenCalledWith(null, '', expect.stringContaining('create=1'))
  })

  it('「選択」（まとめて操作）ボタンが出ない', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: /まとめて操作/ })).not.toBeInTheDocument()
  })

  it('一覧の行に完了チェック（状態変更）が出ない', () => {
    renderPage()
    expect(screen.queryByLabelText('完了にする')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('未完了に戻す')).not.toBeInTheDocument()
  })

  it('一覧末尾の「タスクを追加」インライン行が出ない', () => {
    renderPage()
    expect(screen.queryByText('タスクを追加')).not.toBeInTheDocument()
  })

  it('選択中タスク(?task=t1)では、TaskInspector には編集用のコールバック(onUpdate等)を渡さない', () => {
    renderPage()

    const lastCallArg = mockSetInspector.mock.calls.at(-1)?.[0]
    expect(lastCallArg).toBeTruthy()
    expect(lastCallArg.props.onUpdate).toBeUndefined()
    expect(lastCallArg.props.onPassBall).toBeUndefined()
    expect(lastCallArg.props.onDelete).toBeUndefined()
    expect(lastCallArg.props.onDuplicate).toBeUndefined()
    expect(lastCallArg.props.onUpdateOwners).toBeUndefined()
    expect(lastCallArg.props.onConsideringDecided).toBeUndefined()
  })
})
