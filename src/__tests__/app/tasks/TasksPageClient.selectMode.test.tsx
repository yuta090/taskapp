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
 * 行の左に「選択」と「完了」の同じ形の四角が2つ並んで区別できなかった問題の対策。
 * 一括選択は常設をやめ、ツールバーの「選択」を押しているあいだだけのモードにする。
 */
describe('TasksPageClient 選択モード', () => {
  it('ツールバーに「選択」ボタンがあり、ふだんは一括操作バーが出ていない', () => {
    renderPage()
    expect(screen.getByRole('button', { name: /まとめて操作/ })).toBeInTheDocument()
    expect(screen.queryByText('0件選択')).not.toBeInTheDocument()
  })

  it('「選択」を押すと一括操作バーが出て、もう一度押すと閉じる', () => {
    renderPage()
    const toggle = screen.getByRole('button', { name: /まとめて操作/ })
    fireEvent.click(toggle)
    expect(screen.getByText('0件選択')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(screen.queryByText('0件選択')).not.toBeInTheDocument()
  })

  it('1件も選んでいないあいだは一括操作のボタンを押せない', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /まとめて操作/ }))
    expect(screen.getByRole('button', { name: '完了に変更' })).toBeDisabled()
  })

  it('「選択をやめる」で一括操作バーが閉じる', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /まとめて操作/ }))
    fireEvent.click(screen.getByRole('button', { name: '選択をやめる' }))
    expect(screen.queryByText('0件選択')).not.toBeInTheDocument()
  })
})
