import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TasksPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient'
import type { Task } from '@/types/database'

/**
 * 「すべてのタスク」で担当者が分からない／担当者で絞れない／担当者別が「未割り当て」だけ、の対策。
 * 本番では task_owners（ボールを持っている人）が一部のタスクにしか無く、それを担当者の名簿に
 * 使っていたため、担当者の選択肢が「未割り当て」だけになっていた。
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: vi.fn() }),
}))

let mockTasks: Task[] = []

vi.mock('@/lib/hooks/useTasks', () => ({
  useTasks: () => ({
    tasks: mockTasks,
    // 本番と同じく、ボールを持っている人の情報は無い（担当者とは別物）
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

const mockMembers = [
  { id: 'u1', displayName: '高橋', avatarUrl: null, role: 'admin' },
  { id: 'u2', displayName: '佐藤', avatarUrl: null, role: 'editor' },
  // タスクを1件も持っていない人
  { id: 'u3', displayName: '田中', avatarUrl: null, role: 'editor' },
]

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({
    members: mockMembers,
    getMemberName: (id: string) => mockMembers.find((m) => m.id === id)?.displayName ?? `${id.slice(0, 8)}...`,
    loading: false,
    error: null,
  }),
}))

vi.mock('@/lib/hooks/useSpacePendingInvites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hooks/useSpacePendingInvites')>()
  return {
    ...actual,
    useSpacePendingInvites: () => ({
      pendingInvites: [{ id: 'inv1', email: 'yamada@example.com', inviteeName: '山田', role: 'editor' }],
      loading: false,
    }),
  }
})

vi.mock('@/lib/hooks/useRiskForecast', () => ({
  useRiskForecast: () => ({ forecasts: new Map() }),
}))

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({
    announcements: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
  }),
}))

vi.mock('@/components/task/TaskCreateSheet', () => ({
  TaskCreateSheet: () => null,
}))

// jsdom はスクロール領域の大きさが 0 なので、本物の仮想化だと1行も描かれない。全行描く代役にする。
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 40,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 40, size: 40 })),
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
    assignee_invite_id: null,
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

function openAssigneeFilter() {
  fireEvent.click(screen.getByRole('button', { name: '詳細フィルター' }))
  fireEvent.click(screen.getByText('担当者'))
  return screen.getByTestId('task-filter-assignee-options')
}

beforeEach(() => {
  mockTasks = [
    makeTask({ id: 't1', title: '高橋さんのタスク', assignee_id: 'u1' }),
    makeTask({ id: 't2', title: '佐藤さんのタスク', assignee_id: 'u2' }),
    makeTask({ id: 't3', title: '山田さんのタスク', assignee_invite_id: 'inv1' }),
    makeTask({ id: 't4', title: '担当のいないタスク' }),
  ]
})

describe('TasksPageClient — 担当者', () => {
  it('一覧の各行に担当者の名前が出る（招待中の人も）', () => {
    renderPage()
    const names = screen.getAllByTestId('task-row-assignee').map((el) => el.getAttribute('title'))
    expect(names).toEqual(
      expect.arrayContaining(['担当: 高橋', '担当: 佐藤', '担当: 山田（招待中）'])
    )
    expect(names).toHaveLength(3)
  })

  it('絞り込みの担当者に、メンバー全員（タスクが無い人も）と招待中の担当者が並ぶ', () => {
    renderPage()
    const list = openAssigneeFilter()
    for (const name of ['未割り当て', '高橋', '佐藤', '田中', '山田（招待中）']) {
      expect(within(list).getByText(name)).toBeInTheDocument()
    }
  })

  it('担当者で絞ると、その人のタスクだけが残る', () => {
    renderPage()
    const list = openAssigneeFilter()
    fireEvent.click(within(list).getByText('佐藤'))
    expect(screen.getByText('佐藤さんのタスク')).toBeInTheDocument()
    expect(screen.queryByText('高橋さんのタスク')).not.toBeInTheDocument()
    expect(screen.queryByText('担当のいないタスク')).not.toBeInTheDocument()
  })

  it('「未割り当て」で絞っても、招待中の人が担当のタスクは出ない', () => {
    renderPage()
    const list = openAssigneeFilter()
    fireEvent.click(within(list).getByText('未割り当て'))
    expect(screen.getByText('担当のいないタスク')).toBeInTheDocument()
    expect(screen.queryByText('山田さんのタスク')).not.toBeInTheDocument()
  })

  it('表示方式「担当者別」で担当者ごとの見出しに分かれ、「未割り当て」は最後', () => {
    renderPage()
    fireEvent.click(screen.getByText('マイルストーン別'))
    fireEvent.click(screen.getByRole('button', { name: '担当者別' }))

    const labels = screen.getAllByTestId('task-group-label').map((el) => el.textContent)
    expect(labels).toHaveLength(4)
    expect(labels).toEqual(expect.arrayContaining(['高橋', '佐藤', '山田（招待中）']))
    expect(labels[labels.length - 1]).toBe('未割り当て')
    // 招待中の人のタスクは「未割り当て」に混ざらない（1件だけ）
    const unassignedHeader = screen.getAllByTestId('task-group-label').at(-1)!.parentElement!
    expect(unassignedHeader).toHaveTextContent('(1)')
  })
})
