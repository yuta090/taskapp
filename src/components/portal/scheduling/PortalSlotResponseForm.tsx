'use client'

import { useState, useCallback } from 'react'
import { X, CalendarBlank, Check } from '@phosphor-icons/react'
import type { SlotResponseType } from '@/types/database'

interface Slot {
  id: string
  start_at: string
  end_at: string
  slot_order: number
}

interface Proposal {
  id: string
  title: string
  status: string
  description: string | null
  expires_at: string | null
  proposal_slots: Slot[]
  hasResponded: boolean
}

interface PortalSlotResponseFormProps {
  proposal: Proposal
  onClose: () => void
  onSubmit: (
    proposalId: string,
    responses: { slotId: string; response: SlotResponseType }[]
  ) => Promise<void>
}

const RESPONSE_OPTIONS: Array<{
  value: SlotResponseType
  label: string
  color: string
  icon: string
}> = [
  {
    value: 'available',
    label: '参加できます',
    color: 'text-green-600 border-green-200 bg-green-50',
    icon: '●',
  },
  {
    value: 'unavailable_but_proceed',
    label: '欠席しますが、進めてください',
    color: 'text-amber-600 border-amber-200 bg-amber-50',
    icon: '▲',
  },
  {
    value: 'unavailable',
    label: '参加できません',
    color: 'text-red-500 border-red-200 bg-red-50',
    icon: '✕',
  },
]

function formatSlotDate(dateStr: string): string {
  const d = new Date(dateStr)
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${month}月${day}日(${weekday}) ${hours}:${minutes}`
}

function formatSlotEndTime(dateStr: string): string {
  const d = new Date(dateStr)
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function PortalSlotResponseForm({
  proposal,
  onClose,
  onSubmit,
}: PortalSlotResponseFormProps) {
  const isOpen = proposal.status === 'open'
  const slots = [...(proposal.proposal_slots || [])].sort(
    (a, b) => a.slot_order - b.slot_order
  )

  // Initialize all slots with default "unavailable_but_proceed"
  const [responses, setResponses] = useState<Record<string, SlotResponseType>>(
    () => {
      const initial: Record<string, SlotResponseType> = {}
      for (const slot of slots) {
        initial[slot.id] = 'unavailable_but_proceed'
      }
      return initial
    }
  )
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(proposal.hasResponded)

  const handleResponseChange = useCallback(
    (slotId: string, response: SlotResponseType) => {
      setResponses((prev) => ({ ...prev, [slotId]: response }))
    },
    []
  )

  const handleSubmit = useCallback(async () => {
    setSubmitting(true)
    try {
      const responseArray = Object.entries(responses).map(([slotId, response]) => ({
        slotId,
        response,
      }))
      await onSubmit(proposal.id, responseArray)
      setSubmitted(true)
    } catch (err) {
      alert(err instanceof Error ? err.message : '送信に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }, [responses, proposal.id, onSubmit])

  // All slots have a response selected
  const allAnswered = slots.every((slot) => responses[slot.id])

  return (
    <div className="h-full flex flex-col" data-testid="portal-response-form">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-100 px-4 py-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900">{proposal.title}</h2>
            {proposal.expires_at && (
              <p className="text-xs text-gray-400 mt-0.5">
                回答期限: {formatSlotDate(proposal.expires_at)}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {submitted ? (
          // Submitted confirmation
          <div className="text-center py-8 space-y-3">
            <div className="w-12 h-12 mx-auto bg-green-100 rounded-full flex items-center justify-center">
              <Check className="w-6 h-6 text-green-600" />
            </div>
            <h3 className="text-sm font-medium text-gray-900">回答を送信しました</h3>
            <div className="text-xs text-gray-500 space-y-1">
              {slots.map((slot) => (
                <div key={slot.id} className="flex items-center justify-center gap-2">
                  <span>{formatSlotDate(slot.start_at)}</span>
                  <span>→</span>
                  <span>
                    {RESPONSE_OPTIONS.find((o) => o.value === responses[slot.id])?.label || ''}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 pt-2">
              他の参加者の回答が揃い次第、日程が確定されます。
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={() => setSubmitted(false)}
                className="px-3 py-1.5 text-xs text-blue-600 hover:text-blue-700"
              >
                回答を変更する
              </button>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-700"
              >
                一覧に戻る
              </button>
            </div>
          </div>
        ) : !isOpen ? (
          // Not open (confirmed/cancelled/expired)
          <div className="text-center py-8">
            <p className="text-sm text-gray-500">
              この日程調整は{proposal.status === 'confirmed' ? '確定' : proposal.status === 'cancelled' ? 'キャンセル' : '期限切れ'}です
            </p>
          </div>
        ) : (
          // Response form
          <>
            <div className="text-sm text-gray-600">
              各候補について、ご都合をお知らせください。
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
              初期値は「欠席OK」になっています。参加できる日は「参加できます」に変更してください。
            </div>

            <div className="space-y-3">
              {slots.map((slot, idx) => (
                <div
                  key={slot.id}
                  className="bg-white border border-gray-200 rounded-xl p-4 space-y-3"
                  data-testid={`portal-slot-${idx}`}
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                    <CalendarBlank className="w-4 h-4 text-gray-400" />
                    候補 {idx + 1}: {formatSlotDate(slot.start_at)} 〜{' '}
                    {formatSlotEndTime(slot.end_at)}
                  </div>

                  <div className="space-y-1.5">
                    {RESPONSE_OPTIONS.map((option) => {
                      const isSelected = responses[slot.id] === option.value
                      return (
                        <label
                          key={option.value}
                          className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer border transition-colors min-h-[2.75rem] ${
                            isSelected
                              ? option.color
                              : 'border-gray-100 hover:bg-gray-50'
                          }`}
                          data-testid={`portal-response-${idx}-${option.value}`}
                        >
                          <input
                            type="radio"
                            name={`slot-${slot.id}`}
                            value={option.value}
                            checked={isSelected}
                            onChange={() => handleResponseChange(slot.id, option.value)}
                            className="sr-only"
                          />
                          <span className={isSelected ? '' : 'text-gray-400'}>
                            {option.icon}
                          </span>
                          <span className={`text-sm ${isSelected ? '' : 'text-gray-600'}`}>
                            {option.label}
                          </span>
                          {isSelected && option.value === 'unavailable_but_proceed' && (
                            <span className="ml-auto text-xs text-amber-500">デフォルト</span>
                          )}
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2">
              <button
                onClick={handleSubmit}
                disabled={!allAnswered || submitting}
                className={`w-full py-3 text-sm font-medium rounded-xl transition-colors ${
                  allAnswered && !submitting
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
                data-testid="portal-submit-responses"
              >
                {submitting ? '送信中...' : '回答を送信'}
              </button>
              <p className="text-xs text-gray-400 text-center mt-2">
                回答後も期限内であれば変更できます
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
