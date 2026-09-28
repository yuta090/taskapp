import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { Task } from '@/types/database'

/**
 * タスク ID だけ渡せば、そのプロジェクトのタスク詳細を右パネルに出す部品。
 * 議事録画面から、画面を移らずにタスクを開くのに使う。
 */

const useTasksMock = vi.fn()
vi.mock('@/lib/hooks/useTasks', () => ({ useTasks: (...a: unknown[]) => useTasksMock(...a) }))
const canEditMock = vi.fn()
vi.mock('@/lib/hooks/useCanEditSpace', () => ({ useCanEditSpace: (...a: unknown[]) => canEditMock(...a) }))
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))
vi.mock('@/lib/hooks/useSpecDecisionEvents', () => ({ invalidateSpecDecisionEvents: vi.fn() }))
vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/rpc', () => ({ rpc: {} }))

const inspectorProps = vi.fn()
vi.mock('@/components/task/TaskInspector', () => ({
  TaskInspector: (props: { task: Task; onClose: () => void; onUpdate?: unknown }) => {
    inspectorProps(props)
    return (
      <div data-testid="task-inspector">
        {props.task.title}
        <button onClick={props.onClose}>閉じる</button>
      </div>
    )
  },
}))

import { ProjectTaskInspector } from '@/components/task/ProjectTaskInspector'

const task = (over: Partial<Task> = {}) =>
  ({ id: 't1', title: '見積書を送る', parent_task_id: null, ball: 'internal', type: 'task', ...over }) as Task

function tasksState(over: Record<string, unknown> = {}) {
  return {
    tasks: [task()],
    owners: {},
    loading: false,
    error: null,
    fetchTasks: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    passBall: vi.fn(),
    handleReviewChange: vi.fn(),
    ...over,
  }
}

beforeEach(() => {
  useTasksMock.mockReset()
  inspectorProps.mockReset()
  canEditMock.mockReturnValue({ canEdit: true, canEditMoney: false })
})

describe('ProjectTaskInspector', () => {
  it('プロジェクトのタスク一覧からそのタスクを探して詳細を出す', () => {
    useTasksMock.mockReturnValue(tasksState())
    render(<ProjectTaskInspector orgId="o" spaceId="s" taskId="t1" onClose={vi.fn()} onOpenTask={vi.fn()} />)
    expect(screen.getByTestId('task-inspector').textContent).toContain('見積書を送る')
    expect(useTasksMock).toHaveBeenCalledWith({ orgId: 'o', spaceId: 's' })
  })

  it('×で閉じると呼び出し側に知らせる', () => {
    useTasksMock.mockReturnValue(tasksState())
    const onClose = vi.fn()
    render(<ProjectTaskInspector orgId="o" spaceId="s" taskId="t1" onClose={onClose} onOpenTask={vi.fn()} />)
    fireEvent.click(screen.getByText('閉じる'))
    expect(onClose).toHaveBeenCalled()
  })

  it('読み込み中は読み込み中と出す', () => {
    useTasksMock.mockReturnValue(tasksState({ tasks: [], loading: true }))
    render(<ProjectTaskInspector orgId="o" spaceId="s" taskId="t1" onClose={vi.fn()} onOpenTask={vi.fn()} />)
    expect(screen.getByText('読み込み中…')).toBeTruthy()
  })

  it('見つからないタスクは、そう伝えて閉じられるようにする', () => {
    useTasksMock.mockReturnValue(tasksState({ tasks: [] }))
    const onClose = vi.fn()
    render(<ProjectTaskInspector orgId="o" spaceId="s" taskId="t9" onClose={onClose} onOpenTask={vi.fn()} />)
    expect(screen.getByText(/見つかりませんでした/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('書けない人には編集操作を渡さない', () => {
    canEditMock.mockReturnValue({ canEdit: false, canEditMoney: false })
    useTasksMock.mockReturnValue(tasksState())
    render(<ProjectTaskInspector orgId="o" spaceId="s" taskId="t1" onClose={vi.fn()} onOpenTask={vi.fn()} />)
    expect(inspectorProps.mock.calls.at(-1)![0].onUpdate).toBeUndefined()
  })
})
