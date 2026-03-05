import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

interface IntegrationConfigResponse {
  id: string
  provider: string
  enabled: boolean
  maskedCredentials: Record<string, string>
  config: Record<string, unknown>
  updatedAt: string
}

interface SaveIntegrationParams {
  provider: string
  enabled: boolean
  credentials: Record<string, string>
  config?: Record<string, unknown>
}

const QUERY_KEY = ['admin', 'integrations']

export function useSystemIntegrations() {
  return useQuery<IntegrationConfigResponse[]>({
    queryKey: QUERY_KEY,
    queryFn: async () => {
      const res = await fetch('/api/admin/integrations')
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      return json.configs
    },
  })
}

export function useSaveSystemIntegration() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (params: SaveIntegrationParams) => {
      const res = await fetch('/api/admin/integrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error || 'Failed to save')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}

export function useDeleteSystemIntegration() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (provider: string) => {
      const res = await fetch(`/api/admin/integrations?provider=${provider}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const json = await res.json()
        throw new Error(json.error || 'Failed to delete')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEY })
    },
  })
}

/** Hook for non-admin users to check which integrations are enabled */
export function useIntegrationStatus() {
  return useQuery<Record<string, boolean>>({
    queryKey: ['integration-status'],
    queryFn: async () => {
      const res = await fetch('/api/system-config/status')
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json()
    },
    staleTime: 5 * 60 * 1000,
  })
}
