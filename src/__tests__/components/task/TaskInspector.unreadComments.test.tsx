import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskInspector } from '@/components/task/TaskInspector'
import type { Task } from '@/types/database'

// タスク詳細のコメント欄は最初は閉じている。未読のコメントがあるタスクを開いたときは
// 「未読 N」を出してコメント欄を開いておく（開くとコメント欄が既読にする）。

function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return rtlRender(ui, { wrapper: Wrapper })
}

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
  useWikiPages: () => ({ pages: [], loading: false, error: null, createPage: vi.fn() }),
}))

vi.mock('@/lib/hooks/useSpaceSettings', () => ({
  useSpaceSettings: () => ({ shouldShowOwnerField: false }),
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

vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: new Map(), loading: false }),
}))

vi.mock('@/components/task/TaskComments', () => ({
  TaskComments: ({ taskId }: { taskId: string }) => <div data-testid="task-comments-open">{taskId}</div>,
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
  TaskIssueList: () => null,
}))

vi.mock('@/components/slack', () => ({
  SlackPostButton: () => null,
}))

vi.mock('@/components/review', () => ({
  TaskReviewSection: () => null,
}))

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
    title: 'タスク',
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
    is_sample: false,
    due_authority_connection_id: null,
    short_id: null,
    created_at: '2026-07-01T00:00:00',
    updated_at: '2026-07-01T00:00:00',
    ...overrides,
  }
}

describe('TaskInspector — 未読コメント', () => {
  it('未読があれば「コメント」の横に「未読 N」を出し、コメント欄を開いておく', () => {
    render(<TaskInspector task={makeTask()} spaceId="s1" onClose={vi.fn()} unreadCommentCount={2} />)

    expect(screen.getByTestId('task-inspector-unread-comments')).toHaveTextContent('未読 2')
    expect(screen.getByTestId('task-comments-open')).toHaveTextContent('t1')
  })

  it('未読が無ければ、コメント欄は今までどおり閉じたまま', () => {
    render(<TaskInspector task={makeTask()} spaceId="s1" onClose={vi.fn()} />)

    expect(screen.queryByTestId('task-inspector-unread-comments')).not.toBeInTheDocument()
    expect(screen.queryByTestId('task-comments-open')).not.toBeInTheDocument()
  })

  it('自分で閉じたら、同じタスクのあいだは開き直さない', () => {
    const task = makeTask()
    const { rerender } = render(<TaskInspector task={task} spaceId="s1" onClose={vi.fn()} unreadCommentCount={2} />)

    fireEvent.click(screen.getByTestId('task-inspector-comments-toggle'))
    expect(screen.queryByTestId('task-comments-open')).not.toBeInTheDocument()

    rerender(<TaskInspector task={{ ...task }} spaceId="s1" onClose={vi.fn()} unreadCommentCount={2} />)
    expect(screen.queryByTestId('task-comments-open')).not.toBeInTheDocument()
  })

  it('未読がある別のタスクに切り替えたら、また開く', () => {
    const { rerender } = render(
      <TaskInspector task={makeTask()} spaceId="s1" onClose={vi.fn()} unreadCommentCount={2} />
    )
    fireEvent.click(screen.getByTestId('task-inspector-comments-toggle'))
    expect(screen.queryByTestId('task-comments-open')).not.toBeInTheDocument()

    rerender(
      <TaskInspector task={makeTask({ id: 't2', title: '別のタスク' })} spaceId="s1" onClose={vi.fn()} unreadCommentCount={1} />
    )
    expect(screen.getByTestId('task-comments-open')).toHaveTextContent('t2')
  })
})
