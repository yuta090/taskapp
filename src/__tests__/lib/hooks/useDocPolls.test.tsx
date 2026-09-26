import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { DocPollState } from '@/lib/doc-polls/types'

const fetchDocPolls = vi.fn()
const castDocVote = vi.fn()
const createDocPoll = vi.fn()
vi.mock('@/lib/doc-polls/api', () => ({
  fetchDocPolls: (...a: unknown[]) => fetchDocPolls(...a),
  castDocVote: (...a: unknown[]) => castDocVote(...a),
  createDocPoll: (...a: unknown[]) => createDocPoll(...a),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

import { useDocPolls, usePrefetchDocPolls } from '@/lib/hooks/useDocPolls'

const state = (): Record<string, DocPollState> => ({
  p1: {
    poll: {
      id: 'p1', org_id: 'o', space_id: 's', wiki_page_id: 'w1', meeting_id: null,
      reason_required: 'none', created_by: 'u', created_at: 't',
    },
    votes: [],
    events: [],
  },
})

function wrapper(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
  return Wrapper
}

beforeEach(() => {
  fetchDocPolls.mockReset()
  castDocVote.mockReset()
  createDocPoll.mockReset()
})

describe('useDocPolls', () => {
  it('その Wiki ページの投票を読む', async () => {
    fetchDocPolls.mockResolvedValue(state())
    const { result } = renderHook(() => useDocPolls({ wikiPageId: 'w1' }), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isFetched).toBe(true))
    expect(fetchDocPolls).toHaveBeenCalledWith(expect.anything(), { wikiPageId: 'w1' })
    expect(result.current.polls.p1).toBeTruthy()
  })

  it('文書が決まっていなければ読まない', () => {
    renderHook(() => useDocPolls(null), { wrapper: wrapper() })
    expect(fetchDocPolls).not.toHaveBeenCalled()
  })

  it('押すと返事を待たずに票が画面に出る', async () => {
    fetchDocPolls.mockResolvedValue(state())
    let resolveCast: () => void = () => {}
    castDocVote.mockImplementation(() => new Promise<void>((r) => { resolveCast = r }))
    const { result } = renderHook(() => useDocPolls({ wikiPageId: 'w1' }), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isFetched).toBe(true))

    let pending: Promise<void> = Promise.resolve()
    act(() => {
      pending = result.current.castVote({ pollId: 'p1', userId: 'me', choice: 'ok', memo: '' })
    })
    await waitFor(() => expect(result.current.polls.p1.votes.map((v) => v.user_id)).toEqual(['me']))
    await act(async () => {
      resolveCast()
      await pending
    })
    expect(castDocVote).toHaveBeenCalledWith(expect.anything(), { pollId: 'p1', choice: 'ok', memo: '' })
  })

  it('失敗したら元に戻して投げる', async () => {
    fetchDocPolls.mockResolvedValue(state())
    castDocVote.mockRejectedValue({ code: '22023', message: 'reason_required' })
    const { result } = renderHook(() => useDocPolls({ wikiPageId: 'w1' }), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isFetched).toBe(true))
    await act(async () => {
      await expect(
        result.current.castVote({ pollId: 'p1', userId: 'me', choice: 'ng', memo: '' })
      ).rejects.toMatchObject({ message: 'reason_required' })
    })
    expect(result.current.polls.p1.votes).toEqual([])
  })

  it('投票を作ると読み直す', async () => {
    fetchDocPolls.mockResolvedValue({})
    createDocPoll.mockResolvedValue(undefined)
    const { result } = renderHook(() => useDocPolls({ wikiPageId: 'w1' }), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isFetched).toBe(true))
    await act(async () => {
      await result.current.createPoll('p9', 'ng_hold')
    })
    expect(createDocPoll).toHaveBeenCalledWith(expect.anything(), {
      pollId: 'p9',
      source: { wikiPageId: 'w1' },
      reasonRequired: 'ng_hold',
    })
    await waitFor(() => expect(fetchDocPolls).toHaveBeenCalledTimes(2))
  })
})

describe('usePrefetchDocPolls', () => {
  it('本文を待たずに先に読み、あとから使う側は読み直さずにその結果を使う', async () => {
    fetchDocPolls.mockResolvedValue(state())
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    renderHook(() => usePrefetchDocPolls({ wikiPageId: 'w1' }), { wrapper: wrapper(qc) })
    await waitFor(() => expect(fetchDocPolls).toHaveBeenCalledTimes(1))
    const { result } = renderHook(() => useDocPolls({ wikiPageId: 'w1' }), { wrapper: wrapper(qc) })
    await waitFor(() => expect(result.current.polls.p1).toBeTruthy())
    expect(fetchDocPolls).toHaveBeenCalledTimes(1)
  })

  it('ページが決まっていなければ読まない', () => {
    renderHook(() => usePrefetchDocPolls(null), { wrapper: wrapper() })
    expect(fetchDocPolls).not.toHaveBeenCalled()
  })
})

describe('useDocPolls の関数', () => {
  it('呼ぶ側が毎回新しい source を渡しても、作る関数は作り直さない', async () => {
    fetchDocPolls.mockResolvedValue({})
    const { result, rerender } = renderHook(() => useDocPolls({ wikiPageId: 'w1' }), { wrapper: wrapper() })
    const first = result.current.createPoll
    rerender()
    expect(result.current.createPoll).toBe(first)
  })
})

describe('useDocPolls の送る順番', () => {
  it('同じ投票への送信は、前の返事を待ってから次を送る（届く順番を押した順にする）', async () => {
    fetchDocPolls.mockResolvedValue(state())
    const resolvers: Array<() => void> = []
    castDocVote.mockImplementation(() => new Promise<void>((r) => resolvers.push(r)))
    const { result } = renderHook(() => useDocPolls({ wikiPageId: 'w1' }), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isFetched).toBe(true))

    let p1: Promise<void> = Promise.resolve()
    let p2: Promise<void> = Promise.resolve()
    act(() => {
      p1 = result.current.castVote({ pollId: 'p1', userId: 'me', choice: 'ok', memo: '' })
    })
    act(() => {
      p2 = result.current.castVote({ pollId: 'p1', userId: 'me', choice: 'ng', memo: '' })
    })
    await waitFor(() => expect(castDocVote).toHaveBeenCalledTimes(1))
    // 画面は最後に押したものを見せる
    await waitFor(() => expect(result.current.polls.p1.votes[0]?.choice).toBe('ng'))
    await act(async () => {
      resolvers[0]()
      await p1
    })
    await waitFor(() => expect(castDocVote).toHaveBeenCalledTimes(2))
    expect(castDocVote.mock.calls[1][1]).toMatchObject({ choice: 'ng' })
    await act(async () => {
      resolvers[1]()
      await p2
    })
  })
})
