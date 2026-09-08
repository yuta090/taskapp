import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskInspector } from '@/components/task/TaskInspector'
import type { ComponentProps } from 'react'
import type { Task } from '@/types/database'

function renderInspector(props: ComponentProps<typeof TaskInspector>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskInspector {...props} />
    </QueryClientProvider>
  )
}

// S4: ball='client' ⟹ client_scope='deliverable' 不変条件のUI側テスト。

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
  useWikiPages: () => ({ pages: [] }),
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

vi.mock('@/lib/hooks/useWikiMilestoneLinks', () => ({
  useWikiMilestoneLinks: () => ({ linksByPageId: new Map(), loading: false }),
}))

// TaskInspector fetches milestones on mount (.from('milestones').select().eq().order()).
// Stub the chain so it resolves cleanly instead of rejecting with "not a function".
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

describe('TaskInspector — client_scope 編集と ball=client 不変条件', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('client_scope を編集すると onUpdate が clientScope を伴って呼ばれる', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    renderInspector({
      task: makeTask({ ball: 'internal', client_scope: 'internal' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate,
    })

    fireEvent.click(screen.getByTestId('task-inspector-client-scope-toggle'))

    expect(onUpdate).toHaveBeenCalledWith({ clientScope: 'deliverable' })
  })

  it('ball=client のタスクは client_scope トグルが disabled になり、internal へ変更できない', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    renderInspector({
      task: makeTask({ ball: 'client', client_scope: 'deliverable' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate,
    })

    const toggle = screen.getByTestId('task-inspector-client-scope-toggle')
    expect(toggle).toBeDisabled()

    fireEvent.click(toggle)

    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('ball=client のタスクには自動公開の注記が表示される', () => {
    renderInspector({
      task: makeTask({ ball: 'client', client_scope: 'deliverable' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(
      screen.getByText('外部ボールのタスクは自動的にクライアント公開になります')
    ).toBeInTheDocument()
  })

  it('onUpdate が無い（読み取り専用）場合はトグルを表示せずテキストのみ表示する', () => {
    renderInspector({
      task: makeTask({ ball: 'internal', client_scope: 'deliverable' }),
      spaceId: 's1',
      onClose: vi.fn(),
    })

    expect(screen.queryByTestId('task-inspector-client-scope-toggle')).not.toBeInTheDocument()
    expect(screen.getByText('公開中')).toBeInTheDocument()
  })
})

describe('TaskInspector — 完了タスクの「クライアント確認待ち」バッジ抑止', () => {
  // TaskRow側は #172 で status=done を除外済み。インスペクタ側の取り残し回帰テスト。
  it('status=done かつ ball=client のときバッジを表示しない', () => {
    renderInspector({
      task: makeTask({ ball: 'client', status: 'done', client_scope: 'deliverable' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(screen.queryByText('クライアント確認待ち')).not.toBeInTheDocument()
  })

  it('status!=done かつ ball=client のときは引き続きバッジを表示する', () => {
    renderInspector({
      task: makeTask({ ball: 'client', status: 'in_progress', client_scope: 'deliverable' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(screen.getByText('クライアント確認待ち')).toBeInTheDocument()
  })
})

// ボールの補足は常時表示（A3）から「?」ヘルプアイコンの中へ移した。
// 狭い枠に説明文を敷き詰めるより、必要な人だけが開ける形にする。
describe('TaskInspector — ボールの説明はヘルプアイコンの中', () => {
  it('ボールのラベルの右に「?」ヘルプがあり、既定では説明文を出さない', () => {
    renderInspector({
      task: makeTask({ ball: 'internal' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(screen.getByRole('button', { name: /ボールの補足/ })).toBeInTheDocument()
    expect(
      screen.queryByText('次にアクションを取る側。外部=クライアントの対応待ち')
    ).not.toBeInTheDocument()
  })

  it('「?」を押すと説明文が開く', () => {
    renderInspector({
      task: makeTask({ ball: 'internal' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    fireEvent.click(screen.getByRole('button', { name: /ボールの補足/ }))

    expect(
      screen.getByText('次にアクションを取る側。外部=クライアントの対応待ち')
    ).toBeInTheDocument()
  })
})

// AI秘書 Stage5 期限リマインド PR-0(§2.1/§5.2): due_authority_connection_id 非NULL(external権威)の
// タスクは期限(due_date)を TaskApp から編集不可。UIは読み取り専用表示＋出所の注記にする。
describe('TaskInspector — 期限の正本境界(due_authority_connection_id)', () => {
  it('due_authority_connection_id が非NULL のとき、期限は読み取り専用になり編集用の入力を出さない', () => {
    renderInspector({
      task: makeTask({ due_date: '2026-07-25', due_authority_connection_id: 'conn-gtasks-1' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(screen.queryByTestId('task-inspector-due-date')).not.toBeInTheDocument()
    expect(screen.getByText('2026/7/25')).toBeInTheDocument()
    expect(screen.getByText(/連携元ツール|Google Tasks/)).toBeInTheDocument()
  })

  it('due_authority_connection_id が非NULL でも開始日は引き続き編集できる(期限だけが読取専用)', () => {
    renderInspector({
      task: makeTask({ start_date: '2026-07-01', due_authority_connection_id: 'conn-gtasks-1' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    expect(screen.getByTestId('task-inspector-start-date')).toBeInTheDocument()
  })

  it('due_authority_connection_id が null のときは従来通り期限を編集できる', () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    renderInspector({
      task: makeTask({ due_date: null, due_authority_connection_id: null }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate,
    })

    expect(screen.getByTestId('task-inspector-due-date')).toBeInTheDocument()
    expect(screen.queryByText(/連携元ツール|Google Tasks/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByTestId('task-inspector-due-date'), { target: { value: '2026-08-01' } })
    expect(onUpdate).toHaveBeenCalledWith({ dueDate: '2026-08-01' })
  })
})

// 説明欄が「どこからどこまでが説明か」一目で分かるよう、背景色＋罫線で囲った領域にする。
describe('TaskInspector — 説明は区切られた領域として見える', () => {
  it('説明のラベルを含む枠に背景色と罫線が付いている', () => {
    renderInspector({
      task: makeTask({ description: '説明のテキスト' }),
      spaceId: 's1',
      onClose: vi.fn(),
      onUpdate: vi.fn(),
    })

    const section = screen.getByText('説明').closest('div')
    expect(section?.className).toMatch(/\bbg-gray-50\b/)
    expect(section?.className).toMatch(/\bborder-gray-200\b/)
  })

  it('読み取り専用（onUpdate なし）でも同じ枠で囲む', () => {
    renderInspector({
      task: makeTask({ description: '説明のテキスト' }),
      spaceId: 's1',
      onClose: vi.fn(),
    })

    const section = screen.getByText('説明').closest('div')
    expect(section?.className).toMatch(/\bbg-gray-50\b/)
    expect(section?.className).toMatch(/\bborder-gray-200\b/)
  })
})
