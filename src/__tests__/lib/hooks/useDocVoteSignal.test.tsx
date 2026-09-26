import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDocVoteSignal } from '@/lib/hooks/useDocVoteSignal'

// 投票の「票が変わった」合図（DOC_VOTE_SPEC §6）。
// - 合図だけを送る private チャネル。本文も票も運ばない（受けた側が読み直す）
// - private のポリシーは本人にしか効かないので、購読の前に本人の鍵を setAuth に引数で渡す
// - つながらなくても画面は壊さない。2回までやり直して諦める（読み直しは今までどおり）

type StatusCb = (status: string) => void

let order: string[] = []
let channels: FakeChannel[] = []

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

const mockRemoveChannel = vi.fn()
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
      return ch
    },
    removeChannel: (ch: unknown) => mockRemoveChannel(ch),
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
})
