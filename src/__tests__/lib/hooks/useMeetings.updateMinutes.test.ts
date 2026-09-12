import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMeetings, MinutesConflictError } from '@/lib/hooks/useMeetings'
import type { Meeting } from '@/types/database'

// 議事録の Web 編集用保存関数。`meetings` の BEFORE UPDATE トリガーが updated_at を
// 進める前提で、`.eq('updated_at', 読んだ値)` の一致0行を「別の場所で更新された」として
// MinutesConflictError にする（`.single()` は使わない — 0件で例外にならず判定できないため）。

const mockFetchMeetingsQuery = vi.fn()
vi.mock('@/lib/supabase/queries', () => ({
  fetchMeetingsQuery: (...args: unknown[]) => mockFetchMeetingsQuery(...args),
}))

vi.mock('@/lib/supabase/rpc', () => ({
  rpc: {
    meetingStart: vi.fn(),
    meetingEnd: vi.fn(),
    parseMeetingMinutes: vi.fn(),
    getMinutesPreview: vi.fn(),
  },
}))

vi.mock('@/lib/supabase/cached-auth', () => ({
  getCachedUser: vi.fn(async () => ({ user: { id: 'user-1' }, error: null })),
}))

// Chainable Supabase mock: from('meetings').update({...}).eq('id', id).eq('updated_at', base).select(cols)
const mockMeetingsUpdate = vi.fn()
const mockUpdateEqId = vi.fn()
const mockUpdateEqUpdatedAt = vi.fn()
const mockUpdateSelect = vi.fn()

const mockFrom = vi.fn((table: string) => {
  if (table === 'meetings') {
    return { update: mockMeetingsUpdate }
  }
  throw new Error(`unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}))

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    org_id: 'o1',
    space_id: 's1',
    title: '定例MTG',
    held_at: null,
    notes: null,
    status: 'planned',
    started_at: null,
    ended_at: null,
    minutes_md: '古い本文',
    summary_subject: null,
    summary_body: null,
    created_at: '2026-07-01T00:00:00',
    updated_at: '2026-07-01T00:00:00.111111+00',
    ...overrides,
  }
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useMeetings.updateMinutes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMeetingsUpdate.mockReturnValue({ eq: mockUpdateEqId })
    mockUpdateEqId.mockReturnValue({ eq: mockUpdateEqUpdatedAt })
    mockUpdateEqUpdatedAt.mockReturnValue({ select: mockUpdateSelect })
  })

  it('成功したらキャッシュの minutes_md・updated_at を差し替え、新しい updated_at を返す', async () => {
    mockFetchMeetingsQuery.mockResolvedValue({
      meetings: [makeMeeting({ id: 'm1' })],
      participants: {},
    })
    mockUpdateSelect.mockResolvedValue({
      data: [{ id: 'm1', minutes_md: '新しい本文', updated_at: '2026-07-02T00:00:00.222222+00' }],
      error: null,
    })

    const { result } = renderHook(() => useMeetings({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.meetings).toHaveLength(1))

    let returnedUpdatedAt = ''
    await act(async () => {
      returnedUpdatedAt = await result.current.updateMinutes(
        'm1',
        '新しい本文',
        '2026-07-01T00:00:00.111111+00'
      )
    })

    expect(mockMeetingsUpdate).toHaveBeenCalledWith({ minutes_md: '新しい本文' })
    expect(mockUpdateEqId).toHaveBeenCalledWith('id', 'm1')
    // 基準の updated_at 文字列は加工せずそのまま渡す（new Date() を通すと1/1000秒に丸まりDBの
    // 1/1000000秒と一致しなくなるため）
    expect(mockUpdateEqUpdatedAt).toHaveBeenCalledWith('updated_at', '2026-07-01T00:00:00.111111+00')
    expect(returnedUpdatedAt).toBe('2026-07-02T00:00:00.222222+00')

    await waitFor(() =>
      expect(result.current.meetings[0].minutes_md).toBe('新しい本文')
    )
    expect(result.current.meetings[0].updated_at).toBe('2026-07-02T00:00:00.222222+00')
  })

  it('0件（別の場所で更新済み）なら MinutesConflictError を投げ、キャッシュを変えない', async () => {
    mockFetchMeetingsQuery.mockResolvedValue({
      meetings: [makeMeeting({ id: 'm1', minutes_md: '元の本文' })],
      participants: {},
    })
    mockUpdateSelect.mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useMeetings({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.meetings).toHaveLength(1))

    await expect(
      result.current.updateMinutes('m1', '書きかけ', '2026-07-01T00:00:00.111111+00')
    ).rejects.toBeInstanceOf(MinutesConflictError)

    expect(result.current.meetings[0].minutes_md).toBe('元の本文')
  })

  it('DBエラーはそのまま投げる', async () => {
    mockFetchMeetingsQuery.mockResolvedValue({
      meetings: [makeMeeting({ id: 'm1' })],
      participants: {},
    })
    mockUpdateSelect.mockResolvedValue({ data: null, error: new Error('db error') })

    const { result } = renderHook(() => useMeetings({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await expect(
      result.current.updateMinutes('m1', '書きかけ', '2026-07-01T00:00:00.111111+00')
    ).rejects.toThrow('db error')
  })
})
