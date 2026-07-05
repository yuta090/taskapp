import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PortalRequestsClient } from '@/app/portal/requests/PortalRequestsClient'

const mockRefresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/portal/requests',
}))

// PortalLeftNav (rendered by PortalShell) calls useCurrentUser() unconditionally
// — mock it directly rather than reconstructing the full supabase auth chain.
vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: null, loading: false, error: null }),
}))

const project = { id: 'space-1', name: 'テストプロジェクト', orgId: 'org-1' }

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

/**
 * B-5: the "リクエストはまだありません" empty state only pointed users back to
 * the dashboard's "リクエストを送る" button instead of offering its own CTA.
 */
describe('PortalRequestsClient empty state', () => {
  it('shows a "依頼を作成" button when there are no requests', () => {
    renderWithProviders(
      <PortalRequestsClient currentProject={project} projects={[project]} requests={[]} />
    )

    expect(screen.getByText('リクエストはまだありません')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '依頼を作成' })).toBeInTheDocument()
  })

  it('opens the request creation sheet when the empty-state CTA is clicked', async () => {
    renderWithProviders(
      <PortalRequestsClient currentProject={project} projects={[project]} requests={[]} />
    )

    fireEvent.click(screen.getByRole('button', { name: '依頼を作成' }))

    await waitFor(() => {
      expect(screen.getByText('リクエストを送る')).toBeInTheDocument()
    })
  })

  it('does not show the CTA once there are requests to display', () => {
    renderWithProviders(
      <PortalRequestsClient
        currentProject={project}
        projects={[project]}
        requests={[
          {
            id: 'r1',
            title: '[REQ] 機能要望のサンプル',
            status: 'todo',
            ball: 'internal',
            dueDate: null,
            type: 'task',
            createdAt: '2026-07-01T00:00:00+09:00',
            description: null,
          },
        ]}
      />
    )

    expect(screen.queryByRole('button', { name: '依頼を作成' })).not.toBeInTheDocument()
  })
})
