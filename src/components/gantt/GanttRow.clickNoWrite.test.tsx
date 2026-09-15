import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { GanttRow } from './GanttRow'
import type { Task } from '@/types/database'

// 実際に起きたこと: 開始日が空のタスクは作成日から期限までのバーで描かれる。そのバーを
// 押して動かさずに離しただけで、見えていた作成日が開始日として保存され、並び順が変わって
// タスクが「消えた」ように見えた（2026-09-15・TP-571/573/578）
function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 'task-1',
    title: '数万円メニューM1〜M8のうち出せるものを確定する',
    status: 'considering',
    ball: 'client',
    start_date: null,
    due_date: '2026-09-18',
    created_at: '2026-09-15T03:00:00Z',
    due_authority_connection_id: null,
    ...overrides,
  } as Task
}

function renderRow(task: Task) {
  const onBarMove = vi.fn()
  const onDateChange = vi.fn()
  render(
    <svg>
      <GanttRow
        task={task}
        startDate={new Date(2026, 8, 8)}
        totalWidth={2000}
        dayWidth={40}
        rowIndex={0}
        onBarMove={onBarMove}
        onDateChange={onDateChange}
      />
    </svg>,
  )
  return { onBarMove, onDateChange }
}

describe('GanttRow click without dragging', () => {
  it('does not save dates when the bar is pressed and released without moving', () => {
    const { onBarMove } = renderRow(makeTask({}))
    fireEvent.mouseDown(screen.getByTestId('gantt-bar-move'), { clientX: 330 })
    fireEvent.mouseUp(document, { clientX: 330 })
    expect(onBarMove).not.toHaveBeenCalled()
  })

  it('does not save the start date when the left edge is pressed and released without moving', () => {
    const { onDateChange } = renderRow(makeTask({}))
    fireEvent.mouseDown(screen.getByTestId('gantt-bar-resize-start'), { clientX: 280 })
    fireEvent.mouseUp(document, { clientX: 280 })
    expect(onDateChange).not.toHaveBeenCalled()
  })

  it('does not save the due date when the right edge is pressed and released without moving', () => {
    const { onDateChange } = renderRow(makeTask({}))
    fireEvent.mouseDown(screen.getByTestId('gantt-bar-resize-end'), { clientX: 400 })
    fireEvent.mouseUp(document, { clientX: 400 })
    expect(onDateChange).not.toHaveBeenCalled()
  })

  it('does not save when the pointer wiggles but snaps back to the same day', () => {
    const { onBarMove } = renderRow(makeTask({}))
    fireEvent.mouseDown(screen.getByTestId('gantt-bar-move'), { clientX: 330 })
    fireEvent.mouseMove(document, { clientX: 345 })
    fireEvent.mouseUp(document, { clientX: 345 })
    expect(onBarMove).not.toHaveBeenCalled()
  })

  it('still saves both dates when the bar is actually dragged by one day', () => {
    const { onBarMove } = renderRow(makeTask({ start_date: '2026-09-15' }))
    fireEvent.mouseDown(screen.getByTestId('gantt-bar-move'), { clientX: 330 })
    fireEvent.mouseMove(document, { clientX: 370 })
    fireEvent.mouseUp(document, { clientX: 370 })
    expect(onBarMove).toHaveBeenCalledTimes(1)
    expect(onBarMove).toHaveBeenCalledWith('task-1', '2026-09-16', '2026-09-19')
  })

  it('still saves the due date when the right edge is actually dragged by one day', () => {
    const { onDateChange } = renderRow(makeTask({ start_date: '2026-09-15' }))
    fireEvent.mouseDown(screen.getByTestId('gantt-bar-resize-end'), { clientX: 400 })
    fireEvent.mouseMove(document, { clientX: 440 })
    fireEvent.mouseUp(document, { clientX: 440 })
    expect(onDateChange).toHaveBeenCalledWith('task-1', 'end', '2026-09-19')
  })
})
