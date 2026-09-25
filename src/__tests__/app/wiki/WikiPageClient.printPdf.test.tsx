import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { WikiPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/wiki/WikiPageClient'
import type { WikiPage } from '@/types/database'

// Wiki ページを PDF にするとき、紙に載せるのはタイトルと本文だけにする。
// 画面の枠（左メニュー・右のページ情報・ボタン類）が一緒に刷られないよう、
// 画面側に2つの目印を置き、globals.css の @media print がそれを見る。
//   data-print-root … このかたまりだけを紙に載せる
//   data-print-hide … かたまりの中でも紙には載せない（押すためのもの・警告の帯）
// 目印と印刷の指定は片方だけでは意味がないので、つながっていることもここで確かめる。

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

const ACTIVE_PAGE = page({ id: 'p1', title: '開いているページ' })

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
  useSearchParams: () => new URLSearchParams('page=p1'),
}))

const mockSetInspector = vi.fn()
vi.mock('@/components/layout', async () => {
  const React = await import('react')
  return {
    useInspector: () => ({ setInspector: mockSetInspector }),
    useShellFullscreen: () => {
      const [fullscreen, setFullscreen] = React.useState(false)
      return { fullscreen, setFullscreen }
    },
  }
})

vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }))

const mockFetchPage = vi.hoisted(() => vi.fn())
vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({
    pages: [ACTIVE_PAGE],
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

vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: [], loading: false }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ members: [] }),
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
// 参照しているタスクの取得。毎回同じ配列を返す（新しい配列だとページ情報パネルを毎回作り直す）
const NO_REFERENCING_TASKS = vi.hoisted(() => [] as never[])
vi.mock('@/lib/hooks/useWikiPageReferencingTasks', () => ({
  useWikiPageReferencingTasks: () => ({ tasks: NO_REFERENCING_TASKS, loading: false, error: null }),
}))

vi.mock('@/components/wiki/WikiPageInspector', () => ({
  WikiPageInspector: () => <div data-testid="wiki-page-inspector-stub" />,
}))

vi.mock('@/components/wiki/WikiEditorDynamic', async () => {
  const React = await import('react')
  return {
    WikiEditorDynamic: () => React.createElement('div', { 'data-testid': 'wiki-editor-stub' }, '本文'),
  }
})

async function setup() {
  render(<WikiPageClient orgId="org1" spaceId="space1" />)
  await waitFor(() => {
    expect(screen.getByTestId('wiki-editor-stub')).toBeInTheDocument()
    expect(mockSetInspector.mock.calls.at(-1)?.[1]).toEqual({ size: 'narrow' })
  })
}

describe('WikiPageClient — PDFで保存したときに紙へ載る範囲', () => {
  beforeEach(() => {
    mockSetInspector.mockClear()
    mockFetchPage.mockReset().mockResolvedValue(ACTIVE_PAGE)
  })

  it('紙に載せるかたまりに、ページ名と本文の両方が入っている', async () => {
    await setup()

    const printRoot = document.querySelector('[data-print-root]')
    expect(printRoot).not.toBeNull()
    expect(printRoot).toContainElement(screen.getByRole('heading', { name: '開いているページ' }))
    expect(printRoot).toContainElement(screen.getByTestId('wiki-editor-stub'))
  })

  it('ヘッダーのボタン類は紙に載せない印が付いている', async () => {
    await setup()

    expect(screen.getByLabelText('一覧へ戻る').closest('[data-print-hide]')).not.toBeNull()
    expect(screen.getByTestId('wiki-fullscreen-toggle').closest('[data-print-hide]')).not.toBeNull()
  })

  it('印刷の指定（globals.css）が、画面に置いた目印を実際に見ている', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    const printIndex = css.indexOf('@media print')
    expect(printIndex).toBeGreaterThan(-1)

    const printRules = css.slice(printIndex)
    expect(printRules).toContain('[data-print-root]')
    expect(printRules).toContain('[data-print-hide]')
  })

  // 「かたまりの外を消す」指定を body:has(...) で囲っておかないと、目印の無い画面
  // （タスク一覧など）で Ctrl+P したときに全部消えて白紙が刷られる
  it('「外を消す」指定は、目印があるときだけ効くように囲ってある', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8')
    const hideOutsideIndex = css.indexOf(':not(:has([data-print-root]))')
    expect(hideOutsideIndex).toBeGreaterThan(-1)

    const ruleStart = css.lastIndexOf('}', hideOutsideIndex)
    expect(css.slice(ruleStart, hideOutsideIndex)).toContain('body:has([data-print-root])')
  })
})
