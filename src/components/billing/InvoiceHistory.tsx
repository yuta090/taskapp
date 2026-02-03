'use client'

import { useBillingInvoices } from '@/lib/hooks/useBillingInvoices'
import { ArrowsClockwise, FileText, DownloadSimple, Receipt } from '@phosphor-icons/react'

interface InvoiceHistoryProps {
  orgId?: string
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100) // Stripeは金額をセント単位で返す
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(new Date(timestamp * 1000))
}

function getStatusBadge(status: string | null): { label: string; className: string } {
  switch (status) {
    case 'paid':
      return { label: '支払済', className: 'bg-green-100 text-green-700' }
    case 'open':
      return { label: '未払い', className: 'bg-yellow-100 text-yellow-700' }
    case 'draft':
      return { label: '下書き', className: 'bg-gray-100 text-gray-700' }
    case 'uncollectible':
      return { label: '回収不能', className: 'bg-red-100 text-red-700' }
    case 'void':
      return { label: '無効', className: 'bg-gray-100 text-gray-500' }
    default:
      return { label: status || '不明', className: 'bg-gray-100 text-gray-500' }
  }
}

export function InvoiceHistory({ orgId }: InvoiceHistoryProps) {
  const { invoices, loading, error, refresh } = useBillingInvoices(orgId)

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Receipt className="w-5 h-5 text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900">請求履歴</h3>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-12 bg-gray-100 rounded" />
          <div className="h-12 bg-gray-100 rounded" />
          <div className="h-12 bg-gray-100 rounded" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg border border-red-200 p-6">
        <div className="flex items-center justify-between">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={refresh}
            className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
          >
            <ArrowsClockwise className="w-4 h-4" />
            再読み込み
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Receipt className="w-5 h-5 text-gray-400" />
          <h3 className="text-lg font-semibold text-gray-900">請求履歴</h3>
        </div>
        <button
          onClick={refresh}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          title="更新"
        >
          <ArrowsClockwise className="w-5 h-5" />
        </button>
      </div>

      {invoices.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <FileText className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-sm">請求履歴はありません</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-3">
                  請求書番号
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-3">
                  日付
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-3">
                  金額
                </th>
                <th className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider pb-3">
                  ステータス
                </th>
                <th className="text-right text-xs font-medium text-gray-500 uppercase tracking-wider pb-3">
                  アクション
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoices.map((invoice) => {
                const statusBadge = getStatusBadge(invoice.status)
                return (
                  <tr key={invoice.id} className="hover:bg-gray-50">
                    <td className="py-3">
                      <span className="text-sm font-medium text-gray-900">
                        {invoice.number || '-'}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="text-sm text-gray-600">
                        {formatDate(invoice.created)}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className="text-sm font-medium text-gray-900">
                        {formatCurrency(invoice.amount_paid || invoice.amount_due, invoice.currency)}
                      </span>
                    </td>
                    <td className="py-3">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${statusBadge.className}`}>
                        {statusBadge.label}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {invoice.hosted_invoice_url && (
                          <a
                            href={invoice.hosted_invoice_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                            title="詳細を見る"
                          >
                            <FileText className="w-4 h-4" />
                          </a>
                        )}
                        {invoice.invoice_pdf && (
                          <a
                            href={invoice.invoice_pdf}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                            title="PDFをダウンロード"
                          >
                            <DownloadSimple className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
