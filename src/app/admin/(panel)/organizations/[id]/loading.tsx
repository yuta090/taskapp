import { SkeletonLine } from '@/components/shared/Skeleton'

/** 組織詳細は複数テーブルをまとめて引くので、全部そろうまでの間に骨組みを出す */
export default function Loading() {
  return (
    <div className="p-6 max-w-6xl space-y-6" aria-busy="true">
      <div className="space-y-2">
        <SkeletonLine className="w-24 h-3" />
        <SkeletonLine className="w-64 h-5" />
        <SkeletonLine className="w-80 h-3" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface rounded-xl border border-gray-200 p-5 space-y-3">
            <SkeletonLine className="w-16 h-3" />
            <SkeletonLine className="w-10 h-6" />
          </div>
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
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
