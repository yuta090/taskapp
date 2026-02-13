'use client'

import { useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { rpc } from '@/lib/supabase/rpc'
import type { Task, BallSide, EvidenceType } from '@/types/database'

interface UseConsideringOptions {
  spaceId: string
}

interface DecideParams {
  taskId: string
  decisionText: string
  onBehalfOf: BallSide
  evidence: EvidenceType
  clientConfirmedBy?: string
  meetingId?: string
}

interface UseConsideringReturn {
  consideringTasks: Task[]
  loading: boolean
  error: Error | null
  fetchConsidering: () => Promise<void>
  decideConsidering: (params: DecideParams) => Promise<void>
}

export function useConsidering({
  spaceId,
}: UseConsideringOptions): UseConsideringReturn {
  const [consideringTasks, setConsideringTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const fetchConsidering = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('tasks')
        .select('*')
        .eq('space_id' as never, spaceId as never)
        .eq('status' as never, 'considering' as never)
        .order('ball', { ascending: false }) // client first (AT-010)
        .order('created_at', { ascending: false })

      if (fetchError) throw fetchError
      setConsideringTasks((data || []) as Task[])
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to fetch considering tasks')
      )
    } finally {
      setLoading(false)
    }
  }, [spaceId, supabase])

  const decideConsidering = useCallback(
    async (params: DecideParams) => {
      // Validate: on_behalf_of='client' AND evidence!='meeting' requires client_confirmed_by
      // (AT-007)
      if (
        params.onBehalfOf === 'client' &&
        params.evidence !== 'meeting' &&
        !params.clientConfirmedBy
      ) {
        throw new Error(
          '会議外でクライアント確定する場合は「確認相手」を入力してください'
        )
      }

      // Decidedタスクはリストから消えるためオプティミスティック削除
      setConsideringTasks((prev) => prev.filter((t) => t.id !== params.taskId))

      try {
        await rpc.decideConsidering(supabase, {
          taskId: params.taskId,
          decisionText: params.decisionText,
          onBehalfOf: params.onBehalfOf,
          evidence: params.evidence,
          clientConfirmedBy: params.clientConfirmedBy,
          meetingId: params.meetingId,
        })
      } catch (err) {
        // エラー時のみ再取得
        await fetchConsidering()
        throw err
      }
    },
    [supabase, fetchConsidering]
  )

  return {
    consideringTasks,
    loading,
    error,
    fetchConsidering,
    decideConsidering,
  }
}
