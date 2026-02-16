import { SquaresFour, ChartLine } from '@phosphor-icons/react/dist/ssr'
import { SkeletonLine, SkeletonBlock } from '@/components/shared/Skeleton'

export default function Loading() {
  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Real header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center gap-2">
          <SquaresFour className="text-lg text-gray-500" />
          <SkeletonLine className="w-24" />
        </div>
      </div>

      {/* Real tab nav (ViewsTabNav replica) */}
      <div className="flex items-center gap-1 px-4 pt-2 bg-white border-b border-gray-200" aria-hidden="true">
        <span className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-900 bg-gray-50 border border-gray-200 border-b-transparent -mb-px rounded-t">
          <SquaresFour className="w-3.5 h-3.5" />
          ガントチャート
        </span>
        <span className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-500">
          <ChartLine className="w-3.5 h-3.5" />
          バーンダウン
        </span>
      </div>

      {/* Content skeleton — gantt grid only */}
      <div className="flex-1 p-4 overflow-hidden">
        <div className="flex h-full rounded-lg border border-gray-200 bg-white overflow-hidden">
          {/* Left sidebar — task names */}
          <div className="w-[200px] border-r border-gray-200 flex-shrink-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-100">
                <SkeletonLine className={`${i % 2 === 0 ? 'w-3/4' : 'w-1/2'}`} />
              </div>
            ))}
          </div>
          {/* Right side — timeline placeholder */}
          <div className="flex-1 relative">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center h-[38px] border-b border-gray-100 px-4">
                <SkeletonBlock
                  className={`h-5 rounded ${
                    i % 3 === 0 ? 'w-1/3 ml-[10%]' : i % 3 === 1 ? 'w-1/4 ml-[20%]' : 'w-2/5 ml-[5%]'
                  }`}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
