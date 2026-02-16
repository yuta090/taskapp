import { Target, FunnelSimple, SortAscending } from '@phosphor-icons/react/dist/ssr'
import { SkeletonLine, SkeletonBlock, SkeletonCircle } from '@/components/shared/Skeleton'

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Real header */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
        <h1 className="text-sm font-medium text-gray-900 flex items-center gap-2">
          <Target className="text-lg text-gray-500" />
          マイタスク
        </h1>
        <span className="ml-2 text-xs text-gray-400">
          <SkeletonLine className="w-8 inline-block" />
        </span>
        <div className="flex-1" />
        {/* Filter button */}
        <span className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-500 rounded">
          <FunnelSimple className="text-sm" />
          フィルター
        </span>
        {/* Sort button */}
        <span className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 rounded ml-1">
          <SortAscending className="text-sm" />
          期限
        </span>
      </header>
      {/* Content skeleton — task groups only */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="py-4 space-y-6">
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
