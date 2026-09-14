import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskInspector } from '@/components/task/TaskInspector'
import type { Task } from '@/types/database'

// タスク詳細の「子タスク」は、押すとその子タスクの詳細が開くリンクにする。
// 普通のクリックは今の画面のまま詳細を切り替え（onOpenTask）、Cmd/Ctrl+クリックでは
// 別タブで開けるよう、本物のリンク（href）も持たせる。

// TaskInspector は招待中の担当者候補を react-query で読むため Provider が要る
function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
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
  TaskIssueList: () => null,
}))

vi.mock('@/components/slack', () => ({
  SlackPostButton: () => null,
}))

vi.mock('@/components/review', () => ({
  TaskReviewSection: () => null,
}))

// TaskInspector は createClient() でマイルストーン等を直接読む。どの呼び方でも空で返す
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
    title: '親タスク',
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

const parent = makeTask()
const childA = makeTask({ id: 'c1', parent_task_id: 't1', title: '子タスクA' })
const childB = makeTask({ id: 'c2', parent_task_id: 't1', title: '子タスクB', status: 'done' })

function childLink(title: string): HTMLAnchorElement {
  const link = screen.getByText(title).closest('a')
  if (!link) throw new Error(`「${title}」がリンクになっていない`)
  return link as HTMLAnchorElement
}

describe('TaskInspector — 子タスクはリンクになっている', () => {
  it('子タスクごとに、そのタスクを開くリンク（?task=<id>）が付いている', () => {
    render(<TaskInspector task={parent} spaceId="s1" onClose={vi.fn()} childTasks={[childA, childB]} />)

    expect(childLink('子タスクA')).toHaveAttribute('href', '/o1/project/s1?task=c1')
    // 完了した子タスクも同じようにリンクにする（取り消し線はそのまま）
    expect(childLink('子タスクB')).toHaveAttribute('href', '/o1/project/s1?task=c2')
  })

  it('普通にクリックすると、画面は移動せず onOpenTask にその子タスクの id を渡す', () => {
    const onOpenTask = vi.fn()
    render(
      <TaskInspector task={parent} spaceId="s1" onClose={vi.fn()} childTasks={[childA]} onOpenTask={onOpenTask} />
    )

    const notPrevented = fireEvent.click(childLink('子タスクA'), { button: 0 })

    expect(onOpenTask).toHaveBeenCalledWith('c1')
    // fireEvent.click は preventDefault されると false を返す（= ページ移動しない）
    expect(notPrevented).toBe(false)
  })

  it('Cmd/Ctrl/Shift を押しながらのクリックは onOpenTask を呼ばない（別タブ・別ウィンドウで開けるように）', () => {
    const onOpenTask = vi.fn()
    render(
      <TaskInspector task={parent} spaceId="s1" onClose={vi.fn()} childTasks={[childA]} onOpenTask={onOpenTask} />
    )

    fireEvent.click(childLink('子タスクA'), { button: 0, metaKey: true })
    fireEvent.click(childLink('子タスクA'), { button: 0, ctrlKey: true })
    fireEvent.click(childLink('子タスクA'), { button: 0, shiftKey: true })

    expect(onOpenTask).not.toHaveBeenCalled()
  })

  it('読み取り専用（onUpdate なし）でも子タスクはリンクになる', () => {
    const onOpenTask = vi.fn()
    render(
      <TaskInspector task={parent} spaceId="s1" onClose={vi.fn()} childTasks={[childA]} onOpenTask={onOpenTask} />
    )

    fireEvent.click(childLink('子タスクA'), { button: 0 })
    expect(onOpenTask).toHaveBeenCalledWith('c1')
  })
})
