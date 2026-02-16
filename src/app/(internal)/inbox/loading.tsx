import { Tray } from '@phosphor-icons/react/dist/ssr'
import { SkeletonLine, SkeletonCircle } from '@/components/shared/Skeleton'

export default function Loading() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Real header */}
      <header className="h-12 border-b border-gray-100 flex items-center px-5 flex-shrink-0">
        <h1 className="text-sm font-medium text-gray-900 flex items-center gap-2">
          <Tray className="text-lg text-gray-500" />
          受信トレイ
        </h1>
        <div className="flex-1" />
        {/* Keyboard hints */}
        <div className="hidden sm:flex items-center gap-2 mr-4 text-[10px] text-gray-400">
          <span className="px-1.5 py-0.5 bg-gray-100 rounded">{"↑↓"}</span>
          <span>移動</span>
          <span className="px-1.5 py-0.5 bg-gray-100 rounded">Enter</span>
          <span>詳細へ</span>
        </div>
      </header>
      {/* Content skeleton — notification rows only */}
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
