'use client'

import type { ProposalStatus } from '@/types/database'

interface ProposalStatusBadgeProps {
  status: ProposalStatus
}

const STATUS_CONFIG: Record<ProposalStatus, { label: string; className: string }> = {
  open: {
    label: '回答受付中',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  confirmed: {
    label: '確定',
    className: 'bg-green-50 text-green-700 border-green-200',
  },
  cancelled: {
    label: 'キャンセル',
    className: 'bg-gray-50 text-gray-500 border-gray-200',
  },
  expired: {
    label: '期限切れ',
    className: 'bg-red-50 text-red-600 border-red-200',
  },
}

export function ProposalStatusBadge({ status }: ProposalStatusBadgeProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.open
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${config.className}`}
      data-testid={`proposal-status-${status}`}
    >
      {config.label}
    </span>
  )
}
