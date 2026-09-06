import { SkeletonLine } from '@/components/shared/Skeleton'

/** 期間タブを押すとサーバーで集計を引き直す。その間「押した」反応が出るように骨組みを出す */
export default function Loading() {
  return (
    <div className="p-6 max-w-6xl space-y-8" aria-busy="true">
      <div className="space-y-2">
        <SkeletonLine className="w-56 h-5" />
        <SkeletonLine className="w-96 h-3" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface rounded-xl border border-gray-200 p-5 space-y-3">
            <SkeletonLine className="w-20 h-3" />
            <SkeletonLine className="w-12 h-6" />
          </div>
        ))}
      </div>
      <div className="bg-surface rounded-xl border border-gray-200 p-5 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonLine key={i} className="w-full h-6" />
        ))}
      </div>
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="bg-surface rounded-xl border border-gray-200">
          <div className="px-5 py-3 border-b border-gray-100">
            <SkeletonLine className="w-32 h-3.5" />
          </div>
          <div className="px-5 py-4 space-y-3">
            <SkeletonLine className="w-full h-3" />
            <SkeletonLine className="w-5/6 h-3" />
            <SkeletonLine className="w-2/3 h-3" />
          </div>
        </div>
      ))}
    </div>
  )
}
