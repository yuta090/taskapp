import { Copy, GearSix } from '@phosphor-icons/react/dist/ssr'
import { SkeletonLine, SkeletonCircle } from '@/components/shared/Skeleton'

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Real header — renders immediately */}
      <header className="border-b border-gray-100 flex-shrink-0">
        {/* Top row: Icon + breadcrumb placeholder + settings */}
        <div className="h-11 flex items-center px-5 border-b border-gray-50">
          <div className="flex items-center gap-2">
            <Copy className="text-lg text-gray-500" />
            <SkeletonLine className="w-24" />
          </div>
          <div className="flex-1" />
          <div className="p-2 text-gray-400">
            <GearSix className="text-lg" />
          </div>
        </div>
        {/* Bottom row: Filter tabs (real text, default=active) */}
        <div className="h-10 flex items-center px-5 gap-4" aria-hidden="true">
          <div className="flex items-center gap-1 bg-gray-100/80 rounded-lg p-0.5">
            <span className="px-3 py-1 text-xs rounded-md font-medium text-gray-500">すべて</span>
            <span className="px-3 py-1 text-xs rounded-md font-medium text-gray-900 bg-white shadow-sm">アクティブ</span>
            <span className="px-3 py-1 text-xs rounded-md font-medium text-gray-500">未着手</span>
            <span className="px-3 py-1 text-xs rounded-md font-medium text-gray-500">確認待ち</span>
          </div>
        </div>
      </header>
      {/* Content skeleton — task rows only */}
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
