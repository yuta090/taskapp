import React, { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { MeetingsPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/meetings/MeetingsPageClient'
import { useInPlaceLinkOpener } from '@/components/editor/inPlaceLinkOpener'
import type { Meeting } from '@/types/database'

vi.mock('@/components/task/ProjectTaskInspector', () => ({
  ProjectTaskInspector: () => null,
}))
vi.mock('@/components/meeting/MeetingInspector', () => ({
  MeetingInspector: () => null,
}))

/**
 * 会議中に議事録の中のタスクを開くと、タスク一覧へ画面が移ってしまい、議事録に戻るのが
 * 面倒だった（ユーザー申告）。議事録は出したまま、右パネルでタスク詳細を開く。
 *
 * タスクの開閉は URL（?task=）に載せ、開くときに履歴を1つ積む（スマホの情報シートと同じ）。
 * ブラウザ・端末の「戻る」はパネルだけを閉じる。
 */

let searchParamsValue = 'meeting=m1'
/** 受け口が引き受けたか（引き受けなければ、これまでどおり画面を移る） */
let opened: boolean | null = null

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}))

const mockSetInspector = vi.fn()
vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: mockSetInspector }),
  useShellFullscreen: () => ({ fullscreen: false, setFullscreen: vi.fn() }),
}))

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, canEditMoney: true, loading: false, resolved: true }),
}))
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null, loading: false, error: null }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

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

const mockDeleteMeeting = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hooks/useMeetings', () => ({
  useMeetings: () => ({
    meetings: [makeMeeting()],
    participants: {},
    loading: false,
    error: null,
    fetchMeetings: vi.fn(),
    fetchMeetingDetail: vi.fn().mockResolvedValue(makeMeeting()),
    createMeeting: vi.fn(),
    deleteMeeting: mockDeleteMeeting,
    startMeeting: vi.fn(),
    endMeeting: vi.fn(),
    // 下の削除のテストで使う（差し替えは hoisted の mockDeleteMeeting）
    parseMinutes: vi.fn(),
    previewMinutes: vi.fn(),
    updateMinutes: vi.fn(),
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

interface FakeHandle {
  flushPendingSave: () => Promise<string>
  ensureUpToDate: () => Promise<void>
  getBaseUpdatedAt: () => string | null
  getKnownRaw: () => string | null
  confirmLeave: () => Promise<boolean>
  markConflict: () => void
  notifyRoomReload: () => void
}

vi.mock('@/components/meeting/MinutesDocumentView', () => ({
  MinutesDocumentView: forwardRef(function FakeMinutesDocumentView(
    props: { onBack: () => void; onOpenInfo: () => void; meeting: Meeting },
    ref: React.Ref<FakeHandle>
  ) {
    useImperativeHandle(ref, () => ({
      flushPendingSave: vi.fn().mockResolvedValue(''),
      ensureUpToDate: vi.fn().mockResolvedValue(undefined),
      getBaseUpdatedAt: () => null,
      getKnownRaw: () => null,
      confirmLeave: vi.fn().mockResolvedValue(true),
      markConflict: vi.fn(),
      notifyRoomReload: vi.fn(),
    }))
    // 本文のリンク・印は、議事録画面が用意した「その場で開く」受け口を通る
    const openInPlace = useInPlaceLinkOpener()
    return (
      <div data-testid="minutes-document-view">
        <button onClick={() => { opened = openInPlace?.('/org-1/project/space-1?task=t1') ?? false }}>タスクのリンク</button>
        <button onClick={() => { opened = openInPlace?.('/org-1/project/space-2?task=t9') ?? false }}>別プロジェクトのタスク</button>
        <span>{props.meeting.title}</span>
        <button onClick={props.onBack}>戻る</button>
        <button onClick={props.onOpenInfo}>情報</button>
      </div>
    )
  }),
}))

const MINUTES_URL = '/org-1/project/space-1/meetings?meeting=m1'
const TASK_URL = '/org-1/project/space-1/meetings?meeting=m1&task=t1'

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = () => (
    <QueryClientProvider client={queryClient}>
      <MeetingsPageClient orgId="org-1" spaceId="space-1" />
    </QueryClientProvider>
  )
  const utils = render(ui())
  const rerenderPage = () => utils.rerender(ui())
  return { ...utils, rerenderPage }
}

let pushSpy: ReturnType<typeof vi.spyOn>
let replaceSpy: ReturnType<typeof vi.spyOn>
let backSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  searchParamsValue = 'meeting=m1'
  opened = null
  mockDeleteMeeting.mockResolvedValue(undefined)
  pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
  replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
  backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})


/** 右パネルに最後に渡したもの */
const lastInspector = () => mockSetInspector.mock.calls.at(-1)?.[0] as React.ReactElement<{ taskId?: string; onClose: () => void }> | null

describe('MeetingsPageClient — 議事録の中のタスクを右パネルで開く', () => {
  it('本文のタスクを押すと、画面を移らず URL に task を足して履歴を1つ積む', () => {
    renderPage()
    fireEvent.click(screen.getByText('タスクのリンク'))
    expect(opened).toBe(true)
    expect(pushSpy).toHaveBeenCalledWith(null, '', TASK_URL)
  })

  it('別のプロジェクトのタスクは引き受けない（これまでどおり画面を移る）', () => {
    renderPage()
    fireEvent.click(screen.getByText('別プロジェクトのタスク'))
    expect(opened).toBe(false)
    expect(pushSpy).not.toHaveBeenCalled()
  })

  it('task が付いているあいだは、会議詳細の代わりにタスク詳細を右パネルに出す', async () => {
    searchParamsValue = 'meeting=m1&task=t1'
    renderPage()
    await waitFor(() => expect(lastInspector()?.props.taskId).toBe('t1'))
    // 議事録はそのまま出ている
    expect(screen.getByTestId('minutes-document-view')).toBeInTheDocument()
  })

  it('×で閉じるときは、積んだ履歴を1つ戻す', async () => {
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByText('タスクのリンク'))
    searchParamsValue = 'meeting=m1&task=t1'
    rerenderPage()
    await waitFor(() => expect(lastInspector()?.props.taskId).toBe('t1'))

    act(() => lastInspector()!.props.onClose())

    expect(backSpy).toHaveBeenCalledTimes(1)
  })

  it('リンクから直接開いたとき（履歴を積んでいない）は、×で task を外すだけ', async () => {
    searchParamsValue = 'meeting=m1&task=t1'
    renderPage()
    await waitFor(() => expect(lastInspector()?.props.taskId).toBe('t1'))

    act(() => lastInspector()!.props.onClose())

    expect(backSpy).not.toHaveBeenCalled()
    expect(replaceSpy).toHaveBeenCalledWith(null, '', MINUTES_URL)
  })

  it('開いたまま別のタスクを押したら、履歴は積み増さず差し替える', async () => {
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByText('タスクのリンク'))
    searchParamsValue = 'meeting=m1&task=t1'
    rerenderPage()
    fireEvent.click(screen.getByText('タスクのリンク'))
    expect(pushSpy).toHaveBeenCalledTimes(1)
  })
})
