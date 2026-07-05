import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TaskRow } from '@/components/task/TaskRow'
import type { Task } from '@/types/database'

const baseTask: Task = {
  id: 't1',
  org_id: 'o1',
  space_id: 's1',
  milestone_id: null,
  parent_task_id: null,
  title: 'ナビゲーション構造の仕様決定',
  description: null,
  status: 'in_progress',
  priority: null,
  assignee_id: null,
  start_date: null,
  due_date: '2026-02-16',
  ball: 'client',
  origin: 'internal',
  type: 'task',
  spec_path: null,
  decision_state: null,
  wiki_page_id: null,
  client_scope: 'internal',
  is_sample: false,
  estimated_cost: null,
  estimate_status: null,
  created_at: '2026-02-01T00:00:00Z',
  updated_at: '2026-02-01T00:00:00Z',
} as unknown as Task

describe('TaskRow — モバイル行 (PR3)', () => {
  it('タイトルを表示する（モバイル/デスクトップ共通）', () => {
    render(<TaskRow task={baseTask} isMobile />)
    expect(screen.getByText('ナビゲーション構造の仕様決定')).toBeInTheDocument()
  })

  it('モバイルでは常時表示のアクションボタン(ケバブ)があり、タップでonContextMenuを呼ぶ', () => {
    const onContextMenu = vi.fn()
    render(<TaskRow task={baseTask} isMobile onContextMenu={onContextMenu} />)

    const kebab = screen.getByTestId('task-row-mobile-actions')
    expect(kebab).toBeInTheDocument()

    fireEvent.click(kebab)
    expect(onContextMenu).toHaveBeenCalledTimes(1)
    expect(onContextMenu).toHaveBeenCalledWith('t1', expect.any(Number), expect.any(Number))
  })

  it('モバイル行はデスクトップの固定行高(row-h=40px)クラスを使わない（背高化のため）', () => {
    const { container } = render(<TaskRow task={baseTask} isMobile />)
    const row = container.querySelector('.task-row')!
    expect(row.classList.contains('row-h')).toBe(false)
  })

  it('デスクトップ(既定)ではモバイルアクションボタンを描画しない', () => {
    render(<TaskRow task={baseTask} />)
    expect(screen.queryByTestId('task-row-mobile-actions')).not.toBeInTheDocument()
  })

  it('モバイルでも行タップでonClickを呼ぶ', () => {
    const onClick = vi.fn()
    render(<TaskRow task={baseTask} isMobile onClick={onClick} />)
    fireEvent.click(screen.getByText('ナビゲーション構造の仕様決定'))
    expect(onClick).toHaveBeenCalledWith('t1')
  })
})
