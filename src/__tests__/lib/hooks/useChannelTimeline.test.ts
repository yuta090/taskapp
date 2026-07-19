import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  useChannelTimeline,
  MESSAGE_PAGE_SIZE,
  type ChannelMessageRow,
} from '@/lib/hooks/useChannelTimeline'

/**
 * useChannelTimeline — 設計(案A'): 表示用infiniteクエリ(keysetページング・不変)
 * ＋ポーラー(直近50件を30秒毎に取り直しpages[0]へunionマージ)の分離。
 *
 * 旧maxPages方式は fetchNextPage で pages[0](=最新)自体が破棄されるバグがあり
 * (深遡り後に新着が永久に拾えない/最新に戻れない/自送信が消える)、本設計に置き換えた。
 *
 * モックはコール順に依存しない「フェイクDB」方式にする: `.limit()`はその時点の
 * TABLE_STOREを実際にcreated_at,id降順ソート→(.or()で渡されたカーソルがあれば絞り込み)→
 * 先頭N件を返す。history/ポーラー2クエリが同時多発しても正しく整合する。
 */

let TABLE: ChannelMessageRow[] = []
function setTable(rows: ChannelMessageRow[]) {
  TABLE = rows
}

function sortDescForMock(rows: ChannelMessageRow[]): ChannelMessageRow[] {
  return [...rows].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at > b.created_at ? -1 : 1
    if (a.id === b.id) return 0
    return a.id > b.id ? -1 : 1
  })
}

function parseCursor(expr: string): { createdAt: string; id: string } {
  const match = expr.match(/^created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([^)]+)\)$/)
  if (!match) throw new Error(`useChannelTimeline.test: 想定外の or() 式: ${expr}`)
  return { createdAt: match[1], id: match[2] }
}

/** [hadCursor] だけを記録する簡易ログ。「ポーリングは常に直近50件1回のみ」の検証に使う */
const limitCallLog: Array<{ hadCursor: boolean }> = []
const orCallLog: string[] = []

function makeBuilder() {
  let cursor: { createdAt: string; id: string } | null = null
  const builder: {
    eq: ReturnType<typeof vi.fn>
    or: ReturnType<typeof vi.fn>
    order: ReturnType<typeof vi.fn>
    limit: ReturnType<typeof vi.fn>
  } = {
    eq: vi.fn(),
    or: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  }
  builder.eq.mockImplementation(() => builder)
  builder.or.mockImplementation((expr: string) => {
    orCallLog.push(expr)
    cursor = parseCursor(expr)
    return builder
  })
  builder.order.mockImplementation(() => builder)
  builder.limit.mockImplementation(async (n: number) => {
    limitCallLog.push({ hadCursor: cursor !== null })
    let pool = sortDescForMock(TABLE)
    if (cursor) {
      const c = cursor
      pool = pool.filter((r) => r.created_at < c.createdAt || (r.created_at === c.createdAt && r.id < c.id))
    }
    return { data: pool.slice(0, n), error: null }
  })
  return builder
}

const mockSelect = vi.fn(() => makeBuilder())
const mockFrom = vi.fn(() => ({ select: mockSelect }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function createWrapper(client?: QueryClient) {
  const queryClient = client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return { Wrapper, queryClient }
}

/** index=1が最古・数値が大きいほど新しい。created_at/idは昇順で単調増加させる。 */
function makeRow(index: number, overrides: Partial<ChannelMessageRow> = {}): ChannelMessageRow {
  const created = new Date(2026, 0, 1, 0, 0, index).toISOString()
  return {
    id: `m-${String(index).padStart(5, '0')}`,
    org_id: 'org-1',
    space_id: 'space-1',
    identity_id: null,
    account_id: null,
    channel: 'line',
    direction: index % 2 === 0 ? 'inbound' : 'outbound',
    actor: index % 2 === 0 ? 'client' : 'secretary',
    external_user_id: null,
    content_type: 'text',
    body: `msg-${index}`,
    storage_path: null,
    status: 'received',
    error: null,
    redacted_at: null,
    occurred_at: created,
    created_at: created,
    ...overrides,
  }
}

function makeRows(fromIndex: number, toIndex: number): ChannelMessageRow[] {
  const rows: ChannelMessageRow[] = []
  for (let i = fromIndex; i <= toIndex; i++) rows.push(makeRow(i))
  return rows
}

describe('useChannelTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    limitCallLog.length = 0
    orCallLog.length = 0
    setTable([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('初回取得はlimit(50)・created_at,id降順で問い合わせ、表示は昇順(古→新)になる', async () => {
    setTable(makeRows(1, 3))
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1'), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await waitFor(() => expect(result.current.messages).toHaveLength(3))

    expect(MESSAGE_PAGE_SIZE).toBe(50)
    expect(result.current.messages.map((m) => m.id)).toEqual(['m-00001', 'm-00002', 'm-00003'])
  })

  it('fetchNextPageで次の古いページがカーソルで取得でき、重複なく前方に連結される', async () => {
    setTable(makeRows(72, 170)) // 直近99件(50件のページ+49件の最終ページ)
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1'), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await waitFor(() => expect(result.current.messages).toHaveLength(50))
    expect(result.current.hasNextPage).toBe(true)

    await act(async () => {
      await result.current.fetchNextPage()
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(99))
    const ids = result.current.messages.map((m) => m.id)
    expect(ids[0]).toBe('m-00072')
    expect(ids.at(-1)).toBe('m-00170')
    expect(new Set(ids).size).toBe(99)
    expect(result.current.hasNextPage).toBe(false) // 最終ページが49件(<50)で末尾検出
  })

  it('【Red→Green】4ページ遡って合計200件超保持していても、新着メッセージがちゃんと現れる(旧maxPagesバグの回帰防止)', async () => {
    setTable(makeRows(1, 170)) // page1(121-170)+page2(71-120)+page3(21-70)+page4(1-20)
    const { Wrapper, queryClient } = createWrapper()
    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1', false), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await waitFor(() => expect(result.current.messages).toHaveLength(50))

    // 深く遡る(4ページ目まで=合計170件保持)
    await act(async () => {
      await result.current.fetchNextPage()
    })
    await act(async () => {
      await result.current.fetchNextPage()
    })
    await act(async () => {
      await result.current.fetchNextPage()
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(170))
    expect(result.current.hasNextPage).toBe(false)

    // 新着メッセージがサーバに1件増える
    setTable(makeRows(1, 171))
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['channelLatest', 'org-1', 'space-1'] })
    })

    // 4ページ保持したままでも新着が失われず現れる(旧実装ではmaxPages超過でpages[0]=最新50件が
    // 破棄され、この新着は二度と messages に現れなかった)
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toContain('m-00171'))
    expect(result.current.messages).toHaveLength(171)
  })

  it('【Red→Green】深遡り状態から「最新へ」(refreshLatest)で最新内容に戻れる。remountでも窓が貼り付かない', async () => {
    setTable(makeRows(1, 170))
    const { Wrapper, queryClient } = createWrapper()
    const { result, unmount } = renderHook(() => useChannelTimeline('org-1', 'space-1', false), {
      wrapper: Wrapper,
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await waitFor(() => expect(result.current.messages).toHaveLength(50))

    await act(async () => {
      await result.current.fetchNextPage()
    })
    await act(async () => {
      await result.current.fetchNextPage()
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(150))

    // サーバに新着が積まれた状態で明示的に「最新へ」
    setTable(makeRows(1, 172))
    await act(async () => {
      result.current.refreshLatest()
    })
    await waitFor(() => expect(result.current.messages.map((m) => m.id)).toContain('m-00172'))

    // space切替→戻り(remount)。ポーラーはstaleTime既定(0)のため初回fetchで新着を反映する
    unmount()
    setTable(makeRows(1, 175))
    const Wrapper2 = createWrapper(queryClient).Wrapper
    const { result: result2 } = renderHook(() => useChannelTimeline('org-1', 'space-1', false), {
      wrapper: Wrapper2,
    })
    await waitFor(() => expect(result2.current.isLoading).toBe(false))
    await waitFor(() => expect(result2.current.messages.map((m) => m.id)).toContain('m-00175'))
  })

  it('【Red→Green】深遡り中の自送信(optimistic)はポーラーのマージで消えず、サーバ反映後も二重化しない', async () => {
    setTable(makeRows(71, 170)) // 2ページ分
    const { Wrapper, queryClient } = createWrapper()
    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1', false), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await waitFor(() => expect(result.current.messages).toHaveLength(50))

    await act(async () => {
      await result.current.fetchNextPage()
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(100))

    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: 'real-9', status: 'sent' }) })
    await act(async () => {
      await result.current.sendMessage('深遡り中の連絡です。')
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(101))
    // POST成功時点でtempIdは既にreal-9へ置換済み
    expect(result.current.messages.at(-1)).toMatchObject({ id: 'real-9', body: '深遡り中の連絡です。' })

    // ポーラーがtickする(まだreal-9はTABLEに存在しない=サーバ未反映を模擬)
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['channelLatest', 'org-1', 'space-1'] })
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(101))
    expect(result.current.messages.filter((m) => m.id === 'real-9')).toHaveLength(1)

    // 次のtickでサーバにも同じidの行が反映される(通常のDB row)→union後も1件のまま(二重化しない)
    setTable([...makeRows(71, 170), makeRow(171, { id: 'real-9', body: '深遡り中の連絡です。', status: 'sent' })])
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['channelLatest', 'org-1', 'space-1'] })
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(101))
    expect(result.current.messages.filter((m) => m.id === 'real-9')).toHaveLength(1)
  })

  it('【Red→Green】ポーリングコストは常に有界(1周期=直近50件の1リクエストのみ。履歴ページは再取得しない)', async () => {
    setTable(makeRows(1, 170))
    // refetchIntervalのタイマーをfakeで発火させるため、mount前からfake timersにしておく
    // (mount後に切り替えると、mount時にreal timerで積まれたタイマーが進まない)
    vi.useFakeTimers()
    try {
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1', true), { wrapper: Wrapper })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.isLoading).toBe(false)
      expect(result.current.messages).toHaveLength(50)

      await act(async () => {
        await result.current.fetchNextPage()
        await vi.advanceTimersByTimeAsync(0)
      })
      await act(async () => {
        await result.current.fetchNextPage()
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.messages).toHaveLength(150)

      limitCallLog.length = 0 // ここまでの初回取得/履歴ページ取得ぶんをリセットして計測開始

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })

      // 1周期でlimit()が新たに呼ばれるのは1回だけ、かつカーソル無し(直近50件)のみ。
      // 履歴ページ(hadCursor=true)は1件も再取得されない。
      expect(limitCallLog).toHaveLength(1)
      expect(limitCallLog[0].hadCursor).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('【Red→Green】オーバーフロー安全弁: フルページ&ID重複ゼロならpages全体を最新へリセットしギャップを描画しない', async () => {
    setTable(makeRows(1, 170))
    const { Wrapper, queryClient } = createWrapper()
    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1', false), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await waitFor(() => expect(result.current.messages).toHaveLength(50))

    await act(async () => {
      await result.current.fetchNextPage()
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(100))

    // ポーリング間隔中に51件超の新着が積もり、直近50件がpage0(121-170)と1件も重複しない
    setTable([...makeRows(1, 100), ...makeRows(300, 349)])
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['channelLatest', 'org-1', 'space-1'] })
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(50))
    const ids = result.current.messages.map((m) => m.id)
    expect(ids.every((id) => id.startsWith('m-003'))).toBe(true) // 300-349のみ(=最新へジャンプ)
    // フルページ(50件)なので、さらに古い履歴(1-100)がまだ存在することを示すカーソルが立つ
    expect(result.current.hasNextPage).toBe(true)

    // pages配列全体がリセットされている(=[fresh]のみ)ことをfetchNextPageの継続性で確認する。
    // 旧page(121-170)は復元されない(ギャップは意図して描画しない仕様)が、
    // 新カーソル起点でのより古い履歴(1-100のうち直近50件=51-100)は正しく取得できる。
    await act(async () => {
      await result.current.fetchNextPage()
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(100)) // 300-349(50)+51-100(50)
    const idsAfter = result.current.messages.map((m) => m.id)
    expect(idsAfter).not.toContain('m-00170')
    expect(idsAfter[0]).toBe('m-00051')
  })

  it('送信成功: optimisticに即時追加され、成功後は実IDに置き換わる', async () => {
    const { Wrapper } = createWrapper()
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'real-1', status: 'sent' }),
    })

    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1', false), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let sendResult: { ok: boolean } | undefined
    await act(async () => {
      sendResult = await result.current.sendMessage('今月の請求書をお送りください。')
    })

    expect(sendResult?.ok).toBe(true)
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0]).toMatchObject({
      id: 'real-1',
      status: 'sent',
      direction: 'outbound',
      actor: 'secretary',
      body: '今月の請求書をお送りください。',
      isOptimistic: false,
    })
  })

  it('送信失敗(409等): メッセージはfailedのまま残りエラーが読める', async () => {
    const { Wrapper } = createWrapper()
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'LINEアカウントが無効化されています' }),
    })

    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1', false), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    let sendResult: { ok: boolean; error?: string } | undefined
    await act(async () => {
      sendResult = await result.current.sendMessage('確認をお願いします。')
    })

    expect(sendResult?.ok).toBe(false)
    expect(sendResult?.error).toContain('無効化')
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0]).toMatchObject({
      status: 'failed',
      error: 'LINEアカウントが無効化されています',
    })
  })

  it('ネットワークエラー: failedになりリトライできる状態を保つ', async () => {
    const { Wrapper } = createWrapper()
    fetchMock.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1', false), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.sendMessage('リマインドです。')
    })

    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0].status).toBe('failed')
    expect(result.current.messages[0].error).toContain('ネットワーク')
  })

  it('spaceId未選択: 送信せずエラーを返す', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useChannelTimeline('org-1', null), { wrapper: Wrapper })

    let sendResult: { ok: boolean } | undefined
    await act(async () => {
      sendResult = await result.current.sendMessage('テスト')
    })

    expect(sendResult?.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retryMessage: 失敗行を消してから同じ本文で送り直す(重複表示にしない)', async () => {
    const { Wrapper } = createWrapper()
    fetchMock
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: '一時的なエラー' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'real-2', status: 'sent' }) })

    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1', false), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.sendMessage('請求書の件です。')
    })
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0].status).toBe('failed')
    const failedMessage = result.current.messages[0]

    await act(async () => {
      await result.current.retryMessage(failedMessage)
    })

    // 失敗行が残ったまま新規行が積まれる(重複表示)にはならず、1件だけ残る
    await waitFor(() => expect(result.current.messages).toHaveLength(1))
    expect(result.current.messages[0]).toMatchObject({
      id: 'real-2',
      status: 'sent',
      body: '請求書の件です。',
    })
  })

  it('isLinked=falseのときポーラーのrefetchIntervalが無効化される(ポーリングを止める)', async () => {
    setTable(makeRows(1, 3))
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1', false), { wrapper: Wrapper })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const callsAfterInitialLoad = limitCallLog.length
    vi.useFakeTimers()
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
    } finally {
      vi.useRealTimers()
    }

    expect(limitCallLog.length).toBe(callsAfterInitialLoad)
  })

  it('isLinked=true(既定)では30秒毎にポーラーがポーリングされる', async () => {
    setTable(makeRows(1, 3))
    vi.useFakeTimers()
    try {
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useChannelTimeline('org-1', 'space-1', true), { wrapper: Wrapper })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.isLoading).toBe(false)

      const callsAfterInitialLoad = limitCallLog.length
      await act(async () => {
        await vi.advanceTimersByTimeAsync(31_000)
      })

      expect(limitCallLog.length).toBeGreaterThan(callsAfterInitialLoad)
    } finally {
      vi.useRealTimers()
    }
  })
})
