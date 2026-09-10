import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render as rtlRender, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TaskInspector } from '@/components/task/TaskInspector'
import type { Task } from '@/types/database'

/**
 * タスク通し番号(tasks.short_id)の表示。GitHub連携がPRタイトルの `TP-番号` から
 * タスクを自動で見つける仕組みがあるが、番号を確認する手段が画面に無かったため追加。
 */

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
    short_id: null,
    created_at: '2026-07-01T00:00:00',
    updated_at: '2026-07-01T00:00:00',
    ...overrides,
  }
}

describe('TaskInspector — タスク通し番号(short_id)の表示', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  it('short_id があるとき TP-<番号> を表示する', () => {
    render(<TaskInspector task={makeTask({ short_id: 42 })} spaceId="s1" onClose={() => {}} />)
    expect(screen.getByTestId('task-inspector-task-number')).toHaveTextContent('TP-42')
  })

  it('short_id が null のときは何も表示しない', () => {
    render(<TaskInspector task={makeTask({ short_id: null })} spaceId="s1" onClose={() => {}} />)
    expect(screen.queryByTestId('task-inspector-task-number')).not.toBeInTheDocument()
  })

  it('押すと TP-<番号> をクリップボードにコピーする', async () => {
    render(<TaskInspector task={makeTask({ short_id: 42 })} spaceId="s1" onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('task-inspector-task-number'))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('TP-42'))
  })

  it('コピー後は一時的に「コピーしました」と表示する', async () => {
    render(<TaskInspector task={makeTask({ short_id: 42 })} spaceId="s1" onClose={() => {}} />)
    fireEvent.click(screen.getByTestId('task-inspector-task-number'))
    expect(await screen.findByText('コピーしました')).toBeInTheDocument()
  })

  it('コピーに失敗しても例外を投げない', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })
    render(<TaskInspector task={makeTask({ short_id: 42 })} spaceId="s1" onClose={() => {}} />)
    expect(() => fireEvent.click(screen.getByTestId('task-inspector-task-number'))).not.toThrow()
  })
})

/**
 * TaskInspector はタスクを切り替えてもアンマウントされない（TasksPageClient/GanttPageClient で
 * key を振っていないため）。「コピーしました」の1.5秒タイマーが素朴な setTimeout のままだと、
 * タスクAで押した直後にBへ切り替えても表示が残る／2回続けて押すと1回目のタイマーが早く消す、
 * という不具合になる。「保存しました」(savedTimerRef)と同じ作りに揃えて防ぐ。
 */
describe('TaskInspector — 「コピーしました」表示のタイマー(タスク切り替え・連打)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function renderWithProvider() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const utils = rtlRender(
      <QueryClientProvider client={queryClient}>
        <TaskInspector task={makeTask({ id: 't1', short_id: 42 })} spaceId="s1" onClose={() => {}} />
      </QueryClientProvider>
    )
    const rerenderTask = (task: Task) =>
      utils.rerender(
        <QueryClientProvider client={queryClient}>
          <TaskInspector task={task} spaceId="s1" onClose={() => {}} />
        </QueryClientProvider>
      )
    return { ...utils, rerenderTask }
  }

  it('押した直後に別タスクへ切り替えると「コピーしました」が出ていない', async () => {
    const { rerenderTask } = renderWithProvider()

    await act(async () => {
      fireEvent.click(screen.getByTestId('task-inspector-task-number'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('コピーしました')).toBeInTheDocument()

    rerenderTask(makeTask({ id: 't2', short_id: 99 }))

    expect(screen.queryByText('コピーしました')).not.toBeInTheDocument()
    expect(screen.getByTestId('task-inspector-task-number')).toHaveTextContent('TP-99')
  })

  it('2回続けて押しても1.5秒は表示が続く（1回目のタイマーで早く消えない）', async () => {
    renderWithProvider()

    await act(async () => {
      fireEvent.click(screen.getByTestId('task-inspector-task-number'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByText('コピーしました')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId('task-inspector-task-number'))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(2)

    // 1回目のクリックから1500msが経過した時点（2回目クリックからは500ms）でもまだ表示されている
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500)
    })
    expect(screen.getByText('コピーしました')).toBeInTheDocument()

    // 2回目のクリックから1500ms経過すると消える
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(screen.queryByText('コピーしました')).not.toBeInTheDocument()
  })
})
