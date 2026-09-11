import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskInspector } from '@/components/task/TaskInspector'
import type { ComponentProps } from 'react'
import type { Task } from '@/types/database'
import { vi } from 'vitest'

// 代理店モードの「価格の枠」(TaskPricingPanel) は admin/editor だけに出す規則
// （viewer が見えてはいけない）。以前は isInternalMember（viewer も真になる）で
// 出し分けていたバグの回帰テスト。onUpdate の有無（呼び出し元が canEditSpaceContent
// で決める）だけを唯一の判定にする。

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: [],
    clientMembers: [],
    internalMembers: [{ id: 'u1', displayName: 'あなた', avatarUrl: null, role: 'viewer' }],
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
    data: { agency_mode: true, default_margin_rate: 0.2, vendor_settings: { show_client_name: false, allow_client_comments: false } },
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

vi.mock('@/components/task/TaskPricingPanel', () => ({
  TaskPricingPanel: () => <div data-testid="task-pricing-panel">価格の枠</div>,
}))

function renderInspector(props: ComponentProps<typeof TaskInspector>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskInspector {...props} />
    </QueryClientProvider>
  )
}

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
    short_id: null,
    created_at: '2026-07-01T00:00:00',
    updated_at: '2026-07-01T00:00:00',
    ...overrides,
  }
}

describe('TaskInspector — 代理店モードの価格の枠は admin/editor だけ', () => {
  it('onUpdate がある（編集できる）なら価格の枠を出す', () => {
    renderInspector({
      task: makeTask(),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(screen.getByTestId('task-pricing-panel')).toBeInTheDocument()
  })

  it('onUpdate が無い（viewer・読み取り専用）なら価格の枠を出さない', () => {
    renderInspector({
      task: makeTask(),
      spaceId: 's1',
      onClose: vi.fn(),
    })

    expect(screen.queryByTestId('task-pricing-panel')).not.toBeInTheDocument()
  })
})
