'use client'

import { useState } from 'react'
import type { SharedBotAccessRequest } from '@/lib/channels/store'

function formatJst(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

export function SharedBotAccessClient({
  initialRequests,
}: {
  initialRequests: SharedBotAccessRequest[]
}) {
  const [requests, setRequests] = useState(initialRequests)
  const [pendingOrgId, setPendingOrgId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function grant(orgId: string) {
    setError(null)
    setPendingOrgId(orgId)
    try {
      const res = await fetch('/api/admin/shared-bot-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `開通に失敗しました (${res.status})`)
      }
      // 開通済みはキューから外す
      setRequests((prev) => prev.filter((r) => r.orgId !== orgId))
    } catch (e) {
      setError(e instanceof Error ? e.message : '開通に失敗しました')
    } finally {
      setPendingOrgId(null)
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-gray-900">共通LINE 開通待ち</h1>
        <p className="mt-1 text-sm text-gray-500">
          事務所（org）が共通LINEの利用を申し込んだ一覧です。内容を確認して「開通する」を押すと、
          その org で共通LINEのグループ紐付け（新規発行・承認）が使えるようになります。既存の利用は影響しません。
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {requests.length === 0 ? (
        <div className="rounded-md border border-gray-200 bg-white px-4 py-12 text-center text-sm text-gray-500">
          開通待ちの申込はありません。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-500">事務所（org）</th>
                <th className="px-4 py-3 text-left font-medium text-gray-500">申込日時（JST）</th>
                <th className="px-4 py-3 text-right font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {requests.map((r) => (
                <tr key={r.orgId}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{r.orgName ?? '(名称未設定)'}</div>
                    <div className="font-mono text-xs text-gray-400">{r.orgId}</div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-gray-700">{formatJst(r.requestedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => grant(r.orgId)}
                      disabled={pendingOrgId === r.orgId}
                      className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50"
                    >
                      {pendingOrgId === r.orgId ? '開通中…' : '開通する'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
