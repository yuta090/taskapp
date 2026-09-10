import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { GanttChart } from '@/components/gantt/GanttChart'
import { formatDateToLocalString } from '@/lib/gantt/dateUtils'
import type { Task } from '@/types/database'

// Mock Phosphor icons (見た目のアイコンはこのテストでは無関係)
import { vi } from 'vitest'
vi.mock('@phosphor-icons/react', () => ({
  CalendarBlank: () => <span data-testid="icon-calendar" />,
  MagnifyingGlassMinus: () => <span data-testid="icon-zoom-out" />,
  MagnifyingGlassPlus: () => <span data-testid="icon-zoom-in" />,
  LinkBreak: () => <span data-testid="icon-link-break" />,
  FunnelSimple: () => <span data-testid="icon-funnel-simple" />,
  SortAscending: () => <span data-testid="icon-sort-ascending" />,
  SortDescending: () => <span data-testid="icon-sort-descending" />,
}))

function makeTasks(count: number): Task[] {
  // すべて同じ期日(今日+10日)にして、calcDateRangeが伸びず日付レンジが
  // タスク数によらず一定になるようにする(グリッドの本数=日数だけに依存することを検証するため)。
  const due = new Date()
  due.setDate(due.getDate() + 10)
  const dueStr = formatDateToLocalString(due)

  return Array.from({ length: count }).map((_, i) => ({
    id: `task-${i}`,
    org_id: 'org-1',
    space_id: 'space-1',
    title: `Task ${i}`,
    description: null,
    status: 'in_progress',
    priority: null,
    assignee_id: null,
    start_date: null,
    due_date: dueStr,
    milestone_id: null,
    ball: i % 2 === 0 ? 'client' : 'internal',
    origin: 'internal',
    type: 'task',
    spec_path: null,
    decision_state: null,
    client_scope: 'internal',
    actual_hours: null,
    estimated_cost: null,
    estimate_status: 'none' as const,
    is_sample: false,
    parent_task_id: null,
    wiki_page_id: null,
    completed_at: null,
    due_authority_connection_id: null,
    short_id: null,
    created_at: dueStr,
    updated_at: dueStr,
  }))
}

describe('GanttChart — 週末背景/グリッド線は行数に依存せず全体で1回だけ描く', () => {
  it('行数(タスク数)が10でも200でも、週末背景とグリッド線の要素数は変わらない', () => {
    const { container: fewContainer } = render(
      <GanttChart tasks={makeTasks(10)} milestones={[]} />
    )
    const { container: manyContainer } = render(
      <GanttChart tasks={makeTasks(200)} milestones={[]} />
    )

    const fewGridLines = fewContainer.querySelectorAll('[data-testid="gantt-grid-line"]')
    const manyGridLines = manyContainer.querySelectorAll('[data-testid="gantt-grid-line"]')
    const fewWeekendRects = fewContainer.querySelectorAll('[data-testid="gantt-weekend-rect"]')
    const manyWeekendRects = manyContainer.querySelectorAll('[data-testid="gantt-weekend-rect"]')

    expect(fewGridLines.length).toBeGreaterThan(0)
    expect(fewGridLines.length).toBe(manyGridLines.length)
    expect(fewWeekendRects.length).toBe(manyWeekendRects.length)

    // 行数分(タスク数ぶん)増殖していないことも明示的に確認する
    expect(manyGridLines.length).toBeLessThan(200)
  })
})
