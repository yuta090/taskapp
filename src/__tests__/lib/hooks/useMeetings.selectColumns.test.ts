import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMeetings } from '@/lib/hooks/useMeetings'
import type { Meeting } from '@/types/database'

/**
 * 会議の notes 列は、どの画面でも読んでいない。一覧の全件ぶん読まれ、ブラウザの
 * 永続キャッシュ(IndexedDB)にも保存されてしまうだけの無駄なので、会議の詳細取得
 * (fetchMeetingDetail)・会議作成(createMeeting)の select は notes を含まない
 * 明示列にする。参加者(meeting_participants)には notes が無いため対象外。
 */

const mockFetchMeetingsQuery = vi.fn()
// fetchMeetingsQuery だけ差し替え、MEETING_DETAIL_COLUMNS 等は本物の定数をそのまま使う
// （列名の重複定義を避け、実装が変わったときにテストが追随できるようにする）。
vi.mock('@/lib/supabase/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/supabase/queries')>()
  return {
    ...actual,
    fetchMeetingsQuery: (...args: unknown[]) => mockFetchMeetingsQuery(...args),
  }
})

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

let detailSelectArg: string | undefined
let createSelectArg: string | undefined

const detailRow = {
  id: 'm1',
  org_id: 'o1',
  space_id: 's1',
  title: '定例MTG',
  held_at: '2026-07-01T10:00:00',
  status: 'ended',
  started_at: '2026-07-01T10:00:00',
  ended_at: '2026-07-01T11:00:00',
  minutes_md: '# 議事録',
  summary_subject: '件名',
  summary_body: '本文',
  created_at: '2026-07-01T00:00:00',
  updated_at: '2026-07-01T00:00:00',
}

const createdRow = { ...detailRow, id: 'm-new', minutes_md: null }

const mockFrom = vi.fn((table: string) => {
  if (table === 'meetings') {
    return {
      select: (cols: string) => {
        detailSelectArg = cols
        return {
          eq: () => ({
            single: () => Promise.resolve({ data: detailRow, error: null }),
          }),
        }
      },
      insert: () => ({
        select: (cols: string) => {
          createSelectArg = cols
          return {
            single: () => Promise.resolve({ data: createdRow, error: null }),
          }
        },
      }),
    }
  }
  if (table === 'meeting_participants') {
    return {
      insert: () => ({
        select: () => Promise.resolve({ data: [], error: null }),
      }),
    }
  }
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

describe('useMeetings — notes を含まない明示列で取得する', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    detailSelectArg = undefined
    createSelectArg = undefined
    mockFetchMeetingsQuery.mockResolvedValue({ meetings: [], participants: {} })
  })

  it('fetchMeetingDetail は notes を含まない列で取得する', async () => {
    const { result } = renderHook(() => useMeetings({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let detail: Meeting | null = null
    await act(async () => {
      detail = await result.current.fetchMeetingDetail('m1')
    })

    expect(detailSelectArg).toBeDefined()
    expect(detailSelectArg).not.toContain('notes')
    expect(detailSelectArg).not.toBe('*')
    expect(detail).toMatchObject({ id: 'm1', minutes_md: '# 議事録' })
  })

  it('createMeeting は notes を含まない列で作成する', async () => {
    const { result } = renderHook(() => useMeetings({ orgId: 'o1', spaceId: 's1' }), {
      wrapper: createWrapper(),
    })
    await waitFor(() => expect(result.current.loading).toBe(false))

    let created: Meeting | undefined
    await act(async () => {
      created = await result.current.createMeeting({
        title: '新しい定例',
        clientParticipantIds: [],
        internalParticipantIds: [],
      })
    })

    expect(createSelectArg).toBeDefined()
    expect(createSelectArg).not.toContain('notes')
    expect(createSelectArg).not.toBe('*')
    expect(created).toMatchObject({ id: 'm-new' })
  })
})
