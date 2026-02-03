'use client'

import { useState, useEffect, useCallback } from 'react'

export interface Invoice {
  id: string
  number: string | null
  amount_due: number
  amount_paid: number
  currency: string
  status: string | null
  created: number
  invoice_pdf: string | null
  hosted_invoice_url: string | null
}

export interface BillingInvoicesState {
  invoices: Invoice[]
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useBillingInvoices(orgId?: string): BillingInvoicesState {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchInvoices = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)

    try {
      const url = orgId
        ? `/api/stripe/invoices?org_id=${encodeURIComponent(orgId)}`
        : '/api/stripe/invoices'

      const response = await fetch(url, { signal })

      if (signal?.aborted) return

      if (!response.ok) {
        throw new Error('Failed to fetch invoices')
      }

      const data = await response.json()
      setInvoices(data.invoices || [])
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      if (!signal?.aborted) {
        setError('請求履歴の取得に失敗しました')
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false)
      }
    }
  }, [orgId])

  useEffect(() => {
    const controller = new AbortController()
    fetchInvoices(controller.signal)

    return () => {
      controller.abort()
    }
  }, [fetchInvoices])

  const refresh = useCallback(() => {
    fetchInvoices()
  }, [fetchInvoices])

  return {
    invoices,
    loading,
    error,
    refresh,
  }
}
