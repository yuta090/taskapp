import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MyTasksClient from '@/app/(internal)/my/MyTasksClient'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'

/**
 * Regression coverage for the empty-My-Tasks copy added as part of the
 * first-run UX stream (D): a user with no assigned tasks previously saw
 * only "担当しているタスクはありません" with no guidance on how tasks get
 * assigned to them.
 */

const mocks = vi.hoisted(() => ({
  taskRows: [] as unknown[],
  spaceTasks: [] as unknown[],
  setInspector: vi.fn(),
  useTasksArgs: [] as unknown[],
  updateTask: vi.fn(() => Promise.resolve()),
  deleteTask: vi.fn(() => Promise.resolve()),
  passBall: vi.fn(() => Promise.resolve()),
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
  useTasks: (opts: unknown) => {
    mocks.useTasksArgs.push(opts)
    return {
      tasks: mocks.spaceTasks,
      owners: {},
      reviewStatuses: {},
      loading: false,
      error: null,
      fetchTasks: vi.fn(),
      createTask: vi.fn(),
      updateTask: mocks.updateTask,
      deleteTask: mocks.deleteTask,
      passBall: mocks.passBall,
      handleReviewChange: vi.fn(),
    }
  },
}))

// Chainable stand-in for `supabase.from(...).select().eq().order()` — the
// tasks table resolves to mocks.taskRows, everything else to an empty set.
function makeChainable(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const chainable: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(result)
        }
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

function renderPage(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveOrgContext.Provider
        value={{
          activeOrgId: 'org-1',
          activeOrgName: 'テスト組織',
          activeOrgRole: 'admin',
          orgs: [],
          switchOrg: vi.fn(),
          loading: false,
        }}
      >
        <MyTasksClient />
      </ActiveOrgContext.Provider>
    </QueryClientProvider>
  )
}

/** 右側パネルに最後に渡されたもの（閉じていれば null） */
function lastInspectorNode() {
  const calls = mocks.setInspector.mock.calls
  return calls.length > 0 ? calls[calls.length - 1][0] : undefined
}

beforeEach(() => {
  mocks.taskRows = []
  mocks.spaceTasks = []
  mocks.useTasksArgs = []
  mocks.setInspector.mockClear()
  mocks.updateTask.mockClear()
  mocks.deleteTask.mockClear()
  mocks.passBall.mockClear()
  window.history.replaceState(null, '', '/my')
})

describe('MyTasksClient — 空状態の教育化 (初回UX改善 D)', () => {
  it('担当タスクが0件のとき、担当者設定への誘導文を表示する', async () => {
    renderPage()
    await waitFor(() =>
      expect(
        screen.getByText('担当者に設定されたタスクがここに表示されます。タスクの担当者欄から自分を設定してみましょう。')
      ).toBeInTheDocument()
    )
  })
})

describe('MyTasksClient — タスクの詳細を右側に出す', () => {
  it('タスクをクリックすると、ページを移動せず右側に詳細を出す', async () => {
    mocks.taskRows = [makeTask()]
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))

    await waitFor(() => expect(lastInspectorNode()?.props.task.id).toBe('t1'))
    expect(lastInspectorNode()?.props.spaceId).toBe('space-1')
    // 更新はそのタスクのプロジェクトを対象にした useTasks を通す
    expect(mocks.useTasksArgs).toContainEqual({ orgId: 'org-1', spaceId: 'space-1' })
    // ページは移動せず、URL にだけ選択中のタスクを残す（再読み込み・共有で同じ表示に戻せる）
    expect(window.location.pathname).toBe('/my')
    expect(new URLSearchParams(window.location.search).get('task')).toBe('t1')
  })

  it('同じタスクをもう一度クリックすると詳細を閉じる', async () => {
    mocks.taskRows = [makeTask()]
    renderPage()

    const row = await screen.findByText('マイタスクA')
    fireEvent.click(row)
    await waitFor(() => expect(lastInspectorNode()?.props.task.id).toBe('t1'))

    fireEvent.click(row)
    await waitFor(() => expect(lastInspectorNode()).toBeNull())
    expect(new URLSearchParams(window.location.search).get('task')).toBeNull()
  })

  it('詳細の「閉じる」で閉じる', async () => {
    mocks.taskRows = [makeTask()]
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))
    await waitFor(() => expect(lastInspectorNode()?.props.task.id).toBe('t1'))

    act(() => lastInspectorNode().props.onClose())
    await waitFor(() => expect(lastInspectorNode()).toBeNull())
  })

  it('詳細での変更はプロジェクト画面と同じ更新処理を通す', async () => {
    mocks.taskRows = [makeTask()]
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))
    await waitFor(() => expect(lastInspectorNode()?.props.task.id).toBe('t1'))

    await act(async () => {
      await lastInspectorNode().props.onUpdate({ title: '新しい名前' })
    })
    expect(mocks.updateTask).toHaveBeenCalledWith('t1', { title: '新しい名前' })
  })

  it('詳細で変えた内容が一覧にも映る', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask({ title: 'マイタスクA（更新後）' })]
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))

    expect(await screen.findByText('マイタスクA（更新後）')).toBeInTheDocument()
    expect(lastInspectorNode()?.props.task.title).toBe('マイタスクA（更新後）')
  })

  it('詳細から削除すると一覧から消えて詳細も閉じる', async () => {
    mocks.taskRows = [makeTask()]
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))
    await waitFor(() => expect(lastInspectorNode()?.props.task.id).toBe('t1'))

    await act(async () => {
      await lastInspectorNode().props.onDelete()
    })
    expect(mocks.deleteTask).toHaveBeenCalledWith('t1')
    await waitFor(() => expect(screen.queryByText('マイタスクA')).not.toBeInTheDocument())
    expect(lastInspectorNode()).toBeNull()
  })

  it('一覧で完了にしたら、そのプロジェクトの読み込み結果も更新する（詳細が古い状態のまま残らない）', async () => {
    mocks.taskRows = [makeTask()]
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    renderPage(queryClient)

    fireEvent.click(await screen.findByRole('button', { name: '完了にする' }))

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tasks', 'org-1', 'space-1'] })
    )
  })
})
