'use client'

import { useEffect, useRef, useMemo, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface UseRealtimeResponsesOptions {
  proposalId: string | null
  slotIds: string[]
  onResponseChange?: () => void
}

interface UseRealtimeResponsesReturn {
  isSubscribed: boolean
}

export function useRealtimeResponses({
  proposalId,
  slotIds,
  onResponseChange,
}: UseRealtimeResponsesOptions): UseRealtimeResponsesReturn {
  const supabase = useMemo(() => createClient(), [])
  const isSubscribedRef = useRef(false)
  const onChangeRef = useRef(onResponseChange)
  onChangeRef.current = onResponseChange

  // Stable string key for slotIds to avoid re-subscribing on every render
  const slotIdsKey = slotIds.join(',')

  useEffect(() => {
    if (!proposalId || slotIds.length === 0) {
      isSubscribedRef.current = false
      return
    }

    const filter = `slot_id=in.(${slotIdsKey})`

    const channel = supabase
      .channel(`proposal-${proposalId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'slot_responses',
          filter,
        },
        () => {
          onChangeRef.current?.()
        }
      )
      .subscribe((status) => {
        isSubscribedRef.current = status === 'SUBSCRIBED'
      })

    return () => {
      supabase.removeChannel(channel)
      isSubscribedRef.current = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId, slotIdsKey, supabase])

  return {
    isSubscribed: isSubscribedRef.current,
  }
}
