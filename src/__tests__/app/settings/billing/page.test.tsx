import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BillingSettingsPage from '@/app/settings/billing/page'

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}))

// Mock billing components
vi.mock('@/components/billing', () => ({
  BillingUsageCard: ({ orgId }: { orgId?: string }) => (
    <div data-testid="billing-usage-card">BillingUsageCard orgId={orgId}</div>
  ),
  InvoiceHistory: ({ orgId }: { orgId?: string }) => (
    <div data-testid="invoice-history">InvoiceHistory orgId={orgId}</div>
  ),
}))

// Mock useStripeStatus
const mockUseStripeStatus = vi.fn()
vi.mock('@/lib/hooks/useStripeStatus', () => ({
  useStripeStatus: () => mockUseStripeStatus(),
}))

// Mock useCurrentOrg
const mockUseCurrentOrg = vi.fn()
vi.mock('@/lib/hooks/useCurrentOrg', () => ({
  useCurrentOrg: () => mockUseCurrentOrg(),
}))

// Mock useBillingLimits
const mockUseBillingLimits = vi.fn()
vi.mock('@/lib/hooks/useBillingLimits', () => ({
  useBillingLimits: () => mockUseBillingLimits(),
}))

describe('BillingSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()

    // Default mock values
    mockUseCurrentOrg.mockReturnValue({
      orgId: 'org-123',
      orgName: 'Test Org',
      role: 'owner',
      loading: false,
      error: null,
    })

    mockUseBillingLimits.mockReturnValue({
      limits: { plan_name: 'Free' },
      loading: false,
      error: null,
    })
  })

  it('should show loading state', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: null,
      loading: true,
      error: null,
      clientConfigured: true,
    })

    mockUseCurrentOrg.mockReturnValue({
      orgId: null,
      orgName: null,
      role: null,
      loading: true,
      error: null,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByText('プランと請求')).toBeInTheDocument()
  })

  it('should show setup guide when Stripe is not configured', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: false,
      loading: false,
      error: null,
      clientConfigured: false,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByText('Stripe決済の設定が必要です')).toBeInTheDocument()
    expect(screen.getByText('設定手順')).toBeInTheDocument()
    expect(screen.getByText('Stripeアカウントを作成')).toBeInTheDocument()
  })

  it('should not show setup guide when Stripe is configured', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: true,
      loading: false,
      error: null,
      clientConfigured: true,
    })

    render(<BillingSettingsPage />)

    expect(screen.queryByText('Stripe決済の設定が必要です')).not.toBeInTheDocument()
  })

  it('should disable upgrade buttons when Stripe is not configured', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: false,
      loading: false,
      error: null,
      clientConfigured: false,
    })

    render(<BillingSettingsPage />)

    const proButton = screen.getByRole('button', { name: 'Proにアップグレード' })
    const enterpriseButton = screen.getByRole('button', { name: 'Enterprise' })

    expect(proButton).toBeDisabled()
    expect(enterpriseButton).toBeDisabled()
  })

  it('should enable upgrade buttons when Stripe is configured and org is loaded', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: true,
      loading: false,
      error: null,
      clientConfigured: true,
    })

    render(<BillingSettingsPage />)

    const proButton = screen.getByRole('button', { name: 'Proにアップグレード' })
    const enterpriseButton = screen.getByRole('button', { name: 'Enterprise' })

    expect(proButton).not.toBeDisabled()
    expect(enterpriseButton).not.toBeDisabled()
  })

  it('should show warning message when Stripe is not configured', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: false,
      loading: false,
      error: null,
      clientConfigured: false,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByText('決済機能を利用するにはStripeの設定が必要です')).toBeInTheDocument()
  })

  it('should call checkout API when upgrade button is clicked', async () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: true,
      loading: false,
      error: null,
      clientConfigured: true,
    })

    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ url: 'https://checkout.stripe.com/xxx' }),
    })

    // Mock window.location
    const originalLocation = window.location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { href: '' },
    })

    render(<BillingSettingsPage />)

    const proButton = screen.getByRole('button', { name: 'Proにアップグレード' })
    fireEvent.click(proButton)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: 'org-123',
          plan_id: 'pro',
        }),
      })
    })

    // Restore window.location
    window.location = originalLocation
  })

  it('should show payment method section', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: true,
      loading: false,
      error: null,
      clientConfigured: true,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByText('お支払い方法')).toBeInTheDocument()
  })

  it('should show invoice history component', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: true,
      loading: false,
      error: null,
      clientConfigured: true,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByTestId('invoice-history')).toBeInTheDocument()
  })

  it('should have back link to inbox', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: true,
      loading: false,
      error: null,
      clientConfigured: true,
    })

    render(<BillingSettingsPage />)

    const backLink = screen.getByRole('link')
    expect(backLink).toHaveAttribute('href', '/inbox')
  })

  it('should show org name when loaded', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: true,
      loading: false,
      error: null,
      clientConfigured: true,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByText('Test Org')).toBeInTheDocument()
  })

  it('should show error when org loading fails', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: true,
      loading: false,
      error: null,
      clientConfigured: true,
    })

    mockUseCurrentOrg.mockReturnValue({
      orgId: null,
      orgName: null,
      role: null,
      loading: false,
      error: 'ログインが必要です',
    })

    render(<BillingSettingsPage />)

    expect(screen.getByText('ログインが必要です')).toBeInTheDocument()
  })
})
