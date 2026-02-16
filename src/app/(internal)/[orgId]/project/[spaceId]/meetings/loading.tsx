import { Notebook, CalendarCheck } from '@phosphor-icons/react/dist/ssr'
import { SkeletonLine, SkeletonCircle } from '@/components/shared/Skeleton'

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Real header */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Notebook className="text-lg text-gray-500" />
          <SkeletonLine className="w-24" />
        </div>
        <div className="ml-auto" aria-hidden="true">
          <span className="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg">
            新規会議
          </span>
        </div>
      </header>

      {/* Real tabs */}
      <div className="flex border-b border-gray-100 px-5 flex-shrink-0" aria-hidden="true">
        <span className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-gray-900 border-b-2 border-gray-900">
          <Notebook className="text-sm" />
          会議
        </span>
        <span className="flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium text-gray-500 border-b-2 border-transparent">
          <CalendarCheck className="text-sm" />
          日程調整
        </span>
      </div>

      {/* Content skeleton — meeting cards only */}
      <div className="flex-1 overflow-y-auto">
        <div className="py-4">
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
    </div>
  )
}
