import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskRow } from './TaskRow'
import type { Task } from '@/types/database'

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    space_id: 'space-1',
    title: 'テストタスク',
    status: 'in_progress',
    ball: 'internal',
    origin: 'internal',
    type: 'task',
    due_date: null,
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...overrides,
  } as Task
}

const openMenu = () => {
  fireEvent.click(screen.getByRole('button', { name: /ステータスを変更/ }))
  return screen.getByRole('menu', { name: 'ステータスを選択' })
}

describe('TaskRow status icon', () => {
  it.each([
    ['in_progress', 'text-blue-300'],
    ['in_review', 'text-amber-300'],
    ['done', 'text-green-400'],
    ['todo', 'text-gray-300'],
    ['backlog', 'text-gray-300'],
  ] as const)('uses a lighter tint for %s', (status, cls) => {
    render(<TaskRow task={makeTask({ status })} />)
    const svg = screen.getByRole('button', { name: /ステータスを変更/ }).querySelector('svg')
    expect(svg).toHaveClass(cls)
  })
})

describe('TaskRow status dropdown', () => {
  it('renders the menu outside the row (portal) so virtualized rows cannot paint over it', () => {
    const { container } = render(<TaskRow task={makeTask()} onStatusChange={vi.fn()} />)
    const menu = openMenu()
    expect(container.contains(menu)).toBe(false)
    expect(document.body.contains(menu)).toBe(true)
  })

  it('has an opaque surface, popover shadow and fixed positioning', () => {
    render(<TaskRow task={makeTask()} onStatusChange={vi.fn()} />)
    const menu = openMenu()
    expect(menu).toHaveClass('bg-surface')
    expect(menu).toHaveClass('shadow-popover')
    expect(menu.style.position).toBe('fixed')
  })

  it('selecting an option reports the new status and closes the menu', () => {
    const onStatusChange = vi.fn()
    render(<TaskRow task={makeTask()} onStatusChange={onStatusChange} />)
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: '社内承認中' }))
    expect(onStatusChange).toHaveBeenCalledWith('task-1', 'in_review')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('closes on Escape and on outside click', () => {
    render(<TaskRow task={makeTask()} onStatusChange={vi.fn()} />)
    openMenu()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()

    openMenu()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not open when status changes are not allowed', () => {
    render(<TaskRow task={makeTask()} />)
    fireEvent.click(screen.getByRole('button', { name: /ステータスを変更/ }))
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('does not bubble the click to the row (row selection stays untouched)', () => {
    const onClick = vi.fn()
    render(<TaskRow task={makeTask()} onClick={onClick} onStatusChange={vi.fn()} />)
    openMenu()
    expect(onClick).not.toHaveBeenCalled()
  })
})
