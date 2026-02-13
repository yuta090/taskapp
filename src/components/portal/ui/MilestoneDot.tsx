'use client'

export type MilestoneStatus = 'completed' | 'current' | 'upcoming'

interface MilestoneDotProps {
  status: MilestoneStatus
  label: string
  date?: string
  isLast?: boolean
}

const statusConfig = {
  completed: {
    dotColor: 'bg-emerald-500',
    lineColor: 'bg-emerald-500',
    labelColor: 'text-gray-600',
    dateColor: 'text-gray-400',
  },
  current: {
    dotColor: 'bg-amber-500',
    lineColor: 'bg-gray-200',
    labelColor: 'text-gray-900 font-semibold',
    dateColor: 'text-amber-600',
  },
  upcoming: {
    dotColor: 'bg-gray-300',
    lineColor: 'bg-gray-200',
    labelColor: 'text-gray-500',
    dateColor: 'text-gray-400',
  },
}

export function MilestoneDot({ status, label, date, isLast = false }: MilestoneDotProps) {
  const config = statusConfig[status]

  return (
    <div className="flex flex-col items-center">
      {/* Dot and line */}
      <div className="flex items-center">
        <div
          className={`w-3 h-3 rounded-full ${config.dotColor} ${
            status === 'current' ? 'ring-4 ring-amber-100' : ''
          }`}
        />
        {!isLast && (
          <div className={`w-16 sm:w-24 h-0.5 ${config.lineColor}`} />
        )}
      </div>

      {/* Label and date */}
      <div className="mt-2 text-center min-w-[60px]">
        <div className={`text-xs ${config.labelColor} truncate max-w-[80px]`}>
          {label}
        </div>
        {date && (
          <div className={`text-xs ${config.dateColor} mt-0.5`}>
            {date}
          </div>
        )}
      </div>
    </div>
  )
}
