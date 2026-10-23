import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TasksPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient'
import type { Task } from '@/types/database'

// タスク詳細の Wiki へのリンクは、画面を移らずに Wiki を重ねて開く（マイタスクと同じ）。

const mockSetInspector = vi.fn()

// useSearchParams は静的なモック。重ねた Wiki の表示は、最初から wiki= を付けて描画して確かめる
const mockNav = vi.hoisted(() => ({ query: 'task=t1', push: vi.fn(), isMobile: false }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: mockNav.push }),
  useSearchParams: () => new URLSearchParams(mockNav.query),
}))

vi.mock('@/lib/hooks/useIsMobile', () => ({
  useIsMobile: () => mockNav.isMobile,
}))

vi.mock('@/components/wiki/WikiPageOverlay', () => ({
  WikiPageOverlay: ({ pageId, canEdit, onClose }: { pageId: string; canEdit: boolean; onClose: () => void }) => (
    <div data-testid="wiki-overlay" data-page-id={pageId} data-can-edit={String(canEdit)}>
      <button type="button" onClick={onClose}>Wikiを閉じる</button>
    </div>
  ),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: mockSetInspector }),
}))

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    org_id: 'org-1',
    space_id: 'space-1',
    milestone_id: null,
    parent_task_id: null,
    title: '閲覧者にも見えるタスク',
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

const mockTasks: Task[] = [makeTask()]

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
  TaskCreateSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="task-create-sheet">新規タスク作成</div> : null,
}))

// jsdom はレイアウトを持たず、実物の virtualizer は「高さ0のコンテナに何も見えない」と
// 判断して行を描かない。テストでは全件を単純に並べたことにする。
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 40,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({ key: index, index, start: index * 40, size: 40 })),
    measure: () => {},
  }),
}))

vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: true, canEditMoney: false, resolved: true, loading: false }),
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TasksPageClient orgId="org-1" spaceId="space-1" />
    </QueryClientProvider>
  )
}

const lastInspector = () => mockSetInspector.mock.calls.at(-1)?.[0]

describe('TasksPageClient — 詳細の Wiki を重ねて開く', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockNav.query = 'task=t1'
    mockNav.isMobile = false
    window.history.replaceState(null, '', '/org-1/project/space-1?task=t1')
  })

  it('詳細の onOpenWikiPage で、画面を移らずに wiki= を足して履歴に積む', () => {
    const pushStateSpy = vi.spyOn(window.history, 'pushState')
    renderPage()

    lastInspector().props.onOpenWikiPage('w1')

    expect(pushStateSpy).toHaveBeenLastCalledWith(null, '', '/org-1/project/space-1?task=t1&wiki=w1')
    expect(mockNav.push).not.toHaveBeenCalled()
    pushStateSpy.mockRestore()
  })

  it('wiki= があれば Wiki を重ねて出し、書ける人には書かせる', async () => {
    mockNav.query = 'task=t1&wiki=w1'
    renderPage()

    const overlay = await screen.findByTestId('wiki-overlay')
    expect(overlay).toHaveAttribute('data-page-id', 'w1')
    expect(overlay).toHaveAttribute('data-can-edit', 'true')
  })

  it('（直リンクで開いた）重ねた Wiki を閉じると wiki= だけを外し、詳細は残す', async () => {
    mockNav.query = 'task=t1&wiki=w1'
    window.history.replaceState(null, '', '/org-1/project/space-1?task=t1&wiki=w1')
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
    renderPage()

    fireEvent.click(await screen.findByText('Wikiを閉じる'))

    expect(replaceStateSpy).toHaveBeenLastCalledWith(null, '', '/org-1/project/space-1?task=t1')
    replaceStateSpy.mockRestore()
  })

  it('スマホの幅では今までどおり Wiki 画面へ移る', () => {
    mockNav.isMobile = true
    renderPage()

    lastInspector().props.onOpenWikiPage('w1')

    expect(mockNav.push).toHaveBeenCalledWith('/org-1/project/space-1/wiki?page=w1')
  })
})
