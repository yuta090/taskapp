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
  owners: {} as Record<string, unknown[]>,
  loading: false,
  dataUpdatedAt: 0,
  setInspector: vi.fn(),
  useTasksArgs: [] as unknown[],
  updateTask: vi.fn(() => Promise.resolve()),
  deleteTask: vi.fn(() => Promise.resolve()),
  passBall: vi.fn(() => Promise.resolve()),
  fetchTasks: vi.fn(() => Promise.resolve()),
  push: vi.fn(),
}))

// next/navigation はグローバルの setup.ts で常に空の URLSearchParams を返すモックに
// なっているため、このファイルでは実際の URL(window.location.search)を反映するよう
// 上書きする（task= が保持されるか等をここで検証するため）。push も個別に捕まえる。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => '/my',
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
      owners: mocks.owners,
      reviewStatuses: {},
      loading: mocks.loading,
      dataUpdatedAt: mocks.dataUpdatedAt,
      error: null,
      fetchTasks: mocks.fetchTasks,
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

function buildTree(queryClient: QueryClient) {
  return (
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

function renderPage(queryClient = new QueryClient()) {
  return { ...render(buildTree(queryClient)), queryClient }
}

/** 右側パネルに最後に渡されたもの（閉じていれば null） */
function lastInspectorNode() {
  const calls = mocks.setInspector.mock.calls
  return calls.length > 0 ? calls[calls.length - 1][0] : undefined
}

/** setInspector に渡された要素の中身を確かめるため、切り離した container に描画する
 *  （document.body には積まない＝他のテストの screen クエリを汚さない） */
function renderNode(node: React.ReactElement) {
  return render(node, { container: document.createElement('div') })
}

beforeEach(() => {
  mocks.taskRows = []
  mocks.spaceTasks = []
  mocks.owners = {}
  mocks.loading = false
  // 既定は「一覧の取得(listFetchedAt)より新しい」= 揃っている状態
  mocks.dataUpdatedAt = Date.now() + 60_000
  mocks.useTasksArgs = []
  mocks.setInspector.mockClear()
  mocks.updateTask.mockClear()
  mocks.deleteTask.mockClear()
  mocks.passBall.mockClear()
  mocks.fetchTasks.mockClear()
  mocks.fetchTasks.mockResolvedValue(undefined)
  mocks.push.mockClear()
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
    mocks.spaceTasks = [makeTask()]
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))

    await waitFor(() => expect(lastInspectorNode()?.props.task.id).toBe('t1'))
    expect(lastInspectorNode()?.props.spaceId).toBe('space-1')
    // 50件の外にあっても担当者が揃うまで待てるよう、そのタスクIDを明示して取得する
    expect(mocks.useTasksArgs).toContainEqual({ orgId: 'org-1', spaceId: 'space-1', ensureTaskIds: ['t1'] })
    // ページは移動せず、URL にだけ選択中のタスクを残す（再読み込み・共有で同じ表示に戻せる）
    expect(window.location.pathname).toBe('/my')
    expect(new URLSearchParams(window.location.search).get('task')).toBe('t1')
  })

  it('読み込み中は詳細をまだ出さない（更新は要求しない）', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = []
    mocks.loading = true
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))

    await waitFor(() => expect(mocks.setInspector).toHaveBeenCalled())
    // プレースホルダのみで、TaskInspector（task プロパティを持つ要素）はまだ出ていない
    expect(lastInspectorNode()?.props?.task).toBeUndefined()
    // getByText は見つからないと例外を投げるため、これ自体が「表示されている」ことの検証になる
    // （分離した container には toBeInTheDocument が使えないため）
    const { getByText } = renderNode(lastInspectorNode() as React.ReactElement)
    expect(getByText('読み込み中...')).toBeTruthy()
    expect(mocks.fetchTasks).not.toHaveBeenCalled()
  })

  it('一覧より古いキャッシュ(stale)のときは詳細をまだ出さず、更新を1回だけ要求する', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask()]
    mocks.loading = false
    // 一覧の取得時刻(listFetchedAt)より明確に古い
    mocks.dataUpdatedAt = 1
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))

    await waitFor(() => expect(mocks.fetchTasks).toHaveBeenCalledTimes(1))
    expect(lastInspectorNode()?.props?.task).toBeUndefined()

    // 再レンダーが起きても、同じ一覧取得(listFetchedAt)に対しては1回しか要求しない
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.fetchTasks).toHaveBeenCalledTimes(1)
  })

  it('更新してもタスクが見つからなければ「開けませんでした」を表示する', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [] // プロジェクト側にそのタスクが存在しない
    mocks.dataUpdatedAt = 1
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))
    await waitFor(() => expect(mocks.fetchTasks).toHaveBeenCalledTimes(1))

    await waitFor(() => {
      const { getByText } = renderNode(lastInspectorNode() as React.ReactElement)
      expect(
        getByText('このタスクを開けませんでした。削除されたか、見る権限がない可能性があります。')
      ).toBeTruthy()
    })
  })

  it('揃ったとき、詳細の担当者は useTasks の結果から渡される', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask()]
    mocks.owners = { t1: [{ id: 'o1', task_id: 't1', side: 'internal', user_id: 'u1' }] }
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))

    await waitFor(() =>
      expect(lastInspectorNode()?.props.owners).toEqual([
        { id: 'o1', task_id: 't1', side: 'internal', user_id: 'u1' },
      ])
    )
  })

  it('同じタスクをもう一度クリックすると詳細を閉じる', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask()]
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
    mocks.spaceTasks = [makeTask()]
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))
    await waitFor(() => expect(lastInspectorNode()?.props.task.id).toBe('t1'))

    act(() => lastInspectorNode().props.onClose())
    await waitFor(() => expect(lastInspectorNode()).toBeNull())
  })

  it('詳細での変更はプロジェクト画面と同じ更新処理を通す', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask()]
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))
    await waitFor(() => expect(lastInspectorNode()?.props.task.id).toBe('t1'))

    await act(async () => {
      await lastInspectorNode().props.onUpdate({ title: '新しい名前' })
    })
    expect(mocks.updateTask).toHaveBeenCalledWith('t1', { title: '新しい名前' })
  })

  it('詳細で変えた内容が一覧にも映る（担当者まで揃ってから同期する）', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask()]
    const { rerender, queryClient } = renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))
    await waitFor(() => expect(lastInspectorNode()?.props.task.id).toBe('t1'))

    mocks.spaceTasks = [makeTask({ title: 'マイタスクA（更新後）' })]
    rerender(buildTree(queryClient))

    expect(await screen.findByText('マイタスクA（更新後）')).toBeInTheDocument()
    expect(lastInspectorNode()?.props.task.title).toBe('マイタスクA（更新後）')
  })

  it('一覧だけの変更（行の完了）は詳細側に上書きされない', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask()]
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))
    await waitFor(() => expect(lastInspectorNode()?.props.task.id).toBe('t1'))

    fireEvent.click(await screen.findByRole('button', { name: '完了にする' }))

    // 一覧側は完了扱いになりアクティブ一覧から消える
    await waitFor(() => expect(screen.queryByText('マイタスクA')).not.toBeInTheDocument())
    // 詳細側（useTasks のキャッシュ）は変わっていないので、古い値で上書きされていない
    expect(lastInspectorNode()?.props.task.title).toBe('マイタスクA')
  })

  it('別プロジェクトのタスクに切り替えると、詳細の要素キーがそのプロジェクトIDになる', async () => {
    mocks.taskRows = [
      makeTask({ id: 't1', space_id: 'space-1', title: 'マイタスクA' }),
      makeTask({ id: 't2', space_id: 'space-2', title: 'マイタスクB' }),
    ]
    mocks.spaceTasks = [makeTask({ id: 't1', space_id: 'space-1', title: 'マイタスクA' })]
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))
    await waitFor(() => expect(lastInspectorNode()?.props.task.id).toBe('t1'))
    expect(lastInspectorNode()?.key).toBe('space-1')

    mocks.spaceTasks = [makeTask({ id: 't2', space_id: 'space-2', title: 'マイタスクB' })]
    fireEvent.click(await screen.findByText('マイタスクB'))

    await waitFor(() => expect(lastInspectorNode()?.props.task.id).toBe('t2'))
    expect(lastInspectorNode()?.key).toBe('space-2')
  })

  it('詳細から削除すると一覧から消えて詳細も閉じる', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask()]
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

  it('一覧で完了にしたら、そのプロジェクトの読み込み結果のキャッシュだけを書き換える（invalidateはしない）', async () => {
    mocks.taskRows = [makeTask()]
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    queryClient.setQueryData(['tasks', 'org-1', 'space-1'], {
      tasks: [makeTask()],
      owners: {},
      reviewStatuses: {},
    })
    renderPage(queryClient)

    fireEvent.click(await screen.findByRole('button', { name: '完了にする' }))

    await waitFor(() => {
      const cached = queryClient.getQueryData(['tasks', 'org-1', 'space-1']) as {
        tasks: Array<{ id: string; status: string }>
      }
      expect(cached.tasks[0].status).toBe('done')
    })
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('新規作成を開いても、選択中タスクのURLパラメータ(task=)を保持する', async () => {
    window.history.replaceState(null, '', '/my?task=t1')
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask()]
    renderPage()

    fireEvent.click(screen.getByTestId('my-tasks-create'))

    await waitFor(() => expect(mocks.push).toHaveBeenCalled())
    const pushedUrl = mocks.push.mock.calls[0][0] as string
    const params = new URLSearchParams(pushedUrl.split('?')[1] ?? '')
    expect(params.get('create')).toBe('1')
    expect(params.get('task')).toBe('t1')
  })

  it('初期表示で ?task=t1 のとき、一覧が読み込まれたあとに詳細を開く', async () => {
    window.history.replaceState(null, '', '/my?task=t1')
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask()]
    renderPage()

    await waitFor(() => expect(lastInspectorNode()?.props.task.id).toBe('t1'))
  })
})
