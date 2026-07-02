'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { TaskEvent } from '@/types/database'

interface UseTaskEventsReturn {
  events: TaskEvent[]
  loading: boolean
  error: Error | null
  refresh: () => Promise<void>
}

/**
 * Fetch the audit trail (task_events) for a task, newest first.
 * This is the readable "言った言わない防止" timeline surfaced in the Inspector.
 */
export function useTaskEvents(taskId: string | null): UseTaskEventsReturn {
  const [events, setEvents] = useState<TaskEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (supabaseRef.current == null) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  const fetchEvents = useCallback(async () => {
    if (!taskId) {
      setEvents([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('task_events')
        .select('*')
        .eq('task_id' as never, taskId as never)
        .order('created_at', { ascending: false })

      if (fetchError) throw fetchError
      setEvents((data || []) as TaskEvent[])
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Failed to fetch task events'))
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [taskId, supabase])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  return { events, loading, error, refresh: fetchEvents }
}
