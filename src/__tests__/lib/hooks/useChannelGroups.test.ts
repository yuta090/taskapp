import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useChannelGroups } from '@/lib/hooks/useChannelGroups'

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQuery: vi.fn(actual.useQuery) }
})

/**
 * useChannelGroups — sink作成フォームの「グループ絞り込み(任意)」選択肢用。
 * channel_groupsはRLSで内部メンバーにSELECTが許可されている(Stage2実装済み)ため、
 * useChannelIdentities.ts と同様に直接Supabaseクエリで取得する(新規APIルートは作らない)。
 * STRUCTUREティア(freshness tiers): staleTime 5分・任意で15秒ポーリング(接続待ち画面用)。
 */

const orderMock = vi.fn()
const eqStatusMock = vi.fn(() => ({ order: orderMock }))
const eqOrgMock = vi.fn(() => ({ eq: eqStatusMock }))
const selectMock = vi.fn(() => ({ eq: eqOrgMock }))
const fromMock = vi.fn(() => ({ select: selectMock }))

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({ from: fromMock })),
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useChannelGroups', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('active な channel_groups を org_id で絞り込んで取得する', async () => {
    orderMock.mockResolvedValue({
      data: [
        { id: 'group-1', display_name: '本店グループ', external_group_id: 'G-1' },
        { id: 'group-2', display_name: null, external_group_id: 'G-2' },
      ],
      error: null,
    })

    const { result } = renderHook(() => useChannelGroups('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(fromMock).toHaveBeenCalledWith('channel_groups')
    expect(selectMock).toHaveBeenCalledWith('id, display_name, external_group_id')
    expect(eqOrgMock).toHaveBeenCalledWith('org_id', 'org-1')
    expect(eqStatusMock).toHaveBeenCalledWith('status', 'active')

    expect(result.current.groups).toEqual([
      { id: 'group-1', displayName: '本店グループ', externalGroupId: 'G-1' },
      { id: 'group-2', displayName: null, externalGroupId: 'G-2' },
    ])
  })

  it('エラー時は空配列を返す(グループ絞り込みは任意項目のため致命的にしない)', async () => {
    orderMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const { result } = renderHook(() => useChannelGroups('org-1'), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.groups).toEqual([])
  })

  it('staleTimeはSTRUCTUREティア(5分)を明示する(30秒ではない)', async () => {
    orderMock.mockResolvedValue({ data: [], error: null })

    renderHook(() => useChannelGroups('org-1'), { wrapper: createWrapper() })

    await waitFor(() => expect(useQuery).toHaveBeenCalled())
    const options = (useQuery as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(options.staleTime).toBe(5 * 60_000)
    expect(options.staleTime).not.toBe(30_000)
  })

  it('polling省略時はrefetchIntervalを設定しない（既定=STRUCTUREの5分SWRのまま）', async () => {
    orderMock.mockResolvedValue({ data: [], error: null })

    renderHook(() => useChannelGroups('org-1'), { wrapper: createWrapper() })

    await waitFor(() => expect(useQuery).toHaveBeenCalled())
    const options = (useQuery as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(options.refetchInterval).toBeUndefined()
  })

  it('polling:true指定時はrefetchIntervalを15秒に設定する（接続待ち画面のみ有効化）', async () => {
    orderMock.mockResolvedValue({ data: [], error: null })

    renderHook(() => useChannelGroups('org-1', { polling: true }), { wrapper: createWrapper() })

    await waitFor(() => expect(useQuery).toHaveBeenCalled())
    const options = (useQuery as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(options.refetchInterval).toBe(15_000)
  })
})
