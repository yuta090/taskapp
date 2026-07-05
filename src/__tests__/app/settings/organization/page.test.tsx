import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import OrganizationSettingsPage from '@/app/settings/organization/page'

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

const mockUseCurrentOrg = vi.fn()
vi.mock('@/lib/hooks/useCurrentOrg', () => ({
  useCurrentOrg: () => mockUseCurrentOrg(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  }),
}))

describe('OrganizationSettingsPage management links', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockUseCurrentOrg.mockReturnValue({
      orgId: 'org-123',
      orgName: 'Test Org',
      role: 'owner',
      loading: false,
      error: null,
    })
  })

  it('shows a management section with links to members, org integrations, and billing', () => {
    render(<OrganizationSettingsPage />)

    expect(screen.getByText('組織の管理')).toBeInTheDocument()

    const membersLink = screen.getByRole('link', { name: /メンバー管理/ })
    expect(membersLink).toHaveAttribute('href', '/settings/members')

    const integrationsLink = screen.getByRole('link', { name: /組織の外部連携/ })
    expect(integrationsLink).toHaveAttribute('href', '/settings/org-integrations')

    const billingLink = screen.getByRole('link', { name: /プランと請求/ })
    expect(billingLink).toHaveAttribute('href', '/settings/billing')
  })
})
