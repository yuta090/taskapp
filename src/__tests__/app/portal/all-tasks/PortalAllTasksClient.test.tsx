import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PortalAllTasksClient } from '@/app/portal/all-tasks/PortalAllTasksClient'

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
