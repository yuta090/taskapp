import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

// 相手先ポータルで、会議中に社内が保存した議事録を読み直す（DOC_VOTE_SPEC §6.1）。
// - 5秒に1回まで。最後の知らせは必ず反映する
// - 取りに行っている間は重ねない（終わったらもう1回）。古い結果で上書きしない
// - 裏に回っている間は取りに行かず、表に戻ったら1回
// - つながった直後にも1回（つながる前・切れていた間の保存を拾う）

const listeners = new Map<string, () => void>()
vi.mock('@/lib/hooks/useDocVoteSignal', () => ({
  onDocSignal: (topic: string, event: string, cb: () => void) => {
    listeners.set(`${topic}|${event}`, cb)
    return () => listeners.delete(`${topic}|${event}`)
  },
}))

let resolvers: Array<(md: string) => void> = []
const fetchMinutes = vi.fn(() => new Promise<string>((r) => resolvers.push(r)))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { minutes_md: await fetchMinutes() }, error: null }),
        }),
      }),
    }),
  }),
}))

import { useLiveMinutes } from '@/lib/hooks/useLiveMinutes'

const saved = () => act(() => listeners.get('meeting-minutes-view:m1|minutes-saved')?.())
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve()
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  listeners.clear()
  resolvers = []
  fetchMinutes.mockClear()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => vi.useRealTimers())

describe('useLiveMinutes', () => {
  it('進行中でなければ待たない・取らない', () => {
    const { result } = renderHook(() => useLiveMinutes('m1', false, '初め'))
    expect(listeners.size).toBe(0)
    expect(result.current).toBe('初め')
  })

  it('知らせが来たら取りに行き、新しい本文を返す', async () => {
    const { result } = renderHook(() => useLiveMinutes('m1', true, '初め'))
    saved()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMinutes).toHaveBeenCalledTimes(1)
    await act(async () => { resolvers[0]('新しい') })
    await flush()
    expect(result.current).toBe('新しい')
  })

  it('続けて知らせが来ても5秒に1回まで。最後の知らせのあとにもう1回取る', async () => {
    renderHook(() => useLiveMinutes('m1', true, '初め'))
    saved()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { resolvers[0]('1') })
    await flush()
    saved(); saved(); saved()
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(fetchMinutes).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(4100) })
    expect(fetchMinutes).toHaveBeenCalledTimes(2)
  })

  it('取っている間に来た知らせは重ねず、終わってからもう1回取る', async () => {
    const { result } = renderHook(() => useLiveMinutes('m1', true, '初め'))
    saved()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    saved()
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(fetchMinutes).toHaveBeenCalledTimes(1)
    await act(async () => { resolvers[0]('古い') })
    await flush()
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(fetchMinutes).toHaveBeenCalledTimes(2)
    await act(async () => { resolvers[1]('最新') })
    await flush()
    expect(result.current).toBe('最新')
  })

  it('裏に回っている間は取らず、表に戻ったら1回取る', async () => {
    renderHook(() => useLiveMinutes('m1', true, '初め'))
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    saved()
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(fetchMinutes).not.toHaveBeenCalled()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMinutes).toHaveBeenCalledTimes(1)
  })

  it('つながった直後にも1回取る', async () => {
    renderHook(() => useLiveMinutes('m1', true, '初め'))
    act(() => listeners.get('meeting-minutes-view:m1|subscribed')?.())
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMinutes).toHaveBeenCalledTimes(1)
  })
})
