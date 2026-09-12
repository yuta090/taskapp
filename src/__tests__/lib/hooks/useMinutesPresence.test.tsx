import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMinutesPresence } from '@/lib/hooks/useMinutesPresence'

// 議事録を「いま誰が書いているか」を、同じ会議を開いている人どうしで見せ合う仕組み。
//
// - Realtime の presence（在席）を使う。DB 側のポリシーは private チャネルにしか効かない
//   ため、`private: true` を付け忘れると誰でも覗ける公開チャネルになってしまう。
// - ポリシーは「ログインした本人」にしか効かない。購読の前に本人の鍵（アクセストークン）を
//   取り、setAuth に**引数として**渡す。引数なしだと auth の初期化前は anon キーのままで、
//   本番では CHANNEL_ERROR になっていた。
// - 在席は「状態が変わったとき」だけ送る（打つたびに送らない）。
// - 失敗しても画面は壊さない・編集は止めない（console.warn だけで黙って諦める）。

type StatusCb = (status: string, err?: Error) => void

/** setAuth → subscribe の順番を確かめるための呼び出し記録 */
let order: string[] = []
let presenceState: Record<string, Array<Record<string, unknown>>> = {}
let channels: FakeChannel[] = []

interface FakeChannel {
  topic: string
  options: unknown
  on: ReturnType<typeof vi.fn>
  subscribe: ReturnType<typeof vi.fn>
  track: ReturnType<typeof vi.fn>
  untrack: ReturnType<typeof vi.fn>
  presenceState: ReturnType<typeof vi.fn>
  emitStatus: (status: string) => void
  emit: (key: string) => void
}

function createFakeChannel(topic: string, options: unknown): FakeChannel {
  const handlers = new Map<string, Array<() => void>>()
  let statusCb: StatusCb | undefined

  const channel: FakeChannel = {
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
    track: vi.fn(async () => 'ok'),
    untrack: vi.fn(async () => 'ok'),
    presenceState: vi.fn(() => presenceState),
    emitStatus: (status: string) => statusCb?.(status),
    emit: (key: string) => (handlers.get(key) ?? []).forEach((h) => h()),
  }
  return channel
}

const mockChannel = vi.fn((topic: string, options: unknown) => {
  const channel = createFakeChannel(topic, options)
  channels.push(channel)
  return channel
})
const mockRemoveChannel = vi.fn()
const mockSetAuth = vi.fn(async (token?: string | null) => {
  order.push('setAuth')
  return token
})

type FakeSession = { access_token: string } | null
const mockGetSession = vi.fn(
  async (): Promise<{ data: { session: FakeSession }; error: null }> => ({
    data: { session: { access_token: 'jwt-self' } },
    error: null,
  })
)

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: (topic: string, options: unknown) => mockChannel(topic, options),
    removeChannel: (channel: unknown) => mockRemoveChannel(channel),
    auth: { getSession: () => mockGetSession() },
    realtime: { setAuth: (token?: string | null) => mockSetAuth(token) },
  }),
}))

const SELF = { userId: 'u-self', name: '自分' }

function renderPresence(overrides: Partial<Parameters<typeof useMinutesPresence>[0]> = {}) {
  return renderHook(() =>
    useMinutesPresence({ meetingId: 'm1', enabled: true, self: SELF, ...overrides })
  )
}

/** 鍵の取得 → setAuth → subscribe まで（await の連鎖）を進める */
async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
  })
}

/** 購読が始まり SUBSCRIBED になるところまで進める */
async function subscribed(): Promise<FakeChannel> {
  await flush()
  const channel = channels[0]
  await act(async () => {
    channel.emitStatus('SUBSCRIBED')
    await Promise.resolve()
  })
  return channel
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  order = []
  presenceState = {}
  channels = []
  setVisibility('visible')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useMinutesPresence 購読するかどうか', () => {
  it('enabled が false のときは購読しない（閲覧だけの人・相手先）', async () => {
    renderPresence({ enabled: false })
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockSetAuth).not.toHaveBeenCalled()
    expect(mockChannel).not.toHaveBeenCalled()
  })

  it('自分のユーザーIDが分からないうちは購読しない', async () => {
    renderPresence({ self: { userId: '', name: '' } })
    await act(async () => {
      await Promise.resolve()
    })
    expect(mockChannel).not.toHaveBeenCalled()
  })

  it('購読の前に setAuth を呼ぶ（private チャネルの鍵を渡し直す保険）', async () => {
    renderPresence()
    await subscribed()
    expect(mockSetAuth).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['setAuth', 'subscribe'])
  })

  it('private: true と presence の key（自分のユーザーID）を渡す', async () => {
    renderPresence()
    await subscribed()
    expect(mockChannel).toHaveBeenCalledWith('meeting-minutes:m1', {
      config: { private: true, presence: { key: 'u-self' } },
    })
  })
})

describe('useMinutesPresence 本人の鍵を渡す', () => {
  it('自分のアクセストークンを取り、setAuth に引数として渡す', async () => {
    renderPresence()
    await subscribed()

    expect(mockGetSession).toHaveBeenCalledTimes(1)
    expect(mockSetAuth).toHaveBeenCalledWith('jwt-self')
    expect(order).toEqual(['setAuth', 'subscribe'])
  })

  it('鍵が取れないときは、つなぎに行かない（anon では必ず失敗するため）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockGetSession.mockResolvedValueOnce({ data: { session: null }, error: null })

    const { result } = renderPresence()
    await flush()

    expect(mockSetAuth).not.toHaveBeenCalled()
    expect(mockChannel).not.toHaveBeenCalled()
    expect(result.current.others).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('鍵の取得で例外が出ても画面は壊さない（つなぎには行かない）', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockGetSession.mockRejectedValueOnce(new Error('boom'))

    const { result } = renderPresence()
    await flush()

    expect(mockChannel).not.toHaveBeenCalled()
    expect(result.current.others).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('useMinutesPresence つながらなかったときのやり直し', () => {
  /** つながらない状態を1回起こす */
  async function failOnce(index: number) {
    await act(async () => {
      channels[index].emitStatus('CHANNEL_ERROR')
      await Promise.resolve()
    })
  }

  /** 待ち時間を進めて、やり直しの購読を始めさせる */
  async function waitRetry(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
    await flush()
  }

  it('2秒後にやり直し、2回目でつながれば在席を送る', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderPresence()
    await flush()
    expect(mockChannel).toHaveBeenCalledTimes(1)

    await failOnce(0)
    expect(mockChannel).toHaveBeenCalledTimes(1)

    await waitRetry(2_000)

    // 古いチャネルを片付けてから、鍵を取り直してつなぎ直す
    expect(mockRemoveChannel).toHaveBeenCalledWith(channels[0])
    expect(mockChannel).toHaveBeenCalledTimes(2)
    expect(mockGetSession).toHaveBeenCalledTimes(2)
    expect(mockSetAuth).toHaveBeenLastCalledWith('jwt-self')

    await act(async () => {
      channels[1].emitStatus('SUBSCRIBED')
      await Promise.resolve()
    })
    expect(channels[1].track).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('3回つながらなかったら、それ以上やり直さない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderPresence()
    await flush()

    await failOnce(0)
    await waitRetry(2_000)
    expect(mockChannel).toHaveBeenCalledTimes(2)

    await failOnce(1)
    await waitRetry(6_000)
    expect(mockChannel).toHaveBeenCalledTimes(3)

    await failOnce(2)
    await waitRetry(60_000)
    expect(mockChannel).toHaveBeenCalledTimes(3)

    // 諦めたことが分かる記録を残す
    expect(warn.mock.calls.some((call) => String(call[0]).includes('諦め'))).toBe(true)
    warn.mockRestore()
  })

  it('アンマウントすると、待っているやり直しは走らない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { unmount } = renderPresence()
    await flush()
    await failOnce(0)

    await act(async () => {
      unmount()
      await Promise.resolve()
    })
    await waitRetry(10_000)

    expect(mockChannel).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('ページを離れても、待っているやり直しは走らない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderPresence()
    await flush()
    await failOnce(0)

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
      await Promise.resolve()
    })
    await waitRetry(10_000)

    expect(mockChannel).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})

describe('useMinutesPresence 在席を送るのは状態が変わったときだけ', () => {
  it('購読できたら1回だけ送り、同じ状態では送り直さない', async () => {
    const { result } = renderPresence()
    const channel = await subscribed()

    expect(channel.track).toHaveBeenCalledTimes(1)
    expect(channel.track.mock.calls[0][0]).toMatchObject({
      user_id: 'u-self',
      name: '自分',
      editing: false,
    })

    // 書いていない状態のまま false を伝えても送り直さない
    await act(async () => {
      result.current.setEditing(false)
      await Promise.resolve()
    })
    expect(channel.track).toHaveBeenCalledTimes(1)
  })

  it('書き始めたら送り、打ち続けても送り直さない。やめたらもう一度だけ送る', async () => {
    const { result } = renderPresence()
    const channel = await subscribed()

    await act(async () => {
      result.current.setEditing(true)
      await Promise.resolve()
    })
    expect(channel.track).toHaveBeenCalledTimes(2)
    expect(channel.track.mock.calls[1][0]).toMatchObject({ editing: true })

    await act(async () => {
      result.current.setEditing(true)
      result.current.setEditing(true)
      await Promise.resolve()
    })
    expect(channel.track).toHaveBeenCalledTimes(2)

    await act(async () => {
      result.current.setEditing(false)
      await Promise.resolve()
    })
    expect(channel.track).toHaveBeenCalledTimes(3)
    expect(channel.track.mock.calls[2][0]).toMatchObject({ editing: false })
  })

  it('送る内容の時刻は表示に使わない数値（toISOString は使わない）', async () => {
    const { result } = renderPresence()
    const channel = await subscribed()
    await act(async () => {
      result.current.setEditing(true)
      await Promise.resolve()
    })
    const payload = channel.track.mock.calls[1][0] as { since: unknown }
    expect(typeof payload.since).toBe('number')
  })
})

describe('useMinutesPresence 書くのをやめたと見なす条件', () => {
  it('60秒なにもしなければ「書いています」を下ろす', async () => {
    const { result } = renderPresence()
    const channel = await subscribed()

    await act(async () => {
      result.current.setEditing(true)
      await Promise.resolve()
    })
    expect(channel.track).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(59_000)
    })
    expect(channel.track).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(channel.track).toHaveBeenCalledTimes(3)
    expect(channel.track.mock.calls[2][0]).toMatchObject({ editing: false })
  })

  it('打ち続けている間は60秒で下ろさない（数え直す）', async () => {
    const { result } = renderPresence()
    const channel = await subscribed()

    await act(async () => {
      result.current.setEditing(true)
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50_000)
      result.current.setEditing(true)
      await vi.advanceTimersByTimeAsync(50_000)
    })
    expect(channel.track).toHaveBeenCalledTimes(2)
  })

  it('タブが隠れたら「書いています」を下ろす', async () => {
    const { result } = renderPresence()
    const channel = await subscribed()

    await act(async () => {
      result.current.setEditing(true)
      await Promise.resolve()
    })
    expect(channel.track).toHaveBeenCalledTimes(2)

    await act(async () => {
      setVisibility('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(channel.track).toHaveBeenCalledTimes(3)
    expect(channel.track.mock.calls[2][0]).toMatchObject({ editing: false })
  })
})

describe('useMinutesPresence 後始末', () => {
  it('アンマウントしたら untrack して removeChannel する', async () => {
    const { unmount } = renderPresence()
    const channel = await subscribed()

    await act(async () => {
      unmount()
      await Promise.resolve()
    })

    expect(channel.untrack).toHaveBeenCalledTimes(1)
    expect(mockRemoveChannel).toHaveBeenCalledWith(channel)
  })

  it('ページを離れるとき(pagehide)も untrack して removeChannel する', async () => {
    renderPresence()
    const channel = await subscribed()

    await act(async () => {
      window.dispatchEvent(new Event('pagehide'))
      await Promise.resolve()
    })

    expect(channel.untrack).toHaveBeenCalledTimes(1)
    expect(mockRemoveChannel).toHaveBeenCalledWith(channel)
  })

  it('enabled が false に変わったら後始末する', async () => {
    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useMinutesPresence({ meetingId: 'm1', enabled, self: SELF }),
      { initialProps: { enabled: true } }
    )
    const channel = await subscribed()

    await act(async () => {
      rerender({ enabled: false })
      await Promise.resolve()
    })
    expect(mockRemoveChannel).toHaveBeenCalledWith(channel)
  })
})

describe('useMinutesPresence 失敗しても画面を壊さない', () => {
  it('CHANNEL_ERROR を受けても例外にならず、在席は空のまま', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderPresence()
    await flush()

    await act(async () => {
      channels[0].emitStatus('CHANNEL_ERROR')
      await Promise.resolve()
    })

    expect(result.current.others).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('TIMED_OUT でも例外にならない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderPresence()
    await flush()
    await act(async () => {
      channels[0].emitStatus('TIMED_OUT')
      await Promise.resolve()
    })
    expect(result.current.others).toEqual([])
    warn.mockRestore()
  })

  it('チャネルを作るところで例外が出ても、呼び出し側には投げない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockChannel.mockImplementationOnce(() => {
      throw new Error('boom')
    })

    const { result } = renderPresence()
    await flush()

    expect(result.current.others).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('setEditing は購読できていなくても例外にならない', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = renderPresence({ enabled: false })
    await act(async () => {
      result.current.setEditing(true)
      await Promise.resolve()
    })
    expect(result.current.others).toEqual([])
    warn.mockRestore()
  })
})

describe('useMinutesPresence 在席の一覧', () => {
  it('自分は others に入れない。ほかの人は名前と editing で返す', async () => {
    const { result } = renderPresence()
    const channel = await subscribed()

    presenceState = {
      'u-self': [{ presence_ref: 'r0', user_id: 'u-self', name: '自分', editing: true }],
      'u-a': [{ presence_ref: 'r1', user_id: 'u-a', name: '佐藤', editing: true }],
      'u-b': [{ presence_ref: 'r2', user_id: 'u-b', name: '鈴木', editing: false }],
    }

    await act(async () => {
      channel.emit('presence:sync')
      await Promise.resolve()
    })

    expect(result.current.others).toEqual([
      { userId: 'u-a', name: '佐藤', editing: true },
      { userId: 'u-b', name: '鈴木', editing: false },
    ])
  })

  it('join / leave でも一覧を作り直す', async () => {
    const { result } = renderPresence()
    const channel = await subscribed()

    presenceState = {
      'u-a': [{ presence_ref: 'r1', user_id: 'u-a', name: '佐藤', editing: true }],
    }
    await act(async () => {
      channel.emit('presence:join')
      await Promise.resolve()
    })
    expect(result.current.others).toHaveLength(1)

    presenceState = {}
    await act(async () => {
      channel.emit('presence:leave')
      await Promise.resolve()
    })
    expect(result.current.others).toEqual([])
  })

  it('名前が空なら「メンバー」として返す', async () => {
    const { result } = renderPresence()
    const channel = await subscribed()

    presenceState = {
      'u-a': [{ presence_ref: 'r1', user_id: 'u-a', editing: true }],
    }
    await act(async () => {
      channel.emit('presence:sync')
      await Promise.resolve()
    })

    expect(result.current.others).toEqual([{ userId: 'u-a', name: 'メンバー', editing: true }])
  })

  it('同じ在席が続いたら others の中身を作り直さない（余計な再描画を起こさない）', async () => {
    const { result } = renderPresence()
    const channel = await subscribed()

    presenceState = {
      'u-a': [{ presence_ref: 'r1', user_id: 'u-a', name: '佐藤', editing: true }],
    }
    await act(async () => {
      channel.emit('presence:sync')
      await Promise.resolve()
    })
    const first = result.current.others

    await act(async () => {
      channel.emit('presence:sync')
      await Promise.resolve()
    })
    expect(result.current.others).toBe(first)
  })
})
