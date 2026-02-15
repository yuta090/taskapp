'use client'

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { SlotResponseCell, SlotResponseIcon, RESPONSE_OPTIONS } from './SlotResponseInput'
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

// Calculate a weighted score for slot ranking
function calcSlotScore(summary: { available: number; proceed: number }): number {
  return summary.available * 1 + summary.proceed * 0.5
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
  // Default: null (未回答) instead of unavailable_but_proceed
  const [myDraftResponses, setMyDraftResponses] = useState<Record<string, SlotResponseType | null>>(() => {
    const initial: Record<string, SlotResponseType | null> = {}
    for (const slot of slots) {
      const existingResponse = myRespondentId
        ? (responsesBySlot[slot.id] || []).find(
            (r) => r.respondentId === myRespondentId
          )
        : null
      initial[slot.id] = existingResponse?.response ?? null
    }
    return initial
  })

  // Resync draft state when server data changes (realtime/fetch/proposal switch)
  // Only overwrite slots that haven't been locally modified
  const prevProposalIdRef = useRef(proposalId)
  useEffect(() => {
    // Full reset on proposal switch
    if (prevProposalIdRef.current !== proposalId) {
      prevProposalIdRef.current = proposalId
      const fresh: Record<string, SlotResponseType | null> = {}
      for (const slot of slots) {
        const serverResp = myRespondentId
          ? (responsesBySlot[slot.id] || []).find((r) => r.respondentId === myRespondentId)
          : null
        fresh[slot.id] = serverResp?.response ?? null
      }
      setMyDraftResponses(fresh)
      return
    }
    // Incremental sync: update only slots where local value matches server (not user-modified)
    setMyDraftResponses((prev) => {
      const next = { ...prev }
      let changed = false
      for (const slot of slots) {
        const serverResp = myRespondentId
          ? (responsesBySlot[slot.id] || []).find((r) => r.respondentId === myRespondentId)
          : null
        const serverValue = serverResp?.response ?? null
        // New slot not in prev → init from server
        if (!(slot.id in prev)) {
          next[slot.id] = serverValue
          changed = true
          continue
        }
        // If local value already matches server, nothing to do
        if (prev[slot.id] === serverValue) continue
        // If local value is null (user hasn't touched it), sync to server
        if (prev[slot.id] === null) {
          next[slot.id] = serverValue
          changed = true
        }
        // Otherwise, user has modified this slot locally — don't overwrite
      }
      return changed ? next : prev
    })
  }, [proposalId, slots, responsesBySlot, myRespondentId])

  // Check if all slots have been answered
  const allSlotsAnswered = useMemo(() => {
    return slots.every((slot) => myDraftResponses[slot.id] !== null)
  }, [slots, myDraftResponses])

  // Check if draft differs from saved
  const hasUnsavedChanges = useMemo(() => {
    for (const slot of slots) {
      const saved = myRespondentId
        ? (responsesBySlot[slot.id] || []).find(
            (r) => r.respondentId === myRespondentId
          )?.response ?? null
        : null
      if (myDraftResponses[slot.id] !== saved) {
        return true
      }
    }
    return false
  }, [slots, myDraftResponses, responsesBySlot, myRespondentId])

  const handleSubmit = async () => {
    // Only submit slots that have responses
    const responses = slots
      .filter((slot) => myDraftResponses[slot.id] !== null)
      .map((slot) => ({
        slotId: slot.id,
        response: myDraftResponses[slot.id] as SlotResponseType,
      }))
    if (responses.length === 0) return
    await onSubmit(responses)
  }

  const sortedSlots = useMemo(
    () => [...slots].sort((a, b) => a.slot_order - b.slot_order),
    [slots]
  )

  // Calculate best slot for summary highlight
  const slotScores = useMemo(() => {
    const scores: Record<string, number> = {}
    for (const slot of sortedSlots) {
      const summary = getSlotSummary(slot.id)
      scores[slot.id] = calcSlotScore(summary)
    }
    return scores
  }, [sortedSlots, getSlotSummary])

  const bestSlotId = useMemo(() => {
    let bestId: string | null = null
    let bestScore = -1
    for (const slot of sortedSlots) {
      const score = slotScores[slot.id] ?? 0
      if (score > bestScore) {
        bestScore = score
        bestId = slot.id
      }
    }
    return bestScore > 0 ? bestId : null
  }, [sortedSlots, slotScores])

  const totalRespondents = respondents.filter((r) => r.isRequired).length

  return (
    <div className="space-y-3" data-testid="slot-response-grid">
      {/* Realtime indicator + Legend */}
      <div className="flex items-center justify-between">
        {proposalId && isSubscribed ? (
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span className="text-xs text-green-600 font-medium">Live</span>
          </div>
        ) : (
          <div />
        )}
        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] text-gray-400">
          {RESPONSE_OPTIONS.map((opt) => (
            <span key={opt.value} className="flex items-center gap-0.5">
              <span className={opt.color}>{opt.icon}</span>
              <span>{opt.internalLabel}</span>
            </span>
          ))}
          <span className="flex items-center gap-0.5">
            <span className="text-gray-200">○</span>
            <span>未回答</span>
          </span>
        </div>
      </div>

      {/* Compact matrix */}
      <div className="border border-gray-100 rounded-lg overflow-hidden">
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '96px' }} />
            {sortedSlots.map((slot) => (
              <col key={slot.id} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left py-2 px-2 text-[11px] font-medium text-gray-400">
                回答者
              </th>
              {sortedSlots.map((slot) => {
                const header = formatSlotHeader(slot.start_at)
                const endTime = formatSlotEndTime(slot.end_at)
                return (
                  <th
                    key={slot.id}
                    className="text-center py-2 px-1 text-[11px] font-medium text-gray-500"
                  >
                    <div className="leading-tight">{header.date}</div>
                    <div className="text-gray-300 leading-tight font-normal tabular-nums">
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
                  className={`border-b border-gray-50 ${
                    isClient ? 'bg-amber-50/30' : ''
                  } ${isMe ? 'bg-blue-50/20' : ''}`}
                  data-testid={`respondent-row-${respondent.userId}`}
                >
                  <td className="py-1.5 px-2">
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-medium text-gray-700 truncate">
                        {respondent.displayName}
                        {isMe && (
                          <span className="text-[10px] text-blue-500 ml-0.5">(自分)</span>
                        )}
                      </span>
                      <span className={`text-[10px] ${isClient ? 'text-amber-600' : 'text-gray-300'}`}>
                        {isClient ? '外部' : '社内'}
                      </span>
                    </div>
                  </td>
                  {sortedSlots.map((slot) => {
                    if (isMe && !readOnly) {
                      // Editable click-to-cycle cell
                      return (
                        <td key={slot.id} className="py-1 text-center">
                          <div className="flex justify-center">
                            <SlotResponseCell
                              value={myDraftResponses[slot.id] ?? null}
                              onChange={(val) =>
                                setMyDraftResponses((prev) => ({
                                  ...prev,
                                  [slot.id]: val,
                                }))
                              }
                              disabled={isSubmitting}
                            />
                          </div>
                        </td>
                      )
                    }

                    // Read-only cell
                    const response = (responsesBySlot[slot.id] || []).find(
                      (r) => r.respondentId === respondent.id
                    )
                    return (
                      <td key={slot.id} className="py-1 text-center">
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

      {/* Summary — stacked bar visualization */}
      <div className="space-y-1.5">
        <h4 className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">集計</h4>
        <div className="space-y-1">
          {sortedSlots.map((slot) => {
            const header = formatSlotHeader(slot.start_at)
            const summary = getSlotSummary(slot.id)
            const score = slotScores[slot.id] ?? 0
            const isBest = slot.id === bestSlotId
            const eligible = summary.available + summary.proceed
            const isConfirmable = summary.unavailable === 0 && summary.pending === 0

            return (
              <div
                key={slot.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                  isBest && score > 0
                    ? 'bg-green-50 border border-green-200'
                    : isConfirmable
                    ? 'bg-green-50/50 border border-green-100'
                    : 'bg-gray-50/50'
                }`}
              >
                {/* Date/time label */}
                <span className="w-[72px] shrink-0 text-gray-500 tabular-nums leading-tight">
                  <span className="block">{header.date}</span>
                  <span className="text-gray-300">{header.time}</span>
                </span>

                {/* Stacked bar */}
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden flex">
                    {totalRespondents > 0 && (
                      <>
                        {summary.available > 0 && (
                          <div
                            className="h-full bg-green-500 transition-all duration-300"
                            style={{ width: `${(summary.available / totalRespondents) * 100}%` }}
                          />
                        )}
                        {summary.proceed > 0 && (
                          <div
                            className="h-full bg-gray-300 transition-all duration-300"
                            style={{ width: `${(summary.proceed / totalRespondents) * 100}%` }}
                          />
                        )}
                        {summary.unavailable > 0 && (
                          <div
                            className="h-full bg-red-300 transition-all duration-300"
                            style={{ width: `${(summary.unavailable / totalRespondents) * 100}%` }}
                          />
                        )}
                      </>
                    )}
                  </div>

                  {/* Count */}
                  <span className="w-8 text-right tabular-nums text-gray-500 shrink-0">
                    {eligible}/{totalRespondents}
                  </span>
                </div>

                {/* Badge */}
                {isBest && score > 0 && (
                  <span className="text-[10px] font-medium text-green-600 shrink-0">
                    おすすめ
                  </span>
                )}
                {isConfirmable && !isBest && (
                  <span className="text-[10px] font-medium text-green-500 shrink-0">
                    確定可
                  </span>
                )}
                {summary.pending > 0 && (
                  <span className="text-[10px] text-gray-300 shrink-0">
                    残{summary.pending}名
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Submit button */}
      {myRespondentId && !readOnly && (
        <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
          {!allSlotsAnswered && hasUnsavedChanges && (
            <p className="text-[11px] text-amber-500 flex-1">
              未回答のスロットがあります
            </p>
          )}
          {allSlotsAnswered && !hasUnsavedChanges && (
            <p className="text-[11px] text-gray-300 flex-1">
              回答済み
            </p>
          )}
          {allSlotsAnswered && hasUnsavedChanges && (
            <p className="text-[11px] text-blue-500 flex-1">
              未保存の変更があります
            </p>
          )}
          {!allSlotsAnswered && !hasUnsavedChanges && (
            <p className="text-[11px] text-gray-400 flex-1">
              各セルをクリックして回答してください
            </p>
          )}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting || !hasUnsavedChanges}
            className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              isSubmitting || !hasUnsavedChanges
                ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                : 'bg-gray-900 text-white hover:bg-gray-800'
            }`}
            data-testid="submit-responses"
          >
            {isSubmitting ? '送信中...' : '回答を送信'}
          </button>
        </div>
      )}
    </div>
  )
}
