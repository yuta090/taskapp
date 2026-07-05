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

vi.mock('next/navigation', () => ({
  usePathname: () => '/portal',
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

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signOut: vi.fn(() => Promise.resolve()) },
  }),
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

describe('PortalLeftNav — 使い方リンク (初回UX改善 D)', () => {
  it('ユーザーメニューに /help/client への「使い方」リンクがある', () => {
    mockUser = { user_metadata: { name: '鈴木 一郎' }, email: 'client1@example.com' }

    render(<PortalLeftNav currentProject={{ id: 'space-1', name: 'テストプロジェクト', orgId: 'org-1' }} />)
    fireEvent.click(screen.getByRole('button', { name: /鈴木 一郎/ }))

    expect(screen.getByRole('link', { name: '使い方' })).toHaveAttribute('href', '/help/client')
  })
})
