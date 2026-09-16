import React, { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { MeetingsPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/meetings/MeetingsPageClient'
import type { Meeting } from '@/types/database'

/**
 * 議事録を開いてからブラウザの「戻る」を押すと、議事録一覧ではなく、その前に見ていたページが出ていた。
 * 議事録を開くときに URL を差し替える（history.replaceState）だけで、履歴を増やしていなかったため。
 *
 * 直し方は、タスク画面（TasksPageClient の syncUrlWithState の push）と同じ:
 * 一覧から議事録を開くときだけ履歴を1つ積み、画面の「戻る」ボタンはその履歴を1つ戻す。
 * リンクやお知らせから直接 ?meeting= で開いたときは積んでいないので、これまでどおり URL を差し替える。
 */

let searchParamsValue = ''

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

// 「ほかの人が会議を削除した」を再現するために、一覧を差し替え可能にしておく
let mockMeetingsList: Meeting[] = [makeMeeting()]
// 日程調整の行（履歴を積まないことを確かめる）
let mockProposals: unknown[] = []

const mockCreateMeeting = vi.hoisted(() => vi.fn())
const mockDeleteMeeting = vi.hoisted(() => vi.fn())

// 会議の新規作成シートは、押すと onSubmit が走るだけの代役にする（入力の再現は目的ではない）
vi.mock('@/components/meeting', () => ({
  MeetingCreateSheet: (props: { minutesOnly?: boolean; onSubmit: (data: unknown) => void }) => (
    <button
      onClick={() =>
        props.onSubmit({ title: '新しい会議', heldAt: null, clientParticipantIds: [], internalParticipantIds: [] })
      }
    >
      {props.minutesOnly ? '議事録だけ作る' : 'この内容で作る'}
    </button>
  ),
}))

vi.mock('@/lib/hooks/useMeetings', () => ({
  useMeetings: () => ({
    meetings: mockMeetingsList,
    participants: {},
    loading: false,
    error: null,
    fetchMeetings: vi.fn(),
    fetchMeetingDetail: vi.fn().mockResolvedValue(makeMeeting()),
    createMeeting: mockCreateMeeting,
    deleteMeeting: mockDeleteMeeting,
    startMeeting: vi.fn(),
    endMeeting: vi.fn(),
    parseMinutes: vi.fn(),
    previewMinutes: vi.fn(),
    updateMinutes: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useSchedulingProposals', () => ({
  useSchedulingProposals: () => ({
    proposals: mockProposals,
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
    props: { onBack: () => void; meeting: Meeting },
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
      </div>
    )
  }),
}))

const LIST_URL = '/org-1/project/space-1/meetings'
const MINUTES_URL = '/org-1/project/space-1/meetings?meeting=m1'

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = () => (
    <QueryClientProvider client={queryClient}>
      <MeetingsPageClient orgId="org-1" spaceId="space-1" />
    </QueryClientProvider>
  )
  const utils = render(ui())
  // searchParamsValue はモックの外側の値なので、書き換えたら明示的に描き直す
  const rerenderPage = () => utils.rerender(ui())
  return { ...utils, rerenderPage }
}

let pushSpy: ReturnType<typeof vi.spyOn>
let replaceSpy: ReturnType<typeof vi.spyOn>
let backSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  searchParamsValue = ''
  mockMeetingsList = [makeMeeting()]
  mockProposals = []
  mockCreateMeeting.mockResolvedValue(makeMeeting({ id: 'm9', title: '新しい会議' }))
  mockDeleteMeeting.mockResolvedValue(undefined)
  pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
  replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
  backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('MeetingsPageClient — 議事録を開いたあとの「戻る」', () => {
  it('一覧から議事録を開くと履歴を1つ積む（ブラウザの戻るで一覧に帰れるように）', () => {
    renderPage()

    fireEvent.click(screen.getByText('定例MTG'))

    expect(pushSpy).toHaveBeenCalledWith(null, '', MINUTES_URL)
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('画面の「戻る」は、履歴を戻さず必ず一覧の URL にする（押したら必ず一覧が出る）', () => {
    // 実ブラウザでの確認で、履歴を戻す方式だと「ブラウザの戻るで一覧 → もう一度開く」のあとに
    // 一覧を飛び越してその前の画面まで戻った。押したら必ず一覧、を優先する
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByText('定例MTG'))

    // 押したあとの URL の状態にする（本物の history では pushState が効いている）
    searchParamsValue = 'meeting=m1'
    rerenderPage()
    replaceSpy.mockClear()

    fireEvent.click(screen.getByText('戻る'))

    expect(replaceSpy).toHaveBeenCalledWith(null, '', LIST_URL)
    expect(backSpy).not.toHaveBeenCalled()
  })

  it('リンクやお知らせから直接開いたときの「戻る」は、履歴を戻さず一覧の URL に差し替える', () => {
    searchParamsValue = 'meeting=m1'
    renderPage()

    fireEvent.click(screen.getByText('戻る'))

    expect(replaceSpy).toHaveBeenCalledWith(null, '', LIST_URL)
    expect(backSpy).not.toHaveBeenCalled()
  })

  it('ブラウザの戻るで一覧に帰ったあと、もう一度開いてもまた履歴を積む', () => {
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByText('定例MTG'))

    // 押すと URL が ?meeting=m1 になる（pushState）
    searchParamsValue = 'meeting=m1'
    rerenderPage()

    // ブラウザの「戻る」で ?meeting= が外れた状態
    searchParamsValue = ''
    rerenderPage()
    pushSpy.mockClear()

    fireEvent.click(screen.getByText('定例MTG'))

    expect(pushSpy).toHaveBeenCalledWith(null, '', MINUTES_URL)
  })

  it('別の議事録へ移ったあとの「戻る」は、前の議事録ではなく一覧に帰る', () => {
    // 一覧 → 議事録A（履歴を積む）→ リンクなどで議事録B。「積んだ」印を議事録の id で持たないと、
    // B の「戻る」が history.back() になり A に帰ってしまう
    mockMeetingsList = [makeMeeting(), makeMeeting({ id: 'm2', title: '別のMTG' })]
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByText('定例MTG'))

    searchParamsValue = 'meeting=m1'
    rerenderPage()

    searchParamsValue = 'meeting=m2'
    rerenderPage()
    replaceSpy.mockClear()
    backSpy.mockClear()

    fireEvent.click(screen.getByText('戻る'))

    expect(replaceSpy).toHaveBeenCalledWith(null, '', LIST_URL)
    expect(backSpy).not.toHaveBeenCalled()
  })

  it('同じ行を続けて2回押しても、積む履歴は1つだけ（1回の「戻る」で一覧に帰れるように）', () => {
    // URL の反映は一拍遅れるので、素早く2回押すと押した時点ではまだ一覧が出ている。
    // 2回積むと1回目の「戻る」で同じ議事録に帰り、直そうとした症状と同じに見える
    renderPage()

    fireEvent.click(screen.getByText('定例MTG'))
    fireEvent.click(screen.getByText('定例MTG'))

    expect(pushSpy).toHaveBeenCalledTimes(1)
    // 2回目は履歴を積まずに差し替える（URL は同じ）
    expect(replaceSpy).toHaveBeenCalledWith(null, '', MINUTES_URL)
  })

  it('日程調整の行は履歴を積まない（議事録の文書ビューを持たないため）', () => {
    mockProposals = [
      {
        id: 'p1',
        title: '打ち合わせの候補',
        status: 'open',
        created_at: '2026-09-01T00:00:00',
        proposal_slots: [],
        proposal_respondents: [],
        respondentCount: 0,
        responseCount: 0,
      },
    ]
    renderPage()

    fireEvent.click(screen.getByTestId('proposal-row-p1'))

    expect(pushSpy).not.toHaveBeenCalled()
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/org-1/project/space-1/meetings?proposal=p1')
  })

  it('会議を新しく作って開いたときも履歴を積み、「戻る」で一覧に帰る', async () => {
    const { rerenderPage } = renderPage()

    await act(async () => {
      fireEvent.click(screen.getByText('この内容で作る'))
    })

    await waitFor(() =>
      expect(pushSpy).toHaveBeenCalledWith(null, '', '/org-1/project/space-1/meetings?meeting=m9')
    )

    mockMeetingsList = [makeMeeting({ id: 'm9', title: '新しい会議' })]
    searchParamsValue = 'meeting=m9'
    rerenderPage()
    replaceSpy.mockClear()

    fireEvent.click(screen.getByText('戻る'))

    expect(replaceSpy).toHaveBeenCalledWith(null, '', LIST_URL)
    expect(backSpy).not.toHaveBeenCalled()
  })

  it('開いている会議を削除したら、URL から ?meeting= を外す（消えた会議の URL を履歴に残さない）', async () => {
    searchParamsValue = 'meeting=m1'
    renderPage()
    await waitFor(() => expect(mockSetInspector).toHaveBeenCalled())
    const inspectorElement = mockSetInspector.mock.calls.at(-1)?.[0]
    replaceSpy.mockClear()

    await act(async () => {
      await inspectorElement.props.onDelete()
    })

    expect(mockDeleteMeeting).toHaveBeenCalledWith('m1')
    expect(replaceSpy).toHaveBeenCalledWith(null, '', LIST_URL)
  })

  it('開いたまま会議が削除されたら、次に開いた議事録の「戻る」で消えた会議に帰らない', () => {
    // 削除すると一覧に戻るが URL の ?meeting= は残る。印を「議事録の画面が出ているか」で
    // 落とさないと、次の議事録の「戻る」が history.back() になり、消えた会議の URL に帰る
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByText('定例MTG'))
    searchParamsValue = 'meeting=m1'
    rerenderPage()

    // ほかの人が削除した（一覧から消えた。URL の ?meeting= は残ったまま）
    mockMeetingsList = []
    rerenderPage()

    // 別の議事録をリンクから開く
    mockMeetingsList = [makeMeeting({ id: 'm2', title: '別のMTG' })]
    searchParamsValue = 'meeting=m2'
    rerenderPage()
    replaceSpy.mockClear()
    backSpy.mockClear()

    fireEvent.click(screen.getByText('戻る'))

    expect(replaceSpy).toHaveBeenCalledWith(null, '', LIST_URL)
    expect(backSpy).not.toHaveBeenCalled()
  })

  it('ブラウザの戻るで一覧に帰ったあと、リンクで開き直した議事録の「戻る」は履歴を戻さない', () => {
    // 一度開いたときの印が残っていると、直接開いた議事録で history.back() を呼んでしまい、
    // 一覧ではなく前のページへ飛ぶ。印は ?meeting= が外れた時点で落とす
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByText('定例MTG'))
    // 押すと URL が ?meeting=m1 になる（pushState）
    searchParamsValue = 'meeting=m1'
    rerenderPage()

    // ブラウザの「戻る」で一覧に帰る
    searchParamsValue = ''
    rerenderPage()

    // そのあとリンクから同じ議事録を直接開く
    searchParamsValue = 'meeting=m1'
    rerenderPage()
    replaceSpy.mockClear()
    backSpy.mockClear()

    fireEvent.click(screen.getByText('戻る'))

    expect(replaceSpy).toHaveBeenCalledWith(null, '', LIST_URL)
    expect(backSpy).not.toHaveBeenCalled()
  })
})
