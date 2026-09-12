import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useOrgReminderSettings, orgReminderSettingsQueryKey } from '@/lib/hooks/useOrgReminderSettings'

const ORG_ID = 'org-1'

let policyResponse: { data: { due_reminders_enabled: boolean | null } | null; error: { message: string } | null }
const mockMaybeSingle = vi.fn(() => Promise.resolve(policyResponse))
const mockEq = vi.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = vi.fn(() => ({ eq: mockEq }))
const mockRpc = vi.fn(() => Promise.resolve<{ error: { message: string } | null }>({ error: null }))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== 'org_channel_policy') throw new Error(`unexpected table: ${table}`)
      return { select: mockSelect }
    },
    rpc: mockRpc,
  }),
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return { Wrapper, queryClient }
}

beforeEach(() => {
  vi.clearAllMocks()
  policyResponse = { data: null, error: null }
  mockRpc.mockResolvedValue({ error: null })
})

describe('useOrgReminderSettings — 取得', () => {
  it('行が無ければfail-open(既定オン)で返す', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useOrgReminderSettings(ORG_ID), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.dueRemindersLoading).toBe(false))
    expect(result.current.dueRemindersEnabled).toBe(true)
    expect(result.current.dueRemindersFetchError).toBe(false)
  })

  it('due_reminders_enabled=falseなら初期値はオフになる', async () => {
    policyResponse = { data: { due_reminders_enabled: false }, error: null }
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useOrgReminderSettings(ORG_ID), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.dueRemindersLoading).toBe(false))
    expect(result.current.dueRemindersEnabled).toBe(false)
  })

  it('orgIdが無い間は読み込み中にしない', () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useOrgReminderSettings(null), { wrapper: Wrapper })

    expect(result.current.dueRemindersLoading).toBe(false)
    expect(mockSelect).not.toHaveBeenCalled()
  })

  it('初回の取得(select)が失敗したらdueRemindersFetchErrorをtrueにする（既定ON表示のまま操作可能にしない）', async () => {
    policyResponse = { data: null, error: { message: 'permission denied for column' } }
    const { Wrapper } = createWrapper()
    const { result } = renderHook(() => useOrgReminderSettings(ORG_ID), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.dueRemindersFetchError).toBe(true))
  })

  it('前回データがある状態で裏の取り直しだけ失敗しても、前回値を出し続ける（fetchErrorはfalseのまま）', async () => {
    const { Wrapper, queryClient } = createWrapper()
    // 前回成功済みのキャッシュを用意（このページ読み込みより前のデータという想定）
    queryClient.setQueryData<boolean>(orgReminderSettingsQueryKey(ORG_ID), false)
    policyResponse = { data: null, error: { message: 'temporary failure' } }
    const { result } = renderHook(() => useOrgReminderSettings(ORG_ID), { wrapper: Wrapper })

    // 裏の取り直し（他画面の操作・再フォーカスなど）を明示的に起こす
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: orgReminderSettingsQueryKey(ORG_ID) })
    })

    await waitFor(() => expect(mockSelect).toHaveBeenCalled())
    expect(result.current.dueRemindersEnabled).toBe(false)
    expect(result.current.dueRemindersFetchError).toBe(false)
  })
})

describe('useOrgReminderSettings — 書き込み', () => {
  it('楽観的更新: 保存が終わる前からキャッシュに新しい値が見える', async () => {
    const { Wrapper, queryClient } = createWrapper()
    queryClient.setQueryData<boolean>(orgReminderSettingsQueryKey(ORG_ID), true)
    let resolveRpc: (() => void) | undefined
    mockRpc.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = () => resolve({ error: null })
      })
    )
    const { result } = renderHook(() => useOrgReminderSettings(ORG_ID), { wrapper: Wrapper })

    act(() => {
      result.current.setDueRemindersEnabled(false)
    })

    await waitFor(() => expect(result.current.dueRemindersEnabled).toBe(false))
    expect(result.current.dueRemindersSaving).toBe(true)

    resolveRpc?.()
    await waitFor(() => expect(result.current.dueRemindersSaving).toBe(false))
  })

  it('保存が失敗したら、直前の値へロールバックしエラーを立てる', async () => {
    const { Wrapper, queryClient } = createWrapper()
    queryClient.setQueryData<boolean>(orgReminderSettingsQueryKey(ORG_ID), true)
    mockRpc.mockResolvedValue({ error: { message: 'boom' } })
    const { result } = renderHook(() => useOrgReminderSettings(ORG_ID), { wrapper: Wrapper })

    act(() => {
      result.current.setDueRemindersEnabled(false)
    })

    await waitFor(() => expect(result.current.dueRemindersSaveError).toBe(true))
    expect(result.current.dueRemindersEnabled).toBe(true)
  })

  it('呼び出しはRPC(rpc_set_org_due_reminders_enabled)経由で行う', async () => {
    const { Wrapper, queryClient } = createWrapper()
    queryClient.setQueryData<boolean>(orgReminderSettingsQueryKey(ORG_ID), true)
    const { result } = renderHook(() => useOrgReminderSettings(ORG_ID), { wrapper: Wrapper })

    act(() => {
      result.current.setDueRemindersEnabled(false)
    })

    await waitFor(() =>
      expect(mockRpc).toHaveBeenCalledWith('rpc_set_org_due_reminders_enabled', {
        p_org_id: ORG_ID,
        p_enabled: false,
      })
    )
  })

  it('連打しても同時に2本のRPCを飛ばさない（同期ガード）', async () => {
    const { Wrapper, queryClient } = createWrapper()
    queryClient.setQueryData<boolean>(orgReminderSettingsQueryKey(ORG_ID), true)
    let resolveRpc: (() => void) | undefined
    mockRpc.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = () => resolve({ error: null })
      })
    )
    const { result } = renderHook(() => useOrgReminderSettings(ORG_ID), { wrapper: Wrapper })

    act(() => {
      result.current.setDueRemindersEnabled(false) // 1回目: pendingのまま
      result.current.setDueRemindersEnabled(true) // 2回目: 同一tick内なので無視されるべき
    })

    await waitFor(() => expect(mockRpc).toHaveBeenCalledTimes(1))

    resolveRpc?.()
    await waitFor(() => expect(result.current.dueRemindersSaving).toBe(false))
    // 解決後も2本目が遅れて飛んでいないこと
    expect(mockRpc).toHaveBeenCalledTimes(1)
  })

  it('保存が成功しても、サーバー側の値に合わせて取り直す（古い値をキャッシュいっぱい出したままにしない）', async () => {
    const { Wrapper, queryClient } = createWrapper()
    queryClient.setQueryData<boolean>(orgReminderSettingsQueryKey(ORG_ID), true)
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useOrgReminderSettings(ORG_ID), { wrapper: Wrapper })

    act(() => {
      result.current.setDueRemindersEnabled(false)
    })

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: orgReminderSettingsQueryKey(ORG_ID) })
      )
    )
  })

  it('保存が失敗しても、取り直しは行う（ロールバックした値のまま古くなるのを防ぐ）', async () => {
    const { Wrapper, queryClient } = createWrapper()
    queryClient.setQueryData<boolean>(orgReminderSettingsQueryKey(ORG_ID), true)
    mockRpc.mockResolvedValue({ error: { message: 'boom' } })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useOrgReminderSettings(ORG_ID), { wrapper: Wrapper })

    act(() => {
      result.current.setDueRemindersEnabled(false)
    })

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: orgReminderSettingsQueryKey(ORG_ID) })
      )
    )
  })
})
