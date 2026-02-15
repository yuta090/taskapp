'use client'

import { useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { findSimilarTasks, type EstimationResult } from '@/lib/estimation/findSimilarTasks'

interface UseEstimationAssistOptions {
  spaceId: string
  orgId: string
}

interface UseEstimationAssistReturn {
  result: EstimationResult | null
  loading: boolean
  search: (title: string) => void
  clear: () => void
}

export function useEstimationAssist({
  spaceId,
  orgId,
}: UseEstimationAssistOptions): UseEstimationAssistReturn {
  const [result, setResult] = useState<EstimationResult | null>(null)
  const [loading, setLoading] = useState(false)

  // Supabase client - useRef pattern
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null)
  if (!supabaseRef.current) supabaseRef.current = createClient()
  const supabase = supabaseRef.current

  // Debounce timer ref
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback(
    (title: string) => {
      // Clear previous timer
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }

      // Skip if title too short
      if (!title || title.trim().length < 2) {
        setResult(null)
        return
      }

      // Debounce 500ms
      timerRef.current = setTimeout(async () => {
        setLoading(true)
        try {
          const res = await findSimilarTasks(supabase, {
            title: title.trim(),
            spaceId,
            orgId,
          })
          setResult(res.similarTasks.length > 0 ? res : null)
        } catch (err) {
          console.error('Estimation assist error:', err)
          setResult(null)
        } finally {
          setLoading(false)
        }
      }, 500)
    },
    [supabase, spaceId, orgId]
  )

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    setResult(null)
  }, [])

  return { result, loading, search, clear }
}
