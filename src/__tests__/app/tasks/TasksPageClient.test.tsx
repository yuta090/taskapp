import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TasksPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient'

const mockSetInspector = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: mockSetInspector }),
}))

vi.mock('@/lib/hooks/useTasks', () => ({
  useTasks: () => ({
    tasks: [],
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

// TaskCreateSheet is loaded via next/dynamic and always mounted (gated
// internally by its own `isOpen` prop); the real component pulls in
// useSpaceMembers/useWikiPages/useEstimationAssist. Stub it so the empty-state
// CTA test only has to prove state is wired, not re-test the sheet itself.
vi.mock('@/components/task/TaskCreateSheet', () => ({
  TaskCreateSheet: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="task-create-sheet">新規タスク作成</div> : null,
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TasksPageClient orgId="org-1" spaceId="space-1" />
    </QueryClientProvider>
  )
}

/**
 * B-5: the empty task list only hinted at the "N" keyboard shortcut
 * ("Nキーで最初のタスクを作成しましょう") instead of offering a clickable CTA.
 */
describe('TasksPageClient empty state', () => {
  it('shows a "タスクを作成" button when there are no tasks', () => {
    renderPage()
    expect(screen.getByText('タスクはありません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'タスクを作成' })).toBeInTheDocument()
  })

  it('clicking the CTA drives the same URL-sync path as the "N" keyboard shortcut (create=1)', () => {
    // isCreateOpen is derived from the URL (searchParams.get('create')), and
    // this component writes it via window.history.replaceState rather than
    // the (mocked, static) next/navigation router — so we assert on the
    // history write instead of a rerendered isCreateOpen/TaskCreateSheet.
    const replaceStateSpy = vi.spyOn(window.history, 'replaceState')
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'タスクを作成' }))

    expect(replaceStateSpy).toHaveBeenCalledWith(
      null,
      '',
      expect.stringContaining('create=1')
    )
  })
})

/**
 * ストリームC「クライアント表示プレビュー」入口: このヘッダーから
 * /portal/preview/{spaceId} へ内部ユーザーが遷移できる控えめなリンク。
 */
describe('TasksPageClient client preview entry link', () => {
  it('links to /portal/preview/{spaceId}', () => {
    renderPage()

    const link = screen.getByRole('link', { name: /クライアント表示/ })
    expect(link).toHaveAttribute('href', '/portal/preview/space-1')
  })
})
