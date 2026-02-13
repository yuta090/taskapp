'use client'

import { CalendarBlank } from '@phosphor-icons/react'
import { ProposalStatusBadge } from './ProposalStatusBadge'
import type { ProposalWithDetails } from '@/lib/hooks/useSchedulingProposals'

interface ProposalRowProps {
  proposal: ProposalWithDetails
  isSelected: boolean
  onClick: () => void
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

export function ProposalRow({ proposal, isSelected, onClick }: ProposalRowProps) {
  const slotsCount = proposal.proposal_slots?.length || 0
  const firstSlot = proposal.proposal_slots?.[0]
  const respondentCount = proposal.respondentCount || 0
  const responseCount = proposal.responseCount || 0

  return (
    <div
      className={`row-h flex items-center gap-3 px-4 border-b border-gray-100 cursor-pointer transition-colors ${
        isSelected
          ? 'bg-blue-50 border-l-2 border-l-blue-500'
          : 'hover:bg-gray-50 border-l-2 border-l-transparent'
      }`}
      onClick={onClick}
      data-testid={`proposal-row-${proposal.id}`}
    >
      <div className="flex-shrink-0 text-gray-400">
        <CalendarBlank className="w-4 h-4" />
      </div>

      <div className="flex-1 min-w-0 flex items-center gap-3">
        <span className="truncate text-sm text-gray-900 font-medium">
          {proposal.title}
        </span>
        {firstSlot && (
          <span className="flex-shrink-0 text-xs text-gray-400">
            {formatShortDate(firstSlot.start_at)}
            {slotsCount > 1 && ` 他${slotsCount - 1}件`}
          </span>
        )}
      </div>

      <div className="flex-shrink-0 flex items-center gap-2">
        <span className="text-xs text-gray-400">
          {responseCount}/{respondentCount}回答
        </span>
        <ProposalStatusBadge status={proposal.status} />
      </div>
    </div>
  )
}
