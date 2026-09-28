import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MyTasksClient from '@/app/(internal)/my/MyTasksClient'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

/**
 * マイタスクで「完了にする」を押して断られたとき、理由を出す。
 *
 * 社内承認を頼んだタスクは、承認が全員そろうまで完了にできない（DB の enforce_review_gate）。
 * それまでマイタスクは、断られると行の見た目だけ元に戻し、理由は console にしか出して
 * いなかった（受信トレイと同じ穴。2026-09-18 に本番で発覚）。
 */

const REVIEW_GATE_ERROR = { message: 'Cannot complete task: review is not approved', code: 'P0001' }

const mocks = vi.hoisted(() => ({
  taskRows: [] as unknown[],
  updateResult: { data: null, error: null } as { data: unknown; error: unknown },
  toastError: vi.fn(),
}))

vi.mock('sonner', () => ({
  Toaster: () => null,
  toast: {
    error: mocks.toastError,
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => '/my',
}))

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

// 一覧に「完了にする」を出す条件（編集できる space）。ここは本テストの関心ではないので通す
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpaces: () => ({ canEditSpace: () => true, loading: false }),
  useCanEditSpace: () => ({ canEdit: true, loading: false }),
}))

vi.mock('@/components/task/TaskCreateSheet', () => ({ TaskCreateSheet: () => null }))
vi.mock('@/components/task/TaskInspector', () => ({ TaskInspector: () => null }))
vi.mock('@/components/layout', () => ({
  useInspector: () => ({ inspector: null, setInspector: vi.fn() }),
}))

vi.mock('@/lib/hooks/useTasks', () => ({
  useTasks: () => ({
    tasks: [],
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

/**
 * 既存の MyTasksClient のテストと同じ「何でも繋がる」代役。
 * ただし update が呼ばれた鎖だけは、書き込みの結果（断られる/通る）を返す
 */
function makeChainable(result: { data: unknown; error: unknown }) {
  let isWrite = false
  const chainable: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(isWrite ? mocks.updateResult : result)
        }
        if (prop === 'update') {
          isWrite = true
          return () => chainable
        }
        return () => chainable
      },
    }
  )
  return chainable
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
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
    title: '9/24セミナーの構成',
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
    reviews: { status: 'open', created_at: '2026-09-05T00:00:00Z' },
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
  mocks.taskRows = [makeTask()]
  mocks.updateResult = { data: null, error: REVIEW_GATE_ERROR }
  mocks.toastError.mockClear()
  window.history.replaceState(null, '', '/my')
})

describe('MyTasksClient — 完了にできないときの理由', () => {
  it('権限が無くて0行で返ったときも、黙って完了にしない', async () => {
    mocks.updateResult = { data: [], error: null }
    render(buildTree(new QueryClient()))

    fireEvent.click(await screen.findByRole('button', { name: '完了にする' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith(
        expect.stringContaining('権限が無いか、削除された可能性があります')
      )
    })
  })

  it('社内承認が終わっていないときは、その理由を出す', async () => {
    render(buildTree(new QueryClient()))

    fireEvent.click(await screen.findByRole('button', { name: '完了にする' }))

    await waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('社内の承認が終わっていないので、まだ完了にできません')
    })
  })

  it('うまくいったときは何も出さない（完了になり、既定の「アクティブ」から外れる）', async () => {
    mocks.updateResult = { data: [{ id: 't1' }], error: null }
    render(buildTree(new QueryClient()))

    fireEvent.click(await screen.findByRole('button', { name: '完了にする' }))

    await waitFor(() => {
      expect(screen.queryByText('9/24セミナーの構成')).not.toBeInTheDocument()
    })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
