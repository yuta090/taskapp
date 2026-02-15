'use client'

import { useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SlotResponseType } from '@/types/database'

interface UseProposalResponsesOptions {
  proposalId: string | null
}

export interface SlotResponseWithUser {
  id: string
  slotId: string
  respondentId: string
  userId: string
  displayName: string
  side: string
  response: SlotResponseType
  respondedAt: string
}

export interface ProposalRespondentWithProfile {
  id: string
  userId: string
  side: 'client' | 'internal'
  isRequired: boolean
  displayName: string
  avatarUrl: string | null
}

interface SlotSummary {
  available: number
  proceed: number
  unavailable: number
  pending: number
}

interface UseProposalResponsesReturn {
  responsesBySlot: Record<string, SlotResponseWithUser[]>
  respondents: ProposalRespondentWithProfile[]
  myRespondentId: string | null
  loading: boolean
  error: Error | null
  fetchResponses: () => Promise<void>
  submitResponses: (responses: { slotId: string; response: SlotResponseType }[]) => Promise<void>
  isSlotConfirmable: (slotId: string) => boolean
  getSlotSummary: (slotId: string) => SlotSummary
}

export function useProposalResponses({
  proposalId,
}: UseProposalResponsesOptions): UseProposalResponsesReturn {
  const [responsesBySlot, setResponsesBySlot] = useState<Record<string, SlotResponseWithUser[]>>({})
  const [respondents, setRespondents] = useState<ProposalRespondentWithProfile[]>([])
  const [myRespondentId, setMyRespondentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const fetchResponses = useCallback(async () => {
    if (!proposalId) return

    setLoading(true)
    setError(null)

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()

      const response = await fetch(`/api/scheduling/proposals/${proposalId}`)
      if (!response.ok) {
        throw new Error('Failed to fetch proposal responses')
      }

      const data = await response.json()
      const proposal = data.proposal

      // Build respondents list
      const respondentsList: ProposalRespondentWithProfile[] = (
        proposal.proposal_respondents || []
      ).map((r: { id: string; user_id: string; side: string; is_required: boolean; displayName?: string; display_name?: string; avatarUrl?: string; avatar_url?: string | null }) => ({
        id: r.id,
        userId: r.user_id,
        side: r.side,
        isRequired: r.is_required,
        displayName: r.displayName || r.display_name || '',
        avatarUrl: r.avatarUrl || r.avatar_url || null,
      }))

      setRespondents(respondentsList)

      // Find my respondent id
      if (user) {
        const myResp = respondentsList.find((r) => r.userId === user.id)
        setMyRespondentId(myResp?.id || null)
      }

      // Build responses by slot
      const bySlot: Record<string, SlotResponseWithUser[]> = {}
      for (const slot of proposal.proposal_slots || []) {
        bySlot[slot.id] = (slot.responses || slot.slot_responses || []).map((sr: { id: string; slot_id: string; respondent_id: string; userId?: string; user_id?: string; displayName?: string; display_name?: string; side?: string; response: string; responded_at: string }) => ({
          id: sr.id,
          slotId: sr.slot_id,
          respondentId: sr.respondent_id,
          userId: sr.userId || sr.user_id || '',
          displayName: sr.displayName || sr.display_name || '',
          side: sr.side || '',
          response: sr.response as SlotResponseType,
          respondedAt: sr.responded_at,
        }))
      }
      setResponsesBySlot(bySlot)
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch responses'))
    } finally {
      setLoading(false)
    }
  }, [proposalId, supabase])

  const submitResponses = useCallback(
    async (responses: { slotId: string; response: SlotResponseType }[]) => {
      if (!proposalId) throw new Error('No proposal selected')

      try {
        const res = await fetch('/api/scheduling/responses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposalId,
            responses,
          }),
        })

        if (!res.ok) {
          const errorData = await res.json()
          throw new Error(errorData.error || 'Failed to submit responses')
        }

        // Refresh responses
        await fetchResponses()
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to submit responses'))
        throw err
      }
    },
    [proposalId, fetchResponses]
  )

  const getSlotSummary = useCallback(
    (slotId: string): SlotSummary => {
      const slotResponses = responsesBySlot[slotId] || []
      const requiredRespondents = respondents.filter((r) => r.isRequired)
      const requiredCount = requiredRespondents.length

      let available = 0
      let proceed = 0
      let unavailable = 0

      for (const sr of slotResponses) {
        const resp = respondents.find((r) => r.id === sr.respondentId)
        if (!resp?.isRequired) continue

        switch (sr.response) {
          case 'available':
            available++
            break
          case 'unavailable_but_proceed':
            proceed++
            break
          case 'unavailable':
            unavailable++
            break
        }
      }

      const answered = available + proceed + unavailable
      const pending = requiredCount - answered

      return { available, proceed, unavailable, pending }
    },
    [responsesBySlot, respondents]
  )

  const isSlotConfirmable = useCallback(
    (slotId: string): boolean => {
      const summary = getSlotSummary(slotId)
      // Confirmable if no one is unavailable and no required respondents are pending
      return summary.unavailable === 0 && summary.pending === 0
    },
    [getSlotSummary]
  )

  return {
    responsesBySlot,
    respondents,
    myRespondentId,
    loading,
    error,
    fetchResponses,
    submitResponses,
    isSlotConfirmable,
    getSlotSummary,
  }
}
