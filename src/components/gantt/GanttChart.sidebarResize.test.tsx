import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { GanttChart } from './GanttChart'
import {
  GANTT_SIDEBAR_WIDTH_STORAGE_KEY,
  SIDEBAR_WIDTH_DEFAULT,
} from '@/lib/gantt/sidebarWidth'

describe('GanttChart sidebar resize', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('renders a vertical separator between the task-name column and the chart', () => {
    render(<GanttChart tasks={[]} milestones={[]} />)
    const handle = screen.getByRole('separator', { name: 'タスク名の列幅を調整' })
    expect(handle).toHaveAttribute('aria-orientation', 'vertical')
    expect(handle).toHaveAttribute('aria-valuenow', String(SIDEBAR_WIDTH_DEFAULT))
  })

  it('resizes both the header cell and the sidebar body when dragged', () => {
    render(<GanttChart tasks={[]} milestones={[]} />)
    const handle = screen.getByRole('separator', { name: 'タスク名の列幅を調整' })
    const sidebar = screen.getByTestId('gantt-sidebar')
    const headerCell = screen.getByTestId('gantt-sidebar-header')

    expect(sidebar.style.width).toBe(`${SIDEBAR_WIDTH_DEFAULT}px`)

    fireEvent.pointerDown(handle, { clientX: 240, button: 0, pointerId: 1 })
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 340 }))
    })
    expect(sidebar.style.width).toBe(`${SIDEBAR_WIDTH_DEFAULT + 100}px`)
    expect(headerCell.style.width).toBe(`${SIDEBAR_WIDTH_DEFAULT + 100}px`)

    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup'))
    })
    expect(localStorage.getItem(GANTT_SIDEBAR_WIDTH_STORAGE_KEY)).toBe(String(SIDEBAR_WIDTH_DEFAULT + 100))
  })

  it('supports arrow keys and double-click reset', () => {
    render(<GanttChart tasks={[]} milestones={[]} />)
    const handle = screen.getByRole('separator', { name: 'タスク名の列幅を調整' })
    const sidebar = screen.getByTestId('gantt-sidebar')

    fireEvent.keyDown(handle, { key: 'ArrowRight' })
    expect(sidebar.style.width).toBe(`${SIDEBAR_WIDTH_DEFAULT + 16}px`)

    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    fireEvent.keyDown(handle, { key: 'ArrowLeft' })
    expect(sidebar.style.width).toBe(`${SIDEBAR_WIDTH_DEFAULT - 16}px`)

    fireEvent.doubleClick(handle)
    expect(sidebar.style.width).toBe(`${SIDEBAR_WIDTH_DEFAULT}px`)
  })
})
