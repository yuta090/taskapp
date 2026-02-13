'use client'

import { useState, useMemo, useCallback } from 'react'
import { SlotResponseIcon, SlotResponseInput } from './SlotResponseInput'
import { useRealtimeResponses } from '@/lib/hooks/useRealtimeResponses'
import type { SlotResponseType } from '@/types/database'
import type { SlotResponseWithUser, ProposalRespondentWithProfile } from '@/lib/hooks/useProposalResponses'
import type { ProposalSlot } from '@/types/database'

interface SlotResponseGridProps {
  slots: ProposalSlot[]
  respondents: ProposalRespondentWithProfile[]
  responsesBySlot: Record<string, SlotResponseWithUser[]>
  myRespondentId: string | null
  onSubmit: (responses: { slotId: string; response: SlotResponseType }[]) => Promise<void>
  isSubmitting?: boolean
  readOnly?: boolean
  proposalId?: string | null
  onRealtimeUpdate?: () => void
  getSlotSummary: (slotId: string) => {
    available: number
    proceed: number
    unavailable: number
    pending: number
  }
}

function formatSlotHeader(dateStr: string): { date: string; time: string } {
  const d = new Date(dateStr)
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return {
    date: `${month}/${day}(${weekday})`,
    time: `${hours}:${minutes}`,
  }
}

function formatSlotEndTime(dateStr: string): string {
  const d = new Date(dateStr)
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${hours}:${minutes}`
}

export function SlotResponseGrid({
  slots,
  respondents,
  responsesBySlot,
  myRespondentId,
  onSubmit,
  isSubmitting = false,
  readOnly = false,
  proposalId = null,
  onRealtimeUpdate,
  getSlotSummary,
}: SlotResponseGridProps) {
  // Realtime subscription
  const slotIds = useMemo(() => slots.map((s) => s.id), [slots])

  const handleRealtimeChange = useCallback(() => {
    onRealtimeUpdate?.()
  }, [onRealtimeUpdate])

  const { isSubscribed } = useRealtimeResponses({
    proposalId: proposalId || null,
    slotIds,
    onResponseChange: handleRealtimeChange,
  })
  // Local state for my draft responses (before submit)
  const [myDraftResponses, setMyDraftResponses] = useState<Record<string, SlotResponseType>>(() => {
    // Initialize from existing responses or default to unavailable_but_proceed
    const initial: Record<string, SlotResponseType> = {}
    for (const slot of slots) {
      const existingResponse = myRespondentId
        ? (responsesBySlot[slot.id] || []).find(
            (r) => r.respondentId === myRespondentId
          )
        : null
      initial[slot.id] = existingResponse?.response || 'unavailable_but_proceed'
    }
    return initial
  })

  // Check if draft differs from saved
  const hasUnsavedChanges = useMemo(() => {
    for (const slot of slots) {
      const saved = myRespondentId
        ? (responsesBySlot[slot.id] || []).find(
            (r) => r.respondentId === myRespondentId
          )?.response
        : null
      if (myDraftResponses[slot.id] !== (saved || 'unavailable_but_proceed')) {
        return true
      }
    }
    return false
  }, [slots, myDraftResponses, responsesBySlot, myRespondentId])

  const handleSubmit = async () => {
    const responses = slots.map((slot) => ({
      slotId: slot.id,
      response: myDraftResponses[slot.id] || 'unavailable_but_proceed',
    }))
    await onSubmit(responses)
  }

  const sortedSlots = useMemo(
    () => [...slots].sort((a, b) => a.slot_order - b.slot_order),
    [slots]
  )

  return (
    <div className="space-y-4" data-testid="slot-response-grid">
      {/* Realtime indicator */}
      {proposalId && isSubscribed && (
        <div className="flex items-center gap-1.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          <span className="text-xs text-green-600 font-medium">Live</span>
        </div>
      )}

      {/* Matrix: header row */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="text-left py-2 px-2 text-xs font-medium text-gray-500 w-28">
                回答者
              </th>
              {sortedSlots.map((slot) => {
                const header = formatSlotHeader(slot.start_at)
                const endTime = formatSlotEndTime(slot.end_at)
                return (
                  <th
                    key={slot.id}
                    className="text-center py-2 px-2 text-xs font-medium text-gray-500"
                  >
                    <div>{header.date}</div>
                    <div className="text-gray-400">
                      {header.time}-{endTime}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {respondents.map((respondent) => {
              const isMe = respondent.id === myRespondentId
              const isClient = respondent.side === 'client'

              return (
                <tr
                  key={respondent.id}
                  className={`border-b border-gray-100 ${
                    isClient ? 'bg-amber-50/50' : ''
                  } ${isMe ? 'bg-blue-50/30' : ''}`}
                  data-testid={`respondent-row-${respondent.userId}`}
                >
                  <td className="py-2 px-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-700 truncate max-w-[100px]">
                        {respondent.displayName}
                        {isMe && (
                          <span className="text-xs text-blue-500 ml-1">(自分)</span>
                        )}
                      </span>
                      <span className={`text-xs ${isClient ? 'text-amber-600' : 'text-gray-400'}`}>
                        {isClient ? 'クライアント' : '社内'}
                      </span>
                    </div>
                  </td>
                  {sortedSlots.map((slot) => {
                    if (isMe && !readOnly) {
                      // Editable cell for me
                      return (
                        <td key={slot.id} className="py-2 px-2 text-center">
                          <SlotResponseInput
                            value={myDraftResponses[slot.id] || 'unavailable_but_proceed'}
                            onChange={(val) =>
                              setMyDraftResponses((prev) => ({
                                ...prev,
                                [slot.id]: val,
                              }))
                            }
                            variant="internal"
                            disabled={isSubmitting}
                          />
                        </td>
                      )
                    }

                    // Read-only cell
                    const response = (responsesBySlot[slot.id] || []).find(
                      (r) => r.respondentId === respondent.id
                    )
                    return (
                      <td key={slot.id} className="py-2 px-2 text-center">
                        <SlotResponseIcon response={response?.response || null} size="md" />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="space-y-1">
        <h4 className="text-xs font-medium text-gray-500">集計</h4>
        {sortedSlots.map((slot) => {
          const header = formatSlotHeader(slot.start_at)
          const summary = getSlotSummary(slot.id)
          return (
            <div key={slot.id} className="flex items-center gap-2 text-xs text-gray-500">
              <span className="w-20">{header.date} {header.time}</span>
              <span className="text-green-600">● {summary.available}</span>
              <span className="text-amber-500">▲ {summary.proceed}</span>
              <span className="text-red-400">✕ {summary.unavailable}</span>
              <span className="text-gray-300">◌ {summary.pending}</span>
            </div>
          )
        })}
      </div>

      {/* Submit button */}
      {myRespondentId && !readOnly && (
        <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-400 flex-1">
            全スロットの回答を選択後、送信してください
          </p>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              isSubmitting
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
            data-testid="submit-responses"
          >
            {isSubmitting
              ? '送信中...'
              : hasUnsavedChanges
              ? '回答を送信（未保存あり）'
              : '回答を送信'}
          </button>
        </div>
      )}
    </div>
  )
}
