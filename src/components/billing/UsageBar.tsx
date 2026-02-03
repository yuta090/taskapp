'use client'

interface UsageBarProps {
  label: string
  used: number
  limit: number | null
  unit?: string
  showWarning?: boolean
}

export function UsageBar({ label, used, limit, unit = '', showWarning = true }: UsageBarProps) {
  // limit === null は無制限
  if (limit === null) {
    return (
      <div className="space-y-1">
        <div className="flex justify-between text-sm">
          <span className="text-gray-600">{label}</span>
          <span className="text-gray-900 font-medium">
            {used}{unit} / 無制限
          </span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-gray-300 rounded-full" style={{ width: '0%' }} />
        </div>
      </div>
    )
  }

  // limit === 0 は常に100%（制限に達している）
  const percentage = limit === 0 ? 100 : Math.min(100, (used / limit) * 100)
  const isNearLimit = percentage >= 80
  const isAtLimit = percentage >= 100

  let barColor = 'bg-indigo-500'
  let textColor = 'text-gray-900'

  if (showWarning) {
    if (isAtLimit) {
      barColor = 'bg-red-500'
      textColor = 'text-red-600'
    } else if (isNearLimit) {
      barColor = 'bg-amber-500'
      textColor = 'text-amber-600'
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-gray-600">{label}</span>
        <span className={`font-medium ${textColor}`}>
          {used}{unit} / {limit}{unit}
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full ${barColor} rounded-full transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  )
}
