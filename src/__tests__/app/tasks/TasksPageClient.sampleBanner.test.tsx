import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TasksPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient'
import type { Task } from '@/types/database'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: vi.fn() }),
}))

const mockDeleteTask = vi.fn().mockResolvedValue(undefined)
let mockTasks: Task[] = []

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
    deleteTask: mockDeleteTask,
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

vi.mock('@/components/task/TaskCreateSheet', () => ({
  TaskCreateSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="task-create-sheet">新規タスク作成</div> : null,
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    org_id: 'o1',
    space_id: 'space-1',
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

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TasksPageClient orgId="org-1" spaceId="space-1" />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mockDeleteTask.mockClear()
  mockTasks = []
})

describe('TasksPageClient — サンプルタスク一括削除バナー', () => {
  it('サンプルタスクが無ければバナーを表示しない', () => {
    mockTasks = [makeTask({ id: 't1', is_sample: false })]
    renderPage()
    expect(screen.queryByText(/サンプルタスクが含まれています/)).not.toBeInTheDocument()
  })

  it('サンプルタスクが1件以上あればバナーを表示する', () => {
    mockTasks = [
      makeTask({ id: 't1', is_sample: true }),
      makeTask({ id: 't2', is_sample: false }),
    ]
    renderPage()
    expect(screen.getByText(/サンプルタスクが含まれています/)).toBeInTheDocument()
  })

  it('一括削除クリックでモーダルではなくインラインの確認に切り替わる', () => {
    mockTasks = [makeTask({ id: 't1', is_sample: true })]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '一括削除' }))

    // インライン確認: モーダル用のoverlay(fixed inset-0)が出現しないこと
    expect(document.querySelector('.fixed.inset-0')).not.toBeInTheDocument()
    expect(screen.getByText(/削除しますか/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '削除する' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeInTheDocument()
  })

  it('キャンセルで通常表示に戻る', () => {
    mockTasks = [makeTask({ id: 't1', is_sample: true })]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '一括削除' }))
    fireEvent.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByText(/削除しますか/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '一括削除' })).toBeInTheDocument()
  })

  it('削除するを押すとサンプルタスクのみdeleteTaskが呼ばれる', async () => {
    mockTasks = [
      makeTask({ id: 't1', is_sample: true }),
      makeTask({ id: 't2', is_sample: true }),
      makeTask({ id: 't3', is_sample: false }),
    ]
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: '一括削除' }))
    fireEvent.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => {
      expect(mockDeleteTask).toHaveBeenCalledTimes(2)
    })
    expect(mockDeleteTask).toHaveBeenCalledWith('t1')
    expect(mockDeleteTask).toHaveBeenCalledWith('t2')
    expect(mockDeleteTask).not.toHaveBeenCalledWith('t3')
  })
})
