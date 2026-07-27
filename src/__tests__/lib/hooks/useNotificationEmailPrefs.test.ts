import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useNotificationEmailPrefs } from '@/lib/hooks/useNotificationEmailPrefs'

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

describe('useNotificationEmailPrefs', () => {
  it('行が無ければ既定（全ON・daily）', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    const { result } = renderHook(() => useNotificationEmailPrefs(USER), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.prefs.email_enabled).toBe(true)
    expect(result.current.prefs.digest_frequency).toBe('daily')
  })

  it('保存値を読み込む（部分行はデフォルトとマージ）', async () => {
    maybeSingleMock.mockResolvedValue({ data: { email_enabled: false, digest_frequency: 'weekly' }, error: null })
    const { result } = renderHook(() => useNotificationEmailPrefs(USER), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.prefs.email_enabled).toBe(false)
    expect(result.current.prefs.digest_frequency).toBe('weekly')
    expect(result.current.prefs.on_task_assigned).toBe(true) // 未指定はデフォルト
  })

  it('update で楽観更新し、全列を upsert する', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    upsertMock.mockResolvedValue({ error: null })
    const { result } = renderHook(() => useNotificationEmailPrefs(USER), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.update({ digest_frequency: 'weekly' })
    })

    expect(result.current.prefs.digest_frequency).toBe('weekly')
    const arg = upsertMock.mock.calls[0][0]
    expect(arg.user_id).toBe(USER)
    expect(arg.digest_frequency).toBe('weekly')
    expect(arg.email_enabled).toBe(true) // 全列を送る
    expect(upsertMock.mock.calls[0][1]).toEqual({ onConflict: 'user_id' })
  })

  it('保存失敗時は元の値へロールバック', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    upsertMock.mockResolvedValue({ error: { message: 'boom' } })
    const { result } = renderHook(() => useNotificationEmailPrefs(USER), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.update({ email_enabled: false })
    })

    await waitFor(() => expect(result.current.prefs.email_enabled).toBe(true))
  })
})
