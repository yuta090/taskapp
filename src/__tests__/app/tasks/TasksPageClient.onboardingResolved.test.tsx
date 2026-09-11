import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { TasksPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/TasksPageClient'

// 操作ガイド（InternalOnboardingWalkthrough）は、役割が確定するまで開いてはいけない
// （確定前に開くと、後で手順の数が変わって表示中の内容がすり替わる）。
// TasksPageClient が useCanEditSpace の resolved を roleResolved としてそのまま
// 渡していることを確かめる（実際に開く/開かないの判定自体は
// InternalOnboardingWalkthrough.test.tsx で担保済み）。

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/layout', () => ({
  useInspector: () => ({ setInspector: vi.fn() }),
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

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

vi.mock('@/components/task/TaskCreateSheet', () => ({
  TaskCreateSheet: () => null,
}))

const walkthroughProps: { current: Record<string, unknown> | null } = { current: null }
vi.mock('@/components/onboarding/InternalOnboardingWalkthrough', () => ({
  InternalOnboardingWalkthrough: (props: Record<string, unknown>) => {
    walkthroughProps.current = props
    return null
  },
}))

let mockCanEdit = true
let mockResolved = true
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit: mockCanEdit, canEditMoney: mockCanEdit, resolved: mockResolved, loading: !mockResolved }),
}))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TasksPageClient orgId="org-1" spaceId="space-1" />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  walkthroughProps.current = null
  mockCanEdit = true
  mockResolved = true
})

describe('TasksPageClient — 操作ガイドには役割が確定したかどうかを渡す', () => {
  it('役割が未確定のとき、roleResolved=false を渡す', () => {
    mockResolved = false
    renderPage()
    expect(walkthroughProps.current?.roleResolved).toBe(false)
  })

  it('役割が確定して編集者のとき、canEdit=true・roleResolved=true を渡す', () => {
    mockCanEdit = true
    mockResolved = true
    renderPage()
    expect(walkthroughProps.current?.canEdit).toBe(true)
    expect(walkthroughProps.current?.roleResolved).toBe(true)
  })

  it('役割が確定して閲覧者のとき、canEdit=false・roleResolved=true を渡す', () => {
    mockCanEdit = false
    mockResolved = true
    renderPage()
    expect(walkthroughProps.current?.canEdit).toBe(false)
    expect(walkthroughProps.current?.roleResolved).toBe(true)
  })
})
