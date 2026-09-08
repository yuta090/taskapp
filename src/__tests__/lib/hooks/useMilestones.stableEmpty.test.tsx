import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMilestones } from '@/lib/hooks/useMilestones'

// マイルストーン取得が返ってこない（pending のまま）状態を作る
const never = () => new Promise<never>(() => {})
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ order: never }) }),
    }),
  }),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useMilestones: 読み込み中の空配列', () => {
  // 回帰: 毎レンダー新しい [] を返すと、これを依存に持つ effect（Wiki のページ情報パネル等）が
  // effect → setState → 再レンダー → また新しい配列… と無限ループして
  // 「Maximum update depth exceeded」で画面が落ちた。
  it('取得が終わる前は、再レンダーしても同じ参照の空配列を返す', () => {
    const { result, rerender } = renderHook(() => useMilestones({ spaceId: 'space-1' }), { wrapper })
    const first = result.current.milestones
    expect(first).toEqual([])
    rerender()
    rerender()
    expect(result.current.milestones).toBe(first)
  })
})
