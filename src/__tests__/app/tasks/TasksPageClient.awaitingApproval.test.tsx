import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TasksPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient'
import type { Task } from '@/types/database'

/**
 * 自分が社内承認を頼まれているタスクは、「すべてのタスク」で「あなたの承認待ち」と分かるようにする
 * （2026-09-11 ユーザー要望）。承認を頼まれた人は担当者でないことが多く、マイタスクには出ない。
 */

const mocks = vi.hoisted(() => ({
  tasks: [] as unknown[],
  reviewStatuses: {} as Record<string, string>,
  pendingTaskIds: new Set<string>(),
  pendingOrgIds: [] as Array<string | null>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTasks', () => ({
  useTasks: () => ({
    tasks: mocks.tasks,
    owners: {},
    reviewStatuses: mocks.reviewStatuses,
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

vi.mock('@/lib/hooks/useMyPendingReviews', () => ({
  useMyPendingReviews: (orgId: string | null) => {
    mocks.pendingOrgIds.push(orgId)
    return { taskIds: mocks.pendingTaskIds }
  },
}))

vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: [] }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ members: [], getMemberName: () => null, loading: false, error: null }),
}))

vi.mock('@/lib/hooks/useSpacePendingInvites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useSpacePendingInvites')>()
  return { ...actual, useSpacePendingInvites: () => ({ pendingInvites: [], loading: false }) }
})

vi.mock('@/lib/hooks/useRiskForecast', () => ({
  useRiskForecast: () => ({ forecasts: new Map() }),
}))

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
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
    org_id: 'org-1',
    space_id: 'space-1',
    milestone_id: null,
    parent_task_id: null,
    title: 'サンプルタスク',
    description: null,
    status: 'in_review',
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
  mocks.tasks = []
  mocks.reviewStatuses = {}
  mocks.pendingTaskIds = new Set()
  mocks.pendingOrgIds = []
})

describe('TasksPageClient — あなたの承認待ち', () => {
  it('自分が承認を頼まれているタスクだけ「あなたの承認待ち」になり、ほかは「社内承認待ち」のまま', () => {
    mocks.tasks = [
      makeTask({ id: 't1', title: '頼まれたタスク' }),
      makeTask({ id: 't2', title: 'ほかの人が頼まれたタスク' }),
    ]
    mocks.reviewStatuses = { t1: 'open', t2: 'open' }
    mocks.pendingTaskIds = new Set(['t1'])

    renderPage()

    expect(screen.getAllByText('あなたの承認待ち')).toHaveLength(1)
    expect(screen.getAllByText('社内承認待ち')).toHaveLength(1)
  })

  it('このプロジェクトの組織で、自分の承認待ちを読む', () => {
    renderPage()
    expect(mocks.pendingOrgIds).toContain('org-1')
  })
})
