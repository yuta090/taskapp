import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useTaskComments } from '@/lib/hooks/useTaskComments'

/**
 * 書き手のプロフィール（display_name）が読めなかったとき（DB 側で他の人のプロフィールを
 * 読める範囲を「一緒に仕事をしている人」に絞る変更の前でも後でも）、生の ID の一部
 * （actor_id.slice(0,8) + '...'）を出すのではなく、分かる一語にする。
 */

const commentRow = {
  id: 'c1',
  org_id: 'org-1',
  space_id: 'space-1',
  task_id: 'task-1',
  actor_id: 'ghost-user-id-0001',
  body: 'こんにちは',
  visibility: 'internal' as const,
  reply_to_id: null,
  created_at: '2026-01-01T00:00:00',
  updated_at: '2026-01-01T00:00:00',
  deleted_at: null,
}

// select().eq().eq().eq().is().order() のどこで await されても同じ結果を返す
// 自己再帰のチェーン可能な thenable
function makeCommentsQueryBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    order: () => builder,
    then: (resolve: (v: unknown) => void) => resolve(result),
  }
  return builder
}

let profilesResponse: { data: Array<{ id: string; display_name: string; avatar_url: string | null }> | null; error: unknown }

const mockFrom = vi.fn((table: string) => {
  if (table === 'task_comments') {
    return makeCommentsQueryBuilder({ data: [commentRow], error: null })
  }
  if (table === 'profiles') {
    return {
      select: () => ({
        in: () => Promise.resolve(profilesResponse),
      }),
    }
  }
  throw new Error(`unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      getUser: () => Promise.resolve({ data: { user: { id: 'me' } }, error: null }),
    },
  }),
}))

vi.mock('@/lib/slack/notify', () => ({ fireNotification: vi.fn() }))

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

beforeEach(() => {
  profilesResponse = { data: [], error: null }
})

describe('useTaskComments — 書き手のプロフィールが読めないときの表示', () => {
  it('プロフィールが見つからない書き手は、IDの一部ではなく分かる一語にする', async () => {
    const { result } = renderHook(
      () => useTaskComments({ orgId: 'org-1', spaceId: 'space-1', taskId: 'task-1' }),
      { wrapper: makeWrapper() }
    )

    await waitFor(() => expect(result.current.comments).toHaveLength(1))

    expect(result.current.comments[0].actor_name).toBe('（メンバー外）')
    expect(result.current.comments[0].actor_name).not.toContain(commentRow.actor_id.slice(0, 8))
  })

  it('プロフィールが見つかれば、これまでどおり表示名を使う', async () => {
    profilesResponse = {
      data: [{ id: commentRow.actor_id, display_name: 'テスト太郎', avatar_url: null }],
      error: null,
    }

    const { result } = renderHook(
      () => useTaskComments({ orgId: 'org-1', spaceId: 'space-1', taskId: 'task-1' }),
      { wrapper: makeWrapper() }
    )

    await waitFor(() => expect(result.current.comments).toHaveLength(1))

    expect(result.current.comments[0].actor_name).toBe('テスト太郎')
  })
})
