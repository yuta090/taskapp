'use client'

import { useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'

/**
 * 配達ログ（sink_deliveries）の取得（GET /api/integrations/deliveries）と
 * 個別再送（POST /api/integrations/deliveries/[id]/redeliver）。
 * docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §4: 直近N件のページング。
 * 「もっと見る」でlimitを増やして再取得する単純なページングを採用する
 * （カーソル管理を持ち込まず、ログの規模(既定上限200件)に対して十分単純）。
 */

export interface DeliveryLogEntry {
  id: string
  sinkId: string
  digestTaskId: string | null
  eventType: string
  eventKey: string
  status: 'queued' | 'sent' | 'failed' | 'dead'
  attempts: number
  nextAttemptAt: string
  lastError: string | null
  responseStatus: number | null
  createdAt: string
  deliveredAt: string | null
}

interface DeliveriesResponse {
  deliveries: DeliveryLogEntry[]
}

/**
 * sinkId が null の間（未選択）は取得しない。
 * limitが増えるたびキャッシュキーが変わり、フルリフェッチする素朴な「もっと見る」。
 */
export function useSinkDeliveries(orgId: string, sinkId: string | null, limit = 30) {
  const queryKey = useMemo(
    () => ['sinkDeliveries', orgId, sinkId, limit] as const,
    [orgId, sinkId, limit],
  )

  const { data, isLoading, error, refetch } = useQuery<DeliveriesResponse>({
    queryKey,
    queryFn: async (): Promise<DeliveriesResponse> => {
      const params = new URLSearchParams({ orgId, limit: String(limit) })
      if (sinkId) params.set('sinkId', sinkId)
      const response = await fetch(`/api/integrations/deliveries?${params.toString()}`)
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? '配達ログの取得に失敗しました')
      return json as DeliveriesResponse
    },
    enabled: !!orgId && !!sinkId,
    staleTime: 10_000,
  })

  return {
    deliveries: data?.deliveries ?? [],
    isLoading,
    error: error instanceof Error ? error.message : null,
    refetch,
  }
}

/** dead/failed → queued へのリセット（1件）。409は「再送対象でない」の意味 */
export function useRedeliverDelivery() {
  return useMutation({
    mutationFn: async (deliveryId: string): Promise<{ ok: true }> => {
      const response = await fetch(`/api/integrations/deliveries/${deliveryId}/redeliver`, {
        method: 'POST',
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error ?? '再送に失敗しました')
      return json as { ok: true }
    },
  })
}
