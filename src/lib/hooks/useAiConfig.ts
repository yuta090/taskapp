'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export interface AiConfig {
  id: string
  orgId: string
  provider: 'openai' | 'anthropic'
  model: string
  enabled: boolean
  keyPrefix: string
  createdAt: string
  updatedAt: string
}

/**
 * 組織のAI設定を取得
 */
export function useAiConfig(orgId: string | undefined) {
  return useQuery({
    queryKey: ['ai-config', orgId],
    queryFn: async () => {
      if (!orgId) return null

      const res = await fetch(`/api/ai-config?orgId=${orgId}`)
      if (!res.ok) throw new Error('Failed to fetch AI config')
      const data = await res.json()
      return data.config as AiConfig | null
    },
    enabled: !!orgId,
  })
}

/**
 * AI設定を保存（upsert）
 */
export function useSaveAiConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: {
      orgId: string
      provider: string
      apiKey: string
      model?: string
    }) => {
      const res = await fetch('/api/ai-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to save AI config')
      }

      return res.json()
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['ai-config', variables.orgId],
      })
    },
  })
}

/**
 * AI設定を削除
 */
export function useDeleteAiConfig() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (orgId: string) => {
      const res = await fetch(`/api/ai-config?orgId=${orgId}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to delete AI config')
      }

      return res.json()
    },
    onSuccess: (_, orgId) => {
      queryClient.invalidateQueries({
        queryKey: ['ai-config', orgId],
      })
    },
  })
}
