'use client'

import { useState, useCallback, useRef } from 'react'
import type { BurndownData } from '@/lib/burndown/computeBurndown'

interface UseBurndownOptions {
  spaceId: string
  milestoneId: string | null
}

interface UseBurndownReturn {
  data: BurndownData | null
  loading: boolean
  error: Error | null
  refetch: () => Promise<void>
}

export function useBurndown({
  spaceId,
  milestoneId,
}: UseBurndownOptions): UseBurndownReturn {
  const [data, setData] = useState<BurndownData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const fetchIdRef = useRef(0)

  const refetch = useCallback(async () => {
    const currentFetchId = ++fetchIdRef.current
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ spaceId })
      if (milestoneId) params.set('milestoneId', milestoneId)
      const res = await fetch(`/api/burndown?${params.toString()}`)

      if (currentFetchId !== fetchIdRef.current) return

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }))
        throw new Error(body.error || `HTTP ${res.status}`)
      }

      const json = await res.json()
      setData(json as BurndownData)
    } catch (err) {
      if (currentFetchId !== fetchIdRef.current) return
      setError(err instanceof Error ? err : new Error('Failed to fetch burndown data'))
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setLoading(false)
      }
    }
  }, [spaceId, milestoneId])

  return { data, loading, error, refetch }
}
