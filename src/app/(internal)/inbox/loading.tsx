import { SkeletonLine, SkeletonCircle } from '@/components/shared/Skeleton'

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header skeleton */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <SkeletonCircle className="w-5 h-5" />
          <SkeletonLine className="w-20" />
        </div>
      </header>
      {/* Notification items skeleton */}
      <div className="flex-1 overflow-y-auto">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="px-4 py-3 border-b border-gray-100 flex items-start gap-3">
            <SkeletonCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <SkeletonLine className="w-3/5" />
              <SkeletonLine className="w-4/5 h-2.5" />
              <SkeletonLine className="w-1/3 h-2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
