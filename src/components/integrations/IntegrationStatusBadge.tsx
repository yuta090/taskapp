'use client'

import type { ConnectionStatus } from '@/lib/integrations/types'

interface IntegrationStatusBadgeProps {
  status: ConnectionStatus | 'disconnected'
  className?: string
}

const STATUS_MAP: Record<
  ConnectionStatus | 'disconnected',
  { label: string; bg: string; text: string; dot: string }
> = {
  active: {
    label: '接続済み',
    bg: 'bg-green-50',
    text: 'text-green-700',
    dot: 'bg-green-500',
  },
  expired: {
    label: '期限切れ',
    bg: 'bg-red-50',
    text: 'text-red-700',
    dot: 'bg-red-500',
  },
  revoked: {
    label: '無効',
    bg: 'bg-red-50',
    text: 'text-red-700',
    dot: 'bg-red-500',
  },
  disconnected: {
    label: '未接続',
    bg: 'bg-gray-50',
    text: 'text-gray-600',
    dot: 'bg-gray-400',
  },
}

export function IntegrationStatusBadge({
  status,
  className = '',
}: IntegrationStatusBadgeProps) {
  const config = STATUS_MAP[status] ?? STATUS_MAP.disconnected

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium rounded-full ${config.bg} ${config.text} ${className}`}
      data-testid="integration-status-badge"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {config.label}
    </span>
  )
}
