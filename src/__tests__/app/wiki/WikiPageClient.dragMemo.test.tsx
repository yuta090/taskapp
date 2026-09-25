import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { WikiPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/wiki/WikiPageClient'
import type { WikiPage } from '@/types/database'

// 表示速度レビュー指摘（PR5）: handleDropOnPage/handleDropOnRoot が draggingId・pages を
// useCallback の依存に持つと、ドラッグ開始・終了のたびに全行へ渡す onDropPage の参照が
// 変わり、WikiPageRow の memo が効かなくなる。draggingIdRef・pagesRef 越しに読むことで
// これらのハンドラの参照が安定していることを固定する回帰テスト。

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'p1',
    org_id: 'org1',
    space_id: 'space1',
    title: 'ページ1',
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

const PAGES: WikiPage[] = [
  page({ id: 'folder-a', title: 'フォルダA', is_folder: true }),
  page({ id: 'plain', title: '通常ページ' }),
]

// WikiPageRow が受け取った props を毎レンダー記録する。実物の WikiPageRow は memo 化
// されているため、ここでは「WikiPageClient が渡す props の参照」自体を検査したい
// （memo が実際に再描画を止めているかではなく、その前提となる参照の安定性を見る）。
const capturedProps = vi.hoisted(() => ({
  byId: new Map<string, Record<string, unknown>[]>(),
}))

vi.mock('@/components/wiki/WikiPageRow', () => ({
  WikiPageRow: (props: Record<string, unknown>) => {
    const page = props.page as WikiPage
    const list = capturedProps.byId.get(page.id) ?? []
    list.push(props)
    capturedProps.byId.set(page.id, list)
    return <div data-testid={`wiki-page-row-${page.id}`}>{page.title}</div>
  },
}))

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({
    announcements: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/layout', () => {
  const setFullscreen = vi.fn()
  return {
    useInspector: () => ({ setInspector: vi.fn() }),
    useShellFullscreen: () => ({ fullscreen: false, setFullscreen }),
  }
})

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

// useWikiPages の各関数は実物と同じく useCallback で安定した参照を持つ。ここで
// vi.fn() をモック factory の外（モジュール直下）で1回だけ作るのは、その前提を
// 再現するため — factory の中で毎回 vi.fn() を作ると、実物では起きない「毎レンダー
// updatePage の参照が変わる」を紛れ込ませてしまい、このテストの意味が無くなる。
const mockUpdatePage = vi.fn().mockResolvedValue({ updatedAt: '2026-09-02T00:00:00+09:00' })
const mockReparentPages = vi.fn().mockResolvedValue(undefined)
const mockCreatePage = vi.fn()
const mockDeletePage = vi.fn()
const mockFetchPage = vi.fn().mockResolvedValue(null)
const mockFetchPages = vi.fn()
const mockFetchVersions = vi.fn()

vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({
    pages: PAGES,
    loading: false,
    autoCreatedPageId: null,
    fetchPages: mockFetchPages,
    createPage: mockCreatePage,
    updatePage: mockUpdatePage,
    reparentPages: mockReparentPages,
    deletePage: mockDeletePage,
    fetchPage: mockFetchPage,
    fetchVersions: mockFetchVersions,
  }),
}))

vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: [], loading: false }),
}))

const NO_REFERENCING_TASKS = vi.hoisted(() => [] as never[])
vi.mock('@/lib/hooks/useWikiPageReferencingTasks', () => ({
  useWikiPageReferencingTasks: () => ({ tasks: NO_REFERENCING_TASKS, loading: false, error: null }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: [{ id: 'user1', displayName: '田中', avatarUrl: null, role: 'admin' }],
  }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user1' } }),
}))

vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, loading: false }),
}))

vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: new Map(), loading: false }),
}))

vi.mock('@/lib/hooks/useWikiDecisionCounts', () => ({
  useWikiDecisionCounts: () => ({ countsByPageId: new Map(), loading: false }),
}))

function setup() {
  render(<WikiPageClient orgId="org1" spaceId="space1" />)
}

describe('WikiPageClient ドラッグ中の memo 安定性（表示速度レビュー指摘）', () => {
  beforeEach(() => {
    localStorage.clear()
    capturedProps.byId.clear()
  })

  it('ドラッグ開始・終了しても onDropPage/onDragStartPage の参照は変わらない', () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-view-folder'))

    const before = capturedProps.byId.get('plain')!.at(-1)!
    const beforeOnDropPage = before.onDropPage
    const beforeOnDragStartPage = before.onDragStartPage

    // ドラッグ開始（folder-a をつかむ）→ WikiPageClient の draggingId(state) が変わり
    // 再レンダーが起きる
    const folderRowProps = capturedProps.byId.get('folder-a')!.at(-1)!
    act(() => {
      ;(folderRowProps.onDragStartPage as (id: string) => void)('folder-a')
    })

    const afterStart = capturedProps.byId.get('plain')!.at(-1)!
    expect(afterStart.onDropPage).toBe(beforeOnDropPage)
    expect(afterStart.onDragStartPage).toBe(beforeOnDragStartPage)

    // ドラッグ終了でも同様
    act(() => {
      ;(afterStart.onDragEndPage as () => void)()
    })
    const afterEnd = capturedProps.byId.get('plain')!.at(-1)!
    expect(afterEnd.onDropPage).toBe(beforeOnDropPage)
  })
})
