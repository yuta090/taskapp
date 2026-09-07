import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useWikiPages } from '@/lib/hooks/useWikiPages'
import type { WikiPage } from '@/types/database'

// PR2: 構造(親子・マイルストーン・ピン留め)。一覧の select 列に新しい構造列を足し、
// updatePage がそれらを楽観更新・DB update の両方に反映することを確かめる。

const mockGetUser = vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null }))

const mockSelect = vi.fn()
const mockSelectEq1 = vi.fn()
const mockSelectEq2 = vi.fn()
const mockSelectOrder = vi.fn()

const mockUpdate = vi.fn()
const mockUpdateEq1 = vi.fn()
const mockUpdateEq2 = vi.fn()

const mockFrom = vi.fn((table: string) => {
  if (table !== 'wiki_pages') throw new Error(`unexpected table: ${table}`)
  return { select: mockSelect, update: mockUpdate }
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom, auth: { getUser: mockGetUser } }),
}))

function makePageRow(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'p1',
    org_id: 'org1',
    space_id: 'space1',
    title: '既存ページ',
    body: '',
    tags: [],
    parent_page_id: null,
    milestone_id: null,
    pinned_at: null,
    sort_order: null,
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

describe('useWikiPages（構造列）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    mockSelect.mockReturnValue({ eq: mockSelectEq1 })
    mockSelectEq1.mockReturnValue({ eq: mockSelectEq2 })
    mockSelectEq2.mockReturnValue({ order: mockSelectOrder })
    mockSelectOrder.mockResolvedValue({ data: [makePageRow()], error: null })

    mockUpdate.mockReturnValue({ eq: mockUpdateEq1 })
    mockUpdateEq1.mockReturnValue({ eq: mockUpdateEq2 })
    mockUpdateEq2.mockResolvedValue({ error: null })
  })

  it('一覧の select に親子/マイルストーン/ピン留め/並び順の列を含める', async () => {
    const { result } = renderHook(() => useWikiPages({ orgId: 'org1', spaceId: 'space1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockSelect).toHaveBeenCalledWith(
      expect.stringMatching(/parent_page_id/)
    )
    const selectArg = mockSelect.mock.calls[0][0] as string
    expect(selectArg).toContain('milestone_id')
    expect(selectArg).toContain('pinned_at')
    expect(selectArg).toContain('sort_order')
  })

  it('updatePage は parent_page_id/milestone_id/pinned_at を DB update に渡す', async () => {
    const { result } = renderHook(() => useWikiPages({ orgId: 'org1', spaceId: 'space1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.pages).toHaveLength(1))

    await act(async () => {
      await result.current.updatePage('p1', {
        parent_page_id: 'parent-1',
        milestone_id: 'milestone-1',
        pinned_at: '2026-09-08T00:00:00+09:00',
      })
    })

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        parent_page_id: 'parent-1',
        milestone_id: 'milestone-1',
        pinned_at: '2026-09-08T00:00:00+09:00',
      })
    )
    expect(mockUpdateEq1).toHaveBeenCalledWith('id', 'p1')
    expect(mockUpdateEq2).toHaveBeenCalledWith('org_id', 'org1')
  })

  it('updatePage で pinned_at: null を渡すとピン留め解除として DB update に渡る', async () => {
    const { result } = renderHook(() => useWikiPages({ orgId: 'org1', spaceId: 'space1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.updatePage('p1', { pinned_at: null })
    })

    expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ pinned_at: null }))
  })

  it('updatePage は成功前に楽観的に親子/マイルストーン/ピン留めを反映する', async () => {
    const { result } = renderHook(() => useWikiPages({ orgId: 'org1', spaceId: 'space1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    // DB 更新を保留にして、楽観更新の途中状態を観察する
    let resolveUpdate: (v: { error: null }) => void = () => {}
    mockUpdateEq2.mockReturnValue(new Promise(resolve => { resolveUpdate = resolve }))

    let updatePromise: Promise<void> = Promise.resolve()
    act(() => {
      updatePromise = result.current.updatePage('p1', { parent_page_id: 'parent-1', pinned_at: '2026-09-08T00:00:00+09:00' })
    })

    await waitFor(() => {
      const page = result.current.pages.find(p => p.id === 'p1')
      expect(page?.parent_page_id).toBe('parent-1')
      expect(page?.pinned_at).toBe('2026-09-08T00:00:00+09:00')
    })

    await act(async () => {
      resolveUpdate({ error: null })
      await updatePromise
    })
  })

  it('DB update が失敗したら構造列の楽観更新もロールバックする', async () => {
    const { result } = renderHook(() => useWikiPages({ orgId: 'org1', spaceId: 'space1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    mockUpdateEq2.mockResolvedValueOnce({ error: new Error('別スペースの親は指定できません') })

    await expect(
      result.current.updatePage('p1', { parent_page_id: 'other-space-page' })
    ).rejects.toThrow()

    await waitFor(() => {
      const page = result.current.pages.find(p => p.id === 'p1')
      expect(page?.parent_page_id).toBe(null)
    })
  })
})
