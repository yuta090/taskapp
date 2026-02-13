'use client'

import { CheckCircle, Warning, WarningCircle } from '@phosphor-icons/react'

export type HealthStatus = 'on_track' | 'at_risk' | 'needs_attention'

interface HealthBadgeProps {
  status: HealthStatus
  size?: 'sm' | 'md' | 'lg'
}

const statusConfig = {
  on_track: {
    label: '順調',
    bgColor: 'bg-emerald-50',
    textColor: 'text-emerald-700',
    icon: CheckCircle,
  },
  at_risk: {
    label: '注意',
    bgColor: 'bg-amber-50',
    textColor: 'text-amber-700',
    icon: Warning,
  },
  needs_attention: {
    label: '要対応',
    bgColor: 'bg-red-50',
    textColor: 'text-red-700',
    icon: WarningCircle,
  },
}

const sizeConfig = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-sm',
  lg: 'px-3 py-1.5 text-sm',
}

export function HealthBadge({ status, size = 'md' }: HealthBadgeProps) {
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <span
      className={`
        inline-flex items-center gap-1.5 font-medium rounded-full
        ${config.bgColor} ${config.textColor} ${sizeConfig[size]}
      `}
    >
      <Icon weight="fill" className="w-4 h-4" />
      {config.label}
    </span>
  )
}
