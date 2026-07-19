import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useChannelIdentities } from '@/lib/hooks/useChannelIdentities'

/** useChannelIdentities — space毎のactive channel_identities件数の集計（任意でchannel絞り込み） */

const mockSelect = vi.fn()
const mockEqOrg = vi.fn()
// status絞り込みの戻りは「awaitできて かつ .eq('channel') も呼べる」ビルダを模す
// （実際の supabase query builder は thenable かつ chainable）。
const mockEqStatus = vi.fn()
const mockEqChannel = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: vi.fn(() => ({ select: mockSelect })) }),
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

/** thenable(=await可能)かつ .eq でさらに絞れるビルダ。 */
function builder(rows: { space_id: string }[]) {
  return {
    eq: (...args: unknown[]) => mockEqChannel(...args),
    then: (resolve: (v: { data: typeof rows; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  }
}

describe('useChannelIdentities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({ eq: mockEqOrg })
    mockEqOrg.mockReturnValue({ eq: mockEqStatus })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('space毎に件数を集計する', async () => {
    mockEqStatus.mockReturnValue(
      builder([{ space_id: 'space-1' }, { space_id: 'space-1' }, { space_id: 'space-2' }]),
    )

    const { result } = renderHook(() => useChannelIdentities('org-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.counts).toEqual({ 'space-1': 2, 'space-2': 1 })
  })

  it('紐付けが無いspaceはカウントに現れない(0件表示はコンポーネント側の責務)', async () => {
    mockEqStatus.mockReturnValue(builder([]))

    const { result } = renderHook(() => useChannelIdentities('org-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.counts).toEqual({})
  })

  it('channelを指定すると channel で絞って数える（非LINE identityを誤カウントしない）', async () => {
    mockEqStatus.mockReturnValue(builder([{ space_id: 'ignore-me' }])) // 未絞りなら混じる分
    mockEqChannel.mockReturnValue(builder([{ space_id: 'space-line' }]))

    const { result } = renderHook(() => useChannelIdentities('org-1', 'line'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    // channel='line' でのフィルタ結果のみが数えられる
    expect(mockEqChannel).toHaveBeenCalledWith('channel', 'line')
    expect(result.current.counts).toEqual({ 'space-line': 1 })
  })
})
