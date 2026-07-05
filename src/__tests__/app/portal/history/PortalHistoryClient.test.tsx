import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PortalHistoryClient } from '@/app/portal/history/PortalHistoryClient'

// PortalShell pulls in PortalLeftNav (notifications hook, routing, etc.) which
// is unrelated to the history error-state behavior under test here.
vi.mock('@/components/portal', () => ({
  PortalShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const project = { id: 'space-1', name: 'テストプロジェクト', orgId: 'org-1' }

describe('PortalHistoryClient — action history error state (C-3)', () => {
  it('shows an error message instead of the empty state when historyError is true', () => {
    render(
      <PortalHistoryClient
        currentProject={project}
        projects={[project]}
        history={[]}
        historyError
        completedTasks={[]}
      />
    )

    expect(screen.getByText('履歴の読み込みに失敗しました')).toBeInTheDocument()
    expect(screen.queryByText('アクション履歴はまだありません')).not.toBeInTheDocument()
  })

  it('shows the normal empty state when there is no error and no history', () => {
    render(
      <PortalHistoryClient
        currentProject={project}
        projects={[project]}
        history={[]}
        historyError={false}
        completedTasks={[]}
      />
    )

    expect(screen.getByText('アクション履歴はまだありません')).toBeInTheDocument()
    expect(screen.queryByText('履歴の読み込みに失敗しました')).not.toBeInTheDocument()
  })

  it('renders history items when the fetch succeeded', () => {
    render(
      <PortalHistoryClient
        currentProject={project}
        projects={[project]}
        history={[
          {
            id: 'log-1',
            taskId: 'task-1',
            taskTitle: 'ロゴ制作',
            taskType: 'task',
            action: 'task_approved',
            comment: 'looks good',
            timestamp: '2026-07-01T10:00:00+09:00',
          },
        ]}
        historyError={false}
        completedTasks={[]}
      />
    )

    expect(screen.getByText('ロゴ制作')).toBeInTheDocument()
    expect(screen.getByText('承認済み')).toBeInTheDocument()
  })

  it('does not show the error state on the completed-tasks tab', () => {
    render(
      <PortalHistoryClient
        currentProject={project}
        projects={[project]}
        history={[]}
        historyError
        completedTasks={[]}
      />
    )

    fireEvent.click(screen.getByText('完了タスク'))

    expect(screen.queryByText('履歴の読み込みに失敗しました')).not.toBeInTheDocument()
    expect(screen.getByText('完了したタスクはまだありません')).toBeInTheDocument()
  })
})
