'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { useConsidering } from '@/lib/hooks/useConsidering'
import type { EvidenceType } from '@/types/database'

interface ConsideringDecisionPanelProps {
  taskId: string
  spaceId: string
  /** Client-side members eligible to be recorded as the confirming party. */
  clientMembers: { id: string; displayName: string }[]
  /** Called after a decision is successfully recorded (e.g. to refetch the task). */
  onDecided?: () => void
}

// Out-of-meeting evidence only — 'meeting' is captured by the in-meeting flow.
const EVIDENCE_OPTIONS: { value: Exclude<EvidenceType, 'meeting'>; label: string }[] = [
  { value: 'email', label: 'メール' },
  { value: 'chat', label: 'チャット' },
  { value: 'call', label: '電話' },
  { value: 'other', label: 'その他' },
]

/**
 * AT-007: record a client decision made outside a meeting.
 * 決定内容・根拠(evidence)・確認相手(client) を必須にし、on_behalf_of=client の
 * 監査イベントを残す（言った言わない防止）。
 */
export function ConsideringDecisionPanel({
  taskId,
  spaceId,
  clientMembers,
  onDecided,
}: ConsideringDecisionPanelProps) {
  const { decideConsidering } = useConsidering({ spaceId })
  const [decisionText, setDecisionText] = useState('')
  const [evidence, setEvidence] = useState<Exclude<EvidenceType, 'meeting'>>('email')
  const [clientConfirmedBy, setClientConfirmedBy] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = decisionText.trim().length > 0 && clientConfirmedBy !== '' && !submitting

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await decideConsidering({
        taskId,
        decisionText: decisionText.trim(),
        onBehalfOf: 'client',
        evidence,
        clientConfirmedBy,
      })
      toast.success('クライアント確定として登録しました')
      setDecisionText('')
      setClientConfirmedBy('')
      onDecided?.()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '登録に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-amber-600">会議外でクライアント確定として登録</p>

      <textarea
        data-testid="considering-decision-text"
        value={decisionText}
        onChange={(e) => setDecisionText(e.target.value)}
        placeholder="決定内容（必須）"
        rows={2}
        className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-1 focus:ring-amber-400"
      />

      <div className="flex gap-2">
        <select
          data-testid="considering-evidence"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value as Exclude<EvidenceType, 'meeting'>)}
          className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
          aria-label="根拠"
        >
          {EVIDENCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              根拠: {opt.label}
            </option>
          ))}
        </select>

        <select
          data-testid="considering-confirmed-by"
          value={clientConfirmedBy}
          onChange={(e) => setClientConfirmedBy(e.target.value)}
          className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
          aria-label="確認相手"
        >
          <option value="">確認相手（必須）</option>
          {clientMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        data-testid="considering-submit"
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="w-full px-3 py-2 text-sm rounded-lg transition-colors bg-amber-500 text-white hover:bg-amber-600 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
      >
        {submitting ? '登録中...' : 'クライアント確定として登録'}
      </button>
    </div>
  )
}
