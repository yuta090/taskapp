import { SkeletonLine, SkeletonBlock } from '@/components/shared/Skeleton'

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab nav skeleton */}
      <div className="h-10 border-b border-gray-200 flex items-center gap-4 px-4 flex-shrink-0">
        <SkeletonBlock className="w-16 h-6 rounded" />
        <SkeletonBlock className="w-20 h-6 rounded" />
      </div>
      {/* Controls bar */}
      <div className="h-10 border-b border-gray-100 flex items-center gap-3 px-4 flex-shrink-0">
        <SkeletonBlock className="w-32 h-7 rounded" />
        <SkeletonBlock className="w-24 h-7 rounded" />
      </div>
      {/* Chart area */}
      <div className="flex-1 flex p-6">
        {/* Y-axis labels */}
        <div className="w-10 flex flex-col justify-between py-4 flex-shrink-0">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonLine key={i} className="w-6 h-2" />
          ))}
        </div>
        {/* Chart grid */}
        <div className="flex-1 border border-gray-200 rounded-lg relative">
          {/* Horizontal grid lines */}
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="absolute left-0 right-0 border-t border-gray-100" style={{ top: `${(i + 1) * 20}%` }} />
          ))}
          {/* Placeholder burn line */}
          <SkeletonBlock className="absolute left-[5%] top-[10%] w-[60%] h-[70%] rounded-lg opacity-30" />
        </div>
      </div>
    </div>
  )
}
