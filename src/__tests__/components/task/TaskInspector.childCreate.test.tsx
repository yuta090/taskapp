import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskInspector } from '@/components/task/TaskInspector'
import type { Task } from '@/types/database'

// タスク詳細から子タスクを作れるようにする。
// - 「親タスク」の下（子タスクの欄）に「子タスクを追加」がある
// - 完了にしたときは「確認依頼を子タスクで出す」を案内し、押すと題名と説明のひな形が入る
//   （運用ルール「確認依頼は子タスクで出す」2026-09-15 確定）

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
    title: '粗利の下限を整理する',
    description: null,
    status: 'in_progress',
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
    created_at: '2026-09-01T00:00:00',
    updated_at: '2026-09-01T00:00:00',
    ...overrides,
  }
}

function openDetails() {
  const toggle = screen.queryByText('詳細設定')
  if (toggle) fireEvent.click(toggle)
}

describe('TaskInspector — 子タスクを追加', () => {
  it('子タスクが1件も無くても「子タスクを追加」が出る', () => {
    render(
      <TaskInspector
        task={makeTask()}
        spaceId="s1"
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onCreateChild={vi.fn()}
      />
    )
    openDetails()

    expect(screen.getByTestId('task-inspector-add-child')).toBeInTheDocument()
  })

  it('題名を入れて追加すると、その題名で子タスクを作る', async () => {
    const onCreateChild = vi.fn(async () => {})
    render(
      <TaskInspector
        task={makeTask()}
        spaceId="s1"
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onCreateChild={onCreateChild}
      />
    )
    openDetails()

    fireEvent.click(screen.getByTestId('task-inspector-add-child'))
    fireEvent.change(screen.getByTestId('task-inspector-child-title'), {
      target: { value: '請求書の雛形を作る' },
    })
    fireEvent.click(screen.getByTestId('task-inspector-child-submit'))

    await waitFor(() => {
      expect(onCreateChild).toHaveBeenCalledWith({ title: '請求書の雛形を作る', description: undefined })
    })
  })

  it('題名が空のままでは作らない', () => {
    const onCreateChild = vi.fn(async () => {})
    render(
      <TaskInspector
        task={makeTask()}
        spaceId="s1"
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onCreateChild={onCreateChild}
      />
    )
    openDetails()

    fireEvent.click(screen.getByTestId('task-inspector-add-child'))
    fireEvent.click(screen.getByTestId('task-inspector-child-submit'))

    expect(onCreateChild).not.toHaveBeenCalled()
  })

  it('作成に失敗しても入力欄は閉じない（書いた内容を消さない）', async () => {
    const onCreateChild = vi.fn(async () => {
      throw new Error('作成できませんでした')
    })
    render(
      <TaskInspector
        task={makeTask()}
        spaceId="s1"
        onClose={vi.fn()}
        onUpdate={vi.fn()}
        onCreateChild={onCreateChild}
      />
    )
    openDetails()

    fireEvent.click(screen.getByTestId('task-inspector-add-child'))
    fireEvent.change(screen.getByTestId('task-inspector-child-title'), {
      target: { value: '請求書の雛形を作る' },
    })
    fireEvent.click(screen.getByTestId('task-inspector-child-submit'))

    await waitFor(() => {
      expect(onCreateChild).toHaveBeenCalled()
    })
    const title = screen.getByTestId('task-inspector-child-title') as HTMLInputElement
    expect(title.value).toBe('請求書の雛形を作る')
  })

  it('編集できない人（onCreateChild なし）には出さない', () => {
    render(<TaskInspector task={makeTask()} spaceId="s1" onClose={vi.fn()} />)
    openDetails()

    expect(screen.queryByTestId('task-inspector-add-child')).not.toBeInTheDocument()
  })
})

describe('TaskInspector — 完了にしたら確認依頼をすすめる', () => {
  it('完了にすると「確認依頼を子タスクで出す」が出る', async () => {
    render(
      <TaskInspector
        task={makeTask()}
        spaceId="s1"
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => {})}
        onCreateChild={vi.fn()}
      />
    )

    fireEvent.change(screen.getByTestId('task-inspector-status'), { target: { value: 'done' } })

    await waitFor(() => {
      expect(screen.getByTestId('task-inspector-review-request-suggest')).toBeInTheDocument()
    })
  })

  it('完了以外にしたときは出さない', async () => {
    render(
      <TaskInspector
        task={makeTask()}
        spaceId="s1"
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => {})}
        onCreateChild={vi.fn()}
      />
    )

    fireEvent.change(screen.getByTestId('task-inspector-status'), { target: { value: 'todo' } })

    await waitFor(() => {
      expect(screen.queryByTestId('task-inspector-review-request-suggest')).not.toBeInTheDocument()
    })
  })

  it('もともと完了のタスクを開いただけでは出さない', () => {
    render(
      <TaskInspector
        task={makeTask({ status: 'done' })}
        spaceId="s1"
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => {})}
        onCreateChild={vi.fn()}
      />
    )

    expect(screen.queryByTestId('task-inspector-review-request-suggest')).not.toBeInTheDocument()
  })

  it('すすめられたとおりに押すと、題名「確認依頼: 」と説明の4行が入った入力欄が開く', async () => {
    render(
      <TaskInspector
        task={makeTask()}
        spaceId="s1"
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => {})}
        onCreateChild={vi.fn()}
      />
    )

    fireEvent.change(screen.getByTestId('task-inspector-status'), { target: { value: 'done' } })
    fireEvent.click(await screen.findByTestId('task-inspector-review-request-suggest'))

    const title = (await screen.findByTestId('task-inspector-child-title')) as HTMLInputElement
    const description = screen.getByTestId('task-inspector-child-description') as HTMLTextAreaElement

    expect(title.value).toBe('確認依頼: ')
    expect(description.value.split('\n')).toHaveLength(4)
    expect(description.value).toContain('[なぜ]')
    expect(description.value).toContain('[様子見]')
  })

  it('確認依頼の入力欄は「詳細設定」を開かずにその場に出す（親タスクの選択肢を一度に作らない）', async () => {
    render(
      <TaskInspector
        task={makeTask()}
        spaceId="s1"
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => {})}
        onCreateChild={vi.fn()}
        parentTasks={[{ id: 'p1', title: '別のタスク' }]}
      />
    )

    fireEvent.change(screen.getByTestId('task-inspector-status'), { target: { value: 'done' } })
    fireEvent.click(await screen.findByTestId('task-inspector-review-request-suggest'))

    expect(await screen.findByTestId('task-inspector-child-title')).toBeInTheDocument()
    expect(screen.queryByTestId('task-inspector-parent')).not.toBeInTheDocument()
  })

  it('確認依頼として作ると、説明もいっしょに渡す', async () => {
    const onCreateChild = vi.fn(async () => {})
    render(
      <TaskInspector
        task={makeTask()}
        spaceId="s1"
        onClose={vi.fn()}
        onUpdate={vi.fn(async () => {})}
        onCreateChild={onCreateChild}
      />
    )

    fireEvent.change(screen.getByTestId('task-inspector-status'), { target: { value: 'done' } })
    fireEvent.click(await screen.findByTestId('task-inspector-review-request-suggest'))
    fireEvent.change(await screen.findByTestId('task-inspector-child-title'), {
      target: { value: '確認依頼: 粗利の下限を粗利率40%にする' },
    })
    fireEvent.change(screen.getByTestId('task-inspector-child-description'), {
      target: { value: '[なぜ] 赤字案件を止めるため\n[影響] 見積の下限が変わる\n[根拠] 18 価格設計フレーム v0\n[様子見] 受注率が落ちたら見直す' },
    })
    fireEvent.click(screen.getByTestId('task-inspector-child-submit'))

    await waitFor(() => {
      expect(onCreateChild).toHaveBeenCalledWith({
        title: '確認依頼: 粗利の下限を粗利率40%にする',
        description:
          '[なぜ] 赤字案件を止めるため\n[影響] 見積の下限が変わる\n[根拠] 18 価格設計フレーム v0\n[様子見] 受注率が落ちたら見直す',
      })
    })
  })
})
