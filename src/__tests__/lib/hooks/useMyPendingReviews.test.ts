import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMyPendingReviews, myPendingReviewsQueryKey } from '@/lib/hooks/useMyPendingReviews'

/**
 * 自分が社内承認を頼まれていて、まだ返事をしていないタスク（「あなたの承認待ち」の印を付ける先）。
 * 承認者の行（review_approvals）から、自分・保留中・依頼が開いているものだけを読む。
 */

type Call = [string, ...unknown[]]

const state = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  tables: [] as string[],
  result: { data: [] as unknown, error: null as unknown },
  user: { id: 'me' } as { id: string } | null,
}))

function makeBuilder() {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'is', 'in', 'order', 'limit']) {
    builder[method] = (...args: unknown[]) => {
      state.calls.push([method, ...args])
      return builder
    }
  }
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(state.result).then(resolve, reject)
  return builder
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      state.tables.push(table)
      return makeBuilder()
    },
  }),
}))

vi.mock('@/lib/supabase/cached-auth', () => ({
  getCachedUser: async () => ({ user: state.user, error: null }),
}))

let queryClient: QueryClient

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: queryClient }, children)
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  state.calls = []
  state.tables = []
  state.result = { data: [], error: null }
  state.user = { id: 'me' }
})

describe('useMyPendingReviews', () => {
  it('自分が承認を頼まれていて、まだ返事をしていないタスクのIDを返す', async () => {
    state.result = {
      data: [{ reviews: { task_id: 't1', status: 'open' } }, { reviews: { task_id: 't2', status: 'open' } }],
      error: null,
    }
    const { result } = renderHook(() => useMyPendingReviews('org-1'), { wrapper })

    await waitFor(() => expect(result.current.taskIds.size).toBe(2))
    expect(result.current.taskIds.has('t1')).toBe(true)
    expect(result.current.taskIds.has('t2')).toBe(true)
  })

  it('自分の保留中の承認だけを、依頼が開いているものに絞り、組織で絞って読む', async () => {
    const { result } = renderHook(() => useMyPendingReviews('org-1'), { wrapper })
    await waitFor(() => expect(state.tables).toEqual(['review_approvals']))
    await waitFor(() => expect(result.current.taskIds.size).toBe(0))

    const calls: Call[] = state.calls
    expect(calls).toContainEqual(['select', 'reviews!inner(task_id, status)'])
    expect(calls).toContainEqual(['eq', 'reviewer_id', 'me'])
    expect(calls).toContainEqual(['eq', 'state', 'pending'])
    expect(calls).toContainEqual(['eq', 'reviews.status', 'open'])
    expect(calls).toContainEqual(['eq', 'org_id', 'org-1'])
  })

  it('埋め込みが配列で返っても読める', async () => {
    state.result = { data: [{ reviews: [{ task_id: 't3', status: 'open' }] }], error: null }
    const { result } = renderHook(() => useMyPendingReviews('org-1'), { wrapper })

    await waitFor(() => expect(result.current.taskIds.has('t3')).toBe(true))
  })

  it('ログインしていなければ空で、問い合わせもしない', async () => {
    state.user = null
    const { result } = renderHook(() => useMyPendingReviews('org-1'), { wrapper })

    await waitFor(() => expect(queryClient.getQueryState(myPendingReviewsQueryKey('org-1'))?.status).toBe('success'))
    expect(result.current.taskIds.size).toBe(0)
    expect(state.tables).toEqual([])
  })

  it('一覧を開き直すたびに取り直す（受信トレイなど別の画面で承認したあと、古い印を残さない）', async () => {
    state.result = { data: [{ reviews: { task_id: 't1', status: 'open' } }], error: null }
    const first = renderHook(() => useMyPendingReviews('org-1'), { wrapper })
    await waitFor(() => expect(first.result.current.taskIds.has('t1')).toBe(true))
    first.unmount()

    // 受信トレイで承認した（もう自分の番ではない）
    state.result = { data: [], error: null }
    const second = renderHook(() => useMyPendingReviews('org-1'), { wrapper })

    await waitFor(() => expect(second.result.current.taskIds.size).toBe(0))
    expect(state.tables).toEqual(['review_approvals', 'review_approvals'])
  })

  it('キャッシュのキーは組織ごと（承認を返したら ["myPendingReviews"] でまとめて取り直せる）', () => {
    expect(myPendingReviewsQueryKey('org-1')).toEqual(['myPendingReviews', 'org-1'])
    expect(myPendingReviewsQueryKey(null)).toEqual(['myPendingReviews', null])
  })
})
