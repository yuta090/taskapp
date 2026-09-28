import React, { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { MeetingsPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/meetings/MeetingsPageClient'
import type { Meeting } from '@/types/database'

/**
 * スマホで議事録を開き、情報ボタンで会議詳細のシートを出した状態で端末の「戻る」を押すと、
 * シートが閉じるのではなく議事録ごと閉じていた（会議中に使いづらい、というユーザー申告）。
 *
 * 直し方: シートの開閉も URL（?info=1）に載せ、開くときに履歴を1つ積む。
 * 端末の「戻る」は ?info= が外れるだけになり、シートだけが閉じる。
 */

let searchParamsValue = 'meeting=m1'

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
// この画面はスマホ幅で見ている
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => true }))
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
    return (
      <div data-testid="minutes-document-view">
        <span>{props.meeting.title}</span>
        <button onClick={props.onBack}>戻る</button>
        <button onClick={props.onOpenInfo}>情報</button>
      </div>
    )
  }),
}))

const MINUTES_URL = '/org-1/project/space-1/meetings?meeting=m1'
const INFO_URL = '/org-1/project/space-1/meetings?meeting=m1&info=1'

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
  mockDeleteMeeting.mockResolvedValue(undefined)
  pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
  replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
  backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MeetingsPageClient — スマホの会議詳細シートと端末の「戻る」', () => {
  it('情報ボタンでシートを開くと、URL に info=1 を足して履歴を1つ積む', () => {
    renderPage()

    fireEvent.click(screen.getByText('情報'))

    expect(pushSpy).toHaveBeenCalledWith(null, '', INFO_URL)
  })

  it('info=1 が付いているあいだだけ、スマホでも会議詳細（シート）を出す', async () => {
    const { rerenderPage } = renderPage()
    // 開く前は出さない（スマホは情報ボタンを押したときだけ出す）
    await waitFor(() => expect(mockSetInspector).toHaveBeenCalled())
    expect(mockSetInspector.mock.calls.at(-1)?.[0]).toBeNull()

    searchParamsValue = 'meeting=m1&info=1'
    rerenderPage()

    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).not.toBeNull())
  })

  it('端末の「戻る」で info=1 が外れたら、議事録は開いたままシートだけ閉じる', async () => {
    searchParamsValue = 'meeting=m1&info=1'
    const { rerenderPage } = renderPage()
    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).not.toBeNull())

    // 端末の「戻る」＝積んだ履歴が1つ戻り、?info= が外れた状態
    searchParamsValue = 'meeting=m1'
    rerenderPage()

    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).toBeNull())
    // 議事録はそのまま出ている（議事録ごと閉じない）
    expect(screen.getByTestId('minutes-document-view')).toBeInTheDocument()
  })

  it('シートの×で閉じるときは、積んだ履歴を1つ戻す（戻るを二度押させない）', async () => {
    renderPage()
    fireEvent.click(screen.getByText('情報'))

    searchParamsValue = 'meeting=m1&info=1'
    // 開いたあとのシートの×
    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).not.toBeNull())
    const sheet = mockSetInspector.mock.calls.at(-1)?.[0]
    backSpy.mockClear()

    sheet.props.onClose()

    expect(backSpy).toHaveBeenCalledTimes(1)
  })

  it('端末の「戻る」でシートを閉じたあと、もう一度開いてもまた履歴を積む', () => {
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByText('情報'))

    searchParamsValue = 'meeting=m1&info=1'
    rerenderPage()
    // 端末の「戻る」で ?info= が外れた状態
    searchParamsValue = 'meeting=m1'
    rerenderPage()
    pushSpy.mockClear()

    fireEvent.click(screen.getByText('情報'))

    expect(pushSpy).toHaveBeenCalledWith(null, '', INFO_URL)
  })

  it('シートから会議を削除したら、URL から ?info= も外す', async () => {
    searchParamsValue = 'meeting=m1&info=1'
    renderPage()
    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).not.toBeNull())
    const sheet = mockSetInspector.mock.calls.at(-1)?.[0]
    replaceSpy.mockClear()

    await act(async () => {
      await sheet.props.onDelete()
    })

    expect(mockDeleteMeeting).toHaveBeenCalledWith('m1')
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/org-1/project/space-1/meetings')
  })

  it('×を続けて2回押しても、履歴を戻すのは1回だけ', async () => {
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByText('情報'))

    searchParamsValue = 'meeting=m1&info=1'
    rerenderPage()
    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).not.toBeNull())
    const sheet = mockSetInspector.mock.calls.at(-1)?.[0]
    backSpy.mockClear()
    replaceSpy.mockClear()

    sheet.props.onClose()
    sheet.props.onClose()

    expect(backSpy).toHaveBeenCalledTimes(1)
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('議事録を閉じるときは info=1 も一緒に外す（次に開いた議事録でシートが出たままにならない）', () => {
    searchParamsValue = 'meeting=m1&info=1'
    renderPage()

    fireEvent.click(screen.getByText('戻る'))

    // 直接 ?meeting= で開いた場合は履歴を戻さず差し替える。その URL に info は残さない
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/org-1/project/space-1/meetings')
    expect(replaceSpy).not.toHaveBeenCalledWith(null, '', MINUTES_URL)
  })
})
