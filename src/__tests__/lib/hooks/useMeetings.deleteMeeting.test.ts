import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMeetings } from '@/lib/hooks/useMeetings'
import type { Meeting } from '@/types/database'

// C2: 会議の削除機能。scheduling_proposals.confirmed_meeting_id → meetings は
// ON DELETE NO ACTION のため、日程調整に紐づく会議は削除前にブロックする必要がある。

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

// Chainable Supabase mock: from(table).select(...).eq(...).limit(...) for the
// scheduling_proposals check, from('meetings').delete().eq(...) for the delete.
const mockSchedulingSelect = vi.fn()
const mockSchedulingEq = vi.fn()
const mockSchedulingLimit = vi.fn()
const mockMeetingsDelete = vi.fn()
const mockMeetingsDeleteEq = vi.fn()

const mockFrom = vi.fn((table: string) => {
  if (table === 'scheduling_proposals') {
    return { select: mockSchedulingSelect }
  }
  if (table === 'meetings') {
    return { delete: mockMeetingsDelete }
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
    minutes_md: null,
    summary_subject: null,
    summary_body: null,
    created_at: '2026-07-01T00:00:00',
    updated_at: '2026-07-01T00:00:00',
    ...overrides,
  }
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useMeetings.deleteMeeting', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockSchedulingSelect.mockReturnValue({ eq: mockSchedulingEq })
    mockSchedulingEq.mockReturnValue({ limit: mockSchedulingLimit })
    mockSchedulingLimit.mockResolvedValue({ data: [], error: null })

    mockMeetingsDelete.mockReturnValue({ eq: mockMeetingsDeleteEq })
    mockMeetingsDeleteEq.mockResolvedValue({ error: null })
  })

  it('紐づく scheduling_proposals が無ければ削除しキャッシュから取り除く', async () => {
    mockFetchMeetingsQuery.mockResolvedValue({
      meetings: [makeMeeting({ id: 'm1' })],
      participants: { m1: [{ id: 'p1', user_id: 'u1' }] },
    })

    const { result } = renderHook(() => useMeetings({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.meetings).toHaveLength(1))

    await act(async () => {
      await result.current.deleteMeeting('m1')
    })

    expect(mockFrom).toHaveBeenCalledWith('scheduling_proposals')
    expect(mockSchedulingEq).toHaveBeenCalledWith('confirmed_meeting_id', 'm1')
    expect(mockFrom).toHaveBeenCalledWith('meetings')
    expect(mockMeetingsDeleteEq).toHaveBeenCalledWith('id', 'm1')
    await waitFor(() => expect(result.current.meetings).toHaveLength(0))
  })

  it('日程調整(scheduling_proposals)に紐づく会議は削除をブロックしDELETEを発行しない', async () => {
    mockFetchMeetingsQuery.mockResolvedValue({
      meetings: [makeMeeting({ id: 'm1' })],
      participants: {},
    })
    mockSchedulingLimit.mockResolvedValue({ data: [{ id: 'proposal-1' }], error: null })

    const { result } = renderHook(() => useMeetings({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.meetings).toHaveLength(1))

    await expect(result.current.deleteMeeting('m1')).rejects.toThrow(
      '日程調整に紐づいている'
    )

    expect(mockMeetingsDelete).not.toHaveBeenCalled()
    // 楽観的更新も行われず、一覧に残ったまま
    expect(result.current.meetings).toHaveLength(1)
  })

  it('DELETEが失敗したら楽観的更新をロールバックする', async () => {
    mockFetchMeetingsQuery.mockResolvedValue({
      meetings: [makeMeeting({ id: 'm1' })],
      participants: {},
    })
    mockMeetingsDeleteEq.mockResolvedValue({ error: new Error('db error') })

    const { result } = renderHook(() => useMeetings({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))
    await waitFor(() => expect(result.current.meetings).toHaveLength(1))

    await expect(result.current.deleteMeeting('m1')).rejects.toThrow()

    await waitFor(() => expect(result.current.meetings).toHaveLength(1))
  })
})
