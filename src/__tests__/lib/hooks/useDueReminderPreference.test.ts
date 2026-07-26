import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useDueReminderPreference } from '@/lib/hooks/useDueReminderPreference'

const maybeSingleMock = vi.fn()
const upsertMock = vi.fn()
const fromMock = vi.fn(() => ({
  select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
  upsert: upsertMock,
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: fromMock }),
}))

const USER = 'user-1'

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

beforeEach(() => {
  maybeSingleMock.mockReset()
  upsertMock.mockReset()
  fromMock.mockClear()
})

describe('useDueReminderPreference', () => {
  it('profiles から初期値を読み込む（false）', async () => {
    maybeSingleMock.mockResolvedValue({ data: { due_reminder_enabled: false }, error: null })
    const { result } = renderHook(() => useDueReminderPreference(USER), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.enabled).toBe(false)
  })

  it('行が無ければ既定 true（オプトアウト思想）', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    const { result } = renderHook(() => useDueReminderPreference(USER), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.enabled).toBe(true)
  })

  it('トグルで楽観更新し、profiles に upsert する', async () => {
    maybeSingleMock.mockResolvedValue({ data: { due_reminder_enabled: true }, error: null })
    upsertMock.mockResolvedValue({ error: null })
    const { result } = renderHook(() => useDueReminderPreference(USER), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.enabled).toBe(true))

    await act(async () => {
      await result.current.toggle()
    })

    expect(result.current.enabled).toBe(false)
    expect(upsertMock).toHaveBeenCalledWith(
      { id: USER, due_reminder_enabled: false },
      { onConflict: 'id' },
    )
  })

  it('保存失敗時は元の値へロールバックする', async () => {
    maybeSingleMock.mockResolvedValue({ data: { due_reminder_enabled: true }, error: null })
    upsertMock.mockResolvedValue({ error: { message: 'boom' } })
    const { result } = renderHook(() => useDueReminderPreference(USER), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.enabled).toBe(true))

    await act(async () => {
      await result.current.toggle()
    })

    await waitFor(() => expect(result.current.enabled).toBe(true))
  })

  it('userId 未指定なら取得しない', async () => {
    renderHook(() => useDueReminderPreference(undefined), { wrapper: createWrapper() })
    // enabled クエリなので profiles select は走らない
    await waitFor(() => expect(maybeSingleMock).not.toHaveBeenCalled())
  })
})
