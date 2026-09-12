import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MyTasksClient from '@/app/(internal)/my/MyTasksClient'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

// 一覧の完了チェックと詳細(TaskInspector)の編集可否がずれないようにする回帰テスト。
// 「space_memberships に行が無い社内メンバー」は、詳細側(useCanEditSpace)では
// task.org_id を渡すことで編集できる扱いになる。一覧側(useCanEditSpaces.canEditSpace)も
// 同じ task.org_id を渡さないと、一覧だけ編集できない扱いのままになってしまう。

const mocks = vi.hoisted(() => ({
  taskRows: [] as unknown[],
  spaceRows: [] as unknown[],
  milestoneRows: [] as unknown[],
  spaceTasks: [] as unknown[],
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
    tasks: mocks.spaceTasks,
    owners: {},
    reviewStatuses: {},
    loading: false,
    dataUpdatedAt: Date.now() + 60_000,
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
  useMyPendingReviews: () => ({ taskIds: new Set() }),
}))

// 「行が無い社内メンバー」を再現する canEditSpace: orgId が渡された（かつ既知の組織の）
// ときだけ true を返す。spaceId だけでは判定できない、という単体RPCの穴を再現する。
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, canEditMoney: false, resolved: true, loading: false }),
  useCanEditSpaces: () => ({
    canEditSpace: (spaceId: string | null | undefined, orgId?: string | null) =>
      !!spaceId && orgId === 'org-1',
    loading: false,
  }),
}))

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    org_id: 'org-1',
    space_id: 'space-1',
    title: '行が無い社内メンバーのタスク',
    description: '',
    status: 'todo',
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

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: () => Promise.resolve({ data: { user: null }, error: null }) },
    from: (table: string) => {
      const result =
        table === 'tasks'
          ? { data: mocks.taskRows, error: null }
          : table === 'spaces'
            ? { data: mocks.spaceRows, error: null }
            : table === 'milestones'
              ? { data: mocks.milestoneRows, error: null }
              : { data: [], error: null }
      const chainable: Record<string, unknown> = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
            return () => chainable
          },
        }
      )
      return chainable
    },
  }),
}))

function buildTree(queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <ActiveOrgContext.Provider
        value={{
          activeOrgId: 'org-1',
          activeOrgName: 'テスト組織',
          activeOrgRole: 'member',
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

function renderPage() {
  return render(buildTree(new QueryClient()))
}

beforeEach(() => {
  mocks.taskRows = [makeTask()]
  mocks.spaceRows = [{ id: 'space-1', org_id: 'org-1', name: 'プロジェクトA' }]
  mocks.milestoneRows = []
  mocks.spaceTasks = [makeTask()]
})

describe('MyTasksClient — 一覧は task.org_id を補って詳細と同じ判定を使う', () => {
  it('space_memberships に行が無い（orgIdで補って初めて編集可）タスクでも、一覧に完了チェックが出る', async () => {
    renderPage()
    await screen.findByText('行が無い社内メンバーのタスク')
    expect(screen.getByLabelText('完了にする')).toBeInTheDocument()
  })
})
