import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MyTasksClient from '@/app/(internal)/my/MyTasksClient'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

/**
 * マイタスクで、社内承認を依頼済み・承認済みのタスクにも「社内承認を依頼」ボタンが出ていた
 * （一覧が承認の状態を読んでいなかった）。依頼済みなら「社内承認待ち」などの表示に変える。
 *
 * 代役のデータは本番と同じ形にする: reviews は task_id が一意なので、Supabase の自動APIは
 * 配列ではなく「オブジェクト or null」で返す。配列で書くと、本番で一覧が読み込み中のまま
 * 止まる不具合を見逃す（実際に見逃しかけた）。
 */

const mocks = vi.hoisted(() => ({
  taskRows: [] as unknown[],
  spaceTasks: [] as unknown[],
  reviewStatuses: {} as Record<string, string>,
  dataUpdatedAt: 0,
  setInspector: vi.fn(),
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
  useInspector: () => ({ inspector: null, setInspector: mocks.setInspector }),
}))

vi.mock('@/lib/hooks/useTasks', () => ({
  useTasks: () => ({
    tasks: mocks.spaceTasks,
    owners: {},
    reviewStatuses: mocks.reviewStatuses,
    loading: false,
    dataUpdatedAt: mocks.dataUpdatedAt,
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
    auth: {
      // getCachedUser（cached-auth.ts）はロックを避けるため getSession() を先に読む
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
    },
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
  mocks.spaceTasks = []
  mocks.reviewStatuses = {}
  mocks.dataUpdatedAt = Date.now() + 60_000
  mocks.setInspector.mockClear()
  window.history.replaceState(null, '', '/my')
})

describe('MyTasksClient — 社内承認の状態を一覧に出す', () => {
  it('承認を依頼済み（承認待ち）なら「社内承認を依頼」ボタンを出さず「社内承認待ち」と出す', async () => {
    mocks.taskRows = [makeTask({ reviews: { status: 'open', created_at: '2026-09-05T00:00:00Z' } })]
    render(buildTree(new QueryClient()))

    expect(await screen.findByText('社内承認待ち')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '社内承認を依頼' })).not.toBeInTheDocument()
  })

  it('承認済みなら「社内承認済み」と出し、ボタンは出さない', async () => {
    mocks.taskRows = [makeTask({ reviews: { status: 'approved', created_at: '2026-09-05T00:00:00Z' } })]
    render(buildTree(new QueryClient()))

    expect(await screen.findByText('社内承認済み')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '社内承認を依頼' })).not.toBeInTheDocument()
  })

  it('まだ依頼していなければ（reviews が null）「社内承認を依頼」ボタンを出す', async () => {
    mocks.taskRows = [makeTask({ reviews: null })]
    render(buildTree(new QueryClient()))

    expect(await screen.findByRole('button', { name: '社内承認を依頼' })).toBeInTheDocument()
  })

  it('承認のあるタスクと無いタスクが混ざっていても、一覧が読み込み中のまま止まらない', async () => {
    mocks.taskRows = [
      makeTask({ id: 't1', title: '依頼済み', reviews: { status: 'open', created_at: '2026-09-05T00:00:00Z' } }),
      makeTask({ id: 't2', title: '未依頼', reviews: null }),
    ]
    render(buildTree(new QueryClient()))

    expect(await screen.findByText('依頼済み')).toBeInTheDocument()
    expect(screen.getByText('未依頼')).toBeInTheDocument()
    expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()
  })

  it('詳細から承認を依頼したら、一覧の表示も「社内承認待ち」に変わる', async () => {
    mocks.taskRows = [makeTask({ reviews: null })]
    mocks.spaceTasks = [makeTask()]
    const queryClient = new QueryClient()
    const { rerender } = render(buildTree(queryClient))

    fireEvent.click(await screen.findByText('マイタスクA'))
    await waitFor(() => expect(mocks.setInspector).toHaveBeenCalled())

    // 詳細（プロジェクト単位の読み込み結果）に、依頼した承認が入った
    mocks.reviewStatuses = { t1: 'open' }
    rerender(buildTree(queryClient))

    expect(await screen.findByText('社内承認待ち')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '社内承認を依頼' })).not.toBeInTheDocument()
  })
})
