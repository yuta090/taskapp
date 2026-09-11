import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { GanttPageClient } from '@/app/(internal)/[orgId]/project/[spaceId]/views/gantt/GanttPageClient'
import type { Task } from '@/types/database'

// 閲覧者（viewer）・相手先には、ガントのドラッグ編集（日付変更・バー移動・親子付け替え）と
// タスク詳細の編集を出さない。GanttChart 自体は onDateChange 等の有無で
// ドラッグハンドルの描画を出し分ける設計（GanttRow 参照）なので、ここでは
// GanttPageClient がその props をどう渡すかだけを確かめる。

const mockSetInspector = vi.fn()
let searchParamsValue = ''

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(searchParamsValue),
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
    title: 'ガントのタスク',
    description: null,
    status: 'todo',
    priority: null,
    assignee_id: null,
    start_date: '2026-09-01',
    due_date: '2026-09-05',
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
    loading: false,
    error: null,
    fetchTasks: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    passBall: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useMilestones', () => ({
  useMilestones: () => ({
    milestones: [],
    loading: false,
    error: null,
    fetchMilestones: vi.fn(),
    updateMilestone: vi.fn(),
  }),
}))

vi.mock('@/lib/hooks/useRiskForecast', () => ({
  useRiskForecast: () => ({ forecasts: new Map() }),
}))

vi.mock('@/lib/hooks/useSpaceMembers', () => ({
  useSpaceMembers: () => ({ members: [{ id: 'u1', displayName: 'あなた', avatarUrl: null, role: 'viewer' }] }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: { id: 'u1' }, loading: false, error: null }),
}))

vi.mock('@/lib/hooks/useSpaceName', () => ({
  useSpaceName: () => 'プロジェクト',
}))

vi.mock('@/lib/hooks/useAnnouncements', () => ({
  useAnnouncements: () => ({ announcements: [], unreadCount: 0, markAsRead: vi.fn(), markAllAsRead: vi.fn() }),
}))

const ganttChartProps: { current: Record<string, unknown> | null } = { current: null }
vi.mock('@/components/gantt', () => ({
  GanttChart: (props: Record<string, unknown>) => {
    ganttChartProps.current = props
    return <div data-testid="gantt-chart" />
  },
}))

let canEdit = true
vi.mock('@/lib/hooks/useCanEditSpace', () => ({
  useCanEditSpace: () => ({ canEdit, loading: false }),
}))

function renderPage() {
  return render(<GanttPageClient orgId="org-1" spaceId="space-1" />)
}

beforeEach(() => {
  searchParamsValue = ''
  ganttChartProps.current = null
  mockSetInspector.mockClear()
})

describe('GanttPageClient — 編集できる人には従来どおりドラッグ編集を渡す', () => {
  it('onDateChange / onBarMove / onParentChange が渡る', () => {
    canEdit = true
    renderPage()
    expect(ganttChartProps.current?.onDateChange).toBeInstanceOf(Function)
    expect(ganttChartProps.current?.onBarMove).toBeInstanceOf(Function)
    expect(ganttChartProps.current?.onParentChange).toBeInstanceOf(Function)
  })
})

describe('GanttPageClient — 閲覧者（viewer）にはガントのドラッグ編集を渡さない', () => {
  it('onDateChange / onBarMove / onParentChange が undefined になる', () => {
    canEdit = false
    renderPage()
    expect(ganttChartProps.current?.onDateChange).toBeUndefined()
    expect(ganttChartProps.current?.onBarMove).toBeUndefined()
    expect(ganttChartProps.current?.onParentChange).toBeUndefined()
  })

  it('選択中タスク(?task=t1)でも、TaskInspector には編集用のコールバックを渡さない', () => {
    canEdit = false
    searchParamsValue = 'task=t1'
    renderPage()

    const lastCallArg = mockSetInspector.mock.calls.at(-1)?.[0]
    expect(lastCallArg).toBeTruthy()
    expect(lastCallArg.props.onUpdate).toBeUndefined()
    expect(lastCallArg.props.onPassBall).toBeUndefined()
    expect(lastCallArg.props.onDelete).toBeUndefined()
    expect(lastCallArg.props.onUpdateOwners).toBeUndefined()
  })
})
