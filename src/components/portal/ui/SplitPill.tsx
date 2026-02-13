'use client'

interface SplitPillProps {
  leftLabel: string
  leftValue: number
  rightLabel: string
  rightValue: number
  activeLeft?: boolean
  className?: string
}

export function SplitPill({
  leftLabel,
  leftValue,
  rightLabel,
  rightValue,
  activeLeft = true,
  className = '',
}: SplitPillProps) {
  return (
    <div className={`inline-flex flex-row items-center rounded-lg overflow-hidden border border-gray-200 whitespace-nowrap ${className}`}>
      {/* Left segment */}
      <div
        className={`px-3 py-1.5 text-sm font-medium transition-colors flex items-center gap-1 ${
          activeLeft
            ? 'bg-amber-500 text-white'
            : 'bg-gray-50 text-gray-600'
        }`}
      >
        <span>{leftLabel}</span>
        <span className="font-bold">{leftValue}</span>
      </div>

      {/* Right segment */}
      <div
        className={`px-3 py-1.5 text-sm font-medium transition-colors border-l border-gray-200 flex items-center gap-1 ${
          !activeLeft
            ? 'bg-amber-500 text-white'
            : 'bg-gray-50 text-gray-600'
        }`}
      >
        <span>{rightLabel}</span>
        <span className="font-bold">{rightValue}</span>
      </div>
    </div>
  )
}
