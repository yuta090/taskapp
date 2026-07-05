import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import UserIntegrationsPage from '@/app/settings/integrations/page'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

const mockUseCurrentOrg = vi.fn()
vi.mock('@/lib/hooks/useCurrentOrg', () => ({
  useCurrentOrg: () => mockUseCurrentOrg(),
}))

const mockUseIntegrations = vi.fn()
vi.mock('@/lib/hooks/useIntegrations', () => ({
  useIntegrations: (...args: unknown[]) => mockUseIntegrations(...args),
}))

vi.mock('@/lib/google-calendar/config', () => ({
  isGoogleCalendarConfigured: () => false,
}))

vi.mock('@/components/integrations', () => ({
  IntegrationStatusBadge: () => <span />,
  SetupGuide: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

describe('UserIntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUseCurrentOrg.mockReturnValue({
      orgId: 'org-123',
      orgName: 'Test Org',
      role: 'member',
      loading: false,
      error: null,
    })

    mockUseIntegrations.mockReturnValue({
      loading: false,
      error: null,
      connectGoogle: vi.fn(),
      disconnect: vi.fn(),
      getConnection: () => null,
      isConnected: () => false,
    })
  })

  it('labels the page as the personal integrations page', () => {
    render(<UserIntegrationsPage />)

    expect(screen.getByText('個人の外部連携')).toBeInTheDocument()
    expect(screen.getByText('あなた個人のアカウント接続（Google カレンダー・ビデオ会議）')).toBeInTheDocument()
  })

  it('shows a banner guiding users to the org integrations page for Slack/GitHub/AI', () => {
    render(<UserIntegrationsPage />)

    expect(screen.getByText(/Slack・GitHub・AI 連携をお探しですか？/)).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /組織の外部連携を開く/ })
    expect(link).toHaveAttribute('href', '/settings/org-integrations')
  })
})
