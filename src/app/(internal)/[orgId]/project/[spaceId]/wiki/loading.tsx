import { BookOpen, Plus } from '@phosphor-icons/react/dist/ssr'
import { SkeletonLine } from '@/components/shared/Skeleton'

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Real header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white flex-shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <BookOpen className="text-gray-500" />
          <span className="font-medium text-gray-900">Wiki</span>
        </div>
        <span className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-indigo-600 rounded-lg" aria-hidden="true">
          <Plus className="text-base" />
          新規ページ
        </span>
      </div>
      {/* Content skeleton — page list only */}
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
