import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { WikiPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/wiki/WikiPageClient'
import type { WikiPage } from '@/types/database'

/**
 * スマホで Wiki のページを開き、情報ボタンでページ情報のシートを出した状態で端末の「戻る」を
 * 押すと、シートが閉じるのではなくページごと閉じていた（議事録と同じ症状）。
 *
 * 直し方も議事録と同じ: シートの開閉を URL（?info=1）に載せ、開くときに履歴を1つ積む。
 */

function makePage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'p1',
    org_id: 'org1',
    space_id: 'space1',
    title: '設計メモ',
    body: '',
    tags: [],
    parent_page_id: null,
    milestone_id: null,
    pinned_at: null,
    sort_order: null,
    is_folder: false,
    created_by: 'user1',
    updated_by: 'user1',
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

const PAGE = makePage()

let searchParamsValue = 'page=p1'

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

const mockFetchPage = vi.hoisted(() => vi.fn())
const mockDeletePage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({
    pages: [PAGE],
    loading: false,
    autoCreatedPageId: null,
    fetchPages: vi.fn(),
    createPage: vi.fn(),
    updatePage: vi.fn().mockResolvedValue(undefined),
    deletePage: mockDeletePage,
    fetchPage: mockFetchPage,
    fetchVersions: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useMilestones', () => ({ useMilestones: () => ({ milestones: [], loading: false }) }))
vi.mock('@/lib/hooks/useSpaceMembers', () => ({ useSpaceMembers: () => ({ members: [] }) }))
vi.mock('@/lib/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { id: 'user1' } }) }))
vi.mock('@/lib/hooks/useCanEditSpace', () => ({ useCanEditSpace: () => ({ canEdit: true, loading: false }) }))
vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: new Map(), loading: false }),
}))
vi.mock('@/lib/hooks/useWikiDecisionCounts', () => ({
  useWikiDecisionCounts: () => ({ countsByPageId: new Map(), loading: false }),
}))
// 参照しているタスクの取得。毎回同じ配列を返す（新しい配列だとページ情報パネルを毎回作り直す）
const NO_REFERENCING_TASKS = vi.hoisted(() => [] as never[])
// 本文の投票ブロックの先読み（中身はエディタ側で確かめる。ここでは画面の配線だけを見る）
vi.mock('@/lib/hooks/useDocPolls', () => ({ usePrefetchDocPolls: () => {} }))

vi.mock('@/lib/hooks/useWikiPageReferencingTasks', () => ({
  useWikiPageReferencingTasks: () => ({ tasks: NO_REFERENCING_TASKS, loading: false, error: null }),
}))
vi.mock('@/components/wiki/WikiPageInspector', () => ({
  WikiPageInspector: () => <div data-testid="wiki-page-inspector-stub" />,
}))
vi.mock('@/components/wiki/WikiEditorDynamic', () => ({
  WikiEditorDynamic: () => <div data-testid="wiki-editor-stub" />,
}))

const INFO_URL = '/org1/project/space1/wiki?page=p1&info=1'

function renderPage() {
  const ui = () => <WikiPageClient orgId="org1" spaceId="space1" />
  const utils = render(ui())
  const rerenderPage = () => utils.rerender(ui())
  return { ...utils, rerenderPage }
}

let pushSpy: ReturnType<typeof vi.spyOn>
let replaceSpy: ReturnType<typeof vi.spyOn>
let backSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.clearAllMocks()
  searchParamsValue = 'page=p1'
  mockFetchPage.mockResolvedValue(PAGE)
  mockDeletePage.mockResolvedValue(undefined)
  pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
  replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
  backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WikiPageClient — スマホのページ情報シートと端末の「戻る」', () => {
  it('情報ボタンでシートを開くと、URL に info=1 を足して履歴を1つ積む', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'ページ情報' }))

    expect(pushSpy).toHaveBeenCalledWith(null, '', INFO_URL)
  })

  it('info=1 が付いているあいだだけ、スマホでもページ情報（シート）を出す', async () => {
    const { rerenderPage } = renderPage()
    await waitFor(() => expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument())
    expect(mockSetInspector.mock.calls.at(-1)?.[0]).toBeNull()

    searchParamsValue = 'page=p1&info=1'
    rerenderPage()

    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).not.toBeNull())
  })

  it('端末の「戻る」で info=1 が外れたら、ページは開いたままシートだけ閉じる', async () => {
    searchParamsValue = 'page=p1&info=1'
    const { rerenderPage } = renderPage()
    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).not.toBeNull())

    searchParamsValue = 'page=p1'
    rerenderPage()

    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).toBeNull())
    expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument()
  })

  it('端末の「戻る」でシートを閉じたあと、もう一度開いてもまた履歴を積む', async () => {
    const { rerenderPage } = renderPage()
    await waitFor(() => expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'ページ情報' }))

    searchParamsValue = 'page=p1&info=1'
    rerenderPage()
    // 端末の「戻る」で ?info= が外れた状態
    searchParamsValue = 'page=p1'
    rerenderPage()
    pushSpy.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'ページ情報' }))

    expect(pushSpy).toHaveBeenCalledWith(null, '', INFO_URL)
  })

  it('シートからページを削除したら、URL から ?info= も外す', async () => {
    searchParamsValue = 'page=p1&info=1'
    renderPage()
    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).not.toBeNull())
    const sheet = mockSetInspector.mock.calls.at(-1)?.[0]
    replaceSpy.mockClear()

    await act(async () => {
      await sheet.props.onDelete()
    })

    expect(mockDeletePage).toHaveBeenCalledWith('p1')
    expect(replaceSpy).toHaveBeenCalledWith(null, '', '/org1/project/space1/wiki')
  })

  it('×を続けて2回押しても、履歴を戻すのは1回だけ', async () => {
    const { rerenderPage } = renderPage()
    await waitFor(() => expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'ページ情報' }))

    searchParamsValue = 'page=p1&info=1'
    rerenderPage()
    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).not.toBeNull())
    const sheet = mockSetInspector.mock.calls.at(-1)?.[0]
    backSpy.mockClear()
    replaceSpy.mockClear()

    // history.back() は戻り切るまで一拍ある。その間の2回目で「差し替え」に回ると履歴を1つ余分に食う
    sheet.props.onClose()
    sheet.props.onClose()

    expect(backSpy).toHaveBeenCalledTimes(1)
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('シートの×で閉じるときは、積んだ履歴を1つ戻す', async () => {
    const { rerenderPage } = renderPage()
    await waitFor(() => expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'ページ情報' }))

    // 押すと URL が ?info=1 になる（pushState）
    searchParamsValue = 'page=p1&info=1'
    rerenderPage()
    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).not.toBeNull())
    const sheet = mockSetInspector.mock.calls.at(-1)?.[0]
    backSpy.mockClear()

    sheet.props.onClose()

    expect(backSpy).toHaveBeenCalledTimes(1)
  })
})
