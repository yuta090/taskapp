'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowsClockwise } from '@phosphor-icons/react'
import { useSinkDeliveries, useRedeliverDelivery } from '@/lib/hooks/useSinkDeliveries'
import { useRedeliverSink } from '@/lib/hooks/useSinks'
import { DeliveryStatusPill } from '@/components/secretary/integrations/statusPill'

interface DeliveryLogListProps {
  orgId: string
  sinkId: string
  canManage: boolean
}

const PAGE_SIZE = 30
const REDELIVERABLE_STATUSES = new Set(['dead', 'failed'])

/**
 * 配達ログ（直近N件・もっと見る）＋個別/一括再送。
 * docs/spec/AI_SECRETARY_STAGE3_INTEGRATIONS.md §4。
 */
export function DeliveryLogList({ orgId, sinkId, canManage }: DeliveryLogListProps) {
  const [limit, setLimit] = useState(PAGE_SIZE)
  const { deliveries, isLoading, refetch } = useSinkDeliveries(orgId, sinkId, limit)
  const redeliverDelivery = useRedeliverDelivery()
  const redeliverSink = useRedeliverSink()

  const handleRedeliverOne = async (deliveryId: string) => {
    try {
      await redeliverDelivery.mutateAsync(deliveryId)
      await refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '再送に失敗しました')
    }
  }

  const handleRedeliverBulk = async () => {
    try {
      const result = await redeliverSink.mutateAsync({ orgId, sinkId })
      toast.success(`${result.count}件を再送キューに戻しました`)
      await refetch()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '一括再送に失敗しました')
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">配達ログ</span>
        {canManage && (
          <button
            type="button"
            onClick={() => void handleRedeliverBulk()}
            disabled={redeliverSink.isPending}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 disabled:opacity-50 transition-colors"
          >
            <ArrowsClockwise className="w-3.5 h-3.5" />
            まとめて再送(dead/failed)
          </button>
        )}
      </div>

      {deliveries.length === 0 && !isLoading ? (
        <p className="text-xs text-gray-400 py-4 text-center">配達履歴がありません</p>
      ) : (
        <div className="space-y-1">
          {deliveries.map((delivery) => (
            <div
              key={delivery.id}
              data-testid={`delivery-row-${delivery.id}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded border border-gray-100 text-xs"
            >
              <DeliveryStatusPill status={delivery.status} />
              <span className="text-gray-700 font-mono">{delivery.eventType}</span>
              <span className="text-gray-400">
                {new Date(delivery.createdAt).toLocaleString('ja-JP', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              {delivery.lastError && (
                <span className="text-red-600 truncate flex-1 min-w-0" title={delivery.lastError}>
                  {delivery.lastError}
                </span>
              )}
              <span className="ml-auto flex-shrink-0">
                {canManage && REDELIVERABLE_STATUSES.has(delivery.status) && (
                  <button
                    type="button"
                    onClick={() => void handleRedeliverOne(delivery.id)}
                    disabled={redeliverDelivery.isPending}
                    className="text-indigo-600 hover:text-indigo-800 disabled:opacity-50 transition-colors"
                  >
                    再送
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {deliveries.length >= limit && (
        <button
          type="button"
          onClick={() => setLimit((prev) => prev + PAGE_SIZE)}
          className="mt-2 w-full text-xs text-gray-500 hover:text-gray-700 py-1.5 transition-colors"
        >
          もっと見る
        </button>
      )}
    </div>
  )
}
