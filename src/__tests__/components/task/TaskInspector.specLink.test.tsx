import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskInspector } from '@/components/task/TaskInspector'
import type { ComponentProps } from 'react'
import type { Task, WikiPage } from '@/types/database'

// 「仕様書連携」は詳細設定(折りたたみ)の中ではなく、説明の直下に常時表示する。
// 折りたたみの中だと仕様書が紐付いていることに気づけないため。

function renderInspector(props: ComponentProps<typeof TaskInspector>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskInspector {...props} />
    </QueryClientProvider>
  )
}

const mockPages = vi.hoisted(() => ({ current: [] as WikiPage[] }))

vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: new Map<string, string[]>(), loading: false }),
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

describe('TaskInspector — 仕様書連携の位置', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPages.current = [makeWikiPage({ id: 'w1', title: '仕様書A', tags: ['仕様書'] })]
  })

  it('詳細設定を開かなくても「仕様書連携」が表示される', () => {
    renderInspector({ task: makeTask(), spaceId: 's1', onClose: vi.fn(), onUpdate: vi.fn() })

    expect(screen.getByText('仕様書連携')).toBeInTheDocument()
    expect(screen.getByTestId('task-inspector-wiki-page')).toBeInTheDocument()
  })

  it('説明の下・ステータスの上に置かれる', () => {
    renderInspector({ task: makeTask(), spaceId: 's1', onClose: vi.fn(), onUpdate: vi.fn() })

    const description = screen.getByText('説明')
    const specLink = screen.getByText('仕様書連携')
    const status = screen.getByText('ステータス')

    // DOCUMENT_POSITION_FOLLOWING = 4
    expect(description.compareDocumentPosition(specLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(specLink.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('詳細設定を開いても二重に表示されない', () => {
    renderInspector({ task: makeTask(), spaceId: 's1', onClose: vi.fn(), onUpdate: vi.fn() })
    fireEvent.click(screen.getByText('詳細設定'))

    expect(screen.getAllByText('仕様書連携')).toHaveLength(1)
    expect(screen.getAllByTestId('task-inspector-wiki-page')).toHaveLength(1)
  })

  it('仕様書だけ紐付いているとき「詳細設定」の件数バッジは出ない', () => {
    renderInspector({
      task: makeTask({ wiki_page_id: 'w1' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(screen.queryByText(/件設定済み/)).not.toBeInTheDocument()
  })

  it('編集不可(onUpdate なし)でも説明の下に表示される', () => {
    renderInspector({ task: makeTask({ wiki_page_id: 'w1' }), spaceId: 's1', onClose: vi.fn() })

    const description = screen.getByText('説明')
    const specLink = screen.getByText('仕様書連携')
    expect(description.compareDocumentPosition(specLink) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Wikiページを開く')).toBeInTheDocument()
  })
})
