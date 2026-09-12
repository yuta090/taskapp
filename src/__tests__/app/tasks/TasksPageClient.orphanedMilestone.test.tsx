import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TasksPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient'
import type { Task, Milestone } from '@/types/database'

/**
 * 回帰: マイルストーンを削除すると、共有キャッシュ（['milestones', spaceId]）からは
 * すぐ消えるが、タスク側のキャッシュ（['tasks', orgId, spaceId]）は取り直すまで古い
 * milestone_id を持ったまま。一覧に無いマイルストーンを指すタスクは「マイルストーン
 * 未設定」に入れて、取り直しが終わるまでの一瞬タスクが消えて見えないようにする。
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: vi.fn() }),
}))

let mockTasks: Task[] = []
let mockMilestones: Milestone[] = []

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
  useMilestones: () => ({ milestones: mockMilestones }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ getMemberName: () => null, members: [], loading: false, error: null }),
}))

vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, loading: false }),
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
  TaskCreateSheet: () => null,
}))

// jsdom はスクロール領域の大きさが 0 なので、本物の仮想化だと1行も描かれない。全行描く代役にする。
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 40,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 40, size: 40 })),
    measure: () => {},
  }),
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
    assignee_invite_id: null,
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
  mockMilestones = []
  mockTasks = [
    makeTask({
      id: 't1',
      title: '削除済みマイルストーンを指すタスク',
      milestone_id: 'milestone-deleted',
    }),
  ]
})

describe('TasksPageClient — 一覧に無いマイルストーンを指すタスク', () => {
  it('消えずに「マイルストーン未設定」の下に出る', () => {
    renderPage()
    expect(screen.getByText('マイルストーン未設定')).toBeInTheDocument()
    expect(screen.getByText('削除済みマイルストーンを指すタスク')).toBeInTheDocument()
  })
})
