'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
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
  // Request generation counter to prevent stale responses from overwriting newer ones
  const requestIdRef = useRef(0)

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

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
        const currentRequestId = ++requestIdRef.current
        setLoading(true)
        try {
          const res = await findSimilarTasks(supabase, {
            title: title.trim(),
            spaceId,
            orgId,
          })
          // Only update state if this is still the latest request (prevents race condition)
          if (currentRequestId === requestIdRef.current) {
            setResult(res.similarTasks.length > 0 ? res : null)
          }
        } catch (err) {
          console.error('Estimation assist error:', err)
          if (currentRequestId === requestIdRef.current) {
            setResult(null)
          }
        } finally {
          if (currentRequestId === requestIdRef.current) {
            setLoading(false)
          }
        }
      }, 500)
    },
    [supabase, spaceId, orgId]
  )

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    requestIdRef.current++
    setResult(null)
  }, [])

  return { result, loading, search, clear }
}
