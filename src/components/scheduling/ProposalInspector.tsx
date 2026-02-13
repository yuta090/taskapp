'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, Calendar, CheckCircle, Video } from 'lucide-react'
import { ProposalStatusBadge } from './ProposalStatusBadge'
import { SlotResponseGrid } from './SlotResponseGrid'
import { useProposalResponses } from '@/lib/hooks/useProposalResponses'
import type { ProposalDetail } from '@/lib/hooks/useSchedulingProposals'
import type { SlotResponseType } from '@/types/database'

interface ProposalInspectorProps {
  proposal: ProposalDetail | null
  proposalId: string | null
  fetchProposalDetail: (id: string) => Promise<ProposalDetail | null>
  onClose: () => void
  onConfirm: (proposalId: string, slotId: string) => Promise<{ meetingId: string }>
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr)
  const weekday = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()]
  const month = d.getMonth() + 1
  const day = d.getDate()
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${month}/${day}(${weekday}) ${hours}:${minutes}`
}

export function ProposalInspector({
  proposal: initialProposal,
  proposalId,
  fetchProposalDetail,
  onClose,
  onConfirm,
}: ProposalInspectorProps) {
  const [proposal, setProposal] = useState<ProposalDetail | null>(initialProposal)
  const [confirmingSlotId, setConfirmingSlotId] = useState<string | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const {
    responsesBySlot,
    respondents,
    myRespondentId,
    loading: responsesLoading,
    fetchResponses,
    submitResponses,
    isSlotConfirmable,
    getSlotSummary,
  } = useProposalResponses({ proposalId: proposalId || null })

  // Fetch detail when proposalId changes
  useEffect(() => {
    if (proposalId) {
      fetchProposalDetail(proposalId).then((detail) => {
        if (detail) setProposal(detail)
      })
      fetchResponses()
    }
  }, [proposalId, fetchProposalDetail, fetchResponses])

  const handleSubmitResponses = useCallback(
    async (responses: { slotId: string; response: SlotResponseType }[]) => {
      setIsSubmitting(true)
      try {
        await submitResponses(responses)
      } finally {
        setIsSubmitting(false)
      }
    },
    [submitResponses]
  )

  const handleConfirm = useCallback(
    async (slotId: string) => {
      if (!proposalId) return
      setIsConfirming(true)
      try {
        await onConfirm(proposalId, slotId)
        setConfirmingSlotId(null)
        // Refresh detail
        const detail = await fetchProposalDetail(proposalId)
        if (detail) setProposal(detail)
      } finally {
        setIsConfirming(false)
      }
    },
    [proposalId, onConfirm, fetchProposalDetail]
  )

  if (!proposal) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 text-sm">
        提案を選択してください
      </div>
    )
  }

  const slots = proposal.proposal_slots || []
  const isOpen = proposal.status === 'open'
  const isConfirmed = proposal.status === 'confirmed'

  // Find confirmable slots
  const confirmableSlots = isOpen
    ? slots.filter((slot) => isSlotConfirmable(slot.id))
    : []

  // Find non-confirmable slots with reasons
  const nonConfirmableSlots = isOpen
    ? slots.filter((slot) => !isSlotConfirmable(slot.id))
    : []

  return (
    <div className="h-full flex flex-col" data-testid="proposal-inspector">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-100 px-4 py-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-900 truncate">
              {proposal.title}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <ProposalStatusBadge status={proposal.status} />
              <span className="text-xs text-gray-400">
                {respondents.length > 0
                  ? `${Object.keys(responsesBySlot).length > 0 ? new Set(Object.values(responsesBySlot).flat().map(r => r.respondentId)).size : 0}/${respondents.length}名 回答済み`
                  : ''}
              </span>
            </div>
            {proposal.expires_at && (
              <span className="text-xs text-gray-400 mt-0.5 block">
                期限: {formatDateTime(proposal.expires_at)}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600"
            data-testid="proposal-inspector-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {proposal.description && (
          <p className="text-sm text-gray-600">{proposal.description}</p>
        )}

        {/* Response Grid */}
        {isOpen && (
          <SlotResponseGrid
            slots={slots}
            respondents={respondents}
            responsesBySlot={responsesBySlot}
            myRespondentId={myRespondentId}
            onSubmit={handleSubmitResponses}
            isSubmitting={isSubmitting}
            proposalId={proposalId}
            onRealtimeUpdate={fetchResponses}
            getSlotSummary={getSlotSummary}
          />
        )}

        {/* Confirmed view */}
        {isConfirmed && proposal.confirmed_slot_id && (
          <div className="space-y-3">
            <SlotResponseGrid
              slots={slots}
              respondents={respondents}
              responsesBySlot={responsesBySlot}
              myRespondentId={myRespondentId}
              onSubmit={handleSubmitResponses}
              readOnly
              getSlotSummary={getSlotSummary}
            />

            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <div className="flex items-center gap-2 text-green-700 font-medium text-sm">
                <CheckCircle className="w-4 h-4" />
                確定済み
              </div>
              {(() => {
                const confirmedSlot = slots.find((s) => s.id === proposal.confirmed_slot_id)
                return confirmedSlot ? (
                  <p className="text-sm text-green-600 mt-1">
                    {formatDateTime(confirmedSlot.start_at)} - {formatDateTime(confirmedSlot.end_at).split(' ')[1]}
                  </p>
                ) : null
              })()}
              {proposal.meeting_url && (
                <a
                  href={proposal.meeting_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 mt-2"
                  data-testid="proposal-meeting-url"
                >
                  <Video className="w-4 h-4" />
                  ビデオ会議に参加
                </a>
              )}
              {proposal.confirmed_meeting_id && (
                <p className="text-xs text-green-500 mt-1">
                  会議が作成されました
                </p>
              )}
            </div>
          </div>
        )}

        {/* Confirmable slots section */}
        {isOpen && confirmableSlots.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-gray-500 flex items-center gap-1">
              <span>✨</span> 確定可能な候補
            </h4>
            {confirmableSlots.map((slot) => {
              const isCurrentlyConfirming = confirmingSlotId === slot.id
              return (
                <div
                  key={slot.id}
                  className="bg-green-50 border border-green-200 rounded-lg p-3"
                >
                  {isCurrentlyConfirming ? (
                    // Inline confirmation view
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-gray-900">
                        日程を確定しますか？
                      </p>
                      <p className="text-sm text-gray-600">
                        <Calendar className="inline w-3.5 h-3.5 mr-1" />
                        {formatDateTime(slot.start_at)} - {formatDateTime(slot.end_at).split(' ')[1]}
                      </p>
                      <div className="text-xs text-gray-500">
                        参加者:
                        {respondents.map((r) => (
                          <span key={r.id} className="ml-1">
                            {r.displayName}
                            {r.side === 'client' && (
                              <span className="text-amber-600">（クライアント）</span>
                            )}
                          </span>
                        ))}
                      </div>
                      <p className="text-xs text-gray-400">
                        確定すると会議が作成され、参加者全員に通知されます。
                      </p>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => setConfirmingSlotId(null)}
                          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                          disabled={isConfirming}
                        >
                          戻る
                        </button>
                        <button
                          onClick={() => handleConfirm(slot.id)}
                          disabled={isConfirming}
                          className="px-3 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                          data-testid={`confirm-slot-${slot.id}`}
                        >
                          {isConfirming ? '確定中...' : '確定する'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    // Normal card view
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-green-700">
                          {formatDateTime(slot.start_at)} - {formatDateTime(slot.end_at).split(' ')[1]}
                        </p>
                        <p className="text-xs text-green-600 mt-0.5">
                          全員参加可能
                        </p>
                      </div>
                      <button
                        onClick={() => setConfirmingSlotId(slot.id)}
                        className="px-3 py-1.5 text-xs font-medium bg-white border border-green-300 text-green-700 rounded-lg hover:bg-green-50"
                        data-testid={`select-confirm-${slot.id}`}
                      >
                        この日で確定
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Non-confirmable slots */}
        {isOpen && nonConfirmableSlots.length > 0 && confirmableSlots.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-xs font-medium text-gray-400">確定不可</h4>
            {nonConfirmableSlots.map((slot) => {
              const summary = getSlotSummary(slot.id)
              return (
                <div key={slot.id} className="text-xs text-gray-400 flex items-center gap-2">
                  <span>✕</span>
                  <span>
                    {formatDateTime(slot.start_at)} - {formatDateTime(slot.end_at).split(' ')[1]}
                  </span>
                  {summary.unavailable > 0 && (
                    <span>({summary.unavailable}名参加不可)</span>
                  )}
                  {summary.pending > 0 && (
                    <span>({summary.pending}名未回答)</span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Help text */}
        {isOpen && (
          <div className="text-xs text-gray-400 space-y-1 pt-2 border-t border-gray-100">
            <p>
              全員が「参加可能」か「欠席OK」で回答すると確定できます
            </p>
            <p>
              初期値は「欠席OK」です。参加できる日は「参加可能」に変更してください
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
