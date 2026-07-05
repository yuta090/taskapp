'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'

export type LatestClientAction = 'approved' | 'changes_requested' | null

/**
 * Derives "what did the client last do on this task" purely from the
 * existing audit_logs data (no schema change, H-1): the portal approve /
 * request_changes actions already write 'approval.approved' /
 * 'approval.changes_requested' audit events. Surfacing the most recent one
 * lets the internal Inspector show "client requested changes" without a new
 * column.
 */
export function useLatestClientAction(taskId: string | null): LatestClientAction {
  const [action, setAction] = useState<LatestClientAction>(null)

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const fetchLatestAction = useCallback(async () => {
    if (!taskId) {
      setAction(null)
      return
    }

    const { data, error } = await (supabase as SupabaseClient)
      .from('audit_logs')
      .select('event_type')
      .eq('target_id', taskId)
      .eq('target_type', 'task')
      .in('event_type', ['approval.approved', 'approval.changes_requested'])
      .order('occurred_at', { ascending: false })
      .limit(1)

    if (error || !data || data.length === 0) {
      setAction(null)
      return
    }

    setAction(data[0].event_type === 'approval.changes_requested' ? 'changes_requested' : 'approved')
  }, [taskId, supabase])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount/taskId-change, same pattern as useTaskEvents
    fetchLatestAction()
  }, [fetchLatestAction])

  return action
}
