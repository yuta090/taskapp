import { SkeletonLine, SkeletonCircle } from '@/components/shared/Skeleton'

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <SkeletonCircle className="w-5 h-5" />
          <SkeletonLine className="w-24" />
        </div>
      </header>
      {/* Meeting cards skeleton */}
      <div className="flex-1 overflow-y-auto">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="border-b border-gray-100 py-3 px-4 space-y-2">
            <SkeletonLine className={`${i % 2 === 0 ? 'w-2/5' : 'w-1/3'}`} />
            <SkeletonLine className="w-1/4 h-2.5" />
            <div className="flex items-center gap-1 pt-1">
              {Array.from({ length: 3 }).map((_, j) => (
                <SkeletonCircle key={j} className="w-5 h-5" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
