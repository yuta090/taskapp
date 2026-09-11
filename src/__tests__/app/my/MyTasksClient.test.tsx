import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MyTasksClient from '@/app/(internal)/my/MyTasksClient'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'
import { invalidateCachedUser } from '@/lib/supabase/cached-auth'

/**
 * Regression coverage for the empty-My-Tasks copy added as part of the
 * first-run UX stream (D): a user with no assigned tasks previously saw
 * only "担当しているタスクはありません" with no guidance on how tasks get
 * assigned to them.
 */

const mocks = vi.hoisted(() => ({
  taskRows: [] as unknown[],
  spaceRows: [] as unknown[],
  milestoneRows: [] as unknown[],
  spaceTasks: [] as unknown[],
  owners: {} as Record<string, unknown[]>,
  loading: false,
  dataUpdatedAt: 0,
  isFetching: false,
  error: null as Error | null,
  setInspector: vi.fn(),
  useTasksArgs: [] as unknown[],
  updateTask: vi.fn(() => Promise.resolve()),
  deleteTask: vi.fn(() => Promise.resolve()),
  passBall: vi.fn(() => Promise.resolve()),
  fetchTasks: vi.fn(() => Promise.resolve()),
  createTask: vi.fn(),
  handleReviewChange: vi.fn(),
  push: vi.fn(),
  // ↓ 一覧の読み込みを react-query 化した分のテスト用（getUser の挙動・from() 呼び出し記録）
  getUserImpl: () =>
    Promise.resolve({ data: { user: null }, error: null }) as Promise<{
      data: { user: unknown }
      error: unknown
    }>,
  fromCalls: [] as Array<{ table: string; eqs: Array<[string, unknown]> }>,
  // 既定の table 別振り分け(taskRows/spaceRows/milestoneRows)を上書きしたいテスト用。
  // null の間は既定の振り分けを使う。
  fromOverride: null as null | ((table: string) => unknown),
}))

// next/navigation はグローバルの setup.ts で常に空の URLSearchParams を返すモックに
// なっているため、このファイルでは実際の URL(window.location.search)を反映するよう
// 上書きする（task= が保持されるか等をここで検証するため）。push も個別に捕まえる。
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => '/my',
}))

// お知らせベルは Supabase/組織コンテキストを引くので、取得層だけ差し替えて
// 「ヘッダーのどこに置かれているか」だけを検証する。
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
      isFetching: mocks.isFetching,
      error: mocks.error,
      fetchTasks: mocks.fetchTasks,
      createTask: mocks.createTask,
      updateTask: mocks.updateTask,
      deleteTask: mocks.deleteTask,
      passBall: mocks.passBall,
      handleReviewChange: mocks.handleReviewChange,
    }
  },
}))

// Chainable stand-in for `supabase.from(...).select().eq().order()` — the
// tasks table resolves to mocks.taskRows, everything else to an empty set。
// table名と .eq() の呼び出し引数を mocks.fromCalls に記録する（並列に問い合わせているか・
// org/userId で絞り込んでいるかをテストで確かめるため）。
function makeChainable(table: string, result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const record: { table: string; eqs: Array<[string, unknown]> } = { table, eqs: [] }
  mocks.fromCalls.push(record)
  const chainable: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(result)
        }
        if (prop === 'eq') {
          return (col: string, val: unknown) => {
            record.eqs.push([col, val])
            return chainable
          }
        }
        return () => chainable
      },
    }
  )
  return chainable
}

/** `.then()` が呼ばれたことだけを記録し、二度と解決しない代役（並列実行の検証用） */
function makeHangingChainable(table: string) {
  const record: { table: string; eqs: Array<[string, unknown]> } = { table, eqs: [] }
  mocks.fromCalls.push(record)
  const chainable: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return () => {
            // resolve/reject を一切呼ばない = 呼ばれた記録(fromCalls)だけ残して待たせ続ける
          }
        }
        if (prop === 'eq') {
          return (col: string, val: unknown) => {
            record.eqs.push([col, val])
            return chainable
          }
        }
        return () => chainable
      },
    }
  )
  return chainable
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn(() => mocks.getUserImpl()) },
    from: vi.fn((table: string) =>
      mocks.fromOverride
        ? mocks.fromOverride(table)
        : makeChainable(
            table,
            table === 'tasks'
              ? { data: mocks.taskRows, error: null }
              : table === 'spaces'
                ? { data: mocks.spaceRows, error: null }
                : table === 'milestones'
                  ? { data: mocks.milestoneRows, error: null }
                  : { data: [], error: null }
          )
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

function buildTree(queryClient: QueryClient, orgId = 'org-1') {
  return (
    <QueryClientProvider client={queryClient}>
      <ActiveOrgContext.Provider
        value={{
          activeOrgId: orgId,
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
  mocks.spaceRows = []
  mocks.milestoneRows = []
  mocks.spaceTasks = []
  mocks.owners = {}
  mocks.loading = false
  // 既定は「一覧の取得(listFetchedAt)より新しい」= 揃っている状態
  mocks.dataUpdatedAt = Date.now() + 60_000
  mocks.isFetching = false
  mocks.error = null
  mocks.useTasksArgs = []
  mocks.setInspector.mockClear()
  // mockClear だけだと、あるテストで mockImplementation/mockResolvedValue を差し替えた場合に
  // 次のテストへ持ち越されてしまう（例: 削除中テストの pending Promise）。毎回既定の実装に戻す
  mocks.updateTask.mockReset().mockResolvedValue(undefined)
  mocks.deleteTask.mockReset().mockResolvedValue(undefined)
  mocks.passBall.mockReset().mockResolvedValue(undefined)
  mocks.fetchTasks.mockReset().mockResolvedValue(undefined)
  mocks.createTask.mockClear()
  mocks.handleReviewChange.mockClear()
  mocks.push.mockClear()
  mocks.getUserImpl = () => Promise.resolve({ data: { user: null }, error: null })
  mocks.fromCalls = []
  mocks.fromOverride = null
  // cached-auth.ts はモジュール単位のキャッシュを持つため、あるテストで解決した getUser の
  // 結果が別のテスト（getUser が永遠に返らないことを前提とするもの）に漏れないようにする
  invalidateCachedUser()
  window.history.replaceState(null, '', '/my')
})

/** 本番の DEV_USER_ID フォールバックと同じ値（localhost かつ未ログイン時の担当者ID） */
const DEV_USER_ID = '0124bcca-7c66-406c-b1ae-2be8dac241c5'

/** MyTasksClient が使う /my 一覧のキャッシュキー */
function myTasksKeyFor(userId: string, orgId: string | null) {
  return ['myTasks', userId, orgId] as const
}

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
    // useTasks はプロジェクトの全タスクを読み込むため、タスクIDを明示指定する補完オプションは渡さない
    expect(mocks.useTasksArgs).toContainEqual({ orgId: 'org-1', spaceId: 'space-1' })
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

  it('一覧より少し古い(許容誤差2分以内)キャッシュはそのまま表示しつつ、裏で1回だけ更新する', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask()]
    // 一覧の取得時刻より60秒古い（許容誤差=2分以内なのですぐ表示してよい）
    mocks.dataUpdatedAt = Date.now() - 60_000
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))

    // 許容誤差内なのでネットワークを待たずにすぐ表示される
    await waitFor(() => expect(lastInspectorNode()?.props.task?.id).toBe('t1'))
    // ただし一覧より古いことに変わりはないので、裏で1回だけ更新を要求する
    await waitFor(() => expect(mocks.fetchTasks).toHaveBeenCalledTimes(1))
  })

  it('一覧を開いたまま放置してからタスクを押した場合、一覧取得時刻ではなく「開いた時刻」を基準に許容誤差を判定する', async () => {
    // listFetchedAt を基準にすると、/my を開いたまま31分放置してから押したケースで
    // 「一覧取得時刻からは31分前でも許容誤差(2分)を超えている」を見逃し、実際には
    // 開いた瞬間からは5分前(許容誤差超)のキャッシュを即表示してしまう。openedAt
    // （押した瞬間）を基準にすることでこれを防ぐ。
    const t0 = 1_700_000_000_000
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(t0)
    try {
      mocks.taskRows = [makeTask()]
      mocks.spaceTasks = [makeTask()]
      // 一覧取得時刻(t0)からは26分後の更新 = listFetchedAt基準だと余裕で許容誤差内
      mocks.dataUpdatedAt = t0 + 26 * 60_000

      renderPage()
      const row = await screen.findByText('マイタスクA') // ここまでで listFetchedAt = t0 が確定する

      // 31分放置してからタスクを押す（openedAt = t0 + 31分）
      nowSpy.mockReturnValue(t0 + 31 * 60_000)
      fireEvent.click(row)

      await waitFor(() => expect(mocks.setInspector).toHaveBeenCalled())
      // openedAt基準(t0+29分)より dataUpdatedAt(t0+26分)は古いので、まだプレースホルダ
      expect(lastInspectorNode()?.props?.task).toBeUndefined()
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('許容誤差を超えて古いときはプレースホルダのまま。取得中(isFetching)は重ねて要求せず、揃ったら表示に切り替わる', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask()]
    mocks.dataUpdatedAt = Date.now() - 10 * 60_000 // 許容誤差(2分)を超えて古い
    mocks.isFetching = true // ちょうど裏で取得中
    const { rerender, queryClient } = renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))

    await waitFor(() => expect(mocks.setInspector).toHaveBeenCalled())
    expect(lastInspectorNode()?.props?.task).toBeUndefined() // まだプレースホルダ
    // 取得中に重ねて要求しない（F: invalidate/refetch の二重発火を防ぐ）
    expect(mocks.fetchTasks).not.toHaveBeenCalled()

    // 取得が終わり、一覧より新しいデータになった
    mocks.isFetching = false
    mocks.dataUpdatedAt = Date.now() + 60_000
    rerender(buildTree(queryClient))

    await waitFor(() => expect(lastInspectorNode()?.props.task?.id).toBe('t1'))
  })

  it('新しいデータの取得中(isFetching)でも、すでに表示できているものをスピナーに戻さない', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask()]
    mocks.dataUpdatedAt = Date.now() + 60_000
    const { rerender, queryClient } = renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))
    await waitFor(() => expect(lastInspectorNode()?.props.task?.id).toBe('t1'))
    const callsBeforeRefetch = mocks.setInspector.mock.calls.length

    // 編集中に、バックグラウンドの再取得(isStale相当)が走った
    mocks.isFetching = true
    rerender(buildTree(queryClient))

    // 詳細は出したまま（isStale ベースだとここでスピナーに化けてしまう）
    expect(lastInspectorNode()?.props.task?.id).toBe('t1')
    // 表示中(canShow=true)の間は isFetching が変化しても TaskInspector 要素を作り直さない
    // （setInspector を呼び直さない） — placeholderKind をエフェクトの依存にしているため
    expect(mocks.setInspector.mock.calls.length).toBe(callsBeforeRefetch)
  })

  it('取得に失敗していて表示できるデータも無いときは、エラー表示から再試行できる', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = []
    mocks.dataUpdatedAt = Date.now() - 10 * 60_000
    mocks.isFetching = false
    mocks.error = new Error('network error')
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))

    await waitFor(() => {
      const { getByText } = renderNode(lastInspectorNode() as React.ReactElement)
      expect(getByText('タスクを読み込めませんでした')).toBeTruthy()
    })

    const callsBefore = mocks.fetchTasks.mock.calls.length
    const { getByRole } = renderNode(lastInspectorNode() as React.ReactElement)
    fireEvent.click(getByRole('button', { name: '再試行' }))
    expect(mocks.fetchTasks.mock.calls.length).toBe(callsBefore + 1)
  })

  it('取得エラーが出ている間は自動では再取得を要求しない（復帰は再試行ボタンから。さもないとErrorRetry→スピナー→ErrorRetryのちらつきになる）', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = []
    mocks.dataUpdatedAt = Date.now() - 10 * 60_000
    mocks.isFetching = false
    mocks.error = new Error('network error')
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))

    await waitFor(() => {
      const { getByText } = renderNode(lastInspectorNode() as React.ReactElement)
      expect(getByText('タスクを読み込めませんでした')).toBeTruthy()
    })

    // 少し待っても、エラーが出ている間は自動で fetchTasks を呼ばない
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.fetchTasks).not.toHaveBeenCalled()
  })

  it('削除中は、消えたタスクを更新要求で復活させたり「開けませんでした」を出したりしない', async () => {
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask()]
    let resolveDelete: () => void = () => {}
    mocks.deleteTask.mockImplementation(
      () => new Promise<void>((resolve) => { resolveDelete = resolve })
    )
    const { rerender, queryClient } = renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))
    await waitFor(() => expect(lastInspectorNode()?.props.task?.id).toBe('t1'))

    act(() => {
      void lastInspectorNode().props.onDelete()
    })

    // deleteTask がまだ解決していない間に、一覧側(spaceTasks)が楽観的更新で空になった状態を再現
    mocks.spaceTasks = []
    rerender(buildTree(queryClient))
    await Promise.resolve()

    expect(mocks.fetchTasks).not.toHaveBeenCalled()
    expect(lastInspectorNode()?.props?.task).toBeUndefined()
    const { queryByText } = renderNode(lastInspectorNode() as React.ReactElement)
    expect(
      queryByText('このタスクを開けませんでした。削除されたか、見る権限がない可能性があります。')
    ).toBeNull()

    await act(async () => {
      resolveDelete()
      await Promise.resolve()
    })

    await waitFor(() => expect(lastInspectorNode()).toBeNull())
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

  it('一覧より古いキャッシュ(spaceTask)の内容では、一覧側を上書きしない（同期ガード）', async () => {
    // spaceTask 自体は存在するが、一覧取得時刻(listFetchedAt)より古い更新時刻のまま
    // ＝ 永続キャッシュ等からの古いデータ。ここで一覧側へ同期すると、一覧の方が新しい
    // タイトルを持っていても古いタイトルで巻き戻ってしまう
    mocks.taskRows = [makeTask()]
    mocks.spaceTasks = [makeTask({ title: '古いプロジェクト側のタイトル' })]
    mocks.dataUpdatedAt = 1 // 一覧の取得時刻より確実に古い
    renderPage()

    fireEvent.click(await screen.findByText('マイタスクA'))
    await waitFor(() => expect(mocks.fetchTasks).toHaveBeenCalledTimes(1))

    // 一覧側の行タイトルは元のまま（古いキャッシュの内容で上書きされていない）
    expect(await screen.findByText('マイタスクA')).toBeInTheDocument()
    expect(screen.queryByText('古いプロジェクト側のタイトル')).not.toBeInTheDocument()
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

  it('一覧で完了にしたら、そのプロジェクトの読み込み結果のキャッシュだけを書き換える（invalidateはしない・更新時刻も変えない）', async () => {
    // react-query の setQueryData は既定で dataUpdatedAt を「今」に進めてしまう。ここでは
    // プロジェクト全体を読み直したわけではない（該当行だけの書き換え）ので、更新時刻は
    // 据え置かれるべき — さもないと1日前の永続キャッシュが「今取れたばかり」に見えてしまい、
    // 詳細パネル側の新旧判定（recentEnough/自動更新）が壊れる。
    mocks.taskRows = [makeTask()]
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const key = ['tasks', 'org-1', 'space-1']
    queryClient.setQueryData(
      key,
      { tasks: [makeTask()], owners: {}, reviewStatuses: {} },
      { updatedAt: 1000 }
    )
    renderPage(queryClient)

    fireEvent.click(await screen.findByRole('button', { name: '完了にする' }))

    await waitFor(() => {
      const cached = queryClient.getQueryData(key) as {
        tasks: Array<{ id: string; status: string }>
      }
      expect(cached.tasks[0].status).toBe('done')
    })
    expect(queryClient.getQueryState(key)?.dataUpdatedAt).toBe(1000)
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

describe('MyTasksClient — お知らせベルの置き場所', () => {
  it('ヘッダーの中にあり、ベル行を消す目印が付いている', () => {
    renderPage()
    const bell = screen.getByRole('button', { name: 'お知らせ' })
    expect(bell.closest('header')).not.toBeNull()
    expect(bell.closest('[data-header-bell]')).not.toBeNull()
  })
})

/**
 * 一覧の読み込みを react-query のキャッシュに載せ替えた分の回帰テスト。
 * - キャッシュ（IndexedDB からの復元を想定）があれば、通信を待たずに前回のデータを出す
 * - 本人ID(getUser・認証サーバーへの1往復)の解決を待たずに、tasks/spaces/milestonesの
 *   問い合わせが並列に出る
 * - queryKey に userId と activeOrgId を含み、別の組織に切り替えたら別データになる
 * - 行の完了トグルはキャッシュを楽観的に書き換え、失敗したら戻し、dataUpdatedAt は据え置く
 */
describe('MyTasksClient — 一覧の読み込みを react-query のキャッシュに載せる', () => {
  it('キャッシュに前回のデータがあれば、通信を待たずにすぐ一覧を出す（読み込み中を経由しない）', () => {
    // staleTime: Infinity にして、マウント直後のバックグラウンド再取得が
    // このテストの「一度も読み込み中を経由していない」という主張と混ざらないようにする
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    // QueryProvider が restoreClient で(通信無しで)先に入れておく ['currentUser'] を再現する。
    // これが無いと userId の確定を待つ間だけ「読み込み中」を経由してしまい、このテストの
    // 前提（キャッシュがあれば即座に出る）を検証できない。
    queryClient.setQueryData(['currentUser'], null)
    queryClient.setQueryData(myTasksKeyFor(DEV_USER_ID, 'org-1'), {
      tasks: [makeTask()],
      reviewStatuses: {},
      spaces: [],
      milestones: [],
      fetchedAt: Date.now(),
    })

    render(buildTree(queryClient))

    // waitFor を使わず、render 直後の同期的な結果だけを見る＝通信を待っていないことの証拠
    expect(screen.getByText('マイタスクA')).toBeInTheDocument()
    expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()
  })

  it('本人ID(getUser)が永遠に返らなくても、tasks/spaces/milestonesの問い合わせは出る', async () => {
    // getUser は二度と解決しない。ただし ['currentUser'] は QueryProvider の restoreClient が
    // 通信無し(getSession)で先に入れておいたのと同じ状態を再現する — これにより
    // useCurrentUser 自身は getUser を一切呼ばずに済む
    mocks.getUserImpl = () => new Promise(() => {})
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['currentUser'], null)

    render(buildTree(queryClient))

    // tasks 側は別経路(userId 確定後の useQuery)なので、getUser が解決しないままでも
    // 3本の問い合わせが出ることを確かめる。
    await waitFor(() => {
      const tables = mocks.fromCalls.map((c) => c.table)
      expect(tables).toEqual(expect.arrayContaining(['tasks', 'spaces', 'milestones']))
    })
  })

  it('tasks/spaces/milestonesの3本は並列に問い合わせる（1本が止まっていても他は出る）', async () => {
    // tasks 用の問い合わせだけを「呼ばれた記録は残すが二度と解決しない」代役にする。
    // 直列(waterfall)実装なら、tasks が解決するまで spaces/milestones は構築すらされない。
    mocks.fromOverride = (table: string) =>
      table === 'tasks' ? makeHangingChainable(table) : makeChainable(table, { data: [], error: null })
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    queryClient.setQueryData(['currentUser'], null)

    render(buildTree(queryClient))

    await waitFor(() => {
      const tables = mocks.fromCalls.map((c) => c.table)
      expect(tables).toEqual(expect.arrayContaining(['tasks', 'spaces', 'milestones']))
    })
  })

  it('queryKeyにuserIdとactiveOrgIdが入り、orgを切り替えると別データになる（前の組織の行は出ない）', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    queryClient.setQueryData(['currentUser'], null)
    queryClient.setQueryData(myTasksKeyFor(DEV_USER_ID, 'org-1'), {
      tasks: [makeTask({ title: '組織1のタスク' })],
      reviewStatuses: {},
      spaces: [],
      milestones: [],
      fetchedAt: Date.now(),
    })

    const { rerender } = render(buildTree(queryClient, 'org-1'))
    expect(await screen.findByText('組織1のタスク')).toBeInTheDocument()

    rerender(buildTree(queryClient, 'org-2'))

    // 前の組織(org-1)のキャッシュに紐づいた行はもう出ない（別のqueryKeyに切り替わったため）
    await waitFor(() => expect(screen.queryByText('組織1のタスク')).not.toBeInTheDocument())

    // 新しい組織(org-2)のキーで問い合わせが飛んだことも確認する
    await waitFor(() => {
      const orgFilters = mocks.fromCalls
        .filter((c) => c.table === 'tasks')
        .flatMap((c) => c.eqs)
      expect(orgFilters).toContainEqual(['org_id', 'org-2'])
    })
  })

  it('完了にする操作は一覧のキャッシュを楽観的に書き換え、取得時刻(dataUpdatedAt)は据え置く', async () => {
    // staleTime: Infinity で、マウント時のバックグラウンド再取得(既定データ=空)が
    // このあとの楽観的更新・dataUpdatedAt の検証と競合しないようにする
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    queryClient.setQueryData(['currentUser'], null)
    const key = myTasksKeyFor(DEV_USER_ID, 'org-1')
    queryClient.setQueryData(
      key,
      { tasks: [makeTask()], reviewStatuses: {}, spaces: [], milestones: [], fetchedAt: 500 },
      { updatedAt: 1000 }
    )

    render(buildTree(queryClient))
    expect(await screen.findByText('マイタスクA')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '完了にする' }))

    await waitFor(() => {
      const cached = queryClient.getQueryData(key) as { tasks: Array<{ id: string; status: string }> }
      expect(cached.tasks[0].status).toBe('done')
    })
    expect(queryClient.getQueryState(key)?.dataUpdatedAt).toBe(1000)
  })

  it('サーバー側の更新に失敗したら、一覧のキャッシュを元の状態に戻す', async () => {
    // staleTime: Infinity で、tasks を全滅させる fromOverride がマウント時の
    // バックグラウンド再取得にも刺さって表示自体が消えてしまう事故を防ぐ
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    queryClient.setQueryData(['currentUser'], null)
    const key = myTasksKeyFor(DEV_USER_ID, 'org-1')
    queryClient.setQueryData(key, {
      tasks: [makeTask()],
      reviewStatuses: {},
      spaces: [],
      milestones: [],
      fetchedAt: 500,
    })

    // tasks テーブルへの問い合わせ（完了トグルの update() が通る経路）を失敗させる。
    // 一覧はキャッシュ済み・staleTimeも無限large なので、これが一覧表示自体に影響しない。
    mocks.fromOverride = (table: string) =>
      table === 'tasks'
        ? makeChainable(table, { data: null, error: new Error('network error') })
        : makeChainable(table, { data: [], error: null })

    render(buildTree(queryClient))
    expect(await screen.findByText('マイタスクA')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '完了にする' }))

    await waitFor(() => {
      const cached = queryClient.getQueryData(key) as { tasks: Array<{ id: string; status: string }> }
      expect(cached.tasks[0].status).toBe('todo')
    })
  })

  it('MyTaskInspector に渡る listFetchedAt は、キャッシュに入れた fetchedAt と同じ', async () => {
    // lastInspectorNode() は MyTaskInspector 自身ではなく、その中で setInspector に渡された
    // 要素（プレースホルダ or TaskInspector）を返すため listFetchedAt を直接読むことはできない。
    // 代わりに、listFetchedAt を基準にした既存の新旧判定（MyTaskInspector 参照）を通して間接的に
    // 確かめる: fetchedAt を「未来の値」にしておき、それより古い dataUpdatedAt（詳細側の
    // useTasks 結果）を渡すと「一覧より古い」と判定されて fetchTasks が1回呼ばれるはず。
    // listFetchedAt が正しく fetchedAt に渡っていなければ（例えば 0 のまま）この判定は起きない。
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    queryClient.setQueryData(['currentUser'], null)
    const key = myTasksKeyFor(DEV_USER_ID, 'org-1')
    const fetchedAt = Date.now() + 10 * 60_000
    queryClient.setQueryData(key, {
      tasks: [makeTask()],
      reviewStatuses: {},
      spaces: [],
      milestones: [],
      fetchedAt,
    })
    mocks.spaceTasks = [makeTask()]
    mocks.dataUpdatedAt = Date.now() // fetchedAt(未来)より古い

    render(buildTree(queryClient))

    fireEvent.click(await screen.findByText('マイタスクA'))

    await waitFor(() => expect(mocks.fetchTasks).toHaveBeenCalledTimes(1))
  })

  it('詳細パネルでの同期・削除は、一覧のキャッシュ(myTasksKey)そのものを書き換える', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    queryClient.setQueryData(['currentUser'], null)
    const key = myTasksKeyFor(DEV_USER_ID, 'org-1')
    queryClient.setQueryData(key, {
      tasks: [makeTask()],
      reviewStatuses: {},
      spaces: [{ id: 'space-1', org_id: 'org-1', name: 'テストスペース' }],
      milestones: [],
      fetchedAt: 12345,
    })
    mocks.spaceTasks = [makeTask()]

    const { rerender } = render(buildTree(queryClient))

    fireEvent.click(await screen.findByText('マイタスクA'))
    await waitFor(() => expect(lastInspectorNode()?.props.task.id).toBe('t1'))

    // 詳細側での同期（useTasks 側の結果が変わった）→ 一覧のキャッシュ(myTasksKey)自体が書き換わる
    mocks.spaceTasks = [makeTask({ title: 'マイタスクA（更新後）' })]
    rerender(buildTree(queryClient))

    await waitFor(() => {
      const cached = queryClient.getQueryData(key) as { tasks: Array<{ id: string; title: string }> }
      expect(cached.tasks.some((t) => t.title === 'マイタスクA（更新後）')).toBe(true)
    })

    // 詳細から削除 → 一覧のキャッシュからも消える
    await act(async () => {
      await lastInspectorNode().props.onDelete()
    })
    await waitFor(() => {
      const cached = queryClient.getQueryData(key) as { tasks: Array<{ id: string }> }
      expect(cached.tasks.some((t) => t.id === 't1')).toBe(false)
    })
  })
})
