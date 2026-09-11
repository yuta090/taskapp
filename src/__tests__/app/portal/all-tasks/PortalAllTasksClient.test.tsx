import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PortalAllTasksClient } from '@/app/portal/all-tasks/PortalAllTasksClient'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/portal/all-tasks',
}))

/**
 * B1: getStatusInfo's local status map was missing 'backlog' and 'in_review',
 * so those tasks fell back to rendering the raw English status value
 * (observed in production as a bare "backlog" label).
 */

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null, loading: false, error: null }),
}))

const project = { id: 'space-1', name: 'テストプロジェクト', orgId: 'org-1' }

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('PortalAllTasksClient — status label completeness (B1)', () => {
  it('shows Japanese labels for backlog and in_review instead of the raw English status', () => {
    const tasks = [
      { id: 't1', title: 'バックログのタスク', status: 'backlog', ball: 'internal' },
      { id: 't2', title: '社内確認中のタスク', status: 'in_review', ball: 'internal' },
    ]

    renderWithProviders(
      <PortalAllTasksClient
        currentProject={project}
        projects={[project]}
        tasks={tasks}
        milestones={[]}
      />
    )

    expect(screen.getByText('バックログ')).toBeInTheDocument()
    expect(screen.getByText('社内確認中')).toBeInTheDocument()
    expect(screen.queryByText('backlog')).not.toBeInTheDocument()
    expect(screen.queryByText('in_review')).not.toBeInTheDocument()
  })
})

/**
 * 見積もり確認待ちのタスクに「承認」「修正依頼」を出すと、サーバーが409(見積もり
 * 確認が必要)で断って先に進めない。見積もり待ちのときは見積もりの承認・却下の
 * 導線に切り替える（要対応一覧と同じ挙動）。
 */
describe('PortalAllTasksClient — 見積もり確認待ちのタスク', () => {
  const pendingTask = {
    id: 't-estimate',
    title: '見積もり確認中のタスク',
    status: 'considering',
    ball: 'client',
    estimatedCost: 50000,
    estimateStatus: 'pending' as const,
  }

  it('見積もり待ちでは承認・修正依頼ではなく見積もりの承認・却下を出す', () => {
    renderWithProviders(
      <PortalAllTasksClient
        currentProject={project}
        projects={[project]}
        tasks={[pendingTask]}
        milestones={[]}
      />
    )

    fireEvent.click(screen.getByText('見積もり確認中のタスク'))

    expect(screen.getByRole('button', { name: '見積もり承認' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再見積もり依頼' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '承認' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '修正依頼' })).not.toBeInTheDocument()
  })

  it('見積もりなし・承認済みのタスクは今までどおり承認・修正依頼を出す', () => {
    const normalTask = {
      id: 't-normal',
      title: '通常のタスク',
      status: 'considering',
      ball: 'client',
      estimateStatus: 'none' as const,
    }

    renderWithProviders(
      <PortalAllTasksClient
        currentProject={project}
        projects={[project]}
        tasks={[normalTask]}
        milestones={[]}
      />
    )

    fireEvent.click(screen.getByText('通常のタスク'))

    expect(screen.getByRole('button', { name: '承認' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '見積もり承認' })).not.toBeInTheDocument()
  })

  it('見積もり承認のあと相手先の番に戻ったタスク（estimateStatus: approved）は、ふつうの承認・修正依頼を出す', () => {
    const approvedTask = {
      id: 't-approved',
      title: '見積もり承認済みで差し戻されたタスク',
      status: 'considering',
      ball: 'client',
      estimateStatus: 'approved' as const,
      estimatedCost: 50000,
    }

    renderWithProviders(
      <PortalAllTasksClient
        currentProject={project}
        projects={[project]}
        tasks={[approvedTask]}
        milestones={[]}
      />
    )

    fireEvent.click(screen.getByText('見積もり承認済みで差し戻されたタスク'))

    expect(screen.getByRole('button', { name: '承認' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '見積もり承認' })).not.toBeInTheDocument()
  })

  it('再見積もり依頼のあと相手先の番に戻ったタスク（estimateStatus: rejected）は、ふつうの承認・修正依頼を出す', () => {
    const rejectedTask = {
      id: 't-rejected',
      title: '再見積もり依頼済みで差し戻されたタスク',
      status: 'considering',
      ball: 'client',
      estimateStatus: 'rejected' as const,
      estimatedCost: 50000,
    }

    renderWithProviders(
      <PortalAllTasksClient
        currentProject={project}
        projects={[project]}
        tasks={[rejectedTask]}
        milestones={[]}
      />
    )

    fireEvent.click(screen.getByText('再見積もり依頼済みで差し戻されたタスク'))

    expect(screen.getByRole('button', { name: '承認' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '見積もり承認' })).not.toBeInTheDocument()
  })

  it('見積もり待ちでも、社内の番のタスクにはボタンを出さない', () => {
    const internalPendingTask = {
      id: 't-internal-pending',
      title: '社内対応中の見積もり待ちタスク',
      status: 'considering',
      ball: 'internal',
      estimateStatus: 'pending' as const,
      estimatedCost: 50000,
    }

    renderWithProviders(
      <PortalAllTasksClient
        currentProject={project}
        projects={[project]}
        tasks={[internalPendingTask]}
        milestones={[]}
      />
    )

    fireEvent.click(screen.getByText('社内対応中の見積もり待ちタスク'))

    expect(screen.queryByRole('button', { name: '見積もり承認' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '承認' })).not.toBeInTheDocument()
  })

  it('見積もり待ちでも、完了したタスクにはボタンを出さない', () => {
    const donePendingTask = {
      id: 't-done-pending',
      title: '完了済みの見積もり待ちタスク',
      status: 'done',
      ball: 'client',
      estimateStatus: 'pending' as const,
      estimatedCost: 50000,
    }

    renderWithProviders(
      <PortalAllTasksClient
        currentProject={project}
        projects={[project]}
        tasks={[donePendingTask]}
        milestones={[]}
      />
    )

    fireEvent.click(screen.getByText('完了済みの見積もり待ちタスク'))

    expect(screen.queryByRole('button', { name: '見積もり承認' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '承認' })).not.toBeInTheDocument()
  })
})
