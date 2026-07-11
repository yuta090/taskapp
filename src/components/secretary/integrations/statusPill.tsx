import type { SinkStatus } from '@/lib/hooks/useSinks'
import type { DeliveryLogEntry } from '@/lib/hooks/useSinkDeliveries'

/**
 * sink/delivery status のバッジ色。TaskAppのステータス色規約(taskapp-design-system skill)は
 * task用(backlog/todo/in_progress/...)のため、この画面固有の状態には別途ここで一元管理する
 * （コンポーネント内で個別に色を定義しない）。amberはクライアント可視要素専用のため使わない
 * （このコンソールはクライアントに到達しない内部専用画面）。
 */

const SINK_STATUS_LABEL: Record<SinkStatus, string> = {
  active: '有効',
  disabled: '無効',
  error: 'エラー',
}
const SINK_STATUS_CLASS: Record<SinkStatus, string> = {
  active: 'bg-green-50 text-green-700',
  disabled: 'bg-gray-100 text-gray-500',
  error: 'bg-red-50 text-red-600',
}

export function SinkStatusPill({ status }: { status: SinkStatus }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${SINK_STATUS_CLASS[status]}`}>
      {SINK_STATUS_LABEL[status]}
    </span>
  )
}

const DELIVERY_STATUS_LABEL: Record<DeliveryLogEntry['status'], string> = {
  queued: '待機中',
  sent: '成功',
  failed: '再試行中',
  dead: '失敗(停止)',
}
const DELIVERY_STATUS_CLASS: Record<DeliveryLogEntry['status'], string> = {
  queued: 'bg-gray-100 text-gray-500',
  sent: 'bg-green-50 text-green-700',
  failed: 'bg-blue-50 text-blue-600',
  dead: 'bg-red-50 text-red-600',
}

export function DeliveryStatusPill({ status }: { status: DeliveryLogEntry['status'] }) {
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${DELIVERY_STATUS_CLASS[status]}`}>
      {DELIVERY_STATUS_LABEL[status]}
    </span>
  )
}
