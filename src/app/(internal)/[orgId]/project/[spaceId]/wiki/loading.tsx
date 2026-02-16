import { SkeletonLine, SkeletonBlock } from '@/components/shared/Skeleton'

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white flex-shrink-0">
        <div className="flex items-center gap-2">
          <SkeletonBlock className="w-4 h-4 rounded" />
          <SkeletonLine className="w-12" />
        </div>
        <SkeletonBlock className="w-24 h-8 rounded-lg" />
      </div>
      {/* Page list skeleton */}
      <div className="flex-1 overflow-y-auto">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="px-6 py-3 border-b border-gray-50 space-y-1.5">
            <SkeletonLine className={`${i % 2 === 0 ? 'w-2/5' : 'w-1/3'}`} />
            <SkeletonLine className="w-1/5 h-2" />
          </div>
        ))}
      </div>
    </div>
  )
}
