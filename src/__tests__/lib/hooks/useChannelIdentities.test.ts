import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useChannelIdentities } from '@/lib/hooks/useChannelIdentities'

/** useChannelIdentities — space毎のactive channel_identities件数の集計 */

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
    mockEqStatus.mockResolvedValue({
      data: [{ space_id: 'space-1' }, { space_id: 'space-1' }, { space_id: 'space-2' }],
      error: null,
    })

    const { result } = renderHook(() => useChannelIdentities('org-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.counts).toEqual({ 'space-1': 2, 'space-2': 1 })
  })

  it('紐付けが無いspaceはカウントに現れない(0件表示はコンポーネント側の責務)', async () => {
    mockEqStatus.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useChannelIdentities('org-1'), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.counts).toEqual({})
  })
})
