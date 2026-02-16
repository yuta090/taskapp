'use client'

import { useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
  const queryClient = useQueryClient()

  const queryKey = useMemo(() => ['burndown', spaceId, milestoneId] as const, [spaceId, milestoneId])

  const { data, isLoading, error: queryError } = useQuery<BurndownData>({
    queryKey,
    queryFn: async (): Promise<BurndownData> => {
      const params = new URLSearchParams({ spaceId })
      if (milestoneId) params.set('milestoneId', milestoneId)
      const res = await fetch(`/api/burndown?${params.toString()}`)

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }))
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`)
      }

      return (await res.json()) as BurndownData
    },
    staleTime: 30_000,
    enabled: !!milestoneId,
  })

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey })
  }, [queryClient, queryKey])

  return {
    data: data ?? null,
    loading: isLoading,
    error: queryError instanceof Error ? queryError : null,
    refetch,
  }
}
