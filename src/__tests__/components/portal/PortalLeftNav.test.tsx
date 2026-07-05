import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PortalLeftNav } from '@/components/portal/PortalLeftNav'

/**
 * Regression test for H-3: the portal sidebar showed "ゲ ゲスト" (garbled
 * "ゲスト" fallback) even when logged in as a named client (e.g. 鈴木一郎),
 * because PortalLeftNav never read the current user at all — UserMenu's
 * userName/userEmail props were simply never passed in.
 *
 * Fix: PortalLeftNav (a client component) reads the session directly via
 * useCurrentUser, mirroring the internal app's LeftNav.tsx.
 */

let mockUser: { user_metadata?: { name?: string }; email?: string } | null = null
let mockPathname = '/portal'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ user: mockUser, loading: false, error: null }),
}))

vi.mock('@/lib/hooks/usePortalVisibility', () => ({
  usePortalVisibilityForPortal: () => ({
    sections: {
      tasks: true,
      requests: true,
      all_tasks: true,
      files: true,
      meetings: true,
      wiki: true,
      history: true,
    },
    loading: false,
  }),
}))

const { mockSignOut, mockCleanupPushOnLogout } = vi.hoisted(() => ({
  mockSignOut: vi.fn(() => Promise.resolve()),
  mockCleanupPushOnLogout: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signOut: mockSignOut },
  }),
}))
vi.mock('@/lib/push/cleanupPushOnLogout', () => ({
  cleanupPushOnLogout: mockCleanupPushOnLogout,
}))

vi.mock('@/components/portal/PortalOnboardingWalkthrough', () => ({
  resetPortalOnboarding: vi.fn(),
}))

vi.mock('@/components/portal/PortalRequestSheet', () => ({
  PortalRequestSheet: () => null,
}))

describe('PortalLeftNav — user menu identity (H-3)', () => {
  beforeEach(() => {
    mockUser = null
    mockPathname = '/portal'
  })

  it('shows the real display name from user_metadata.name instead of "ゲスト"', () => {
    mockUser = { user_metadata: { name: '鈴木 一郎' }, email: 'client1@example.com' }

    render(<PortalLeftNav currentProject={{ id: 'space-1', name: 'テストプロジェクト', orgId: 'org-1' }} />)

    fireEvent.click(screen.getByRole('button', { name: /鈴木 一郎/ }))

    expect(screen.getByText('鈴木 一郎')).toBeInTheDocument()
    expect(screen.queryByText('ゲスト')).not.toBeInTheDocument()
  })

  it('falls back to the email local-part when there is no name in user_metadata', () => {
    mockUser = { email: 'client1@example.com' }

    render(<PortalLeftNav currentProject={{ id: 'space-1', name: 'テストプロジェクト', orgId: 'org-1' }} />)

    expect(screen.getByText('client1')).toBeInTheDocument()
    expect(screen.queryByText('ゲスト')).not.toBeInTheDocument()
  })

  it('falls back to "ゲスト" only when there is truly no session', () => {
    mockUser = null

    render(<PortalLeftNav currentProject={{ id: 'space-1', name: 'テストプロジェクト', orgId: 'org-1' }} />)

    expect(screen.getByText('ゲスト')).toBeInTheDocument()
  })
})

/**
 * Regression tests for S6: a client invited to multiple projects/orgs needs a
 * way to switch between them, and the switch must persist across in-portal
 * navigation (nav links carry ?space=) instead of always landing back on the
 * first project.
 */
describe('PortalLeftNav — project switcher (S6)', () => {
  const projectA = { id: 'space-1', name: 'プロジェクトA', orgId: 'org-1' }
  const projectB = { id: 'space-2', name: 'プロジェクトB', orgId: 'org-2' }

  beforeEach(() => {
    mockUser = { email: 'client1@example.com' }
    mockPathname = '/portal'
  })

  it('does not render a project dropdown when the client belongs to only one project', () => {
    render(<PortalLeftNav currentProject={projectA} projects={[projectA]} />)

    // The project name is shown, but clicking it opens no dropdown (no link rendered for it).
    expect(screen.getByText('プロジェクトA')).toBeInTheDocument()
    fireEvent.click(screen.getByText('プロジェクトA'))
    expect(screen.queryByRole('link', { name: /プロジェクトA/ })).not.toBeInTheDocument()
  })

  it('lists every project in the dropdown when the client belongs to more than one', () => {
    render(<PortalLeftNav currentProject={projectA} projects={[projectA, projectB]} />)

    fireEvent.click(screen.getByText('プロジェクトA'))

    expect(screen.getByRole('link', { name: /プロジェクトB/ })).toBeInTheDocument()
  })

  it('switching projects links to the current page with ?space=<newId>, not always /portal', () => {
    mockPathname = '/portal/all-tasks'
    render(<PortalLeftNav currentProject={projectA} projects={[projectA, projectB]} />)

    fireEvent.click(screen.getByText('プロジェクトA'))

    const switchLink = screen.getByRole('link', { name: /プロジェクトB/ })
    expect(switchLink).toHaveAttribute('href', '/portal/all-tasks?space=space-2')
  })

  it('appends ?space=<currentProject.id> to in-portal nav links when there are multiple projects', () => {
    render(<PortalLeftNav currentProject={projectA} projects={[projectA, projectB]} />)

    expect(screen.getByRole('link', { name: /ダッシュボード/ })).toHaveAttribute('href', '/portal?space=space-1')
    expect(screen.getByRole('link', { name: /タスク一覧/ })).toHaveAttribute('href', '/portal/all-tasks?space=space-1')
  })

  it('leaves nav links unchanged (no ?space=) when there is only one project', () => {
    render(<PortalLeftNav currentProject={projectA} projects={[projectA]} />)

    expect(screen.getByRole('link', { name: /ダッシュボード/ })).toHaveAttribute('href', '/portal')
    expect(screen.getByRole('link', { name: /タスク一覧/ })).toHaveAttribute('href', '/portal/all-tasks')
  })
})

/**
 * Regression test (S7): logging out of the portal left a stale
 * push_subscriptions row behind because PortalLeftNav's UserMenu called
 * supabase.auth.signOut() directly without releasing the Web Push
 * subscription first — mirroring the fix already applied to the internal
 * app's LeftNav.tsx / OrgMenu.tsx (see src/lib/push/cleanupPushOnLogout.ts).
 */
describe('PortalLeftNav — logout push cleanup (S7)', () => {
  beforeEach(() => {
    mockUser = { email: 'client1@example.com' }
    mockPathname = '/portal'
    mockCleanupPushOnLogout.mockClear()
    mockSignOut.mockClear()
  })

  it('releases the push subscription before signing out', async () => {
    render(<PortalLeftNav currentProject={{ id: 'space-1', name: 'テストプロジェクト', orgId: 'org-1' }} />)

    fireEvent.click(screen.getByRole('button', { name: /client1/ }))
    fireEvent.click(screen.getByRole('button', { name: /ログアウト/ }))

    await Promise.resolve()

    expect(mockCleanupPushOnLogout).toHaveBeenCalled()
    expect(mockSignOut).toHaveBeenCalled()
    expect(mockCleanupPushOnLogout.mock.invocationCallOrder[0]).toBeLessThan(
      mockSignOut.mock.invocationCallOrder[0]
    )
  })
})
