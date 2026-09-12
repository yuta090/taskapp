import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMeetings } from '@/lib/hooks/useMeetings'
import type { Meeting } from '@/types/database'

// 画面から会議を作るときの参加者の登録。
// meeting_participants は org_id / space_id が必須（既定値なし・埋める仕組みもなし）。
// 以前は meeting_id / user_id / side / created_by だけを送っていたため、
// 参加者を選んで会議を作ると必ず失敗していた（2026-09-12 に本番で確認）。

const mockFetchMeetingsQuery = vi.fn()
vi.mock('@/lib/supabase/queries', () => ({
  fetchMeetingsQuery: (...args: unknown[]) => mockFetchMeetingsQuery(...args),
  MEETING_DETAIL_COLUMNS: '*',
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

const createdMeeting: Meeting = {
  id: 'm-new',
  org_id: 'o1',
  space_id: 's1',
  title: '定例MTG',
  held_at: '2026-09-18T01:00:00Z',
  notes: null,
  status: 'planned',
  started_at: null,
  ended_at: null,
  minutes_md: null,
  summary_subject: null,
  summary_body: null,
  created_at: '2026-09-12T00:00:00Z',
  updated_at: '2026-09-12T00:00:00Z',
}

const mockMeetingsInsert = vi.fn()
const mockParticipantsInsert = vi.fn()

const mockFrom = vi.fn((table: string) => {
  if (table === 'meetings') return { insert: mockMeetingsInsert }
  if (table === 'meeting_participants') return { insert: mockParticipantsInsert }
  throw new Error(`unexpected table: ${table}`)
})

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ from: mockFrom }),
}))

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(QueryClientProvider, { client: queryClient }, children)
  }
}

describe('useMeetings.createMeeting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchMeetingsQuery.mockResolvedValue({ meetings: [], participants: {} })
    mockMeetingsInsert.mockReturnValue({
      select: () => ({ single: async () => ({ data: createdMeeting, error: null }) }),
    })
    mockParticipantsInsert.mockImplementation((rows: Record<string, unknown>[]) => ({
      select: async () => ({ data: rows.map((r, i) => ({ id: `p${i}`, ...r })), error: null }),
    }))
  })

  // created_by（登録者）は送らない。列の既定値 auth.uid() がログイン中の利用者を入れる。
  // 送らなければ、ブラウザから他人を登録者にできず、created_by 列を足す migration の前後どちらでも動く。
  it('参加者の行に、表の必須列（org_id・space_id・meeting_id・user_id・side）だけを入れる', async () => {
    const { result } = renderHook(() => useMeetings({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.createMeeting({
        title: '定例MTG',
        heldAt: '2026-09-18T01:00:00Z',
        clientParticipantIds: ['client-1'],
        internalParticipantIds: ['internal-1'],
      })
    })

    expect(mockParticipantsInsert).toHaveBeenCalledTimes(1)
    const rows = mockParticipantsInsert.mock.calls[0][0]
    expect(rows).toEqual([
      { org_id: 'o1', space_id: 's1', meeting_id: 'm-new', user_id: 'client-1', side: 'client' },
      { org_id: 'o1', space_id: 's1', meeting_id: 'm-new', user_id: 'internal-1', side: 'internal' },
    ])
  })

  it('参加者がいなければ meeting_participants には書かない', async () => {
    const { result } = renderHook(() => useMeetings({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.createMeeting({
        title: '定例MTG',
        clientParticipantIds: [],
        internalParticipantIds: [],
      })
    })

    expect(mockMeetingsInsert).toHaveBeenCalledTimes(1)
    expect(mockParticipantsInsert).not.toHaveBeenCalled()
  })
})
