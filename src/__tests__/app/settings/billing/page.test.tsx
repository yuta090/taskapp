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
      canCheckout: false,
      keysConfigured: false,
      selfServeEnabled: false,
      partial: false,
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
      canCheckout: false,
      keysConfigured: false,
      selfServeEnabled: false,
      partial: false,
      loading: false,
      error: null,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByTestId('billing-unavailable-notice')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /お問い合わせ/ })).toHaveAttribute('href', '/contact')
  })

  it('設定済みなら案内を出さない', () => {
    mockUseStripeStatus.mockReturnValue({
      canCheckout: true,
      keysConfigured: true,
      selfServeEnabled: true,
      partial: false,
      loading: false,
      error: null,
    })

    render(<BillingSettingsPage />)

    expect(screen.queryByTestId('billing-unavailable-notice')).not.toBeInTheDocument()
  })

  it('確認中は案内を出さない（ちらつき防止）', () => {
    mockUseStripeStatus.mockReturnValue({
      canCheckout: false,
      keysConfigured: false,
      selfServeEnabled: false,
      partial: false,
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
      canCheckout: false,
      keysConfigured: false,
      selfServeEnabled: false,
      partial: false,
      loading: false,
      error: null,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByRole('button', { name: 'Proにアップグレード' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Enterpriseを相談する' })).not.toBeDisabled()
  })

  it('should enable upgrade buttons when Stripe is configured and org is loaded', () => {
    mockUseStripeStatus.mockReturnValue({
      canCheckout: true,
      keysConfigured: true,
      selfServeEnabled: true,
      partial: false,
      loading: false,
      error: null,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByRole('button', { name: 'Proにアップグレード' })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: 'Enterpriseを相談する' })).not.toBeDisabled()
  })

  it('should show warning message when Stripe is not configured', () => {
    mockUseStripeStatus.mockReturnValue({
      canCheckout: false,
      keysConfigured: false,
      selfServeEnabled: false,
      partial: false,
      loading: false,
      error: null,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByText('いまオンラインでのお申し込みはご利用いただけません')).toBeInTheDocument()
  })

  it('should call checkout API when upgrade button is clicked', async () => {
    mockUseStripeStatus.mockReturnValue({
      canCheckout: true,
      keysConfigured: true,
      selfServeEnabled: true,
      partial: false,
      loading: false,
      error: null,
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
      canCheckout: true,
      keysConfigured: true,
      selfServeEnabled: true,
      partial: false,
      loading: false,
      error: null,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByText('お支払い方法')).toBeInTheDocument()
  })

  it('should show invoice history component', () => {
    mockUseStripeStatus.mockReturnValue({
      canCheckout: true,
      keysConfigured: true,
      selfServeEnabled: true,
      partial: false,
      loading: false,
      error: null,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByTestId('invoice-history')).toBeInTheDocument()
  })

  it('should show a back button that falls back to /inbox when there is no history', () => {
    mockUseStripeStatus.mockReturnValue({
      canCheckout: true,
      keysConfigured: true,
      selfServeEnabled: true,
      partial: false,
      loading: false,
      error: null,
    })
    Object.defineProperty(window.history, 'length', { value: 1, configurable: true })

    render(<BillingSettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '戻る' }))
    expect(mockPush).toHaveBeenCalledWith('/inbox')
  })

  it('should show org name when loaded', () => {
    mockUseStripeStatus.mockReturnValue({
      canCheckout: true,
      keysConfigured: true,
      selfServeEnabled: true,
      partial: false,
      loading: false,
      error: null,
    })

    render(<BillingSettingsPage />)

    expect(screen.getByText('Test Org')).toBeInTheDocument()
  })

  it('should show error when org loading fails', () => {
    mockUseStripeStatus.mockReturnValue({
      canCheckout: true,
      keysConfigured: true,
      selfServeEnabled: true,
      partial: false,
      loading: false,
      error: null,
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

  /**
   * Codex レビュー指摘: 受け付け（元栓）を閉じたとき、既に払っている方の
   * 「支払い方法の変更・請求書・解約」まで消えてはいけない。今回直そうとしている本番障害の
   * 一部をそのまま残すことになる。鍵さえ揃っていれば契約管理は出す。
   */
  it('受け付けを閉じていても、有料組織のオーナーには契約管理を出す', () => {
    mockUseStripeStatus.mockReturnValue({
      canCheckout: false,
      keysConfigured: true,
      selfServeEnabled: false,
      partial: false,
      loading: false,
      error: null,
    })
    mockUseCurrentOrg.mockReturnValue({
      orgId: 'org-1',
      orgName: 'テスト組織',
      role: 'owner',
      loading: false,
      error: null,
    })
    mockUseBillingLimits.mockReturnValue({ limits: { plan_name: 'Pro' } })

    render(<BillingSettingsPage />)

    expect(screen.getByRole('button', { name: /Stripeで管理/ })).toBeInTheDocument()
    // 新規の申し込みは閉じたまま
    expect(screen.getByRole('button', { name: 'Proにアップグレード' })).toBeDisabled()
    expect(screen.getByTestId('billing-unavailable-notice')).toBeInTheDocument()
  })

  it('鍵が無いときは契約管理も出さない（押しても失敗するだけなので）', () => {
    mockUseStripeStatus.mockReturnValue({
      canCheckout: false,
      keysConfigured: false,
      selfServeEnabled: false,
      partial: false,
      loading: false,
      error: null,
    })
    mockUseCurrentOrg.mockReturnValue({
      orgId: 'org-1',
      orgName: 'テスト組織',
      role: 'owner',
      loading: false,
      error: null,
    })
    mockUseBillingLimits.mockReturnValue({ limits: { plan_name: 'Pro' } })

    render(<BillingSettingsPage />)

    expect(screen.queryByRole('button', { name: /Stripeで管理/ })).not.toBeInTheDocument()
  })

  /**
   * 受け付けは組織ごとに開けられる（許可リスト）。組織が確定する前の判定は
   * 「全体の元栓だけ」の答えなので、そのまま「準備中」を出すと、許可された組織にも
   * 一瞬そう見えてしまう。組織の読み込み中は案内を出さない。
   */
  it('組織の読み込み中は案内を出さない', () => {
    mockUseStripeStatus.mockReturnValue({
      canCheckout: false,
      keysConfigured: false,
      selfServeEnabled: false,
      partial: false,
      loading: false,
      error: null,
    })
    mockUseCurrentOrg.mockReturnValue({
      orgId: null,
      orgName: null,
      role: null,
      loading: true,
      error: null,
    })

    render(<BillingSettingsPage />)

    expect(screen.queryByTestId('billing-unavailable-notice')).not.toBeInTheDocument()
  })
})
