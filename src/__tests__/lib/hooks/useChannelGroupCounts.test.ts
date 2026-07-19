import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useChannelGroupCounts } from '@/lib/hooks/useChannelGroupCounts'

/**
 * useChannelGroupCounts — space毎のactive channel_groups件数の集計。
 * 連携判定を「1:1DMのidentityだけでなくグループ接続でも“連携済み”」にするために使う。
 */

const mockSelect = vi.fn()
const mockEqOrg = vi.fn()
const mockEqStatus = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: vi.fn(() => ({ select: mockSelect })) }),
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

/** thenable(=await可能)なビルダ。 */
function builder(rows: { space_id: string | null }[]) {
  return {
    then: (resolve: (v: { data: typeof rows; error: null }) => unknown) =>
      resolve({ data: rows, error: null }),
  }
}

describe('useChannelGroupCounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSelect.mockReturnValue({ eq: mockEqOrg })
    mockEqOrg.mockReturnValue({ eq: mockEqStatus })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('space毎にグループ件数を集計する', async () => {
    mockEqStatus.mockReturnValue(
      builder([{ space_id: 'space-1' }, { space_id: 'space-1' }, { space_id: 'space-2' }]),
    )

    const { result } = renderHook(() => useChannelGroupCounts('org-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.counts).toEqual({ 'space-1': 2, 'space-2': 1 })
  })

  it('未紐付け(space_id=null)のグループはカウントしない', async () => {
    mockEqStatus.mockReturnValue(builder([{ space_id: null }, { space_id: 'space-9' }]))

    const { result } = renderHook(() => useChannelGroupCounts('org-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.counts).toEqual({ 'space-9': 1 })
  })
})
