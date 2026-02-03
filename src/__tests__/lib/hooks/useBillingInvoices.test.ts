import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useBillingInvoices } from '@/lib/hooks/useBillingInvoices'

describe('useBillingInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should start with loading state', () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}))

    const { result } = renderHook(() => useBillingInvoices())

    expect(result.current.loading).toBe(true)
    expect(result.current.invoices).toEqual([])
    expect(result.current.error).toBe(null)
  })

  it('should fetch invoices successfully', async () => {
    const mockInvoices = [
      {
        id: 'inv_123',
        number: 'INV-0001',
        amount_due: 1000,
        amount_paid: 1000,
        currency: 'jpy',
        status: 'paid',
        created: 1704067200,
        invoice_pdf: 'https://example.com/invoice.pdf',
        hosted_invoice_url: 'https://example.com/invoice',
      },
    ]

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ invoices: mockInvoices }),
    })

    const { result } = renderHook(() => useBillingInvoices())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.invoices).toEqual(mockInvoices)
    expect(result.current.error).toBe(null)
  })

  it('should pass org_id to API when provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ invoices: [] }),
    })

    renderHook(() => useBillingInvoices('org-123'))

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/stripe/invoices?org_id=org-123',
        expect.any(Object)
      )
    })
  })

  it('should not pass org_id when not provided', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ invoices: [] }),
    })

    renderHook(() => useBillingInvoices())

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/stripe/invoices',
        expect.any(Object)
      )
    })
  })

  it('should handle fetch error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })

    const { result } = renderHook(() => useBillingInvoices())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('請求履歴の取得に失敗しました')
    expect(result.current.invoices).toEqual([])
  })

  it('should handle network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

    const { result } = renderHook(() => useBillingInvoices())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.error).toBe('請求履歴の取得に失敗しました')
  })

  it('should handle empty invoices array', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ invoices: [] }),
    })

    const { result } = renderHook(() => useBillingInvoices())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(result.current.invoices).toEqual([])
    expect(result.current.error).toBe(null)
  })

  it('should provide refresh function', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ invoices: [] }),
    })

    const { result } = renderHook(() => useBillingInvoices())

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    expect(typeof result.current.refresh).toBe('function')

    // Call refresh
    result.current.refresh()

    // Should have been called twice now
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
    })
  })
})
