import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useTasks } from '@/lib/hooks/useTasks'
import type { Task } from '@/types/database'

// S4: ball='client' ⟹ client_scope='deliverable' 不変条件のテスト。
// RLS(app_task_visible_to_caller) は client_scope!=='deliverable' の行を
// クライアントから不可視にするため、ball='client' かつ非deliverableは
// 「クライアントは404、社内は待ちのまま」という行き止まりを生む。

const mockPassBall = vi.fn()
vi.mock('@/lib/supabase/rpc', () => ({
  rpc: { passBall: (...args: unknown[]) => mockPassBall(...args) },
}))

const mockFetchTasksQuery = vi.fn()
vi.mock('@/lib/supabase/queries', () => ({
  fetchTasksQuery: (...args: unknown[]) => mockFetchTasksQuery(...args),
}))

vi.mock('@/lib/slack/notify', () => ({ fireNotification: vi.fn() }))
vi.mock('@/lib/notifications/email-approval', () => ({ fireApprovalEmail: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(async () => {}),
  generateAuditSummary: vi.fn(() => 'summary'),
}))
vi.mock('@/lib/supabase/cached-auth', () => ({
  getCachedUser: vi.fn(async () => ({ user: { id: 'user-1' }, error: null })),
  getCachedUserId: vi.fn(async () => 'user-1'),
}))

// Chainable Supabase mock: from(table).<method>(...).<method>(...) → resolves per-table.
const mockUpdate = vi.fn()
const mockUpdateEq = vi.fn()
const mockInsert = vi.fn()
const mockInsertSelect = vi.fn()
const mockInsertSingle = vi.fn()
const mockTaskOwnersInsert = vi.fn()
const mockTaskOwnersSelect = vi.fn()
const mockTaskOwnersEq = vi.fn()

const mockFrom = vi.fn((table: string) => {
  if (table === 'tasks') {
    return {
      insert: mockInsert,
      update: mockUpdate,
    }
  }
  if (table === 'task_owners') {
    return {
      insert: mockTaskOwnersInsert,
      select: mockTaskOwnersSelect,
    }
  }
  throw new Error(`unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    org_id: 'o1',
    space_id: 's1',
    milestone_id: null,
    parent_task_id: null,
    title: 'サンプルタスク',
    description: null,
    status: 'backlog',
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
    client_scope: 'deliverable',
    actual_hours: null,
    estimated_cost: null,
    estimate_status: 'none',
    completed_at: null,
    created_at: '2026-07-01T00:00:00',
    updated_at: '2026-07-01T00:00:00',
    ...overrides,
  }
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useTasks — ball=client ⟹ client_scope=deliverable 不変条件', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUpdate.mockReturnValue({ eq: mockUpdateEq })
    mockUpdateEq.mockResolvedValue({ error: null })

    mockInsert.mockReturnValue({ select: mockInsertSelect })
    mockInsertSelect.mockReturnValue({ single: mockInsertSingle })

    mockTaskOwnersInsert.mockResolvedValue({ error: null })
    mockTaskOwnersSelect.mockReturnValue({ eq: mockTaskOwnersEq })
    mockTaskOwnersEq.mockResolvedValue({ data: [], error: null })

    mockPassBall.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('createTask: ball=client かつ clientScope=internal はエラーになり、DBへ書き込まない', async () => {
    mockFetchTasksQuery.mockResolvedValue({ tasks: [], owners: {}, reviewStatuses: {} })

    const { result } = renderHook(() => useTasks({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(
      result.current.createTask({
        title: '新規タスク',
        type: 'task',
        ball: 'client',
        origin: 'internal',
        clientScope: 'internal',
        clientOwnerIds: ['c1'],
        internalOwnerIds: [],
      })
    ).rejects.toThrow()

    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('createTask: ball=client かつ clientScope=deliverable は成功する', async () => {
    mockFetchTasksQuery.mockResolvedValue({ tasks: [], owners: {}, reviewStatuses: {} })
    mockInsertSingle.mockResolvedValue({
      data: makeTask({ id: 'new-1', ball: 'client', client_scope: 'deliverable' }),
      error: null,
    })

    const { result } = renderHook(() => useTasks({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.createTask({
        title: '新規タスク',
        type: 'task',
        ball: 'client',
        origin: 'internal',
        clientScope: 'deliverable',
        clientOwnerIds: ['c1'],
        internalOwnerIds: [],
      })
    })

    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ ball: 'client', client_scope: 'deliverable' })
    )
  })

  it('passBall: client_scope が internal のタスクを ball=client に渡すと、client_scope も deliverable に更新される', async () => {
    mockFetchTasksQuery.mockResolvedValue({
      tasks: [makeTask({ id: 't1', ball: 'internal', client_scope: 'internal' })],
      owners: {},
      reviewStatuses: {},
    })

    const { result } = renderHook(() => useTasks({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.tasks).toHaveLength(1))

    await act(async () => {
      await result.current.passBall('t1', 'client', ['c1'], [])
    })

    // rpc_pass_ball は呼ばれる
    expect(mockPassBall).toHaveBeenCalled()
    // かつ、client_scope を deliverable に揃える明示的な UPDATE も発行される
    expect(mockFrom).toHaveBeenCalledWith('tasks')
    expect(mockUpdate).toHaveBeenCalledWith({ client_scope: 'deliverable' })
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 't1')

    // キャッシュ上も client_scope が deliverable になっている
    await waitFor(() => expect(result.current.tasks[0].client_scope).toBe('deliverable'))
  })

  it('passBall: 既に client_scope=deliverable のタスクを ball=client に渡す場合は scope 更新を発行しない', async () => {
    mockFetchTasksQuery.mockResolvedValue({
      tasks: [makeTask({ id: 't1', ball: 'internal', client_scope: 'deliverable' })],
      owners: {},
      reviewStatuses: {},
    })

    const { result } = renderHook(() => useTasks({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.tasks).toHaveLength(1))

    await act(async () => {
      await result.current.passBall('t1', 'client', ['c1'], [])
    })

    expect(mockPassBall).toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('passBall: ball=internal に渡す場合は client_scope を変更しない', async () => {
    mockFetchTasksQuery.mockResolvedValue({
      tasks: [makeTask({ id: 't1', ball: 'client', client_scope: 'internal' })],
      owners: {},
      reviewStatuses: {},
    })

    const { result } = renderHook(() => useTasks({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.tasks).toHaveLength(1))

    await act(async () => {
      await result.current.passBall('t1', 'internal', [], ['i1'])
    })

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(result.current.tasks[0].client_scope).toBe('internal')
  })

  it('updateTask: ball=client のタスクを client_scope=internal に変更しようとするとエラーになる', async () => {
    mockFetchTasksQuery.mockResolvedValue({
      tasks: [makeTask({ id: 't1', ball: 'client', client_scope: 'deliverable' })],
      owners: {},
      reviewStatuses: {},
    })

    const { result } = renderHook(() => useTasks({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.tasks).toHaveLength(1))

    await expect(
      result.current.updateTask('t1', { clientScope: 'internal' })
    ).rejects.toThrow()

    expect(mockUpdate).not.toHaveBeenCalled()
    // 楽観的更新も行われていないこと
    expect(result.current.tasks[0].client_scope).toBe('deliverable')
  })

  it('updateTask: ball=internal のタスクは client_scope を internal に変更できる', async () => {
    mockFetchTasksQuery.mockResolvedValue({
      tasks: [makeTask({ id: 't1', ball: 'internal', client_scope: 'deliverable' })],
      owners: {},
      reviewStatuses: {},
    })
    mockUpdateEq.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [{ id: 't1', parent_task_id: null }], error: null }),
    })

    const { result } = renderHook(() => useTasks({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.tasks).toHaveLength(1))

    await act(async () => {
      await result.current.updateTask('t1', { clientScope: 'internal' })
    })

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ client_scope: 'internal' }))
    await waitFor(() => expect(result.current.tasks[0].client_scope).toBe('internal'))
  })
})
