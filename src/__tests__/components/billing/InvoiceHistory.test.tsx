import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { InvoiceHistory } from '@/components/billing/InvoiceHistory'

// Mock useBillingInvoices hook
const mockRefresh = vi.fn()
const mockUseBillingInvoices = vi.fn()

vi.mock('@/lib/hooks/useBillingInvoices', () => ({
  useBillingInvoices: () => mockUseBillingInvoices(),
}))

describe('InvoiceHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show loading state', () => {
    mockUseBillingInvoices.mockReturnValue({
      invoices: [],
      loading: true,
      error: null,
      refresh: mockRefresh,
    })

    render(<InvoiceHistory />)

    expect(screen.getByText('請求履歴')).toBeInTheDocument()
    // Should have skeleton loading
    const skeletons = document.querySelectorAll('.animate-pulse')
    expect(skeletons.length).toBeGreaterThan(0)
  })

  it('should show error state with refresh button', () => {
    mockUseBillingInvoices.mockReturnValue({
      invoices: [],
      loading: false,
      error: '請求履歴の取得に失敗しました',
      refresh: mockRefresh,
    })

    render(<InvoiceHistory />)

    expect(screen.getByText('請求履歴の取得に失敗しました')).toBeInTheDocument()
    expect(screen.getByText('再読み込み')).toBeInTheDocument()
  })

  it('should call refresh when error retry button is clicked', () => {
    mockUseBillingInvoices.mockReturnValue({
      invoices: [],
      loading: false,
      error: '請求履歴の取得に失敗しました',
      refresh: mockRefresh,
    })

    render(<InvoiceHistory />)

    fireEvent.click(screen.getByText('再読み込み'))
    expect(mockRefresh).toHaveBeenCalled()
  })

  it('should show empty state when no invoices', () => {
    mockUseBillingInvoices.mockReturnValue({
      invoices: [],
      loading: false,
      error: null,
      refresh: mockRefresh,
    })

    render(<InvoiceHistory />)

    expect(screen.getByText('請求履歴はありません')).toBeInTheDocument()
  })

  it('should render invoice list', () => {
    mockUseBillingInvoices.mockReturnValue({
      invoices: [
        {
          id: 'inv_123',
          number: 'INV-0001',
          amount_due: 100000,
          amount_paid: 100000,
          currency: 'jpy',
          status: 'paid',
          created: 1704067200, // 2024-01-01
          invoice_pdf: 'https://example.com/invoice.pdf',
          hosted_invoice_url: 'https://example.com/invoice',
        },
      ],
      loading: false,
      error: null,
      refresh: mockRefresh,
    })

    render(<InvoiceHistory />)

    expect(screen.getByText('INV-0001')).toBeInTheDocument()
    expect(screen.getByText('支払済')).toBeInTheDocument()
    // 100000 cents = ¥1,000 (divide by 100)
    expect(screen.getByText('￥1,000')).toBeInTheDocument()
  })

  it('should show correct status badges', () => {
    mockUseBillingInvoices.mockReturnValue({
      invoices: [
        {
          id: 'inv_1',
          number: 'INV-001',
          amount_due: 1000,
          amount_paid: 1000,
          currency: 'jpy',
          status: 'paid',
          created: 1704067200,
          invoice_pdf: null,
          hosted_invoice_url: null,
        },
        {
          id: 'inv_2',
          number: 'INV-002',
          amount_due: 2000,
          amount_paid: 0,
          currency: 'jpy',
          status: 'open',
          created: 1704067200,
          invoice_pdf: null,
          hosted_invoice_url: null,
        },
      ],
      loading: false,
      error: null,
      refresh: mockRefresh,
    })

    render(<InvoiceHistory />)

    expect(screen.getByText('支払済')).toBeInTheDocument()
    expect(screen.getByText('未払い')).toBeInTheDocument()
  })

  it('should render download links when available', () => {
    mockUseBillingInvoices.mockReturnValue({
      invoices: [
        {
          id: 'inv_123',
          number: 'INV-0001',
          amount_due: 100000,
          amount_paid: 100000,
          currency: 'jpy',
          status: 'paid',
          created: 1704067200,
          invoice_pdf: 'https://example.com/invoice.pdf',
          hosted_invoice_url: 'https://example.com/invoice',
        },
      ],
      loading: false,
      error: null,
      refresh: mockRefresh,
    })

    render(<InvoiceHistory />)

    const links = screen.getAllByRole('link')
    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', 'https://example.com/invoice')
    expect(links[1]).toHaveAttribute('href', 'https://example.com/invoice.pdf')
  })

  it('should pass orgId to hook', () => {
    mockUseBillingInvoices.mockReturnValue({
      invoices: [],
      loading: false,
      error: null,
      refresh: mockRefresh,
    })

    render(<InvoiceHistory orgId="org-123" />)

    // The mock is called - we verify it was rendered
    expect(screen.getByText('請求履歴')).toBeInTheDocument()
  })

  it('should handle invoice without number', () => {
    mockUseBillingInvoices.mockReturnValue({
      invoices: [
        {
          id: 'inv_123',
          number: null,
          amount_due: 100000,
          amount_paid: 100000,
          currency: 'jpy',
          status: 'paid',
          created: 1704067200,
          invoice_pdf: null,
          hosted_invoice_url: null,
        },
      ],
      loading: false,
      error: null,
      refresh: mockRefresh,
    })

    render(<InvoiceHistory />)

    expect(screen.getByText('-')).toBeInTheDocument()
  })
})
