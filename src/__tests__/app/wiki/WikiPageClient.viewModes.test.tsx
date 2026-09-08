import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { WikiPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/wiki/WikiPageClient'
import type { WikiPage, Milestone } from '@/types/database'

// PR2 の表示切替(一覧/フォルダ/マイルストーン別)の配線を確かめる統合テスト。
// 純粋ロジック(buildWikiTree 等)は listView.test.ts で境界を押さえているため、
// ここでは「WikiPageClient が正しい入力で正しく呼び出しているか」だけを見る。

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

const PAGES: WikiPage[] = [
  page({ id: 'parent', title: '親ページ' }),
  page({ id: 'child', title: '子ページ', parent_page_id: 'parent' }),
  page({ id: 'other', title: '無関係ページ', milestone_id: 'm1' }),
]

const mockUpdatePage = vi.fn().mockResolvedValue(undefined)

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: vi.fn() }),
}))

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({
    pages: PAGES,
    loading: false,
    autoCreatedPageId: null,
    fetchPages: vi.fn(),
    createPage: vi.fn(),
    updatePage: mockUpdatePage,
    deletePage: vi.fn(),
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

function setup() {
  render(<WikiPageClient orgId="org1" spaceId="space1" />)
}

describe('WikiPageClient 表示切替', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('既定(一覧)では全ページがフラットに並ぶ', () => {
    setup()
    expect(screen.getByText('親ページ')).toBeInTheDocument()
    expect(screen.getByText('子ページ')).toBeInTheDocument()
    expect(screen.getByText('無関係ページ')).toBeInTheDocument()
  })

  it('フォルダ表示に切り替えると子ページがインデントされる', () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-view-folder'))

    const parentRow = screen.getByText('親ページ').closest('div[style]') as HTMLElement
    const childRow = screen.getByText('子ページ').closest('div[style]') as HTMLElement
    expect(parentRow.style.paddingLeft).toBe('16px')
    expect(childRow.style.paddingLeft).toBe('36px')
  })

  it('フォルダ表示で親を折りたたむと子ページが消える', () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-view-folder'))
    expect(screen.getByText('子ページ')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('折りたたむ'))
    expect(screen.queryByText('子ページ')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('展開'))
    expect(screen.getByText('子ページ')).toBeInTheDocument()
  })

  it('マイルストーン別表示にするとグループ見出しが出る', () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-view-milestone'))

    expect(screen.getByText('マイルストーンA')).toBeInTheDocument()
    expect(screen.getByText('マイルストーン未設定')).toBeInTheDocument()
    // 「無関係ページ」は m1 のグループ内にある
    const groupHeading = screen.getByText('マイルストーンA')
    const group = groupHeading.parentElement as HTMLElement
    expect(within(group).getByText('無関係ページ')).toBeInTheDocument()
  })
})
