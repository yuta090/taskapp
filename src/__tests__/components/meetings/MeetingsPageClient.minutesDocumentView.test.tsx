import React, { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { MeetingsPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/meetings/MeetingsPageClient'
import type { Meeting } from '@/types/database'

// 会議を選んだら一覧の代わりに議事録の文書ビューを出す（Wiki のエディタビューと同じ考え方）。
// タスク化ボタンを押す前に、文書ビューの保留中の保存を流してから parseMinutes に渡す。

const mockSetInspector = vi.fn()
const mockRouterReplace = vi.fn()
let searchParamsValue = 'meeting=m1'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockRouterReplace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: mockSetInspector }),
}))

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, canEditMoney: true, loading: false, resolved: true }),
}))

function makeMeeting(overrides: Partial<Meeting> = {}): Meeting {
  return {
    id: 'm1',
    org_id: 'org-1',
    space_id: 'space-1',
    title: '定例MTG',
    status: 'ended',
    held_at: null,
    started_at: null,
    ended_at: null,
    created_at: '2026-09-01T00:00:00',
    updated_at: '2026-09-01T00:00:00.111111+00',
    notes: null,
    minutes_md: '本文',
    summary_subject: null,
    summary_body: null,
    ...overrides,
  } as Meeting
}

const mockParseMinutes = vi.fn()
const mockFetchMeetingDetail = vi.fn()
const mockUpdateMinutes = vi.fn()

vi.mock('@/lib/hooks/useMeetings', () => ({
  useMeetings: () => ({
    meetings: [makeMeeting()],
    participants: {},
    loading: false,
    error: null,
    fetchMeetings: vi.fn(),
    fetchMeetingDetail: mockFetchMeetingDetail,
    createMeeting: vi.fn(),
    deleteMeeting: vi.fn(),
    startMeeting: vi.fn(),
    endMeeting: vi.fn(),
    parseMinutes: mockParseMinutes,
    previewMinutes: vi.fn(),
    updateMinutes: mockUpdateMinutes,
  }),
}))

vi.mock('@/lib/hooks/useSchedulingProposals', () => ({
  useSchedulingProposals: () => ({
    proposals: [],
    loading: false,
    error: null,
    fetchProposals: vi.fn(),
    fetchProposalDetail: vi.fn(),
    createProposal: vi.fn(),
    confirmSlot: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null, loading: false, error: null }),
}))

const mockFlushPendingSave = vi.fn().mockResolvedValue('flushed-content')
const mockGetBaseUpdatedAt = vi.fn().mockReturnValue('2026-09-01T00:00:00.111111+00')

vi.mock('@/components/meeting/MinutesDocumentView', () => ({
  MinutesDocumentView: forwardRef(function FakeMinutesDocumentView(
    props: { onBack: () => void; meeting: Meeting },
    ref: React.Ref<{ flushPendingSave: () => Promise<string>; getBaseUpdatedAt: () => string | null }>
  ) {
    useImperativeHandle(ref, () => ({
      flushPendingSave: mockFlushPendingSave,
      getBaseUpdatedAt: mockGetBaseUpdatedAt,
    }))
    return (
      <div data-testid="minutes-document-view">
        <span>{props.meeting.title}</span>
        <button onClick={props.onBack}>戻る</button>
      </div>
    )
  }),
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MeetingsPageClient orgId="org-1" spaceId="space-1" />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  searchParamsValue = 'meeting=m1'
  mockFlushPendingSave.mockResolvedValue('flushed-content')
  mockFetchMeetingDetail.mockResolvedValue(makeMeeting())
  mockParseMinutes.mockResolvedValue({ createdCount: 1, createdTasks: [], updatedMinutes: 'flushed-content' })
})

describe('MeetingsPageClient 議事録の文書ビュー', () => {
  it('?meeting= があると一覧の代わりに文書ビューを出す', () => {
    renderPage()
    expect(screen.getByTestId('minutes-document-view')).toBeInTheDocument()
    expect(screen.getByText('定例MTG')).toBeInTheDocument()
  })

  it('戻るを押すと（保存を待ってから）?meeting= を外して一覧に戻る', async () => {
    renderPage()
    await act(async () => {
      fireEvent.click(screen.getByText('戻る'))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mockFlushPendingSave).toHaveBeenCalledTimes(1)
    expect(mockRouterReplace).toHaveBeenCalledWith('/org-1/project/space-1/meetings')
  })

  it('タスク化の前に文書ビューの保留中の保存を流し、その本文で parseMinutes する', async () => {
    renderPage()

    // MeetingInspector は setInspector 経由(モック)で作られるだけで実際にはマウントされないため、
    // 渡された props から onCreateTasks を取り出して直接呼ぶ
    await waitFor(() => expect(mockSetInspector).toHaveBeenCalled())
    const lastInspectorElement = mockSetInspector.mock.calls.at(-1)?.[0]
    expect(lastInspectorElement).toBeTruthy()

    await act(async () => {
      await lastInspectorElement.props.onCreateTasks('m1', '古い本文（未フラッシュ）')
    })

    expect(mockFlushPendingSave).toHaveBeenCalledTimes(1)
    // flush 確定後、RPC を呼ぶ前にもう一度サーバーの状態を確かめる(HIGH-1)
    expect(mockFetchMeetingDetail).toHaveBeenCalledWith('m1')
    expect(mockParseMinutes).toHaveBeenCalledWith('m1', 'flushed-content')
  })

  it('HIGH-1: flush 確定後に基準(updated_at)がずれていたらタスク化を中止する', async () => {
    renderPage()
    await waitFor(() => expect(mockSetInspector).toHaveBeenCalled())
    const lastInspectorElement = mockSetInspector.mock.calls.at(-1)?.[0]

    // サーバーの状態がずれている（別の場所で更新済み）
    mockFetchMeetingDetail.mockResolvedValue(makeMeeting({ updated_at: '2026-09-01T09:99:99.999999+00' }))

    await act(async () => {
      await expect(lastInspectorElement.props.onCreateTasks('m1', '本文')).rejects.toThrow()
    })

    expect(mockParseMinutes).not.toHaveBeenCalled()
  })

  it('HIGH-1: 書けない人には onCreateTasks を渡さない', async () => {
    // このテストだけ canEdit=false を模す
    vi.doMock('@/lib/hooks/useCanEditSpace', () => ({
      useCanEditSpace: () => ({ canEdit: false, canEditMoney: false, loading: false, resolved: true }),
    }))
    vi.resetModules()
    const { MeetingsPageClient: MeetingsPageClientReadonly } = await import(
      '@/app/(internal)/[orgId]/project/[spaceId]/meetings/MeetingsPageClient'
    )
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={queryClient}>
        <MeetingsPageClientReadonly orgId="org-1" spaceId="space-1" />
      </QueryClientProvider>
    )

    await waitFor(() => expect(mockSetInspector).toHaveBeenCalled())
    const lastInspectorElement = mockSetInspector.mock.calls.at(-1)?.[0]
    expect(lastInspectorElement.props.onCreateTasks).toBeUndefined()
  })
})
