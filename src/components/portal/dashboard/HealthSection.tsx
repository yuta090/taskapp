'use client'

import { HealthBadge, type HealthStatus } from '../ui'

interface HealthSectionProps {
  status: HealthStatus
  reason: string
  nextMilestone?: {
    name: string
    date: string
  }
}

export function HealthSection({ status, reason, nextMilestone }: HealthSectionProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <HealthBadge status={status} size="lg" />
          <span className="text-sm text-gray-600">{reason}</span>
        </div>
        {nextMilestone && (
          <div className="text-sm text-gray-500">
            次のマイルストーン:{' '}
            <span className="font-medium text-gray-700">
              {nextMilestone.date} {nextMilestone.name}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
