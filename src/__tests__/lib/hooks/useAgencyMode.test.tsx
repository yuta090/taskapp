import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAgencyMode } from '@/lib/hooks/useAgencyMode'
import { spaceQueryKey } from '@/lib/hooks/useSpaceRow'
import type { SpaceRow } from '@/lib/hooks/useSpaceRow'

/**
 * 代理店設定(default_margin_rate・vendor_settings)は C2 で社内専用の別表
 * space_agency_settings（space_id が主キー・spaces と1:1）に移した。agency_mode は
 * spaces に残る（協力会社の画面が使う）ため、update() の呼び出しは書き込み先が
 * フィールドごとに分かれる。
 */

const mockSpacesUpdate = vi.fn()
const mockSpacesEq = vi.fn()
const mockAgencySettingsUpsert = vi.fn()

const mockFrom = vi.fn((table: string) => {
  if (table === 'spaces') {
    return { update: mockSpacesUpdate }
  }
  if (table === 'space_agency_settings') {
    return { upsert: mockAgencySettingsUpsert }
  }
  throw new Error(`unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return { Wrapper, queryClient }
}

const SPACE_ID = 'space-1'

function seedSpaceRow(queryClient: QueryClient, patch: Partial<SpaceRow> = {}) {
  queryClient.setQueryData<SpaceRow>(spaceQueryKey(SPACE_ID), {
    id: SPACE_ID,
    name: 'テスト',
    archived_at: null,
    archived_by: null,
    preset_genre: null,
    default_video_provider: null,
    agency_mode: false,
    default_margin_rate: null,
    vendor_settings: { show_client_name: false, allow_client_comments: false },
    ...patch,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSpacesUpdate.mockReturnValue({ eq: mockSpacesEq })
  mockSpacesEq.mockResolvedValue({ error: null })
  mockAgencySettingsUpsert.mockResolvedValue({ error: null })
})

describe('useAgencyMode — 書き込み先はフィールドごとに分かれる', () => {
  it('agency_mode は spaces へ書く。space_agency_settings は触らない', async () => {
    const { Wrapper, queryClient } = createWrapper()
    seedSpaceRow(queryClient)
    const { result } = renderHook(() => useAgencyMode(SPACE_ID), { wrapper: Wrapper })

    await act(async () => {
      await result.current.update({ agency_mode: true })
    })

    expect(mockFrom).toHaveBeenCalledWith('spaces')
    expect(mockSpacesUpdate).toHaveBeenCalledWith({ agency_mode: true })
    expect(mockSpacesEq).toHaveBeenCalledWith('id', SPACE_ID)
    expect(mockFrom).not.toHaveBeenCalledWith('space_agency_settings')
  })

  it('default_margin_rate は space_agency_settings へ upsert する。spaces は触らない', async () => {
    const { Wrapper, queryClient } = createWrapper()
    seedSpaceRow(queryClient)
    const { result } = renderHook(() => useAgencyMode(SPACE_ID), { wrapper: Wrapper })

    await act(async () => {
      await result.current.update({ default_margin_rate: 35 })
    })

    expect(mockAgencySettingsUpsert).toHaveBeenCalledWith(
      { space_id: SPACE_ID, default_margin_rate: 35 },
      { onConflict: 'space_id' }
    )
    // useSpaceRow の初期読み込みで from('spaces') 自体は呼ばれるが、書き込み(update)はしない
    expect(mockSpacesUpdate).not.toHaveBeenCalled()
  })

  it('vendor_settings は space_agency_settings へ upsert する', async () => {
    const { Wrapper, queryClient } = createWrapper()
    seedSpaceRow(queryClient)
    const { result } = renderHook(() => useAgencyMode(SPACE_ID), { wrapper: Wrapper })

    const vendorSettings = { show_client_name: true, allow_client_comments: false }
    await act(async () => {
      await result.current.update({ vendor_settings: vendorSettings })
    })

    expect(mockAgencySettingsUpsert).toHaveBeenCalledWith(
      { space_id: SPACE_ID, vendor_settings: vendorSettings },
      { onConflict: 'space_id' }
    )
    expect(mockSpacesUpdate).not.toHaveBeenCalled()
  })

  it('楽観的更新: 保存が終わる前からキャッシュに新しい値が見える', async () => {
    const { Wrapper, queryClient } = createWrapper()
    seedSpaceRow(queryClient)
    // upsert がすぐには解決しないようにして、楽観的更新の途中経過を覗く
    let resolveUpsert: (() => void) | undefined
    mockAgencySettingsUpsert.mockReturnValue(
      new Promise((resolve) => {
        resolveUpsert = () => resolve({ error: null })
      })
    )
    const { result } = renderHook(() => useAgencyMode(SPACE_ID), { wrapper: Wrapper })

    let pending!: Promise<void>
    act(() => {
      pending = result.current.update({ default_margin_rate: 40 })
    })

    await waitFor(() => expect(result.current.data.default_margin_rate).toBe(40))

    resolveUpsert?.()
    await act(async () => {
      await pending
    })
  })

  it('保存が失敗したら、直前の値へロールバックする', async () => {
    const { Wrapper, queryClient } = createWrapper()
    seedSpaceRow(queryClient, { default_margin_rate: 10 })
    mockAgencySettingsUpsert.mockResolvedValue({ error: { message: 'boom' } })
    const { result } = renderHook(() => useAgencyMode(SPACE_ID), { wrapper: Wrapper })

    await act(async () => {
      await expect(result.current.update({ default_margin_rate: 999 })).rejects.toThrow()
    })

    await waitFor(() => expect(result.current.data.default_margin_rate).toBe(10))
  })
})
