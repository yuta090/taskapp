import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRecentTaskComments } from '@/lib/hooks/useRecentTaskComments'

/**
 * ダッシュボードの「最近のコメント」の取得。
 * 取得の条件は索引 idx_task_comments_space_recent（space_id, created_at desc・deleted_at is null）と
 * 揃っている必要があるので、条件そのものをテストで固定する。
 */

// select().eq().is().order().limit() の呼び出しを記録し、await されたら response を返す
const calls: unknown[][] = []
let response: { data: unknown; error: unknown } = { data: [], error: null }

function makeBuilder() {
  const builder: Record<string, unknown> = {}
  for (const name of ['select', 'eq', 'is', 'order', 'limit']) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, ...args])
      return builder
    }
  }
  builder.then = (resolve: (v: unknown) => void) => resolve(response)
  return builder
}

const mockFrom = vi.fn((table: string) => {
  calls.push(['from', table])
  return makeBuilder()
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return React.createElement(QueryClientProvider, { client: queryClient }, children)
}

beforeEach(() => {
  calls.length = 0
  mockFrom.mockClear()
  response = { data: [], error: null }
})

describe('useRecentTaskComments', () => {
  it('その space の、消していないコメントを新しい順に100件読む', async () => {
    const { result } = renderHook(() => useRecentTaskComments('space-1', { enabled: true }), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(calls).toContainEqual(['from', 'task_comments'])
    expect(calls).toContainEqual(['eq', 'space_id', 'space-1'])
    expect(calls).toContainEqual(['is', 'deleted_at', null])
    expect(calls).toContainEqual(['order', 'created_at', { ascending: false }])
    expect(calls).toContainEqual(['limit', 100])
  })

  it('長い本文は300文字で切ってから持つ（画面は2行しか出さず、端末にも保存されるため）', async () => {
    response = {
      data: [{ id: 'c1', task_id: 't1', actor_id: 'u1', body: 'あ'.repeat(1000), created_at: '2026-09-16T00:00:00Z' }],
      error: null,
    }
    const { result } = renderHook(() => useRecentTaskComments('space-1', { enabled: true }), { wrapper })
    await waitFor(() => expect(result.current.comments).toHaveLength(1))

    expect(result.current.comments[0].body).toHaveLength(300)
  })

  it('enabled が false のあいだは読みに行かず、読み込み中にもしない', async () => {
    const { result } = renderHook(() => useRecentTaskComments('space-1', { enabled: false }), { wrapper })

    expect(result.current.loading).toBe(false)
    expect(result.current.comments).toEqual([])
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
