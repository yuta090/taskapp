import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { WikiPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/wiki/WikiPageClient'
import type { WikiPage } from '@/types/database'

/**
 * ページ情報パネルの「このページを参照しているタスク」の配線。
 * 開いているページの id で取得し、担当者の名前は一覧と同じメンバー一覧から引いて渡す。
 */

const PAGE: WikiPage = {
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
}

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('page=p1'),
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
vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({
    pages: [PAGE],
    loading: false,
    autoCreatedPageId: null,
    fetchPages: vi.fn(),
    createPage: vi.fn(),
    updatePage: vi.fn().mockResolvedValue(undefined),
    deletePage: vi.fn(),
    fetchPage: mockFetchPage,
    fetchVersions: vi.fn(),
  }),
}))
vi.mock('@/lib/hooks/useMilestones', () => ({ useMilestones: () => ({ milestones: [], loading: false }) }))
vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ members: [{ id: 'user2', displayName: '佐藤', avatarUrl: null }] }),
}))
vi.mock('@/lib/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ user: { id: 'user1' } }) }))
vi.mock('@/lib/hooks/useCanEditSpace', () => ({ useCanEditSpace: () => ({ canEdit: true, loading: false }) }))
vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: new Map(), loading: false }),
}))
vi.mock('@/lib/hooks/useWikiDecisionCounts', () => ({
  useWikiDecisionCounts: () => ({ countsByPageId: new Map(), loading: false }),
}))
const mockUseReferencingTasks = vi.hoisted(() => vi.fn())
// 本文の投票ブロックの先読み（中身はエディタ側で確かめる。ここでは画面の配線だけを見る）
vi.mock('@/lib/hooks/useDocPolls', () => ({ usePrefetchDocPolls: () => {} }))

vi.mock('@/lib/hooks/useWikiPageReferencingTasks', () => ({
  useWikiPageReferencingTasks: mockUseReferencingTasks,
}))
vi.mock('@/components/wiki/WikiPageInspector', () => ({
  WikiPageInspector: () => <div data-testid="wiki-page-inspector-stub" />,
}))
vi.mock('@/components/wiki/WikiEditorDynamic', () => ({
  WikiEditorDynamic: () => <div data-testid="wiki-editor-stub" />,
}))

const ROWS = [
  { id: 't1', org_id: 'org1', space_id: 'space1', short_id: 1, title: 'A', status: 'todo', assignee_id: 'user2' },
  { id: 't2', org_id: 'org1', space_id: 'space1', short_id: 2, title: 'B', status: 'todo', assignee_id: 'gone' },
  { id: 't3', org_id: 'org1', space_id: 'space1', short_id: 3, title: 'C', status: 'todo', assignee_id: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockFetchPage.mockResolvedValue(PAGE)
  mockUseReferencingTasks.mockReturnValue({ tasks: ROWS, loading: false, error: null })
})

describe('WikiPageClient — 参照しているタスク', () => {
  it('開いているページの id で取得し、担当者名を付けてページ情報パネルに渡す', async () => {
    render(<WikiPageClient orgId="org1" spaceId="space1" />)
    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).not.toBeNull())

    expect(mockUseReferencingTasks).toHaveBeenLastCalledWith('org1', 'space1', 'p1')
    const props = mockSetInspector.mock.calls.at(-1)?.[0].props
    expect(props.referencingTasks.map((t: { id: string; assigneeName: string | null }) => [t.id, t.assigneeName])).toEqual([
      ['t1', '佐藤'],
      // メンバー一覧に居ない人（抜けた人・権限で名前が読めない人）は空欄にせず「メンバー外」と出す
      ['t2', '（メンバー外）'],
      ['t3', null],
    ])
    expect(props.referencingTasksLoading).toBe(false)
    expect(props.referencingTasksError).toBe(false)
  })
})
