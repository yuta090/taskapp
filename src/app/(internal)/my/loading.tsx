import { SkeletonLine, SkeletonBlock, SkeletonCircle } from '@/components/shared/Skeleton'

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <SkeletonCircle className="w-5 h-5" />
          <SkeletonLine className="w-20" />
          <SkeletonLine className="w-8 h-2.5" />
        </div>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="py-4 space-y-6">
          {/* Two project groups */}
          {Array.from({ length: 2 }).map((_, gi) => (
            <div key={gi}>
              {/* Project header */}
              <SkeletonBlock className="h-8 mx-0 rounded-sm" />
              <div className="space-y-3 py-2">
                {/* Milestone sub-group */}
                <div>
                  <SkeletonBlock className="h-7 mx-2 rounded" />
                  <div className="pl-3 mt-1 space-y-0.5">
                    {Array.from({ length: 3 }).map((_, ti) => (
                      <div key={ti} className="flex items-center gap-3 px-3 py-2.5">
                        <SkeletonCircle className="w-4 h-4 flex-shrink-0" />
                        <SkeletonLine className={`flex-1 ${ti === 0 ? 'w-3/4' : ti === 1 ? 'w-1/2' : 'w-2/3'}`} />
                        <SkeletonLine className="w-12 h-2.5 flex-shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
