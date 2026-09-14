import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWikiDecisionCounts } from '@/lib/hooks/useWikiDecisionCounts'

// Wiki 一覧の「確定 2/5」の印に使う取得。決定事項のタスク（type='spec' かつ wiki_page_id あり）だけを
// 数える。確定の単位はページではなく決定1件なので、wiki_pages には列を足さない。

const mockRange = vi.fn()
const mockNot = vi.fn(() => ({ range: mockRange }))
const mockEq3 = vi.fn(() => ({ not: mockNot }))
const mockEq2 = vi.fn(() => ({ eq: mockEq3 }))
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

describe('useWikiDecisionCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({ eq: mockEq1 })
    mockEq1.mockReturnValue({ eq: mockEq2 })
    mockEq2.mockReturnValue({ eq: mockEq3 })
    mockEq3.mockReturnValue({ not: mockNot })
    mockNot.mockReturnValue({ range: mockRange })
    mockRange.mockResolvedValue({ data: [], error: null })
  })

  it('決定事項のタスクだけを、必要な3列で取る', async () => {
    renderHook(() => useWikiDecisionCounts('org-1', 'space-1'), { wrapper })
    await waitFor(() => expect(mockRange).toHaveBeenCalled())
    expect(mockSelect).toHaveBeenCalledWith('id, wiki_page_id, decision_state')
    expect(mockEq3).toHaveBeenCalledWith('type', 'spec')
    expect(mockNot).toHaveBeenCalledWith('wiki_page_id', 'is', null)
  })

  it('range を明示する（PostgREST の 1000件で黙って打ち切られないように）', async () => {
    renderHook(() => useWikiDecisionCounts('org-1', 'space-1'), { wrapper })
    await waitFor(() => expect(mockRange).toHaveBeenCalled())
    expect(mockRange).toHaveBeenCalledWith(0, 999)
  })

  it('ページごとに数え上げる', async () => {
    mockRange.mockResolvedValue({
      data: [
        { id: 't1', wiki_page_id: 'p1', decision_state: 'decided' },
        { id: 't2', wiki_page_id: 'p1', decision_state: 'considering' },
        { id: 't3', wiki_page_id: 'p2', decision_state: 'implemented' },
      ],
      error: null,
    })
    const { result } = renderHook(() => useWikiDecisionCounts('org-1', 'space-1'), { wrapper })
    await waitFor(() => expect(result.current.countsByPageId.size).toBe(2))
    expect(result.current.countsByPageId.get('p1')).toEqual({ total: 2, decided: 1 })
    expect(result.current.countsByPageId.get('p2')).toEqual({ total: 1, decided: 1 })
  })

  it('enabled=false なら取りに行かない', async () => {
    const { result } = renderHook(
      () => useWikiDecisionCounts('org-1', 'space-1', { enabled: false }),
      { wrapper }
    )
    expect(mockFrom).not.toHaveBeenCalled()
    expect(result.current.countsByPageId.size).toBe(0)
  })

  it('中身が同じ再取得では Map の参照が変わらない（タブ復帰で全行が再描画されないこと）', async () => {
    // react-query の構造共有はプレーンオブジェクトにしか効かないため、クエリの返り値を
    // Record にしている。Map を直接返す形に変えると、戻るたびに一覧の全行が描き直される。
    mockRange.mockResolvedValue({
      data: [{ id: 't1', wiki_page_id: 'p1', decision_state: 'decided' }],
      error: null,
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    function localWrapper({ children }: { children: React.ReactNode }) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>
    }
    const { result } = renderHook(() => useWikiDecisionCounts('org-1', 'space-1'), {
      wrapper: localWrapper,
    })
    await waitFor(() => expect(result.current.countsByPageId.size).toBe(1))
    const first = result.current.countsByPageId
    await client.refetchQueries({ queryKey: ['wikiDecisionCounts', 'org-1', 'space-1'] })
    await waitFor(() => expect(result.current.countsByPageId.size).toBe(1))
    expect(result.current.countsByPageId).toBe(first)
  })
})
