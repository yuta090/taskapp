import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TasksPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient'
import type { Task } from '@/types/database'

/**
 * 「すべてのタスク」の既定の表示は「アクティブ」。
 * 開いた直後に完了・未着手まで並ぶと、いま動いているタスクが埋もれるため。
 * 「すべて」は明示的に選んだときだけ（URL に filter=all が入る）。
 */

let mockSearch = ''

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mockSearch),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: vi.fn() }),
}))

let mockTasks: Task[] = []

vi.mock('@/lib/hooks/useTasks', () => ({
  useTasks: () => ({
    tasks: mockTasks,
    owners: {},
    reviewStatuses: {},
    loading: false,
    error: null,
    fetchTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    passBall: vi.fn(),
    handleReviewChange: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({ milestones: [] }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ getMemberName: () => null, members: [], loading: false, error: null }),
}))

vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, loading: false }),
}))

vi.mock('@/lib/hooks/useRiskForecast', () => ({
  useRiskForecast: () => ({ forecasts: new Map() }),
}))

vi.mock('@/components/task/TaskCreateSheet', () => ({
  TaskCreateSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="task-create-sheet">新規タスク作成</div> : null,
}))

// jsdom は高さ0の入れ物を返すので、本物の仮想化だと1行も描かれない。
// どの行が一覧に残るかを見たいので、全行描くように差し替える
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 40,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        index,
        start: index * 40,
        size: 40,
      })),
    measure: () => {},
  }),
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    org_id: 'o1',
    space_id: 'space-1',
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
    is_sample: false,
    created_at: '2026-01-01T00:00:00',
    updated_at: '2026-01-01T00:00:00',
    ...overrides,
  } as Task
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TasksPageClient orgId="org-1" spaceId="space-1" />
    </QueryClientProvider>
  )
}

const THREE_KINDS = [
  makeTask({ id: 'doing', title: '進行中のタスク', status: 'in_progress' }),
  makeTask({ id: 'finished', title: '完了したタスク', status: 'done' }),
  makeTask({ id: 'not-started', title: '未着手のタスク', status: 'backlog' }),
]

let replaceStateSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mockTasks = []
  mockSearch = ''
  replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
})

afterEach(() => {
  replaceStateSpy.mockRestore()
})

/** 最後に書き換えられた URL */
function lastUrl(): string {
  return String(replaceStateSpy.mock.calls.at(-1)?.[2] ?? '')
}

describe('TasksPageClient — 既定は「アクティブ」', () => {
  it('URL に filter が無いとき、完了・未着手は一覧に出ない', () => {
    mockTasks = THREE_KINDS
    renderPage()

    expect(screen.getByText('進行中のタスク')).toBeInTheDocument()
    expect(screen.queryByText('完了したタスク')).not.toBeInTheDocument()
    expect(screen.queryByText('未着手のタスク')).not.toBeInTheDocument()
  })

  it('URL に filter が無いとき、「アクティブ」が選ばれた見た目になっている', () => {
    renderPage()

    expect(screen.getByTestId('tasks-filter-active').className).toContain('bg-surface')
    expect(screen.getByTestId('tasks-filter-all').className).not.toContain('bg-surface')
  })

  it('filter=all のときは完了・未着手も並ぶ', () => {
    mockSearch = 'filter=all'
    mockTasks = THREE_KINDS
    renderPage()

    expect(screen.getByText('進行中のタスク')).toBeInTheDocument()
    expect(screen.getByText('完了したタスク')).toBeInTheDocument()
    expect(screen.getByText('未着手のタスク')).toBeInTheDocument()
  })

  it('「すべて」を押すと URL に filter=all が入る（既定ではないので残す）', () => {
    renderPage()
    fireEvent.click(screen.getByTestId('tasks-filter-all'))

    expect(lastUrl()).toContain('filter=all')
  })

  it('「アクティブ」を押すと URL から filter が消える（既定なので付けない）', () => {
    mockSearch = 'filter=backlog'
    renderPage()
    fireEvent.click(screen.getByTestId('tasks-filter-active'))

    expect(lastUrl()).not.toContain('filter=')
  })

  it('全部が完了・未着手のときは「タスクはありません」ではなく、「すべて」で見られると伝える', () => {
    mockTasks = [
      makeTask({ id: 'finished', title: '完了したタスク', status: 'done' }),
      makeTask({ id: 'not-started', title: '未着手のタスク', status: 'backlog' }),
    ]
    renderPage()

    expect(screen.getByText(/動いているタスクはありません/)).toBeInTheDocument()
    expect(screen.queryByText('タスクを作成')).not.toBeInTheDocument()
  })

  it('タスクが1件も無いときは、これまでどおり「タスクはありません」と出す', () => {
    mockTasks = []
    renderPage()

    expect(screen.getByText('タスクはありません')).toBeInTheDocument()
  })

  it('タスクを開いたまま「すべて」に切り替えても、開いているタスクは URL に残る', () => {
    mockSearch = 'task=doing'
    mockTasks = THREE_KINDS
    renderPage()
    fireEvent.click(screen.getByTestId('tasks-filter-all'))

    expect(lastUrl()).toContain('task=doing')
    expect(lastUrl()).toContain('filter=all')
  })
})
