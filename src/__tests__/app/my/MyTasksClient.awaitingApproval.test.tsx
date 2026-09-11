import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MyTasksClient from '@/app/(internal)/my/MyTasksClient'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

/**
 * マイタスクでも、自分が社内承認を頼まれているタスクには「あなたの承認待ち」と出す。
 * 代役のデータは本番と同じ形（reviews は「オブジェクト or null」）にする。
 */

const mocks = vi.hoisted(() => ({
  taskRows: [] as unknown[],
  pendingTaskIds: new Set<string>(),
  pendingOrgIds: [] as Array<string | null>,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => '/my',
}))

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

vi.mock('@/components/task/TaskCreateSheet', () => ({
  TaskCreateSheet: () => null,
}))

vi.mock('@/components/task/TaskInspector', () => ({
  TaskInspector: () => null,
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ inspector: null, setInspector: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTasks', () => ({
  useTasks: () => ({
    tasks: [],
    owners: {},
    reviewStatuses: {},
    loading: false,
    dataUpdatedAt: 0,
    isFetching: false,
    error: null,
    fetchTasks: vi.fn(() => Promise.resolve()),
    createTask: vi.fn(),
    updateTask: vi.fn(() => Promise.resolve()),
    deleteTask: vi.fn(() => Promise.resolve()),
    passBall: vi.fn(() => Promise.resolve()),
    handleReviewChange: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useMyPendingReviews', () => ({
  useMyPendingReviews: (orgId: string | null) => {
    mocks.pendingOrgIds.push(orgId)
    return { taskIds: mocks.pendingTaskIds }
  },
}))

function makeChainable(result: { data: unknown; error: unknown }) {
  const chainable: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
        return () => chainable
      },
    }
  )
  return chainable
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    from: vi.fn((table: string) =>
      makeChainable(table === 'tasks' ? { data: mocks.taskRows, error: null } : { data: [], error: null })
    ),
    rpc: vi.fn(),
  }),
}))

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    org_id: 'org-1',
    space_id: 'space-1',
    title: 'マイタスクA',
    description: '',
    status: 'in_review',
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    client_scope: 'internal',
    priority: null,
    start_date: null,
    due_date: null,
    assignee_id: '0124bcca-7c66-406c-b1ae-2be8dac241c5',
    milestone_id: null,
    parent_task_id: null,
    spec_path: null,
    decision_state: null,
    created_by: 'u1',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  }
}

function buildTree(queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <ActiveOrgContext.Provider
        value={{
          activeOrgId: 'org-1',
          activeOrgName: 'テスト組織',
          activeOrgRole: 'admin',
          orgs: [],
          orgsStatus: 'verified',
          orgsRefreshFailed: false,
          switchOrg: vi.fn(),
          loading: false,
        }}
      >
        <MyTasksClient />
      </ActiveOrgContext.Provider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mocks.taskRows = []
  mocks.pendingTaskIds = new Set()
  mocks.pendingOrgIds = []
  window.history.replaceState(null, '', '/my')
})

describe('MyTasksClient — あなたの承認待ち', () => {
  it('自分が承認を頼まれているタスクは「あなたの承認待ち」、ほかは「社内承認待ち」', async () => {
    mocks.taskRows = [
      makeTask({ id: 't1', title: '頼まれたタスク', reviews: { status: 'open', created_at: '2026-09-05T00:00:00Z' } }),
      makeTask({ id: 't2', title: 'ほかの人が頼まれたタスク', reviews: { status: 'open', created_at: '2026-09-05T00:00:00Z' } }),
    ]
    mocks.pendingTaskIds = new Set(['t1'])

    render(buildTree(new QueryClient()))

    expect(await screen.findByText('あなたの承認待ち')).toBeInTheDocument()
    expect(screen.getAllByText('社内承認待ち')).toHaveLength(1)
    expect(mocks.pendingOrgIds).toContain('org-1')
  })
})
