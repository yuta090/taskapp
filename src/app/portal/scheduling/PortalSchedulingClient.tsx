'use client'

import { useState, useEffect, useCallback } from 'react'
import { Calendar, ArrowRight, CheckCircle, Clock } from 'lucide-react'
import { PortalShell } from '@/components/portal/PortalShell'
import { PortalSlotResponseForm } from '@/components/portal/scheduling/PortalSlotResponseForm'
import type { SlotResponseType } from '@/types/database'

interface Project {
  id: string
  name: string
  orgId: string
  orgName: string
}

interface PortalSchedulingClientProps {
  currentProject: Project
  projects: Project[]
  actionCount: number
  userId: string
}

interface PortalProposal {
  id: string
  title: string
  status: string
  description: string | null
  duration_minutes: number
  expires_at: string | null
  created_at: string
  proposal_slots: Array<{
    id: string
    start_at: string
    end_at: string
    slot_order: number
  }>
  myRespondentId: string | null
  hasResponded: boolean
  answeredSlots: number
  totalSlots: number
}

export function PortalSchedulingClient({
  currentProject,
  projects,
  actionCount,
  userId,
}: PortalSchedulingClientProps) {
  const [proposals, setProposals] = useState<PortalProposal[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null)

  const fetchProposals = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/portal/scheduling/proposals?spaceId=${currentProject.id}`
      )
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setProposals(data.proposals || [])
    } catch (err) {
      console.error('Portal scheduling fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [currentProject.id])

  useEffect(() => {
    void fetchProposals()
  }, [fetchProposals])

  const selectedProposal = selectedProposalId
    ? proposals.find((p) => p.id === selectedProposalId) || null
    : null

  const handleSubmitResponses = useCallback(
    async (
      proposalId: string,
      responses: { slotId: string; response: SlotResponseType }[]
    ) => {
      const res = await fetch('/api/portal/scheduling/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId, responses }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to submit')
      }
      // Refresh
      await fetchProposals()
    },
    [fetchProposals]
  )

  // Build inspector for selected proposal
  const inspector = selectedProposal ? (
    <PortalSlotResponseForm
      proposal={selectedProposal}
      onClose={() => setSelectedProposalId(null)}
      onSubmit={handleSubmitResponses}
    />
  ) : null

  return (
    <PortalShell
      currentProject={currentProject}
      projects={projects}
      actionCount={actionCount}
      inspector={inspector}
    >
      <div className="p-6">
        <h1 className="text-lg font-semibold text-gray-900 mb-4">日程調整</h1>

        {loading && (
          <div className="text-center text-gray-400 py-16">読み込み中...</div>
        )}

        {!loading && proposals.length === 0 && (
          <div className="text-center text-gray-400 py-20">
            <Calendar className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="text-sm">日程調整はありません</p>
          </div>
        )}

        {!loading && proposals.length > 0 && (
          <div className="space-y-3">
            {proposals.map((proposal) => (
              <PortalProposalCard
                key={proposal.id}
                proposal={proposal}
                isSelected={proposal.id === selectedProposalId}
                onClick={() => setSelectedProposalId(proposal.id)}
              />
            ))}
          </div>
        )}
      </div>
    </PortalShell>
  )
}

// Inline card component for portal proposals
function PortalProposalCard({
  proposal,
  isSelected,
  onClick,
}: {
  proposal: PortalProposal
  isSelected: boolean
  onClick: () => void
}) {
  const isOpen = proposal.status === 'open'
  const isConfirmed = proposal.status === 'confirmed'
  const needsResponse = isOpen && !proposal.hasResponded

  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-xl border p-4 cursor-pointer transition-colors ${
        isSelected
          ? 'border-blue-300 shadow-sm'
          : needsResponse
          ? 'border-amber-200 hover:border-amber-300'
          : 'border-gray-200 hover:border-gray-300'
      }`}
      data-testid={`portal-proposal-${proposal.id}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <h3 className="text-sm font-medium text-gray-900 truncate">
              {proposal.title}
            </h3>
          </div>

          <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
            <span>候補: {proposal.totalSlots}日程</span>
            {proposal.expires_at && (
              <span className="flex items-center gap-0.5">
                <Clock className="w-3 h-3" />
                期限: {formatShortDate(proposal.expires_at)}
              </span>
            )}
          </div>

          {isConfirmed && (
            <div className="mt-2 flex items-center gap-1.5 text-sm text-green-600">
              <CheckCircle className="w-4 h-4" />
              確定済み
            </div>
          )}
        </div>

        <div className="flex-shrink-0 ml-3">
          {needsResponse ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full">
              回答してください
              <ArrowRight className="w-3 h-3" />
            </span>
          ) : isOpen && proposal.hasResponded ? (
            <span className="inline-flex items-center px-2.5 py-1 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-full">
              回答済み
            </span>
          ) : isConfirmed ? (
            <span className="inline-flex items-center px-2.5 py-1 text-xs text-green-600 bg-green-50 border border-green-200 rounded-full">
              確定
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
