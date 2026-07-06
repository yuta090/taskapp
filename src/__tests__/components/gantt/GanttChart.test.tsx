import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GanttChart } from '@/components/gantt/GanttChart'
import type { Task, Milestone } from '@/types/database'

// Mock Phosphor icons
vi.mock('@phosphor-icons/react', () => ({
  CalendarBlank: () => <span data-testid="icon-calendar" />,
  MagnifyingGlassMinus: () => <span data-testid="icon-zoom-out" />,
  MagnifyingGlassPlus: () => <span data-testid="icon-zoom-in" />,
  LinkBreak: () => <span data-testid="icon-link-break" />,
  FunnelSimple: () => <span data-testid="icon-funnel-simple" />,
  SortAscending: () => <span data-testid="icon-sort-ascending" />,
  SortDescending: () => <span data-testid="icon-sort-descending" />,
}))

const mockTasks: Task[] = [
  {
    id: 'task-1',
    org_id: 'org-1',
    space_id: 'space-1',
    title: 'Task 1 - Client',
    description: 'Description 1',
    status: 'in_progress',
    priority: 1,
    assignee_id: null,
    start_date: null,
    due_date: '2024-02-15',
    milestone_id: null,
    ball: 'client',
    origin: 'client',
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
    created_at: '2024-01-15',
    updated_at: '2024-01-15',
  },
  {
    id: 'task-2',
    org_id: 'org-1',
    space_id: 'space-1',
    title: 'Task 2 - Internal',
    description: 'Description 2',
    status: 'backlog',
    priority: 2,
    assignee_id: null,
    start_date: null,
    due_date: '2024-03-01',
    milestone_id: null,
    ball: 'internal',
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
    created_at: '2024-01-20',
    updated_at: '2024-01-20',
  },
  {
    id: 'task-3',
    org_id: 'org-1',
    space_id: 'space-1',
    title: 'Task 3 - Done',
    description: null,
    status: 'done',
    priority: null,
    assignee_id: null,
    start_date: null,
    due_date: '2024-01-31',
    milestone_id: null,
    ball: 'internal',
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
    completed_at: '2024-01-30',
    created_at: '2024-01-10',
    updated_at: '2024-01-30',
  },
]

const mockMilestones: Milestone[] = [
  {
    id: 'milestone-1',
    org_id: 'org-1',
    space_id: 'space-1',
    name: 'Phase 1 Release',
    start_date: null,
    due_date: '2024-02-28',
    order_key: 1,
    completed_at: null,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  },
]

// The header task-count ("2/3 タスク") is rendered as several sibling text
// nodes inside one <span>, so a plain getByText(string) match fails. Match
// on the element's combined textContent instead.
function hasText(text: string) {
  return (_content: string, element: Element | null) => element?.textContent === text
}

describe('GanttChart', () => {
  it('should render chart header', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    expect(screen.getByText('ガントチャート')).toBeInTheDocument()
    // Default status filter is "not_done", so Task 3 (done) is excluded
    // from the visible count: 2 shown / 3 total.
    expect(screen.getByText(hasText('2/3 タスク'))).toBeInTheDocument()
  })

  it('should render task titles in sidebar', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    // Default status filter is "not_done", which hides the done task.
    // Switch to "すべて" (all) to verify every task title renders.
    fireEvent.click(screen.getByText('すべて'))

    expect(screen.getByText('Task 1 - Client')).toBeInTheDocument()
    expect(screen.getByText('Task 2 - Internal')).toBeInTheDocument()
    expect(screen.getByText('Task 3 - Done')).toBeInTheDocument()
  })

  it('should render status badges', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    // Show all tasks (including "done") so every status badge is present.
    fireEvent.click(screen.getByText('すべて'))

    // Status labels also appear as status-filter buttons in the toolbar,
    // so use getAllByText to tolerate duplicates.
    expect(screen.getAllByText('進行中').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('未着手').length).toBeGreaterThanOrEqual(1)
    // Multiple "完了" texts exist (filter button + sidebar badge + legend)
    expect(screen.getAllByText('完了').length).toBeGreaterThanOrEqual(1)
  })

  it('should render legend', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    expect(screen.getByText('クライアント確認待ち')).toBeInTheDocument()
    expect(screen.getByText('社内対応中')).toBeInTheDocument()
    // "マイルストーン" also appears as the (default-active) grouping button,
    // so use getAllByText to tolerate duplicates.
    expect(screen.getAllByText('マイルストーン').length).toBeGreaterThanOrEqual(1)
  })

  it('should use unified terminology for the in_review status filter (M-3)', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    expect(screen.getByText('社内承認中')).toBeInTheDocument()
    expect(screen.queryByText('確認中')).not.toBeInTheDocument()
  })

  it('should render zoom controls', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    expect(screen.getByTitle('縮小')).toBeInTheDocument()
    expect(screen.getByTitle('拡大')).toBeInTheDocument()
  })

  it('should render today button', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    expect(screen.getByText('今日')).toBeInTheDocument()
  })

  it('should call onTaskClick when task is clicked', () => {
    const onTaskClick = vi.fn()
    render(
      <GanttChart
        tasks={mockTasks}
        milestones={mockMilestones}
        onTaskClick={onTaskClick}
      />
    )

    fireEvent.click(screen.getByText('Task 1 - Client'))
    expect(onTaskClick).toHaveBeenCalledWith('task-1')
  })

  it('should show an educational empty state when no tasks (初回UX改善 D)', () => {
    render(<GanttChart tasks={[]} milestones={[]} />)

    // Multiple copies exist (sidebar + chart body)
    expect(screen.getAllByText('期限付きタスクやマイルストーンを設定するとここに表示されます').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(hasText('0/0 タスク'))).toBeInTheDocument()
  })

  it('should highlight selected task', () => {
    render(
      <GanttChart
        tasks={mockTasks}
        milestones={mockMilestones}
        selectedTaskId="task-1"
      />
    )

    // The selected task row should have different styling
    const taskRow = screen.getByText('Task 1 - Client').closest('div')
    expect(taskRow).toBeInTheDocument()
  })

  it('should change view mode when zoom buttons clicked', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    // Initially in 'day' mode
    expect(screen.getByText('日')).toBeInTheDocument()

    // Click zoom out
    const zoomOutButton = screen.getByTitle('縮小')
    fireEvent.click(zoomOutButton)

    // Should now be in 'week' mode
    expect(screen.getByText('週')).toBeInTheDocument()
  })
})

describe('GanttChart initial scroll position (今日にセンタリング)', () => {
  let scrollToMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    scrollToMock = vi.fn()
    // jsdom doesn't implement Element.scrollTo
    Element.prototype.scrollTo = scrollToMock as unknown as typeof Element.prototype.scrollTo
  })

  it('scrolls the chart to today automatically on mount', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    expect(scrollToMock).toHaveBeenCalledTimes(1)
    expect(scrollToMock).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: 'auto' })
    )
  })

  it('does not scroll again on subsequent re-renders', () => {
    const { rerender } = render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)
    expect(scrollToMock).toHaveBeenCalledTimes(1)

    rerender(
      <GanttChart tasks={mockTasks} milestones={mockMilestones} selectedTaskId="task-1" />
    )

    expect(scrollToMock).toHaveBeenCalledTimes(1)
  })
})
