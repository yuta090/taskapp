'use client'

import { useState, useCallback, useRef } from 'react'
import type {
  SchedulingProposal,
  ProposalSlot,
  ProposalRespondent,
  SlotResponseType,
} from '@/types/database'

interface UseSchedulingProposalsOptions {
  orgId: string
  spaceId: string
}

export interface CreateProposalInput {
  title: string
  description?: string
  durationMinutes: number
  slots: Array<{ startAt: string; endAt: string }>
  respondents: Array<{
    userId: string
    side: 'client' | 'internal'
    isRequired?: boolean
  }>
  expiresAt?: string
  videoProvider?: 'google_meet' | 'zoom' | 'teams'
}

export interface ProposalWithDetails extends SchedulingProposal {
  proposal_slots: ProposalSlot[]
  proposal_respondents: ProposalRespondent[]
  respondentCount: number
  responseCount: number
}

export interface ProposalDetail extends SchedulingProposal {
  proposal_slots: Array<ProposalSlot & {
    slot_responses: Array<{
      id: string
      slot_id: string
      respondent_id: string
      response: SlotResponseType
      responded_at: string
    }>
    responses: Array<{
      id: string
      slot_id: string
      respondent_id: string
      response: SlotResponseType
      responded_at: string
      userId: string
      displayName: string
      side: string
    }>
  }>
  proposal_respondents: Array<ProposalRespondent & {
    displayName: string
    avatarUrl: string | null
  }>
}

interface UseSchedulingProposalsReturn {
  proposals: ProposalWithDetails[]
  loading: boolean
  error: Error | null
  fetchProposals: () => Promise<void>
  fetchProposalDetail: (id: string) => Promise<ProposalDetail | null>
  createProposal: (input: CreateProposalInput) => Promise<SchedulingProposal>
  cancelProposal: (id: string) => Promise<void>
  confirmSlot: (proposalId: string, slotId: string) => Promise<{ meetingId: string }>
}

export function useSchedulingProposals({
  spaceId,
}: UseSchedulingProposalsOptions): UseSchedulingProposalsReturn {
  const [proposals, setProposals] = useState<ProposalWithDetails[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const fetchIdRef = useRef(0)

  const fetchProposals = useCallback(async () => {
    const currentFetchId = ++fetchIdRef.current
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/scheduling/proposals?spaceId=${spaceId}`
      )
      if (!response.ok) {
        throw new Error('Failed to fetch proposals')
      }
      const data = await response.json()

      if (currentFetchId !== fetchIdRef.current) return

      // Client-side expiration detection: mark expired proposals
      const now = new Date()
      const proposalsWithExpiry = (data.proposals || []).map((p: ProposalWithDetails) => {
        if (p.status === 'open' && p.expires_at && new Date(p.expires_at) < now) {
          return { ...p, status: 'expired' as const }
        }
        return p
      })

      setProposals(proposalsWithExpiry)
    } catch (err) {
      if (currentFetchId !== fetchIdRef.current) return
      setError(err instanceof Error ? err : new Error('Failed to fetch proposals'))
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setLoading(false)
      }
    }
  }, [spaceId])

  const fetchProposalDetail = useCallback(
    async (id: string): Promise<ProposalDetail | null> => {
      try {
        const response = await fetch(`/api/scheduling/proposals/${id}`)
        if (!response.ok) {
          let errorMessage = 'Failed to fetch proposal detail'
          try {
            const errorData = await response.json()
            errorMessage = errorData.error || errorMessage
          } catch {
            // Response body is not JSON
          }
          throw new Error(errorMessage)
        }
        const data = await response.json()
        return data.proposal || null
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to fetch proposal detail'))
        return null
      }
    },
    []
  )

  const createProposal = useCallback(
    async (input: CreateProposalInput): Promise<SchedulingProposal> => {
      try {
        const response = await fetch('/api/scheduling/proposals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spaceId,
            title: input.title,
            description: input.description,
            durationMinutes: input.durationMinutes,
            slots: input.slots,
            respondents: input.respondents,
            expiresAt: input.expiresAt,
            videoProvider: input.videoProvider,
          }),
        })

        if (!response.ok) {
          let errorMessage = 'Failed to create proposal'
          try {
            const errorData = await response.json()
            errorMessage = errorData.error || errorMessage
          } catch {
            // Response body is not JSON (e.g. Next.js error page)
          }
          throw new Error(errorMessage)
        }

        const data = await response.json()
        const created = data.proposal

        // Optimistic update: add to list
        // API returns `slots`/`respondents` but list expects `proposal_slots`/`proposal_respondents`
        setProposals((prev) => [{
          ...created,
          proposal_slots: created.slots || created.proposal_slots || [],
          proposal_respondents: created.respondents || created.proposal_respondents || [],
          respondentCount: (created.respondents || created.proposal_respondents || []).length,
          responseCount: 0,
        }, ...prev])

        return created
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to create proposal'))
        throw err
      }
    },
    [spaceId]
  )

  const cancelProposal = useCallback(
    async (id: string) => {
      // Optimistic update
      setProposals((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, status: 'cancelled' as const } : p
        )
      )

      try {
        const response = await fetch(`/api/scheduling/proposals/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'cancelled' }),
        })

        if (!response.ok) {
          throw new Error('Failed to cancel proposal')
        }
      } catch (err) {
        // Revert on error
        await fetchProposals()
        setError(err instanceof Error ? err : new Error('Failed to cancel proposal'))
        throw err
      }
    },
    [fetchProposals]
  )

  const confirmSlot = useCallback(
    async (proposalId: string, slotId: string): Promise<{ meetingId: string }> => {
      try {
        const response = await fetch(
          `/api/scheduling/proposals/${proposalId}/confirm`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slotId }),
          }
        )

        if (!response.ok) {
          let errorMessage = 'Failed to confirm slot'
          try {
            const errorData = await response.json()
            errorMessage = errorData.error || errorMessage
          } catch {
            // Response body is not JSON
          }
          throw new Error(errorMessage)
        }

        const data = await response.json()

        // Optimistic update
        setProposals((prev) =>
          prev.map((p) =>
            p.id === proposalId
              ? { ...p, status: 'confirmed' as const, confirmed_slot_id: slotId }
              : p
          )
        )

        return { meetingId: data.meetingId }
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to confirm slot'))
        throw err
      }
    },
    []
  )

  return {
    proposals,
    loading,
    error,
    fetchProposals,
    fetchProposalDetail,
    createProposal,
    cancelProposal,
    confirmSlot,
  }
}
