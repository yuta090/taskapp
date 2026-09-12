import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render as rtlRender, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskInspector } from '@/components/task/TaskInspector'
import type { Task } from '@/types/database'

/**
 * 担当者が協力会社(vendor)のタスクは、担当者欄の選択肢に「(不明)」ではなく
 * 「(協力会社)」と出す。vendor は internalMembers にも clientMembers にも
 * 含まれない役割なので、フォールバック表示が必要になる。
 */

function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const VENDOR_ID = 'vendor-1'

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: [{ id: VENDOR_ID, displayName: '協力会社の人', avatarUrl: null, role: 'vendor' }],
    clientMembers: [],
    internalMembers: [],
    loading: false,
    error: null,
    getMemberName: (id: string) => id,
  }),
}))

vi.mock('@/lib/hooks/useWikiPages', () => ({
  useWikiPages: () => ({ pages: [] }),
}))

vi.mock('@/lib/hooks/useSpaceSettings', () => ({
  useSpaceSettings: () => ({ shouldShowOwnerField: true }),
}))

vi.mock('@/lib/hooks/useAgencyMode', () => ({
  useAgencyMode: () => ({
    data: { agency_mode: true, default_margin_rate: null, vendor_settings: { show_client_name: false, allow_client_comments: false } },
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

vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: new Map(), loading: false }),
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
    assignee_id: VENDOR_ID,
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
    short_id: null,
    created_at: '2026-07-01T00:00:00',
    updated_at: '2026-07-01T00:00:00',
    ...overrides,
  }
}

describe('TaskInspector — 担当者が協力会社(vendor)のときの表示', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('担当者の選択肢に「(協力会社)」と出す（「(不明)」にしない）', () => {
    render(
      <TaskInspector task={makeTask()} spaceId="s1" onClose={() => {}} onUpdate={vi.fn()} />
    )

    expect(screen.getByText('協力会社の人 (協力会社)')).toBeInTheDocument()
    expect(screen.queryByText('協力会社の人 (不明)')).not.toBeInTheDocument()
  })
})
