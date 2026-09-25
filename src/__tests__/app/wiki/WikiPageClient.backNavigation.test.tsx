import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { WikiPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/wiki/WikiPageClient'
import type { WikiPage } from '@/types/database'

/**
 * Wiki のページを1つ開いてから「戻る」を押すと、ページ一覧ではなく、その前に見ていたページが
 * 出ていた（議事録と同じ症状。`updateQuery` が URL を差し替えるだけで履歴を増やしていなかった）。
 *
 * 直し方は議事録（MeetingsPageClient）と同じ:
 * 一覧からページを開くときだけ履歴を1つ積み、画面の「戻る」はその履歴を1つ戻す。
 * リンクやお知らせから直接 ?page= で開いたときは、これまでどおり URL を差し替えて一覧に戻す。
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

const PAGES = [makePage(), makePage({ id: 'p2', title: '議事メモ' })]

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

const mockFetchPage = vi.hoisted(() => vi.fn())
const mockCreatePage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({
    pages: PAGES,
    loading: false,
    autoCreatedPageId: null,
    fetchPages: vi.fn(),
    createPage: mockCreatePage,
    updatePage: vi.fn().mockResolvedValue(undefined),
    deletePage: vi.fn(),
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
vi.mock('@/lib/hooks/useWikiPageReferencingTasks', () => ({
  useWikiPageReferencingTasks: () => ({ tasks: NO_REFERENCING_TASKS, loading: false, error: null }),
}))
vi.mock('@/components/wiki/WikiPageInspector', () => ({
  WikiPageInspector: () => <div data-testid="wiki-page-inspector-stub" />,
}))
vi.mock('@/components/wiki/WikiEditorDynamic', () => ({
  WikiEditorDynamic: () => <div data-testid="wiki-editor-stub" />,
}))
// 新規作成シートは、押すと onSubmit が走るだけの代役にする（入力の再現は目的ではない）
vi.mock('@/components/wiki/WikiCreateSheet', () => ({
  WikiCreateSheet: (props: { onSubmit: (data: { title: string }) => void }) => (
    <button onClick={() => props.onSubmit({ title: '新しいページ' })}>この内容で作る</button>
  ),
}))

const LIST_URL = '/org1/project/space1/wiki'
const PAGE_URL = '/org1/project/space1/wiki?page=p1'

function renderPage() {
  const ui = () => <WikiPageClient orgId="org1" spaceId="space1" />
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
  mockFetchPage.mockResolvedValue(PAGES[0])
  mockCreatePage.mockResolvedValue(makePage({ id: 'p9', title: '新しいページ' }))
  pushSpy = vi.spyOn(window.history, 'pushState').mockImplementation(() => {})
  replaceSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
  backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('WikiPageClient — ページを開いたあとの「戻る」', () => {
  it('一覧からページを開くと履歴を1つ積む（ブラウザの戻るで一覧に帰れるように）', () => {
    renderPage()

    fireEvent.click(screen.getByText('設計メモ'))

    expect(pushSpy).toHaveBeenCalledWith(null, '', PAGE_URL)
    expect(replaceSpy).not.toHaveBeenCalled()
  })

  it('画面の「戻る」は、履歴を戻さず必ず一覧の URL にする（押したら必ず一覧が出る）', async () => {
    // 実ブラウザでの確認で、履歴を戻す方式だと「ブラウザの戻るで一覧 → もう一度開く」のあとに
    // 一覧を飛び越してダッシュボードまで戻った。押したら必ず一覧、を優先する
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByText('設計メモ'))

    searchParamsValue = 'page=p1'
    rerenderPage()
    await waitFor(() => expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument())
    replaceSpy.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '一覧へ戻る' }))

    expect(replaceSpy).toHaveBeenCalledWith(null, '', LIST_URL)
    expect(backSpy).not.toHaveBeenCalled()
  })

  it('リンクから直接開いたときの「戻る」は、履歴を戻さず一覧の URL に差し替える', async () => {
    searchParamsValue = 'page=p1'
    renderPage()
    await waitFor(() => expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '一覧へ戻る' }))

    expect(replaceSpy).toHaveBeenCalledWith(null, '', LIST_URL)
    expect(backSpy).not.toHaveBeenCalled()
  })

  it('本文のリンクで別のページへ移ったあとの「戻る」は、前のページではなく一覧に帰る', async () => {
    // 一覧 → ページA（履歴を積む）→ 本文のリンクでページB（router.push で履歴がもう1つ増える）。
    // 「積んだ」印をページの id で持たないと、B の「戻る」が history.back() になり A に帰ってしまう
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByText('設計メモ'))

    searchParamsValue = 'page=p1'
    rerenderPage()
    await waitFor(() => expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument())

    // 本文のリンクでページBへ（この移動は Next の router.push なので pushState の印は付かない）
    mockFetchPage.mockResolvedValue(PAGES[1])
    searchParamsValue = 'page=p2'
    rerenderPage()
    await waitFor(() => expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument())
    replaceSpy.mockClear()
    backSpy.mockClear()

    fireEvent.click(screen.getByRole('button', { name: '一覧へ戻る' }))

    expect(replaceSpy).toHaveBeenCalledWith(null, '', LIST_URL)
    expect(backSpy).not.toHaveBeenCalled()
  })

  it('ページを新しく作って開いたときも履歴を積む（「戻る」で一覧に帰れるように）', async () => {
    renderPage()

    await act(async () => {
      fireEvent.click(screen.getByText('この内容で作る'))
    })

    await waitFor(() =>
      expect(pushSpy).toHaveBeenCalledWith(null, '', '/org1/project/space1/wiki?page=p9')
    )
  })

  it('デスクトップのページ情報パネルの×も、一覧に帰る（直接開いたときは URL を差し替える）', async () => {
    searchParamsValue = 'page=p1'
    renderPage()
    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).not.toBeNull())
    const panel = mockSetInspector.mock.calls.at(-1)?.[0]
    replaceSpy.mockClear()

    panel.props.onClose()

    expect(replaceSpy).toHaveBeenCalledWith(null, '', LIST_URL)
    expect(backSpy).not.toHaveBeenCalled()
  })

  it('同じ行を続けて2回押しても、積む履歴は1つだけ', () => {
    renderPage()

    fireEvent.click(screen.getByText('設計メモ'))
    fireEvent.click(screen.getByText('設計メモ'))

    expect(pushSpy).toHaveBeenCalledTimes(1)
  })

  it('ブラウザの戻るで一覧に帰ったあと、もう一度開いてもまた履歴を積む', async () => {
    const { rerenderPage } = renderPage()
    fireEvent.click(screen.getByText('設計メモ'))

    searchParamsValue = 'page=p1'
    rerenderPage()
    await waitFor(() => expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument())

    // ブラウザの「戻る」で ?page= が外れた状態
    searchParamsValue = ''
    rerenderPage()
    pushSpy.mockClear()

    fireEvent.click(screen.getByText('設計メモ'))

    expect(pushSpy).toHaveBeenCalledWith(null, '', PAGE_URL)
  })

})
