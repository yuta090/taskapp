import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PortalDashboardClient } from '@/app/portal/PortalDashboardClient'

const toastSuccess = vi.fn()
const toastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}))

/**
 * previewMode (#99 ストリームC「クライアント表示プレビュー」):
 * `/portal/preview/[spaceId]` reuses the real dashboard component so the
 * preview never drifts from what the client actually sees — the only
 * difference is previewMode disabling every write action and showing the
 * amber preview banner.
 */

const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/portal',
}))

// PortalLeftNav (rendered by PortalShell) calls useCurrentUser() unconditionally.
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null, loading: false, error: null }),
}))

const project = { id: 'space-1', name: 'テストプロジェクト', orgId: 'org-1' }

const dashboardData = {
  health: { status: 'on_track' as const, reason: '順調です' },
  alert: { overdueCount: 0, nextDueDate: null },
  actionTasks: [
    {
      id: 'task-1',
      title: 'ロゴのご確認',
      description: '',
      dueDate: null,
      isOverdue: false,
      type: 'task' as const,
      status: 'considering',
      createdAt: '2026-06-20T00:00:00+09:00',
      estimatedCost: null,
      estimateStatus: 'none' as const,
    },
  ],
  totalActionCount: 1,
  waitingMessage: undefined,
  progress: { completedCount: 2, totalCount: 5, deadline: null },
  milestones: [],
  ballOwnership: { clientCount: 1, teamCount: 1 },
  currentPhaseProgress: { completedCount: 0, totalCount: 0, phaseName: '' },
  activities: [],
  approvals: [],
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('PortalDashboardClient previewMode', () => {
  it('shows the amber preview banner with a link back to the project when previewMode is set', () => {
    renderWithProviders(
      <PortalDashboardClient
        currentProject={project}
        projects={[project]}
        dashboardData={dashboardData}
        previewMode
      />
    )

    expect(
      screen.getByText('クライアント表示プレビュー — クライアントにはこのように表示されます')
    ).toBeInTheDocument()
    const backLink = screen.getByRole('link', { name: 'プロジェクトに戻る' })
    expect(backLink).toHaveAttribute('href', '/org-1/project/space-1')
  })

  it('disables the "リクエストを送る" button when previewMode is set', () => {
    renderWithProviders(
      <PortalDashboardClient
        currentProject={project}
        projects={[project]}
        dashboardData={dashboardData}
        previewMode
      />
    )

    expect(screen.getByTestId('portal-dashboard-request-button')).toBeDisabled()
  })

  it('hides the 承認/修正依頼 actions on task cards when previewMode is set', () => {
    renderWithProviders(
      <PortalDashboardClient
        currentProject={project}
        projects={[project]}
        dashboardData={dashboardData}
        previewMode
      />
    )

    expect(screen.queryByRole('button', { name: '承認' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '修正依頼' })).not.toBeInTheDocument()
  })

  it('shows no banner and a working request button by default (previewMode off)', () => {
    renderWithProviders(
      <PortalDashboardClient
        currentProject={project}
        projects={[project]}
        dashboardData={dashboardData}
      />
    )

    expect(
      screen.queryByText('クライアント表示プレビュー — クライアントにはこのように表示されます')
    ).not.toBeInTheDocument()
    expect(screen.getByTestId('portal-dashboard-request-button')).not.toBeDisabled()
    expect(screen.getByRole('button', { name: '承認' })).toBeInTheDocument()
  })
})

/**
 * B2: when there are zero action-required tasks, the "件" badge was
 * skipped entirely, leaving the heading read as "確認待ちのタスク / 全50件"
 * with no numerator — looking broken/cut off.
 */
describe('PortalDashboardClient — action count heading (B2)', () => {
  it('shows "0件" instead of omitting the numerator when there are no action tasks', () => {
    renderWithProviders(
      <PortalDashboardClient
        currentProject={project}
        projects={[project]}
        dashboardData={{ ...dashboardData, actionTasks: [], totalActionCount: 0 }}
      />
    )

    expect(screen.getByText('0件')).toBeInTheDocument()
  })
})

/**
 * B3: handleApprove silently removed the card with no confirmation that
 * the approval went through, unlike the equivalent email-approval flow.
 */
describe('PortalDashboardClient — approval success feedback (B3)', () => {
  it('shows a success toast after approving a task successfully', async () => {
    ;(global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })

    renderWithProviders(
      <PortalDashboardClient
        currentProject={project}
        projects={[project]}
        dashboardData={dashboardData}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '承認' }))

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith('承認しました。チームに通知されます。')
    )
  })
})
