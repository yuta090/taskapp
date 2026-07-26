'use client'

import { useCallback, useEffect, useState } from 'react'
import { CircleNotch, Receipt, CheckCircle, Clock } from '@phosphor-icons/react'
import type { BillingQuoteRow } from '@/lib/billing/quotes'

interface QuoteCardProps {
  orgId?: string
  /** owner 以外には出さない（金額と承認は owner のもの） */
  isOwner: boolean
}

const OPEN_STATUSES = new Set(['requested', 'offered'])

/**
 * 枠の追加（メンバー・相手先グループ）のお見積もりカード。
 *
 * 依頼 → 当社が金額を提示 → owner が承認 → 承認と同時に枠が増える。
 * 承認は支払いの約束なので、**表示している金額をそのままサーバへ返して照合**する
 * （提示が差し替わった古い画面から意図しない金額を承認しない）。
 */
export function QuoteCard({ orgId, isOwner }: QuoteCardProps) {
  const [quotes, setQuotes] = useState<BillingQuoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId || !isOwner) {
      setLoading(false)
      return
    }
    try {
      const res = await fetch(`/api/billing/quotes?orgId=${orgId}`)
      const data = await res.json()
      setQuotes(res.ok ? (data.quotes ?? []) : [])
    } catch {
      setQuotes([])
    } finally {
      setLoading(false)
    }
  }, [orgId, isOwner])

  useEffect(() => {
    void load()
  }, [load])

  if (!isOwner || !orgId) return null

  const open = quotes.find((q) => OPEN_STATUSES.has(q.status))
  const approved = quotes.filter((q) => q.status === 'approved')

  async function submitRequest() {
    if (!note.trim() || submitting) return
    setSubmitting(true)
    setMessage(null)
    try {
      const res = await fetch('/api/billing/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, note: note.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error ?? 'お見積もりの依頼に失敗しました')
      } else {
        setNote('')
        setMessage('お見積もりを承りました。金額をご提示しますのでお待ちください。')
        await load()
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function respond(quote: BillingQuoteRow, action: 'approve' | 'reject') {
    if (submitting) return
    setSubmitting(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/billing/quotes/${quote.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          action,
          // 表示している金額をそのまま返す（サーバ側で行と照合する）
          ...(action === 'approve' ? { amount: quote.amount_monthly_jpy } : {}),
        }),
      })
      const data = await res.json()
      setMessage(
        res.ok
          ? action === 'approve'
            ? '承認しました。枠が増えています。'
            : '見送りとして記録しました。'
          : (data.error ?? '処理に失敗しました'),
      )
      await load()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Receipt size={20} className="text-gray-500" />
        <h3 className="text-sm font-semibold text-gray-900">枠の追加（お見積もり）</h3>
      </div>

      {loading ? (
        <div className="h-16 bg-gray-100 rounded animate-pulse" />
      ) : open?.status === 'offered' ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
          <p className="text-sm text-gray-700">お見積もりが届いています。</p>
          <p className="text-2xl font-semibold text-gray-900">
            月額 +¥{(open.amount_monthly_jpy ?? 0).toLocaleString()}
            <span className="text-sm font-normal text-gray-600">（税別）</span>
          </p>
          <ul className="text-sm text-gray-700 space-y-1">
            {open.add_members > 0 && <li>・メンバーを {open.add_members} 人ぶん追加</li>}
            {open.add_line_groups > 0 && <li>・相手先グループを {open.add_line_groups} 件ぶん追加</li>}
            {open.add_external_chat_groups > 0 && (
              <li>・LINE以外のチャットを {open.add_external_chat_groups} 件ぶん追加</li>
            )}
          </ul>
          {open.offer_note && <p className="text-sm text-gray-600">{open.offer_note}</p>}
          <p className="text-xs text-gray-500">
            承認すると枠はすぐに増えます。請求に反映されるのは次回の請求分からです。
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={submitting}
              onClick={() => respond(open, 'approve')}
              className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              {submitting ? <CircleNotch size={16} className="animate-spin" /> : 'この内容で承認する'}
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => respond(open, 'reject')}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              見送る
            </button>
          </div>
        </div>
      ) : open?.status === 'requested' ? (
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
          <Clock size={16} className="text-gray-500" />
          お見積もりを作成しています。金額が決まりましたらこの画面に表示されます。
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-gray-600">
            メンバーや相手先グループを上限より増やしたいときは、お見積もりをご依頼ください。
          </p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="例: メンバーをあと10人、相手先グループをあと10件ふやしたい"
            className="w-full text-sm border border-gray-300 rounded-lg p-2"
          />
          <button
            type="button"
            disabled={submitting || !note.trim()}
            onClick={submitRequest}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            お見積もりを依頼する
          </button>
        </div>
      )}

      {approved.length > 0 && (
        <div className="pt-2 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-500 mb-2">追加済みの枠</p>
          <ul className="space-y-1">
            {approved.map((q) => (
              <li key={q.id} className="flex items-center gap-2 text-sm text-gray-700">
                <CheckCircle size={14} className="text-emerald-600" />
                月額 +¥{(q.amount_monthly_jpy ?? 0).toLocaleString()}
                {q.add_members > 0 && `／メンバー+${q.add_members}`}
                {q.add_line_groups > 0 && `／相手先グループ+${q.add_line_groups}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && <p className="text-sm text-gray-700">{message}</p>}
    </div>
  )
}
