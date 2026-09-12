import React, { forwardRef, useImperativeHandle } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { MeetingsPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/meetings/MeetingsPageClient'
import type { Meeting } from '@/types/database'

// 会議を選んだら一覧の代わりに議事録の文書ビューを出す（Wiki のエディタビューと同じ考え方）。
// タスク化ボタンを押す前に、文書ビューの保留中の保存を流してから parseMinutes に渡す。
//
// 表示速度: 会議の選択・戻る・閉じるは router.replace ではなく window.history.replaceState
// で URL を変える（手本: TasksPageClient.tsx）。ここでは history.replaceState の呼び出しを
// 直接検証する。

let searchParamsValue = 'meeting=m1'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}))

const mockSetInspector = vi.fn()
// 全画面表示（Wiki の WikiPageClient.fullscreen.test.tsx と同じ手法）: useShellFullscreen は
// AppShell の状態そのものなので、1画面分の state で代用し、呼び出しを mockSetShellFullscreen で見る
const mockSetShellFullscreen = vi.hoisted(() => vi.fn())
vi.mock('@/components/layout', async () => {
  const React = await import('react')
  return {
    useInspector: () => ({ setInspector: mockSetInspector }),
    useShellFullscreen: () => {
      const [fullscreen, setLocal] = React.useState(false)
      const setFullscreen = React.useCallback((value: boolean) => {
        mockSetShellFullscreen(value)
        setLocal(value)
      }, [])
      return { fullscreen, setFullscreen }
    },
  }
})

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
const mockPreviewMinutes = vi.fn()
// 「全画面中に他の人が会議を削除する」を再現するために、一覧を差し替え可能にしておく
// （通常は固定の1件。テストの中で配列そのものを書き換えてから rerenderPage する）
let mockMeetingsList: Meeting[] = [makeMeeting()]

vi.mock('@/lib/hooks/useMeetings', () => ({
  useMeetings: () => ({
    meetings: mockMeetingsList,
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
    previewMinutes: mockPreviewMinutes,
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
const mockEnsureUpToDate = vi.fn().mockResolvedValue(undefined)
const mockGetBaseUpdatedAt = vi.fn().mockReturnValue('2026-09-01T00:00:00.111111+00')
const mockGetKnownRaw = vi.fn().mockReturnValue('flushed-content')
const mockConfirmLeave = vi.fn().mockResolvedValue(true)

interface FakeHandle {
  flushPendingSave: () => Promise<string>
  ensureUpToDate: () => Promise<void>
  getBaseUpdatedAt: () => string | null
  getKnownRaw: () => string | null
  confirmLeave: () => Promise<boolean>
}

vi.mock('@/components/meeting/MinutesDocumentView', () => ({
  MinutesDocumentView: forwardRef(function FakeMinutesDocumentView(
    props: {
      onBack: () => void
      meeting: Meeting
      fullscreen?: boolean
      onToggleFullscreen?: () => void
    },
    ref: React.Ref<FakeHandle>
  ) {
    useImperativeHandle(ref, () => ({
      flushPendingSave: mockFlushPendingSave,
      ensureUpToDate: mockEnsureUpToDate,
      getBaseUpdatedAt: mockGetBaseUpdatedAt,
      getKnownRaw: mockGetKnownRaw,
      confirmLeave: mockConfirmLeave,
    }))
    return (
      <div data-testid="minutes-document-view" data-fullscreen={String(!!props.fullscreen)}>
        <span>{props.meeting.title}</span>
        <button onClick={props.onBack}>戻る</button>
        {/* 実際の全画面ボタン(MinutesDocumentView.fullscreen.test.tsx)の代わりに、
            MeetingsPageClient から渡された onToggleFullscreen をそのまま叩けるボタンを置く */}
        {props.onToggleFullscreen && (
          <button onClick={props.onToggleFullscreen}>全画面切替</button>
        )}
      </div>
    )
  }),
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ui = () => (
    <QueryClientProvider client={queryClient}>
      <MeetingsPageClient orgId="org-1" spaceId="space-1" />
    </QueryClientProvider>
  )
  const utils = render(ui())
  // 一覧(mockMeetingsList)や searchParamsValue を書き換えた後、改めて描き直すためのヘルパー。
  // モックの外側の値なので、React の state 更新経由では拾えない（明示的に再描画を頼む）。
  const rerenderPage = () => utils.rerender(ui())
  return { ...utils, rerenderPage }
}

let historyReplaceSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  searchParamsValue = 'meeting=m1'
  mockMeetingsList = [makeMeeting()]
  mockFlushPendingSave.mockResolvedValue('flushed-content')
  mockEnsureUpToDate.mockResolvedValue(undefined)
  mockGetKnownRaw.mockReturnValue('flushed-content')
  mockConfirmLeave.mockResolvedValue(true)
  mockFetchMeetingDetail.mockResolvedValue(makeMeeting())
  mockParseMinutes.mockResolvedValue({ createdCount: 1, createdTasks: [], updatedMinutes: 'flushed-content' })
  mockPreviewMinutes.mockResolvedValue({ newSpecCount: 0, existingSpecCount: 0, newSpecs: [], existingSpecs: [] })
  historyReplaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
})

describe('MeetingsPageClient 議事録の文書ビュー', () => {
  it('?meeting= があると一覧の代わりに文書ビューを出す', () => {
    renderPage()
    expect(screen.getByTestId('minutes-document-view')).toBeInTheDocument()
    expect(screen.getByText('定例MTG')).toBeInTheDocument()
  })

  it('戻るを押すと window.history.replaceState で ?meeting= を外したURLに変える', () => {
    renderPage()
    fireEvent.click(screen.getByText('戻る'))
    expect(historyReplaceSpy).toHaveBeenCalledWith(null, '', '/org-1/project/space-1/meetings')
  })

  it('Inspectorの×（一覧へ戻る）は文書ビューのconfirmLeaveを確認してから戻る', async () => {
    renderPage()
    await waitFor(() => expect(mockSetInspector).toHaveBeenCalled())
    const lastInspectorElement = mockSetInspector.mock.calls.at(-1)?.[0]

    await act(async () => {
      lastInspectorElement.props.onClose()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockConfirmLeave).toHaveBeenCalledTimes(1)
    expect(historyReplaceSpy).toHaveBeenCalledWith(null, '', '/org-1/project/space-1/meetings')
  })

  it('MEDIUM-B: confirmLeaveがfalse(キャンセル)ならInspectorの×では戻らない', async () => {
    mockConfirmLeave.mockResolvedValue(false)
    renderPage()
    await waitFor(() => expect(mockSetInspector).toHaveBeenCalled())
    const lastInspectorElement = mockSetInspector.mock.calls.at(-1)?.[0]

    await act(async () => {
      lastInspectorElement.props.onClose()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(historyReplaceSpy).not.toHaveBeenCalled()
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
    // flush 確定後、RPC を呼ぶ前にもう一度サーバーの状態を確かめる(HIGH-1/HIGH-A)
    expect(mockEnsureUpToDate).toHaveBeenCalledTimes(1)
    expect(mockParseMinutes).toHaveBeenCalledWith('m1', 'flushed-content')
  })

  it('HIGH-N3: 一覧のキャッシュ(minutes_md)が古くても、文書ビューのgetKnownRawの本文でプレビューする', async () => {
    // 一覧のキャッシュが minutes_md 無しの行に置き換わった状態を模す
    mockGetKnownRaw.mockReturnValue('文書ビューの生の本文')
    renderPage()
    await waitFor(() => expect(mockSetInspector).toHaveBeenCalled())
    const lastInspectorElement = mockSetInspector.mock.calls.at(-1)?.[0]

    await act(async () => {
      await lastInspectorElement.props.onPreviewMinutes('m1')
    })

    expect(mockPreviewMinutes).toHaveBeenCalledWith('m1', '文書ビューの生の本文')
  })

  it('HIGH-A: ensureUpToDate が例外を投げたらタスク化を中止する（会議終了直後などの見せかけの競合は自己修復されて通る）', async () => {
    renderPage()
    await waitFor(() => expect(mockSetInspector).toHaveBeenCalled())
    const lastInspectorElement = mockSetInspector.mock.calls.at(-1)?.[0]

    mockEnsureUpToDate.mockRejectedValue(new Error('この議事録は、別の場所で更新されています'))

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

describe('MeetingsPageClient 議事録の全画面表示（Wiki と同じ「全画面」）', () => {
  it('議事録を閉じる（戻る）と全画面表示が解除される', async () => {
    renderPage()
    fireEvent.click(screen.getByText('全画面切替'))
    expect(screen.getByTestId('minutes-document-view')).toHaveAttribute('data-fullscreen', 'true')

    mockSetShellFullscreen.mockClear()
    fireEvent.click(screen.getByText('戻る'))

    expect(mockSetShellFullscreen).toHaveBeenCalledWith(false)
    expect(historyReplaceSpy).toHaveBeenCalledWith(null, '', '/org-1/project/space-1/meetings')
  })

  it('Escキーで全画面表示を終了する（IME変換中のEscでは終了しない）', async () => {
    renderPage()
    fireEvent.click(screen.getByText('全画面切替'))
    expect(screen.getByTestId('minutes-document-view')).toHaveAttribute('data-fullscreen', 'true')

    fireEvent.keyDown(document, { key: 'Escape', isComposing: true })
    expect(screen.getByTestId('minutes-document-view')).toHaveAttribute('data-fullscreen', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByTestId('minutes-document-view')).toHaveAttribute('data-fullscreen', 'false')
  })

  it('全画面のあいだは会議詳細（Inspector）を閉じる', async () => {
    renderPage()
    await waitFor(() => expect(mockSetInspector).toHaveBeenCalled())
    mockSetInspector.mockClear()

    fireEvent.click(screen.getByText('全画面切替'))

    await waitFor(() => expect(mockSetInspector).toHaveBeenLastCalledWith(null))
  })

  it('会議一覧の画面を離れる（アンマウント）と全画面表示を解除する', async () => {
    const { unmount } = renderPage()
    fireEvent.click(screen.getByText('全画面切替'))
    mockSetShellFullscreen.mockClear()

    unmount()

    expect(mockSetShellFullscreen).toHaveBeenCalledWith(false)
  })

  // レビュー指摘: 全画面で書いている最中に、ほかの人がその会議を消す・日程調整に切り替わる
  // などで議事録の文書ビューが出せなくなったとき、「全画面を閉じる」ボタンは文書ビューの
  // 中にしか無いため、Esc以外に抜け道が無くなってしまう。Wiki（ページが無くなったら解除）
  // と同じ保険が MeetingsPageClient 側に効いていることを確かめる。
  it('全画面中に、ほかの人がその会議を削除すると全画面表示が解除され、一覧が描かれる', () => {
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByText('全画面切替'))
    expect(screen.getByTestId('minutes-document-view')).toHaveAttribute('data-fullscreen', 'true')

    mockSetShellFullscreen.mockClear()
    // 他の人が削除した(一覧から消えた)状況を模す
    mockMeetingsList = []
    rerenderPage()

    expect(mockSetShellFullscreen).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId('minutes-document-view')).not.toBeInTheDocument()
  })

  it('会議を選んだまま日程調整(proposal)のパラメータが付くと、全画面表示が解除される', () => {
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByText('全画面切替'))
    expect(screen.getByTestId('minutes-document-view')).toHaveAttribute('data-fullscreen', 'true')

    mockSetShellFullscreen.mockClear()
    searchParamsValue = 'meeting=m1&proposal=p1'
    rerenderPage()

    expect(mockSetShellFullscreen).toHaveBeenCalledWith(false)
    expect(screen.queryByTestId('minutes-document-view')).not.toBeInTheDocument()
  })
})
