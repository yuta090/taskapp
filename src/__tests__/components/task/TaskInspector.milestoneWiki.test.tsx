import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskInspector } from '@/components/task/TaskInspector'
import type { ComponentProps } from 'react'
import type { Task, WikiPage } from '@/types/database'

// PR3: タスク詳細から「このマイルストーンの Wiki」を引ける導線の回帰テスト。
// docs/spec/WIKI_LIST_SPEC.md PR3 節。

function renderInspector(props: ComponentProps<typeof TaskInspector>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskInspector {...props} />
    </QueryClientProvider>
  )
}

const mockPages = vi.hoisted(() => ({ current: [] as WikiPage[] }))
// PR4: タスク参照由来の所属（page.id → milestoneId[]）。既定は空＝従来どおり milestone_id だけで一致判定。
const mockLinksByPageId = vi.hoisted(() => ({ current: new Map<string, string[]>() }))

vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: mockLinksByPageId.current, loading: false }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: [],
    clientMembers: [],
    internalMembers: [],
    loading: false,
    error: null,
    getMemberName: (id: string) => id,
  }),
}))

vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({ pages: mockPages.current }),
}))

vi.mock('@/lib/hooks/useSpaceSettings', () => ({
  useSpaceSettings: () => ({ shouldShowOwnerField: true }),
}))

vi.mock('@/lib/hooks/useAgencyMode', () => ({
  useAgencyMode: () => ({
    data: { agency_mode: false, default_margin_rate: null, vendor_settings: { show_client_name: false, allow_client_comments: false } },
    loading: false,
    update: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'u1' }, loading: false, error: null }),
}))

vi.mock('@/lib/hooks/useLatestClientAction', () => ({
  useLatestClientAction: () => null,
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  }),
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    org_id: 'o1',
    space_id: 's1',
    milestone_id: null,
    parent_task_id: null,
    title: 'サンプルタスク',
    description: null,
    status: 'backlog',
    priority: null,
    assignee_id: null,
    start_date: null,
    due_date: null,
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    spec_path: null,
    wiki_page_id: null,
    decision_state: null,
    client_scope: 'internal',
    actual_hours: null,
    estimated_cost: null,
    estimate_status: 'none',
    completed_at: null,
    is_sample: false,
    due_authority_connection_id: null,
    created_at: '2026-07-01T00:00:00',
    updated_at: '2026-07-01T00:00:00',
    ...overrides,
  }
}

function makeWikiPage(overrides: Partial<WikiPage> = {}): WikiPage {
  return {
    id: 'w1',
    org_id: 'o1',
    space_id: 's1',
    title: 'ページ',
    body: '',
    tags: [],
    parent_page_id: null,
    milestone_id: null,
    pinned_at: null,
    sort_order: null,
    created_by: 'u1',
    updated_by: 'u1',
    created_at: '2026-09-01T00:00:00+09:00',
    updated_at: '2026-09-01T00:00:00+09:00',
    ...overrides,
  }
}

describe('TaskInspector — このマイルストーンの Wiki', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPages.current = []
    mockLinksByPageId.current = new Map()
  })

  it('milestone_id が一致するページが2件あれば見出しとリンクが出る', () => {
    mockPages.current = [
      makeWikiPage({ id: 'w1', title: 'ページA', milestone_id: 'm1' }),
      makeWikiPage({ id: 'w2', title: 'ページB', milestone_id: 'm1' }),
      makeWikiPage({ id: 'w3', title: 'ページC', milestone_id: 'm2' }),
    ]

    renderInspector({
      task: makeTask({ milestone_id: 'm1' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })
    fireEvent.click(screen.getByText('詳細設定'))

    expect(screen.getByText('このマイルストーンの Wiki')).toBeInTheDocument()
    expect(screen.getByText('ページA')).toBeInTheDocument()
    expect(screen.getByText('ページB')).toBeInTheDocument()
    expect(screen.queryByText('ページC')).not.toBeInTheDocument()
  })

  it('milestone_id が一致するページが0件なら見出しごと出さない', () => {
    mockPages.current = [makeWikiPage({ id: 'w1', title: 'ページA', milestone_id: 'm2' })]

    renderInspector({
      task: makeTask({ milestone_id: 'm1' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })
    fireEvent.click(screen.getByText('詳細設定'))

    expect(screen.queryByText('このマイルストーンの Wiki')).not.toBeInTheDocument()
  })

  it('task.milestone_id が null なら見出しごと出さない', () => {
    mockPages.current = [makeWikiPage({ id: 'w1', title: 'ページA', milestone_id: null })]

    renderInspector({
      task: makeTask({ milestone_id: null }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })
    fireEvent.click(screen.getByText('詳細設定'))

    expect(screen.queryByText('このマイルストーンの Wiki')).not.toBeInTheDocument()
  })

  it('一致が6件あれば5件だけ表示し「他 1 件を Wiki で見る」を出す', () => {
    mockPages.current = Array.from({ length: 6 }, (_, i) =>
      makeWikiPage({ id: `w${i}`, title: `ページ${i}`, milestone_id: 'm1' })
    )

    renderInspector({
      task: makeTask({ milestone_id: 'm1' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })
    fireEvent.click(screen.getByText('詳細設定'))

    expect(screen.getByText((_, el) => el?.textContent === '他 1 件を Wiki で見る')).toBeInTheDocument()
  })

  it('PR4: タスク参照由来（page.milestone_id は無い）のページも union で出る', () => {
    mockPages.current = [
      makeWikiPage({ id: 'w1', title: '手動選択ページ', milestone_id: 'm1' }),
      makeWikiPage({ id: 'w2', title: 'タスク参照ページ', milestone_id: null }),
      makeWikiPage({ id: 'w3', title: '無関係ページ', milestone_id: 'm2' }),
    ]
    mockLinksByPageId.current = new Map([['w2', ['m1']]])

    renderInspector({
      task: makeTask({ milestone_id: 'm1' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })
    fireEvent.click(screen.getByText('詳細設定'))

    expect(screen.getByText('このマイルストーンの Wiki')).toBeInTheDocument()
    expect(screen.getByText('手動選択ページ')).toBeInTheDocument()
    expect(screen.getByText('タスク参照ページ')).toBeInTheDocument()
    expect(screen.queryByText('無関係ページ')).not.toBeInTheDocument()
  })

  it('PR4: 「他 N 件を Wiki で見る」の件数もタスク参照を含めて数える', () => {
    // 手動選択 3 件 + タスク参照 3 件 = union 6 件。表示は 5 件、残り 1 件。
    mockPages.current = [
      ...Array.from({ length: 3 }, (_, i) =>
        makeWikiPage({ id: `m${i}`, title: `手動${i}`, milestone_id: 'm1' })
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        makeWikiPage({ id: `r${i}`, title: `参照${i}`, milestone_id: null })
      ),
    ]
    mockLinksByPageId.current = new Map([
      ['r0', ['m1']],
      ['r1', ['m1']],
      ['r2', ['m1']],
    ])

    renderInspector({
      task: makeTask({ milestone_id: 'm1' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })
    fireEvent.click(screen.getByText('詳細設定'))

    expect(screen.getByText((_, el) => el?.textContent === '他 1 件を Wiki で見る')).toBeInTheDocument()
  })
})
