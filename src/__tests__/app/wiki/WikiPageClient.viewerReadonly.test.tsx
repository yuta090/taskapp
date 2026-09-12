import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { WikiPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/wiki/WikiPageClient'
import type { WikiPage } from '@/types/database'

// 閲覧者（viewer）・相手先には Wiki の編集操作（新規ページ作成・本文編集・削除・
// バージョン復元・テンプレート適用）を出さない。

function page(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'p1',
    org_id: 'org1',
    space_id: 'space1',
    title: 'ページ1',
    body: '本文',
    tags: [],
    parent_page_id: null,
    milestone_id: null,
    pinned_at: null,
    sort_order: null,
    created_by: 'user1',
    updated_by: 'user1',
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

const PAGES: WikiPage[] = [page()]

const mockSetInspector = vi.fn()
let searchParamsValue = ''

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(searchParamsValue),
}))

vi.mock('@/components/layout', () => {
  // 全画面（AppShell）の状態。関数は1つだけ作って使い回す（毎レンダー作ると effect が走り直す）
  const setFullscreen = vi.fn()
  return {
    useInspector: () => ({ setInspector: mockSetInspector }),
    useShellFullscreen: () => ({ fullscreen: false, setFullscreen }),
  }
})

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({
    pages: PAGES,
    loading: false,
    autoCreatedPageId: null,
    fetchPages: vi.fn(),
    createPage: vi.fn(),
    updatePage: vi.fn(),
    deletePage: vi.fn(),
    fetchPage: vi.fn().mockResolvedValue(PAGES[0]),
    fetchVersions: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: [], loading: false }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: [{ id: 'user1', displayName: '田中', avatarUrl: null, role: 'viewer' }],
  }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user1' } }),
}))

vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: new Map(), loading: false }),
}))

// エディタ本体(Tiptap)は重いので、editable の値だけを検証できるように差し替える
vi.mock('@/components/wiki/WikiEditorDynamic', () => ({
  WikiEditorDynamic: ({ editable }: { editable: boolean }) => (
    <div data-testid="wiki-editor" data-editable={String(editable)} />
  ),
}))

vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: false, loading: false }),
}))

function setup() {
  return render(<WikiPageClient orgId="org1" spaceId="space1" />)
}

beforeEach(() => {
  searchParamsValue = ''
  mockSetInspector.mockClear()
})

describe('WikiPageClient — 閲覧者（viewer）には編集操作を出さない', () => {
  it('一覧の「新規ページ」ボタンが出ない', () => {
    setup()
    expect(screen.queryByRole('button', { name: '新規ページ' })).not.toBeInTheDocument()
  })

  it('ページを開くとエディタが編集不可(editable=false)になる', async () => {
    searchParamsValue = 'page=p1'
    setup()
    await waitFor(() => expect(screen.getByTestId('wiki-editor')).toHaveAttribute('data-editable', 'false'))
  })

  it('ページ情報パネル(WikiPageInspector)には編集用のコールバックを渡さない', async () => {
    searchParamsValue = 'page=p1'
    setup()

    await waitFor(() => expect(mockSetInspector.mock.calls.at(-1)?.[0]).toBeTruthy())
    const lastCallArg = mockSetInspector.mock.calls.at(-1)?.[0]
    expect(lastCallArg.props.onUpdate).toBeUndefined()
    expect(lastCallArg.props.onDelete).toBeUndefined()
    expect(lastCallArg.props.onRestoreVersion).toBeUndefined()
    // 履歴の閲覧自体は読み取りなので出したままでよい
    expect(lastCallArg.props.onFetchVersions).toBeInstanceOf(Function)
  })
})
