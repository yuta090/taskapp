import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MinutesDocumentView } from '@/components/meeting/MinutesDocumentView'
// 競合の型は、差し替えられない置き場から取る（アプリ側もここを見ていないと instanceof が壊れる）
import { MinutesConflictError } from '@/lib/minutes/errors'
import type { Meeting } from '@/types/database'

// 画面のテストは useMeetings（フック）をまるごと差し替えることがある。
// そのとき MinutesDocumentView が競合の型を useMeetings から取っていると、
// 型が undefined になり `err instanceof undefined` で謎の例外になる（競合の帯が出ない）。
// ここでは useMeetings を「フックだけを持つ」形に差し替えて、その状況を再現する。
vi.mock('@/lib/hooks/useMeetings', () => ({
  useMeetings: () => ({
    meetings: [],
    participants: {},
    loading: false,
    error: null,
    fetchMeetings: vi.fn(),
    fetchMeetingDetail: vi.fn(),
    createMeeting: vi.fn(),
    deleteMeeting: vi.fn(),
    startMeeting: vi.fn(),
    endMeeting: vi.fn(),
    parseMinutes: vi.fn(),
    previewMinutes: vi.fn(),
    updateMinutes: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { id: 'u-self', email: 'me@example.com', user_metadata: { name: '自分' } },
    loading: false,
    error: null,
  }),
}))

vi.mock('@/lib/hooks/useMinutesPresence', () => ({
  useMinutesPresence: () => ({ others: [], setEditing: vi.fn() }),
}))

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

let capturedOnChange: ((md: string) => void) | undefined

vi.mock('@/components/meeting/MinutesEditorDynamic', () => ({
  MinutesEditorDynamic: (props: { minutesMd: string; editable: boolean; onChange?: (md: string) => void }) => {
    capturedOnChange = props.onChange
    return <div data-testid="minutes-editor" data-editable={String(props.editable)} />
  },
}))

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    org_id: 'org1',
    space_id: 'space1',
    title: '定例MTG',
    status: 'ended',
    held_at: null,
    started_at: null,
    ended_at: null,
    created_at: '2026-09-01T00:00:00',
    updated_at: '2026-09-01T00:00:00.111111+00',
    notes: null,
    minutes_md: '開いたときの本文',
    summary_subject: null,
    summary_body: null,
    ...overrides,
  } as Meeting
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  capturedOnChange = undefined
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useMeetings をまるごと差し替えても、競合の型が壊れない', () => {
  it('保存が競合したら、例外にならず競合の帯を出す', async () => {
    // サーバーの本文は別の場所で書き換えられている（本当の競合）
    const updateMinutes = vi.fn().mockRejectedValue(new MinutesConflictError())
    const fetchMeetingDetail = vi.fn().mockResolvedValue(makeMeeting({ minutes_md: 'AIが書き換えた本文' }))

    render(
      <MinutesDocumentView
        orgId="org1"
        spaceId="space1"
        meeting={makeMeeting()}
        canEdit
        onBack={vi.fn()}
        onOpenInfo={vi.fn()}
        updateMinutes={updateMinutes}
        fetchMeetingDetail={fetchMeetingDetail}
      />
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })

    act(() => capturedOnChange?.('編集した本文'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })

    expect(updateMinutes).toHaveBeenCalled()
    expect(screen.getByTestId('minutes-conflict-banner')).toBeInTheDocument()
    expect(screen.getByText(/AI秘書やほかの人が、この議事録を先に書き換えました/)).toBeInTheDocument()
  })
})
