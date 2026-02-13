'use client'

import { Warning, Calendar, Info } from '@phosphor-icons/react'

type AlertType = 'warning' | 'info' | 'danger'

interface AlertBannerProps {
  type?: AlertType
  children: React.ReactNode
  className?: string
}

const typeConfig = {
  warning: {
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    textColor: 'text-amber-800',
    icon: Warning,
    iconColor: 'text-amber-500',
  },
  info: {
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-800',
    icon: Info,
    iconColor: 'text-blue-500',
  },
  danger: {
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-800',
    icon: Warning,
    iconColor: 'text-red-500',
  },
}

export function AlertBanner({ type = 'warning', children, className = '' }: AlertBannerProps) {
  const config = typeConfig[type]
  const Icon = config.icon

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 rounded-xl border
        ${config.bgColor} ${config.borderColor} ${className}
      `}
    >
      <Icon weight="fill" className={`w-5 h-5 ${config.iconColor} shrink-0`} />
      <div className={`text-sm ${config.textColor}`}>{children}</div>
    </div>
  )
}

// Convenience component for deadline alert
interface DeadlineAlertProps {
  overdueCount: number
  nextDueDate?: string | null
  className?: string
}

export function DeadlineAlert({ overdueCount, nextDueDate, className = '' }: DeadlineAlertProps) {
  if (overdueCount === 0 && !nextDueDate) return null

  // Parse date string safely to avoid timezone issues
  const parseDate = (dateStr: string): Date => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [year, month, day] = dateStr.split('-').map(Number)
      return new Date(year, month - 1, day)
    }
    return new Date(dateStr)
  }

  const formatDate = (date: string) => {
    const d = parseDate(date)
    const now = new Date()
    const dMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const diffDays = Math.round((dMidnight.getTime() - nowMidnight.getTime()) / (1000 * 60 * 60 * 24))

    if (diffDays === 0) return '今日'
    if (diffDays === 1) return '明日'

    return d.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-6 gap-y-2 ${className}`}>
      {overdueCount > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <Warning weight="fill" className="w-4 h-4 text-red-500" />
          <span className="text-red-700 font-medium">
            期限切れ: {overdueCount}件
          </span>
        </div>
      )}
      {nextDueDate && (
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="w-4 h-4 text-gray-500" />
          <span className="text-gray-600">
            次の期限: {formatDate(nextDueDate)}
          </span>
        </div>
      )}
    </div>
  )
}
