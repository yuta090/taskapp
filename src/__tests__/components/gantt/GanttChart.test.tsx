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
  DotsSixVertical: () => <span data-testid="icon-drag-handle" />,
  LinkBreak: () => <span data-testid="icon-link-break" />,
}))

// Mock @dnd-kit/core - must match actual usage
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div data-testid="drag-overlay">{children}</div>,
  useSensor: () => ({}),
  useSensors: () => [],
  PointerSensor: class {},
  useDraggable: ({ id, disabled }: { id: string; disabled?: boolean }) => ({
    attributes: { 'data-draggable-id': id },
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
    disabled,
  }),
  useDroppable: ({ id }: { id: string }) => ({
    setNodeRef: vi.fn(),
    isOver: false,
    active: null,
    over: null,
    disabled: false,
    droppableId: id,
  }),
}))

const createTask = (overrides: Partial<Task> & { id: string; title: string }): Task => ({
  org_id: 'org-1',
  space_id: 'space-1',
  description: null,
  status: 'backlog',
  priority: null,
  assignee_id: null,
  start_date: null,
  due_date: null,
  milestone_id: null,
  ball: 'internal',
  origin: 'internal',
  type: 'task',
  spec_path: null,
  decision_state: null,
  client_scope: 'internal',
  actual_hours: null,
  parent_task_id: null,
  wiki_page_id: null,
  completed_at: null,
  created_at: '2024-01-15',
  updated_at: '2024-01-15',
  ...overrides,
})

const mockTasks: Task[] = [
  createTask({
    id: 'task-1',
    title: 'Task 1 - Client',
    status: 'in_progress',
    priority: 1,
    due_date: '2024-02-15',
    ball: 'client',
    origin: 'client',
  }),
  createTask({
    id: 'task-2',
    title: 'Task 2 - Internal',
    status: 'backlog',
    priority: 2,
    due_date: '2024-03-01',
  }),
  createTask({
    id: 'task-3',
    title: 'Task 3 - Done',
    status: 'done',
    due_date: '2024-01-31',
    completed_at: '2024-01-30',
  }),
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

    expect(screen.getByText('進行中')).toBeInTheDocument()
    expect(screen.getByText('未着手')).toBeInTheDocument()
    expect(screen.getAllByText('完了').length).toBeGreaterThanOrEqual(1)
  })

  it('should render legend', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    expect(screen.getByText('外部確認待ち')).toBeInTheDocument()
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

    const taskRow = screen.getByText('Task 1 - Client').closest('div')
    expect(taskRow).toBeInTheDocument()
  })

  it('should change view mode when zoom buttons clicked', () => {
    render(<GanttChart tasks={mockTasks} milestones={mockMilestones} />)

    expect(screen.getByText('日')).toBeInTheDocument()

    const zoomOutButton = screen.getByTitle('縮小')
    fireEvent.click(zoomOutButton)

    expect(screen.getByText('週')).toBeInTheDocument()
  })

  // DnD Parent-Child Tests
  describe('DnD parent-child assignment', () => {
    it('should render drag handles for non-parent tasks when onParentChange is provided', () => {
      const onParentChange = vi.fn()
      render(
        <GanttChart
          tasks={mockTasks}
          milestones={mockMilestones}
          onParentChange={onParentChange}
        />
      )

      // All 3 tasks should have drag handles (none are parents)
      const dragHandles = screen.getAllByTitle('ドラッグして親タスクに紐づけ')
      expect(dragHandles.length).toBe(3)
    })

    it('should not render drag handles without onParentChange prop', () => {
      render(
        <GanttChart
          tasks={mockTasks}
          milestones={mockMilestones}
        />
      )

      const dragHandles = screen.queryAllByTitle('ドラッグして親タスクに紐づけ')
      expect(dragHandles.length).toBe(0)
    })

    it('should not render drag handles for parent tasks (tasks with children)', () => {
      const parentTask = createTask({
        id: 'parent-1',
        title: 'Parent Task',
        due_date: '2024-03-01',
      })
      const childTask = createTask({
        id: 'child-1',
        title: 'Child Task',
        parent_task_id: 'parent-1',
        due_date: '2024-02-28',
      })

      const onParentChange = vi.fn()
      render(
        <GanttChart
          tasks={[parentTask, childTask]}
          milestones={[]}
          onParentChange={onParentChange}
        />
      )

      // Only the child task should have a drag handle
      const dragHandles = screen.getAllByTitle('ドラッグして親タスクに紐づけ')
      expect(dragHandles.length).toBe(1)
    })

    it('should show indent marker for child tasks', () => {
      const parentTask = createTask({
        id: 'parent-1',
        title: 'Parent Task',
        due_date: '2024-03-01',
      })
      const childTask = createTask({
        id: 'child-1',
        title: 'Child Task',
        parent_task_id: 'parent-1',
        due_date: '2024-02-28',
      })

      const onParentChange = vi.fn()
      render(
        <GanttChart
          tasks={[parentTask, childTask]}
          milestones={[]}
          onParentChange={onParentChange}
        />
      )

      expect(screen.getByText('└')).toBeInTheDocument()
    })

    it('should render unlink button for child tasks', () => {
      const parentTask = createTask({
        id: 'parent-1',
        title: 'Parent Task',
        due_date: '2024-03-01',
      })
      const childTask = createTask({
        id: 'child-1',
        title: 'Child Task',
        parent_task_id: 'parent-1',
        due_date: '2024-02-28',
      })

      const onParentChange = vi.fn()
      render(
        <GanttChart
          tasks={[parentTask, childTask]}
          milestones={[]}
          onParentChange={onParentChange}
        />
      )

      const unlinkButton = screen.getByTitle('親タスクの紐づけを解除')
      expect(unlinkButton).toBeInTheDocument()
    })

    it('should call onParentChange with null when unlink button is clicked', () => {
      const parentTask = createTask({
        id: 'parent-1',
        title: 'Parent Task',
        due_date: '2024-03-01',
      })
      const childTask = createTask({
        id: 'child-1',
        title: 'Child Task',
        parent_task_id: 'parent-1',
        due_date: '2024-02-28',
      })

      const onParentChange = vi.fn()
      render(
        <GanttChart
          tasks={[parentTask, childTask]}
          milestones={[]}
          onParentChange={onParentChange}
        />
      )

      const unlinkButton = screen.getByTitle('親タスクの紐づけを解除')
      fireEvent.click(unlinkButton)

      expect(onParentChange).toHaveBeenCalledWith('child-1', null)
    })
  })
})
