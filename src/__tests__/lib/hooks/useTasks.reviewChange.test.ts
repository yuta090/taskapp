import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useTasks } from '@/lib/hooks/useTasks'

/**
 * タスクの詳細で承認・差し戻し・依頼・取り消しをしたら（handleReviewChange）、一覧の
 * 「あなたの承認待ち」も取り直す。承認者が複数いると依頼の状態は open のままなので、一覧の状態だけでは消えない。
 */

vi.mock('@/lib/supabase/rpc', () => ({ rpc: {} }))
vi.mock('@/lib/supabase/queries', () => ({
  fetchTasksQuery: vi.fn(async () => ({ tasks: [], owners: {}, reviewStatuses: { t1: 'open' } })),
}))
vi.mock('@/lib/slack/notify', () => ({ fireNotification: vi.fn() }))
vi.mock('@/lib/notifications/email-approval', () => ({ fireApprovalEmail: vi.fn() }))
vi.mock('@/lib/audit', () => ({
  createAuditLog: vi.fn(async () => {}),
  generateAuditSummary: vi.fn(() => 'summary'),
}))
vi.mock('@/lib/supabase/cached-auth', () => ({
  getCachedUser: vi.fn(async () => ({ user: { id: 'user-1' }, error: null })),
  getCachedUserId: vi.fn(async () => 'user-1'),
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: vi.fn() }),
}))

let queryClient: QueryClient

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: queryClient }, children)
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

describe('useTasks.handleReviewChange', () => {
  it('一覧の承認の状態を書き換え、「あなたの承認待ち」を取り直す', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useTasks({ orgId: 'org-1', spaceId: 'space-1' }), { wrapper })
    await waitFor(() => expect(result.current.reviewStatuses).toEqual({ t1: 'open' }))

    act(() => result.current.handleReviewChange('t1', 'approved'))

    await waitFor(() => expect(result.current.reviewStatuses).toEqual({ t1: 'approved' }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['myPendingReviews'] })
  })
})

/**
 * 承認で書き換えるのは該当タスクの行だけなので、このプロジェクトの「取得時刻」は動かさない。
 * 動かすと、前日の永続キャッシュが「今取れたばかり」に見え、マイタスク側の新旧判定
 * （recentEnough）と裏の取り直しが飛んで、古い一覧が出たままになる。
 */
describe('useTasks.handleReviewChange — 取得時刻は据え置く', () => {
  it('行だけ書き換えても dataUpdatedAt は変わらない', async () => {
    const { result } = renderHook(() => useTasks({ orgId: 'org-1', spaceId: 'space-1' }), { wrapper })
    await waitFor(() => expect(result.current.reviewStatuses).toEqual({ t1: 'open' }))

    const key = ['tasks', 'org-1', 'space-1']
    const before = queryClient.getQueryState(key)?.dataUpdatedAt
    expect(before).toBeTruthy()

    // 1ミリ秒でも進めば「今」に更新されたと分かる
    await new Promise((r) => setTimeout(r, 5))
    act(() => result.current.handleReviewChange('t1', 'approved', true))

    await waitFor(() => expect(result.current.reviewStatuses).toEqual({ t1: 'approved' }))
    expect(queryClient.getQueryState(key)?.dataUpdatedAt).toBe(before)
  })
})
