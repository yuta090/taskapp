import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import BillingSettingsPage from '@/app/settings/billing/page'

const mockPush = vi.fn()
const mockBack = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}))

// Mock billing components
vi.mock('@/components/billing', () => ({
  BillingUsageCard: ({ orgId }: { orgId?: string }) => (
    <div data-testid="billing-usage-card">BillingUsageCard orgId={orgId}</div>
  ),
  InvoiceHistory: ({ orgId }: { orgId?: string }) => (
    <div data-testid="invoice-history">InvoiceHistory orgId={orgId}</div>
  ),
  QuoteCard: ({ orgId, isOwner }: { orgId?: string; isOwner?: boolean }) =>
    isOwner ? <div data-testid="quote-card">QuoteCard orgId={orgId}</div> : null,
  PlanFeatureTable: ({ orgId }: { orgId?: string }) => (
    <div data-testid="plan-feature-table">PlanFeatureTable orgId={orgId}</div>
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

  /**
   * 未設定のときに出していたのは「Stripeアカウントを作成 → APIキーを取得 → .env.local に
   * 環境変数を追加」という**開発者向けの手順**で、環境変数の見本まで本番のお客様の画面に
   * 出ていた。お客様に見せるのは「いまオンラインで申し込めないこと」と問い合わせ先だけにする。
   */
  it('未設定でも、開発者向けの設定手順や環境変数名をお客様に見せない', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: false,
      loading: false,
      error: null,
    })

    render(<BillingSettingsPage />)

    expect(screen.queryByText('設定手順')).not.toBeInTheDocument()
    expect(screen.queryByText('Stripeアカウントを作成')).not.toBeInTheDocument()
    expect(screen.queryByText(/STRIPE_SECRET_KEY/)).not.toBeInTheDocument()
    expect(screen.queryByText(/env\.local/)).not.toBeInTheDocument()
  })

  it('未設定のときは、お客様向けの案内と問い合わせ先を出す', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: false,
      loading: false,
      error: null,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByTestId('billing-unavailable-notice')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /お問い合わせ/ })).toHaveAttribute('href', '/contact')
  })

  it('設定済みなら案内を出さない', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: true,
      loading: false,
      error: null,
    })

    render(<BillingSettingsPage />)

    expect(screen.queryByTestId('billing-unavailable-notice')).not.toBeInTheDocument()
  })

  it('確認中は案内を出さない（ちらつき防止）', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: false,
      loading: true,
      error: null,
    })

    render(<BillingSettingsPage />)

    expect(screen.queryByTestId('billing-unavailable-notice')).not.toBeInTheDocument()
  })

  // Enterprise は Stripe 決済ではなく営業窓口での個別契約（/contact?plan=enterprise へ誘導）。
  // よって Stripe 未設定でも押せる必要がある。Stripe 設定に連動するのは Pro だけ。
  it('should disable only the Pro button when Stripe is not configured', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: false,
      loading: false,
      error: null,
      clientConfigured: false,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByRole('button', { name: 'Proにアップグレード' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Enterpriseを相談する' })).not.toBeDisabled()
  })

  it('should enable upgrade buttons when Stripe is configured and org is loaded', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: true,
      loading: false,
      error: null,
      clientConfigured: true,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByRole('button', { name: 'Proにアップグレード' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Enterpriseを相談する' })).not.toBeDisabled()
  })

  it('should show warning message when Stripe is not configured', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: false,
      loading: false,
      error: null,
      clientConfigured: false,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByText('いまオンラインでのお申し込みはご利用いただけません')).toBeInTheDocument()
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
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    })
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

  it('should show a back button that falls back to /inbox when there is no history', () => {
    mockUseStripeStatus.mockReturnValue({
      serverConfigured: true,
      loading: false,
      error: null,
      clientConfigured: true,
    })
    Object.defineProperty(window.history, 'length', { value: 1, configurable: true })

    render(<BillingSettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))
    expect(mockPush).toHaveBeenCalledWith('/inbox')
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
