import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useSpaceRow } from '@/lib/hooks/useSpaceRow'
import { useSpaceName } from '@/lib/hooks/useSpaceName'
import { useSpaceArchive } from '@/lib/hooks/useSpaceArchive'
import { useAgencyMode } from '@/lib/hooks/useAgencyMode'
import { useSpaceVideoProvider } from '@/lib/hooks/useSpaceVideoProvider'

/**
 * useSpaceRow — プロジェクト(spaces)の1行を取りにいく唯一の入口。
 *
 * 以前は「名前」「アーカイブ状態」「代理店設定」「会議ツール既定」を、それぞれ別々に
 * 同じ1行へ問い合わせていた（設定画面を開くだけで同じ行に4〜6往復）。
 * ここでは 1往復に集約されていること・全部の値が同じ行から読めることを固定する。
 */

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQuery: vi.fn(actual.useQuery) }
})

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user-1' }, loading: false, error: null }),
}))

const maybeSingleMock = vi.fn()
const fromMock = vi.fn()

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: (...args: unknown[]) => fromMock(...args) }),
}))

const SPACE_ROW = {
  id: 'space-1',
  name: 'サイト制作',
  archived_at: null,
  archived_by: null,
  preset_genre: 'web_production',
  default_video_provider: 'zoom',
  agency_mode: true,
  // 代理店設定(default_margin_rate/vendor_settings)は社内専用の別表 space_agency_settings
  // から埋め込みで読む（fetchSpaceRowQuery が平らにする）。
  space_agency_settings: {
    default_margin_rate: 0.2,
    vendor_settings: { show_client_name: true, allow_client_comments: false },
  },
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
  return { Wrapper, queryClient }
}

beforeEach(() => {
  vi.clearAllMocks()
  maybeSingleMock.mockResolvedValue({ data: SPACE_ROW, error: null })
  fromMock.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
  })
})

describe('useSpaceRow — プロジェクト情報は1往復にまとめる', () => {
  it('名前・アーカイブ・代理店設定・会議ツールを同時に見ても、取得は1回だけ', async () => {
    const { Wrapper } = createWrapper()

    const { result } = renderHook(
      () => ({
        name: useSpaceName('space-1'),
        archive: useSpaceArchive('space-1'),
        agency: useAgencyMode('space-1'),
        video: useSpaceVideoProvider('space-1'),
      }),
      { wrapper: Wrapper }
    )

    await waitFor(() => expect(result.current.name).toBe('サイト制作'))

    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(fromMock).toHaveBeenCalledWith('spaces')
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)
  })

  it('同じ1行からアーカイブ状態・代理店設定・会議ツール既定を読み取れる', async () => {
    const { Wrapper } = createWrapper()

    const { result } = renderHook(
      () => ({
        row: useSpaceRow('space-1'),
        archive: useSpaceArchive('space-1'),
        agency: useAgencyMode('space-1'),
        video: useSpaceVideoProvider('space-1'),
      }),
      { wrapper: Wrapper }
    )

    await waitFor(() => expect(result.current.row.space?.name).toBe('サイト制作'))

    expect(result.current.archive.isArchived).toBe(false)
    expect(result.current.agency.data.agency_mode).toBe(true)
    expect(result.current.agency.data.default_margin_rate).toBe(0.2)
    expect(result.current.agency.data.vendor_settings).toEqual({
      show_client_name: true,
      allow_client_comments: false,
    })
    expect(result.current.video.defaultProvider).toBe('zoom')
  })

  it('アーカイブ済みなら isArchived が true になる', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { ...SPACE_ROW, archived_at: '2026-09-01T00:00:00Z', archived_by: 'user-1' },
      error: null,
    })
    const { Wrapper } = createWrapper()

    const { result } = renderHook(() => useSpaceArchive('space-1'), { wrapper: Wrapper })

    await waitFor(() => expect(result.current.isArchived).toBe(true))
    expect(result.current.archivedAt).toBe('2026-09-01T00:00:00Z')
  })

  it('staleTimeはSTRUCTUREティア(5分)を明示する（設定情報は毎回取り直さない）', async () => {
    const { Wrapper } = createWrapper()

    renderHook(() => useSpaceRow('space-1'), { wrapper: Wrapper })

    await waitFor(() => expect(useQuery).toHaveBeenCalled())
    const options = (useQuery as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<
      string,
      unknown
    >
    expect(options.queryKey).toEqual(['space', 'space-1'])
    expect(options.staleTime).toBe(5 * 60_000)
  })

  it('列が無い古いDBでも、既定値に落として画面を壊さない', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { id: 'space-1', name: 'サイト制作', archived_at: null },
      error: null,
    })
    const { Wrapper } = createWrapper()

    const { result } = renderHook(
      () => ({ agency: useAgencyMode('space-1'), video: useSpaceVideoProvider('space-1') }),
      { wrapper: Wrapper }
    )

    await waitFor(() => expect(result.current.agency.loading).toBe(false))

    expect(result.current.agency.data.agency_mode).toBe(false)
    expect(result.current.agency.data.default_margin_rate).toBe(null)
    expect(result.current.agency.data.vendor_settings).toEqual({
      show_client_name: false,
      allow_client_comments: false,
    })
    expect(result.current.video.defaultProvider).toBe(null)
  })

  it('消えたプロジェクトを踏んでも、エラーにせず空で返す（無駄な再試行をしない）', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    const { Wrapper } = createWrapper()

    const { result } = renderHook(
      () => ({ name: useSpaceName('space-1'), agency: useAgencyMode('space-1') }),
      { wrapper: Wrapper }
    )

    await waitFor(() => expect(result.current.agency.loading).toBe(false))
    expect(result.current.name).toBe('')
    expect(maybeSingleMock).toHaveBeenCalledTimes(1)
  })

  it('spaceId が無いときは取りにいかない', async () => {
    const { Wrapper } = createWrapper()

    renderHook(() => useSpaceRow(null), { wrapper: Wrapper })

    await waitFor(() => expect(useQuery).toHaveBeenCalled())
    expect(fromMock).not.toHaveBeenCalled()
  })
})
