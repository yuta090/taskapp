'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { rpc } from '@/lib/supabase/rpc'
import type { Task, DecisionState } from '@/types/database'

interface UseSpecTasksOptions {
  spaceId: string
}

interface UseSpecTasksReturn {
  specTasks: Task[]
  loading: boolean
  error: Error | null
  fetchSpecTasks: () => Promise<void>
  setSpecState: (
    taskId: string,
    state: DecisionState,
    meetingId?: string
  ) => Promise<void>
}

export function useSpecTasks({
  spaceId,
}: UseSpecTasksOptions): UseSpecTasksReturn {
  const [specTasks, setSpecTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const supabase = createClient()

  const fetchSpecTasks = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const { data, error: fetchError } = await supabase
        .from('tasks')
        .select('*')
        .eq('space_id' as never, spaceId as never)
        .eq('type' as never, 'spec' as never)
        .order('decision_state', { ascending: true }) // considering → decided → implemented
        .order('created_at', { ascending: false })

      if (fetchError) throw fetchError
      setSpecTasks((data || []) as Task[])
    } catch (err) {
      setError(
        err instanceof Error ? err : new Error('Failed to fetch spec tasks')
      )
    } finally {
      setLoading(false)
    }
  }, [spaceId, supabase])

  const setSpecState = useCallback(
    async (taskId: string, state: DecisionState, meetingId?: string) => {
      // Validate: spec_path is required for decided/implemented (AT-009, AT-012)
      const task = specTasks.find((t) => t.id === taskId)
      if (!task) {
        throw new Error('Task not found')
      }

      if (state !== 'considering' && !task.spec_path) {
        throw new Error('仕様ファイルパス（spec_path）が設定されていません')
      }

      // Optimistic update
      setSpecTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, decision_state: state } : t
        )
      )

      try {
        await rpc.setSpecState(supabase, {
          taskId,
          decisionState: state,
          meetingId,
        })
        await fetchSpecTasks()
      } catch (err) {
        await fetchSpecTasks()
        throw err
      }
    },
    [supabase, fetchSpecTasks, specTasks]
  )

  return {
    specTasks,
    loading,
    error,
    fetchSpecTasks,
    setSpecState,
  }
}
