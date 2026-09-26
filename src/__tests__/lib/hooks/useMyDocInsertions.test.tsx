import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const fetchDocInsertions = vi.fn()
const createDocInsertion = vi.fn()
const withdrawDocInsertion = vi.fn()
vi.mock('@/lib/doc-insertions/api', () => ({
  fetchDocInsertions: (...a: unknown[]) => fetchDocInsertions(...a),
  createDocInsertion: (...a: unknown[]) => createDocInsertion(...a),
  withdrawDocInsertion: (...a: unknown[]) => withdrawDocInsertion(...a),
}))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))
const listeners = new Map<string, () => void>()
const sent: string[] = []
vi.mock('@/lib/hooks/useDocVoteSignal', () => ({
  onDocSignal: (topic: string, event: string, cb: () => void) => {
    listeners.set(`${topic}|${event}`, cb)
    return () => listeners.delete(`${topic}|${event}`)
  },
  sendDocSignal: (topic: string, event: string) => sent.push(`${topic}|${event}`),
}))

import { useMyDocInsertions } from '@/lib/hooks/useMyDocInsertions'

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

beforeEach(() => {
  fetchDocInsertions.mockReset().mockResolvedValue([])
  createDocInsertion.mockReset().mockResolvedValue('i1')
  withdrawDocInsertion.mockReset().mockResolvedValue(undefined)
  listeners.clear()
  sent.length = 0
})

describe('useMyDocInsertions（ポータルの自分の差し込み）', () => {
  it('自分の差し込み（反映待ち・反映済み・削除依頼）を読む', async () => {
    renderHook(() => useMyDocInsertions('m1'), { wrapper: wrapper() })
    await waitFor(() =>
      expect(fetchDocInsertions).toHaveBeenCalledWith(expect.anything(), { meetingId: 'm1' }, ['pending', 'applied', 'remove_requested'])
    )
  })

  it('作ったら社内の画面に知らせ、読み直す', async () => {
    const { result } = renderHook(() => useMyDocInsertions('m1'), { wrapper: wrapper() })
    await waitFor(() => expect(fetchDocInsertions).toHaveBeenCalledTimes(1))
    await act(async () => {
      await result.current.create('meeting_note', '予算', '決めたこと')
    })
    expect(createDocInsertion).toHaveBeenCalledWith(expect.anything(), {
      source: { meetingId: 'm1' }, kind: 'meeting_note', content: '予算', anchor: '決めたこと',
    })
    expect(sent).toContain('meeting-minutes-view:m1|insertion-changed')
    await waitFor(() => expect(fetchDocInsertions).toHaveBeenCalledTimes(2))
  })

  it('取り下げも知らせる', async () => {
    const { result } = renderHook(() => useMyDocInsertions('m1'), { wrapper: wrapper() })
    await act(async () => {
      await result.current.withdraw('i1')
    })
    expect(withdrawDocInsertion).toHaveBeenCalledWith(expect.anything(), 'i1')
    expect(sent).toContain('meeting-minutes-view:m1|insertion-changed')
  })

  it('社内が反映した・保存したの知らせで読み直す', async () => {
    renderHook(() => useMyDocInsertions('m1'), { wrapper: wrapper() })
    await waitFor(() => expect(fetchDocInsertions).toHaveBeenCalledTimes(1))
    await act(async () => {
      listeners.get('meeting-minutes-view:m1|insertion-changed')?.()
    })
    await waitFor(() => expect(fetchDocInsertions).toHaveBeenCalledTimes(2))
  })

  it('会議が決まっていなければ読まない', () => {
    renderHook(() => useMyDocInsertions(null), { wrapper: wrapper() })
    expect(fetchDocInsertions).not.toHaveBeenCalled()
  })
})
