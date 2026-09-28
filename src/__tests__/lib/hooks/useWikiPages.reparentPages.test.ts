import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWikiPages } from '@/lib/hooks/useWikiPages'
import type { WikiPage } from '@/types/database'

// PR5（フォルダの削除）: 直下の子ページをまとめて1つ上の階層へ付け替える reparentPages。
// フォルダ削除時に子の数だけ updatePage を呼ぶと通信が線形に増えるため、
// `.update(...).in('id', ids)` の1回にまとめる（表示速度レビュー指摘）。

const mockGetUser = vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }))

const mockSelect = vi.fn()
const mockSelectEq1 = vi.fn()
const mockSelectEq2 = vi.fn()
const mockSelectOrder = vi.fn()

const mockUpdate = vi.fn()
const mockUpdateEq1 = vi.fn()
const mockUpdateEq2 = vi.fn()
const mockUpdateIn = vi.fn()

const mockFrom = vi.fn((table: string) => {
  if (table !== 'wiki_pages') throw new Error(`unexpected table: ${table}`)
  return { select: mockSelect, update: mockUpdate }
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
    auth: {
      getUser: mockGetUser,
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  }),
}))

function makePageRow(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'p1',
    org_id: 'org1',
    space_id: 'space1',
    title: '子ページ',
    body: '',
    tags: [],
    parent_page_id: 'folder-1',
    milestone_id: null,
    pinned_at: null,
    sort_order: null,
    is_folder: false,
    created_by: 'user-1',
    updated_by: 'user-1',
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useWikiPages.reparentPages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    mockSelect.mockReturnValue({ eq: mockSelectEq1 })
    mockSelectEq1.mockReturnValue({ eq: mockSelectEq2 })
    mockSelectEq2.mockReturnValue({ order: mockSelectOrder })
    mockSelectOrder.mockResolvedValue({
      data: [makePageRow({ id: 'child1' }), makePageRow({ id: 'child2' })],
      error: null,
    })

    mockUpdate.mockReturnValue({ eq: mockUpdateEq1 })
    mockUpdateEq1.mockReturnValue({ eq: mockUpdateEq2 })
    mockUpdateEq2.mockReturnValue({ in: mockUpdateIn })
    mockUpdateIn.mockResolvedValue({ data: null, error: null })
  })

  it('1回の update().in() で複数ページの parent_page_id をまとめて変える', async () => {
    const { result } = renderHook(() => useWikiPages({ orgId: 'org1', spaceId: 'space1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.pages).toHaveLength(2))

    await act(async () => {
      await result.current.reparentPages(['child1', 'child2'], 'grandparent')
    })

    expect(mockUpdate).toHaveBeenCalledTimes(1)
    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ parent_page_id: 'grandparent' }))
    expect(mockUpdateEq1).toHaveBeenCalledWith('org_id', 'org1')
    expect(mockUpdateEq2).toHaveBeenCalledWith('space_id', 'space1')
    expect(mockUpdateIn).toHaveBeenCalledWith('id', ['child1', 'child2'])
  })

  it('null を渡すと根(null)へまとめて上げる', async () => {
    const { result } = renderHook(() => useWikiPages({ orgId: 'org1', spaceId: 'space1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.reparentPages(['child1'], null)
    })

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ parent_page_id: null }))
  })

  it('先に楽観更新でキャッシュ上の parent_page_id を変える', async () => {
    const { result } = renderHook(() => useWikiPages({ orgId: 'org1', spaceId: 'space1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let resolveUpdate: (v: { data: null; error: null }) => void = () => {}
    mockUpdateIn.mockReturnValue(new Promise(resolve => { resolveUpdate = resolve }))

    let reparentPromise: Promise<void> = Promise.resolve()
    act(() => {
      reparentPromise = result.current.reparentPages(['child1', 'child2'], 'grandparent')
    })

    await waitFor(() => {
      expect(result.current.pages.find(p => p.id === 'child1')?.parent_page_id).toBe('grandparent')
      expect(result.current.pages.find(p => p.id === 'child2')?.parent_page_id).toBe('grandparent')
    })

    await act(async () => {
      resolveUpdate({ data: null, error: null })
      await reparentPromise
    })
  })

  it('失敗したら1回のロールバックで元の parent_page_id に戻す', async () => {
    const { result } = renderHook(() => useWikiPages({ orgId: 'org1', spaceId: 'space1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockUpdateIn.mockResolvedValueOnce({ data: null, error: new Error('failed') })

    await expect(result.current.reparentPages(['child1', 'child2'], 'grandparent')).rejects.toThrow()

    await waitFor(() => {
      expect(result.current.pages.find(p => p.id === 'child1')?.parent_page_id).toBe('folder-1')
      expect(result.current.pages.find(p => p.id === 'child2')?.parent_page_id).toBe('folder-1')
    })
  })

  it('ids が空なら何もしない', async () => {
    const { result } = renderHook(() => useWikiPages({ orgId: 'org1', spaceId: 'space1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.reparentPages([], 'grandparent')
    })

    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
