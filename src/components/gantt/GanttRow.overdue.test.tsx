import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { GanttRow } from './GanttRow'
import { GanttChart } from './GanttChart'
import { GANTT_CONFIG } from '@/lib/gantt/constants'
import type { Task } from '@/types/database'

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 'task-1',
    title: 'テストタスク',
    status: 'in_progress',
    ball: 'internal',
    start_date: '2026-09-01',
    due_date: '2026-09-10',
    due_authority_connection_id: null,
    ...overrides,
  } as Task
}

function renderRow(task: Task, todayJst: string) {
  return render(
    <svg>
      <GanttRow
        task={task}
        startDate={new Date(2026, 7, 25)}
        totalWidth={2000}
        dayWidth={40}
        rowIndex={0}
        todayJst={todayJst}
      />
    </svg>,
  )
}

describe('GanttRow overdue outline', () => {
  it('outlines an unfinished bar in red once its due date has passed', () => {
    renderRow(makeTask({ due_date: '2026-09-10' }), '2026-09-15')
    const outline = screen.getByTestId('gantt-bar-overdue-outline')
    expect(outline).toHaveAttribute('stroke', GANTT_CONFIG.COLORS.OVERDUE)
  })

  it('keeps the ball color on the bar body so whose turn it is stays visible', () => {
    const { container } = renderRow(makeTask({ ball: 'client', due_date: '2026-09-10' }), '2026-09-15')
    expect(container.querySelector(`rect[fill="${GANTT_CONFIG.COLORS.CLIENT}"]`)).not.toBeNull()
    expect(screen.getByTestId('gantt-bar-overdue-outline')).toBeInTheDocument()
  })

  it('does not outline a done task even if its due date has passed', () => {
    renderRow(makeTask({ status: 'done', due_date: '2026-09-10' }), '2026-09-15')
    expect(screen.queryByTestId('gantt-bar-overdue-outline')).toBeNull()
  })

  it('does not outline a task that is due today', () => {
    renderRow(makeTask({ due_date: '2026-09-15' }), '2026-09-15')
    expect(screen.queryByTestId('gantt-bar-overdue-outline')).toBeNull()
  })
})

describe('GanttChart legend', () => {
  it('explains the overdue outline in the legend', () => {
    render(<GanttChart tasks={[]} milestones={[]} />)
    expect(screen.getByText('期限切れ')).toBeInTheDocument()
  })
})
