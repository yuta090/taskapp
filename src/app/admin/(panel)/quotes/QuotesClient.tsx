'use client'

import { useState } from 'react'
import type { BillingQuoteRow } from '@/lib/billing/quotes'

/**
 * 枠追加のお見積もり（当社側）。
 *
 * 依頼を見て金額を入れ「提示する」→ 顧客が承認すると枠が増える。
 * 承認済みは「請求へ未反映」として残るので、Stripe 側で手動反映したら「反映済みにする」を押す
 * （自動反映は後続PR）。金額の自動計算はしない＝価格が未確定のため人が決める。
 */

function formatJst(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

interface OfferDraft {
  amount: string
  members: string
  lineGroups: string
  externalGroups: string
  note: string
}

const EMPTY_DRAFT: OfferDraft = {
  amount: '',
  members: '',
  lineGroups: '',
  externalGroups: '',
  note: '',
}

export function QuotesClient({
  initialOpen,
  initialPendingSync,
}: {
  initialOpen: BillingQuoteRow[]
  initialPendingSync: BillingQuoteRow[]
}) {
  const [open, setOpen] = useState(initialOpen)
  const [pendingSync, setPendingSync] = useState(initialPendingSync)
  const [drafts, setDrafts] = useState<Record<string, OfferDraft>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function draftOf(id: string): OfferDraft {
    return drafts[id] ?? EMPTY_DRAFT
  }

  function setDraft(id: string, patch: Partial<OfferDraft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...draftOf(id), ...patch } }))
  }

  async function offer(quote: BillingQuoteRow) {
    const d = draftOf(quote.id)
    setError(null)
    setBusyId(quote.id)
    try {
      const res = await fetch('/api/admin/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteId: quote.id,
          amountMonthlyJpy: Number(d.amount || 0),
          addMembers: Number(d.members || 0),
          addLineGroups: Number(d.lineGroups || 0),
          addExternalChatGroups: Number(d.externalGroups || 0),
          note: d.note || null,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? `提示に失敗しました (${res.status})`)
      setOpen((prev) => prev.filter((q) => q.id !== quote.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : '提示に失敗しました')
    } finally {
      setBusyId(null)
    }
  }

  async function act(quoteId: string, action: 'cancel' | 'terminate' | 'markApplied') {
    setError(null)
    setBusyId(quoteId)
    try {
      const res = await fetch('/api/admin/quotes', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quoteId, action }),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(body.error ?? `操作に失敗しました (${res.status})`)
      if (action === 'cancel') setOpen((prev) => prev.filter((q) => q.id !== quoteId))
      else setPendingSync((prev) => prev.filter((q) => q.id !== quoteId))
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作に失敗しました')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">枠追加のお見積もり</h1>
        <p className="mt-1 text-sm text-gray-500">
          お客様からの枠追加の依頼に金額を提示します。お客様が承認すると枠はすぐに増えます。
          請求への反映は現在は手作業です（Stripe で追加してから「反映済みにする」を押してください）。
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">依頼中・提示中</h2>
        {open.length === 0 ? (
          <p className="text-sm text-gray-500">対応待ちの依頼はありません。</p>
        ) : (
          open.map((q) => (
            <div key={q.id} className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">org: {q.org_id}</p>
                  <p className="text-sm text-gray-900">{q.requested_note || '（希望内容の記載なし）'}</p>
                  <p className="text-xs text-gray-500">依頼日時: {formatJst(q.requested_at)}</p>
                </div>
                <span className="text-xs rounded-full border border-gray-300 px-2 py-0.5 text-gray-600">
                  {q.status === 'requested' ? '依頼中' : '提示中'}
                </span>
              </div>

              {q.status === 'offered' ? (
                <div className="text-sm text-gray-700">
                  提示済み: 月額 +¥{(q.amount_monthly_jpy ?? 0).toLocaleString()} ／ メンバー+
                  {q.add_members} ／ グループ+{q.add_line_groups}（期限 {formatJst(q.expires_at)}）
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  <label className="text-xs text-gray-600">
                    月額(円)
                    <input
                      type="number"
                      min={0}
                      value={draftOf(q.id).amount}
                      onChange={(e) => setDraft(q.id, { amount: e.target.value })}
                      className="mt-1 w-full rounded border border-gray-300 p-1 text-sm"
                    />
                  </label>
                  <label className="text-xs text-gray-600">
                    メンバー+
                    <input
                      type="number"
                      min={0}
                      value={draftOf(q.id).members}
                      onChange={(e) => setDraft(q.id, { members: e.target.value })}
                      className="mt-1 w-full rounded border border-gray-300 p-1 text-sm"
                    />
                  </label>
                  <label className="text-xs text-gray-600">
                    相手先グループ+
                    <input
                      type="number"
                      min={0}
                      value={draftOf(q.id).lineGroups}
                      onChange={(e) => setDraft(q.id, { lineGroups: e.target.value })}
                      className="mt-1 w-full rounded border border-gray-300 p-1 text-sm"
                    />
                  </label>
                  <label className="text-xs text-gray-600">
                    他チャット+
                    <input
                      type="number"
                      min={0}
                      value={draftOf(q.id).externalGroups}
                      onChange={(e) => setDraft(q.id, { externalGroups: e.target.value })}
                      className="mt-1 w-full rounded border border-gray-300 p-1 text-sm"
                    />
                  </label>
                  <label className="text-xs text-gray-600">
                    ひとこと
                    <input
                      type="text"
                      value={draftOf(q.id).note}
                      onChange={(e) => setDraft(q.id, { note: e.target.value })}
                      className="mt-1 w-full rounded border border-gray-300 p-1 text-sm"
                    />
                  </label>
                </div>
              )}

              <div className="flex gap-2">
                {q.status === 'requested' && (
                  <button
                    type="button"
                    disabled={busyId === q.id}
                    onClick={() => offer(q)}
                    className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                  >
                    この内容で提示する
                  </button>
                )}
                <button
                  type="button"
                  disabled={busyId === q.id}
                  onClick={() => act(q.id, 'cancel')}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  取り下げる
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">承認済み・請求へ未反映</h2>
        {pendingSync.length === 0 ? (
          <p className="text-sm text-gray-500">未反映のものはありません。</p>
        ) : (
          pendingSync.map((q) => (
            <div
              key={q.id}
              className="flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 p-4"
            >
              <div className="text-sm text-gray-800">
                <p className="text-xs text-gray-500">org: {q.org_id}</p>
                月額 +¥{(q.amount_monthly_jpy ?? 0).toLocaleString()} ／ メンバー+{q.add_members} ／
                グループ+{q.add_line_groups}
                <p className="text-xs text-gray-500">承認日時: {formatJst(q.approved_at)}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busyId === q.id}
                  onClick={() => act(q.id, 'markApplied')}
                  className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                >
                  反映済みにする
                </button>
                <button
                  type="button"
                  disabled={busyId === q.id}
                  onClick={() => act(q.id, 'terminate')}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  枠を終了する
                </button>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}
