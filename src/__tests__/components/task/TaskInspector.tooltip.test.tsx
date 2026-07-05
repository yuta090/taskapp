import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { TaskInspector } from '@/components/task/TaskInspector'
import type { Task } from '@/types/database'

/**
 * Regression coverage for the ball / client-visibility tooltips added as
 * part of the first-run UX stream (D): the Inspector's "クライアント確認待ち"
 * badge doubles as the "this task is visible in the client portal" signal,
 * but previously had no explanation attached.
 */

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: [],
    clientMembers: [],
    internalMembers: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
    getMemberName: (id: string) => id,
  }),
}))

vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({
    pages: [],
    loading: false,
    error: null,
    autoCreatedPageId: null,
    fetchPages: vi.fn(),
    createPage: vi.fn(),
    updatePage: vi.fn(),
    deletePage: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useSpaceSettings', () => ({
  useSpaceSettings: () => ({
    settings: null,
    shouldShowOwnerField: false,
    loading: false,
    error: null,
    updateOwnerFieldEnabled: vi.fn(),
    refetch: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useAgencyMode', () => ({
  useAgencyMode: () => ({
    data: { agency_mode: false, default_margin_rate: null, vendor_settings: { show_client_name: false, allow_client_comments: false } },
  }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null, loading: false, error: null }),
}))

vi.mock('@/lib/hooks/useLatestClientAction', () => ({
  useLatestClientAction: () => null,
}))

vi.mock('@/components/task/TaskComments', () => ({
  TaskComments: () => null,
}))

vi.mock('@/components/task/TaskEventTimeline', () => ({
  TaskEventTimeline: () => null,
}))

vi.mock('@/components/task/ConsideringDecisionPanel', () => ({
  ConsideringDecisionPanel: () => null,
}))

vi.mock('@/components/task/TaskPricingPanel', () => ({
  TaskPricingPanel: () => null,
}))

vi.mock('@/components/github', () => ({
  TaskPRList: () => null,
}))

vi.mock('@/components/slack', () => ({
  SlackPostButton: () => null,
}))

vi.mock('@/components/review', () => ({
  TaskReviewSection: () => null,
}))

// Chainable stand-in for `supabase.from(...).select().eq().order()` etc. —
// TaskInspector fetches milestones directly via createClient() on mount.
function makeChainable(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const chainable: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void) => resolve(result)
        }
        return () => chainable
      },
    }
  )
  return chainable
}

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: null }, error: null })) },
    from: vi.fn(() => makeChainable()),
    rpc: vi.fn(),
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
    status: 'todo',
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
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  } as Task
}

describe('TaskInspector — ボール/公開ツールチップ (初回UX改善 D)', () => {
  it('ball=client のとき、クライアント確認待ちバッジに公開の説明ツールチップが付く', async () => {
    render(<TaskInspector task={makeTask({ ball: 'client' })} spaceId="s1" onClose={() => {}} />)
    expect(await screen.findByText('クライアント確認待ち')).toBeInTheDocument()
    expect(screen.getByText('ONでクライアントのポータルに表示されます')).toBeInTheDocument()
  })

  it('ball=internal のときは公開ツールチップを表示しない', async () => {
    render(<TaskInspector task={makeTask({ ball: 'internal' })} spaceId="s1" onClose={() => {}} />)
    await waitFor(() => expect(screen.getByText('ボール')).toBeInTheDocument())
    expect(screen.queryByText('クライアント確認待ち')).not.toBeInTheDocument()
    expect(screen.queryByText('ONでクライアントのポータルに表示されます')).not.toBeInTheDocument()
  })

  it('ボールのラベルには次アクション側の説明が付く（既存のネイティブtitle）', async () => {
    render(<TaskInspector task={makeTask()} spaceId="s1" onClose={() => {}} />)
    await waitFor(() =>
      expect(screen.getByText('ボール')).toHaveAttribute(
        'title',
        '次にアクションを取る側。社内=チームが作業中、外部=クライアント確認待ち'
      )
    )
  })
})
