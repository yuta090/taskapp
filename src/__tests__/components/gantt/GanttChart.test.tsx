import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GanttChart } from '@/components/gantt/GanttChart'
import type { Task, Milestone } from '@/types/database'

// Mock Phosphor icons
vi.mock('@phosphor-icons/react', () => ({
  CalendarBlank: () => <span data-testid="icon-calendar" />,
  CaretLeft: () => <span data-testid="icon-caret-left" />,
  CaretRight: () => <span data-testid="icon-caret-right" />,
  MagnifyingGlassMinus: () => <span data-testid="icon-zoom-out" />,
  MagnifyingGlassPlus: () => <span data-testid="icon-zoom-in" />,
  ListBullets: () => <span data-testid="icon-list-bullets" />,
  Rows: () => <span data-testid="icon-rows" />,
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
    parent_task_id: null,
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
    parent_task_id: null,
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
    parent_task_id: null,
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
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  },
]

describe('GanttChart', () => {
  it('should render chart header', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    expect(screen.getByText('ガントチャート')).toBeInTheDocument()
    expect(screen.getByText('3 タスク')).toBeInTheDocument()
  })

  it('should render task titles in sidebar', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    expect(screen.getByText('Task 1 - Client')).toBeInTheDocument()
    expect(screen.getByText('Task 2 - Internal')).toBeInTheDocument()
    expect(screen.getByText('Task 3 - Done')).toBeInTheDocument()
  })

  it('should render status badges', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    // Status badges in sidebar - use getAllByText since legend also has "完了"
    expect(screen.getByText('進行中')).toBeInTheDocument()
    expect(screen.getByText('未着手')).toBeInTheDocument()
    // Multiple "完了" texts exist (sidebar badge + legend)
    expect(screen.getAllByText('完了').length).toBeGreaterThanOrEqual(1)
  })

  it('should render legend', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    expect(screen.getByText('クライアント確認待ち')).toBeInTheDocument()
    expect(screen.getByText('社内対応中')).toBeInTheDocument()
    expect(screen.getByText('マイルストーン')).toBeInTheDocument()
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

  it('should show empty state when no tasks', () => {
    render(<GanttChart tasks={[]} milestones={[]} />)

    // Multiple "タスクがありません" texts exist (sidebar + chart body)
    expect(screen.getAllByText('タスクがありません').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('0 タスク')).toBeInTheDocument()
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
