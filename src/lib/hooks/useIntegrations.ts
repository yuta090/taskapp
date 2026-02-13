'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { IntegrationConnectionSafe, IntegrationProvider } from '@/lib/integrations/types'

interface UseIntegrationsReturn {
  connections: IntegrationConnectionSafe[]
  loading: boolean
  error: Error | null
  connectGoogle: () => void
  disconnect: (connectionId: string) => Promise<void>
  getConnection: (provider: IntegrationProvider) => IntegrationConnectionSafe | null
  isConnected: (provider: IntegrationProvider) => boolean
}

export function useIntegrations(orgId: string): UseIntegrationsReturn {
  const [connections, setConnections] = useState<IntegrationConnectionSafe[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const fetchIdRef = useRef(0)

  const fetchConnections = useCallback(async () => {
    if (!orgId) return

    const fetchId = ++fetchIdRef.current
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/integrations/status?orgId=${encodeURIComponent(orgId)}`)
      if (!res.ok) {
        throw new Error('接続情報の取得に失敗しました')
      }
      const data = await res.json()
      if (fetchId === fetchIdRef.current) {
        setConnections(data.connections ?? [])
      }
    } catch (err) {
      if (fetchId === fetchIdRef.current) {
        setError(err instanceof Error ? err : new Error('Unknown error'))
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false)
      }
    }
  }, [orgId])

  useEffect(() => {
    fetchConnections()
  }, [fetchConnections])

  const connectGoogle = useCallback(() => {
    window.location.href = `/api/integrations/auth/google_calendar?orgId=${encodeURIComponent(orgId)}`
  }, [orgId])

  const disconnect = useCallback(async (connectionId: string) => {
    // Optimistic update
    setConnections((prev) => prev.filter((c) => c.id !== connectionId))

    try {
      const res = await fetch(`/api/integrations/status?connectionId=${encodeURIComponent(connectionId)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        await fetchConnections()
        throw new Error('切断に失敗しました')
      }
    } catch (err) {
      setError(err instanceof Error ? err : new Error('Unknown error'))
      await fetchConnections()
    }
  }, [fetchConnections])

  const getConnection = useCallback(
    (provider: IntegrationProvider): IntegrationConnectionSafe | null => {
      return connections.find((c) => c.provider === provider && c.status === 'active') ?? null
    },
    [connections]
  )

  const isConnected = useCallback(
    (provider: IntegrationProvider): boolean => {
      return getConnection(provider) !== null
    },
    [getConnection]
  )

  return {
    connections,
    loading,
    error,
    connectGoogle,
    disconnect,
    getConnection,
    isConnected,
  }
}
