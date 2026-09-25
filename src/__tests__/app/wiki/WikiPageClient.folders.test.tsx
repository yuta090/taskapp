import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { WikiPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/wiki/WikiPageClient'
import type { WikiPage, Milestone } from '@/types/database'

// PR5（フォルダの作成・名前変更・削除・ドラッグ移動）の配線を確かめる統合テスト。
// 純粋ロジック（childrenReparentTargets・isValidWikiDropTarget・buildWikiTree の
// フォルダ先出し）は listView.test.ts で境界を押さえているため、ここでは
// 「WikiPageClient が正しい入力で hooks を呼び出しているか」だけを見る。

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

function milestone(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: 'm1',
    org_id: 'org1',
    space_id: 'space1',
    name: 'マイルストーンA',
    start_date: null,
    due_date: null,
    order_key: 0,
    completed_at: null,
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

const mockPages = vi.hoisted(() => ({
  current: [] as WikiPage[],
}))
const mockCreatePage = vi.fn().mockResolvedValue(page({ id: 'new-folder' }))
const mockUpdatePage = vi.fn().mockResolvedValue({ updatedAt: '2026-09-02T00:00:00+09:00' })
const mockDeletePage = vi.fn().mockResolvedValue(undefined)

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

vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({
    pages: mockPages.current,
    loading: false,
    autoCreatedPageId: null,
    fetchPages: vi.fn(),
    createPage: mockCreatePage,
    updatePage: mockUpdatePage,
    deletePage: mockDeletePage,
    fetchPage: vi.fn().mockResolvedValue(null),
    fetchVersions: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: [milestone()], loading: false }),
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

function dataTransfer() {
  return { effectAllowed: '', dropEffect: '' } as unknown as DataTransfer
}

describe('WikiPageClient フォルダ操作（PR5）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockCreatePage.mockResolvedValue(page({ id: 'new-folder' }))
    mockUpdatePage.mockResolvedValue({ updatedAt: '2026-09-02T00:00:00+09:00' })
    mockDeletePage.mockResolvedValue(undefined)
    mockPages.current = [
      page({ id: 'folder-a', title: 'フォルダA', is_folder: true }),
      page({ id: 'child-in-a', title: '子ページ', parent_page_id: 'folder-a' }),
      page({ id: 'plain', title: '通常ページ' }),
    ]
  })

  it('「新しいフォルダ」を押すとフォルダ表示に切り替わりインライン入力が出る', () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-new-folder'))
    expect(screen.getByTestId('wiki-view-folder')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('wiki-inline-create-row')).toBeInTheDocument()
  })

  it('名前を確定すると isFolder:true で createPage を呼び、入力行を閉じる', async () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-new-folder'))
    const input = screen.getByRole('textbox', { name: 'フォルダ名' })
    fireEvent.change(input, { target: { value: '議事録' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mockCreatePage).toHaveBeenCalledWith({ title: '議事録', isFolder: true }))
    await waitFor(() => expect(screen.queryByTestId('wiki-inline-create-row')).not.toBeInTheDocument())
  })

  it('Escape で入力行を閉じ、createPage は呼ばれない', () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-new-folder'))
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'フォルダ名' }), { key: 'Escape' })
    expect(screen.queryByTestId('wiki-inline-create-row')).not.toBeInTheDocument()
    expect(mockCreatePage).not.toHaveBeenCalled()
  })

  it('フォルダ行はフォルダアイコンが出る（一覧表示でも）', () => {
    setup()
    const row = screen.getByTestId('wiki-page-row-folder-a')
    expect(within(row).getByTestId('wiki-folder-icon')).toBeInTheDocument()
  })

  it('フォルダ行のタイトルをダブルクリックして名前を変更すると updatePage が呼ばれる', () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-view-folder'))
    fireEvent.doubleClick(screen.getByText('フォルダA'))
    const input = screen.getByDisplayValue('フォルダA')
    fireEvent.change(input, { target: { value: '新フォルダ名' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(mockUpdatePage).toHaveBeenCalledWith('folder-a', { title: '新フォルダ名' })
  })

  it('フォルダの削除は確認をはさみ、子を1つ上へ付け替えてから削除する', async () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-view-folder'))
    fireEvent.click(within(screen.getByTestId('wiki-page-row-folder-a')).getByLabelText('フォルダの操作'))
    fireEvent.click(screen.getByText('削除'))

    // 確認ダイアログが出る
    expect(screen.getByText(/中のページは1つ上の階層に移ります/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('削除する'))

    await waitFor(() => expect(mockUpdatePage).toHaveBeenCalledWith('child-in-a', { parent_page_id: null }))
    await waitFor(() => expect(mockDeletePage).toHaveBeenCalledWith('folder-a'))
  })

  it('確認でキャンセルすると何も呼ばれない', () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-view-folder'))
    fireEvent.click(within(screen.getByTestId('wiki-page-row-folder-a')).getByLabelText('フォルダの操作'))
    fireEvent.click(screen.getByText('削除'))
    fireEvent.click(screen.getByText('キャンセル'))
    expect(mockDeletePage).not.toHaveBeenCalled()
  })

  it('ドラッグでフォルダの上に落とすと updatePage で parent_page_id が変わる', () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-view-folder'))
    const plainRow = screen.getByTestId('wiki-page-row-plain')
    const folderRow = screen.getByTestId('wiki-page-row-folder-a')
    fireEvent.dragStart(plainRow, { dataTransfer: dataTransfer() })
    fireEvent.dragOver(folderRow, { dataTransfer: dataTransfer() })
    fireEvent.drop(folderRow, { dataTransfer: dataTransfer() })
    expect(mockUpdatePage).toHaveBeenCalledWith('plain', { parent_page_id: 'folder-a' })
  })

  it('ドラッグ中は「一番上の階層へ」の落とし先が出て、そこへ落とすと parent_page_id が null になる', () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-view-folder'))
    const childRow = screen.getByTestId('wiki-page-row-child-in-a')
    fireEvent.dragStart(childRow, { dataTransfer: dataTransfer() })
    const rootZone = screen.getByTestId('wiki-folder-drop-root')
    fireEvent.dragOver(rootZone, { dataTransfer: dataTransfer() })
    fireEvent.drop(rootZone, { dataTransfer: dataTransfer() })
    expect(mockUpdatePage).toHaveBeenCalledWith('child-in-a', { parent_page_id: null })
  })

  it('自分の子孫の上へは落とせない（updatePage は呼ばれない）', () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-view-folder'))
    const folderRow = screen.getByTestId('wiki-page-row-folder-a')
    const childRow = screen.getByTestId('wiki-page-row-child-in-a')
    fireEvent.dragStart(folderRow, { dataTransfer: dataTransfer() })
    fireEvent.dragOver(childRow, { dataTransfer: dataTransfer() })
    fireEvent.drop(childRow, { dataTransfer: dataTransfer() })
    expect(mockUpdatePage).not.toHaveBeenCalled()
  })

  it('一覧表示ではドラッグできない（isDraggable が付かない）', () => {
    setup()
    const row = screen.getByTestId('wiki-page-row-plain')
    expect(row).not.toHaveAttribute('draggable')
  })
})
