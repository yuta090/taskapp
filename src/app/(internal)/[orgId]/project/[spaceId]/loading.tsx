import { SkeletonLine, SkeletonBlock, SkeletonCircle } from '@/components/shared/Skeleton'

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header: breadcrumb row */}
      <header className="border-b border-gray-100 flex-shrink-0">
        <div className="h-11 flex items-center px-5 border-b border-gray-50">
          <div className="flex items-center gap-2">
            <SkeletonCircle className="w-5 h-5" />
            <SkeletonLine className="w-24" />
          </div>
        </div>
        {/* Tab row */}
        <div className="h-10 flex items-center px-5 gap-4">
          <div className="flex items-center gap-1 bg-gray-100/80 rounded-lg p-0.5">
            <SkeletonBlock className="w-14 h-6 rounded-md" />
            <SkeletonBlock className="w-20 h-6 rounded-md" />
            <SkeletonBlock className="w-16 h-6 rounded-md" />
          </div>
        </div>
      </header>
      {/* Task list skeleton */}
      <div className="flex-1 overflow-y-auto">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-2.5 border-b border-gray-50">
            <SkeletonCircle className="w-4 h-4 flex-shrink-0" />
            <SkeletonLine className={`flex-1 ${i % 3 === 0 ? 'w-3/4' : i % 3 === 1 ? 'w-1/2' : 'w-2/3'}`} />
            <div className="flex items-center gap-2 flex-shrink-0">
              <SkeletonCircle className="w-5 h-5" />
              <SkeletonLine className="w-12 h-2.5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
