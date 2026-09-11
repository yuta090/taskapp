import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWikiPages } from '@/lib/hooks/useWikiPages'

// Wiki が空のときの自動作成（ホームページ＋仕様書テンプレート）は、読み取りのついでに
// 書き込みが走る副作用のため、編集できる人（canEdit=true）だけに限る。既定は false（安全側）で、
// 書ける場面（WikiPageClient・タスク詳細の onUpdate あり）だけが明示で true を渡す。

const mockGetUser = vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }))
const insertCalls: Array<{ table: string; payload: unknown }> = []

/** `.select().eq().eq().order()` / `.select().eq().eq().single()` チェーンの偽DB。 */
function makeFrom() {
  return vi.fn((table: string) => ({
    select: () => {
      const chain = {
        eq: () => chain,
        order: () => Promise.resolve({ data: [], error: null }), // wiki_pages 一覧は常に空
        single: () =>
          table === 'spaces'
            ? Promise.resolve({ data: { preset_genre: null }, error: null })
            : Promise.resolve({ data: null, error: null }),
      }
      return chain
    },
    insert: (payload: unknown) => {
      insertCalls.push({ table, payload })
      return {
        select: () => ({
          single: () => Promise.resolve({ data: { id: 'new-page', title: 'ホーム' }, error: null }),
          then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
            resolve({ data: [{ id: 'spec-1', title: '仕様書' }], error: null }),
        }),
      }
    },
  }))
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: makeFrom(), auth: { getUser: mockGetUser } }),
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  insertCalls.length = 0
})

describe('useWikiPages — 空のWikiの自動作成', () => {
  it('canEdit=false のときは、空のWikiでも何も作成しない（書き込みが0件）', async () => {
    const { result } = renderHook(
      () => useWikiPages({ orgId: 'org1', spaceId: 'space1', canEdit: false }),
      { wrapper: createWrapper() }
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(insertCalls).toHaveLength(0)
    expect(result.current.pages).toEqual([])
  })

  it('canEdit を渡さない（既定）ときも作成しない（安全側。渡す側が明示で true にする）', async () => {
    const { result } = renderHook(
      () => useWikiPages({ orgId: 'org1', spaceId: 'space1' }),
      { wrapper: createWrapper() }
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(insertCalls).toHaveLength(0)
  })

  it('canEdit=true を明示したときは、空のWikiにホームページ等を自動作成する', async () => {
    const { result } = renderHook(
      () => useWikiPages({ orgId: 'org1', spaceId: 'space1', canEdit: true }),
      { wrapper: createWrapper() }
    )
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(insertCalls.length).toBeGreaterThan(0)
  })
})
