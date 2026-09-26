import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDocVoteSignal, onDocSignal, sendDocSignal } from '@/lib/hooks/useDocVoteSignal'

// 投票の「票が変わった」合図（DOC_VOTE_SPEC §6）。
// - 合図だけを送る private チャネル。本文も票も運ばない（受けた側が読み直す）
// - private のポリシーは本人にしか効かないので、購読の前に本人の鍵を setAuth に引数で渡す
// - つながらなくても画面は壊さない。2回までやり直して諦める（読み直しは今までどおり）

type StatusCb = (status: string) => void

let order: string[] = []
let channels: FakeChannel[] = []
/** クライアントがまだ一覧に持っているチャネル（閉じている途中のものを含む） */
let listed: Array<{ topic: string }> = []

interface FakeChannel {
  topic: string
  options: { config: { private: boolean; broadcast: { self: boolean } } }
  send: ReturnType<typeof vi.fn>
  emitStatus: (status: string) => void
  emitBroadcast: (event: string) => void
}

function createFakeChannel(topic: string, options: FakeChannel['options']): FakeChannel {
  const handlers = new Map<string, Array<() => void>>()
  let statusCb: StatusCb | undefined
  const channel = {
    topic,
    options,
    on: vi.fn((type: string, filter: { event: string }, cb: () => void) => {
      const key = `${type}:${filter.event}`
      handlers.set(key, [...(handlers.get(key) ?? []), cb])
      return channel
    }),
    subscribe: vi.fn((cb?: StatusCb) => {
      order.push('subscribe')
      statusCb = cb
      return channel
    }),
    send: vi.fn(async () => 'ok'),
    emitStatus: (status: string) => statusCb?.(status),
    emitBroadcast: (event: string) => (handlers.get(`broadcast:${event}`) ?? []).forEach((h) => h()),
  }
  return channel
}

const mockRemoveChannel = vi.fn(async (ch: { topic: string }) => {
  listed = listed.filter((c) => c !== ch)
})
const mockSetAuth = vi.fn(async (token?: string | null) => {
  order.push(`setAuth:${token}`)
})
const mockGetSession = vi.fn(async (): Promise<{ data: { session: { access_token: string } | null } }> => ({
  data: { session: { access_token: 'jwt-self' } },
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: (topic: string, options: FakeChannel['options']) => {
      const ch = createFakeChannel(topic, options)
      channels.push(ch)
      listed.push({ topic: `realtime:${topic}` })
      return ch
    },
    getChannels: () => listed,
    removeChannel: (ch: { topic: string }) => mockRemoveChannel(ch),
    auth: { getSession: () => mockGetSession() },
    realtime: { setAuth: (token?: string | null) => mockSetAuth(token) },
  }),
}))

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
  })
}

async function subscribed(): Promise<FakeChannel> {
  await flush()
  const ch = channels[channels.length - 1]
  await act(async () => {
    ch.emitStatus('SUBSCRIBED')
    await Promise.resolve()
  })
  return ch
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  order = []
  channels = []
  listed = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useDocVoteSignal', () => {
  it('議事録は meeting-minutes-view:<会議ID> の private チャネルに、鍵を渡してから入る', async () => {
    renderHook(() => useDocVoteSignal({ meetingId: 'm1' }, vi.fn()))
    await flush()
    expect(channels).toHaveLength(1)
    expect(channels[0].topic).toBe('meeting-minutes-view:m1')
    expect(channels[0].options.config.private).toBe(true)
    // 自分の合図は受け取らない（押した側はもう読み直している）
    expect(channels[0].options.config.broadcast.self).toBe(false)
    expect(order).toEqual(['setAuth:jwt-self', 'subscribe'])
  })

  it('Wiki は wiki-page-view:<ページID> に入る', async () => {
    renderHook(() => useDocVoteSignal({ wikiPageId: 'w1' }, vi.fn()))
    await flush()
    expect(channels[0].topic).toBe('wiki-page-view:w1')
  })

  it('文書が決まっていなければ入らない', async () => {
    renderHook(() => useDocVoteSignal(null, vi.fn()))
    await flush()
    expect(channels).toHaveLength(0)
  })

  it('鍵が取れなければ入らない（anon の鍵では必ず断られる）', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } })
    renderHook(() => useDocVoteSignal({ meetingId: 'm1' }, vi.fn()))
    await flush()
    expect(channels).toHaveLength(0)
  })

  it('ほかの人の合図を受けたら onSignal を呼ぶ', async () => {
    const onSignal = vi.fn()
    renderHook(() => useDocVoteSignal({ meetingId: 'm1' }, onSignal))
    const ch = await subscribed()
    onSignal.mockClear() // つながったときの読み直しの分
    act(() => ch.emitBroadcast('vote-changed'))
    expect(onSignal).toHaveBeenCalledTimes(1)
  })

  it('つながったら connected が true になり、notify で合図を送る', async () => {
    const { result } = renderHook(() => useDocVoteSignal({ meetingId: 'm1' }, vi.fn()))
    expect(result.current.connected).toBe(false)
    const ch = await subscribed()
    expect(result.current.connected).toBe(true)
    act(() => result.current.notify())
    expect(ch.send).toHaveBeenCalledWith({ type: 'broadcast', event: 'vote-changed', payload: {} })
  })

  it('つながる前の notify は何もしない', async () => {
    const { result } = renderHook(() => useDocVoteSignal({ meetingId: 'm1' }, vi.fn()))
    await flush()
    act(() => result.current.notify())
    expect(channels[0].send).not.toHaveBeenCalled()
  })

  it('断られたら2秒・6秒あとにやり直し、3回目で諦める', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useDocVoteSignal({ meetingId: 'm1' }, vi.fn()))
    await flush()
    act(() => channels[0].emitStatus('CHANNEL_ERROR'))
    expect(result.current.connected).toBe(false)
    await act(async () => { vi.advanceTimersByTime(2_000) })
    await flush()
    expect(channels).toHaveLength(2)
    act(() => channels[1].emitStatus('TIMED_OUT'))
    await act(async () => { vi.advanceTimersByTime(6_000) })
    await flush()
    expect(channels).toHaveLength(3)
    act(() => channels[2].emitStatus('CHANNEL_ERROR'))
    await act(async () => { vi.advanceTimersByTime(60_000) })
    await flush()
    expect(channels).toHaveLength(3)
    warn.mockRestore()
  })

  it('閉じたらチャネルを外す', async () => {
    const { unmount } = renderHook(() => useDocVoteSignal({ meetingId: 'm1' }, vi.fn()))
    const ch = await subscribed()
    unmount()
    expect(mockRemoveChannel).toHaveBeenCalledWith(ch)
  })

  it('サーバーに閉じられたら（CLOSED）、つながっていない扱いにしてやり直す', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderHook(() => useDocVoteSignal({ meetingId: 'm1' }, vi.fn()))
    const ch = await subscribed()
    expect(result.current.connected).toBe(true)
    act(() => ch.emitStatus('CLOSED'))
    expect(result.current.connected).toBe(false)
    act(() => result.current.notify())
    expect(ch.send).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(2_000) })
    await flush()
    expect(channels).toHaveLength(2)
    warn.mockRestore()
  })

  it('つながるたびに1回読み直す（つなぐ前・切れていた間の票を拾う）', async () => {
    const onSignal = vi.fn()
    renderHook(() => useDocVoteSignal({ meetingId: 'm1' }, onSignal))
    await subscribed()
    expect(onSignal).toHaveBeenCalledTimes(1)
  })

  it('つながったらやり直しの回数を0に戻す（長い会議で何度切れてもやり直す）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderHook(() => useDocVoteSignal({ meetingId: 'm1' }, vi.fn()))
    for (let round = 0; round < 3; round += 1) {
      const ch = await subscribed()
      act(() => ch.emitStatus('CHANNEL_ERROR'))
      await act(async () => { vi.advanceTimersByTime(2_000) })
    }
    await flush()
    expect(channels).toHaveLength(4)
    warn.mockRestore()
  })

  it('同じ名前のチャネルが一覧に残っていたら、外してから作り直す（すぐ開き直したとき）', async () => {
    listed.push({ topic: 'realtime:wiki-page-view:w1' })
    const stale = listed[0]
    renderHook(() => useDocVoteSignal({ wikiPageId: 'w1' }, vi.fn()))
    await flush()
    expect(mockRemoveChannel).toHaveBeenCalledWith(stale)
    expect(channels).toHaveLength(1)
  })

  it('開いている文書が変わったら、古いチャネルを外して新しい方に入る', async () => {
    const { rerender } = renderHook(({ id }) => useDocVoteSignal({ wikiPageId: id }, vi.fn()), {
      initialProps: { id: 'w1' },
    })
    const first = await subscribed()
    rerender({ id: 'w2' })
    await flush()
    expect(mockRemoveChannel).toHaveBeenCalledWith(first)
    expect(channels[channels.length - 1].topic).toBe('wiki-page-view:w2')
  })

  it('鍵を待っている間に閉じたら、チャネルを作らない', async () => {
    let resolve: (v: { data: { session: { access_token: string } } }) => void = () => {}
    mockGetSession.mockImplementationOnce(() => new Promise((r) => { resolve = r }))
    const { unmount } = renderHook(() => useDocVoteSignal({ meetingId: 'm1' }, vi.fn()))
    unmount()
    await act(async () => {
      resolve({ data: { session: { access_token: 'jwt-self' } } })
    })
    await flush()
    expect(channels).toHaveLength(0)
  })
})

/**
 * 議事録が保存されたことの知らせ（DOC_VOTE_SPEC §6・PR4）。同じ文書のチャネルに相乗りする
 * （同じ名前のチャネルを2本開くと互いに閉じ合うので、道は1本のまま知らせの種類で振り分ける）。
 */
describe('議事録が保存された知らせ（minutes-saved）', () => {
  it('受けたら、その文書に登録した人を呼ぶ。票の読み直し（onSignal）は呼ばない', async () => {
    const onSignal = vi.fn()
    const onSaved = vi.fn()
    const off = onDocSignal('meeting-minutes-view:m1', 'minutes-saved', onSaved)
    renderHook(() => useDocVoteSignal({ meetingId: 'm1' }, onSignal))
    const ch = await subscribed()
    onSignal.mockClear()
    act(() => ch.emitBroadcast('minutes-saved'))
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(onSignal).not.toHaveBeenCalled()
    off()
    act(() => ch.emitBroadcast('minutes-saved'))
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('つながっているチャネルがあれば、その道で送る', async () => {
    renderHook(() => useDocVoteSignal({ meetingId: 'm1' }, vi.fn()))
    const ch = await subscribed()
    sendDocSignal('meeting-minutes-view:m1', 'minutes-saved')
    expect(ch.send).toHaveBeenCalledWith({ type: 'broadcast', event: 'minutes-saved', payload: {} })
  })

  it('つながっていなければ何もしない（画面を壊さない）', () => {
    expect(() => sendDocSignal('meeting-minutes-view:none', 'minutes-saved')).not.toThrow()
  })

  it('閉じたあとは送らない', async () => {
    const { unmount } = renderHook(() => useDocVoteSignal({ meetingId: 'm2' }, vi.fn()))
    const ch = await subscribed()
    unmount()
    sendDocSignal('meeting-minutes-view:m2', 'minutes-saved')
    expect(ch.send).not.toHaveBeenCalled()
  })
})

describe('差し込みの知らせと、同じ画面の中への知らせ', () => {
  it('insertion-changed を受けたら、その文書に登録した人を呼ぶ', async () => {
    const cb = vi.fn()
    const off = onDocSignal('meeting-minutes-view:m3', 'insertion-changed', cb)
    renderHook(() => useDocVoteSignal({ meetingId: 'm3' }, vi.fn()))
    const ch = await subscribed()
    act(() => ch.emitBroadcast('insertion-changed'))
    expect(cb).toHaveBeenCalledTimes(1)
    off()
  })

  it('送った知らせは、同じ画面の中で待っている人にも届く（つながっていなくても）', () => {
    const cb = vi.fn()
    const off = onDocSignal('meeting-minutes-view:local', 'minutes-saved', cb)
    sendDocSignal('meeting-minutes-view:local', 'minutes-saved')
    expect(cb).toHaveBeenCalledTimes(1)
    off()
  })
})
