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

// お知らせベルがヘッダーに入ったので、その取得層(react-query)を差し替える。
// 差し替えないと QueryClientProvider の無いテストが「No QueryClient set」で落ちる。
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

const mockMilestones = vi.hoisted(() => ({ current: [milestone()] as Milestone[] }))
vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: mockMilestones.current, loading: false }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: [{ id: 'user1', displayName: '田中', avatarUrl: null, role: 'admin' }],
  }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'user1' } }),
}))

// PR4: タスク参照由来の所属マイルストーン。既定は空（このテストファイルは手動選択の union だけを見る）。
const mockLinksByPageId = vi.hoisted(() => ({ current: new Map<string, string[]>() }))
vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: mockLinksByPageId.current, loading: false }),
}))

function setup() {
  render(<WikiPageClient orgId="org1" spaceId="space1" />)
}

describe('WikiPageClient 表示切替', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    mockLinksByPageId.current = new Map()
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

  it('フォルダ表示で親を折りたたんだまま検索しても、一致した子ページは表示される', () => {
    setup()
    fireEvent.click(screen.getByTestId('wiki-view-folder'))
    fireEvent.click(screen.getByLabelText('折りたたむ'))
    expect(screen.queryByText('子ページ')).not.toBeInTheDocument()
    fireEvent.change(screen.getByTestId('wiki-search'), { target: { value: '子ページ' } })
    expect(screen.getByText('子ページ')).toBeInTheDocument()
    expect(screen.getByText('親ページ')).toBeInTheDocument() // 祖先も一緒に出る
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

  describe('PR4: 所属マイルストーンをタグのように見せる', () => {
    it('一覧表示では所属マイルストーンがタグのように行に出る', () => {
      setup()
      const row = screen.getByText('無関係ページ').closest('div[style]') as HTMLElement
      expect(within(row).getByText('マイルストーンA')).toBeInTheDocument()
    })

    it('タスク参照由来の所属も一覧の行に出る（union）', () => {
      // 'child' ページはページ側の milestone_id は無いが、タスクから m1 を参照している
      mockLinksByPageId.current = new Map([['child', ['m1']]])
      setup()
      const row = screen.getByText('子ページ').closest('div[style]') as HTMLElement
      expect(within(row).getByText('マイルストーンA')).toBeInTheDocument()
    })

    it('マイルストーン別表示で1ページが複数グループに出て、延べ件数に反映される', () => {
      const m2 = milestone({ id: 'm2', name: 'マイルストーンB', order_key: 1 })
      mockMilestones.current = [milestone(), m2]
      // 'other' ページ(milestone_id: m1)がタスク経由で m2 にも所属する
      mockLinksByPageId.current = new Map([['other', ['m2']]])
      setup()
      fireEvent.click(screen.getByTestId('wiki-view-milestone'))

      const groupA = screen.getByText('マイルストーンA').parentElement as HTMLElement
      const groupB = screen.getByText('マイルストーンB').parentElement as HTMLElement
      expect(within(groupA).getByText('無関係ページ')).toBeInTheDocument()
      expect(within(groupB).getByText('無関係ページ')).toBeInTheDocument()
      // 他のグループにも出ていることが分かる印
      expect(within(groupA).getByText('他 1 件のマイルストーンにも')).toBeInTheDocument()
      expect(within(groupB).getByText('他 1 件のマイルストーンにも')).toBeInTheDocument()

      // 延べ件数（3ページ中「無関係ページ」が2グループに出るぶん4件）を件数表示に含める
      expect(screen.getByText(/延べ 4 件/)).toBeInTheDocument()
    })
  })
})
