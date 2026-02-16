import { SkeletonLine, SkeletonBlock } from '@/components/shared/Skeleton'

export default function Loading() {
  const barWidths = ['w-2/5', 'w-3/5', 'w-1/4', 'w-1/2', 'w-2/3', 'w-1/3', 'w-3/4', 'w-2/5']
  const barOffsets = ['ml-[10%]', 'ml-[20%]', 'ml-[5%]', 'ml-[30%]', 'ml-[15%]', 'ml-[40%]', 'ml-[10%]', 'ml-[25%]']

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Tab nav skeleton */}
      <div className="h-10 border-b border-gray-200 flex items-center gap-4 px-4 flex-shrink-0">
        <SkeletonBlock className="w-16 h-6 rounded" />
        <SkeletonBlock className="w-20 h-6 rounded" />
      </div>
      {/* Gantt grid */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left: task names */}
        <div className="w-64 border-r border-gray-200 flex-shrink-0">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 flex items-center px-3 border-b border-gray-100">
              <SkeletonLine className={i % 2 === 0 ? 'w-3/4' : 'w-1/2'} />
            </div>
          ))}
        </div>
        {/* Right: timeline bars */}
        <div className="flex-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-10 flex items-center border-b border-gray-100 px-2">
              <SkeletonBlock className={`h-5 rounded ${barWidths[i]} ${barOffsets[i]}`} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
