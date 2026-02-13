'use client'

interface ProgressBarProps {
  percent: number
  showLabel?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeConfig = {
  sm: 'h-1',
  md: 'h-1.5',
  lg: 'h-2',
}

export function ProgressBar({
  percent,
  showLabel = true,
  size = 'md',
  className = '',
}: ProgressBarProps) {
  // Clamp percent between 0 and 100
  const clampedPercent = Math.min(100, Math.max(0, percent))

  return (
    <div className={`w-full ${className}`}>
      {showLabel && (
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm font-medium text-gray-700">全体進捗</span>
          <span className="text-sm font-semibold text-gray-900">
            {Math.round(clampedPercent)}%
          </span>
        </div>
      )}
      <div className={`w-full bg-gray-200 rounded-full overflow-hidden ${sizeConfig[size]}`}>
        <div
          className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${clampedPercent}%` }}
        />
      </div>
    </div>
  )
}
