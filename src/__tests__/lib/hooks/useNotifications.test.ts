import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useNotifications, type NotificationWithPayload } from '@/lib/hooks/useNotifications'
import { unreadCountQueryKey } from '@/lib/hooks/useUnreadNotificationCount'
import { ActiveOrgContext, type ActiveOrgContextValue } from '@/lib/org/ActiveOrgProvider'

/**
 * 既読にしてもバッジがすぐ消えなかった。以前はサーバーの返事を待ってから件数を取り直していた。
 * 画面（通知一覧とバッジの件数）を先に動かし、失敗したときだけ元に戻す。
 */

const ORG = 'org-1'
const LIST_KEY = ['notifications', ORG]

type Result = { data?: unknown; error: { message: string } | null }

const mockUpdate = vi.fn()
const mockListSelect = vi.fn()
/** 次の update() が返す結果。呼び出しごとに差し替えられるよう、呼ばれた時点の値を使う */
let updateResult: Promise<Result> = Promise.resolve({ error: null })
/** 一覧の取り直し（select）が返す結果 */
let listResult: () => Promise<Result>

/** Supabase のクエリ組み立て（.eq().is()...）の代役。await されたら result を返す */
function makeBuilder(result: Promise<unknown>) {
  const builder: Record<string, unknown> = {}
  for (const method of ['eq', 'is', 'in', 'order', 'limit', 'select']) {
    builder[method] = () => builder
  }
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    result.then(resolve, reject)
  return builder
}

/**
 * 一覧の読み込み（select）の代役。一覧は「新しい50件」と「未読ぜんぶ」（.is('read_at', null)）の2本を
 * 同時に読むので、新しい50件の方だけを「一覧を取り直した回数」として数える
 */
function makeListBuilder(selectArgs: unknown[]) {
  let unreadOnly = false
  let result: Promise<Result> | null = null
  const builder: Record<string, unknown> = {}
  for (const method of ['eq', 'in', 'order', 'limit']) {
    builder[method] = () => builder
  }
  builder.is = (column: string, value: unknown) => {
    if (column === 'read_at' && value === null) unreadOnly = true
    return builder
  }
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
    if (!result) {
      if (!unreadOnly) mockListSelect(...selectArgs)
      result = listResult()
    }
    return result.then(resolve, reject)
  }
  return builder
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    from: () => ({
      update: (patch: unknown) => {
        mockUpdate(patch)
        return makeBuilder(updateResult)
      },
      select: (...args: unknown[]) => makeListBuilder(args),
    }),
  }),
}))

vi.mock('@/lib/supabase/cached-auth', () => ({
  getCachedUser: async () => ({ user: { id: 'me' }, error: null }),
  invalidateCachedUser: () => {},
}))

function makeNotification(overrides: Partial<NotificationWithPayload> = {}): NotificationWithPayload {
  return {
    id: 'n1',
    org_id: ORG,
    space_id: 'space-1',
    to_user_id: 'me',
    channel: 'in_app',
    type: 'task_assigned',
    dedupe_key: 'k',
    payload: { title: '通知' },
    read_at: null,
    actioned_at: null,
    created_at: '2026-09-10T00:00:00Z',
    ...overrides,
  } as NotificationWithPayload
}

function seedList(): NotificationWithPayload[] {
  return [
    makeNotification({ id: 'n1', read_at: null }),
    makeNotification({ id: 'n2', read_at: '2026-09-10T01:00:00Z' }),
    makeNotification({ id: 'n3', read_at: null }),
  ]
}

const never = () => new Promise<Result>(() => {})

let queryClient: QueryClient

function wrapper({ children }: { children: React.ReactNode }) {
  const value: ActiveOrgContextValue = {
    activeOrgId: ORG,
    activeOrgName: null,
    activeOrgRole: null,
    orgs: [],
    orgsStatus: 'verified',
    orgsRefreshFailed: false,
    switchOrg: () => {},
    loading: false,
  }
  return React.createElement(
    QueryClientProvider,
    { client: queryClient },
    React.createElement(ActiveOrgContext.Provider, { value }, children)
  )
}

function listInCache() {
  return queryClient.getQueryData<NotificationWithPayload[]>(LIST_KEY) ?? []
}

function countInCache() {
  return queryClient.getQueryData<{ count: number; pendingCount: number }>(unreadCountQueryKey(ORG))
}

beforeEach(() => {
  mockUpdate.mockClear()
  mockListSelect.mockClear()
  updateResult = Promise.resolve({ error: null })
  // サーバーは既定では「最初に入れた一覧」を返す（取り直しても中身は同じ）
  listResult = () => Promise.resolve({ data: seedList(), error: null })
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  queryClient.setQueryData(LIST_KEY, seedList())
  queryClient.setQueryData(unreadCountQueryKey(ORG), { count: 2, pendingCount: 1 })
})

describe('useNotifications — 既読にしたらバッジをすぐ減らす', () => {
  it('サーバーの返事を待たずに、通知を既読にしてバッジを1つ減らす', async () => {
    let resolveUpdate!: (v: Result) => void
    updateResult = new Promise((resolve) => { resolveUpdate = resolve })

    const { result } = renderHook(() => useNotifications(), { wrapper })
    let pending!: Promise<void>
    act(() => { pending = result.current.markAsRead('n1') })

    expect(countInCache()).toEqual({ count: 1, pendingCount: 1 })
    expect(listInCache().find((n) => n.id === 'n1')?.read_at).not.toBeNull()

    await act(async () => {
      resolveUpdate({ error: null })
      await pending
    })
    expect(mockUpdate).toHaveBeenCalledWith({ read_at: expect.any(String) })
    expect(countInCache()).toEqual({ count: 1, pendingCount: 1 })
  })

  it('もう既読の通知では、バッジを減らさない（二重に減らさない）', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper })
    await act(async () => { await result.current.markAsRead('n2') })
    expect(countInCache()).toEqual({ count: 2, pendingCount: 1 })
  })

  it('保存に失敗したら、既読とバッジを元に戻す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    updateResult = Promise.resolve({ error: { message: 'denied' } })

    const { result } = renderHook(() => useNotifications(), { wrapper })
    await act(async () => { await result.current.markAsRead('n1') })

    expect(listInCache().find((n) => n.id === 'n1')?.read_at).toBeNull()
    expect(countInCache()).toEqual({ count: 2, pendingCount: 1 })
    consoleError.mockRestore()
  })

  it('対応済みにしたときも、未読だったならバッジを1つ減らす', async () => {
    let resolveUpdate!: (v: Result) => void
    updateResult = new Promise((resolve) => { resolveUpdate = resolve })

    const { result } = renderHook(() => useNotifications(), { wrapper })
    let pending!: Promise<void>
    act(() => { pending = result.current.markAsActioned('n3') })

    expect(countInCache()?.count).toBe(1)
    const n3 = listInCache().find((n) => n.id === 'n3')
    expect(n3?.read_at).not.toBeNull()
    expect(n3?.actioned_at).not.toBeNull()

    await act(async () => {
      resolveUpdate({ error: null })
      await pending
    })
  })

  it('すべて既読にすると、サーバーの返事を待たずにバッジが0になる', async () => {
    let resolveUpdate!: (v: Result) => void
    updateResult = new Promise((resolve) => { resolveUpdate = resolve })

    const { result } = renderHook(() => useNotifications(), { wrapper })
    let pending!: Promise<void>
    act(() => { pending = result.current.markAllAsRead() })

    expect(countInCache()?.count).toBe(0)
    expect(listInCache().every((n) => n.read_at !== null)).toBe(true)

    await act(async () => {
      resolveUpdate({ error: null })
      await pending
    })
  })
})

describe('useNotifications — 取り直しを止めたままにしない・余計に取り直さない', () => {
  it('既読にしたあと、バッジの件数はすぐには取り直さない（先に減らしてあるので、古い印だけ付ける）', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useNotifications(), { wrapper })
    await act(async () => { await result.current.markAsRead('n1') })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['unreadCount'], refetchType: 'none' })
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ['unreadCount'] })
  })

  it('対応済みにしたときは「要対応」の件数も変わるので、バッジをすぐ取り直す', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useNotifications(), { wrapper })
    await act(async () => { await result.current.markAsActioned('n3') })

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['unreadCount'] })
  })

  it('一覧の取り直しの途中で既読にしたら、保存のあとに一覧をもう一度取る（止めたままにしない）', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper })

    // 取り直しが始まり、まだ終わっていない
    listResult = never
    act(() => { void queryClient.refetchQueries({ queryKey: LIST_KEY }) })
    await waitFor(() => expect(mockListSelect).toHaveBeenCalledTimes(1))

    listResult = () => Promise.resolve({ data: seedList(), error: null })
    await act(async () => { await result.current.markAsRead('n1') })

    await waitFor(() => expect(mockListSelect).toHaveBeenCalledTimes(2))
  })

  it('取り直しの途中でなければ、既読にしても一覧は取り直さない（開くたびに一覧を読み直さない）', async () => {
    const { result } = renderHook(() => useNotifications(), { wrapper })
    await act(async () => { await result.current.markAsRead('n1') })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(mockListSelect).not.toHaveBeenCalled()
  })

  it('保存してあった古い一覧でも、先回りの書き換えで取得時刻を「今」にしない（古いものを新しいと見なさない）', async () => {
    // メールのリンクから開いた直後: ブラウザに保存してあった古い一覧が出て、取り直しが走っている
    queryClient.setQueryData(LIST_KEY, seedList(), { updatedAt: 1000 })
    listResult = never
    const { result } = renderHook(() => useNotifications(), { wrapper })
    await waitFor(() => expect(mockListSelect).toHaveBeenCalledTimes(1))

    act(() => { void result.current.markAsRead('n1') })

    expect(listInCache().find((n) => n.id === 'n1')?.read_at).not.toBeNull()
    expect(queryClient.getQueryState(LIST_KEY)?.dataUpdatedAt).toBe(1000)
  })
})

describe('useNotifications — 書き込みが重なったとき', () => {
  it('保存が重なっている間は取り直さず、全部終わってから1回だけ取り直す（保存中の既読を古い件数で上書きしない）', async () => {
    // 「対応済み」のあとに次の通知へ自動で進むと、次の通知の既読がほぼ同時に始まる
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useNotifications(), { wrapper })

    let finishActioned!: (v: Result) => void
    updateResult = new Promise((resolve) => { finishActioned = resolve })
    let pendingActioned!: Promise<void>
    act(() => { pendingActioned = result.current.markAsActioned('n3') })

    let finishRead!: (v: Result) => void
    updateResult = new Promise((resolve) => { finishRead = resolve })
    let pendingRead!: Promise<void>
    act(() => { pendingRead = result.current.markAsRead('n1') })

    // 1件目が先に保存できた。2件目はまだ保存中なので、ここで件数を取り直すと古い値が返る
    await act(async () => {
      finishActioned({ error: null })
      await pendingActioned
    })
    expect(invalidate).not.toHaveBeenCalled()

    // 2件目も保存できたら、まとめて1回だけ取り直す（対応済みがあったので件数はすぐ取り直す）
    await act(async () => {
      finishRead({ error: null })
      await pendingRead
    })
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['unreadCount'] })
    expect(countInCache()?.count).toBe(0)
  })
})

describe('useNotifications — 失敗したときの戻し方', () => {
  it('同じ通知で、先に失敗した既読の巻き戻しが、あとで成功した対応済みを消さない', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    // 失敗後の取り直しで一覧が上書きされないよう、取り直しは返事をしない
    listResult = never
    const { result } = renderHook(() => useNotifications(), { wrapper })

    let failRead!: (v: Result) => void
    updateResult = new Promise((resolve) => { failRead = resolve })
    let pendingRead!: Promise<void>
    act(() => { pendingRead = result.current.markAsRead('n1') })

    updateResult = Promise.resolve({ error: null })
    await act(async () => { await result.current.markAsActioned('n1') })

    await act(async () => {
      failRead({ error: { message: 'network' } })
      await pendingRead
    })

    const n1 = listInCache().find((n) => n.id === 'n1')
    expect(n1?.read_at).not.toBeNull()
    expect(n1?.actioned_at).not.toBeNull()
    // バッジも、対応済みで既読になった分は減ったまま
    expect(countInCache()?.count).toBe(1)
    consoleError.mockRestore()
  })

  it('すべて既読に失敗したら、元に戻したうえで一覧も取り直す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    updateResult = Promise.resolve({ error: { message: 'denied' } })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => useNotifications(), { wrapper })
    await act(async () => { await result.current.markAllAsRead() })

    expect(countInCache()?.count).toBe(2)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: LIST_KEY })
    consoleError.mockRestore()
  })
})
