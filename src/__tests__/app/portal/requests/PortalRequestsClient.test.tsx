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

/**
 * 見積もり確認待ちのリクエストに「承認」「修正依頼」を出すと、サーバーが409
 * (見積もり確認が必要)で断って先に進めない。見積もり待ちのときは見積もりの
 * 承認・却下の導線に切り替える（要対応一覧と同じ挙動）。
 */
describe('PortalRequestsClient — 見積もり確認待ちのリクエスト', () => {
  it('見積もり待ちでは承認・修正依頼ではなく見積もりの承認・却下を出す', () => {
    renderWithProviders(
      <PortalRequestsClient
        currentProject={project}
        projects={[project]}
        requests={[
          {
            id: 'r-estimate',
            title: '[REQ] 見積もり確認中のリクエスト',
            status: 'considering',
            ball: 'client',
            dueDate: null,
            type: 'task',
            createdAt: '2026-07-01T00:00:00+09:00',
            description: null,
            estimatedCost: 30000,
            estimateStatus: 'pending',
          },
        ]}
      />
    )

    fireEvent.click(screen.getByText('見積もり確認中のリクエスト'))

    expect(screen.getByRole('button', { name: '見積もり承認' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再見積もり依頼' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '承認' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '修正依頼' })).not.toBeInTheDocument()
  })

  it('見積もりなしのリクエストは今までどおり承認・修正依頼を出す', () => {
    renderWithProviders(
      <PortalRequestsClient
        currentProject={project}
        projects={[project]}
        requests={[
          {
            id: 'r-normal',
            title: '[REQ] 通常のリクエスト',
            status: 'considering',
            ball: 'client',
            dueDate: null,
            type: 'task',
            createdAt: '2026-07-01T00:00:00+09:00',
            description: null,
          },
        ]}
      />
    )

    fireEvent.click(screen.getByText('通常のリクエスト'))

    expect(screen.getByRole('button', { name: '承認' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '見積もり承認' })).not.toBeInTheDocument()
  })
})
