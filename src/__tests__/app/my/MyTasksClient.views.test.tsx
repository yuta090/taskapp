import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import MyTasksClient from '@/app/(internal)/my/MyTasksClient'
import { ActiveOrgContext } from '@/lib/org/ActiveOrgProvider'
import { jstNow } from '@/lib/datetime/jstNow'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'

/**
 * マイタスクの表示の切り替え。プロジェクトのタスク一覧と同じように
 * タブ（すべて・アクティブ・未着手・完了）とまとめ方（期限別・プロジェクト別・マイルストーン別・
 * ステータス別）を選べて、ボールと未読コメントでも絞れる。
 */

const mocks = vi.hoisted(() => ({
  taskRows: [] as unknown[],
  spaceRows: [] as unknown[],
  milestoneRows: [] as unknown[],
  spaceTasks: [] as unknown[],
  unread: {} as Record<string, { count: number; fromNames: string[] }>,
  setInspector: vi.fn(),
  isMobile: false,
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
    reviewStatuses: {},
    loading: false,
    // 詳細パネルがすぐ出せるよう、プロジェクトの読み込みは十分新しいことにする
    dataUpdatedAt: Number.MAX_SAFE_INTEGER,
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

vi.mock('@/lib/hooks/useTaskCommentCounts', () => ({
  useMyTaskCommentCounts: () => ({}),
}))

vi.mock('@/lib/hooks/useUnreadTaskComments', () => ({
  useMyUnreadTaskComments: () => mocks.unread,
}))

vi.mock('@/lib/hooks/useIsMobile', () => ({
  useIsMobile: () => mocks.isMobile,
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
    from: vi.fn((table: string) => {
      if (table === 'tasks') return makeChainable({ data: mocks.taskRows, error: null })
      if (table === 'spaces') return makeChainable({ data: mocks.spaceRows, error: null })
      if (table === 'milestones') return makeChainable({ data: mocks.milestoneRows, error: null })
      return makeChainable({ data: [], error: null })
    }),
  }),
}))

const DEV_USER_ID = '0124bcca-7c66-406c-b1ae-2be8dac241c5'
const STORAGE_KEY = 'my-tasks-filters'

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

/** 日本時間の今日から n 日ずらした日付（YYYY-MM-DD） */
function dayOffset(n: number): string {
  const d = jstNow()
  d.setDate(d.getDate() + n)
  return formatDateToLocalString(d)
}

function clientTree(queryClient: QueryClient) {
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

function renderClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // 本番と同じく、本人は QueryProvider が通信なしで入れておく ['currentUser'] から分かる状態にする。
  // 入れないと、詳細パネルを開いたときの本人の読み直しの間だけ本人不明になり、一覧が一瞬空になる
  queryClient.setQueryData(['currentUser'], { id: DEV_USER_ID })
  return { ...render(clientTree(queryClient)), queryClient }
}

const groupLabels = () => screen.getAllByTestId('my-tasks-group-label').map((el) => el.textContent)

beforeEach(() => {
  mocks.taskRows = []
  mocks.spaceRows = [
    { id: 'space-1', org_id: 'org-1', name: 'A案件' },
    { id: 'space-2', org_id: 'org-1', name: 'B案件' },
  ]
  mocks.milestoneRows = []
  mocks.spaceTasks = []
  mocks.unread = {}
  mocks.setInspector.mockClear()
  mocks.isMobile = false
  window.localStorage.clear()
  window.history.replaceState(null, '', '/my')
})

describe('MyTasksClient — タブ（すべて・アクティブ・未着手・完了）', () => {
  const rows = () => [
    makeTask({ id: 'a', title: '進行中のタスク', status: 'in_progress' }),
    makeTask({ id: 'b', title: '未着手のタスク', status: 'backlog' }),
    makeTask({ id: 'c', title: '完了したタスク', status: 'done' }),
  ]

  it('既定は「アクティブ」: 未着手と完了は出さない。件数はいま出ている数', async () => {
    mocks.taskRows = rows()
    renderClient()

    expect(await screen.findByText('進行中のタスク')).toBeInTheDocument()
    expect(screen.queryByText('未着手のタスク')).not.toBeInTheDocument()
    expect(screen.queryByText('完了したタスク')).not.toBeInTheDocument()
    expect(screen.getByTestId('my-tasks-tab-active')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('my-tasks-count')).toHaveTextContent('1件')
  })

  it('「未着手」を押すと、担当の未着手タスクが見える', async () => {
    mocks.taskRows = rows()
    renderClient()
    await screen.findByText('進行中のタスク')

    fireEvent.click(screen.getByTestId('my-tasks-tab-backlog'))

    expect(await screen.findByText('未着手のタスク')).toBeInTheDocument()
    expect(screen.queryByText('進行中のタスク')).not.toBeInTheDocument()
    expect(screen.getByTestId('my-tasks-tab-backlog')).toHaveAttribute('aria-pressed', 'true')
  })

  it('「完了」は完了だけ、「すべて」は全部出す', async () => {
    mocks.taskRows = rows()
    renderClient()
    await screen.findByText('進行中のタスク')

    fireEvent.click(screen.getByTestId('my-tasks-tab-done'))
    expect(await screen.findByText('完了したタスク')).toBeInTheDocument()
    expect(screen.queryByText('進行中のタスク')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('my-tasks-tab-all'))
    expect(await screen.findByText('進行中のタスク')).toBeInTheDocument()
    expect(screen.getByText('未着手のタスク')).toBeInTheDocument()
    expect(screen.getByText('完了したタスク')).toBeInTheDocument()
    expect(screen.getByTestId('my-tasks-count')).toHaveTextContent('3件')
  })
})

describe('MyTasksClient — まとめ方', () => {
  it('既定は期限別: 期限切れ・今日・期限なしの見出しに分かれ、行にプロジェクト名が出る', async () => {
    mocks.taskRows = [
      makeTask({ id: 'none', title: '期限なしのタスク', due_date: null }),
      makeTask({ id: 'today', title: '今日のタスク', due_date: dayOffset(0) }),
      makeTask({ id: 'over', title: '遅れているタスク', due_date: dayOffset(-3), space_id: 'space-2' }),
    ]
    renderClient()
    await screen.findByText('今日のタスク')

    expect(screen.getByTestId('my-tasks-group-by')).toHaveValue('due')
    expect(groupLabels()).toEqual(['期限切れ', '今日', '期限なし'])
    expect(screen.getAllByTestId('task-row-project-name').map((el) => el.textContent)).toEqual([
      'B案件',
      'A案件',
      'A案件',
    ])
  })

  it('プロジェクト別にすると、プロジェクト→マイルストーンの見出しになり、行にはプロジェクト名を出さない', async () => {
    mocks.milestoneRows = [
      { id: 'm1', org_id: 'org-1', space_id: 'space-1', name: '設計', start_date: null, due_date: null, order_key: 0 },
    ]
    mocks.taskRows = [
      makeTask({ id: 'a', title: '設計のタスク', milestone_id: 'm1' }),
      makeTask({ id: 'b', title: 'B案件のタスク', space_id: 'space-2' }),
    ]
    renderClient()
    await screen.findByText('設計のタスク')

    fireEvent.change(screen.getByTestId('my-tasks-group-by'), { target: { value: 'project' } })

    await waitFor(() =>
      expect(screen.getAllByTestId('my-tasks-project-label').map((el) => el.textContent)).toEqual(['A案件', 'B案件'])
    )
    expect(groupLabels()).toEqual(['設計', 'マイルストーン未設定'])
    expect(screen.queryByTestId('task-row-project-name')).not.toBeInTheDocument()
  })

  it('マイルストーン別・ステータス別も選べる', async () => {
    mocks.milestoneRows = [
      { id: 'm1', org_id: 'org-1', space_id: 'space-1', name: '設計', start_date: null, due_date: null, order_key: 0 },
    ]
    mocks.taskRows = [
      makeTask({ id: 'a', title: '設計のタスク', milestone_id: 'm1', status: 'in_progress' }),
      makeTask({ id: 'b', title: 'ほかのタスク', status: 'todo' }),
    ]
    renderClient()
    await screen.findByText('設計のタスク')

    fireEvent.change(screen.getByTestId('my-tasks-group-by'), { target: { value: 'milestone' } })
    await waitFor(() => expect(groupLabels()).toEqual(['設計', 'マイルストーン未設定']))

    fireEvent.change(screen.getByTestId('my-tasks-group-by'), { target: { value: 'status' } })
    await waitFor(() => expect(groupLabels()).toEqual(['進行中', '着手予定']))
  })

  it('選んだまとめ方は端末に覚え、開き直しても同じ', async () => {
    mocks.taskRows = [makeTask({ id: 'a', title: '覚えるタスク' })]
    const first = renderClient()
    await screen.findByText('覚えるタスク')

    fireEvent.change(screen.getByTestId('my-tasks-group-by'), { target: { value: 'status' } })
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}').groupBy).toBe('status')
    first.unmount()

    renderClient()
    await screen.findByText('覚えるタスク')
    await waitFor(() => expect(screen.getByTestId('my-tasks-group-by')).toHaveValue('status'))
  })

  it('前の形の保存（status / showCompleted）が残っていても、既定の表示で開く', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ status: 'in_review', showCompleted: true, spaceId: null, sortField: 'due_date', sortOrder: 'asc' })
    )
    mocks.taskRows = [
      makeTask({ id: 'a', title: '着手予定のタスク', status: 'todo' }),
      makeTask({ id: 'b', title: '未着手のタスク', status: 'backlog' }),
    ]
    renderClient()

    // 前の形の status: 'in_review' が効いていたら出ないはずのタスク
    expect(await screen.findByText('着手予定のタスク')).toBeInTheDocument()
    expect(screen.queryByText('未着手のタスク')).not.toBeInTheDocument()
    expect(screen.getByTestId('my-tasks-group-by')).toHaveValue('due')
  })
})

describe('MyTasksClient — ボール', () => {
  it('「外部」にすると、ボールが社内以外にあるタスクだけ出す', async () => {
    mocks.taskRows = [
      makeTask({ id: 'a', title: '社内で動くタスク', ball: 'internal' }),
      makeTask({ id: 'b', title: 'クライアント確認待ちのタスク', ball: 'client' }),
    ]
    renderClient()
    await screen.findByText('社内で動くタスク')

    fireEvent.change(screen.getByTestId('my-tasks-ball-filter'), { target: { value: 'external' } })

    await waitFor(() => expect(screen.queryByText('社内で動くタスク')).not.toBeInTheDocument())
    expect(screen.getAllByText('クライアント確認待ちのタスク').length).toBeGreaterThan(0)
  })
})

describe('MyTasksClient — 未読コメント', () => {
  it('未読があるタスクの行に「未読 N」を出す', async () => {
    mocks.taskRows = [makeTask({ id: 't1', title: '未読付きのタスク' }), makeTask({ id: 't2', title: '既読のタスク' })]
    mocks.unread = { t1: { count: 2, fromNames: ['田中'] } }
    renderClient()
    await screen.findByText('未読付きのタスク')

    const pills = screen.getAllByTestId('task-row-unread-comments')
    expect(pills).toHaveLength(1)
    expect(pills[0]).toHaveTextContent('未読 2')
  })

  it('「未読コメント」を押すと、未読があるタスクだけ出す。ボタンには未読があるタスクの数を出す', async () => {
    mocks.taskRows = [
      makeTask({ id: 't1', title: '未読1のタスク' }),
      makeTask({ id: 't2', title: '既読のタスク' }),
      makeTask({ id: 't3', title: '未読2のタスク' }),
    ]
    mocks.unread = { t1: { count: 1, fromNames: [] }, t3: { count: 4, fromNames: [] } }
    renderClient()
    await screen.findByText('既読のタスク')

    const toggle = screen.getByTestId('my-tasks-unread-only')
    expect(toggle).toHaveTextContent('2')
    fireEvent.click(toggle)

    await waitFor(() => expect(screen.queryByText('既読のタスク')).not.toBeInTheDocument())
    expect(screen.getByText('未読1のタスク')).toBeInTheDocument()
    expect(screen.getByText('未読2のタスク')).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('未読があるタスクを開くと、詳細パネルに未読の件数を渡す（コメント欄を開いておくため）', async () => {
    const task = makeTask({ id: 't1', title: '開く未読付きのタスク' })
    mocks.taskRows = [task]
    mocks.spaceTasks = [task]
    mocks.unread = { t1: { count: 2, fromNames: [] } }
    renderClient()

    fireEvent.click(await screen.findByText('開く未読付きのタスク'))

    await waitFor(() => {
      const elements = mocks.setInspector.mock.calls
        .map((call) => call[0] as React.ReactElement<{ unreadCommentCount?: number }> | null)
        .filter((el): el is React.ReactElement<{ unreadCommentCount?: number }> => !!el && 'unreadCommentCount' in (el.props ?? {}))
      expect(elements.at(-1)?.props.unreadCommentCount).toBe(2)
    })
  })

  it('「未読コメント」で絞っているとき、開いたタスクは既読になっても一覧に残る（押した行が消えて並びがずれない）', async () => {
    const t1 = makeTask({ id: 't1', title: '読むタスク' })
    mocks.taskRows = [t1, makeTask({ id: 't2', title: '未読の無いタスク' })]
    mocks.spaceTasks = [t1]
    mocks.unread = { t1: { count: 1, fromNames: [] } }
    const { rerender, queryClient } = renderClient()
    await screen.findByText('読むタスク')
    fireEvent.click(screen.getByTestId('my-tasks-unread-only'))
    await waitFor(() => expect(screen.queryByText('未読の無いタスク')).not.toBeInTheDocument())

    fireEvent.click(screen.getByText('読むタスク'))
    await waitFor(() => expect(mocks.setInspector).toHaveBeenCalled())

    // コメント欄で既読になり、未読が消えた状態で描き直される
    mocks.unread = {}
    rerender(clientTree(queryClient))

    expect(screen.getByText('読むタスク')).toBeInTheDocument()
    expect(screen.queryByText('未読の無いタスク')).not.toBeInTheDocument()
  })
})

describe('MyTasksClient — 日付をまたいだとき', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('開いたまま日付が変わっても、画面に戻ったら「今日」の見出しを合わせ直す', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-16T03:00:00Z')) // 日本時間 9/16 12:00
    mocks.taskRows = [makeTask({ id: 't1', title: '9/16が期限のタスク', due_date: '2026-09-16' })]
    renderClient()
    await screen.findByText('9/16が期限のタスク')
    expect(groupLabels()).toEqual(['今日'])

    vi.setSystemTime(new Date('2026-09-17T03:00:00Z')) // 日本時間 9/17 12:00
    fireEvent(window, new Event('focus'))

    await waitFor(() => expect(groupLabels()).toEqual(['期限切れ']))
  })
})

describe('MyTasksClient — スマホの幅', () => {
  it('行を2段の表示にし（タスク名が札やプロジェクト名に押しつぶされない）、メニューの無い「…」ボタンは出さない', async () => {
    mocks.isMobile = true
    mocks.taskRows = [makeTask({ id: 't1', title: 'スマホで見るタスク', ball: 'client', due_date: dayOffset(-1) })]
    renderClient()

    const title = await screen.findByText('スマホで見るタスク')
    expect(title.closest('.task-row')).toHaveClass('h-16')
    expect(screen.getByTestId('task-row-project-name')).toHaveTextContent('A案件')
    expect(screen.queryByTestId('task-row-mobile-actions')).not.toBeInTheDocument()
  })
})
