import { ChartLine, SquaresFour } from '@phosphor-icons/react/dist/ssr'
import { SkeletonLine, SkeletonBlock } from '@/components/shared/Skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Real header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <ChartLine className="text-lg text-gray-500" />
          <SkeletonLine className="w-24" />
        </div>
      </div>

      {/* Real tab nav (ViewsTabNav replica) */}
      <div className="flex items-center gap-1 px-4 pt-2 bg-white border-b border-gray-200" aria-hidden="true">
        <span className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-500">
          <SquaresFour className="w-3.5 h-3.5" />
          ガントチャート
        </span>
        <span className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-900 bg-gray-50 border border-gray-200 border-b-transparent -mb-px rounded-t">
          <ChartLine className="w-3.5 h-3.5" />
          バーンダウン
        </span>
      </div>

      {/* Content skeleton — controls + chart area only */}
      <div className="flex-1 p-4 overflow-auto">
        <div className="space-y-4">
          {/* Controls skeleton */}
          <div className="flex items-center gap-4 bg-white p-3 rounded-lg border border-gray-200">
            <SkeletonBlock className="w-48 h-8 rounded-md" />
            <div className="flex-1" />
            <SkeletonLine className="w-32 h-3" />
          </div>
          {/* Chart area skeleton */}
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <SkeletonBlock className="w-full h-64 rounded" />
          </div>
        </div>
      </div>
    </div>
  )
}
