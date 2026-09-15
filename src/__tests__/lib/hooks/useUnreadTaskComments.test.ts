import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  markTaskCommentsRead,
  resetRecentlyMarkedTaskComments,
  unreadTaskCommentsFromRows,
  unreadTaskCommentsQueryKey,
  useMarkTaskCommentsReadWhenSeen,
  useMyUnreadTaskComments,
} from '@/lib/hooks/useUnreadTaskComments'

/**
 * マイタスクの「未読コメント」。コメントが付くと DB のトリガーが担当者などに
 * 受信トレイのお知らせ（comment_added / mention）を作るので、その未読をタスクごとに数える。
 * 既読にするのは、そのタスクのコメントを読み込んだコメント欄が画面に入ったとき。
 */

interface Recorded {
  table: string
  ops: unknown[][]
}

function makeSupabase(result: { data: unknown; error: unknown }) {
  const calls: Recorded[] = []
  const from = vi.fn((table: string) => {
    const rec: Recorded = { table, ops: [] }
    calls.push(rec)
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, prop: string) {
          if (prop === 'then') {
            return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
              Promise.resolve(result).then(resolve, reject)
          }
          return (...args: unknown[]) => {
            rec.ops.push([prop, ...args])
            return builder
          }
        },
      }
    )
    return builder
  })
  return { client: { from } as unknown as SupabaseClient, from, calls }
}

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  getCachedUser: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => mocks.client,
}))

vi.mock('@/lib/supabase/cached-auth', () => ({
  getCachedUser: (...args: unknown[]) => mocks.getCachedUser(...args),
}))

function wrapperFor(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

const asUser = (id: string | null) => vi.fn(async () => id)

/** 自分以外が書いた、いちばん新しいコメント */
const LATEST = { id: 'c1', createdAt: '2026-09-16T00:00:00.000Z' }
const LATEST_MS = Date.parse(LATEST.createdAt)
/** 最新のコメントより十分あとに取った未読の一覧 */
const AFTER = LATEST_MS + 120_000
/** 最新のコメントより前に取った未読の一覧 */
const BEFORE = LATEST_MS - 1_000

beforeEach(() => {
  mocks.client = null
  mocks.getCachedUser.mockReset()
  resetRecentlyMarkedTaskComments()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('unreadTaskCommentsFromRows', () => {
  it('タスクごとに未読の数と、書いた人の名前（重複なし・届いた順）をまとめる', () => {
    expect(
      unreadTaskCommentsFromRows([
        { task_id: 't1', from_user_name: '田中' },
        { task_id: 't2', from_user_name: '佐藤' },
        { task_id: 't1', from_user_name: '佐藤' },
        { task_id: 't1', from_user_name: '田中' },
        { task_id: 't1', from_user_name: null },
      ])
    ).toEqual({
      t1: { count: 4, fromNames: ['田中', '佐藤'] },
      t2: { count: 1, fromNames: ['佐藤'] },
    })
  })

  it('task_id の無い行は数えない。null / undefined は空', () => {
    expect(unreadTaskCommentsFromRows([{ task_id: null, from_user_name: '田中' }])).toEqual({})
    expect(unreadTaskCommentsFromRows(null)).toEqual({})
    expect(unreadTaskCommentsFromRows(undefined)).toEqual({})
  })
})

describe('useMyUnreadTaskComments', () => {
  it('自分宛て・画面のお知らせ・コメントと名指しの種類・未読だけを、組織で絞って読む', async () => {
    const { client, calls } = makeSupabase({ data: [{ task_id: 't1', from_user_name: '田中' }], error: null })
    mocks.client = client
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result } = renderHook(() => useMyUnreadTaskComments('u1', 'o1'), { wrapper: wrapperFor(queryClient) })

    await waitFor(() => expect(result.current).toEqual({ t1: { count: 1, fromNames: ['田中'] } }))
    expect(calls[0].table).toBe('notifications')
    expect(calls[0].ops).toContainEqual(['eq', 'to_user_id', 'u1'])
    expect(calls[0].ops).toContainEqual(['eq', 'channel', 'in_app'])
    expect(calls[0].ops).toContainEqual(['in', 'type', ['comment_added', 'mention']])
    expect(calls[0].ops).toContainEqual(['is', 'read_at', null])
    expect(calls[0].ops).toContainEqual(['eq', 'org_id', 'o1'])
    expect(queryClient.getQueryData(unreadTaskCommentsQueryKey('u1', 'o1'))).toEqual({
      t1: { count: 1, fromNames: ['田中'] },
    })
  })

  it('組織が決まっていなければ組織では絞らない', async () => {
    const { client, calls } = makeSupabase({ data: [], error: null })
    mocks.client = client
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    renderHook(() => useMyUnreadTaskComments('u1', null), { wrapper: wrapperFor(queryClient) })

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].ops.some((op) => op[0] === 'eq' && op[1] === 'org_id')).toBe(false)
  })

  it('本人が分からない・読み込みを止めているときは問い合わせない', async () => {
    const { client, from } = makeSupabase({ data: [], error: null })
    mocks.client = client
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    const { result: noUser } = renderHook(() => useMyUnreadTaskComments(null, 'o1'), {
      wrapper: wrapperFor(queryClient),
    })
    const { result: disabled } = renderHook(() => useMyUnreadTaskComments('u1', 'o1', { enabled: false }), {
      wrapper: wrapperFor(queryClient),
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(from).not.toHaveBeenCalled()
    expect(noUser.current).toEqual({})
    expect(disabled.current).toEqual({})
  })

  it('読み込みに失敗しても空として返す（一覧はそのまま出す）', async () => {
    const { client, calls } = makeSupabase({ data: null, error: new Error('network') })
    mocks.client = client
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { result } = renderHook(() => useMyUnreadTaskComments('u1', 'o1'), { wrapper: wrapperFor(queryClient) })

    await waitFor(() => expect(calls).toHaveLength(1))
    await waitFor(() => expect(queryClient.getQueryState(unreadTaskCommentsQueryKey('u1', 'o1'))?.status).toBe('error'))
    expect(result.current).toEqual({})
    warn.mockRestore()
  })
})

describe('markTaskCommentsRead', () => {
  const key = unreadTaskCommentsQueryKey('u1', 'o1')

  function seed(queryClient: QueryClient, updatedAt = BEFORE) {
    queryClient.setQueryData(
      key,
      { t1: { count: 2, fromNames: ['田中'] }, t2: { count: 1, fromNames: [] } },
      { updatedAt }
    )
  }

  function input(queryClient: QueryClient, supabase: SupabaseClient, overrides: Record<string, unknown> = {}) {
    return {
      supabase,
      queryClient,
      taskId: 't1',
      orgId: 'o1',
      latestComment: LATEST,
      resolveUserId: asUser('u1'),
      ...overrides,
    }
  }

  it('そのタスク宛ての未読のコメント通知だけを既読にし、一覧の未読を先に消す（取得時刻は据え置く）', async () => {
    const queryClient = new QueryClient()
    seed(queryClient)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { client, calls } = makeSupabase({ data: [{ id: 'n1' }, { id: 'n2' }], error: null })

    await markTaskCommentsRead(input(queryClient, client))

    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('notifications')
    const update = calls[0].ops.find((op) => op[0] === 'update')
    expect(update?.[1]).toEqual({ read_at: expect.any(String) })
    expect(calls[0].ops).toContainEqual(['eq', 'to_user_id', 'u1'])
    expect(calls[0].ops).toContainEqual(['eq', 'channel', 'in_app'])
    expect(calls[0].ops).toContainEqual(['in', 'type', ['comment_added', 'mention']])
    expect(calls[0].ops).toContainEqual(['is', 'read_at', null])
    expect(calls[0].ops).toContainEqual(['eq', 'payload->>task_id', 't1'])

    expect(queryClient.getQueryData(key)).toEqual({ t2: { count: 1, fromNames: [] } })
    expect(queryClient.getQueryState(key)?.dataUpdatedAt).toBe(BEFORE)
    // 受信トレイの一覧・左メニューの未読数・未読の一覧も、既読にした分を取り直す
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['unreadCount'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['unreadTaskComments'] })
  })

  it('最新のコメントより後に取った未読の一覧にそのタスクが無ければ、本人確認も書き込みもしない', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(key, { t2: { count: 1, fromNames: [] } }, { updatedAt: AFTER })
    const { client, from } = makeSupabase({ data: [], error: null })
    const resolveUserId = asUser('u1')

    await markTaskCommentsRead(input(queryClient, client, { resolveUserId }))

    expect(resolveUserId).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it('未読の一覧が最新のコメントより前に取ったものなら、書き込む', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(key, { t2: { count: 1, fromNames: [] } }, { updatedAt: BEFORE })
    const { client, from } = makeSupabase({ data: [], error: null })

    await markTaskCommentsRead(input(queryClient, client))

    expect(from).toHaveBeenCalledWith('notifications')
  })

  it('別の組織の未読の一覧では判断しない', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(unreadTaskCommentsQueryKey('u1', 'o2'), { t2: { count: 1, fromNames: [] } }, { updatedAt: AFTER })
    const { client, from } = makeSupabase({ data: [], error: null })

    await markTaskCommentsRead(input(queryClient, client))

    expect(from).toHaveBeenCalledWith('notifications')
  })

  it('上限（500件）まで読んだ未読の一覧は全部入っているとは限らないので、そのタスクが無くても書き込む', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(key, { t2: { count: 500, fromNames: [] } }, { updatedAt: AFTER })
    const { client, from } = makeSupabase({ data: [], error: null })

    await markTaskCommentsRead(input(queryClient, client))

    expect(from).toHaveBeenCalledWith('notifications')
  })

  it('受信トレイの未読数が0でも、未読の一覧で分からなければ書き込む（古い0を信じて既読を取りこぼさない）', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(['unreadCount', 'o1'], { count: 0, pendingCount: 0 })
    const { client, from } = makeSupabase({ data: [], error: null })

    await markTaskCommentsRead(input(queryClient, client))

    expect(from).toHaveBeenCalledWith('notifications')
  })

  it('最新のコメントが変わらないまま開き直しても書き込まない。新しいコメントが付いたらまた書き込む', async () => {
    const queryClient = new QueryClient()
    const { client, from } = makeSupabase({ data: [], error: null })

    await markTaskCommentsRead(input(queryClient, client))
    await markTaskCommentsRead(input(queryClient, client, { taskId: 't2' }))
    await markTaskCommentsRead(input(queryClient, client))
    expect(from).toHaveBeenCalledTimes(2)

    await markTaskCommentsRead(
      input(queryClient, client, { latestComment: { id: 'c2', createdAt: '2026-09-16T00:05:00.000Z' } })
    )
    expect(from).toHaveBeenCalledTimes(3)
  })

  it('最新のコメントが変わらなくても、そのタスクに未読があると分かっていれば書き込む', async () => {
    const queryClient = new QueryClient()
    const { client, from } = makeSupabase({ data: [{ id: 'n1' }], error: null })

    await markTaskCommentsRead(input(queryClient, client))
    seed(queryClient, AFTER)
    await markTaskCommentsRead(input(queryClient, client))

    expect(from).toHaveBeenCalledTimes(2)
  })

  it('1件も既読にならなかったときは、受信トレイを取り直さない', async () => {
    const queryClient = new QueryClient()
    seed(queryClient)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { client } = makeSupabase({ data: [], error: null })

    await markTaskCommentsRead(input(queryClient, client))

    expect(invalidate).not.toHaveBeenCalled()
  })

  it('書き込みに失敗したら、先に消した未読を元に戻し、次に開いたときにもう一度書き込む', async () => {
    const queryClient = new QueryClient()
    seed(queryClient)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { client, from } = makeSupabase({ data: null, error: new Error('denied') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await markTaskCommentsRead(input(queryClient, client))

    expect(queryClient.getQueryData(key)).toEqual({
      t1: { count: 2, fromNames: ['田中'] },
      t2: { count: 1, fromNames: [] },
    })
    expect(queryClient.getQueryState(key)?.dataUpdatedAt).toBe(BEFORE)
    expect(invalidate).not.toHaveBeenCalled()

    await markTaskCommentsRead(input(queryClient, client))
    expect(from).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })

  it('未読の一覧を取り直している最中なら、止めてから未読を消し、書き込みのあとにもう一度取り直す', async () => {
    const queryClient = new QueryClient()
    seed(queryClient)
    vi.spyOn(queryClient, 'isFetching').mockReturnValue(1)
    const cancel = vi.spyOn(queryClient, 'cancelQueries')
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { client } = makeSupabase({ data: [], error: null })

    await markTaskCommentsRead(input(queryClient, client))

    expect(cancel).toHaveBeenCalledWith({ queryKey: ['unreadTaskComments'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['unreadTaskComments'] })
  })

  it('本人が分からなければ書き込まず、未読も触らない。分かったあとで開けば書き込む', async () => {
    const queryClient = new QueryClient()
    seed(queryClient)
    const { client, from } = makeSupabase({ data: [], error: null })

    await markTaskCommentsRead(input(queryClient, client, { resolveUserId: asUser(null) }))

    expect(from).not.toHaveBeenCalled()
    expect(queryClient.getQueryData(key)).toEqual({
      t1: { count: 2, fromNames: ['田中'] },
      t2: { count: 1, fromNames: [] },
    })

    await markTaskCommentsRead(input(queryClient, client))
    expect(from).toHaveBeenCalledTimes(1)
  })
})

describe('useMarkTaskCommentsReadWhenSeen', () => {
  class FakeIntersectionObserver {
    static instances: FakeIntersectionObserver[] = []
    targets: Element[] = []
    constructor(private readonly callback: IntersectionObserverCallback) {
      FakeIntersectionObserver.instances.push(this)
    }
    observe(target: Element) {
      this.targets.push(target)
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
    fire(isIntersecting: boolean) {
      this.callback(
        this.targets.map((target) => ({ isIntersecting, target }) as IntersectionObserverEntry),
        this as unknown as IntersectionObserver
      )
    }
  }

  beforeEach(() => {
    FakeIntersectionObserver.instances = []
  })

  it('コメント欄が画面に入ってから既読にする。本人のIDは端末に入っている currentUser から取る', async () => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    const { client, calls } = makeSupabase({ data: [], error: null })
    mocks.client = client
    const queryClient = new QueryClient()
    queryClient.setQueryData(['currentUser'], { id: 'u1' })
    const targetRef = { current: document.createElement('div') }

    renderHook(
      () => useMarkTaskCommentsReadWhenSeen({ taskId: 't1', orgId: 'o1', latestComment: LATEST, targetRef }),
      { wrapper: wrapperFor(queryClient) }
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toHaveLength(0)

    act(() => FakeIntersectionObserver.instances.at(-1)?.fire(true))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].ops).toContainEqual(['eq', 'to_user_id', 'u1'])
    expect(mocks.getCachedUser).not.toHaveBeenCalled()
  })

  it('画面に入る仕組み（IntersectionObserver）が無い環境では、表示した時点で既読にする。currentUser が無ければ共通の本人確認で取る', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { client, calls } = makeSupabase({ data: [], error: null })
    mocks.client = client
    mocks.getCachedUser.mockResolvedValue({ user: { id: 'u2' }, error: null })
    const queryClient = new QueryClient()
    const targetRef = { current: document.createElement('div') }

    renderHook(
      () => useMarkTaskCommentsReadWhenSeen({ taskId: 't1', orgId: 'o1', latestComment: LATEST, targetRef }),
      { wrapper: wrapperFor(queryClient) }
    )

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].ops).toContainEqual(['eq', 'to_user_id', 'u2'])
  })

  it('自分以外のコメントが無ければ、既読にするお知らせも無いので何もしない', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { client, from } = makeSupabase({ data: [], error: null })
    mocks.client = client
    const queryClient = new QueryClient()
    queryClient.setQueryData(['currentUser'], { id: 'u1' })
    const targetRef = { current: document.createElement('div') }

    renderHook(
      () => useMarkTaskCommentsReadWhenSeen({ taskId: 't1', orgId: 'o1', latestComment: null, targetRef }),
      { wrapper: wrapperFor(queryClient) }
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(from).not.toHaveBeenCalled()
  })
})
