import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MyTasksClient from '@/app/(internal)/my/MyTasksClient'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

/**
 * マイタスクの各行にもコメント数(吹き出しアイコン)を出す。一覧本体(myTasksQuery)とは
 * 別読みの useMyTaskCommentCounts（rpc_task_comment_counts、['taskCommentCounts', …]）を
 * 使う — 一覧の表示をコメント数の集計完了まで待たせない。
 */

const mocks = vi.hoisted(() => ({
  taskRows: [] as unknown[],
  myTaskCommentCountsCalls: [] as Array<{ userId: string | null; orgId: string | null }>,
  commentCounts: {} as Record<string, number>,
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
  useMyPendingReviews: () => ({ taskIds: new Set() }),
}))

// コメント数は一覧本体(myTasksQuery)とは別読みのフックなので、ここだけをモックすれば足りる
// — fetchMyTasksData 側の supabase.from('tasks') 等には影響しない
vi.mock('@/lib/hooks/useTaskCommentCounts', () => ({
  useMyTaskCommentCounts: (userId: string | null, orgId: string | null) => {
    mocks.myTaskCommentCountsCalls.push({ userId, orgId })
    return mocks.commentCounts
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
  }),
}))

const DEV_USER_ID = '0124bcca-7c66-406c-b1ae-2be8dac241c5'

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    org_id: 'org-1',
    space_id: 'space-1',
    title: 'マイタスクA',
    description: '',
    status: 'todo',
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    client_scope: 'internal',
    priority: null,
    start_date: null,
    due_date: null,
    assignee_id: DEV_USER_ID,
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
  mocks.myTaskCommentCountsCalls = []
  mocks.commentCounts = {}
  window.history.replaceState(null, '', '/my')
})

describe('MyTasksClient — コメント数(吹き出しアイコン)', () => {
  it('useMyTaskCommentCounts を本人のID・組織ID付きで呼び、行にコメント数を出す', async () => {
    mocks.taskRows = [makeTask({ id: 't1', title: 'コメント付きタスク' })]
    mocks.commentCounts = { t1: 3 }

    render(buildTree(new QueryClient()))

    expect(await screen.findByText('コメント付きタスク')).toBeInTheDocument()
    const badge = await screen.findByTestId('task-row-comment-count')
    expect(badge).toHaveTextContent('3')

    expect(mocks.myTaskCommentCountsCalls.some((c) => c.orgId === 'org-1')).toBe(true)
  })

  it('コメントが無いタスクには吹き出しアイコンを出さない', async () => {
    mocks.taskRows = [makeTask({ id: 't1', title: 'コメント無しタスク' })]
    mocks.commentCounts = {}

    render(buildTree(new QueryClient()))

    expect(await screen.findByText('コメント無しタスク')).toBeInTheDocument()
    expect(screen.queryByTestId('task-row-comment-count')).not.toBeInTheDocument()
  })

  it('コメント数の読み込みが失敗・未解決でも一覧自体は表示する（空オブジェクト扱い）', async () => {
    mocks.taskRows = [makeTask({ id: 't1', title: '失敗時タスク' })]
    mocks.commentCounts = {}

    render(buildTree(new QueryClient()))

    expect(await screen.findByText('失敗時タスク')).toBeInTheDocument()
    expect(screen.queryByTestId('task-row-comment-count')).not.toBeInTheDocument()
  })
})
