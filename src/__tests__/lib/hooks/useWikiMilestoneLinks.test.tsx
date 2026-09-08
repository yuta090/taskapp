import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWikiMilestoneLinks } from '@/lib/hooks/useWikiMilestoneLinks'

// PR4: 所属マイルストーンをタグのように見せる。docs/spec/WIKI_LIST_SPEC.md PR4 節。
// タスク側の wiki_page_id/milestone_id から「Wikiページ → 参照しているタスクのマイルストーン」を
// 引くための軽量クエリ。

const mockNot2 = vi.fn()
const mockNot1 = vi.fn(() => ({ not: mockNot2 }))
const mockEq2 = vi.fn(() => ({ not: mockNot1 }))
const mockEq1 = vi.fn(() => ({ eq: mockEq2 }))
const mockSelect = vi.fn(() => ({ eq: mockEq1 }))
const mockFrom = vi.fn((table: string) => {
  if (table !== 'tasks') throw new Error(`unexpected table: ${table}`)
  return { select: mockSelect }
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useWikiMilestoneLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({ eq: mockEq1 })
    mockEq1.mockReturnValue({ eq: mockEq2 })
    mockEq2.mockReturnValue({ not: mockNot1 })
    mockNot1.mockReturnValue({ not: mockNot2 })
    mockNot2.mockResolvedValue({ data: [], error: null })
  })

  it('org_id・space_id で絞り込み、wiki_page_id/milestone_id が非 NULL の行だけを select する', async () => {
    const { result } = renderHook(() => useWikiMilestoneLinks('org1', 'space1'), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockFrom).toHaveBeenCalledWith('tasks')
    expect(mockSelect).toHaveBeenCalledWith('wiki_page_id, milestone_id')
    expect(mockEq1).toHaveBeenCalledWith('org_id', 'org1')
    expect(mockEq2).toHaveBeenCalledWith('space_id', 'space1')
    expect(mockNot1).toHaveBeenCalledWith('wiki_page_id', 'is', null)
    expect(mockNot2).toHaveBeenCalledWith('milestone_id', 'is', null)
  })

  it('pageId ごとに milestoneId の配列へ集約する（重複は排除）', async () => {
    mockNot2.mockResolvedValue({
      data: [
        { wiki_page_id: 'p1', milestone_id: 'm1' },
        { wiki_page_id: 'p1', milestone_id: 'm2' },
        { wiki_page_id: 'p1', milestone_id: 'm1' }, // 重複
        { wiki_page_id: 'p2', milestone_id: 'm1' },
      ],
      error: null,
    })

    const { result } = renderHook(() => useWikiMilestoneLinks('org1', 'space1'), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.linksByPageId.get('p1')).toEqual(['m1', 'm2'])
    expect(result.current.linksByPageId.get('p2')).toEqual(['m1'])
  })

  it('orgId・spaceId が空なら取得しない（enabled: false）', () => {
    renderHook(() => useWikiMilestoneLinks('', 'space1'), { wrapper })
    expect(mockFrom).not.toHaveBeenCalled()
  })

  // 回帰: 毎レンダー新しい Map を返すと、これを依存に持つ useMemo/useEffect が
  // 再レンダー → 新しい Map → 再レンダー … と無限ループしうる（useMilestones の EMPTY_MILESTONES と同種）。
  it('取得が終わる前は、再レンダーしても同じ参照の空 Map を返す', () => {
    mockNot2.mockReturnValue(new Promise<never>(() => {})) // 解決しない
    const { result, rerender } = renderHook(() => useWikiMilestoneLinks('org1', 'space1'), { wrapper })
    const first = result.current.linksByPageId
    expect(first.size).toBe(0)
    expect(result.current.loading).toBe(true)
    rerender()
    rerender()
    expect(result.current.linksByPageId).toBe(first)
  })
})
